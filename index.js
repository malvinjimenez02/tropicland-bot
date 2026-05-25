require('dotenv').config();
const express = require('express');
const QRCode = require('qrcode');
const { connectToWhatsApp, getCurrentQR } = require('./src/whatsapp');
const { processIncomingMessage } = require('./src/bot');
const { startCronJobs, procesarSeguimientos, enviarResumenDiario } = require('./src/cron');

const app = express();
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

app.get('/qr', async (req, res) => {
  const qr = getCurrentQR();
  if (!qr) {
    return res.send('<h2 style="font-family:sans-serif">✅ Bot ya conectado a WhatsApp — no hay QR pendiente.</h2>');
  }
  const imgDataUrl = await QRCode.toDataURL(qr, { scale: 8 });
  res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>QR TropiclandBot</title>
    <meta http-equiv="refresh" content="20">
    <style>body{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#111;color:#fff;font-family:sans-serif;}
    img{border:16px solid white;border-radius:8px;}</style></head>
    <body><h2>Escanea con WhatsApp → Dispositivos vinculados</h2>
    <img src="${imgDataUrl}" /><p style="opacity:.6">Se actualiza automáticamente cada 20 segundos</p>
    </body></html>`);
});

// Rutas de cron para disparo manual o externo (protegidas con CRON_SECRET)
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

async function main() {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Servidor HTTP corriendo en puerto ${PORT}`);
  });

  console.log('Iniciando TropiclandBot con Baileys...');

  await connectToWhatsApp(async (numero, content) => {
    await processIncomingMessage(numero, content);
  });

  startCronJobs();
}

main().catch((err) => {
  console.error('Error fatal al iniciar el bot:', err);
  process.exit(1);
});
