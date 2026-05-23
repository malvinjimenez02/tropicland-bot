const { google } = require('googleapis');
const path = require('path');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;

const SHEETS = {
  PEDIDOS: 'Pedidos',
  CONVERSACIONES: 'Conversaciones',
  LOG: 'Log Diario',
  SEGUIMIENTOS: 'Seguimientos',
};

// Columnas de cada hoja (índice base 0)
const COL = {
  PEDIDOS: { ID: 0, NOMBRE: 1, TELEFONO: 2, PRODUCTO: 3, MONTO: 4, CIUDAD: 5, DIRECCION: 6, ESTADO: 7, INTENTOS: 8, ULTIMO_CONTACTO: 9, NOTAS: 10 },
  CONVERSACIONES: { TELEFONO: 0, NOMBRE: 1, PEDIDO_REF: 2, ESTADO_BOT: 3, INTENTOS: 4, ULTIMO_ENV: 5, ULTIMO_REC: 6, FECHA_INICIO: 7 },
  LOG: { FECHA_HORA: 0, NOMBRE: 1, TELEFONO: 2, ACCION: 3, DETALLE: 4, ESTADO: 5 },
  SEGUIMIENTOS: { TELEFONO: 0, NOMBRE: 1, PEDIDO: 2, INTENTO: 3, ENVIAR_AT: 4, ENVIADO: 5, RESULTADO: 6 },
};

let sheetsClient = null;

async function getSheetsClient() {
  if (sheetsClient) return sheetsClient;

  let auth;
  if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
    auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
  } else {
    const credPath = path.join(__dirname, '../config/sheets-credentials.json');
    auth = new google.auth.GoogleAuth({
      keyFile: credPath,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
  }

  sheetsClient = google.sheets({ version: 'v4', auth });
  return sheetsClient;
}

async function withRetry(fn, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === retries - 1) throw err;
      console.error(`Reintento ${i + 1}/${retries} en Sheets:`, err.message);
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

async function readSheet(sheetName, range) {
  const sheets = await getSheetsClient();
  return withRetry(async () => {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${sheetName}!${range}`,
    });
    return res.data.values || [];
  });
}

async function appendRow(sheetName, values) {
  const sheets = await getSheetsClient();
  return withRetry(() =>
    sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${sheetName}!A1`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [values] },
    })
  );
}

async function updateCell(sheetName, rowIndex, colIndex, value) {
  const sheets = await getSheetsClient();
  const col = String.fromCharCode(65 + colIndex);
  const row = rowIndex + 2; // +1 header, +1 base 0→1
  return withRetry(() =>
    sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${sheetName}!${col}${row}`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [[value]] },
    })
  );
}

// --- PEDIDOS ---

async function crearPedido({ numero_whatsapp, nombre, producto, monto, ciudad, zona, direccion }) {
  const rows = await readSheet(SHEETS.PEDIDOS, 'A:A');
  const nextId = `#${String(rows.length).padStart(3, '0')}`;
  const now = new Date().toISOString();
  await appendRow(SHEETS.PEDIDOS, [nextId, nombre, numero_whatsapp, producto, monto, zona, direccion, 'pendiente', 0, now, '']);
  return nextId;
}

async function buscarPedidoPorTelefono(numero_whatsapp) {
  const rows = await readSheet(SHEETS.PEDIDOS, 'A:K');
  // Retorna el más reciente (última fila que coincide)
  let found = null;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][COL.PEDIDOS.TELEFONO] === numero_whatsapp) {
      found = { rowIndex: i, data: rows[i] };
    }
  }
  return found;
}

async function actualizarEstadoPedido(numero_whatsapp, nuevo_estado, motivo = '') {
  const pedido = await buscarPedidoPorTelefono(numero_whatsapp);
  if (!pedido) {
    console.error(`Pedido no encontrado para ${numero_whatsapp}`);
    return;
  }
  await updateCell(SHEETS.PEDIDOS, pedido.rowIndex, COL.PEDIDOS.ESTADO, nuevo_estado);
  await updateCell(SHEETS.PEDIDOS, pedido.rowIndex, COL.PEDIDOS.ULTIMO_CONTACTO, new Date().toISOString());
  if (motivo) {
    const notasActuales = pedido.data[COL.PEDIDOS.NOTAS] || '';
    await updateCell(SHEETS.PEDIDOS, pedido.rowIndex, COL.PEDIDOS.NOTAS, `${notasActuales} | ${motivo}`.trim());
  }
}

// --- CONVERSACIONES ---

async function buscarConversacion(numero_whatsapp) {
  const rows = await readSheet(SHEETS.CONVERSACIONES, 'A:H');
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][COL.CONVERSACIONES.TELEFONO] === numero_whatsapp) {
      return { rowIndex: i, data: rows[i] };
    }
  }
  return null;
}

async function crearConversacion({ numero_whatsapp, nombre, pedido_ref }) {
  await appendRow(SHEETS.CONVERSACIONES, [
    numero_whatsapp, nombre, pedido_ref, 'activo', 0, '', '', new Date().toISOString(),
  ]);
}

async function actualizarConversacion(numero_whatsapp, { estado_bot, ultimo_enviado, ultimo_recibido, incrementar_intentos }) {
  const conv = await buscarConversacion(numero_whatsapp);
  if (!conv) return;
  const { rowIndex, data } = conv;

  if (estado_bot) await updateCell(SHEETS.CONVERSACIONES, rowIndex, COL.CONVERSACIONES.ESTADO_BOT, estado_bot);
  if (ultimo_enviado) await updateCell(SHEETS.CONVERSACIONES, rowIndex, COL.CONVERSACIONES.ULTIMO_ENV, ultimo_enviado);
  if (ultimo_recibido) await updateCell(SHEETS.CONVERSACIONES, rowIndex, COL.CONVERSACIONES.ULTIMO_REC, ultimo_recibido);
  if (incrementar_intentos) {
    const intentos = parseInt(data[COL.CONVERSACIONES.INTENTOS] || '0') + 1;
    await updateCell(SHEETS.CONVERSACIONES, rowIndex, COL.CONVERSACIONES.INTENTOS, intentos);
  }
}

async function isBotPausado(numero_whatsapp) {
  const conv = await buscarConversacion(numero_whatsapp);
  if (!conv) return false;
  return conv.data[COL.CONVERSACIONES.ESTADO_BOT] === 'pausado';
}

async function pausarBot(numero_whatsapp) {
  await actualizarConversacion(numero_whatsapp, { estado_bot: 'pausado' });
}

// --- LOG DIARIO ---

async function registrarLog({ numero_whatsapp, nombre_cliente, accion, detalle, estado_resultante = '' }) {
  await appendRow(SHEETS.LOG, [
    new Date().toISOString(), nombre_cliente, numero_whatsapp, accion, detalle, estado_resultante,
  ]);
}

// --- SEGUIMIENTOS ---

async function programarSeguimiento({ numero_whatsapp, nombre_cliente, pedido_ref, intento_numero, enviar_en_horas }) {
  const enviarAt = new Date(Date.now() + enviar_en_horas * 60 * 60 * 1000).toISOString();
  await appendRow(SHEETS.SEGUIMIENTOS, [
    numero_whatsapp, nombre_cliente, pedido_ref, intento_numero, enviarAt, 'No', '',
  ]);
}

async function cancelarSeguimientos(numero_whatsapp) {
  const rows = await readSheet(SHEETS.SEGUIMIENTOS, 'A:G');
  const sheets = await getSheetsClient();
  const updates = [];

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][COL.SEGUIMIENTOS.TELEFONO] === numero_whatsapp && rows[i][COL.SEGUIMIENTOS.ENVIADO] === 'No') {
      const col = String.fromCharCode(65 + COL.SEGUIMIENTOS.ENVIADO);
      updates.push({
        range: `${SHEETS.SEGUIMIENTOS}!${col}${i + 1}`,
        values: [['Cancelado']],
      });
    }
  }

  if (updates.length > 0) {
    await withRetry(() =>
      sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SHEET_ID,
        resource: { valueInputOption: 'USER_ENTERED', data: updates },
      })
    );
  }
}

async function getSeguimientosPendientes() {
  const rows = await readSheet(SHEETS.SEGUIMIENTOS, 'A:G');
  const now = new Date();
  const pendientes = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row[COL.SEGUIMIENTOS.ENVIADO] !== 'No') continue;
    const enviarAt = new Date(row[COL.SEGUIMIENTOS.ENVIAR_AT]);
    if (enviarAt <= now) {
      pendientes.push({
        rowIndex: i,
        numero_whatsapp: row[COL.SEGUIMIENTOS.TELEFONO],
        nombre_cliente: row[COL.SEGUIMIENTOS.NOMBRE],
        pedido_ref: row[COL.SEGUIMIENTOS.PEDIDO],
        intento_numero: parseInt(row[COL.SEGUIMIENTOS.INTENTO]),
      });
    }
  }
  return pendientes;
}

async function marcarSeguimientoEnviado(rowIndex, resultado) {
  await updateCell(SHEETS.SEGUIMIENTOS, rowIndex, COL.SEGUIMIENTOS.ENVIADO, 'Sí');
  await updateCell(SHEETS.SEGUIMIENTOS, rowIndex, COL.SEGUIMIENTOS.RESULTADO, resultado);
}

// --- LOG DIARIO PARA RESUMEN ---

async function getLogDelDia(fecha) {
  const rows = await readSheet(SHEETS.LOG, 'A:F');
  return rows.slice(1).filter(row => row[0] && row[0].startsWith(fecha));
}

async function getPedidosDelDia(fecha) {
  const rows = await readSheet(SHEETS.PEDIDOS, 'A:K');
  return rows.slice(1).filter(row => row[COL.PEDIDOS.ULTIMO_CONTACTO] && row[COL.PEDIDOS.ULTIMO_CONTACTO].startsWith(fecha));
}

module.exports = {
  crearPedido,
  buscarPedidoPorTelefono,
  actualizarEstadoPedido,
  crearConversacion,
  buscarConversacion,
  actualizarConversacion,
  isBotPausado,
  pausarBot,
  registrarLog,
  programarSeguimiento,
  cancelarSeguimientos,
  getSeguimientosPendientes,
  marcarSeguimientoEnviado,
  getLogDelDia,
  getPedidosDelDia,
};
