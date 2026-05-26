const OpenAI = require('openai');
const { buildSystemPrompt } = require('./config');

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

let promptCache = { text: null, expiresAt: 0 };

function invalidatePromptCache() {
  promptCache = { text: null, expiresAt: 0 };
}

async function getSystemPrompt() {
  if (promptCache.text && Date.now() < promptCache.expiresAt) {
    return promptCache.text;
  }
  try {
    const text = await buildSystemPrompt();
    promptCache = { text, expiresAt: Date.now() + 5 * 60 * 1000 };
    return text;
  } catch (err) {
    console.error('[OpenAI] Error cargando system prompt desde Sheets, usando fallback:', err.message);
    return promptCache.text || FALLBACK_PROMPT;
  }
}

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

const FALLBACK_PROMPT = `Eres la persona que atiende los pedidos de ${process.env.STORE_NAME || 'la tienda'}, una tienda de accesorios para vehículos en República Dominicana. Atiendes a clientes que hicieron un pedido con pago contra entrega. Solo se paga en efectivo al momento de la entrega. Si no puedes responder algo con certeza, escala al dueño.`;

async function callOpenAI(messages, tools = TOOLS) {
  const systemPrompt = await getSystemPrompt();
  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'system', content: systemPrompt }, ...messages],
    tools,
    tool_choice: 'auto',
    temperature: 0.3,
  });
  return response.choices[0].message;
}

module.exports = { callOpenAI, TOOLS, invalidatePromptCache };
