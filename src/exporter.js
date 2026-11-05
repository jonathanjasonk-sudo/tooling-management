// Export ke Excel dengan susunan seperti file asli (Style x Jenis Tooling x Gedung).
const ExcelJS = require('exceljs');
const { STATUSES } = require('./constants');

async function buildWorkbook(d) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Data Tooling');
  const nLoc = d.locations.length;
  const totalCol = 4 + nLoc, reqCol = totalCol + 1, noteCol = totalCol + 2;
  const font = { name: 'Arial', size: 10 };

  ws.getCell('A1').value = 'DATA KETERSEDIAAN TOOLING PRODUKSI';
  ws.getCell('A1').font = { name: 'Arial', size: 14, bold: true };
  d.locations.forEach((l, i) => { ws.getCell(2, 4 + i).value = l.name.toUpperCase(); ws.getCell(3, 4 + i).value = 'TOTAL (SET)'; });
  ws.getCell(2, totalCol).value = 'SEMUA GEDUNG'; ws.getCell(3, totalCol).value = 'TOTAL';
  ws.getCell(2, reqCol).value = 'ON REQUEST'; ws.getCell(3, reqCol).value = '(SET)';
  ws.getCell(2, noteCol).value = 'CATATAN'; ws.getCell(3, noteCol).value = '';
  ['NO', 'STYLE', 'NAMA TOOLING'].forEach((t, i) => (ws.getCell(4, i + 1).value = t));
  for (let r = 2; r <= 4; r++) for (let c = 1; c <= noteCol; c++) {
    const cell = ws.getCell(r, c);
    cell.font = { ...font, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  }

  const open = d.requests.filter((r) => ['DIAJUKAN', 'DIPROSES', 'SIAP'].includes(r.status));
  const statusLabel = Object.fromEntries(STATUSES.map((s) => [s.key, s.label]));
  let row = 5, no = 0;
  for (const s of d.styles) {
    const types = d.types.filter((t) =>
      d.stock.some((x) => x.style_id === s.id && x.type_id === t.id) ||
      open.some((x) => x.style_id === s.id && x.type_id === t.id));
    no++;
    if (!types.length) {
      ws.getCell(row, 1).value = no; ws.getCell(row, 2).value = s.name; ws.getCell(row, 3).value = '(belum ada tooling)';
      row++; continue;
    }
    types.forEach((t, idx) => {
      ws.getCell(row, 1).value = idx === 0 ? no : null;
      ws.getCell(row, 2).value = idx === 0 ? s.name : null;
      ws.getCell(row, 3).value = t.name.toUpperCase() + ' (SET)';
      const notes = [];
      d.locations.forEach((l, i) => {
        const rows = d.stock.filter((x) => x.style_id === s.id && x.type_id === t.id && x.location_id === l.id && x.status !== 'RUSAK');
        const qty = rows.reduce((a, b) => a + b.qty, 0);
        const cell = ws.getCell(row, 4 + i);
        if (qty) cell.value = qty;
        cell.numFmt = '0" SET"';
        cell.alignment = { horizontal: 'center' };
        for (const x of rows) {
          if (x.status !== 'TERSEDIA' || x.note) notes.push(`${l.name}: ${x.qty} ${statusLabel[x.status]}${x.note ? ' - ' + x.note : ''}`);
        }
      });
      const first = ws.getCell(row, 4).address, last = ws.getCell(row, 3 + nLoc).address;
      const tc = ws.getCell(row, totalCol);
      tc.value = { formula: `SUM(${first}:${last})` }; tc.numFmt = '0" SET"'; tc.font = { ...font, bold: true }; tc.alignment = { horizontal: 'center' };
      const req = open.filter((x) => x.style_id === s.id && x.type_id === t.id).reduce((a, b) => a + b.qty, 0);
      const rc = ws.getCell(row, reqCol); if (req) rc.value = req; rc.numFmt = '0" SET"'; rc.alignment = { horizontal: 'center' };
      ws.getCell(row, noteCol).value = notes.join('; ');
      row++;
    });
  }
  for (let r = 5; r < row; r++) for (let c = 1; c <= noteCol; c++) {
    const cell = ws.getCell(r, c);
    cell.font = cell.font && cell.font.bold ? cell.font : font;
    cell.border = { top: { style: 'thin', color: { argb: 'FFD1D5DB' } }, bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } }, left: { style: 'thin', color: { argb: 'FFD1D5DB' } }, right: { style: 'thin', color: { argb: 'FFD1D5DB' } } };
  }
  ws.columns = [{ width: 6 }, { width: 18 }, { width: 28 }, ...d.locations.map(() => ({ width: 14 })), { width: 14 }, { width: 14 }, { width: 60 }];
  ws.views = [{ state: 'frozen', xSplit: 3, ySplit: 4 }];

  // Sheet request
  const wr = wb.addWorksheet('On Request');
  wr.addRow(['ID', 'Style', 'Jenis Tooling', 'Jumlah (set)', 'Gedung Tujuan', 'Diminta Oleh', 'Target Tanggal', 'Status', 'Catatan']);
  const sById = Object.fromEntries(d.styles.map((x) => [x.id, x.name]));
  const tById = Object.fromEntries(d.types.map((x) => [x.id, x.name]));
  const lById = Object.fromEntries(d.locations.map((x) => [x.id, x.name]));
  for (const r of d.requests) wr.addRow([r.id, sById[r.style_id], tById[r.type_id], r.qty, lById[r.target_location_id] || '', r.requested_by || '', r.due_date || '', r.status, r.note || '']);
  wr.getRow(1).font = { name: 'Arial', bold: true };
  wr.columns.forEach((c, i) => (c.width = [6, 16, 24, 12, 16, 16, 14, 14, 40][i]));
  return wb;
}
module.exports = { buildWorkbook };
