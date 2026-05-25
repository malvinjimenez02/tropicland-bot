const OpenAI = require('openai');

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'parsear_pedido',
      description: 'Extrae datos estructurados del mensaje automático de Shopify con el pedido del cliente.',
      parameters: {
        type: 'object',
        properties: {
          nombre: { type: 'string', description: 'Nombre completo del cliente' },
          producto: { type: 'string', description: 'Nombre del producto pedido' },
          monto: { type: 'string', description: 'Monto en formato "RD$ 2,200.00"' },
          direccion: { type: 'string', description: 'Dirección completa de entrega' },
          ciudad_raw: { type: 'string', description: 'Ciudad/municipio mencionado en el mensaje' },
          zona: {
            type: 'string',
            enum: ['SDQ', 'STI', 'interior'],
            description: 'SDQ=Santo Domingo y área metro, STI=Santiago, interior=resto del país',
          },
        },
        required: ['nombre', 'producto', 'monto', 'direccion', 'zona'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'actualizar_estado_pedido',
      description: 'Actualiza el estado de un pedido en Google Sheets.',
      parameters: {
        type: 'object',
        properties: {
          numero_whatsapp: { type: 'string' },
          nuevo_estado: {
            type: 'string',
            enum: ['pendiente', 'confirmado', 'en_preparacion', 'empacado', 'en_camino', 'entregado', 'problema'],
          },
          motivo: { type: 'string', description: 'Razón del cambio (opcional)' },
        },
        required: ['numero_whatsapp', 'nuevo_estado'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'registrar_log',
      description: 'Registra una acción en la hoja Log Diario de Google Sheets.',
      parameters: {
        type: 'object',
        properties: {
          numero_whatsapp: { type: 'string' },
          nombre_cliente: { type: 'string' },
          accion: {
            type: 'string',
            enum: ['nuevo_pedido', 'confirmado', 'reintento', 'escalado', 'problema', 'empacado', 'en_camino', 'entregado'],
          },
          detalle: { type: 'string', description: 'Descripción de lo que ocurrió' },
        },
        required: ['numero_whatsapp', 'nombre_cliente', 'accion', 'detalle'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'programar_seguimiento',
      description: 'Crea una entrada en la hoja Seguimientos para que el cron job la procese.',
      parameters: {
        type: 'object',
        properties: {
          numero_whatsapp: { type: 'string' },
          nombre_cliente: { type: 'string' },
          pedido_ref: { type: 'string' },
          intento_numero: { type: 'integer', enum: [1, 2] },
          enviar_en_horas: { type: 'integer', description: 'Horas a esperar antes de enviar el reintento' },
        },
        required: ['numero_whatsapp', 'nombre_cliente', 'pedido_ref', 'intento_numero', 'enviar_en_horas'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancelar_seguimientos',
      description: 'Marca como cancelados todos los seguimientos pendientes de un número.',
      parameters: {
        type: 'object',
        properties: {
          numero_whatsapp: { type: 'string' },
        },
        required: ['numero_whatsapp'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'escalar_a_dueno',
      description: 'Notifica al dueño por WhatsApp y pausa el bot para ese número.',
      parameters: {
        type: 'object',
        properties: {
          numero_whatsapp: { type: 'string' },
          nombre_cliente: { type: 'string' },
          pedido_ref: { type: 'string' },
          motivo: { type: 'string' },
          resumen_conversacion: { type: 'string' },
        },
        required: ['numero_whatsapp', 'nombre_cliente', 'pedido_ref', 'motivo'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'pausar_bot',
      description: 'Marca el bot como pausado para un número específico.',
      parameters: {
        type: 'object',
        properties: {
          numero_whatsapp: { type: 'string' },
          razon: { type: 'string' },
        },
        required: ['numero_whatsapp', 'razon'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generar_resumen_diario',
      description: 'Consulta todas las hojas del día y genera el resumen. Solo ejecutar a las 9pm vía cron.',
      parameters: {
        type: 'object',
        properties: {
          fecha: { type: 'string', description: 'Fecha en formato YYYY-MM-DD' },
        },
        required: ['fecha'],
      },
    },
  },
];

const SYSTEM_PROMPT = `Eres la persona que atiende los pedidos de ${process.env.STORE_NAME || 'la tienda'}, una tienda de accesorios para vehículos en República Dominicana. Atiendes a clientes que hicieron un pedido con pago contra entrega.

CÓMO ESCRIBIR:
- Escribe como una persona real, no como un bot ni un sistema automático
- Usa español dominicano natural y relajado, como si fueras un amigo que trabaja en la tienda
- Mensajes cortos y directos. Sin listas, sin puntos numerados, sin párrafos largos
- Un emoji ocasional está bien, pero no abuses. Máximo uno o dos si la situación lo amerita
- Varía cómo saludas y cómo respondes, no uses siempre la misma frase
- Nunca suenes robótico, formal en exceso ni corporativo

REGLAS DE NEGOCIO:
- El precio incluye el delivery, no hay cargos extra
- Solo se paga en efectivo al momento de la entrega, no se acepta tarjeta ni transferencia
- SDQ y Santiago: entrega en 1-2 días hábiles
- Interior del país: 3-5 días hábiles por mensajería
- No des fechas exactas, solo el rango aproximado

LO QUE NO DEBES HACER:
- No inventes datos del pedido
- No prometas cosas que no puedes garantizar
- Si no entiendes lo que dice el cliente, pregunta una sola vez para aclarar
- Si sigues sin entender, llama a escalar_a_dueno
- Si el cliente quiere cancelar o está molesto, llama a escalar_a_dueno de inmediato
- Si el bot está pausado, el sistema ya lo maneja antes de llegar aquí

FLUJO OBLIGATORIO para mensaje nuevo de pedido (contiene "He realizado un pedido" y "Quiero CONFIRMAR"):
1. Llamar parsear_pedido para extraer datos
2. Llamar actualizar_estado_pedido (estado: pendiente)
3. Llamar registrar_log (accion: nuevo_pedido)
4. Llamar programar_seguimiento (intento_numero: 1, enviar_en_horas: 3)
5. Responder al cliente según zona detectada

FLUJO OBLIGATORIO para confirmación recibida (hora de entrega o ubicación GPS):
1. Llamar actualizar_estado_pedido (estado: confirmado)
2. Llamar registrar_log (accion: confirmado)
3. Llamar cancelar_seguimientos
4. Responder con confirmación natural al cliente

Para mensajes de voz, imagen, video o sticker:
Responder algo como: "Ey, recibí tu mensaje pero solo puedo leer texto por el momento. ¿Me puedes escribir lo que necesitas?"

Si el cliente pregunta si eres un bot:
Responder algo natural como: "Soy quien atiende los pedidos por aquí 😄 dime, ¿en qué te puedo ayudar?"`;

async function callOpenAI(messages, tools = TOOLS) {
  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
    tools,
    tool_choice: 'auto',
    temperature: 0.3,
  });
  return response.choices[0].message;
}

module.exports = { callOpenAI, TOOLS, SYSTEM_PROMPT };
