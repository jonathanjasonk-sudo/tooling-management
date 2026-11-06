const express = require('express');
const path = require('path');
const crypto = require('crypto');
const db = require('./src/db');
const { STATUSES, REQUEST_STATUSES } = require('./src/constants');
const { parseWorkbook } = require('./src/importer');
const { buildWorkbook } = require('./src/exporter');

const app = express();
const OPEN_REQUEST_STATUSES = ['DIAJUKAN', 'DIPROSES', 'SIAP'];
app.set('trust proxy', 1);
app.use(express.json({ limit: '5mb' }));

/* ---------- Login sederhana (aktif jika APP_PASSWORD diisi) ---------- */
const PASSWORD = process.env.APP_PASSWORD || '';
const TOOLING_ADMIN_PASSWORD = process.env.TOOLING_ADMIN_PASSWORD || '';
const SECRET = process.env.SESSION_SECRET || crypto.createHash('sha256').update('tms:' + PASSWORD).digest('hex');
const sign = (exp) => exp + '.' + crypto.createHmac('sha256', SECRET).update(String(exp)).digest('hex');
const valid = (tok) => {
  if (!tok) return false;
  const [exp, sig] = tok.split('.');
  if (!exp || !sig || Date.now() > Number(exp)) return false;
  const good = sign(exp).split('.')[1];
  return sig.length === good.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good));
};
const cookieOf = (req, name) => (req.headers.cookie || '').split(/;\s*/).map((c) => c.split('=')).find((c) => c[0] === name)?.[1];

app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('/api/auth', (req, res) => res.json({ required: !!PASSWORD, ok: !PASSWORD || valid(cookieOf(req, 'tms'))}));
app.post('/api/login', (req, res) => {
  if (!PASSWORD) return res.json({ ok: true });
  if (String(req.body.password || '') !== PASSWORD) return res.status(401).json({ error: 'Password salah' });
  const exp = Date.now() + 1000 * 60 * 60 * 24 * 14;
  res.setHeader('Set-Cookie', `tms=${sign(exp)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${14 * 86400}${req.secure ? '; Secure' : ''}`);
  res.json({ ok: true });
});
app.post('/api/logout', (_req, res) => { res.setHeader('Set-Cookie', 'tms=; Path=/; Max-Age=0'); res.json({ ok: true }); });
app.use('/api', (req, res, next) => {
  if (!PASSWORD || valid(cookieOf(req, 'tms'))) return next();
  res.status(401).json({ error: 'Silakan login' });
});

/* ---------- Helper ---------- */
const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
function checkToolingPassword(req) {
  if (!TOOLING_ADMIN_PASSWORD) throw bad('Password admin belum diatur pada konfigurasi server.', 503);
  const provided = Buffer.from(req.get('x-tooling-password') || '');
  const expected = Buffer.from(TOOLING_ADMIN_PASSWORD);
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    throw bad('Password admin salah.', 403);
  }
}
const requireToolingPassword = (req, _res, next) => {
  try { checkToolingPassword(req); next(); } catch (e) { next(e); }
};
app.post('/api/admin/verify', requireToolingPassword, (_req, res) => res.json({ ok: true }));
const int = (v, name) => { const n = parseInt(v, 10); if (!Number.isFinite(n)) throw bad(`${name} tidak valid`); return n; };
const qtyOf = (v) => { const n = parseInt(v, 10); if (!Number.isFinite(n) || n < 0) throw bad('Jumlah harus angka ≥ 0'); return n; };
const checkStatus = (s) => { if (!STATUSES.some((x) => x.key === s)) throw bad('Status tidak dikenal: ' + s); return s; };
const actorOf = (req) => { try { return decodeURIComponent(req.get('x-actor') || '').slice(0, 60) || null; } catch { return null; } };
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const noteText = (s) => String(s ?? '').replace(/\r\n?/g, '\n').trim();
const setNotesOf = (stock) => Array.isArray(stock?.set_notes) && stock.set_notes.length
  ? stock.set_notes.map(noteText)
  : stock?.note ? [noteText(stock.note)] : [];
const fitSetNotes = (notes, qty) => Array.from({ length: qty }, (_, i) => notes[i] || '');
const summarySetNotes = (notes) => notes.map((note, i) => note ? `Set ${i + 1}: ${note}` : '').filter(Boolean).join('\n') || null;

async function loadAll() {
  const [styles, types, locations, stock, requests, movements, imports] = await Promise.all([
    db.q('SELECT id,name FROM styles ORDER BY sort,id'),
    db.q('SELECT id,name FROM tooling_types ORDER BY sort,id'),
    db.q('SELECT id,name FROM locations ORDER BY sort,id'),
    db.q('SELECT id,style_id,type_id,location_id,status,qty,note,set_notes FROM stock'),
    db.q(`SELECT id,style_id,type_id,qty,target_location_id,requested_by,to_char(due_date,'YYYY-MM-DD') AS due_date,status,note,created_at FROM requests ORDER BY id DESC`),
    db.q('SELECT id,ts,action,style_id,type_id,from_location_id,to_location_id,qty,from_status,to_status,note,actor FROM movements ORDER BY id DESC LIMIT 300'),
    db.q('SELECT id,ts,filename,requested_by,actor,replace_stock,item_count,total_qty,details FROM import_batches ORDER BY id DESC LIMIT 100'),
  ]);
  return { styles: styles.rows, types: types.rows, locations: locations.rows, stock: stock.rows, requests: requests.rows, movements: movements.rows, imports: imports.rows };
}

const log = (q, m) => q(
  `INSERT INTO movements(action,style_id,type_id,from_location_id,to_location_id,qty,from_status,to_status,note,actor) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
  [m.action, m.style_id ?? null, m.type_id ?? null, m.from ?? null, m.to ?? null, m.qty ?? null, m.fromStatus ?? null, m.toStatus ?? null, m.note ?? null, m.actor ?? null]);

// tambah (delta) ke baris stok; hapus bila jadi 0
async function addStock(q, { style_id, type_id, location_id, status, delta, set_notes, append_notes }) {
  const cur = await q('SELECT id,qty,note,set_notes FROM stock WHERE style_id=$1 AND type_id=$2 AND location_id=$3 AND status=$4', [style_id, type_id, location_id, status]);
  const old = cur.rows[0]?.qty || 0;
  const now = old + delta;
  if (now < 0) throw bad('Jumlah tidak mencukupi');
  if (now === 0) { if (cur.rows[0]) await q('DELETE FROM stock WHERE id=$1', [cur.rows[0].id]); return; }
  const oldNotes = fitSetNotes(cur.rows[0] ? setNotesOf(cur.rows[0]) : [], old);
  const nextNotes = set_notes
    ? fitSetNotes(set_notes, now)
    : append_notes ? [...oldNotes, ...fitSetNotes(append_notes, delta)]
    : delta < 0 ? oldNotes.slice(0, now) : [...oldNotes, ...Array(delta).fill('')];
  const note = summarySetNotes(nextNotes);
  await q(`INSERT INTO stock(style_id,type_id,location_id,status,qty,note,set_notes) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)
           ON CONFLICT (style_id,type_id,location_id,status) DO UPDATE SET qty=$5, note=$6, set_notes=$7::jsonb, updated_at=now()`,
    [style_id, type_id, location_id, status, now, note, JSON.stringify(nextNotes)]);
}

/* ---------- Data utama ---------- */
app.get('/api/data', async (_req, res) => {
  res.json({ ...(await loadAll()), statuses: STATUSES, requestStatuses: REQUEST_STATUSES });
});

/* ---------- Stok ---------- */
// Atur jumlah per status untuk satu sel (style x jenis x gedung)
app.post('/api/stock/bulk', async (req, res) => {
  const style_id = int(req.body.style_id, 'style'), type_id = int(req.body.type_id, 'jenis'), location_id = int(req.body.location_id, 'gedung');
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  const actor = actorOf(req);
  const requestedBy = norm(req.body.requested_by);
  await db.tx(async (q) => {
    const currentRows = [];
    for (const r of rows) {
      const status = checkStatus(r.status);
      qtyOf(r.qty);
      const cur = await q('SELECT id,qty,note,set_notes FROM stock WHERE style_id=$1 AND type_id=$2 AND location_id=$3 AND status=$4', [style_id, type_id, location_id, status]);
      currentRows.push(cur.rows[0]);
    }
    const addsStock = rows.some((r, i) => qtyOf(r.qty) > (currentRows[i]?.qty || 0));
    if (addsStock && !actor) throw bad('Nama PIC yang menambahkan wajib diisi.');
    if (addsStock && !requestedBy) throw bad('Nama PIC yang meminta wajib diisi.');
    for (const [i, r] of rows.entries()) {
      const status = checkStatus(r.status), qty = qtyOf(r.qty);
      const cur = currentRows[i];
      const old = cur?.qty || 0;
      if (r.set_notes !== undefined && !Array.isArray(r.set_notes)) throw bad('Catatan per set tidak valid.');
      if (Array.isArray(r.set_notes) && r.set_notes.some((note) => note != null && typeof note !== 'string')) throw bad('Catatan per set tidak valid.');
      const suppliedNotes = r.set_notes !== undefined
        ? r.set_notes.map(noteText)
        : r.note !== undefined ? [noteText(r.note)] : setNotesOf(cur);
      const notes = fitSetNotes(suppliedNotes, qty);
      const note = summarySetNotes(notes);
      if (qty === 0) { if (cur) await q('DELETE FROM stock WHERE id=$1', [cur.id]); }
      else await q(`INSERT INTO stock(style_id,type_id,location_id,status,qty,note,set_notes) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)
                    ON CONFLICT (style_id,type_id,location_id,status) DO UPDATE SET qty=$5, note=$6, set_notes=$7::jsonb, updated_at=now()`,
        [style_id, type_id, location_id, status, qty, note, JSON.stringify(notes)]);
      if (qty !== old) await log(q, { action: 'ATUR', style_id, type_id, to: location_id, qty: qty - old, toStatus: status, note: qty > old && requestedBy ? `Diminta oleh ${requestedBy}${note ? ` — ${note}` : ''}` : note, actor });
      else if ((cur?.note || null) !== note && qty > 0) await log(q, { action: 'CATATAN', style_id, type_id, to: location_id, qty: 0, toStatus: status, note, actor });
    }
  });
  res.json({ ok: true });
});

// Pindahkan tooling antar gedung (opsional sekaligus ganti status)
app.post('/api/stock/move', async (req, res) => {
  const b = req.body;
  const style_id = int(b.style_id, 'style'), type_id = int(b.type_id, 'jenis');
  const from = int(b.from_location_id, 'gedung asal'), to = int(b.to_location_id, 'gedung tujuan');
  const status = checkStatus(b.status), toStatus = checkStatus(b.to_status || b.status);
  const qty = qtyOf(b.qty);
  if (qty < 1) throw bad('Jumlah minimal 1');
  if (from === to && status === toStatus) throw bad('Gedung asal dan tujuan sama');
  const actor = actorOf(req);
  await db.tx(async (q) => {
    const source = await q('SELECT qty,note,set_notes FROM stock WHERE style_id=$1 AND type_id=$2 AND location_id=$3 AND status=$4', [style_id, type_id, from, status]);
    if (!source.rows[0] || source.rows[0].qty < qty) throw bad('Jumlah tidak mencukupi');
    const sourceNotes = fitSetNotes(setNotesOf(source.rows[0]), source.rows[0].qty);
    const movedNotes = sourceNotes.splice(0, qty);
    await addStock(q, { style_id, type_id, location_id: from, status, delta: -qty, set_notes: sourceNotes });
    await addStock(q, { style_id, type_id, location_id: to, status: toStatus, delta: qty, append_notes: movedNotes });
    await log(q, { action: 'PINDAH', style_id, type_id, from, to, qty, fromStatus: status, toStatus, note: norm(b.note) || null, actor });
  });
  res.json({ ok: true });
});

/* ---------- Master data ---------- */
async function addMaster(table, name, fmt, q = db.q) {
  const n = fmt(norm(name));
  if (!n) throw bad('Nama wajib diisi');
  const mx = await q(`SELECT COALESCE(MAX(sort),0)+1 AS s FROM ${table}`);
  const r = await q(`INSERT INTO ${table}(name,sort) VALUES($1,$2) ON CONFLICT (name) DO UPDATE SET name=EXCLUDED.name RETURNING id,name`, [n, mx.rows[0].s]);
  return r.rows[0];
}
const title = (s) => s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
app.post('/api/styles', async (req, res) => res.json(await addMaster('styles', req.body.name, (s) => s.toUpperCase())));
app.post('/api/types', requireToolingPassword, async (req, res) => res.json(await addMaster('tooling_types', req.body.name, title)));
app.post('/api/locations', requireToolingPassword, async (req, res) => res.json(await addMaster('locations', req.body.name, title)));
app.delete('/api/types/:id', requireToolingPassword, async (req, res) => {
  const id = int(req.params.id, 'id');
  await db.tx(async (q) => {
    const type = (await q('SELECT name FROM tooling_types WHERE id=$1', [id])).rows[0];
    if (!type) throw bad('Jenis tooling tidak ditemukan.', 404);
    const stock = await q('SELECT count(*)::int AS rows, COALESCE(sum(qty),0)::int AS sets FROM stock WHERE type_id=$1', [id]);
    const requests = await q('SELECT count(*)::int AS rows FROM requests WHERE type_id=$1', [id]);
    await q('DELETE FROM stock WHERE type_id=$1', [id]);
    await q('DELETE FROM requests WHERE type_id=$1', [id]);
    await q('DELETE FROM tooling_types WHERE id=$1', [id]);
    await log(q, {
      action: 'HAPUS_JENIS',
      qty: stock.rows[0].sets,
      note: `${type.name} — ${stock.rows[0].rows} baris stok dan ${requests.rows[0].rows} request dihapus`,
      actor: actorOf(req),
    });
  });
  res.json({ ok: true });
});
app.delete('/api/styles/:id', requireToolingPassword, async (req, res) => {
  const id = int(req.params.id, 'id');
  await db.tx(async (q) => {
    const s = await q('SELECT name FROM styles WHERE id=$1', [id]);
    await q('DELETE FROM styles WHERE id=$1', [id]);
    if (s.rows[0]) await log(q, { action: 'HAPUS_STYLE', note: s.rows[0].name, actor: actorOf(req) });
  });
  res.json({ ok: true });
});

/* ---------- On request ---------- */
app.post('/api/requests', async (req, res) => {
  const b = req.body;
  const type_id = int(b.type_id, 'jenis tooling'), qty = int(b.qty, 'jumlah');
  if (qty < 1) throw bad('Jumlah minimal 1');
  const actor = actorOf(req);
  const requestedBy = norm(b.requested_by);
  if (!actor) throw bad('Nama PIC yang mencatat request wajib diisi.');
  if (!requestedBy) throw bad('Nama PIC yang meminta wajib diisi.');
  let style_id = b.style_id ? int(b.style_id, 'style') : null;
  if (!style_id) {
    if (!norm(b.style_name)) throw bad('Style wajib diisi');
    style_id = (await addMaster('styles', b.style_name, (s) => s.toUpperCase())).id;
  }
  const target = b.target_location_id ? int(b.target_location_id, 'gedung') : null;
  await db.tx(async (q) => {
    await q(`INSERT INTO requests(style_id,type_id,qty,target_location_id,requested_by,due_date,note) VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [style_id, type_id, qty, target, requestedBy, b.due_date || null, norm(b.note) || null]);
    await log(q, { action: 'REQUEST', style_id, type_id, to: target, qty, note: `Diminta oleh ${requestedBy}${norm(b.note) ? ` — ${norm(b.note)}` : ''}`, actor });
  });
  res.json({ ok: true });
});

app.patch('/api/requests/:id', async (req, res) => {
  const id = int(req.params.id, 'id');
  const status = String(req.body.status || '');
  if (!REQUEST_STATUSES.some((s) => s.key === status)) throw bad('Status request tidak dikenal');
  const actor = actorOf(req);
  if (status === 'DITERIMA' && !actor) throw bad('Nama PIC yang menerima dan menambahkan ke stok wajib diisi.');
  await db.tx(async (q) => {
    const cur = (await q('SELECT * FROM requests WHERE id=$1', [id])).rows[0];
    if (!cur) throw bad('Request tidak ditemukan', 404);
    if (cur.status === 'DITERIMA') throw bad('Request sudah diterima dan masuk stok');
    const target = req.body.target_location_id ? int(req.body.target_location_id, 'gedung') : cur.target_location_id;
    if (status === 'DITERIMA') {
      if (!target) throw bad('Pilih gedung tujuan dulu sebelum menerima tooling');
      await addStock(q, { style_id: cur.style_id, type_id: cur.type_id, location_id: target, status: 'TERSEDIA', delta: cur.qty });
      await log(q, { action: 'TERIMA', style_id: cur.style_id, type_id: cur.type_id, to: target, qty: cur.qty, toStatus: 'TERSEDIA', note: `Dari request #${id} — diminta oleh ${cur.requested_by || 'tidak dicatat'}`, actor });
    } else {
      await log(q, { action: 'REQUEST_' + status, style_id: cur.style_id, type_id: cur.type_id, to: target, qty: cur.qty, note: 'Request #' + id, actor });
    }
    await q('UPDATE requests SET status=$1, target_location_id=$2, updated_at=now() WHERE id=$3', [status, target, id]);
  });
  res.json({ ok: true });
});

app.put('/api/requests/:id', async (req, res) => {
  const id = int(req.params.id, 'id');
  const b = req.body;
  const type_id = int(b.type_id, 'jenis tooling');
  const qty = int(b.qty, 'jumlah');
  if (qty < 1) throw bad('Jumlah minimal 1');
  const requestedBy = norm(b.requested_by);
  if (!requestedBy) throw bad('Nama PIC yang meminta wajib diisi.');
  const dueDate = norm(b.due_date) || null;
  if (dueDate) {
    const parsedDate = new Date(`${dueDate}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== dueDate) {
      throw bad('Target tanggal tidak valid.');
    }
  }
  const target = b.target_location_id ? int(b.target_location_id, 'gedung') : null;
  const actor = actorOf(req);
  await db.tx(async (q) => {
    const cur = (await q('SELECT * FROM requests WHERE id=$1', [id])).rows[0];
    if (!cur) throw bad('Request tidak ditemukan', 404);
    if (!OPEN_REQUEST_STATUSES.includes(cur.status)) throw bad('Hanya request yang masih berjalan yang dapat direvisi.');

    let style_id = b.style_id ? int(b.style_id, 'style') : null;
    if (!style_id) {
      if (!norm(b.style_name)) throw bad('Style wajib diisi');
      style_id = (await addMaster('styles', b.style_name, (s) => s.toUpperCase(), q)).id;
    }
    if (!(await q('SELECT id FROM tooling_types WHERE id=$1', [type_id])).rows[0]) throw bad('Jenis tooling tidak ditemukan.');
    if (target && !(await q('SELECT id FROM locations WHERE id=$1', [target])).rows[0]) throw bad('Gedung tujuan tidak ditemukan.');

    await q(`UPDATE requests SET style_id=$1,type_id=$2,qty=$3,target_location_id=$4,requested_by=$5,due_date=$6,note=$7,updated_at=now() WHERE id=$8`,
      [style_id, type_id, qty, target, requestedBy, dueDate, norm(b.note) || null, id]);
    await log(q, {
      action: 'REQUEST_REVISI', style_id, type_id, to: target, qty,
      note: `Request #${id} diperbarui`, actor,
    });
  });
  res.json({ ok: true });
});

app.delete('/api/requests/:id', async (req, res) => {
  const id = int(req.params.id, 'id');
  const cur = (await db.q('SELECT status FROM requests WHERE id=$1', [id])).rows[0];
  if (cur && cur.status === 'DITERIMA') throw bad('Request yang sudah diterima tidak bisa dihapus');
  await db.q('DELETE FROM requests WHERE id=$1', [id]);
  res.json({ ok: true });
});

/* ---------- Import / Export Excel ---------- */
app.post('/api/import/preview', requireToolingPassword, express.raw({ type: () => true, limit: '15mb' }), async (req, res) => {
  if (!req.body || !req.body.length) throw bad('File tidak terbaca');
  try { res.json(await parseWorkbook(req.body)); }
  catch (e) { throw bad(e.message); }
});

app.post('/api/import/commit', requireToolingPassword, async (req, res) => {
  const { styles = [], types = [], locations = [], items = [], replace = true } = req.body;
  if (!Array.isArray(items)) throw bad('Data import tidak valid');
  const actor = actorOf(req);
  const requestedBy = norm(req.body.requested_by);
  const filename = norm(req.body.filename) || 'File Excel';
  if (!actor) throw bad('Nama PIC yang mengunggah wajib diisi.');
  if (!requestedBy) throw bad('Nama PIC yang meminta import wajib diisi.');
  await db.tx(async (q) => {
    const existingTypes = new Set((await q('SELECT name FROM tooling_types')).rows.map((r) => r.name.toLowerCase()));
    if (types.some((name) => !existingTypes.has(title(norm(name)).toLowerCase()))) checkToolingPassword(req);
    const ids = { styles: {}, types: {}, locations: {} };
    const up = async (table, key, names, fmt) => {
      let i = (await q(`SELECT COALESCE(MAX(sort),0) AS m FROM ${table}`)).rows[0].m;
      for (const n of names) {
        const name = fmt(norm(n)); if (!name) continue;
        const r = await q(`INSERT INTO ${table}(name,sort) VALUES($1,$2) ON CONFLICT (name) DO UPDATE SET name=EXCLUDED.name RETURNING id`, [name, ++i]);
        ids[key][n] = r.rows[0].id;
      }
    };
    if (replace) await q('DELETE FROM stock');
    await up('styles', 'styles', styles, (s) => s.toUpperCase());
    await up('tooling_types', 'types', types, title);
    await up('locations', 'locations', locations, title);
    let total = 0;
    const details = [];
    for (const it of items) {
      const status = checkStatus(it.status || 'TERSEDIA'); const qty = qtyOf(it.qty);
      if (qty < 1) continue;
      const s = ids.styles[it.style], t = ids.types[it.type], l = ids.locations[it.location];
      if (!s || !t || !l) throw bad('Data import tidak lengkap: ' + JSON.stringify(it));
      await q(`INSERT INTO stock(style_id,type_id,location_id,status,qty,note,set_notes) VALUES($1,$2,$3,$4,$5,$6,'[]'::jsonb)
               ON CONFLICT (style_id,type_id,location_id,status) DO UPDATE SET qty=$5, note=$6, set_notes='[]'::jsonb, updated_at=now()`,
        [s, t, l, status, qty, norm(it.note) || null]);
      total += qty;
      details.push({ style: it.style, type: it.type, location: it.location, status, qty, note: norm(it.note) || '' });
    }
    await q(`INSERT INTO import_batches(filename,requested_by,actor,replace_stock,item_count,total_qty,details)
      VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`,
    [filename, requestedBy, actor, replace, details.length, total, JSON.stringify(details)]);
    await log(q, { action: 'IMPORT', qty: total, note: `Import Excel: ${filename} · ${items.length} baris · ${replace ? 'stok lama diganti' : 'digabung'} · diminta oleh ${requestedBy}`, actor });
  });
  res.json({ ok: true });
});

app.get('/api/export', requireToolingPassword, async (_req, res) => {
  const wb = await buildWorkbook(await loadAll());
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="DATA_KETERSEDIAAN_TOOLING_${stamp}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

/* ---------- Frontend & error handler ---------- */
app.use(express.static(path.join(__dirname, 'public')));
app.use((err, _req, res, _next) => {
  const status = err.status || (err.code === '23505' ? 409 : 500);
  if (status === 500) console.error(err);
  res.status(status).json({ error: status === 500 ? 'Terjadi kesalahan di server' : err.message });
});

const PORT = process.env.PORT || 3000;
db.init().then(() => app.listen(PORT, '0.0.0.0', () => console.log(`Tooling Management System jalan di port ${PORT}`)))
  .catch((e) => { console.error('Gagal start:', e); process.exit(1); });
