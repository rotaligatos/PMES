/* ------------------------- Rejects, remakes and QA -------------------------
   Rommel 2026-10-19: the operator ticks a piece good (done) or REJECT. The production supervisor
   verifies a reject. A confirmed reject is remade: the same piece restarts at its first process as
   "Remake N" and needs material — office staff re-run the optimizer to fit it into an offcut of the
   cut plan (a new plan revision, the remake highlighted), or request extra if it does not fit. QA
   inspects every piece at QC: pass (tick done) or reject (final — remade straight away). The job
   cannot be completed while a piece is rejected or not through every process.
   Database: pmes_component_reject / pmes_reject_verify / pmes_component_remake / pmes_reject_link_plan,
   handoff guard trigger. Offcut fitting: PmesOptimizer.fitRemakes (optimizer.test.js). */

const RejectData = {
  async list(jobId) { const { data, error } = await sb.from('pmes_component_rejects').select('*').eq('job_id', jobId).order('reported_at', { ascending: false }); if (error) throw error; return data || []; },
  async rpc(fn, args) { const { data, error } = await sb.rpc(fn, args); if (error) throw error; return data; },
};
const RejectState = { lastFit: null };
function _rjCanVerify() { return pmesCan('supervisor'); }
function _rjCanPlan() { return (State.me && State.me.role === 'staff') || pmesCan('supervisor'); }
function _rjPiece(c) { const s = c.spec || {}; return [s.part, s.name, s.cutL && s.cutW ? s.cutW + '×' + s.cutL : ''].filter(Boolean).join(' · ') || c.full_barcode_id; }

/* ---- report a reject (pieces grid / scan) ---- */
function pieceReject(componentId, stage, from) {
  openSheet(`<div class="sheet-title">Reject this piece at ${escapeHtml(stage)}</div>
    <p class="small">${stage === 'QC' ? 'QA reject: the piece is remade straight away.' : 'The production supervisor verifies it before the piece is remade.'}</p>
    <label class="field-label">What is wrong?</label>
    <input type="text" id="rjReason" placeholder="e.g. chipped edge, wrong size, delamination">
    <label class="field-label">Photo (optional)</label>
    <input type="file" id="rjPhoto" accept="image/*" capture="environment">
    <button class="btn danger block" style="margin-top:12px;" onclick="pieceRejectSave('${componentId}','${stage}','${from || ''}')">Reject</button>`);
}
async function pieceRejectSave(componentId, stage, from) {
  const reason = (document.getElementById('rjReason').value || '').trim();
  if (!reason) return toast('Say what is wrong.', 'error');
  let photo = null;
  const f = document.getElementById('rjPhoto').files[0];
  if (f) {
    const jobId = (State.jd && State.jd.job && State.jd.job.id) || (State.scanJobId || '');
    if (!jobId) return toast('Could not tell which job this piece belongs to.', 'error');
    const ext = (f.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    photo = 'reject/' + jobId + '/' + componentId + '/' + Date.now() + '.' + ext;
    const { error } = await sb.storage.from('pmes-receipts').upload(photo, f, { contentType: f.type || 'image/jpeg', upsert: false });
    if (error) return toast('Photo upload failed: ' + error.message, 'error');
  }
  try {
    const r = await RejectData.rpc('pmes_component_reject', { p_component: componentId, p_stage: stage, p_reason: reason, p_photo: photo });
    closeSheet();
    toast(r.status === 'confirmed' ? 'Rejected by QA — the piece is now Remake ' + r.remake + ' and starts again at its first process.' : 'Reject sent to the supervisor. The piece is on hold.', 'success');
    if (from === 'scan') { const s = document.getElementById('scanResult'); if (s) s.innerHTML = ''; } else if (State.jd) await _reloadPieces(State.jd.job.id);
  } catch (e) { toast(e.message, 'error'); }
}

/* ---- the card on the job's Pieces tab ---- */
async function renderRejectsCard(job, el) {
  let rj = [];
  try { rj = await RejectData.list(job.id); } catch (e) { el.innerHTML = ''; return; }
  const comps = (State.jd && State.jd.components) || [];
  const byId = {}; comps.forEach((c) => { byId[c.id] = c; });
  const pend = rj.filter((r) => r.status === 'pending');
  const toPlan = rj.filter((r) => r.status === 'confirmed' && !r.plan_id && byId[r.component_id] && byId[r.component_id].status !== 'complete'
    && !((State.jd.done || []).some((d) => d.component_id === r.component_id && (d.stage_code === 'CUT' || d.stage_code === 'SCUT'))));
  const qcSt = (typeof pieceStats === 'function') ? pieceStats('QC', comps, job, State.jd.done || []) : null;
  const pill = (r) => ({ pending: '<span class="badge amber">Waiting for supervisor</span>', confirmed: '<span class="badge red">Confirmed — remake</span>', overruled: '<span class="badge green">Overruled — piece OK</span>' }[r.status] || '');
  const row = (r) => { const c = byId[r.component_id];
    return `<div style="border:1px solid ${r.status === 'pending' ? 'var(--amber,#d97706)' : 'var(--border)'};border-radius:10px;padding:10px;margin-top:8px;">
      <div class="flex-between" style="gap:8px;flex-wrap:wrap;"><strong>${escapeHtml(c ? _rjPiece(c) : r.component_id)}</strong>${pill(r)}</div>
      <div class="small" style="margin-top:4px;">${r.source === 'qa' ? 'QA' : escapeHtml(r.stage_code)} · ${escapeHtml(r.reason)} — ${escapeHtml(r.reported_by_name || '')}, ${fmtDate(r.reported_at)}${r.remake_no ? ' · it was Remake ' + r.remake_no : ''}</div>
      ${r.verified_at ? `<div class="small">${escapeHtml(r.verified_by_name || '')}, ${fmtDate(r.verified_at)}${r.verify_note ? ': ' + escapeHtml(r.verify_note) : ''}</div>` : ''}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;">
        ${r.photo ? `<button class="btn outline sm" onclick="viewReceiptPhoto('${encodeURIComponent(r.photo)}')">View photo</button>` : ''}
        ${r.status === 'pending' && _rjCanVerify() ? `<button class="btn danger sm" onclick="rejectVerify('${r.id}',true)">Confirm reject → remake</button><button class="btn outline sm" onclick="rejectVerify('${r.id}',false)">Overrule — piece is OK</button>` : ''}
        ${r.status === 'confirmed' && c && c.status !== 'complete' ? `<button class="btn outline sm" onclick="printRemakeLabel('${c.id}')">🏷 Print remake label</button>` : ''}
      </div></div>`; };
  el.innerHTML = `<div class="card" id="rjCard"><div class="flex-between" style="gap:8px;flex-wrap:wrap;"><h2 class="mb-0">Rejects &amp; remakes</h2>
      ${qcSt && qcSt.planned ? `<span class="small">QA: <strong>${qcSt.done}</strong> / ${qcSt.planned} pieces passed${qcSt.done === qcSt.planned && !pend.length ? ' — <span class="badge green">ready for release</span>' : ''}</span>` : ''}</div>
    <p class="small" style="margin-top:6px;">Operators reject a piece at their process; the supervisor confirms or overrules. A confirmed reject restarts the piece as a remake. QA rejects at QC are final. The job cannot be completed until every piece, remakes included, passes QA.</p>
    ${toPlan.length ? `<div class="callout blocked" style="margin-top:8px;"><strong>${toPlan.length} remake(s) need material.</strong> Fit them into the offcuts of the cut plan (a new revision), or request extra if they do not fit.
      ${_rjCanPlan() ? `<div style="margin-top:6px;"><button class="btn primary sm" onclick="runRemakeFit('${job.id}')">Fit remakes into the cut plan</button></div>` : ''}</div>` : ''}
    <div id="rjFit"></div>
    ${rj.length ? rj.map(row).join('') : '<p class="small">No rejects.</p>'}</div>`;
  if (RejectState.lastFit && RejectState.lastFit.jobId === job.id) document.getElementById('rjFit').innerHTML = _rjFitHtml(RejectState.lastFit);
}
async function rejectVerify(id, confirmIt) {
  let note = '';
  if (!confirmIt) { note = (prompt('Why is the piece acceptable after all?') || '').trim(); if (!note) return; }
  else if (!confirm('Confirm the reject? The piece restarts at its first process as a remake and needs material.')) return;
  try { const r = await RejectData.rpc('pmes_reject_verify', { p_id: id, p_confirm: confirmIt, p_note: note || null });
    toast(confirmIt ? 'Confirmed — now Remake ' + r.remake + '. Fit it into the cut plan or request material.' : 'Overruled — the piece carries on.', 'success');
    await _reloadPieces(State.jd.job.id); } catch (e) { toast(e.message, 'error'); }
}

/* ---- remakes into the cut plan (revision) ---- */
function _rjLabel3(o) { return [o.material, o.color, o.thickness ? o.thickness + 'mm' : ''].filter(Boolean).join(' '); }
async function runRemakeFit(jobId) {
  try {
    const job = await Data.getJob(jobId);
    const [plans, rj, comps] = await Promise.all([BoardsData.plans(jobId), RejectData.list(jobId), Data.listComponents(jobId)]);
    const adopted = plans.find((p) => p.status === 'adopted');
    const src = adopted ? (adopted.result && adopted.result.groups) || [] : (job.mother_jo && job.mother_jo.boards) || [];
    const groups = src.map((g) => ({ label3: _rjLabel3(g), material: g.material, color: g.color, texture: g.texture, thickness: g.thickness, faces: g.faces, group_key: g.group_key || PmesOptimizer.groupKey(g),
      boardW: +g.boardW, boardH: +g.boardH, kerf: +g.kerf || 0, allowRotate: !!g.allowRotate, label: g.label || PmesOptimizer.groupLabel(g),
      boards: (g.layout || []).map((lay, i) => ({ no: (g.boardNos && g.boardNos[i]) || i + 1, layout: lay || [], shelves: (g.shelves || [])[i], plan: (g.plans || [])[i], defects: (g.defects || [])[i] || [] })) }));
    const byId = {}; comps.forEach((c) => { byId[c.id] = c; });
    const remakes = rj.filter((r) => r.status === 'confirmed' && !r.plan_id && byId[r.component_id] && byId[r.component_id].status !== 'complete').map((r) => {
      const c = byId[r.component_id], s = c.spec || {}, bd = String(s.board || ''), m = bd.match(/^(.*?) · board (\d+)\//);
      return { id: c.id, rejectId: r.id, label3: m ? m[1] : '', boardNo: m ? +m[2] : null, L: +s.cutL || +s.L, W: +s.cutW || +s.W, grain: s.grain || 'none', part: s.part || '' };
    }).filter((x) => x.L && x.W);
    if (!remakes.length) return toast('No remake waiting for material.', 'error');
    const fit = PmesOptimizer.fitRemakes(groups, remakes);
    RejectState.lastFit = Object.assign({ jobId, at: new Date().toISOString(), base: adopted ? 'v' + adopted.version : 'Modcraft Job Order layout', baseId: adopted && adopted.id, remakes }, fit);
    const el = document.getElementById('rjFit'); if (el) el.innerHTML = _rjFitHtml(RejectState.lastFit);
  } catch (e) { toast('Could not fit the remakes: ' + e.message, 'error'); }
}
function _rjFitHtml(f) {
  const boards = [];
  f.groups.forEach((g) => g.boards.forEach((b) => { if ((b.layout || []).some((p) => p.remake && !p._old)) boards.push({ g, b }); }));
  return `<div style="margin-top:10px;padding:10px;border:1px dashed var(--border);border-radius:10px;">
    <div class="flex-between"><strong>Revision — remakes fitted into ${escapeHtml(f.base)}</strong>${f.unplaced.length ? `<span class="badge red">${f.unplaced.length} do not fit</span>` : '<span class="badge green">All remakes fit in offcuts</span>'}</div>
    ${f.placed.map((p) => `<div class="small">✓ ${escapeHtml((f.remakes.find((r) => r.id === p.id) || {}).part || '')} → ${escapeHtml(p.group)} board ${p.boardNo} at ${Math.round(p.x)},${Math.round(p.y)} (${Math.round(p.h)}×${Math.round(p.w)})</div>`).join('')}
    ${f.unplaced.map((u) => `<div class="small" style="color:var(--red,#c0271d)">✗ ${escapeHtml(u.part || '')} ${u.L}×${u.W} — ${escapeHtml(u.why)}</div>`).join('')}
    <div>${boards.map(({ g, b }) => _bdBoardSvg({ w: g.boardW, h: g.boardH, layout: b.layout, defects: b.defects, no: b.no }, 200)).join('')}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
      ${f.placed.length && _rjCanPlan() ? `<button class="btn primary sm" onclick="saveRemakePlan('${f.jobId}')">Save as plan revision (remakes highlighted)</button>` : ''}
      ${f.unplaced.length && _rjCanPlan() ? `<button class="btn outline sm" onclick="remakeNeedsMaterial('${f.jobId}')">Report: ${f.unplaced.length} remake(s) need extra material…</button>` : ''}</div></div>`;
}
async function saveRemakePlan(jobId) {
  const f = RejectState.lastFit; if (!f || f.jobId !== jobId) return;
  const result = { revision_of: f.baseId || null, remakes: f.placed.map((p) => p.rejectId), groups: f.groups.map((g) => ({ group_key: g.group_key, label: g.label, material: g.material, color: g.color, texture: g.texture, thickness: g.thickness, faces: g.faces,
    boardW: g.boardW, boardH: g.boardH, kerf: g.kerf, allowRotate: g.allowRotate, boardsNeeded: g.boards.length,
    layout: g.boards.map((b) => b.layout), shelves: g.boards.map((b) => b.shelves), plans: g.boards.map((b) => b.plan), defects: g.boards.map((b) => b.defects || []), boardNos: g.boards.map((b) => b.no),
    extraNeeded: 0, rejected: [] })) };
  try {
    const id = await BoardsData.rpc('pmes_cut_plan_save', { p_job: jobId, p_machine: { kerf: f.groups[0] && f.groups[0].kerf }, p_result: result, p_summary: { extra: 0, remakes: f.placed.length, revision_of: f.base } });
    await RejectData.rpc('pmes_reject_link_plan', { p_rejects: f.placed.map((p) => p.rejectId), p_plan: id });
    RejectState.lastFit = null; toast('Plan revision saved with the remakes highlighted — a supervisor adopts it for the line.', 'success'); await _reloadPieces(jobId);
  } catch (e) { toast(e.message, 'error'); }
}
function remakeNeedsMaterial(jobId) {
  const f = RejectState.lastFit; if (!f) return;
  const txt = 'Remakes do not fit any offcut: ' + f.unplaced.map((u) => (u.part || '') + ' ' + u.L + '×' + u.W + ' (' + u.label3 + ')').join('; ');
  concernRaise(jobId, { remakes: f.unplaced, finding: txt }, 'not_enough');
}

/* ---- remake label ---- */
function printRemakeLabel(componentId) {
  const job = State.jd && State.jd.job, jo = job && job.mother_jo, c = (State.jd.components || []).find((x) => x.id === componentId);
  if (!c) return;
  const s = c.spec || {}, p = (jo && (jo.parts || []).find((x) => x.p === s.part)) || {};
  const label = { scan: c.scan_code || c.full_barcode_id, p: s.part, name: s.name, area: s.area, L: s.L, W: s.W, cutL: s.cutL, cutW: s.cutW, th: s.thickness || 0,
    material: s.material || '', ebt: s.ebt || '', sc: p.sc || 0, lc: p.lc || 0, grain: s.grain || '', tape: s.tape || '', where: 'REMAKE ' + (c.remake_no || 1) + ' — ' + (s.board || ''),
    work: s.remark || '', client: (jo && jo.client) || '', project: (jo && jo.project) || '', order: (jo && jo.orderRef) || '', grain: p.grained ? (s.grain || 'length') : '' };
  const abs = (rel) => { try { return new URL(rel, location.href).href; } catch (e) { return rel; } };
  const lg = _lblLogoFor(job), logo = lg && !/^data:/.test(lg) ? abs(lg) : lg;
  const payload = JSON.stringify({ labels: [label], logo }).replace(/</g, '\\u003c');
  const w = window.open('', '_blank'); if (!w) return toast('Pop-up blocked — allow pop-ups to print.', 'error');
  w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Remake label</title><style>body{margin:8mm;background:#fff}@media print{.noprint{display:none}}</style></head><body>'
    + '<div class="noprint" style="margin-bottom:8px;font-family:Arial"><button onclick="window.print()">Print</button> Remake ' + (c.remake_no || 1) + ' — ' + escapeHtml(s.part || '') + '</div><div id="jl"></div>'
    + '<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js"><\/script><script src="' + abs('jo-labels.js') + '"><\/script>'
    + '<script>window.addEventListener("load",function(){JoLabels.render(document.getElementById("jl"),' + payload + ');});<\/script></body></html>');
  w.document.close();
}
