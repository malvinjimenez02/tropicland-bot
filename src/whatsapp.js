const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  isJidBroadcast,
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const path = require('path');

let sock = null;
let messageHandler = null;
let currentQR = null;

// Convierte número de teléfono a JID de WhatsApp
function toJid(numero) {
  // Si ya tiene @, devolverlo tal cual
  if (numero.includes('@')) return numero;
  // Limpiar caracteres no numéricos
  const clean = numero.replace(/\D/g, '');
  return `${clean}@s.whatsapp.net`;
}

// Extrae número limpio desde un JID
function fromJid(jid) {
  return jid.split('@')[0];
}

async function connectToWhatsApp(onMessage) {
  messageHandler = onMessage;

  const { state, saveCreds } = await useMultiFileAuthState(
    path.join(__dirname, '..', 'auth_state')
  );

  const { version } = await fetchLatestBaileysVersion();
  console.log(`[Baileys] Usando versión WA: ${version.join('.')}`);

  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    browser: ['TropiclandBot', 'Chrome', '1.0.0'],
    markOnlineOnConnect: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      currentQR = qr;
      console.log('[Baileys] Nuevo QR generado. Ábrelo en: /qr');
    }

    if (connection === 'close') {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;

      console.log(
        `[Baileys] Conexión cerrada. Razón: ${lastDisconnect?.error?.message}. Reconectando: ${shouldReconnect}`
      );

      if (shouldReconnect) {
        setTimeout(() => connectToWhatsApp(messageHandler), 5000);
      } else {
        console.error('[Baileys] Sesión cerrada (logout). Elimina la carpeta auth_state y reinicia.');
      }
    } else if (connection === 'open') {
      currentQR = null;
      console.log('[Baileys] ✅ Conectado a WhatsApp exitosamente');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      // Ignorar mensajes propios, grupos y broadcasts
      if (msg.key.fromMe) continue;
      if (isJidBroadcast(msg.key.remoteJid)) continue;
      if (msg.key.remoteJid.endsWith('@g.us')) continue;

      const jid = msg.key.remoteJid;
      const numero = fromJid(jid);

      // Extraer contenido del mensaje
      const content = extractContent(msg);
      if (!content) continue;

      console.log(`[Baileys] Mensaje de ${numero}: ${JSON.stringify(content)}`);

      if (messageHandler) {
        await messageHandler(numero, content);
      }
    }
  });

  return sock;
}

function extractContent(msg) {
  const m = msg.message;
  if (!m) return null;

  // Texto plano
  const text =
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.ephemeralMessage?.message?.extendedTextMessage?.text;
  if (text) return { type: 'text', body: text };

  // Ubicación GPS
  if (m.locationMessage) {
    return {
      type: 'location',
      latitude: m.locationMessage.degreesLatitude,
      longitude: m.locationMessage.degreesLongitude,
      address: m.locationMessage.name || m.locationMessage.address || '',
    };
  }

  // Imagen
  if (m.imageMessage) return { type: 'image', caption: m.imageMessage.caption || '' };

  // Audio / voz
  if (m.audioMessage) return { type: 'audio' };

  // Video
  if (m.videoMessage) return { type: 'video' };

  // Documento
  if (m.documentMessage) return { type: 'document' };

  return { type: 'unknown' };
}

async function sendTextMessage(to, text) {
  if (!sock) throw new Error('[Baileys] Socket no inicializado. Llama connectToWhatsApp primero.');

  const jid = toJid(to);
  try {
    await sock.sendMessage(jid, { text });
    console.log(`[Baileys] Mensaje enviado a ${to}: ${text.substring(0, 60)}...`);
  } catch (err) {
    console.error(`[Baileys] Error enviando mensaje a ${to}:`, err.message);
    throw err;
  }
}

function getSocket() {
  return sock;
}

function getCurrentQR() {
  return currentQR;
}

module.exports = { connectToWhatsApp, sendTextMessage, toJid, fromJid, getSocket, getCurrentQR };
