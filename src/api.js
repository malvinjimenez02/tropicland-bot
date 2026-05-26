const express = require('express');
const crypto = require('crypto');
const { getFullConfig, updateSystemPrompt, updateBusinessInfo, upsertFaq, deleteFaq } = require('./config');
const { invalidatePromptCache } = require('./openai');
const { getAllConversaciones, getPedidosDelDia, pausarBot, activarBot, getLogPorTelefono, actualizarConversacion, registrarLog } = require('./sheets');
const { sendTextMessage, getConnectionState } = require('./whatsapp');

const router = express.Router();

// Tokens válidos en memoria: Map<token, expiresAt>
const activeTokens = new Map();
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function isValidToken(token) {
  if (!token) return false;
  const expiresAt = activeTokens.get(token);
  if (!expiresAt) return false;
  if (Date.now() > expiresAt) {
    activeTokens.delete(token);
    return false;
  }
  return true;
}

function requireAuth(req, res, next) {
  const token = req.headers['x-dashboard-token'];
  if (!isValidToken(token)) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  next();
}

// --- AUTH ---

router.post('/login', (req, res) => {
  const { password } = req.body || {};
  const expected = process.env.DASHBOARD_PASSWORD;

  if (!expected) {
    return res.status(500).json({ error: 'DASHBOARD_PASSWORD no configurado en .env' });
  }

  if (!password || password !== expected) {
    return res.status(401).json({ error: 'Contraseña incorrecta' });
  }

  const token = generateToken();
  activeTokens.set(token, Date.now() + TOKEN_TTL_MS);
  res.json({ token });
});

router.post('/logout', requireAuth, (req, res) => {
  const token = req.headers['x-dashboard-token'];
  activeTokens.delete(token);
  res.json({ ok: true });
});

router.get('/verify', requireAuth, (req, res) => {
  res.json({ ok: true });
});

// --- CONFIG ---

router.get('/config', requireAuth, async (req, res) => {
  try {
    const config = await getFullConfig();
    res.json(config);
  } catch (err) {
    console.error('[Dashboard] Error leyendo config:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/config/prompt', requireAuth, async (req, res) => {
  try {
    const { prompt } = req.body || {};
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'Campo "prompt" requerido' });
    }
    await updateSystemPrompt(prompt.trim());
    invalidatePromptCache();
    res.json({ ok: true });
  } catch (err) {
    console.error('[Dashboard] Error guardando prompt:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/config/business', requireAuth, async (req, res) => {
  try {
    const { store_name, delivery_sdq, delivery_sti, delivery_interior } = req.body || {};
    await updateBusinessInfo({ store_name, delivery_sdq, delivery_sti, delivery_interior });
    res.json({ ok: true });
  } catch (err) {
    console.error('[Dashboard] Error guardando business info:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/config/faq', requireAuth, async (req, res) => {
  try {
    const { pregunta, respuesta } = req.body || {};
    if (!pregunta || !respuesta) {
      return res.status(400).json({ error: 'Campos "pregunta" y "respuesta" requeridos' });
    }
    await upsertFaq(pregunta.trim(), respuesta.trim());
    invalidatePromptCache();
    res.json({ ok: true });
  } catch (err) {
    console.error('[Dashboard] Error guardando FAQ:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/config/faq', requireAuth, async (req, res) => {
  try {
    const { pregunta } = req.body || {};
    if (!pregunta) {
      return res.status(400).json({ error: 'Campo "pregunta" requerido' });
    }
    await deleteFaq(pregunta.trim());
    invalidatePromptCache();
    res.json({ ok: true });
  } catch (err) {
    console.error('[Dashboard] Error eliminando FAQ:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- CONVERSACIONES ---

router.get('/conversaciones', requireAuth, async (req, res) => {
  try {
    const conversaciones = await getAllConversaciones();
    res.json(conversaciones);
  } catch (err) {
    console.error('[Dashboard] Error leyendo conversaciones:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/pedidos', requireAuth, async (req, res) => {
  try {
    const fecha = req.query.date || new Date().toISOString().slice(0, 10);
    const pedidos = await getPedidosDelDia(fecha);
    res.json(pedidos);
  } catch (err) {
    console.error('[Dashboard] Error leyendo pedidos:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/bot/pausar', requireAuth, async (req, res) => {
  try {
    const { numero_whatsapp } = req.body || {};
    if (!numero_whatsapp) {
      return res.status(400).json({ error: 'Campo "numero_whatsapp" requerido' });
    }
    await pausarBot(numero_whatsapp);
    res.json({ ok: true });
  } catch (err) {
    console.error('[Dashboard] Error pausando bot:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/bot/activar', requireAuth, async (req, res) => {
  try {
    const { numero_whatsapp } = req.body || {};
    if (!numero_whatsapp) {
      return res.status(400).json({ error: 'Campo "numero_whatsapp" requerido' });
    }
    await activarBot(numero_whatsapp);
    res.json({ ok: true });
  } catch (err) {
    console.error('[Dashboard] Error activando bot:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- STATUS ---

router.get('/status', requireAuth, (req, res) => {
  res.json(getConnectionState());
});

// --- CHAT POR CONVERSACIÓN ---

router.get('/conversacion/:telefono/log', requireAuth, async (req, res) => {
  try {
    const log = await getLogPorTelefono(req.params.telefono);
    res.json(log);
  } catch (err) {
    console.error('[Dashboard] Error leyendo log:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/conversacion/:telefono/mensaje', requireAuth, async (req, res) => {
  const { telefono } = req.params;
  const { mensaje, nombre } = req.body || {};
  if (!mensaje) return res.status(400).json({ error: 'Campo "mensaje" requerido' });

  try {
    await sendTextMessage(telefono, mensaje);
  } catch (err) {
    console.error('[Dashboard] Error enviando mensaje via Baileys:', err.message);
    return res.status(500).json({ error: `WhatsApp error: ${err.message}` });
  }

  // Responder inmediatamente — el envío ya fue exitoso
  res.json({ ok: true });

  // Logging a Sheets en background (no bloquea la respuesta)
  registrarLog({
    numero_whatsapp: telefono,
    nombre_cliente: nombre || 'Manual',
    accion: 'MSG_MANUAL_ENVIADO',
    detalle: mensaje,
    estado_resultante: 'enviado',
  }).catch(e => console.error('[Dashboard] Error logueando mensaje manual:', e.message));

  actualizarConversacion(telefono, { ultimo_enviado: mensaje })
    .catch(e => console.error('[Dashboard] Error actualizando conv:', e.message));
});

module.exports = router;
