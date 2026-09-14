import ExcelJS from 'exceljs';
import type { BotAnalyticsData } from '../db/repository';

export type AnalyticsExcelDataset = 'activity' | 'contacts';

const HEADER_FILL = '087F69';
const HEADER_TEXT = 'FFFFFF';
const TEXT = '111C19';
const MUTED = '6C827B';
const LINE = 'DBE5E1';
const SUMMARY_FILL = 'EDF3F1';

function dateOnly(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) throw new Error(`Fecha de analíticas inválida: ${value}`);
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'America/Argentina/Cordoba',
  }).format(new Date(value));
}

function configureSheet(sheet: ExcelJS.Worksheet, title: string, subtitle: string, widths: number[]) {
  sheet.properties.defaultRowHeight = 20;
  sheet.views = [{ state: 'frozen', ySplit: 4, showGridLines: false }];
  sheet.getCell('A1').value = title;
  sheet.getCell('A1').font = { name: 'Arial', size: 16, bold: true, color: { argb: TEXT } };
  sheet.getCell('A2').value = subtitle;
  sheet.getCell('A2').font = { name: 'Arial', size: 10, italic: true, color: { argb: MUTED } };
  sheet.getRow(3).height = 8;
  widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
}

function styleHeader(row: ExcelJS.Row) {
  row.height = 24;
  row.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: HEADER_TEXT } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = { bottom: { style: 'thin', color: { argb: LINE } } };
  });
}

function styleBody(sheet: ExcelJS.Worksheet, firstRow: number, lastRow: number, columnCount: number) {
  if (lastRow < firstRow) return;
  for (let rowIndex = firstRow; rowIndex <= lastRow; rowIndex += 1) {
    const row = sheet.getRow(rowIndex);
    row.eachCell({ includeEmpty: true }, (cell, columnIndex) => {
      cell.font = { name: 'Arial', size: 10, color: { argb: TEXT } };
      cell.alignment = { vertical: 'middle', horizontal: columnIndex === 1 ? 'left' : 'right' };
      cell.border = { bottom: { style: 'hair', color: { argb: LINE } } };
    });
    for (let columnIndex = 1; columnIndex <= columnCount; columnIndex += 1) {
      row.getCell(columnIndex).border = { bottom: { style: 'hair', color: { argb: LINE } } };
    }
  }
  sheet.getColumn(1).numFmt = 'dd/mm/yyyy';
  for (let columnIndex = 2; columnIndex <= columnCount; columnIndex += 1) {
    sheet.getColumn(columnIndex).numFmt = '#,##0';
  }
}

function addSummaryRows(sheet: ExcelJS.Worksheet, firstDataRow: number, lastDataRow: number, totals: number[]) {
  if (lastDataRow < firstDataRow) return;
  const totalRow = sheet.addRow(['Total']);
  const averageRow = sheet.addRow(['Promedio diario']);
  totals.forEach((total, index) => {
    const columnNumber = index + 2;
    const columnLetter = sheet.getColumn(columnNumber).letter;
    totalRow.getCell(columnNumber).value = {
      formula: `SUM(${columnLetter}${firstDataRow}:${columnLetter}${lastDataRow})`,
      result: total,
    };
    averageRow.getCell(columnNumber).value = {
      formula: `AVERAGE(${columnLetter}${firstDataRow}:${columnLetter}${lastDataRow})`,
      result: total / (lastDataRow - firstDataRow + 1),
    };
  });
  [totalRow, averageRow].forEach(row => {
    row.eachCell({ includeEmpty: true }, cell => {
      cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: TEXT } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SUMMARY_FILL } };
      cell.border = { top: { style: 'thin', color: { argb: LINE } } };
    });
  });
  averageRow.eachCell((cell, columnIndex) => {
    if (columnIndex > 1) cell.numFmt = '#,##0.0';
  });
}

function buildActivitySheet(workbook: ExcelJS.Workbook, data: BotAnalyticsData) {
  const sheet = workbook.addWorksheet('Actividad diaria');
  configureSheet(
    sheet,
    'Actividad diaria del bot',
    `Período: ${dateLabel(data.period.from)} al ${dateLabel(data.period.to)}`,
    [15, 21, 20, 20, 18, 19],
  );
  styleHeader(sheet.addRow(['Fecha', 'Mensajes entrantes', 'Menú solicitado', 'Opciones elegidas', 'No entendidos', 'Contactos únicos']));
  const rows = [...data.trend].sort((left, right) => right.date.localeCompare(left.date));
  rows.forEach(point => sheet.addRow([
    dateOnly(point.date),
    point.incomingMessages,
    point.menuRequested,
    point.optionsRecognized,
    point.unrecognized,
    point.uniqueContacts,
  ]));
  const firstDataRow = 5;
  const lastDataRow = firstDataRow + rows.length - 1;
  styleBody(sheet, firstDataRow, lastDataRow, 6);
  if (rows.length > 0) {
    sheet.autoFilter = { from: 'A4', to: `F${lastDataRow}` };
    addSummaryRows(sheet, firstDataRow, lastDataRow, [
      rows.reduce((sum, point) => sum + point.incomingMessages, 0),
      rows.reduce((sum, point) => sum + point.menuRequested, 0),
      rows.reduce((sum, point) => sum + point.optionsRecognized, 0),
      rows.reduce((sum, point) => sum + point.unrecognized, 0),
      rows.reduce((sum, point) => sum + point.uniqueContacts, 0),
    ]);
  } else {
    sheet.addRow(['Sin datos para el período seleccionado.']);
  }
}

function buildContactsSheet(workbook: ExcelJS.Workbook, data: BotAnalyticsData) {
  const sheet = workbook.addWorksheet('Contactos diarios');
  configureSheet(
    sheet,
    'Contactos nuevos y recurrentes por día',
    `Período: ${dateLabel(data.period.from)} al ${dateLabel(data.period.to)}`,
    [15, 20, 24],
  );
  styleHeader(sheet.addRow(['Fecha', 'Contactos nuevos', 'Contactos recurrentes']));
  const returningByDate = new Map(data.returningContactsByDay.map(point => [point.date, point.returningContacts]));
  const rows = data.newContactsByDay.map(point => ({
    date: point.date,
    newContacts: point.newContacts,
    returningContacts: returningByDate.get(point.date) ?? 0,
  })).sort((left, right) => left.date.localeCompare(right.date));
  rows.forEach(point => sheet.addRow([dateOnly(point.date), point.newContacts, point.returningContacts]));
  const firstDataRow = 5;
  const lastDataRow = firstDataRow + rows.length - 1;
  styleBody(sheet, firstDataRow, lastDataRow, 3);
  if (rows.length > 0) {
    sheet.autoFilter = { from: 'A4', to: `C${lastDataRow}` };
    addSummaryRows(sheet, firstDataRow, lastDataRow, [
      rows.reduce((sum, point) => sum + point.newContacts, 0),
      rows.reduce((sum, point) => sum + point.returningContacts, 0),
    ]);
  } else {
    sheet.addRow(['Sin datos para el período seleccionado.']);
  }
}

export async function buildAnalyticsExcel(data: BotAnalyticsData, dataset: AnalyticsExcelDataset): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'AbastoBot';
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;
  if (dataset === 'activity') buildActivitySheet(workbook, data);
  else buildContactsSheet(workbook, data);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export function analyticsExcelFilename(dataset: AnalyticsExcelDataset, from: string, to: string) {
  const prefix = dataset === 'activity' ? 'actividad-diaria' : 'contactos-diarios';
  return `${prefix}-${from}-${to}.xlsx`;
}
