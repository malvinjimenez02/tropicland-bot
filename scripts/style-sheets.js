require('dotenv').config();
const { google } = require('googleapis');
const path = require('path');

const SHEET_ID = process.env.GOOGLE_SHEET_ID || '1vlg5KBJ5WZruVDV_RXqPzyhj5gXnjRxIzhTGVkKONtg';

const COLORS = {
  pedidos:       { red: 0.082, green: 0.396, blue: 0.753 }, // azul
  conversaciones:{ red: 0.180, green: 0.490, blue: 0.196 }, // verde
  logDiario:     { red: 0.902, green: 0.400, blue: 0.000 }, // naranja
  dashboard:     { red: 0.290, green: 0.078, blue: 0.549 }, // morado
  seguimientos:  { red: 0.000, green: 0.412, blue: 0.365 }, // teal
};

const WHITE = { red: 1, green: 1, blue: 1 };
const LIGHT_GRAY = { red: 0.957, green: 0.961, blue: 0.965 };

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

function headerFormat(sheetId, numCols, color) {
  return [
    // Fondo de color en fila 1
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: numCols },
        cell: {
          userEnteredFormat: {
            backgroundColor: color,
            textFormat: { foregroundColor: WHITE, bold: true, fontSize: 11 },
            horizontalAlignment: 'CENTER',
            verticalAlignment: 'MIDDLE',
            wrapStrategy: 'CLIP',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)',
      },
    },
    // Congelar fila 1
    {
      updateSheetProperties: {
        properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
        fields: 'gridProperties.frozenRowCount',
      },
    },
    // Altura de fila 1
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 },
        properties: { pixelSize: 40 },
        fields: 'pixelSize',
      },
    },
    // Banding (filas alternas) desde fila 2
    {
      addBanding: {
        bandedRange: {
          range: { sheetId, startRowIndex: 1, startColumnIndex: 0, endColumnIndex: numCols },
          rowProperties: {
            firstBandColor: WHITE,
            secondBandColor: LIGHT_GRAY,
          },
        },
      },
    },
    // Borde en toda la tabla
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: numCols },
        cell: {
          userEnteredFormat: {
            borders: {
              top:    { style: 'SOLID', color: { red: 0.8, green: 0.8, blue: 0.8 } },
              bottom: { style: 'SOLID', color: { red: 0.8, green: 0.8, blue: 0.8 } },
              left:   { style: 'SOLID', color: { red: 0.8, green: 0.8, blue: 0.8 } },
              right:  { style: 'SOLID', color: { red: 0.8, green: 0.8, blue: 0.8 } },
            },
          },
        },
        fields: 'userEnteredFormat.borders',
      },
    },
  ];
}

function setColumnWidths(sheetId, widths) {
  return widths.map((pixelSize, i) => ({
    updateDimensionProperties: {
      range: { sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
      properties: { pixelSize },
      fields: 'pixelSize',
    },
  }));
}

async function main() {
  console.log('Conectando con Google Sheets...');
  const auth = await getAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const sheetMap = {};
  for (const s of meta.data.sheets) {
    sheetMap[s.properties.title] = s.properties.sheetId;
  }
  console.log('Hojas encontradas:', Object.keys(sheetMap));

  const requests = [];

  // PEDIDOS
  if (sheetMap['Pedidos'] !== undefined) {
    requests.push(...headerFormat(sheetMap['Pedidos'], 11, COLORS.pedidos));
    requests.push(...setColumnWidths(sheetMap['Pedidos'], [80, 160, 140, 200, 90, 130, 220, 120, 100, 140, 180]));
  }

  // CONVERSACIONES
  if (sheetMap['Conversaciones'] !== undefined) {
    requests.push(...headerFormat(sheetMap['Conversaciones'], 8, COLORS.conversaciones));
    requests.push(...setColumnWidths(sheetMap['Conversaciones'], [140, 160, 100, 120, 80, 180, 180, 140]));
  }

  // LOG DIARIO
  if (sheetMap['Log Diario'] !== undefined) {
    requests.push(...headerFormat(sheetMap['Log Diario'], 6, COLORS.logDiario));
    requests.push(...setColumnWidths(sheetMap['Log Diario'], [160, 160, 140, 160, 260, 140]));
  }

  // DASHBOARD — solo color de fondo especial
  if (sheetMap['Dashboard'] !== undefined) {
    requests.push({
      repeatCell: {
        range: { sheetId: sheetMap['Dashboard'], startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 10 },
        cell: {
          userEnteredFormat: {
            backgroundColor: COLORS.dashboard,
            textFormat: { foregroundColor: WHITE, bold: true, fontSize: 14 },
            horizontalAlignment: 'CENTER',
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
      },
    });
  }

  // SEGUIMIENTOS
  if (sheetMap['Seguimientos'] !== undefined) {
    requests.push(...headerFormat(sheetMap['Seguimientos'], 7, COLORS.seguimientos));
    requests.push(...setColumnWidths(sheetMap['Seguimientos'], [140, 160, 90, 80, 140, 90, 180]));
  }

  console.log(`Aplicando ${requests.length} cambios de formato...`);
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: { requests },
  });

  console.log('✅ Estilización completa.');
  console.log(`   URL: https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`);
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
