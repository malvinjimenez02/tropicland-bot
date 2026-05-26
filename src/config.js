const { getSheetsClient } = require('./sheets');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const CONFIG_SHEET = 'Config';

const DEFAULT_PROMPT = `Eres la persona que atiende los pedidos de la tienda, una tienda de accesorios para vehículos en República Dominicana. Atiendes a clientes que hicieron un pedido con pago contra entrega.

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

async function withRetry(fn, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

async function readAllRows() {
  const sheets = await getSheetsClient();
  const res = await withRetry(() =>
    sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${CONFIG_SHEET}!A:B`,
    })
  );
  return res.data.values || [];
}

async function writeRowAt(sheets, rowNumber, key, value) {
  await withRetry(() =>
    sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${CONFIG_SHEET}!A${rowNumber}:B${rowNumber}`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [[key, value]] },
    })
  );
}

async function appendConfigRow(sheets, key, value) {
  await withRetry(() =>
    sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${CONFIG_SHEET}!A:B`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [[key, value]] },
    })
  );
}

function parseRows(rows) {
  const config = {
    systemPrompt: DEFAULT_PROMPT,
    businessInfo: {
      store_name: process.env.STORE_NAME || 'la tienda',
      delivery_sdq: '1-2 días hábiles',
      delivery_sti: '1-2 días hábiles',
      delivery_interior: '3-5 días hábiles',
    },
    faqs: [],
  };

  for (let i = 1; i < rows.length; i++) {
    const key = (rows[i][0] || '').trim();
    const value = rows[i][1] || '';
    if (!key) continue;

    if (key === 'system_prompt') config.systemPrompt = value;
    else if (key === 'store_name') config.businessInfo.store_name = value;
    else if (key === 'delivery_sdq') config.businessInfo.delivery_sdq = value;
    else if (key === 'delivery_sti') config.businessInfo.delivery_sti = value;
    else if (key === 'delivery_interior') config.businessInfo.delivery_interior = value;
    else if (key.startsWith('faq::')) {
      config.faqs.push({ pregunta: key.slice(5), respuesta: value });
    }
  }

  return config;
}

async function getFullConfig() {
  const rows = await readAllRows();
  return parseRows(rows);
}

async function upsertKey(key, value) {
  const sheets = await getSheetsClient();
  const rows = await readAllRows();

  for (let i = 1; i < rows.length; i++) {
    if ((rows[i][0] || '').trim() === key) {
      await writeRowAt(sheets, i + 1, key, value);
      return;
    }
  }
  await appendConfigRow(sheets, key, value);
}

async function updateSystemPrompt(text) {
  await upsertKey('system_prompt', text);
}

async function updateBusinessInfo({ store_name, delivery_sdq, delivery_sti, delivery_interior }) {
  if (store_name !== undefined) await upsertKey('store_name', store_name);
  if (delivery_sdq !== undefined) await upsertKey('delivery_sdq', delivery_sdq);
  if (delivery_sti !== undefined) await upsertKey('delivery_sti', delivery_sti);
  if (delivery_interior !== undefined) await upsertKey('delivery_interior', delivery_interior);
}

async function upsertFaq(pregunta, respuesta) {
  await upsertKey(`faq::${pregunta}`, respuesta);
}

async function deleteFaq(pregunta) {
  const sheets = await getSheetsClient();
  const rows = await readAllRows();
  const key = `faq::${pregunta}`;

  for (let i = 1; i < rows.length; i++) {
    if ((rows[i][0] || '').trim() === key) {
      await withRetry(() =>
        sheets.spreadsheets.values.clear({
          spreadsheetId: SHEET_ID,
          range: `${CONFIG_SHEET}!A${i + 1}:B${i + 1}`,
        })
      );
      return;
    }
  }
}

async function buildSystemPrompt() {
  const { systemPrompt, faqs } = await getFullConfig();

  if (faqs.length === 0) return systemPrompt;

  const faqSection =
    '\n\nPREGUNTAS FRECUENTES (responde EXACTAMENTE con esta información cuando el cliente pregunte algo relacionado):\n' +
    faqs.map(f => `- "${f.pregunta}" → ${f.respuesta}`).join('\n');

  return systemPrompt + faqSection;
}

async function initConfigSheet() {
  const rows = await readAllRows();
  if (rows.length > 1) return;

  const sheets = await getSheetsClient();
  const defaults = [
    ['Clave', 'Valor'],
    ['system_prompt', DEFAULT_PROMPT],
    ['store_name', process.env.STORE_NAME || 'Tropicland'],
    ['delivery_sdq', '1-2 días hábiles'],
    ['delivery_sti', '1-2 días hábiles'],
    ['delivery_interior', '3-5 días hábiles'],
    ['faq::¿Aceptan tarjeta?', 'No, solo efectivo al momento de la entrega'],
    ['faq::¿Dónde están ubicados?', 'Hacemos entrega a domicilio, no tenemos local físico'],
  ];

  await withRetry(() =>
    sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${CONFIG_SHEET}!A1`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: defaults },
    })
  );
}

module.exports = {
  getFullConfig,
  updateSystemPrompt,
  updateBusinessInfo,
  upsertFaq,
  deleteFaq,
  buildSystemPrompt,
  initConfigSheet,
};
