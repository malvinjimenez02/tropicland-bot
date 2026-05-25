// Corre este script UNA SOLA VEZ después de configurar config/sheets-credentials.json
// Uso: node scripts/setup-sheets.js

require('dotenv').config();
const { google } = require('googleapis');
const path = require('path');

const SHEET_ID = process.env.GOOGLE_SHEET_ID || '1vlg5KBJ5WZruVDV_RXqPzyhj5gXnjRxIzhTGVkKONtg';

const SHEETS_CONFIG = [
  {
    name: 'Pedidos',
    headers: ['#Pedido', 'Nombre', 'Teléfono/WA', 'Producto', 'Monto', 'Ciudad', 'Dirección', 'Estado', 'Intentos Bot', 'Último Contacto', 'Notas'],
  },
  {
    name: 'Conversaciones',
    headers: ['Teléfono/WA', 'Nombre', '#Pedido Ref.', 'Estado Bot', 'Intentos', 'Último Msg Enviado', 'Último Msg Recibido', 'Fecha Inicio'],
  },
  {
    name: 'Log Diario',
    headers: ['Fecha y Hora', 'Nombre', 'Teléfono/WA', 'Acción', 'Detalle', 'Estado Resultante'],
  },
  {
    name: 'Dashboard',
    headers: [],
  },
  {
    name: 'Seguimientos',
    headers: ['Teléfono/WA', 'Nombre', '#Pedido', 'Intento #', 'Enviar A Las', '¿Enviado?', 'Resultado'],
  },
];

async function getAuth() {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
    return new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
  }
  return new google.auth.GoogleAuth({
    keyFile: path.join(__dirname, '../config/sheets-credentials.json'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

async function main() {
  console.log('Conectando con Google Sheets...');
  const auth = await getAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  // 1. Obtener pestañas existentes
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const existing = meta.data.sheets.map(s => s.properties.title);
  console.log('Pestañas existentes:', existing);

  // 2. Renombrar la pestaña por defecto "Sheet1" si existe
  const defaultSheet = meta.data.sheets.find(
    s => s.properties.title === 'Sheet1' || s.properties.title === 'Hoja 1' || s.properties.index === 0
  );

  const requests = [];

  // Renombrar la primera pestaña al primer nombre de SHEETS_CONFIG
  if (defaultSheet && !existing.includes(SHEETS_CONFIG[0].name)) {
    requests.push({
      updateSheetProperties: {
        properties: { sheetId: defaultSheet.properties.sheetId, title: SHEETS_CONFIG[0].name },
        fields: 'title',
      },
    });
    console.log(`Renombrando "${defaultSheet.properties.title}" → "${SHEETS_CONFIG[0].name}"`);
  }

  // Crear las pestañas que faltan (saltando la primera si fue renombrada)
  for (let i = 1; i < SHEETS_CONFIG.length; i++) {
    if (!existing.includes(SHEETS_CONFIG[i].name)) {
      requests.push({ addSheet: { properties: { title: SHEETS_CONFIG[i].name } } });
      console.log(`Creando pestaña: ${SHEETS_CONFIG[i].name}`);
    } else {
      console.log(`Pestaña ya existe: ${SHEETS_CONFIG[i].name}`);
    }
  }

  if (requests.length > 0) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { requests } });
    console.log('Pestañas creadas/renombradas correctamente.');
  }

  // 3. Escribir headers en cada pestaña
  console.log('\nEscribiendo headers...');
  for (const cfg of SHEETS_CONFIG) {
    if (!cfg.headers.length) {
      console.log(`  Dashboard: sin headers (fórmulas manuales)`);
      continue;
    }
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${cfg.name}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [cfg.headers] },
    });
    console.log(`  ✓ ${cfg.name}: ${cfg.headers.length} columnas`);
  }

  console.log('\n✅ Setup completo. Sheet listo para usar.');
  console.log(`   URL: https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`);
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  if (err.message.includes('DECODER')) {
    console.error('   → Verifica que GOOGLE_PRIVATE_KEY en .env tenga el formato correcto.');
  }
  if (err.message.includes('invalid_grant') || err.message.includes('unauthorized')) {
    console.error('   → Asegúrate de compartir el Sheet con el email de la Service Account.');
  }
  process.exit(1);
});
