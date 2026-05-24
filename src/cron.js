const cron = require('node-cron');
const { getSeguimientosPendientes, marcarSeguimientoEnviado, isBotPausado, registrarLog, programarSeguimiento, pausarBot } = require('./sheets');
const { sendTextMessage } = require('./whatsapp');
const { callOpenAI } = require('./openai');
const { executeTool } = require('./tools');

const storeName = process.env.STORE_NAME || 'la tienda';
const ownerNumber = process.env.OWNER_WHATSAPP_NUMBER;

// Seguimientos pendientes de escalamiento (intento #2 enviado, esperando 1h para escalar)
const pendingEscalation = {};

async function procesarSeguimientos() {
  console.log('[Cron] Procesando seguimientos pendientes...');
  try {
    const pendientes = await getSeguimientosPendientes();
    console.log(`[Cron] ${pendientes.length} seguimientos listos para enviar`);

    for (const seg of pendientes) {
      const { rowIndex, numero_whatsapp, nombre_cliente, pedido_ref, intento_numero } = seg;

      // Verificar que el bot no esté pausado
      const pausado = await isBotPausado(numero_whatsapp);
      if (pausado) {
        await marcarSeguimientoEnviado(rowIndex, 'Omitido - bot pausado');
        continue;
      }

      let mensaje;
      if (intento_numero === 1) {
        mensaje = `Hola ${nombre_cliente} 👋 Te escribimos nuevamente sobre tu pedido de ${storeName}. ¿Pudiste ver nuestro mensaje? ¿A qué hora te quedaría bien recibir? 📦`;

        await sendTextMessage(numero_whatsapp, mensaje);
        await marcarSeguimientoEnviado(rowIndex, 'Enviado');
        await registrarLog({
          numero_whatsapp,
          nombre_cliente,
          accion: 'reintento',
          detalle: 'Intento #1 enviado',
        });

        // Programar intento #2 en 3 horas
        await programarSeguimiento({
          numero_whatsapp,
          nombre_cliente,
          pedido_ref,
          intento_numero: 2,
          enviar_en_horas: 3,
        });

      } else if (intento_numero === 2) {
        mensaje = `Hola ${nombre_cliente}, este es nuestro último intento de contacto sobre tu pedido ${pedido_ref}. Si deseas continuar con tu compra, por favor respóndenos. De lo contrario, cancelaremos el pedido automáticamente.`;

        await sendTextMessage(numero_whatsapp, mensaje);
        await marcarSeguimientoEnviado(rowIndex, 'Enviado');
        await registrarLog({
          numero_whatsapp,
          nombre_cliente,
          accion: 'reintento',
          detalle: 'Intento #2 (último) enviado',
        });

        // Programar escalamiento en 1 hora
        pendingEscalation[numero_whatsapp] = {
          nombre_cliente,
          pedido_ref,
          escaladoAt: Date.now() + 60 * 60 * 1000,
        };
      }
    }
  } catch (err) {
    console.error('[Cron] Error en procesarSeguimientos:', err.message);
  }
}

async function procesarEscalamientosPendientes() {
  const now = Date.now();
  for (const [numero_whatsapp, data] of Object.entries(pendingEscalation)) {
    if (now >= data.escaladoAt) {
      console.log(`[Cron] Escalando ${numero_whatsapp} al dueño...`);
      delete pendingEscalation[numero_whatsapp];

      const pausado = await isBotPausado(numero_whatsapp);
      if (pausado) continue; // Ya fue gestionado manualmente

      await pausarBot(numero_whatsapp);
      await registrarLog({
        numero_whatsapp,
        nombre_cliente: data.nombre_cliente,
        accion: 'escalado',
        detalle: 'Sin respuesta tras 2 intentos',
        estado_resultante: 'problema',
      });

      if (ownerNumber) {
        const msg = `⚠️ *Escalamiento requerido*\n\nCliente: ${data.nombre_cliente}\nNúmero: ${numero_whatsapp}\nPedido: ${data.pedido_ref}\nMotivo: Sin respuesta tras 2 intentos de contacto\n\nEl bot ha sido PAUSADO.\nResponde directamente al cliente desde tu WhatsApp.`;
        try {
          await sendTextMessage(ownerNumber, msg);
        } catch (err) {
          console.error('[Cron] Error enviando escalamiento:', err.message);
        }
      }
    }
  }
}

async function enviarResumenDiario() {
  console.log('[Cron] Generando resumen diario...');
  if (!ownerNumber) {
    console.warn('[Cron] OWNER_WHATSAPP_NUMBER no configurado, omitiendo resumen');
    return;
  }

  try {
    const hoy = new Date().toISOString().split('T')[0];

    // Usar OpenAI para generar el resumen
    const toolCallResult = await executeTool('generar_resumen_diario', { fecha: hoy }, null);
    const { stats, fecha } = toolCallResult;

    const fechaFormateada = new Date(fecha + 'T12:00:00').toLocaleDateString('es-DO', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });

    const resumen = `📦 *Resumen del día — ${fechaFormateada}*

✅ Pedidos confirmados: ${stats.confirmados}
📦 Empacados: ${stats.empacados}
🚚 En camino: ${stats.en_camino}
✅ Entregados: ${stats.entregados}

⚠️ Problemas activos: ${stats.problemas}
🕐 Pendientes sin confirmar: ${stats.pendientes}

📊 Total pedidos del día: ${stats.total}

_Bot WhatsApp ${storeName}_`;

    await sendTextMessage(ownerNumber, resumen);
    console.log('[Cron] Resumen diario enviado al dueño');
  } catch (err) {
    console.error('[Cron] Error generando resumen diario:', err.message);
  }
}

function startCronJobs() {
  // Cada 30 minutos: procesar seguimientos pendientes
  cron.schedule('*/30 * * * *', async () => {
    await procesarSeguimientos();
    await procesarEscalamientosPendientes();
  });

  // Cada hora: verificar escalamientos pendientes (por si el cron de 30min los perdió)
  cron.schedule('0 * * * *', procesarEscalamientosPendientes);

  // Todos los días a las 9pm hora RD (UTC-4 = 01:00 UTC del día siguiente)
  cron.schedule('0 1 * * *', enviarResumenDiario, {
    timezone: 'America/Santo_Domingo',
  });

  console.log('Cron jobs iniciados: seguimientos (c/30min) + resumen diario (9pm RD)');
}

module.exports = { startCronJobs, procesarSeguimientos, enviarResumenDiario };
