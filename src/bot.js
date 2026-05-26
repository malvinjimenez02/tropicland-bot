const { callOpenAI } = require('./openai');
const { executeTool, getPedidoRef } = require('./tools');
const { sendTextMessage } = require('./whatsapp');
const { isBotPausado, actualizarConversacion, registrarLog, buscarConversacion } = require('./sheets');

// Historial en memoria por número de WhatsApp (se pierde al reiniciar)
// Para persistencia real, leer de Sheets en cada mensaje
const conversationHistory = {};

function getHistory(numero) {
  if (!conversationHistory[numero]) conversationHistory[numero] = [];
  return conversationHistory[numero];
}

function addToHistory(numero, role, content) {
  const history = getHistory(numero);
  history.push({ role, content });
  // Limitar historial a últimas 20 interacciones
  if (history.length > 40) history.splice(0, history.length - 40);
}

function buildUserContent(content) {
  if (content.type === 'text') return content.body;
  if (content.type === 'location') {
    return `[El cliente compartió su ubicación GPS: Lat ${content.latitude}, Lng ${content.longitude}${content.address ? ` - ${content.address}` : ''}]`;
  }
  return `[El cliente envió un mensaje de tipo: ${content.type}]`;
}

async function processIncomingMessage(numero_whatsapp, content) {
  try {
    // Verificar si el bot está pausado para este número
    const pausado = await isBotPausado(numero_whatsapp);
    if (pausado) {
      console.log(`Bot pausado para ${numero_whatsapp}. Ignorando mensaje.`);
      return;
    }

    const userMessage = buildUserContent(content);
    addToHistory(numero_whatsapp, 'user', userMessage);

    // Guardar último mensaje recibido y loguear en historial
    const conv = await buscarConversacion(numero_whatsapp);
    const nombreCliente = conv?.data?.[1] || numero_whatsapp;
    await actualizarConversacion(numero_whatsapp, { ultimo_recibido: userMessage });
    await registrarLog({
      numero_whatsapp,
      nombre_cliente: nombreCliente,
      accion: 'MSG_RECIBIDO',
      detalle: userMessage,
      estado_resultante: '',
    });

    let messages = getHistory(numero_whatsapp);
    let response = await callOpenAI(messages);

    // Procesar tool calls en loop hasta que no haya más
    while (response.tool_calls && response.tool_calls.length > 0) {
      // Añadir respuesta del asistente con tool_calls al historial
      addToHistory(numero_whatsapp, 'assistant', response.content || '');
      const toolCallsMsg = { role: 'assistant', content: response.content || null, tool_calls: response.tool_calls };

      const toolResults = [];
      for (const toolCall of response.tool_calls) {
        let args;
        try {
          args = JSON.parse(toolCall.function.arguments);
        } catch {
          args = {};
        }

        // Inyectar numero_whatsapp en args si el tool lo requiere
        if (!args.numero_whatsapp) {
          args.numero_whatsapp = numero_whatsapp;
        }

        const result = await executeTool(toolCall.function.name, args, numero_whatsapp);
        toolResults.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
      }

      // Nueva llamada a OpenAI con los resultados de los tools
      messages = [
        ...getHistory(numero_whatsapp).slice(0, -1),
        toolCallsMsg,
        ...toolResults,
      ];
      response = await callOpenAI(messages);
    }

    // Respuesta final del asistente
    const assistantText = response.content;
    if (assistantText) {
      addToHistory(numero_whatsapp, 'assistant', assistantText);
      await sendTextMessage(numero_whatsapp, assistantText);
      await actualizarConversacion(numero_whatsapp, { ultimo_enviado: assistantText });
      await registrarLog({
        numero_whatsapp,
        nombre_cliente: nombreCliente,
        accion: 'MSG_ENVIADO',
        detalle: assistantText,
        estado_resultante: '',
      });
    }
  } catch (err) {
    console.error(`Error procesando mensaje de ${numero_whatsapp}:`, err);

    // Error técnico: notificar al cliente y escalar
    try {
      await sendTextMessage(
        numero_whatsapp,
        'Estamos experimentando un problema técnico momentáneo. Un representante te contactará pronto. ¡Disculpa el inconveniente! 🙏'
      );

      // Escalar al dueño
      const ownerNumber = process.env.OWNER_WHATSAPP_NUMBER;
      if (ownerNumber) {
        await sendTextMessage(
          ownerNumber,
          `⚠️ Error técnico del bot para el número ${numero_whatsapp}.\nError: ${err.message}\nRevisa los logs.`
        );
      }
    } catch (sendErr) {
      console.error('Error enviando mensaje de error:', sendErr.message);
    }
  }
}

module.exports = { processIncomingMessage };
