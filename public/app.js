/* Tooling Manager — frontend tanpa build step */
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sum = (a, f = (x) => x.qty) => a.reduce((t, x) => t + f(x), 0);
const S = { d: null, view: 'dashboard', adminPassword: null, f: { q: '', loc: '', type: '', status: '' }, rq: 'open', actor: localStorage.getItem('actor') || '', preview: null };
const OPEN = ['DIAJUKAN', 'DIPROSES', 'SIAP'];
const SHORT = { DIPAKAI: 'dipakai', MAINTENANCE: 'maint.', INCOMPLETE: 'kurang', RUSAK: 'rusak' };
const RQ_LABEL = { DIAJUKAN: 'Diajukan', DIPROSES: 'Dalam pembuatan', SIAP: 'Siap diambil', DITERIMA: 'Diterima', DIBATALKAN: 'Dibatalkan' };
const IC = {
  dashboard: '<path d="M3 13h8V3H3zM13 21h8V11h-8zM13 3v6h8V3zM3 21h8v-6H3z"/>',
  matrix: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
  request: '<path d="M12 5v14M5 12h14"/><circle cx="12" cy="12" r="9"/>',
  history: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  data: '<path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v3h16v-3"/>',
};
const NAV = [['dashboard', 'Dashboard'], ['matrix', 'Matriks Tooling'], ['request', 'On Request'], ['history', 'Riwayat'], ['data', 'Data & Import']];

/* ---------- util ---------- */
function toast(msg, err) {
  const el = document.createElement('div');
  el.className = 't' + (err ? ' err' : ''); el.textContent = msg;
  $('#toast').appendChild(el); setTimeout(() => el.remove(), 3200);
}
async function api(url, { method = 'GET', json, raw, adminPassword } = {}) {
  const headers = { 'X-Actor': encodeURIComponent(S.actor) };
  const password = adminPassword || S.adminPassword;
  if (password) headers['X-Tooling-Password'] = password;
  let body;
  if (json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  if (raw) { headers['Content-Type'] = 'application/octet-stream'; body = raw; }
  const r = await fetch(url, { method, headers, body });
  if (r.status === 401) { showLogin(); throw new Error('Silakan login'); }
  const t = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(t.error || 'Terjadi kesalahan');
  return t;
}
async function act(fn, okMsg) {
  try { const r = await fn(); await load(); if (okMsg) toast(okMsg); return r; }
  catch (e) { toast(e.message, true); }
}
const fmtDate = (s) => (s ? new Date(s).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const fmtDay = (s) => (s ? new Date(s + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

/* ---------- data ---------- */
async function load() {
  const d = await api('/api/data');
  d.sBy = Object.fromEntries(d.styles.map((x) => [x.id, x]));
  d.tBy = Object.fromEntries(d.types.map((x) => [x.id, x]));
  d.lBy = Object.fromEntries(d.locations.map((x) => [x.id, x]));
  d.stBy = Object.fromEntries(d.statuses.map((x) => [x.key, x]));
  d.openReq = d.requests.filter((r) => OPEN.includes(r.status));
  S.d = d; render();
}
const active = (rows) => rows.filter((x) => x.status !== 'RUSAK');
const nm = (map, id) => (map[id] ? map[id].name : '(dihapus)');
const stockOf = (sid, tid, lid) => S.d.stock.filter((x) => x.style_id === sid && (tid == null || x.type_id === tid) && (lid == null || x.location_id === lid));

/* ---------- render ---------- */
function render() {
  if (!S.d) return;
  $('#nav').innerHTML = NAV.map(([k, l]) =>
    `<a data-act="nav" data-v="${k}" class="${S.view === k ? 'on' : ''}"><svg viewBox="0 0 24 24">${IC[k === 'dashboard' ? 'dashboard' : k]}</svg>${l}${k === 'request' && S.d.openReq.length ? `<span class="badge">${S.d.openReq.length}</span>` : ''}</a>`).join('');
  const v = { dashboard: vDashboard, matrix: vMatrix, request: vRequest, history: vHistory, data: vData }[S.view];
  $('#main').innerHTML = v();
}

let adminPasswordResolve = null;
let adminPasswordPromise = null;
function askAdminPassword() {
  if (adminPasswordPromise) return adminPasswordPromise;
  adminPasswordPromise = new Promise((resolve) => {
    adminPasswordResolve = resolve;
    modal(`<h3>Password admin</h3><p class="sub">Masukkan password admin untuk membuka Data & Import.</p>
      <label>Password admin<input id="admin-pw" type="password" autocomplete="current-password"></label>
      <div class="actions"><button class="btn" data-act="cancelAdminPassword">Batal</button><button class="btn primary" data-act="confirmAdminPassword">Lanjutkan</button></div>`);
    $('#admin-pw').focus();
  });
  return adminPasswordPromise;
}
async function authorizeAdmin() {
  const password = await askAdminPassword();
  if (!password) return false;
  try {
    await api('/api/admin/verify', { method: 'POST', adminPassword: password });
    S.adminPassword = password;
    return true;
  } catch (e) {
    toast(e.message, true);
    return false;
  }
}
function finishAdminPassword(password) {
  if (!adminPasswordResolve) return;
  const resolve = adminPasswordResolve;
  adminPasswordResolve = null;
  adminPasswordPromise = null;
  closeModal();
  resolve(password);
}

function vDashboard() {
  const d = S.d, act_ = active(d.stock), total = sum(act_);
  const bySt = d.statuses.map((s) => ({ ...s, n: sum(d.stock.filter((x) => x.status === s.key)) }));
  const attention = d.stock.filter((x) => ['MAINTENANCE', 'INCOMPLETE', 'RUSAK'].includes(x.status));
  const reqSets = sum(d.openReq);
  const summaryCards = (items) => items.map((i) => `<div class="summary-card"><b>${esc(i.name)}</b><strong>${i.val}</strong><small>set aktif</small></div>`).join('') || '<div class="empty">Belum ada data</div>';
  const byLoc = d.locations.map((l) => ({ name: l.name, val: sum(act_.filter((x) => x.location_id === l.id)) }));
  const byType = d.types.map((t) => ({ name: t.name, val: sum(act_.filter((x) => x.type_id === t.id)) }));
  const byStyle = d.styles.map((s) => ({ name: s.name, val: sum(act_.filter((x) => x.style_id === s.id)) }));
  let acc = 0;
  const totalByStatus = sum(bySt, (x) => x.n) || 1;
  const statusGradient = bySt.filter((s) => s.n).map((s) => {
    const start = acc;
    acc += (s.n / totalByStatus) * 100;
    return `${s.color} ${start}% ${acc}%`;
  }).join(',') || '#e5e9f2 0 100%';
  if (!d.stock.length && !d.requests.length) {
    return `<div class="head"><div><h1>Selamat datang 👋</h1><p>Data tooling masih kosong. Mulai dengan mengunggah file Excel yang dipakai sekarang.</p></div></div>
      <div class="card" style="text-align:center;padding:50px"><div style="font-size:44px">📦</div><h3 style="justify-content:center">Belum ada data tooling</h3>
      <p style="color:var(--mut)">Unggah file <b>DATA KETERSEDIAAN TOOLING.xlsx</b> sekali saja, setelah itu semua dikelola dari sini.</p>
      <button class="btn primary" data-act="nav" data-v="data">Unggah file Excel</button></div>`;
  }
  return `
  <div class="head"><div><h1>Ringkasan Tooling</h1><p>Semua angka stok dalam satuan set. Total aktif tidak menghitung tooling rusak; request ditampilkan terpisah.</p></div>
    <div class="row"><button class="btn" data-act="newReq">＋ On Request</button><button class="btn primary" data-act="newStock">＋ Tambah Tooling</button></div></div>
  <div class="grid kpis">
    <div class="card kpi"><div class="ic">📦</div><div><b>${total}</b><span>Total tooling aktif</span><small>${d.styles.length} style · tidak termasuk rusak</small></div></div>
    <div class="card kpi"><div class="ic" style="background:#dcfce7">✅</div><div><b>${sum(d.stock.filter((x) => x.status === 'TERSEDIA'))}</b><span>Tersedia</span><small>${sum(d.stock.filter((x) => x.status === 'DIPAKAI'))} sedang dipakai</small></div></div>
    <div class="card kpi"><div class="ic" style="background:#fef3c7">🛠️</div><div><b>${sum(attention)}</b><span>Perlu perhatian</span><small>maintenance / kurang komponen / rusak</small></div></div>
    <div class="card kpi"><div class="ic" style="background:#e0f2fe">🚚</div><div><b>${reqSets}</b><span>Sedang on request (set)</span><small>${d.openReq.length} permintaan berjalan</small></div></div>
  </div>
  <div class="card dashboard-section"><h3>Status Tooling</h3><p class="chart-note">Jumlah set menurut status, termasuk yang rusak.</p>
    <div class="donut-wrap"><div class="donut" style="background:conic-gradient(${statusGradient})" data-c="${sum(bySt, (x) => x.n)}"></div>
      <div class="legend">${bySt.map((s) => `<div><i style="background:${s.color}"></i>${esc(s.label)}<em>${s.n}</em></div>`).join('')}</div>
    </div>
  </div>
  <div class="card dashboard-section"><h3>Gedung</h3><div class="summary-grid">${summaryCards(byLoc)}</div>  </div>
  <div class="card dashboard-section"><h3>Jenis Tooling</h3><div class="summary-grid">${summaryCards(byType)}</div></div>
  <div class="card dashboard-section"><h3>Style</h3><div class="summary-grid">${summaryCards(byStyle)}</div></div>
  <div class="grid g2">
    <div class="card"><h3>Perlu Perhatian <small>klik untuk mengelola</small></h3><div class="list">${attention.length ? attention.slice(0, 8).map((x) => {
      const st = d.stBy[x.status]; return `<div class="item click" data-act="cell" data-s="${x.style_id}" data-t="${x.type_id}" data-l="${x.location_id}">
        <div class="dot" style="background:${st.color}22;color:${st.color}">●</div><div><b>${esc(nm(d.sBy, x.style_id))} · ${esc(nm(d.tBy, x.type_id))}</b><small>${esc(nm(d.lBy, x.location_id))}${x.note ? ' — ' + esc(x.note) : ''}</small></div>
        <div class="r"><span class="chip" style="--c:${st.color}">${x.qty} set ${st.label}</span></div></div>`; }).join('') : '<div class="empty">Semua tooling dalam kondisi baik 🎉</div>'}</div></div>
    <div class="card"><h3>Request Berjalan <small><a href="#request" data-act="nav" data-v="request" style="color:var(--pri)">lihat semua</a></small></h3><div class="list">${d.openReq.length ? d.openReq.slice(0, 6).map((r) => `
      <div class="item"><div class="dot">🚚</div><div><b>${esc(nm(d.sBy, r.style_id))} · ${esc(nm(d.tBy, r.type_id))}</b><small>${r.qty} set → ${esc(r.target_location_id ? nm(d.lBy, r.target_location_id) : 'gedung belum ditentukan')}${r.due_date ? ' · target ' + fmtDay(r.due_date) : ''}</small></div>
      <div class="r"><span class="pill ${r.status}">${RQ_LABEL[r.status]}</span></div></div>`).join('') : '<div class="empty">Tidak ada request berjalan</div>'}</div></div>
  </div>
  <div class="card"><h3>Aktivitas Terbaru <small><a href="#history" data-act="nav" data-v="history" style="color:var(--pri)">semua riwayat</a></small></h3><div class="list">${d.movements.slice(0, 6).map(mvItem).join('') || '<div class="empty">Belum ada aktivitas</div>'}</div></div>`;
}

function mvText(m) {
  const d = S.d, L = (id) => nm(d.lBy, id), st = (k) => (d.stBy[k] ? d.stBy[k].label : k);
  const A = m.action;
  if (A === 'PINDAH') return [`Pindah ${m.qty} set`, `${L(m.from_location_id)} → ${L(m.to_location_id)}` + (m.from_status !== m.to_status ? ` (${st(m.from_status)} → ${st(m.to_status)})` : ''), '↔️'];
  if (A === 'ATUR') return [`${m.qty > 0 ? '+' : ''}${m.qty} set ${st(m.to_status)}`, `di ${L(m.to_location_id)}`, '✏️'];
  if (A === 'CATATAN') return ['Catatan diperbarui', `di ${L(m.to_location_id)}`, '📝'];
  if (A === 'REQUEST') return [`Request baru ${m.qty} set`, m.to_location_id ? `tujuan ${L(m.to_location_id)}` : '', '🚚'];
  if (A === 'REQUEST_REVISI') return ['Data request direvisi', m.note || '', '✏️'];
  if (A === 'TERIMA') return [`Diterima ${m.qty} set`, `masuk stok ${L(m.to_location_id)}`, '✅'];
  if (A.startsWith('REQUEST_')) return [`Request → ${RQ_LABEL[A.slice(8)] || A.slice(8)}`, `${m.qty} set`, '🔔'];
  if (A === 'IMPORT') return ['Import Excel', `${m.qty} set`, '📥'];
  if (A === 'HAPUS_JENIS') return ['Jenis tooling dihapus', m.note || '', '🗑️'];
  if (A === 'HAPUS_STYLE') return ['Style dihapus', m.note || '', '🗑️'];
  return [A, '', '•'];
}
function mvItem(m) {
  const [t, s, ic] = mvText(m);
  const who = m.style_id ? `${esc(nm(S.d.sBy, m.style_id))} · ${esc(nm(S.d.tBy, m.type_id))}` : '';
  return `<div class="item"><div class="dot">${ic}</div><div><b>${esc(t)}${who ? ' — ' + who : ''}</b><small>${esc(s)}${m.note && m.action !== 'HAPUS_STYLE' ? ' · ' + esc(m.note) : ''}</small></div><div class="r"><small>${fmtDate(m.ts)}</small><small>${esc(m.actor || '')}</small></div></div>`;
}

/* ---------- Matriks ---------- */
function cellData(sid, tid, lid) {
  const f = S.f.status;
  const rows = stockOf(sid, tid, lid).filter((r) => !f || r.status === f);
  return { rows, qty: sum(f ? rows : active(rows)) };
}
function vMatrix() {
  const d = S.d, f = S.f;
  return `<div class="head"><div><h1>Matriks Tooling</h1><p>Posisi tooling tiap style per gedung — klik angka untuk mengubah jumlah, status, atau memindahkan.</p></div>
    <div class="row"><button class="btn" data-act="newReq">＋ On Request</button><button class="btn primary" data-act="newStock">＋ Tambah Tooling</button></div></div>
  <div class="toolbar">
    <input id="f-q" placeholder="🔍 Cari style…" value="${esc(f.q)}">
    <select id="f-loc"><option value="">Semua gedung</option>${d.locations.map((l) => `<option value="${l.id}" ${String(l.id) === String(f.loc) ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select>
    <select id="f-type"><option value="">Semua jenis tooling</option>${d.types.map((t) => `<option value="${t.id}" ${String(t.id) === String(f.type) ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>
    <select id="f-status"><option value="">Semua status</option>${d.statuses.map((s) => `<option value="${s.key}" ${s.key === f.status ? 'selected' : ''}>${s.label}</option>`).join('')}</select>
  </div><div id="mx">${matrixTable()}</div>`;
}
function matrixTable() {
  const d = S.d, f = S.f, q = f.q.trim().toUpperCase();
  const locs = f.loc ? d.locations.filter((l) => String(l.id) === String(f.loc)) : d.locations;
  const body = []; const colTot = locs.map(() => 0); let shown = 0, grand = 0, grandReq = 0;
  for (const s of d.styles) {
    if (q && !s.name.includes(q)) continue;
    const types = d.types.filter((t) => (!f.type || String(t.id) === String(f.type)) &&
      (d.stock.some((x) => x.style_id === s.id && x.type_id === t.id) || d.openReq.some((x) => x.style_id === s.id && x.type_id === t.id)));
    const rowsData = types.map((t) => {
      const cells = locs.map((l) => ({ l, ...cellData(s.id, t.id, l.id) }));
      return { t, cells, total: sum(cells, (c) => c.qty), req: sum(d.openReq.filter((x) => x.style_id === s.id && x.type_id === t.id)) };
    }).filter((r) => (!f.status && !f.loc) || r.total > 0);
    if ((f.status || f.loc || f.type) && !rowsData.length) continue;
    if (!rowsData.length && !(f.status || f.loc || f.type)) {
      body.push(`<tr class="empty-row grp-end"><td class="sty"><b>${esc(s.name)}</b><small>Belum ada tooling</small><button class="plus" title="Tambah tooling" data-act="addfor" data-s="${s.id}">＋</button></td><td class="typ" colspan="${locs.length + 3}">belum ada tooling untuk style ini</td></tr>`);
      shown++; continue;
    }
    shown++;
    const sTotal = sum(rowsData, (r) => r.total), sReq = sum(rowsData, (r) => r.req);
    rowsData.forEach((r, i) => {
      const first = i === 0 ? `<td class="sty" rowspan="${rowsData.length}"><b>${esc(s.name)}</b><small>Total ${sTotal} set${sReq ? ` · <span style="color:#b45309;font-weight:700">+${sReq} request → ${sTotal + sReq}</span>` : ''}</small><button class="plus" title="Tambah tooling untuk ${esc(s.name)}" data-act="addfor" data-s="${s.id}">＋</button></td>` : '';
      const tds = r.cells.map((c, ci) => {
        colTot[ci] += c.qty;
        const chips = c.rows.filter((x) => x.status !== 'TERSEDIA' && !f.status).map((x) => `<i class="chip" style="--c:${d.stBy[x.status].color}">${x.qty} ${SHORT[x.status]}</i>`).join('');
        const tip = c.rows.map((x) => `${d.stBy[x.status].label}: ${x.qty}${x.note ? ' — ' + x.note : ''}`).join('\n');
        return `<td class="c"><button class="cell ${c.qty || c.rows.length ? '' : 'zero'}" data-act="cell" data-s="${s.id}" data-t="${r.t.id}" data-l="${c.l.id}" title="${esc(tip)}"><b>${c.qty || (c.rows.length ? 0 : '·')}</b>${chips ? `<span class="chips">${chips}</span>` : ''}</button></td>`;
      }).join('');
      grand += r.total; grandReq += r.req;
      body.push(`<tr class="${i === rowsData.length - 1 ? 'grp-end' : ''}">${first}<td class="typ">${esc(r.t.name)}</td>${tds}<td class="tot">${r.total}</td><td class="req">${r.req ? '+' + r.req : ''}</td></tr>`);
    });
  }
  if (!shown) return '<div class="card empty">Tidak ada data yang cocok dengan filter.</div>';
  return `<div class="tbl-wrap"><table><thead><tr><th class="sty">Style</th><th style="text-align:left">Tooling</th>${locs.map((l) => `<th>${esc(l.name)}</th>`).join('')}<th>Total</th><th>On Request</th></tr></thead>
    <tbody>${body.join('')}</tbody>
    <tfoot><tr><td class="sty">TOTAL</td><td></td>${colTot.map((n) => `<td>${n}</td>`).join('')}<td>${grand}</td><td style="color:#b45309">${grandReq ? '+' + grandReq : ''}</td></tr></tfoot></table></div>`;
}

/* ---------- On Request ---------- */
function vRequest() {
  const d = S.d;
  const list = d.requests.filter((r) => (S.rq === 'open' ? OPEN.includes(r.status) : S.rq === 'done' ? !OPEN.includes(r.status) : true));
  const btns = (r) => {
    const b = [];
    if (OPEN.includes(r.status)) b.push(`<button class="btn sm" data-act="editReq" data-id="${r.id}">Revisi data</button>`);
    if (r.status === 'DIAJUKAN') b.push(`<button class="btn sm" data-act="rqs" data-id="${r.id}" data-st="DIPROSES">Mulai dibuat</button>`);
    if (r.status === 'DIPROSES') b.push(`<button class="btn sm" data-act="rqs" data-id="${r.id}" data-st="SIAP">Tandai siap</button>`);
    if (OPEN.includes(r.status)) b.push(`<button class="btn sm ok" data-act="rqRecv" data-id="${r.id}">Terima ke stok</button>`, `<button class="btn sm danger" data-act="rqs" data-id="${r.id}" data-st="DIBATALKAN">Batal</button>`);
    if (r.status === 'DIBATALKAN') b.push(`<button class="btn sm danger" data-act="rqDel" data-id="${r.id}">Hapus</button>`);
    return b.join(' ');
  };
  return `<div class="head"><div><h1>On Request</h1><p>Tooling yang sedang diminta/dibuat. Jumlahnya ikut dihitung sebagai proyeksi total style, dan masuk stok saat diterima.</p></div>
    <button class="btn primary" data-act="newReq">＋ Request Baru</button></div>
  <div class="toolbar"><div class="tabs">${[['open', 'Berjalan'], ['done', 'Selesai / Batal'], ['all', 'Semua']].map(([k, l]) => `<button data-act="rqTab" data-k="${k}" class="${S.rq === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
  ${list.length ? `<div class="tbl-wrap"><table class="plain"><thead><tr><th>#</th><th>Style</th><th>Jenis tooling</th><th>Jumlah</th><th>Gedung tujuan</th><th>Target</th><th>Peminta</th><th>Status</th><th></th></tr></thead><tbody>
  ${list.map((r) => `<tr><td>${r.id}</td><td><b>${esc(nm(d.sBy, r.style_id))}</b></td><td>${esc(nm(d.tBy, r.type_id))}${r.note ? `<br><small style="color:var(--mut)">${esc(r.note)}</small>` : ''}</td><td><b>${r.qty}</b> set</td>
  <td>${r.target_location_id ? esc(nm(d.lBy, r.target_location_id)) : '<span style="color:var(--mut)">belum ditentukan</span>'}</td><td>${fmtDay(r.due_date) || '-'}</td><td>${esc(r.requested_by || '-')}</td>
  <td><span class="pill ${r.status}">${RQ_LABEL[r.status]}</span></td><td style="white-space:nowrap">${btns(r)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="card empty">Tidak ada request di tab ini.</div>'}`;
}

/* ---------- Riwayat ---------- */
function vHistory() {
  const imports = S.d.imports || [];
  const importItems = imports.map((batch) => {
    const details = Array.isArray(batch.details) ? batch.details : typeof batch.details === 'string' ? JSON.parse(batch.details) : [];
    const rows = details.map((item) => `<tr><td>${esc(item.style)}</td><td>${esc(item.type)}</td><td>${esc(item.location)}</td><td>${esc(S.d.stBy[item.status]?.label || item.status)}</td><td>${item.qty} set</td><td>${esc(item.note || '-')}</td></tr>`).join('');
    return `<details class="history-import"><summary><span><b>Upload Excel — ${esc(batch.filename)}</b><small>${fmtDate(batch.ts)} · ${batch.item_count} baris · ${batch.total_qty} set · ${batch.replace_stock ? 'mengganti stok' : 'menggabungkan data'}</small></span><span class="history-pics">Diminta: ${esc(batch.requested_by)} · Diunggah: ${esc(batch.actor)}</span></summary>
      <div class="mini-tbl"><table class="plain"><thead><tr><th>Style</th><th>Jenis tooling</th><th>Gedung</th><th>Status</th><th>Jumlah</th><th>Catatan</th></tr></thead><tbody>${rows || '<tr><td colspan="6">Tidak ada baris stok pada file ini.</td></tr>'}</tbody></table></div></details>`;
  });
  const movements = S.d.movements
    .filter((m) => m.action !== 'IMPORT' || !imports.some((batch) => m.note?.includes(batch.filename) && Number(m.qty) === Number(batch.total_qty)))
    .map((m) => ({ ts: m.ts, html: mvItem(m) }));
  const batchEntries = imports.map((batch, index) => ({ ts: batch.ts, html: importItems[index] }));
  const entries = [...movements, ...batchEntries].sort((a, b) => new Date(b.ts) - new Date(a.ts));
  return `<div class="head"><div><h1>Riwayat Perubahan</h1><p>Aktivitas request, penambahan dan perubahan stok, serta detail file Excel yang diimpor.</p></div></div>
  <div class="card"><div class="list">${entries.map((item) => item.html).join('') || '<div class="empty">Belum ada aktivitas</div>'}</div></div>`;
}

/* ---------- Data & Import ---------- */
function vData() {
  const d = S.d, p = S.preview;
  return `<div class="head"><div><h1>Data & Import</h1><p>Unggah Excel untuk data awal, unduh kembali dalam format yang sama, dan kelola daftar master.</p></div></div>
  <div class="grid g2">
   <div class="card" style="grid-column:1/-1"><h3>1 · Impor dari Excel</h3>
    <label class="drop" id="drop"><input type="file" id="file" accept=".xlsx" hidden><b>Klik atau tarik file .xlsx ke sini</b><span>Format sama seperti "DATA KETERSEDIAAN TOOLING" yang dipakai sekarang</span></label>
    ${p ? `<div id="prev"><div class="stats"><div class="stat"><b>${p.summary.styles}</b><span>style</span></div><div class="stat"><b>${p.summary.rows}</b><span>baris stok</span></div><div class="stat"><b>${p.summary.totalSet}</b><span>total set</span></div>
      ${Object.entries(p.summary.byLocation).map(([k, v]) => `<div class="stat"><b>${v}</b><span>${esc(k)}</span></div>`).join('')}</div>
      ${p.summary.stylesWithoutTooling.length ? `<p style="color:var(--mut)">Style tanpa tooling di Excel (tetap dibuat): ${p.summary.stylesWithoutTooling.map(esc).join(', ')}</p>` : ''}
      ${p.warnings.length ? `<b>${p.warnings.length} sel berisi catatan</b> <small style="color:var(--mut)">— catatan disimpan; yang bertanda “kurang/hanya” otomatis berstatus Kurang Komponen. Silakan cek:</small>
      <div class="mini-tbl"><table class="plain"><thead><tr><th>Style</th><th>Tooling</th><th>Gedung</th><th>Teks asli</th><th>Dibaca</th></tr></thead><tbody>${p.warnings.map((w) => `<tr><td>${esc(w.style)}</td><td>${esc(w.type)}</td><td>${esc(w.location)}</td><td>${esc(w.raw)}</td><td><b>${w.qty} set</b></td></tr>`).join('')}</tbody></table></div>` : ''}
      <div class="grid2" style="margin-top:16px"><label>PIC yang meminta import<input id="import-requested-by" placeholder="Nama PIC peminta"></label><p class="chart-note">PIC yang mengunggah: <b>${esc(S.actor || 'belum diisi')}</b> (diambil dari menu samping).</p></div>
      <div class="row" style="margin-top:16px"><label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="replace" checked style="width:auto;margin:0"> Ganti semua stok lama (disarankan untuk data awal)</label>
      <span class="sp" style="flex:1"></span><button class="btn" data-act="impCancel">Batal</button><button class="btn primary" data-act="impGo">Impor sekarang</button></div></div>` : ''}
   </div>
   <div class="card"><h3>2 · Unduh ke Excel</h3><p style="color:var(--mut)">Susunan sama seperti file asli (style × jenis × gedung), jumlah berupa angka sehingga kolom Total benar-benar menjumlahkan, ditambah kolom On Request dan catatan status.</p><a class="btn primary" href="/api/export">⬇ Unduh Excel</a></div>
   <div class="card"><h3>3 · Master data</h3>
    <div class="grid2" style="display:grid;grid-template-columns:1fr auto;gap:8px;align-items:end;margin-bottom:10px"><label>Style baru<input id="ns" placeholder="mis. U740"></label><button class="btn" data-act="addMaster" data-k="styles" data-i="ns">Tambah</button></div>
    <div class="grid2" style="display:grid;grid-template-columns:1fr auto;gap:8px;align-items:end;margin-bottom:10px"><label>Gedung / lokasi baru<input id="nl" placeholder="mis. Gedung J"></label><button class="btn" data-act="addMaster" data-k="locations" data-i="nl">Tambah</button></div>
    <div class="grid2" style="display:grid;grid-template-columns:1fr auto;gap:8px;align-items:end;margin-bottom:10px"><label>Jenis tooling baru<input id="nt" placeholder="mis. Heat Press Die"></label><button class="btn" data-act="addMaster" data-k="types" data-i="nt">Tambah</button></div>
    <div class="grid2" style="display:grid;grid-template-columns:1fr auto;gap:8px;align-items:end;margin-bottom:10px"><label>Hapus jenis tooling<select id="dt">${d.types.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></label><button class="btn danger" data-act="delType">Hapus jenis</button></div>
    <div class="grid2" style="display:grid;grid-template-columns:1fr auto;gap:8px;align-items:end"><label>Hapus style<select id="ds">${d.styles.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></label><button class="btn danger" data-act="delStyle">Hapus</button></div>
   </div>
  </div>`;
}

/* ---------- Modal ---------- */
const modal = (h) => { $('#modal').innerHTML = `<div class="ov"><div class="mdl" role="dialog">${h}</div></div>`; };
const closeModal = () => { $('#modal').innerHTML = ''; };
const opts = (arr, sel) => arr.map((x) => `<option value="${x.id}" ${String(x.id) === String(sel) ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
const styleByName = (n) => S.d.styles.find((s) => s.name === n.trim().toUpperCase());

function stockModal({ sid, tid, lid, lock } = {}) {
  const d = S.d;
  modal(`<h3>${lock ? 'Kelola Tooling' : 'Tambah Tooling'}</h3><p class="sub">${lock ? 'Ubah jumlah per status. Isi 0 untuk menghapus baris.' : 'Pilih style (atau ketik style baru), jenis, dan gedung, lalu isi jumlah sesuai statusnya.'}</p>
  <div class="grid3" id="scope">
    <label>Style<input id="m-style" list="dl-s" value="${sid ? esc(nm(d.sBy, sid)) : ''}" ${lock ? 'disabled' : ''} placeholder="Pilih / ketik baru"></label>
    <label>Jenis tooling<select id="m-type" ${lock ? 'disabled' : ''}>${opts(d.types, tid || d.types[0]?.id)}</select></label>
    <label>Gedung<select id="m-loc" ${lock ? 'disabled' : ''}>${opts(d.locations, lid || d.locations[0]?.id)}</select></label>
  </div><datalist id="dl-s">${d.styles.map((s) => `<option value="${esc(s.name)}">`).join('')}</datalist>
  <div id="m-rows"></div>
  <label>PIC yang meminta penambahan<input id="m-requested-by" placeholder="Nama PIC peminta"></label>
  <p class="chart-note">PIC yang menambahkan diambil dari nama PIC di bagian bawah menu samping.</p>
  <div class="hint">Contoh: ada 5 set di gedung ini, 2 di antaranya sedang diperbaiki → <b>Tersedia 3</b> dan <b>Maintenance 2</b>. Catatan boleh diisi (mis. “kurang size 2,3,9”).</div>
  <div class="actions">${lock ? '<button class="btn sp" data-act="moveBtn">↔ Pindahkan ke gedung lain</button>' : ''}<button class="btn" data-act="close">Batal</button><button class="btn primary" data-act="saveStock">Simpan</button></div>`);
  fillRows();
}
function fillRows() {
  const s = styleByName($('#m-style').value || ''), t = +$('#m-type').value, l = +$('#m-loc').value;
  const cur = s ? stockOf(s.id, t, l) : [];
  $('#m-rows').innerHTML = S.d.statuses.map((st) => {
    const r = cur.find((x) => x.status === st.key);
    return `<div class="srow"><span><i style="background:${st.color}"></i>${st.label}</span><input type="number" min="0" id="q-${st.key}" value="${r ? r.qty : 0}"><input id="n-${st.key}" placeholder="Catatan (opsional)" value="${esc(r?.note || '')}"></div>`;
  }).join('');
}
async function saveStock() {
  const name = $('#m-style').value.trim().toUpperCase();
  if (!name) return toast('Style wajib diisi', true);
  const t = +$('#m-type').value, l = +$('#m-loc').value;
  const rows = S.d.statuses.map((st) => ({ status: st.key, qty: +$('#q-' + st.key).value || 0, note: $('#n-' + st.key).value }));
  const style = styleByName(name);
  const current = style ? stockOf(style.id, t, l) : [];
  const addsStock = rows.some((r) => r.qty > (current.find((x) => x.status === r.status)?.qty || 0));
  const requestedBy = $('#m-requested-by').value.trim();
  if (addsStock && !S.actor.trim()) return toast('Isi dulu nama PIC yang menambahkan di bagian bawah menu samping.', true);
  if (addsStock && !requestedBy) return toast('Nama PIC yang meminta wajib diisi.', true);
  const ok = await act(async () => {
    let s = style;
    if (!s) s = await api('/api/styles', { method: 'POST', json: { name } });
    await api('/api/stock/bulk', { method: 'POST', json: { style_id: s.id, type_id: t, location_id: l, rows, requested_by: requestedBy } });
    return true;
  }, 'Tersimpan');
  if (ok) closeModal();
}
function moveModal({ sid, tid, lid }) {
  const d = S.d, rows = stockOf(sid, tid, lid);
  if (!rows.length) return toast('Belum ada tooling di gedung ini untuk dipindahkan', true);
  modal(`<h3>Pindahkan Tooling</h3><p class="sub">${esc(nm(d.sBy, sid))} · ${esc(nm(d.tBy, tid))} — dari <b>${esc(nm(d.lBy, lid))}</b></p>
  <div class="grid2"><label>Status yang dipindah<select id="mv-st">${rows.map((r) => `<option value="${r.status}">${d.stBy[r.status].label} (${r.qty} set)</option>`).join('')}</select></label>
  <label>Jumlah (set)<input type="number" id="mv-q" min="1" value="1"></label></div>
  <div class="grid2"><label>Gedung tujuan<select id="mv-to">${opts(d.locations.filter((l) => l.id !== lid), '')}</select></label>
  <label>Status di tujuan<select id="mv-st2"><option value="">Sama seperti asal</option>${d.statuses.map((s) => `<option value="${s.key}">${s.label}</option>`).join('')}</select></label></div>
  <label>Catatan<input id="mv-n" placeholder="mis. dipakai untuk line 5"></label>
  <div class="actions"><button class="btn" data-act="close">Batal</button><button class="btn primary" data-act="doMove" data-s="${sid}" data-t="${tid}" data-l="${lid}">Pindahkan</button></div>`);
}
function reqModal(pre = {}) {
  const d = S.d, r = pre.request;
  modal(`<h3>${r ? 'Revisi Request Tooling' : 'On Request Tooling'}</h3><p class="sub">${r ? 'Perbarui data request yang sedang dalam pembuatan.' : 'Catat tooling yang diminta/akan dibuat. Setelah diterima, otomatis masuk stok gedung tujuan.'}</p>
  <div class="grid2"><label>Style<input id="r-style" list="dl-s2" placeholder="Pilih / ketik style baru" value="${esc(r ? nm(d.sBy, r.style_id) : pre.sid ? nm(d.sBy, pre.sid) : '')}"></label>
  <label>Jenis tooling<select id="r-type">${opts(d.types, r?.type_id)}</select></label></div><datalist id="dl-s2">${d.styles.map((s) => `<option value="${esc(s.name)}">`).join('')}</datalist>
  <div class="grid3"><label>Jumlah (set)<input type="number" id="r-qty" min="1" value="${r ? r.qty : 1}"></label>
  <label>Gedung tujuan<select id="r-loc"><option value="">Belum ditentukan</option>${opts(d.locations, r?.target_location_id)}</select></label>
  <label>Target tanggal<input type="date" id="r-due" value="${esc(r?.due_date || '')}"></label></div>
  <div class="grid2"><label>PIC yang meminta<input id="r-by" placeholder="Nama PIC peminta" value="${esc(r ? r.requested_by : S.actor)}"></label><label>Catatan<input id="r-note" placeholder="opsional" value="${esc(r?.note || '')}"></label></div>
  <p class="chart-note">PIC peminta otomatis mengikuti nama PIC di bagian bawah menu samping.</p>
  <div class="actions"><button class="btn" data-act="close">Batal</button><button class="btn primary" data-act="saveReq" ${r ? `data-id="${r.id}"` : ''}>${r ? 'Simpan Revisi' : 'Ajukan Request'}</button></div>`);
}
function recvModal(id) {
  const r = S.d.requests.find((x) => x.id === id); const d = S.d;
  modal(`<h3>Terima Tooling</h3><p class="sub"><b>${r.qty} set</b> ${esc(nm(d.tBy, r.type_id))} untuk <b>${esc(nm(d.sBy, r.style_id))}</b> akan masuk ke stok sebagai <i>Tersedia</i>.</p>
  <label>Diterima di gedung<select id="rc-loc">${opts(d.locations, r.target_location_id)}</select></label>
  <div class="actions"><button class="btn" data-act="close">Batal</button><button class="btn ok" data-act="doRecv" data-id="${id}">Terima & masukkan ke stok</button></div>`);
}

/* ---------- Event delegasi ---------- */
document.addEventListener('click', async (e) => {
  if (e.target.classList && e.target.classList.contains('ov')) {
    if (adminPasswordResolve) finishAdminPassword(null);
    else closeModal();
    return;
  }
  const el = e.target.closest('[data-act]'); if (!el) return;
  const a = el.dataset.act, D = el.dataset;
  const ids = () => ({ sid: +D.s, tid: +D.t, lid: +D.l });
  switch (a) {
    case 'nav': {
      if (D.v === 'data' && !S.adminPassword && !(await authorizeAdmin())) break;
      if (S.view === 'data' && D.v !== 'data') S.adminPassword = null;
      S.view = D.v; location.hash = D.v; render(); window.scrollTo(0, 0); break;
    }
    case 'close': closeModal(); break;
    case 'cell': stockModal({ ...ids(), lock: true }); break;
    case 'addfor': stockModal({ sid: +D.s }); break;
    case 'newStock': stockModal({}); break;
    case 'saveStock': saveStock(); break;
    case 'moveBtn': { const sid = styleByName($('#m-style').value).id; moveModal({ sid, tid: +$('#m-type').value, lid: +$('#m-loc').value }); break; }
    case 'doMove': {
      const ok = await act(() => api('/api/stock/move', { method: 'POST', json: { style_id: +D.s, type_id: +D.t, from_location_id: +D.l, to_location_id: +$('#mv-to').value, status: $('#mv-st').value, to_status: $('#mv-st2').value || $('#mv-st').value, qty: +$('#mv-q').value, note: $('#mv-n').value } }), 'Tooling dipindahkan');
      if (ok) closeModal(); break;
    }
    case 'newReq': reqModal(); break;
    case 'editReq': {
      const request = S.d.requests.find((r) => r.id === +D.id);
      if (request && OPEN.includes(request.status)) reqModal({ request });
      break;
    }
    case 'saveReq': {
      const name = $('#r-style').value.trim().toUpperCase(); if (!name) return toast('Style wajib diisi', true);
      if (!S.actor.trim()) return toast('Isi dulu nama PIC yang mencatat di bagian bawah menu samping.', true);
      if (!$('#r-by').value.trim()) return toast('Nama PIC yang meminta wajib diisi.', true);
      const s = styleByName(name);
      const editing = !!D.id;
      const ok = await act(() => api(editing ? '/api/requests/' + D.id : '/api/requests', {
        method: editing ? 'PUT' : 'POST',
        json: { style_id: s ? s.id : null, style_name: name, type_id: +$('#r-type').value, qty: +$('#r-qty').value, target_location_id: $('#r-loc').value || null, due_date: $('#r-due').value || null, requested_by: $('#r-by').value, note: $('#r-note').value },
      }), editing ? 'Data request diperbarui' : 'Request dicatat');
      if (ok) { closeModal(); }
      break;
    }
    case 'rqTab': S.rq = D.k; render(); break;
    case 'rqs': act(() => api('/api/requests/' + D.id, { method: 'PATCH', json: { status: D.st } }), 'Status diperbarui'); break;
    case 'rqRecv': recvModal(+D.id); break;
    case 'doRecv': {
      const target_location_id = $('#rc-loc').value;
      if (!S.actor.trim()) return toast('Isi dulu nama PIC yang menerima di bagian bawah menu samping.', true);
      const ok = await act(() => api('/api/requests/' + D.id, { method: 'PATCH', json: { status: 'DITERIMA', target_location_id } }), 'Tooling masuk stok');
      if (ok) closeModal();
      break;
    }
    case 'rqDel': if (confirm('Hapus request ini?')) act(() => api('/api/requests/' + D.id, { method: 'DELETE' }), 'Request dihapus'); break;
    case 'impCancel': S.preview = null; render(); break;
    case 'impGo': {
      const p = S.preview;
      const replace = $('#replace').checked;
      const requested_by = $('#import-requested-by').value.trim();
      if (!S.actor.trim()) return toast('Isi dulu nama PIC yang mengunggah di bagian bawah menu samping.', true);
      if (!requested_by) return toast('Nama PIC yang meminta import wajib diisi.', true);
      const newTypes = p.types.some((name) => !S.d.types.some((type) => type.name.toLowerCase() === name.toLowerCase()));
      if (newTypes && !S.adminPassword && !(await authorizeAdmin())) break;
      const ok = await act(() => api('/api/import/commit', { method: 'POST', json: { styles: p.styles, types: p.types, locations: p.locations, items: p.items, replace, filename: p.filename, requested_by } }), `Import selesai: ${p.summary.totalSet} set`);
      if (ok) { S.preview = null; S.adminPassword = null; S.view = 'dashboard'; location.hash = 'dashboard'; render(); }
      break;
    }
    case 'addMaster': {
      const v = $('#' + D.i).value;
      if (!v.trim()) return;
      const ok = await act(() => api('/api/' + D.k, { method: 'POST', json: { name: v } }), 'Ditambahkan');
      if (ok) render();
      break;
    }
    case 'delType': {
      const select = $('#dt');
      if (!select.value) return toast('Pilih jenis tooling yang akan dihapus.', true);
      const typeId = +select.value;
      const typeName = select.options[select.selectedIndex].text;
      const stockRows = S.d.stock.filter((x) => x.type_id === typeId);
      const stockSets = sum(stockRows);
      const requests = S.d.requests.filter((x) => x.type_id === typeId);
      const detail = `${stockSets} set stok di ${stockRows.length} baris dan ${requests.length} request`;
      const question = stockRows.length || requests.length
        ? `Jenis "${typeName}" masih digunakan (${detail}). Hapus jenis ini beserta semua stok dan request terkait? Riwayat aktivitas tetap disimpan.`
        : `Hapus jenis "${typeName}"?`;
      if (!confirm(question)) break;
      const ok = await act(() => api('/api/types/' + typeId, { method: 'DELETE' }), 'Jenis tooling dihapus');
      if (ok) render();
      break;
    }
    case 'cancelAdminPassword': finishAdminPassword(null); break;
    case 'confirmAdminPassword': {
      const password = $('#admin-pw').value;
      if (!password) return toast('Password wajib diisi', true);
      finishAdminPassword(password);
      break;
    }
    case 'delStyle': { const sel = $('#ds'); if (!sel.value) return; if (confirm(`Hapus style ${sel.options[sel.selectedIndex].text} beserta semua stok & request-nya?`)) act(() => api('/api/styles/' + sel.value, { method: 'DELETE' }), 'Style dihapus'); break; }
  }
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'f-q') { S.f.q = e.target.value; $('#mx').innerHTML = matrixTable(); }
  if (e.target.id === 'actor') { S.actor = e.target.value; localStorage.setItem('actor', S.actor); }
});
document.addEventListener('change', (e) => {
  const id = e.target.id;
  if (id === 'f-loc' || id === 'f-type' || id === 'f-status') { S.f[id.slice(2)] = e.target.value; $('#mx').innerHTML = matrixTable(); }
  if (e.target.closest && e.target.closest('#scope')) fillRows();
  if (id === 'file' && e.target.files[0]) uploadPreview(e.target.files[0]);
});
document.addEventListener('dragover', (e) => { const dz = e.target.closest && e.target.closest('#drop'); if (dz) { e.preventDefault(); dz.classList.add('over'); } });
document.addEventListener('dragleave', (e) => { const dz = e.target.closest && e.target.closest('#drop'); if (dz) dz.classList.remove('over'); });
document.addEventListener('drop', (e) => { const dz = e.target.closest && e.target.closest('#drop'); if (dz) { e.preventDefault(); dz.classList.remove('over'); if (e.dataTransfer.files[0]) uploadPreview(e.dataTransfer.files[0]); } });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (adminPasswordResolve) finishAdminPassword(null);
    else closeModal();
  }
  if (e.key === 'Enter' && e.target.id === 'admin-pw') {
    e.preventDefault();
    const password = e.target.value;
    if (!password) return toast('Password wajib diisi', true);
    finishAdminPassword(password);
  }
});

async function uploadPreview(file) {
  try {
    toast('Membaca file…');
    S.preview = await api('/api/import/preview', { method: 'POST', raw: await file.arrayBuffer() });
    S.preview.filename = file.name;
    render();
  } catch (e) { toast(e.message, true); }
}

/* ---------- Login & start ---------- */
function showLogin() { $('#login').classList.remove('hidden'); $('#app').classList.add('hidden'); }
async function tryLogin() {
  try { await api('/api/login', { method: 'POST', json: { password: $('#pw').value } }); $('#login').classList.add('hidden'); $('#app').classList.remove('hidden'); await load(); }
  catch (e) { $('#pw-err').textContent = e.message; }
}
$('#pw-go').addEventListener('click', tryLogin);
$('#pw').addEventListener('keydown', (e) => { if (e.key === 'Enter') tryLogin(); });
window.addEventListener('hashchange', async () => {
  const v = location.hash.slice(1);
  if (!NAV.some(([k]) => k === v) || v === S.view) return;
  if (v === 'data' && !S.adminPassword && !(await authorizeAdmin())) {
    S.view = 'dashboard';
    location.hash = 'dashboard';
    render();
    return;
  }
  if (S.view === 'data' && v !== 'data') S.adminPassword = null;
  S.view = v;
  render();
});

(async function start() {
  $('#actor').value = S.actor;
  const h = location.hash.slice(1);
  if (NAV.some(([k]) => k === h) && h !== 'data') S.view = h;
  try {
    const a = await fetch('/api/auth').then((r) => r.json());
    if (!a.ok) return showLogin();
    await load();
    if (h === 'data') {
      if (await authorizeAdmin()) { S.view = 'data'; render(); }
      else { S.view = 'dashboard'; location.hash = 'dashboard'; render(); }
    }
  } catch (e) { toast('Tidak bisa terhubung ke server', true); }
})();
