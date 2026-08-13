import ExcelJS from 'exceljs';
import {
    getMercadoFrescosBranch,
    isMercadoFrescosLocal
} from '../receipts/recipientService.js';

/**
 * Generates an Excel workbook buffer containing Fecha Comprobante, Monto,
 * Entidad / Emisor, and Local.
 * @param {Array} receipts List of receipt objects
 * @param {Object} metadata { title, subtitle, dateRange }
 * @returns {Promise<Buffer>} Excel buffer
 */
export async function generateReceiptsExcel(receipts = [], metadata = {}) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'WhatsApp Invoice Bot System';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Comprobantes', {
        pageSetup: { paperSize: 9, orientation: 'portrait' }
    });

    // 1. Title Block (Columns A to D)
    sheet.mergeCells('A1:E1');
    const titleCell = sheet.getCell('A1');
    titleCell.value = 'REPORTE DE COMPROBANTES DE PAGO';
    titleCell.font = { name: 'Calibri', size: 15, bold: true, color: { argb: 'FFFFFFFF' } };
    titleCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF1E293B' } // Dark Slate
    };
    titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
    sheet.getRow(1).height = 35;

    // 2. Subtitle / Range Block (Columns A to D)
    sheet.mergeCells('A2:E2');
    const subtitleCell = sheet.getCell('A2');
    const rangeText = metadata.dateRange ? `Filtro de Fecha: ${metadata.dateRange}` : 'Todos los comprobantes';
    subtitleCell.value = `Generado el: ${new Date().toLocaleString()} | ${rangeText}`;
    subtitleCell.font = { name: 'Calibri', size: 10, italic: true, color: { argb: 'FF64748B' } };
    subtitleCell.alignment = { vertical: 'middle', horizontal: 'center' };
    sheet.getRow(2).height = 20;

    sheet.addRow([]); // Blank row 3

    // 3. Table Headers
    const headers = [
        { header: 'Fecha Extracción', key: 'fecha', width: 22 },
        { header: 'Fecha Comprobante', key: 'fecha_comprobante', width: 22 },
        { header: 'Monto ($)', key: 'monto', width: 22 },
        { header: 'Entidad / Emisor', key: 'emisor', width: 30 },
        { header: 'Local', key: 'local', width: 32 }
    ];

    const headerRow = sheet.addRow(headers.map(h => h.header));
    headerRow.height = 26;

    headerRow.eachCell((cell) => {
        cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF2563EB' } // Vibrant Royal Blue
        };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        cell.border = {
            top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            bottom: { style: 'medium', color: { argb: 'FF1D4ED8' } },
            left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
        };
    });

    // Set column widths
    headers.forEach((h, colIndex) => {
        sheet.getColumn(colIndex + 1).width = h.width;
    });

    // 4. Data Rows
    const startRowIndex = 5;
    receipts.forEach((item) => {
        const fechaStr = item.hora ? `${item.fecha || 'Sin fecha'} ${item.hora}` : (item.fecha || '');
        const fechaComprobanteStr = item.fecha_comprobante || item.fecha || '';
        const local = String(item.local || '').trim();
        const localBranch = getMercadoFrescosBranch(local);
        const localLabel = isMercadoFrescosLocal(local)
            ? localBranch
                ? `Mercado de Frescos - ${localBranch.label}`
                : 'Mercado de Frescos - Sin asignar'
            : local === 'local1'
                ? 'Local Cba'
                : local === 'local2'
                    ? 'Repartos'
                    : local || '-';

        const row = sheet.addRow([
            fechaStr,
            fechaComprobanteStr,
            typeof item.monto === 'number' ? item.monto : (parseFloat(item.monto) || 0),
            item.emisor || '-',
            localLabel
        ]);

        row.height = 22;

        // Fecha formatting
        row.getCell(1).alignment = { horizontal: 'center' };
        
        // Monto formatting (Currency)
        const montoCell = row.getCell(3);
        montoCell.numFmt = '$#,##0.00;($#,##0.00);"-"';
        montoCell.alignment = { horizontal: 'right' };
        montoCell.font = { bold: true };

        // Entidad / Emisor formatting
        row.getCell(4).alignment = { horizontal: 'left' };

        // Local formatting
        row.getCell(5).alignment = { horizontal: 'left' };

        row.eachCell((cell) => {
            cell.border = {
                top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
            };
        });
    });

    const endRowIndex = startRowIndex + receipts.length - 1;

    // 5. Total Row
    if (receipts.length > 0) {
        const totalRowIndex = endRowIndex + 1;
        const totalRow = sheet.addRow([
            'TOTAL GENERAL',
            '',
            { formula: `SUM(C${startRowIndex}:C${endRowIndex})` },
            `${receipts.length} Comprobantes`,
            '',
            ''
        ]);

        totalRow.height = 26;

        const totalTitleCell = sheet.getCell(`A${totalRowIndex}`);
        totalTitleCell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF0F172A' } };
        totalTitleCell.alignment = { horizontal: 'center', vertical: 'middle' };

        const totalMontoCell = sheet.getCell(`C${totalRowIndex}`);
        totalMontoCell.numFmt = '$#,##0.00';
        totalMontoCell.font = { name: 'Calibri', size: 12, bold: true, color: { argb: 'FF166534' } }; // Deep green text
        totalMontoCell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFDCFCE7' } // Light green accent fill
        };
        totalMontoCell.alignment = { horizontal: 'right', vertical: 'middle' };

        const countCell = sheet.getCell(`D${totalRowIndex}`);
        countCell.font = { bold: true, color: { argb: 'FF475569' } };
        countCell.alignment = { horizontal: 'center', vertical: 'middle' };

        totalRow.eachCell((cell) => {
            cell.border = {
                top: { style: 'double', color: { argb: 'FF0F172A' } },
                bottom: { style: 'double', color: { argb: 'FF0F172A' } }
            };
        });
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return buffer;
}
