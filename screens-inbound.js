/* ------------------------- Inbound materials check -------------------------
   Rommel 2026-10-19: every inbound material is checked by the Material Inbound In-charge — quantity,
   quality and that it is the right item — against the MRF from KEYSTONE AND against what the client
   said they would supply. The checker may run the cutting optimizer to see whether what arrived is
   enough, and sends a material concern to the office staff when it is not. The Job Order stays
   flagged until the concern is closed. The whole check prints as one form.
   Database: pmes_client_materials (+ _receive, _add), pmes_material_concerns (+ _raise, _resolve),
   pmes_mr_receive (condition wrong_item). pmes_jo_check refuses while a concern is open. */

const InboundData = {
  async client(jobId) { const { data, error } = await sb.from('pmes_client_materials').select('*').eq('job_id', jobId).order('line_no'); if (error) throw error; return data || []; },
  async concerns(jobId) { const { data, error } = await sb.from('pmes_material_concerns').select('*').eq('job_id', jobId).order('raised_at', { ascending: false }); if (error) throw error; return data || []; },
  async openConcernJobs() { const { data, error } = await sb.from('pmes_material_concerns').select('job_id').eq('status', 'open'); if (error) return {}; const m = {}; (data || []).forEach((r) => { m[r.job_id] = (m[r.job_id] || 0) + 1; }); return m; },
  async rpc(fn, args) { const { data, error } = await sb.rpc(fn, args); if (error) throw error; return data; },
};
function _inCanCheck() { return (State.me && State.me.role === 'materials') || pmesCan('supervisor'); }
function _inCanResolve() { return (State.me && State.me.role === 'staff') || pmesCan('supervisor'); }
function _inCanRaise() { return (State.me && ['materials', 'staff'].includes(State.me.role)) || pmesCan('supervisor'); }
const IN_COND = { ok: ['green', 'OK'], short: ['amber', 'Short'], damaged: ['red', 'Damaged'], wrong_item: ['red', 'Wrong item'] };
function inCondPill(c) { if (!c) return '<span class="badge gray">Not checked</span>'; const x = IN_COND[c] || ['gray', c]; return '<span class="badge ' + x[0] + '">' + x[1] + '</span>'; }

/* ---- client-supplied materials ---- */
function renderClientMatBlock(jobId, lines) {
  const can = _inCanCheck();
  const head = `<div class="flex-between" style="gap:8px;flex-wrap:wrap;"><strong>Client-supplied materials</strong>
    ${can ? `<button class="btn outline sm" onclick="clientMatAdd('${jobId}')">+ Item arrived that is not listed</button>` : ''}</div>
    <p class="small" style="margin-top:4px;">What the client said they will bring (from the quotation). Receiving checks the item and counts it; QA checks its quality.</p>`;
  if (!lines.length) return `<div class="mr-block">${head}<p class="small">None listed on the quotation.</p></div>`;
  if (!can) return `<div class="mr-block">${head}<table class="comp-table"><thead><tr><th>Item</th><th>Expected</th><th>Received</th><th>Check</th></tr></thead><tbody>
    ${lines.map((l) => `<tr><td><strong>${escapeHtml(l.item)}</strong>${l.source === 'added' ? ' <span class="small">(added on arrival)</span>' : ''}</td><td>${l.qty_expected ?? '—'} ${escapeHtml(l.unit || '')}</td><td>${l.qty_received}</td>
      <td>${inCondPill(l.condition)}${l.note ? '<div class="small">' + escapeHtml(l.note) + '</div>' : ''}${l.photo ? `<button class="btn outline sm" onclick="viewReceiptPhoto('${encodeURIComponent(l.photo)}')">View photo</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
  return `<div class="mr-block">${head}
    ${lines.map((l) => `<div class="mr-line cm-line" data-job="${jobId}" data-line="${l.id}" data-expected="${l.qty_expected ?? ''}" ${l.condition ? 'data-cond="' + l.condition + '"' : ''}>
      <div class="flex-between" style="gap:8px;flex-wrap:wrap;"><div><strong>${escapeHtml(l.item)}</strong>${l.source === 'added' ? ' <span class="small">(added on arrival)</span>' : ''}</div>
        <div class="small">Expected ${l.qty_expected ?? '—'} ${escapeHtml(l.unit || '')} ${inCondPill(l.condition)}${l.checked_by ? ' · ' + escapeHtml(l.checked_by) : ''}</div></div>
      <div class="mr-line-inputs">
        <label class="small">Correct item received<input type="number" min="0" step="any" class="mrQty" value="${l.condition ? l.qty_received : ''}" placeholder="0"></label>
        <div class="mr-cond">${[['ok', 'OK'], ['short', 'Short'], ['wrong_item', 'Wrong item']].map(([v, t]) => `<button type="button" class="mr-cond-btn ${l.condition === v ? 'on ' + v : ''}" data-v="${v}" onclick="mrSetCond(this,'${v}')">${t}</button>`).join('')}</div>
        <input type="text" class="mrNote" placeholder="Note — what is short, damaged or wrong" value="${escapeHtml(l.note || '')}">
        <div class="mrPhotoWrap" style="${['damaged', 'wrong_item'].includes(l.condition) ? '' : 'display:none;'}">
          <label class="small">Photo (required for damaged or wrong item)<input type="file" accept="image/*" capture="environment" class="mrPhoto"></label>
          ${l.photo ? `<button class="btn outline sm" onclick="viewReceiptPhoto('${encodeURIComponent(l.photo)}')">View saved photo</button>` : ''}</div>
      </div></div>`).join('')}
    <div style="display:flex;justify-content:flex-end;margin-top:10px;"><button class="btn primary sm" onclick="clientMatSubmit('${jobId}')">Confirm client materials</button></div></div>`;
}
async function clientMatAdd(jobId) {
  const item = (prompt('What arrived from the client? (type, brand, colour, size, thickness)') || '').trim(); if (!item) return;
  const q = prompt('How many?'); if (q === null) return;
  const unit = (prompt('Unit (pcs, sheets, rolls…)', 'pcs') || 'pcs').trim();
  try { await InboundData.rpc('pmes_client_mat_add', { p_job: jobId, p_item: item, p_qty: q === '' ? null : Number(q), p_unit: unit }); toast('Added — now check it below.', 'success'); render(); }
  catch (e) { toast(e.message, 'error'); }
}
async function clientMatSubmit(jobId) {
  const rows = [...document.querySelectorAll('.cm-line[data-job="' + jobId + '"]')], lines = [];
  for (const row of rows) {
    const qEl = row.querySelector('.mrQty'); if (qEl.value === '' && !row.dataset.cond) continue;   // not checked yet — skip
    const qty = qEl.value === '' ? 0 : Number(qEl.value);
    const cond = row.dataset.cond || ((row.querySelector('.mr-cond-btn.on') || {}).dataset || {}).v || '';
    const item = row.querySelector('strong').textContent;
    if (!cond) return toast('Mark ' + item + ' as OK, Short, Damaged or Wrong item.', 'error');
    const note = row.querySelector('.mrNote').value.trim();
    if (cond !== 'ok' && !note) return toast('Add a note for ' + item + '.', 'error');
    const line = { id: row.dataset.line, qty, condition: cond, note: note || null };
    if (['damaged', 'wrong_item'].includes(cond)) {
      const f = row.querySelector('.mrPhoto').files[0];
      if (f) {
        const ext = (f.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
        const path = 'client/' + jobId + '/' + row.dataset.line + '/' + Date.now() + '.' + ext;
        const { error } = await sb.storage.from('pmes-receipts').upload(path, f, { contentType: f.type || 'image/jpeg', upsert: false });
        if (error) return toast('Photo upload failed for ' + item + ': ' + error.message, 'error');
        line.photo = path;
      } else if (!row.querySelector('.mrPhotoWrap button')) return toast('Take a photo of ' + item + '.', 'error');
    }
    lines.push(line);
  }
  if (!lines.length) return toast('Enter what arrived for at least one item.', 'error');
  try { await InboundData.rpc('pmes_client_mat_receive', { p_job: jobId, p_lines: lines }); toast('Client materials checked.', 'success'); render(); }
  catch (e) { toast(e.message, 'error'); }
}

/* ---- material concerns ---- */
const CONCERN_KIND = { not_enough: 'Not enough material', damaged: 'Damaged material', wrong_item: 'Wrong item received', short: 'Short delivery', client_supplied: 'Client-supplied problem', other: 'Other' };
function renderConcernBlock(jobId, concerns) {
  const open = concerns.filter((c) => c.status === 'open'), closed = concerns.filter((c) => c.status !== 'open');
  const card = (c) => `<div style="border:1px solid ${c.status === 'open' ? 'var(--red,#c0271d)' : 'var(--border)'};border-radius:10px;padding:10px;margin-top:8px;">
    <div class="flex-between"><strong>${escapeHtml(CONCERN_KIND[c.kind] || c.kind)}</strong>${c.status === 'open' ? '<span class="badge red">Open</span>' : '<span class="badge green">Resolved</span>'}</div>
    <div style="margin-top:4px;">${escapeHtml(c.finding)}</div>
    ${c.analysis && c.analysis.groups ? '<div class="small" style="margin-top:4px;">Optimizer: ' + c.analysis.groups.map((g) => escapeHtml(g.label) + ' — ' + g.pieces + ' pieces, ' + g.realUsed + ' boards used' + (g.extraNeeded ? ', <strong>' + g.extraNeeded + ' more needed</strong>' : ', enough')).join(' · ') + '</div>' : ''}
    <div class="small" style="margin-top:4px;">Raised by ${escapeHtml(c.raised_by_name || c.raised_by || '')}, ${fmtDate(c.raised_at)}${c.resolved_at ? ' · Resolved by ' + escapeHtml(c.resolved_by) + ', ' + fmtDate(c.resolved_at) + ': ' + escapeHtml(c.resolution || '') : ''}</div>
    ${c.status === 'open' && _inCanResolve() ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
      <button class="btn primary sm" onclick="goToBoards('${jobId}','bdOptimize')">Re-run optimizer / request extra</button>
      <button class="btn outline sm" onclick="concernResolve('${c.id}')">Close — say how it was resolved</button></div>` : ''}</div>`;
  return `<div class="card" id="inConcerns"><div class="flex-between"><h2 class="mb-0">Material concerns</h2>
      ${_inCanRaise() ? `<button class="btn outline sm" onclick="concernRaise('${jobId}')">Report a material concern…</button>` : ''}</div>
    <p class="small" style="margin-top:6px;">The materials checker reports what is not right; office staff re-run the optimizer and request extra if needed. The Job Order cannot be checked while a concern is open.</p>
    ${open.length ? open.map(card).join('') : '<p class="small">No open concern.</p>'}
    ${closed.length ? `<details style="margin-top:8px;"><summary class="small">${closed.length} resolved</summary>${closed.map(card).join('')}</details>` : ''}</div>`;
}
async function concernRaise(jobId, analysis, kind) {
  const k = kind || (prompt('What kind of concern?\n1 Not enough material\n2 Damaged material\n3 Wrong item received\n4 Short delivery\n5 Client-supplied problem\n6 Other', '1') || '').trim();
  const map = { 1: 'not_enough', 2: 'damaged', 3: 'wrong_item', 4: 'short', 5: 'client_supplied', 6: 'other' };
  const kk = map[k] || (CONCERN_KIND[k] ? k : null); if (!kk) return;
  const def = analysis && analysis.finding ? analysis.finding : analysis && analysis.groups ? analysis.groups.filter((g) => g.extraNeeded).map((g) => g.label + ': ' + g.extraNeeded + ' more board(s) needed').join('; ') : '';
  const finding = (prompt('Describe what you found (it goes to the office staff):', def) || '').trim(); if (!finding) return;
  try { await InboundData.rpc('pmes_concern_raise', { p_job: jobId, p_kind: kk, p_finding: finding, p_analysis: analysis || null }); toast('Concern sent to the office staff. The Job Order is flagged.', 'success'); render(); }
  catch (e) { toast(e.message, 'error'); }
}
function concernFromRun(jobId) {
  const run = BoardsState.lastRun; if (!run || run.jobId !== jobId) return toast('Run the optimizer first.', 'error');
  const analysis = { at: run.at, groups: run.groups.map((g) => ({ label: g.label, pieces: g.pieces, realUsed: g.realUsed, extraNeeded: g.extraNeeded, rejected: (g.rejected || []).length })) };
  const short = analysis.groups.some((g) => g.extraNeeded);
  concernRaise(jobId, analysis, short ? 'not_enough' : null);
}
async function concernResolve(id) {
  const r = (prompt('How was it resolved? (e.g. extra boards requested, enough after re-running the optimizer, client will bring the rest on …)') || '').trim(); if (!r) return;
  try { await InboundData.rpc('pmes_concern_resolve', { p_id: id, p_resolution: r }); toast('Concern closed.', 'success'); render(); }
  catch (e) { toast(e.message, 'error'); }
}

/* ---- the whole inbound check as one card + printable form ---- */
async function renderInboundCards(job, el, part) {
  let cm = [], cc = [];
  try { [cm, cc] = await Promise.all([InboundData.client(job.id), InboundData.concerns(job.id)]); }
  catch (e) { el.innerHTML = `<div class="card"><p class="small">Could not load the inbound check: ${escapeHtml(e.message)}</p></div>`; return; }
  const recv = `<div class="card">${renderClientMatBlock(job.id, cm)}
    <div style="margin-top:10px;"><button class="btn outline sm" onclick="printInboundForm('${job.id}')">🖨 Print receiving &amp; inspection form</button></div></div>`;
  el.innerHTML = part === 'receive' ? recv : part === 'concerns' ? renderConcernBlock(job.id, cc) : renderConcernBlock(job.id, cc) + recv;
}
async function printInboundForm(jobId) {
  const w = window.open('', '_blank'); if (!w) return toast('Allow pop-ups to print.', 'error');
  w.document.write('<p style="font-family:sans-serif">Preparing…</p>');
  try {
    const [job, mrs, cm, cc, boards] = await Promise.all([Data.getJob(jobId), Data.listJobMRs(jobId), InboundData.client(jobId), InboundData.concerns(jobId),
      (typeof BoardsData !== 'undefined' ? BoardsData.boards(jobId) : Promise.resolve([])).catch(() => [])]);
    const e = escapeHtml, cond = (c) => c ? (IN_COND[c] || ['', c])[1] : '';
    const row = (cells) => '<tr>' + cells.map((x) => '<td>' + x + '</td>').join('') + '</tr>';
    const mrHtml = (mrs || []).map((m) => `<h3>MRF ${e(m.mr_no || '')} — ${m.stream === 'purchase' ? 'purchase' : 'warehouse'} (${e(String(m.status).replace(/_/g, ' '))})</h3>
      <table><thead><tr><th>#</th><th>Item</th><th>Unit</th><th>Requested</th><th>Processed</th><th>Received</th><th>Condition</th><th>Note</th><th>Checked by</th></tr></thead><tbody>
      ${(m.lines || []).map((l, i) => row([i + 1, '<b>' + e(l.item) + '</b>' + (l.area ? '<br><small>' + e(l.area) + '</small>' : ''), e(l.unit || ''), l.qty, l.issued, l.received, cond(l.condition), e(l.note || ''), e(l.checked_by || '')])).join('')}</tbody></table>`).join('') || '<p>No MRF.</p>';
    const cmHtml = cm.length ? `<table><thead><tr><th>#</th><th>Item</th><th>Expected</th><th>Received</th><th>Condition</th><th>Note</th><th>Checked by</th></tr></thead><tbody>
      ${cm.map((l) => row([l.line_no, '<b>' + e(l.item) + '</b>' + (l.source === 'added' ? ' <small>(added on arrival)</small>' : ''), (l.qty_expected ?? '') + ' ' + e(l.unit || ''), l.condition ? l.qty_received : '', cond(l.condition), e(l.note || ''), e(l.checked_by || '')])).join('')}</tbody></table>` : '<p>None listed.</p>';
    const bdHtml = boards.length ? `<table><thead><tr><th>Board group</th><th>No.</th><th>Status</th><th>Defects</th><th>Inspected by</th></tr></thead><tbody>
      ${boards.map((b) => row([e(b.group_key || ''), b.board_no, e(b.status), e((b.defects || []).map((d) => d.defect_type).join(', ')), e(b.inspected_by || '')])).join('')}</tbody></table>` : '<p>No board inspection recorded.</p>';
    const ccHtml = cc.length ? cc.map((c) => `<p><b>${e(CONCERN_KIND[c.kind] || c.kind)}</b> — ${e(c.finding)} <small>(${e(c.raised_by_name || '')}, ${e(fmtDate(c.raised_at))}; ${c.status === 'open' ? 'OPEN' : 'resolved: ' + e(c.resolution || '')})</small></p>`).join('') : '<p>None.</p>';
    w.document.open();
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Inbound inspection ${e(job.job_code)}</title>
      <style>body{font-family:Arial,sans-serif;font-size:11px;color:#000;margin:18px}h1{font-size:16px;margin:0}h2{font-size:13px;margin:14px 0 4px;border-bottom:1px solid #000}h3{font-size:12px;margin:8px 0 4px}
      table{width:100%;border-collapse:collapse}th,td{border:1px solid #444;padding:3px 5px;text-align:left;vertical-align:top}th{background:#eee}
      .sig{display:flex;gap:30px;margin-top:30px}.sig div{flex:1;border-top:1px solid #000;padding-top:3px;text-align:center}@media print{button{display:none}}</style></head><body>
      <button onclick="print()">Print</button>
      <h1>Inbound materials inspection</h1>
      <p><b>Job</b> ${e(job.job_code)} &nbsp; <b>Quotation</b> ${e(job.quotation_serial || '')} &nbsp; <b>Plant</b> ${e(job.destination_company || '')} &nbsp; <b>Printed</b> ${e(new Date().toLocaleString('en-PH'))}</p>
      <h2>1. Materials from KEYSTONE (MRF)</h2>${mrHtml}
      <h2>2. Client-supplied materials</h2>${cmHtml}
      <h2>3. Boards inspected</h2>${bdHtml}
      <h2>4. Material concerns</h2>${ccHtml}
      <div class="sig"><div>Checked by (Material Inbound In-charge)</div><div>Reviewed by (Production staff)</div><div>Noted by (Supervisor)</div></div>
      </body></html>`);
    w.document.close();
  } catch (err) { w.document.body.innerHTML = '<p>Could not prepare the form: ' + escapeHtml(err.message) + '</p>'; }
}
