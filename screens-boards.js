/* =====================================================================
   Boards, defects, cutting optimization, additional boards (job page)
   - Materials person inspects each board as it arrives: OK / has defects (drag a box on the board,
     pick the type) / rejected.                                       → pmes_boards, pmes_board_defects
   - Staff re-run the optimizer on the real boards (optimizer.js) and save a plan; a supervisor
     adopts it — the process JO prints the adopted layout.                        → pmes_cut_plans
   - Short on boards: request extra boards → supervisor → manager → KEYSTONE accepts (becomes an
     MRF) or rejects → a supervisor may escalate → Head of Plant Operations decides. → pmes_board_requests
   ===================================================================== */

const DEFECT_TYPES = [['chip', 'Chip'], ['scratch', 'Scratch'], ['dent', 'Dent'], ['delamination', 'Delamination'], ['warp', 'Warp / bow'],
  ['stain', 'Stain / colour'], ['edge', 'Edge damage'], ['crack', 'Crack'], ['other', 'Other']];
const BoardsState = { lastRun: null };

const BoardsData = {
  async boards(jobId) {
    const { data, error } = await sb.from(T('boards')).select('*, defects:pmes_board_defects(*)').eq('job_id', jobId).order('board_no');
    if (error) throw error; return data || [];
  },
  async plans(jobId) {
    const { data, error } = await sb.from(T('cut_plans')).select('id,version,status,summary,created_by_name,created_by,created_at,adopted_by,adopted_at').eq('job_id', jobId).order('version', { ascending: false });
    if (error) throw error; return data || [];
  },
  async plan(id) { const { data, error } = await sb.from(T('cut_plans')).select('*').eq('id', id).single(); if (error) throw error; return data; },
  async adoptedPlan(jobId) {
    const { data, error } = await sb.from(T('cut_plans')).select('*').eq('job_id', jobId).eq('status', 'adopted').maybeSingle();
    if (error) throw error; return data;
  },
  async requests(jobId) {
    const { data, error } = await sb.from(T('board_requests')).select('*').eq('job_id', jobId).order('created_at', { ascending: false });
    if (error) throw error; return data || [];
  },
  async rpc(fn, args) { const { data, error } = await sb.rpc(fn, args); if (error) throw error; return data; },
};

function _bdCanInspect() { return (State.me && State.me.role === 'materials') || pmesCan('supervisor'); }
function _bdCanRun() { return (State.me && State.me.role === 'staff') || pmesCan('supervisor'); }
function _bdGroups(job) { return ((job.mother_jo && job.mother_jo.boards) || []).map((g) => ({ g, key: PmesOptimizer.groupKey(g), label: PmesOptimizer.groupLabel(g) })); }

async function renderBoardsCards(job, el) {
  if (!job.mother_jo || !(job.mother_jo.boards || []).length) { el.innerHTML = ''; return; }
  let boards = [], plans = [], reqs = [];
  try { [boards, plans, reqs] = await Promise.all([BoardsData.boards(job.id), BoardsData.plans(job.id), BoardsData.requests(job.id)]); }
  catch (e) { el.innerHTML = `<div class="card"><p class="small">Could not load boards: ${escapeHtml(e.message)}</p></div>`; return; }
  State.jobBoards = boards;
  const groups = _bdGroups(job);
  const stPill = (s) => ({ ok: '<span class="badge green">OK</span>', defect: '<span class="badge amber">Defects</span>', rejected: '<span class="badge red">Rejected</span>' }[s] || '<span class="badge gray">Not inspected</span>');
  // --- inspection
  const insp = groups.map(({ g, key, label }) => {
    const mine = boards.filter((b) => b.group_key === key);
    const n = Math.max(g.boardsNeeded || 0, ...mine.map((b) => b.board_no), 0);
    const rows = Array.from({ length: n }, (_, i) => {
      const b = mine.find((x) => x.board_no === i + 1);
      return `<tr><td>Board ${i + 1}</td><td>${stPill(b && b.status)}</td><td>${b ? (b.defects || []).map((d) => escapeHtml(d.defect_type)).join(', ') || '—' : '—'}</td>
        <td class="small">${b ? escapeHtml(b.inspected_by || '') + ' ' + fmtDate(b.inspected_at) + (b.notes ? '<br>' + escapeHtml(b.notes) : '') : ''}</td>
        <td>${_bdCanInspect() ? `<button class="btn outline sm" onclick="openBoardInspect('${job.id}','${encodeURIComponent(key)}',${i + 1})">${b ? 'Edit' : 'Inspect'}</button>` : ''}</td></tr>`;
    }).join('');
    const counts = { ok: mine.filter((b) => b.status === 'ok').length, defect: mine.filter((b) => b.status === 'defect').length, rejected: mine.filter((b) => b.status === 'rejected').length };
    return `<div style="margin-top:10px;"><div class="flex-between"><strong>${escapeHtml(label)}</strong><span class="small">${g.boardW}×${g.boardH}mm · planned ${g.boardsNeeded || 0} · OK ${counts.ok} · with defects ${counts.defect} · rejected ${counts.rejected}</span></div>
      <table class="comp-table" style="margin-top:6px;"><thead><tr><th>Board</th><th>Status</th><th>Defects</th><th>Inspected</th><th></th></tr></thead><tbody>${rows}</tbody></table>
      ${_bdCanInspect() ? `<button class="btn outline sm" style="margin-top:6px;" onclick="openBoardInspect('${job.id}','${encodeURIComponent(key)}',${n + 1})">+ Another board arrived</button>` : ''}</div>`;
  }).join('');

  // --- optimization
  const run = BoardsState.lastRun && BoardsState.lastRun.jobId === job.id ? BoardsState.lastRun : null;
  const planRows = plans.map((p) => `<tr><td>v${p.version}</td><td>${p.status === 'adopted' ? '<span class="badge green">adopted</span>' : p.status === 'superseded' ? '<span class="badge gray">superseded</span>' : '<span class="badge blue">draft</span>'}</td>
    <td>${(p.summary && p.summary.extra) || 0}</td><td class="small">${escapeHtml(p.created_by_name || p.created_by)} ${fmtDate(p.created_at)}${p.adopted_by ? '<br>adopted ' + escapeHtml(p.adopted_by) : ''}</td>
    <td style="white-space:nowrap"><button class="btn outline sm" onclick="viewCutPlan('${p.id}')">View</button> ${pmesCan('supervisor') && p.status !== 'adopted' ? `<button class="btn primary sm" onclick="adoptCutPlan('${p.id}')">Adopt</button>` : ''}</td></tr>`).join('');

  // --- requests
  const reqLabel = { pending_supervisor: ['amber', 'Waiting for supervisor'], pending_manager: ['amber', 'Waiting for manager'], sent_to_keystone: ['blue', 'Sent to KEYSTONE'],
    accepted: ['green', 'Accepted — MRF raised'], rejected_by_keystone: ['red', 'Rejected by KEYSTONE'], escalated: ['amber', 'Escalated to Head of Plant Ops'],
    approved_final: ['green', 'Approved by Head of Plant Ops — MRF raised'], rejected_final: ['red', 'Rejected — final'], cancelled: ['gray', 'Cancelled'] };
  const reqRows = reqs.map((q) => {
    const [c, t] = reqLabel[q.status] || ['gray', q.status];
    const isSupOnly = pmesCan('supervisor') && !pmesCan('manager'), isMgr = pmesCan('manager');
    const btns = [];
    if (q.status === 'pending_supervisor' && isSupOnly) btns.push(`<button class="btn primary sm" onclick="boardReqAct('${q.id}','approve')">Approve (supervisor)</button>`);
    if (q.status === 'pending_manager' && isMgr && q.supervisor_by !== (State.me && State.me.email)) btns.push(`<button class="btn primary sm" onclick="boardReqAct('${q.id}','approve')">Approve (manager) → KEYSTONE</button>`);
    if (['pending_supervisor', 'pending_manager'].includes(q.status) && pmesCan('supervisor')) btns.push(`<button class="btn outline sm" onclick="boardReqAct('${q.id}','reject')">Reject</button>`);
    if (q.status === 'rejected_by_keystone' && pmesCan('supervisor')) btns.push(`<button class="btn outline sm" onclick="boardReqAct('${q.id}','escalate')">Escalate to Head of Plant Ops</button>`);
    return `<div style="border:1px solid var(--border);border-radius:10px;padding:10px;margin-top:8px;">
      <div class="flex-between"><strong>${(q.lines || []).map((l) => l.qty + ' × ' + escapeHtml(l.label)).join(', ')}</strong><span class="badge ${c}">${t}</span></div>
      <div class="small" style="margin-top:4px;">Reason: ${escapeHtml(q.reason)} — ${escapeHtml(q.created_by_name || q.created_by)}, ${fmtDate(q.created_at)}</div>
      <div class="small">${[q.supervisor_by && 'Supervisor ' + q.supervisor_by, q.manager_by && 'Manager ' + q.manager_by, q.ks_by && 'KEYSTONE ' + q.ks_by + (q.ks_note ? ': ' + q.ks_note : ''),
        q.escalated_by && 'Escalated by ' + q.escalated_by + ': ' + q.escalate_note, q.head_by && 'Head of Plant Ops ' + q.head_by + ': ' + q.head_note].filter(Boolean).map(escapeHtml).join(' · ')}</div>
      ${btns.length ? '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">' + btns.join('') + '</div>' : ''}</div>`;
  }).join('');

  el.innerHTML = `
    <div class="card"><h2>Boards received — inspection</h2>
      <p class="small">The materials person inspects every board: mark each defect on the board drawing, or reject the board. The cutting optimization plans around what is recorded here.</p>
      ${insp}</div>
    <div class="card"><div class="flex-between"><h2 class="mb-0">Cutting optimization</h2>
      ${_bdCanRun() ? `<button class="btn primary sm" onclick="runBoardOptimizer('${job.id}')">Run with the boards received</button>` : ''}</div>
      <p class="small" style="margin-top:6px;">Same method, machine and kerf as the Modcraft cutting list the quotation was based on — but on the real boards: rejected boards are left out and defects are never cut into. A supervisor adopts the plan the line cuts from; the process JO prints the adopted plan.</p>
      ${run ? _bdRunHtml(run) : ''}
      ${planRows ? `<table class="comp-table" style="margin-top:10px;"><thead><tr><th>Plan</th><th>Status</th><th>Extra boards</th><th>By</th><th></th></tr></thead><tbody>${planRows}</tbody></table>` : '<p class="small">No plan saved yet — the Modcraft layout is used until one is adopted.</p>'}
    </div>
    ${reqs.length ? `<div class="card"><h2>Additional boards</h2>${reqRows}</div>` : ''}`;
}

function _bdBoardSvg(b, maxPx) {
  const scale = maxPx / Math.max(b.w, b.h), pw = Math.round(b.w * scale), ph = Math.round(b.h * scale);
  const fs = Math.round(10 / scale);
  let r = '';
  (b.layout || []).forEach((pc) => {
    const hue = ((pc.ref != null ? pc.ref : 0) * 47) % 360;
    r += `<rect x="${pc.x}" y="${pc.y}" width="${pc.w}" height="${pc.h}" fill="hsl(${hue},55%,80%)" stroke="#5a4a3a" stroke-width="${Math.max(1, 1.4 / scale)}"></rect>`;
    if (pc.w > fs * 3 && pc.h > fs * 1.6) r += `<text x="${pc.x + pc.w / 2}" y="${pc.y + pc.h / 2 + fs * 0.3}" font-size="${fs}" text-anchor="middle">${escapeHtml(pc.part || '')}</text>`;
  });
  (b.defects || []).forEach((d) => { r += `<rect x="${d.x}" y="${d.y}" width="${d.w}" height="${d.h}" fill="rgba(220,40,40,.35)" stroke="#c0271d" stroke-width="${Math.max(1, 2 / scale)}"></rect>`; });
  return `<div style="display:inline-block;margin:4px;text-align:center"><svg width="${pw}" height="${ph}" viewBox="0 0 ${b.w} ${b.h}" style="background:${b.extra ? '#f3f7ff' : '#fff'};border:2px solid ${b.extra ? '#1c5a9c' : '#8a7a63'}">${r}</svg>
    <div class="small">${b.extra ? '<strong>' + escapeHtml(b.no) + '</strong> (to request)' : 'Board ' + escapeHtml(String(b.no))}</div></div>`;
}
function _bdRunHtml(run) {
  const totalExtra = run.groups.reduce((n, g) => n + g.extraNeeded, 0);
  return `<div style="margin-top:10px;padding:10px;border:1px dashed var(--border);border-radius:10px;">
    <div class="flex-between"><strong>Result — ${fmtDate(run.at)}</strong>${totalExtra ? `<span class="badge red">${totalExtra} extra board(s) needed</span>` : '<span class="badge green">Enough boards</span>'}</div>
    ${run.groups.map((g) => `<div style="margin-top:8px;"><strong>${escapeHtml(g.label)}</strong>
      <div class="small">${g.pieces} pieces · uses ${g.realUsed} of the real boards${g.realUnused.length ? ' (spare: ' + g.realUnused.join(', ') + ')' : ''} · rejected ${g.rejected.length} · defects avoided ${g.defectCount}${g.extraNeeded ? ' · <strong style="color:var(--red)">' + g.extraNeeded + ' extra</strong>' : ''} · utilization ${Math.round(g.utilization * 100)}%${g.assumedClean ? ' · <em>not inspected yet — assumed as planned</em>' : ''}${g.oversizedCount ? ' · ⚠ ' + g.oversizedCount + ' too big for the board' : ''}</div>
      <div>${g.boards.map((b) => _bdBoardSvg(b, 170)).join('')}</div></div>`).join('')}
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">
      ${_bdCanRun() ? `<button class="btn primary sm" onclick="saveCutPlan('${run.jobId}')">Save as plan</button>` : ''}
      ${totalExtra && _bdCanRun() ? `<button class="btn outline sm" onclick="requestExtraBoards('${run.jobId}')">Request ${totalExtra} additional board(s)…</button>` : ''}
    </div></div>`;
}

async function runBoardOptimizer(jobId) {
  try {
    const job = await Data.getJob(jobId);
    const boards = await BoardsData.boards(jobId);
    const groups = PmesOptimizer.optimizeJob(job.mother_jo, boards);
    BoardsState.lastRun = { jobId, at: new Date().toISOString(), groups, planId: null };
    render();
  } catch (e) { toast('Could not run the optimizer: ' + e.message, 'error'); }
}
// What the process JO prints: the same shape as the mother JO's boards.
function _bdPlanResult(run, job) {
  const src = _bdGroups(job);
  return { groups: run.groups.map((g) => {
    const m = (src.find((x) => x.key === g.group_key) || {}).g || {};
    return { group_key: g.group_key, label: g.label, material: m.material, color: m.color, texture: m.texture, thickness: m.thickness, faces: m.faces,
      boardW: g.boardW, boardH: g.boardH, kerf: g.kerf, allowRotate: g.allowRotate, boardsNeeded: g.boards.length,
      layout: g.boards.map((b) => b.layout), shelves: g.boards.map((b) => b.shelves), defects: g.boards.map((b) => b.defects || []),
      boardNos: g.boards.map((b) => b.no), extraNeeded: g.extraNeeded, rejected: g.rejected, oversizedCount: g.oversizedCount, oversizedRefs: g.oversizedRefs };
  }) };
}
async function saveCutPlan(jobId) {
  const run = BoardsState.lastRun; if (!run || run.jobId !== jobId) return;
  try {
    const job = await Data.getJob(jobId);
    const res = _bdPlanResult(run, job);
    const summary = { extra: run.groups.reduce((n, g) => n + g.extraNeeded, 0), rejected: run.groups.reduce((n, g) => n + g.rejected.length, 0), defects: run.groups.reduce((n, g) => n + g.defectCount, 0) };
    const id = await BoardsData.rpc('pmes_cut_plan_save', { p_job: jobId, p_machine: { kerf: run.groups[0] && run.groups[0].kerf }, p_result: res, p_summary: summary });
    run.planId = id; toast('Plan saved — a supervisor adopts it for the line.', 'success'); render();
  } catch (e) { toast(e.message, 'error'); }
}
async function adoptCutPlan(id) {
  if (!confirm('Adopt this plan? The process JOs will print this layout.')) return;
  try { await BoardsData.rpc('pmes_cut_plan_adopt', { p_plan: id }); toast('Adopted.', 'success'); render(); } catch (e) { toast(e.message, 'error'); }
}
async function viewCutPlan(id) {
  try {
    const p = await BoardsData.plan(id);
    openSheet(`<div class="sheet-title">Cutting plan v${p.version} (${p.status})</div>` + ((p.result && p.result.groups) || []).map((g) => `<div style="margin-top:8px;"><strong>${escapeHtml(g.label)}</strong>
      <div class="small">${g.layout.length} board(s)${g.extraNeeded ? ' incl. ' + g.extraNeeded + ' extra' : ''} · rejected ${(g.rejected || []).length}</div>
      <div>${g.layout.map((lay, i) => _bdBoardSvg({ no: g.boardNos[i], w: g.boardW, h: g.boardH, layout: lay, defects: g.defects[i], extra: String(g.boardNos[i]).startsWith('extra') }, 150)).join('')}</div></div>`).join(''));
  } catch (e) { toast(e.message, 'error'); }
}
async function requestExtraBoards(jobId) {
  const run = BoardsState.lastRun; if (!run || run.jobId !== jobId) return;
  const lines = run.groups.filter((g) => g.extraNeeded > 0).map((g) => ({ group_key: g.group_key, label: g.label, qty: g.extraNeeded, board_w: g.boardW, board_h: g.boardH }));
  const reason = (prompt('Request ' + lines.map((l) => l.qty + ' × ' + l.label).join(', ') + '.\nWhy are they needed? (defects found, rejected boards…)') || '').trim();
  if (!reason) return;
  try {
    if (!run.planId) await saveCutPlan(jobId);
    await BoardsData.rpc('pmes_board_request_create', { p_job: jobId, p_plan: run.planId || null, p_lines: lines, p_reason: reason });
    toast('Requested — a supervisor, then a manager, approve it before it goes to KEYSTONE.', 'success'); render();
  } catch (e) { toast(e.message, 'error'); }
}
async function boardReqAct(id, act) {
  try {
    if (act === 'approve') { if (!confirm('Approve this request for additional boards?')) return; const s = await BoardsData.rpc('pmes_board_request_approve', { p_req: id, p_approve: true, p_note: null });
      toast(s === 'sent_to_keystone' ? 'Approved — sent to KEYSTONE.' : 'Approved — waiting for a manager.', 'success'); }
    if (act === 'reject') { const n = (prompt('Why reject this request?') || '').trim(); if (!n) return; await BoardsData.rpc('pmes_board_request_approve', { p_req: id, p_approve: false, p_note: n }); toast('Rejected.', 'success'); }
    if (act === 'escalate') { const n = (prompt('Why should the Head of Plant Operations reconsider?') || '').trim(); if (!n) return; await BoardsData.rpc('pmes_board_request_escalate', { p_req: id, p_note: n }); toast('Escalated.', 'success'); }
    render();
  } catch (e) { toast(e.message, 'error'); }
}

/* ---- Board inspection editor: drag a box on the board to mark a defect ---- */
function openBoardInspect(jobId, keyEnc, boardNo) {
  const key = decodeURIComponent(keyEnc);
  Data.getJob(jobId).then((job) => {
    const grp = _bdGroups(job).find((x) => x.key === key); if (!grp) return;
    const existing = (State.jobBoards || []).find((b) => b.group_key === key && b.board_no === boardNo);
    window._insp = { jobId, key, label: grp.label, boardNo, w: +(existing ? existing.board_w : grp.g.boardW), h: +(existing ? existing.board_h : grp.g.boardH),
      status: existing ? existing.status : 'ok', notes: existing ? existing.notes || '' : '',
      defects: existing ? (existing.defects || []).map((d) => ({ x: +d.x, y: +d.y, w: +d.w, h: +d.h, type: d.defect_type, note: d.note || '' })) : [], type: 'chip' };
    _renderInsp();
  });
}
function _renderInsp() {
  const s = window._insp, maxPx = Math.min(460, window.innerHeight - 260), scale = maxPx / Math.max(s.w, s.h);
  const pw = Math.round(s.w * scale), ph = Math.round(s.h * scale);
  const defs = s.defects.map((d, i) => `<rect x="${d.x}" y="${d.y}" width="${d.w}" height="${d.h}" fill="rgba(220,40,40,.35)" stroke="#c0271d" stroke-width="${2 / scale}"></rect>
    <text x="${d.x + 4 / scale}" y="${d.y + 14 / scale}" font-size="${12 / scale}" fill="#8a1a12">${i + 1}</text>`).join('');
  openSheet(`<div class="sheet-title">${escapeHtml(s.label)} — board ${s.boardNo}</div>
    <p class="small">Drag on the board to mark a defect (${s.w}×${s.h}mm; top = start of the board length). Pick the type first.</p>
    <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-start;">
      <svg id="inspSvg" width="${pw}" height="${ph}" viewBox="0 0 ${s.w} ${s.h}" style="background:#fff;border:2px solid #8a7a63;touch-action:none;cursor:crosshair">${defs}<rect id="inspDrag" x="0" y="0" width="0" height="0" fill="rgba(220,40,40,.2)" stroke="#c0271d" stroke-dasharray="${6 / scale}"></rect></svg>
      <div style="flex:1;min-width:200px;">
        <label class="field-label">Defect type</label>
        <select id="inspType" onchange="window._insp.type=this.value">${DEFECT_TYPES.map(([v, t]) => `<option value="${v}" ${s.type === v ? 'selected' : ''}>${t}</option>`).join('')}</select>
        <div style="margin-top:8px;">${s.defects.length ? s.defects.map((d, i) => `<div class="small" style="display:flex;justify-content:space-between;gap:6px;padding:3px 0;border-bottom:1px solid var(--border);">
          <span><strong>${i + 1}.</strong> ${escapeHtml((DEFECT_TYPES.find((t) => t[0] === d.type) || [0, d.type])[1])} — ${Math.round(d.w)}×${Math.round(d.h)} at ${Math.round(d.x)},${Math.round(d.y)}</span>
          <button class="btn outline sm" style="padding:2px 8px;min-height:auto" onclick="window._insp.defects.splice(${i},1);_renderInsp()">×</button></div>`).join('') : '<p class="small">No defects marked.</p>'}</div>
        <label class="field-label" style="margin-top:10px;">Board status</label>
        <select id="inspStatus" onchange="window._insp.status=this.value">
          <option value="ok" ${s.status === 'ok' ? 'selected' : ''}>OK — usable</option>
          <option value="defect" ${s.status === 'defect' ? 'selected' : ''}>Usable, with the marked defects</option>
          <option value="rejected" ${s.status === 'rejected' ? 'selected' : ''}>Rejected — not usable</option></select>
        <input type="text" id="inspNotes" value="${escapeHtml(s.notes)}" placeholder="Notes (required when rejecting without a marked defect)" style="margin-top:8px;" oninput="window._insp.notes=this.value">
        <button class="btn primary block" style="margin-top:12px;" onclick="saveBoardInspect()">Save board ${s.boardNo}</button>
      </div></div>`);
  const svg = document.getElementById('inspSvg'), drag = document.getElementById('inspDrag');
  let start = null;
  const pt = (ev) => { const r = svg.getBoundingClientRect(); return { x: Math.max(0, Math.min(s.w, (ev.clientX - r.left) / r.width * s.w)), y: Math.max(0, Math.min(s.h, (ev.clientY - r.top) / r.height * s.h)) }; };
  svg.addEventListener('pointerdown', (ev) => { start = pt(ev); svg.setPointerCapture(ev.pointerId); });
  svg.addEventListener('pointermove', (ev) => { if (!start) return; const p = pt(ev);
    drag.setAttribute('x', Math.min(start.x, p.x)); drag.setAttribute('y', Math.min(start.y, p.y)); drag.setAttribute('width', Math.abs(p.x - start.x)); drag.setAttribute('height', Math.abs(p.y - start.y)); });
  svg.addEventListener('pointerup', (ev) => { if (!start) return; const p = pt(ev);
    const d = { x: Math.round(Math.min(start.x, p.x)), y: Math.round(Math.min(start.y, p.y)), w: Math.round(Math.abs(p.x - start.x)), h: Math.round(Math.abs(p.y - start.y)), type: s.type, note: '' };
    start = null;
    if (d.w < 5 || d.h < 5) { d.w = Math.max(d.w, 30); d.h = Math.max(d.h, 30); }   // a tap marks a small spot
    s.defects.push(d); if (s.status === 'ok') s.status = 'defect'; _renderInsp(); });
}
async function saveBoardInspect() {
  const s = window._insp;
  try {
    await BoardsData.rpc('pmes_board_save', { p_job: s.jobId, p_group_key: s.key, p_group_label: s.label, p_board_no: s.boardNo, p_w: s.w, p_h: s.h,
      p_status: s.status, p_notes: s.notes || null, p_defects: s.defects.map((d) => ({ x: d.x, y: d.y, w: d.w, h: d.h, type: d.type, note: d.note })) });
    closeSheet(); toast('Board ' + s.boardNo + ' saved.', 'success'); render();
  } catch (e) { toast(e.message, 'error'); }
}
