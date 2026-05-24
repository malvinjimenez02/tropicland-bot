require('dotenv').config();
const express = require('express');
const { connectToWhatsApp } = require('./src/whatsapp');
const { processIncomingMessage } = require('./src/bot');
const { startCronJobs, procesarSeguimientos, enviarResumenDiario } = require('./src/cron');

const app = express();
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

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
