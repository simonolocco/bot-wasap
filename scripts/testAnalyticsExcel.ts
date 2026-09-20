import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import type { BotAnalyticsData } from '../src/db/repository';
import { analyticsExcelFilename, buildAnalyticsExcel } from '../src/services/analyticsExcel';

const data: BotAnalyticsData = {
  period: { key: 'custom', from: '2026-08-19T03:00:00.000Z', to: '2026-08-21T23:59:59.999Z', label: 'Rango personalizado' },
  summary: {
    totalUniqueContacts: 45, totalNewContacts: 35, totalReturningContacts: 29,
    totalIncomingMessages: 75, totalMenuInteractions: 60, totalMenuOptionsRecognized: 55,
    totalUnrecognizedMessages: 9, totalOrdersStarted: 0, totalOrdersSubmitted: 0,
    totalAdvisorRequests: 0, contactsWithoutMenuCount: 0, contactsWithoutBotResponseCount: 0,
    menuOptionRate: 0, unrecognizedRate: 0,
  },
  menuOptions: [],
  trend: [
    { date: '2026-08-19', incomingMessages: 25, menuInteractions: 20, menuRequested: 2, optionsRecognized: 18, unrecognized: 3, uniqueContacts: 15 },
    { date: '2026-08-20', incomingMessages: 30, menuInteractions: 24, menuRequested: 2, optionsRecognized: 22, unrecognized: 4, uniqueContacts: 18 },
    { date: '2026-08-21', incomingMessages: 20, menuInteractions: 16, menuRequested: 1, optionsRecognized: 15, unrecognized: 2, uniqueContacts: 12 },
  ],
  newContactsByDay: [
    { date: '2026-08-19', newContacts: 12 },
    { date: '2026-08-20', newContacts: 15 },
    { date: '2026-08-21', newContacts: 8 },
  ],
  returningContactsByDay: [
    { date: '2026-08-19', returningContacts: 9 },
    { date: '2026-08-20', returningContacts: 11 },
    { date: '2026-08-21', returningContacts: 9 },
  ],
  unrecognizedMessages: { total: 0, uniqueContacts: 0, topPatterns: [], items: [] },
  contactsWithoutMenu: { total: 0, withoutBotResponse: 0, items: [] },
  coverage: { hasTrackingData: true, earliestEventAt: null, totalEventsTracked: 0, note: '' },
};

async function loadWorkbook(buffer: Buffer) {
  assert.equal(buffer.subarray(0, 2).toString(), 'PK', 'La descarga debe ser un archivo XLSX real.');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  return workbook;
}

async function main() {
  const activity = await loadWorkbook(await buildAnalyticsExcel(data, 'activity'));
  const activitySheet = activity.getWorksheet('Actividad diaria');
  assert.ok(activitySheet, 'El Excel de actividad debe incluir su hoja.');
  assert.equal(activitySheet.getCell('B4').value, 'Mensajes entrantes');
  assert.equal((activitySheet.getCell('A5').value as Date).toISOString().slice(0, 10), '2026-08-21', 'La actividad debe comenzar por el día más reciente.');
  assert.equal(activitySheet.getCell('B5').value, 20, 'Los valores deben conservarse como números.');
  assert.deepEqual(activitySheet.getCell('B8').value, { formula: 'SUM(B5:B7)', result: 75 });
  assert.deepEqual(activitySheet.getCell('B9').value, { formula: 'AVERAGE(B5:B7)', result: 25 });

  const contacts = await loadWorkbook(await buildAnalyticsExcel(data, 'contacts'));
  const contactsSheet = contacts.getWorksheet('Contactos diarios');
  assert.ok(contactsSheet, 'El Excel de contactos debe incluir su hoja.');
  assert.equal((contactsSheet.getCell('A5').value as Date).toISOString().slice(0, 10), '2026-08-19', 'Los contactos deben conservar el orden cronológico del gráfico.');
  assert.equal(contactsSheet.getCell('B5').value, 12);
  assert.deepEqual(contactsSheet.getCell('B8').value, { formula: 'SUM(B5:B7)', result: 35 });
  const average = contactsSheet.getCell('B9').value as ExcelJS.CellFormulaValue;
  assert.equal(average.formula, 'AVERAGE(B5:B7)');
  assert.ok(Math.abs(Number(average.result) - 35 / 3) < 0.00001, 'El promedio diario debe ser exacto.');
  assert.equal(contactsSheet.getCell('B9').numFmt, '#,##0.0');
  assert.equal(analyticsExcelFilename('contacts', '2026-08-19', '2026-08-21'), 'contactos-diarios-2026-08-19-2026-08-21.xlsx');
  console.log('analytics Excel tests: OK');
}

main().catch(error => { console.error(error); process.exit(1); });
