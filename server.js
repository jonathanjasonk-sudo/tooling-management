const express = require('express');
const path = require('path');
const crypto = require('crypto');
const db = require('./src/db');
const { STATUSES, REQUEST_STATUSES } = require('./src/constants');
const { parseWorkbook } = require('./src/importer');
const { buildWorkbook } = require('./src/exporter');

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '5mb' }));

/* ---------- Login sederhana (aktif jika APP_PASSWORD diisi) ---------- */
const PASSWORD = process.env.APP_PASSWORD || '';
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
const int = (v, name) => { const n = parseInt(v, 10); if (!Number.isFinite(n)) throw bad(`${name} tidak valid`); return n; };
const qtyOf = (v) => { const n = parseInt(v, 10); if (!Number.isFinite(n) || n < 0) throw bad('Jumlah harus angka ≥ 0'); return n; };
const checkStatus = (s) => { if (!STATUSES.some((x) => x.key === s)) throw bad('Status tidak dikenal: ' + s); return s; };
const actorOf = (req) => { try { return decodeURIComponent(req.get('x-actor') || '').slice(0, 60) || null; } catch { return null; } };
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

async function loadAll() {
  const [styles, types, locations, stock, requests, movements] = await Promise.all([
    db.q('SELECT id,name FROM styles ORDER BY sort,id'),
    db.q('SELECT id,name FROM tooling_types ORDER BY sort,id'),
    db.q('SELECT id,name FROM locations ORDER BY sort,id'),
    db.q('SELECT id,style_id,type_id,location_id,status,qty,note FROM stock'),
    db.q(`SELECT id,style_id,type_id,qty,target_location_id,requested_by,to_char(due_date,'YYYY-MM-DD') AS due_date,status,note,created_at FROM requests ORDER BY id DESC`),
    db.q('SELECT id,ts,action,style_id,type_id,from_location_id,to_location_id,qty,from_status,to_status,note,actor FROM movements ORDER BY id DESC LIMIT 300'),
  ]);
  return { styles: styles.rows, types: types.rows, locations: locations.rows, stock: stock.rows, requests: requests.rows, movements: movements.rows };
}

const log = (q, m) => q(
  `INSERT INTO movements(action,style_id,type_id,from_location_id,to_location_id,qty,from_status,to_status,note,actor) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
  [m.action, m.style_id ?? null, m.type_id ?? null, m.from ?? null, m.to ?? null, m.qty ?? null, m.fromStatus ?? null, m.toStatus ?? null, m.note ?? null, m.actor ?? null]);

// tambah (delta) ke baris stok; hapus bila jadi 0
async function addStock(q, { style_id, type_id, location_id, status, delta, note }) {
  const cur = await q('SELECT id,qty FROM stock WHERE style_id=$1 AND type_id=$2 AND location_id=$3 AND status=$4', [style_id, type_id, location_id, status]);
  const old = cur.rows[0]?.qty || 0;
  const now = old + delta;
  if (now < 0) throw bad('Jumlah tidak mencukupi');
  if (now === 0) { if (cur.rows[0]) await q('DELETE FROM stock WHERE id=$1', [cur.rows[0].id]); return; }
  await q(`INSERT INTO stock(style_id,type_id,location_id,status,qty,note) VALUES($1,$2,$3,$4,$5,$6)
           ON CONFLICT (style_id,type_id,location_id,status) DO UPDATE SET qty=$5, updated_at=now()`,
    [style_id, type_id, location_id, status, now, note || null]);
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
  await db.tx(async (q) => {
    for (const r of rows) {
      const status = checkStatus(r.status), qty = qtyOf(r.qty), note = norm(r.note) || null;
      const cur = await q('SELECT id,qty,note FROM stock WHERE style_id=$1 AND type_id=$2 AND location_id=$3 AND status=$4', [style_id, type_id, location_id, status]);
      const old = cur.rows[0]?.qty || 0;
      if (qty === 0) { if (cur.rows[0]) await q('DELETE FROM stock WHERE id=$1', [cur.rows[0].id]); }
      else await q(`INSERT INTO stock(style_id,type_id,location_id,status,qty,note) VALUES($1,$2,$3,$4,$5,$6)
                    ON CONFLICT (style_id,type_id,location_id,status) DO UPDATE SET qty=$5, note=$6, updated_at=now()`,
        [style_id, type_id, location_id, status, qty, note]);
      if (qty !== old) await log(q, { action: 'ATUR', style_id, type_id, to: location_id, qty: qty - old, toStatus: status, note, actor });
      else if ((cur.rows[0]?.note || null) !== note && qty > 0) await log(q, { action: 'CATATAN', style_id, type_id, to: location_id, qty: 0, toStatus: status, note, actor });
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
    await addStock(q, { style_id, type_id, location_id: from, status, delta: -qty });
    await addStock(q, { style_id, type_id, location_id: to, status: toStatus, delta: qty });
    await log(q, { action: 'PINDAH', style_id, type_id, from, to, qty, fromStatus: status, toStatus, note: norm(b.note) || null, actor });
  });
  res.json({ ok: true });
});

/* ---------- Master data ---------- */
async function addMaster(table, name, fmt) {
  const n = fmt(norm(name));
  if (!n) throw bad('Nama wajib diisi');
  const mx = await db.q(`SELECT COALESCE(MAX(sort),0)+1 AS s FROM ${table}`);
  const r = await db.q(`INSERT INTO ${table}(name,sort) VALUES($1,$2) ON CONFLICT (name) DO UPDATE SET name=EXCLUDED.name RETURNING id,name`, [n, mx.rows[0].s]);
  return r.rows[0];
}
const title = (s) => s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
app.post('/api/styles', async (req, res) => res.json(await addMaster('styles', req.body.name, (s) => s.toUpperCase())));
app.post('/api/types', async (req, res) => res.json(await addMaster('tooling_types', req.body.name, title)));
app.post('/api/locations', async (req, res) => res.json(await addMaster('locations', req.body.name, title)));
app.delete('/api/styles/:id', async (req, res) => {
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
  let style_id = b.style_id ? int(b.style_id, 'style') : null;
  if (!style_id) {
    if (!norm(b.style_name)) throw bad('Style wajib diisi');
    style_id = (await addMaster('styles', b.style_name, (s) => s.toUpperCase())).id;
  }
  const target = b.target_location_id ? int(b.target_location_id, 'gedung') : null;
  const actor = actorOf(req);
  await db.tx(async (q) => {
    await q(`INSERT INTO requests(style_id,type_id,qty,target_location_id,requested_by,due_date,note) VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [style_id, type_id, qty, target, norm(b.requested_by) || actor, b.due_date || null, norm(b.note) || null]);
    await log(q, { action: 'REQUEST', style_id, type_id, to: target, qty, note: norm(b.note) || null, actor });
  });
  res.json({ ok: true });
});

app.patch('/api/requests/:id', async (req, res) => {
  const id = int(req.params.id, 'id');
  const status = String(req.body.status || '');
  if (!REQUEST_STATUSES.some((s) => s.key === status)) throw bad('Status request tidak dikenal');
  const actor = actorOf(req);
  await db.tx(async (q) => {
    const cur = (await q('SELECT * FROM requests WHERE id=$1', [id])).rows[0];
    if (!cur) throw bad('Request tidak ditemukan', 404);
    if (cur.status === 'DITERIMA') throw bad('Request sudah diterima dan masuk stok');
    const target = req.body.target_location_id ? int(req.body.target_location_id, 'gedung') : cur.target_location_id;
    if (status === 'DITERIMA') {
      if (!target) throw bad('Pilih gedung tujuan dulu sebelum menerima tooling');
      await addStock(q, { style_id: cur.style_id, type_id: cur.type_id, location_id: target, status: 'TERSEDIA', delta: cur.qty });
      await log(q, { action: 'TERIMA', style_id: cur.style_id, type_id: cur.type_id, to: target, qty: cur.qty, toStatus: 'TERSEDIA', note: 'Dari request #' + id, actor });
    } else {
      await log(q, { action: 'REQUEST_' + status, style_id: cur.style_id, type_id: cur.type_id, to: target, qty: cur.qty, note: 'Request #' + id, actor });
    }
    await q('UPDATE requests SET status=$1, target_location_id=$2, updated_at=now() WHERE id=$3', [status, target, id]);
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
app.post('/api/import/preview', express.raw({ type: () => true, limit: '15mb' }), async (req, res) => {
  if (!req.body || !req.body.length) throw bad('File tidak terbaca');
  try { res.json(await parseWorkbook(req.body)); }
  catch (e) { throw bad(e.message); }
});

app.post('/api/import/commit', async (req, res) => {
  const { styles = [], types = [], locations = [], items = [], replace = true } = req.body;
  if (!Array.isArray(items)) throw bad('Data import tidak valid');
  const actor = actorOf(req);
  await db.tx(async (q) => {
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
    for (const it of items) {
      const status = checkStatus(it.status || 'TERSEDIA'); const qty = qtyOf(it.qty);
      if (qty < 1) continue;
      const s = ids.styles[it.style], t = ids.types[it.type], l = ids.locations[it.location];
      if (!s || !t || !l) throw bad('Data import tidak lengkap: ' + JSON.stringify(it));
      await q(`INSERT INTO stock(style_id,type_id,location_id,status,qty,note) VALUES($1,$2,$3,$4,$5,$6)
               ON CONFLICT (style_id,type_id,location_id,status) DO UPDATE SET qty=$5, note=$6, updated_at=now()`,
        [s, t, l, status, qty, norm(it.note) || null]);
      total += qty;
    }
    await log(q, { action: 'IMPORT', qty: total, note: `Import Excel: ${items.length} baris, ${replace ? 'data lama diganti' : 'digabung'}`, actor });
  });
  res.json({ ok: true });
});

app.get('/api/export', async (_req, res) => {
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
