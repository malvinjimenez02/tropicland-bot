const sheets = require('./sheets');
const { sendTextMessage } = require('./meta');

const storeName = process.env.STORE_NAME || 'la tienda';
const ownerNumber = process.env.OWNER_WHATSAPP_NUMBER;

// Mapa en memoria: numero → pedido_ref (para la sesión actual)
const pedidoRefCache = {};

async function executeTool(toolName, args, numero_whatsapp) {
  console.log(`Tool: ${toolName}`, JSON.stringify(args));

  switch (toolName) {
    case 'parsear_pedido': {
      // Crear pedido en Sheets
      const pedidoId = await sheets.crearPedido({
        numero_whatsapp,
        nombre: args.nombre,
        producto: args.producto,
        monto: args.monto,
        ciudad: args.ciudad_raw || args.zona,
        zona: args.zona,
        direccion: args.direccion,
      });

      // Crear/actualizar conversación
      const convExiste = await sheets.buscarConversacion(numero_whatsapp);
      if (!convExiste) {
        await sheets.crearConversacion({ numero_whatsapp, nombre: args.nombre, pedido_ref: pedidoId });
      }

      pedidoRefCache[numero_whatsapp] = pedidoId;

      return {
        success: true,
        pedido_id: pedidoId,
        ...args,
      };
    }

    case 'actualizar_estado_pedido': {
      await sheets.actualizarEstadoPedido(args.numero_whatsapp, args.nuevo_estado, args.motivo);
      return { success: true };
    }

    case 'registrar_log': {
      await sheets.registrarLog({
        numero_whatsapp: args.numero_whatsapp,
        nombre_cliente: args.nombre_cliente,
        accion: args.accion,
        detalle: args.detalle,
        estado_resultante: args.nuevo_estado || '',
      });
      return { success: true };
    }

    case 'programar_seguimiento': {
      await sheets.programarSeguimiento({
        numero_whatsapp: args.numero_whatsapp,
        nombre_cliente: args.nombre_cliente,
        pedido_ref: args.pedido_ref,
        intento_numero: args.intento_numero,
        enviar_en_horas: args.enviar_en_horas,
      });
      return { success: true };
    }

    case 'cancelar_seguimientos': {
      await sheets.cancelarSeguimientos(args.numero_whatsapp);
      return { success: true };
    }

    case 'escalar_a_dueno': {
      await sheets.pausarBot(args.numero_whatsapp);
      await sheets.registrarLog({
        numero_whatsapp: args.numero_whatsapp,
        nombre_cliente: args.nombre_cliente,
        accion: 'escalado',
        detalle: `Motivo: ${args.motivo}`,
        estado_resultante: 'escalado',
      });

      if (ownerNumber) {
        const msg = `⚠️ *Escalamiento requerido*\n\nCliente: ${args.nombre_cliente}\nNúmero: ${args.numero_whatsapp}\nPedido: ${args.pedido_ref || 'N/A'}\nMotivo: ${args.motivo}\n${args.resumen_conversacion ? `\nResumen: ${args.resumen_conversacion}` : ''}\n\nEl bot ha sido PAUSADO para este número.\nResponde directamente al cliente desde tu WhatsApp.`;

        try {
          await sendTextMessage(ownerNumber, msg);
        } catch (err) {
          console.error('Error enviando escalamiento al dueño:', err.message);
        }
      }

      return { success: true };
    }

    case 'pausar_bot': {
      await sheets.pausarBot(args.numero_whatsapp);
      return { success: true };
    }

    case 'generar_resumen_diario': {
      const fecha = args.fecha;
      const logs = await sheets.getLogDelDia(fecha);
      const pedidos = await sheets.getPedidosDelDia(fecha);

      const stats = {
        total: pedidos.length,
        confirmados: pedidos.filter(p => p[7] === 'confirmado').length,
        empacados: pedidos.filter(p => p[7] === 'empacado').length,
        en_camino: pedidos.filter(p => p[7] === 'en_camino').length,
        entregados: pedidos.filter(p => p[7] === 'entregado').length,
        problemas: pedidos.filter(p => p[7] === 'problema').length,
        pendientes: pedidos.filter(p => p[7] === 'pendiente').length,
      };

      return { fecha, stats, logs_count: logs.length, pedidos };
    }

    default:
      console.warn(`Tool desconocido: ${toolName}`);
      return { error: `Tool ${toolName} no implementado` };
  }
}

function getPedidoRef(numero_whatsapp) {
  return pedidoRefCache[numero_whatsapp] || 'N/A';
}

module.exports = { executeTool, getPedidoRef };
