// Membaca file Excel "DATA KETERSEDIAAN TOOLING" -> daftar item stok terstruktur.
const ExcelJS = require('exceljs');

const cellText = (cell) => {
  if (!cell) return '';
  let v = cell.value;
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v.richText) v = v.richText.map((r) => r.text).join('');
    else if ('result' in v) v = v.result;
    else if (v.text) v = v.text;
  }
  return v == null ? '' : String(v).trim();
};

const titleCase = (s) =>
  s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());

const normType = (s) =>
  titleCase(s.replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim());
const normLocation = (s) => titleCase(s.replace(/\s+/g, ' ').trim());
const normStyle = (s) => s.replace(/\s+/g, ' ').trim().toUpperCase();

// "6SET (4SET U740 NOSEW)" -> 6 ; "1SET (PM3000), 2SET(JT3000)" -> 3 ; "-" -> 0
function parseQty(raw) {
  const t = raw.trim();
  if (!t || /^[-–—]+$/.test(t)) return 0;
  const outside = t.replace(/\([^)]*\)/g, ' ');
  let sum = 0;
  for (const m of outside.matchAll(/(\d+)\s*SET/gi)) sum += parseInt(m[1], 10);
  if (sum > 0) return sum;
  const bare = outside.match(/^\s*(\d+)\s*$/);
  return bare ? parseInt(bare[1], 10) : 0;
}

async function parseWorkbook(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('File Excel kosong.');

  // Cari baris header gedung (mis. "GEDUNG D")
  let headerRow = 0;
  ws.eachRow((row, n) => {
    if (headerRow) return;
    row.eachCell((c) => { if (/^gedung/i.test(cellText(c))) headerRow = n; });
  });
  if (!headerRow) throw new Error('Baris header "GEDUNG ..." tidak ditemukan. Pastikan format sama dengan file tooling yang dipakai sekarang.');

  const locCols = [];
  ws.getRow(headerRow).eachCell((c, col) => {
    const t = cellText(c);
    if (t && col >= 4 && !/^total/i.test(t)) locCols.push({ col, name: normLocation(t) });
  });

  const styles = [], types = [], items = [], warnings = [];
  let curStyle = '';
  const lastRow = ws.actualRowCount ? ws.rowCount : ws.lastRow.number;
  for (let r = headerRow + 1; r <= lastRow; r++) {
    const row = ws.getRow(r);
    const sRaw = cellText(row.getCell(2));
    const tRaw = cellText(row.getCell(3));
    if (/^style$/i.test(sRaw) || /^nama/i.test(tRaw)) continue; // baris judul kolom
    if (sRaw) { curStyle = normStyle(sRaw); if (!styles.includes(curStyle)) styles.push(curStyle); }
    if (!tRaw || !curStyle) continue;
    const type = normType(tRaw);
    if (!types.includes(type)) types.push(type);

    for (const lc of locCols) {
      const raw = cellText(row.getCell(lc.col));
      if (!raw) continue;
      const qty = parseQty(raw);
      if (qty <= 0) continue;
      const plain = /^\s*\d+\s*SET\s*$/i.test(raw);
      const flagged = /KURANG|HANYA ADA|\(\s*-/i.test(raw);
      const item = {
        style: curStyle, type, location: lc.name, qty,
        status: flagged ? 'INCOMPLETE' : 'TERSEDIA',
        note: plain ? '' : raw,
      };
      items.push(item);
      if (!plain) warnings.push({ row: r, ...item, raw });
    }
  }

  const byLocation = {};
  for (const i of items) byLocation[i.location] = (byLocation[i.location] || 0) + i.qty;
  return {
    styles, types, locations: locCols.map((l) => l.name), items, warnings,
    summary: {
      styles: styles.length,
      rows: items.length,
      totalSet: items.reduce((a, b) => a + b.qty, 0),
      byLocation,
      stylesWithoutTooling: styles.filter((s) => !items.some((i) => i.style === s)),
    },
  };
}

module.exports = { parseWorkbook, parseQty };
