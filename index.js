require('dotenv').config();
const express = require('express');
const rateLimit = require('express-rate-limit');
const { processIncomingMessage } = require('./src/bot');
const { startCronJobs, procesarSeguimientos, enviarResumenDiario } = require('./src/cron');

const app = express();
app.use(express.json());

// Rate limiting: máximo 10 mensajes por número por hora
const messageLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => {
    const body = req.body;
    try {
      return body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from || req.ip;
    } catch {
      return req.ip;
    }
  },
  skip: (req) => req.method === 'GET',
  message: { error: 'Too many messages' },
});

// Verificación del webhook de Meta (GET)
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.META_WEBHOOK_VERIFY_TOKEN) {
    console.log('Webhook verificado correctamente');
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// Recepción de mensajes (POST)
app.post('/webhook', messageLimiter, async (req, res) => {
  // Meta requiere respuesta 200 inmediata
  res.sendStatus(200);

  const body = req.body;
  if (body.object !== 'whatsapp_business_account') return;

  try {
    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    if (!value?.messages?.length) return;

    const message = value.messages[0];
    const from = message.from;
    const messageType = message.type;

    let content = null;
    if (messageType === 'text') {
      content = { type: 'text', body: message.text.body };
    } else if (messageType === 'location') {
      content = {
        type: 'location',
        latitude: message.location.latitude,
        longitude: message.location.longitude,
        name: message.location.name || '',
        address: message.location.address || '',
      };
    } else {
      // Voz, imagen, video, sticker, etc.
      content = { type: messageType };
    }

    await processIncomingMessage(from, content);
  } catch (err) {
    console.error('Error procesando webhook:', err);
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Rutas de cron para Vercel Cron Jobs (protegidas con CRON_SECRET)
function verifyCronSecret(req, res) {
  const secret = req.headers['authorization'];
  if (secret !== `Bearer ${process.env.CRON_SECRET}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

app.get('/api/cron/seguimientos', async (req, res) => {
  if (!verifyCronSecret(req, res)) return;
  try {
    await procesarSeguimientos();
    res.json({ ok: true });
  } catch (err) {
    console.error('Cron seguimientos error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/cron/resumen', async (req, res) => {
  if (!verifyCronSecret(req, res)) return;
  try {
    await enviarResumenDiario();
    res.json({ ok: true });
  } catch (err) {
    console.error('Cron resumen error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Iniciar servidor local (no en Vercel)
if (process.env.NODE_ENV !== 'production' || process.env.VERCEL !== '1') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Bot WhatsApp corriendo en puerto ${PORT}`);
    startCronJobs();
  });
}

module.exports = app;
