/* --------------------------- 5. Screen: Job detail ---------------------------
   One job, split into sub-tabs (Rommel 2026-09-27: the single long page was hard to use) so each
   person opens the part they work on: Overview · Materials · Cutting · Production · Parts · Packing.
   Data is loaded once per job; switching sub-tab redraws from it. */

const JOB_TABS = [
  ['overview', 'Overview'], ['materials', 'Materials'], ['cutting', 'Cutting'],
  ['production', 'Production'], ['parts', 'Parts'], ['packing', 'Packing'],
];

async function renderJobDetail(main) {
  const jobId = State.currentJobId;
  let job, stages, components, materials, materialSummary, joReviews = [], outputs = [], machines = [], readiness = [];
  try {
    [job, stages, components, materials, materialSummary, joReviews, outputs, machines] = await Promise.all([
      Data.getJob(jobId), Data.listJobStages(jobId), Data.listComponents(jobId),
      Data.listJobMaterials(jobId), Data.getJobMaterialSummary(jobId), Data.listJoReviews(jobId).catch(() => []),
      Data.listStageOutputs(jobId).catch(() => []), Data.listMachines().catch(() => []),
    ]);
    State.jobMRs = await Data.listJobMRs(jobId).catch(() => []);
    State.jobMaterialState = await Data.jobMaterialState(jobId).catch(() => ({ state: 'no_mrf' }));
    readiness = await Data.getJobMaterialReadiness(jobId).catch(() => []);
  } catch (e) {
    main.innerHTML = `<div class="empty"><div class="ic">⚠️</div><p>Could not load job.</p></div>`;
    return;
  }
  const materialsReady = materialSummary ? materialSummary.materials_ready : false;
  State.jd = {
    job, stages, components, materials, readiness, joReviews, outputs, machines, materialsReady,
    route: State.routeMappings.find((r) => r.code === job.route_code),
    canCut: job.job_active && materialsReady,
  };
  if (State.jobTabNext) State.jobTab = State.jobTabNext;
  else if (State.jdJobId !== jobId) State.jobTab = 'overview';
  State.jdJobId = jobId; State.jobTabNext = null;

  document.getElementById('screenTitle').textContent = job.job_code;
  const mo = job.mother_jo || {};
  const payTag = { paid: '<span class="badge green" title="KEYSTONE released it on payment">Paid</span>',
    vouched: '<span class="badge blue" title="KEYSTONE released it on a vouch (credit)">Vouched</span>' }[job.payment_status] || '';
  main.innerHTML = `
    <div class="flex-between" style="margin-bottom:8px;gap:8px;flex-wrap:wrap;">
      <button class="btn outline sm" onclick="goToScreen('jobs')">← All jobs</button>
      <span>${badgeForJoReview(job)} ${badgeForJobStatus(job.status)}</span>
    </div>
    <h1 class="page-title" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
      <span class="mono">${escapeHtml(job.job_code)}</span> ${badgeForDest(job.destination_company)} ${payTag}
    </h1>
    <p class="page-sub">${escapeHtml(mo.client || '')}${mo.project ? ' — ' + escapeHtml(mo.project) : ''}${mo.client || mo.project ? ' · ' : ''}${job.quotation_serial ? 'Quotation ' + escapeHtml(job.quotation_serial) : 'No quotation reference'} · Released ${fmtDate(job.created_at)}</p>
    ${!job.job_active ? `<div class="callout blocked"><strong>Inactive.</strong> KEYSTONE has not released this job (payment not met or not vouched).</div>` : ''}
    <div class="subtabs" id="jdTabs"></div>
    <div id="jdBody"></div>`;
  drawJobTab();
}

function setJobTab(t) { State.jobTab = t; drawJobTab(); }

function _jobTabFlag(t) {
  const d = State.jd, j = d.job, ms = State.jobMaterialState || { state: 'no_mrf' };
  if (t === 'overview') return ['received', 'checked', 'supervisor_ok', 'returned'].includes(j.jo_review_status || 'received') ? '•' : '';
  if (t === 'materials') return ms.state === 'complete' || ms.state === 'no_mrf' ? '' : '•';
  if (t === 'production') return d.outputs.some((o) => o.status === 'entered') ? '•' : '';
  if (t === 'parts') return d.components.length ? String(d.components.length) : '';
  return '';
}

function drawJobTab() {
  const d = State.jd; if (!d) return;
  const tabs = document.getElementById('jdTabs'), body = document.getElementById('jdBody');
  if (!tabs || !body) return;
  tabs.innerHTML = JOB_TABS.map(([k, l]) => {
    const f = _jobTabFlag(k);
    return `<button class="${State.jobTab === k ? 'on' : ''}" onclick="setJobTab('${k}')">${l}${f ? ' <span class="subtab-flag">' + f + '</span>' : ''}</button>`;
  }).join('');
  const { job, stages, components, materials, readiness, joReviews, outputs, machines, route, canCut, materialsReady } = d;
  const t = State.jobTab;

  if (t === 'overview') {
    const done = stages.filter((s) => s.status === 'complete').length;
    body.innerHTML = `
      ${renderJoReviewCard(job, joReviews)}
      ${stages.length ? `<div class="card"><div class="flex-between"><h2 class="mb-0">Progress</h2><span class="small">${done} of ${stages.length} processes complete</span></div>
        <table class="comp-table" style="margin-top:8px;"><thead><tr><th>Process</th><th>Status</th><th>Output</th></tr></thead><tbody>
        ${stages.map((s) => { const st = State.stageTypes.find((x) => x.code === s.stage_code);
          return `<tr><td>${st ? escapeHtml(st.label) : s.stage_code}</td><td>${badgeForStageStatus(s.status)}</td><td class="small">${_outputLine(s, components, outputs, job) || '—'}</td></tr>`; }).join('')}
        </tbody></table>
        ${joApproved(job) ? '<button class="btn outline sm" style="margin-top:8px;" onclick="setJobTab(\'production\')">Go to Production →</button>' : ''}</div>` : ''}
      <div class="card"><h2>Job notes</h2><p class="small">${job.notes ? escapeHtml(job.notes) : 'No notes.'}</p></div>`;
  }

  else if (t === 'materials') {
    // One place for this job's materials: the MRF from KEYSTONE when there is one; the hand-kept list
    // only for jobs made by hand (no MRF) — showing both repeated the same materials twice.
    const mrs = State.jobMRs || [];
    body.innerHTML = mrs.length ? `<div class="card"><h2>Material requests (MRF)</h2>
        <p class="small">What KEYSTONE authorized for this job, what the warehouse processed, and what arrived. The materials person confirms receipt here or on the Materials tab.</p>
        ${renderMRBlocks(mrs)}</div>`
      : `<div class="card"><div class="flex-between"><h2 class="mb-0">Materials required &amp; received</h2>
          ${materialsReady ? '<span class="badge green">Ready for cutting</span>' : (materials.length ? '<span class="badge amber">Awaiting materials</span>' : '<span class="badge gray">Not specified</span>')}</div>
        <p class="small" style="margin-top:6px;">This job has no MRF from KEYSTONE, so its materials are kept here by hand.</p>
        ${materials.length ? materials.map((m) => {
          const r = readiness.find((x) => x.job_material_id === m.id);
          const recv = r ? Number(r.qty_received) : 0, req = Number(m.qty_required), pct = Math.min(100, Math.round((recv / req) * 100));
          return `<div style="padding:12px 0;border-bottom:1px solid var(--border);">
            <div class="flex-between"><div><div style="font-weight:700;font-size:14px;">${escapeHtml(m.material)}${m.color ? ' · ' + escapeHtml(m.color) : ''}${m.thickness_mm ? ' · ' + m.thickness_mm + 'mm' : ''}</div>
              <div class="small">${recv} / ${req} ${escapeHtml(m.unit)} received${m.sourcing ? ' · ' + m.sourcing.replace('_', ' ') : ''}</div></div>
              ${r && r.line_fulfilled ? '<span class="badge green">Complete</span>' : '<span class="badge amber">Partial</span>'}</div>
            <div style="background:#e4e9ee;border-radius:4px;height:6px;margin-top:8px;overflow:hidden;"><div style="background:${r && r.line_fulfilled ? 'var(--green)' : 'var(--amber)'};height:100%;width:${pct}%;"></div></div>
            <button class="btn outline sm" style="margin-top:8px;" onclick="openReceiveMaterialSheet('${m.id}','${job.id}')">+ Log receipt</button></div>`;
        }).join('') : '<p class="small" style="margin-top:8px;">No materials specified yet for this job.</p>'}
        <button class="btn secondary sm" style="margin-top:12px;" onclick="openAddJobMaterialSheet('${job.id}')">+ Add required material</button></div>`;
  }

  else if (t === 'cutting') {
    const cutStages = stages.filter((s) => ['CUT', 'SCUT'].includes(s.stage_code));
    body.innerHTML = `
      ${cutStages.length && components.length && joApproved(job) ? `<div class="card"><h2>Print for the saw</h2><div style="display:flex;gap:8px;flex-wrap:wrap;">
        ${cutStages.map((s) => `<button class="btn outline sm" onclick="printProcessJO('${job.id}','${s.stage_code}')">Process JO — ${s.stage_code} (${componentsForStage(components, s.stage_code, job).length})</button>`).join('')}</div></div>` : ''}
      <div id="boardsBlock"><div class="card"><p class="small">Loading boards…</p></div></div>`;
    if (job.mother_jo && (job.mother_jo.boards || []).length) renderBoardsCards(job, document.getElementById('boardsBlock'));
    else document.getElementById('boardsBlock').innerHTML = '<div class="card"><p class="small">No cutting layout on this job — it did not come from a Modcraft cutting list.</p></div>';
  }

  else if (t === 'production') {
    body.innerHTML = `
      <div class="card"><h2>Route</h2>
      ${route ? `<p class="small">${escapeHtml(route.label)}</p><div class="route-flow">
          ${route.stage_sequence.map((code, i) => { const st = stages.find((s) => s.sequence_index === i);
            const cls = st && st.status === 'complete' ? 'done' : (st && (st.status === 'in_progress' || st.status === 'queued') ? 'current' : '');
            return `<span class="route-step ${cls}">${code}</span>` + (i < route.stage_sequence.length - 1 ? '<span class="route-arrow">→</span>' : ''); }).join('')}</div>`
        : (stages.length && components.some((c) => Array.isArray(c.route) && c.route.length)) ? `
          <p class="small">Per-piece routes from Modcraft ${escapeHtml(String(job.source_file_ref || '').replace(/^job_orders:/, 'Job Order '))}. Each piece follows its own route; below is every process this job needs.</p>
          <div class="route-flow">${stages.map((s, i) => `<span class="route-step">${s.stage_code}</span>` + (i < stages.length - 1 ? '<span class="route-arrow">→</span>' : '')).join('')}</div>`
        : `<p class="small">No route assigned yet.</p><select id="routeAssignSelect"><option value="">— Select route —</option>
          ${State.routeMappings.map((r) => `<option value="${r.code}">${escapeHtml(r.label)}</option>`).join('')}</select>
          <button class="btn secondary sm" style="margin-top:10px;" onclick="assignRoute('${job.id}')">Assign route</button>`}
      </div>
      ${!joApproved(job) ? '<div class="callout info">Nothing can be logged until the Job Order is approved (Overview tab).</div>' : ''}
      ${stages.length ? `<div class="card"><h2>Processes</h2>
        ${stages.map((s, idx) => { const stageType = State.stageTypes.find((x) => x.code === s.stage_code);
          const cls = s.status === 'complete' ? 'complete' : s.status === 'delayed' ? 'delayed' : (s.status === 'in_progress' || s.status === 'queued') ? 'current' : '';
          return `<div class="stage-item ${cls}"><div class="stage-num">${idx + 1}</div><div class="stage-body">
              <div class="stage-name">${stageType ? escapeHtml(stageType.label) : s.stage_code}</div>
              <div class="stage-meta">${badgeForStageStatus(s.status)}${s.operator ? ' · ' + escapeHtml(s.operator) : ''}${s.delay_flag ? ' · ⚠ ' + escapeHtml(s.delay_reason || 'delayed') : ''}${_outputLine(s, components, outputs, job)}</div></div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
              ${components.length && joApproved(job) ? `<button class="btn outline sm" onclick="printProcessJO('${job.id}','${s.stage_code}')" title="Work order for this process: only the pieces that go through it">Process JO (${componentsForStage(components, s.stage_code, job).length})</button>` : ''}
              ${s.status !== 'complete' && joApproved(job) ? `<button class="btn outline sm" onclick="openStageActionSheet('${s.id}','${job.id}')">Update</button>` : ''}
            </div></div>`; }).join('')}</div>` : ''}
      ${stages.length && joApproved(job) ? renderOutputCard(job, stages, components, outputs, machines) : ''}`;
  }

  else if (t === 'parts') {
    body.innerHTML = `<div class="card"><div class="flex-between"><h2 class="mb-0">Parts ${components.length ? '(' + components.length + ')' : ''}</h2>
        ${canCut && stages.length > 0 && !components.length ? `<button class="btn secondary sm" onclick="openGenerateComponentsSheet('${job.id}')">+ Generate</button>` : ''}</div>
      ${components.length ? renderComponentsTable(components)
        : `<p class="small" style="margin-top:8px;">${job.mother_jo ? 'No parts yet.' : !canCut ? 'Parts are created during cutting optimization — once the job is active and its materials are ready.' : !stages.length ? 'Assign a route before generating parts.' : 'No parts yet. Tap “+ Generate”.'}</p>`}</div>`;
  }

  else if (t === 'packing') {
    body.innerHTML = components.length ? '<div class="card"><h2>Packing &amp; hand-off</h2><div id="packingBlock">Loading…</div></div>'
      : '<div class="card"><p class="small">Packing starts once the job has parts.</p></div>';
    if (components.length) renderPackingBlock(job, components);
  }
}

/* ---- Job Order review gate (Piece 1) ------------------------------------------------------
   received -> (staff: details ok + materials ok) -> checked -> (supervisor) approved
   A supervisor can return it to staff, or to Modcraft (messages the quotation's preparer).
   Nothing reaches the line before 'approved': the database refuses stage/scan progress, and the
   Process JO print and stage Update buttons stay hidden. */
function renderJoReviewCard(job, reviews) {
  const st = job.jo_review_status || 'received';
  const role = (State.me && State.me.role) || '';
  const canCheck = ['staff', 'supervisor', 'manager', 'admin'].includes(role) && st !== 'approved';
  // A delegate (pmes_delegations) holds the manager's approval authority for the period.
  const acting = State.me && State.me.acting_for;
  const isSup = pmesCan('supervisor') || !!acting, isMgr = pmesCan('manager') || !!acting;
  const who = (e, n) => escapeHtml(n || e || '');
  // Materials status comes from the MRF (the materials person's receipts), not from a tick.
  const ms = State.jobMaterialState || { state: 'no_mrf' };
  const matBadge = {
    complete: '<span class="badge green">Materials complete</span>',
    partial: '<span class="badge amber">Materials partly received</span>',
    none: '<span class="badge red">Materials not received yet</span>',
    no_mrf: '<span class="badge gray">No MRF for this job</span>',
  }[ms.state] || '';
  const matLine = ms.state === 'no_mrf'
    ? 'No material request came with this Job Order — staff confirm availability themselves.'
    : ms.received + ' of ' + ms.requested + ' received · ' + ms.lines_complete + ' of ' + ms.lines + ' lines complete (from the MRF).';
  const incomplete = job.jo_proceed_incomplete && ms.state !== 'complete';
  const state = {
    received: '<span class="badge amber">Received — waiting for staff check</span>',
    checked: incomplete ? '<span class="badge amber">Recommended to proceed — waiting for supervisor</span>' : '<span class="badge blue">Checked — waiting for supervisor approval</span>',
    supervisor_ok: '<span class="badge amber">Supervisor approved — waiting for manager</span>',
    approved: '<span class="badge green">Approved for the line</span>',
    returned: '<span class="badge red">Returned to ' + (job.jo_returned_to === 'modcraft' ? 'Modcraft' : 'staff') + '</span>',
  }[st];
  const hist = (reviews || []).map((r) => {
    const what = { checked: 'Checked ✓', not_ok: 'Checked — not OK', recommend_proceed: 'Recommended to proceed (materials incomplete)', supervisor_ok: 'Supervisor approved', approved: 'Approved', returned_staff: 'Returned to staff', returned_modcraft: 'Returned to Modcraft' }[r.action] || r.action;
    const m = r.material_state && r.material_state.state && r.material_state.state !== 'no_mrf' ? ' · materials ' + r.material_state.received + '/' + r.material_state.requested : '';
    const flags = ['checked', 'not_ok', 'recommend_proceed'].includes(r.action) ? ' (details ' + (r.details_ok ? 'ok' : 'NOT ok') + ', materials ' + (r.materials_ok ? 'complete' : 'NOT complete') + m + ')' : m;
    return '<div class="small" style="padding:4px 0;border-bottom:1px solid var(--border);"><strong>' + what + '</strong>' + flags + ' — ' + who(r.by_email, r.by_name) + ', ' + fmtDate(r.at) + (r.note ? '<br>' + escapeHtml(r.note) : '') + '</div>';
  }).join('');
  // Who may press Approve right now. Rule (Rommel 2026-09-27): whoever checked it may not approve
  // it — except a manager, at their discretion, when staff or the supervisor is absent (reason
  // required). The database enforces the same (pmes_jo_approve).
  const me = ((State.me && State.me.email) || '').toLowerCase();
  const selfCheck = !!job.jo_checked_by && job.jo_checked_by.toLowerCase() === me;
  const discBtn = (label) => `<button class="btn primary sm" onclick="submitJoApprove('${job.id}',true)" title="Manager's discretion — give the reason in the note">${label}</button>`;
  let approveBtn = '';
  if (st === 'checked' && isSup) {
    if (selfCheck && !isMgr) approveBtn = '<button class="btn primary sm" disabled title="You checked it — someone else must approve">Approve (someone else)</button>';
    else if (selfCheck) approveBtn = discBtn('Approve at manager’s discretion');
    else if (incomplete && isMgr && role !== 'supervisor') approveBtn = discBtn('Approve at manager’s discretion (supervisor absent)');
    else approveBtn = incomplete
      ? `<button class="btn primary sm" onclick="submitJoApprove('${job.id}')">Approve as supervisor</button>`
      : `<button class="btn primary sm" onclick="submitJoApprove('${job.id}')">Approve for the line</button>`;
  } else if (st === 'supervisor_ok') {
    approveBtn = isMgr && job.jo_supervisor_by !== (State.me && State.me.email)
      ? (selfCheck ? discBtn('Approve at manager’s discretion') : `<button class="btn primary sm" onclick="submitJoApprove('${job.id}')">Approve as manager — send to the line</button>`)
      : '<button class="btn primary sm" disabled title="Needs a manager (not the supervisor who approved)">Waiting for manager</button>';
  } else if (isSup) {
    approveBtn = '<button class="btn primary sm" disabled title="Staff must check it first">Approve for the line</button>';
  }
  return `
    <div class="card" style="border-left:4px solid ${st === 'approved' ? 'var(--green)' : st === 'returned' ? 'var(--red)' : 'var(--amber)'};">
      <div class="flex-between"><h2 class="mb-0">Job Order review</h2>${state}</div>
      <div style="margin-top:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">${matBadge}<span class="small">${escapeHtml(matLine)}</span></div>
      ${st === 'returned' && job.jo_return_note ? '<div class="callout blocked" style="margin-top:8px;"><strong>Returned:</strong> ' + escapeHtml(job.jo_return_note) + '</div>' : ''}
      ${incomplete && job.jo_proceed_reason ? '<div class="callout info" style="margin-top:8px;"><strong>Proceed with incomplete materials — staff reason:</strong> ' + escapeHtml(job.jo_proceed_reason) + (job.jo_supervisor_by ? '<br>Supervisor approved: ' + escapeHtml(job.jo_supervisor_by) + ', ' + fmtDate(job.jo_supervisor_at) : '') + '</div>' : ''}
      ${st !== 'approved' ? '<div class="callout info" style="margin-top:8px;">Nothing goes to the line until it is approved. With complete materials a supervisor approves; with incomplete materials staff may recommend proceeding, and it then needs a supervisor <strong>and</strong> a manager. Whoever checks it cannot approve it — only a manager may, at their discretion, when staff or the supervisor is absent (with a reason).</div>' : ''}
      ${canCheck && st !== 'supervisor_ok' ? `
        <div style="margin-top:12px;padding-top:12px;border-top:1px dashed var(--border);">
          <label class="field-label">Staff check</label>
          <label style="display:block;margin:6px 0;"><input type="checkbox" id="joDetailsOk" ${job.jo_details_ok ? 'checked' : ''}> All details are correct (parts, sizes, materials, edges match the cutting list)</label>
          ${ms.state === 'no_mrf'
            ? `<label style="display:block;margin:6px 0;"><input type="checkbox" id="joMaterialsOk" ${job.jo_materials_ok ? 'checked' : ''}> All materials are available</label>`
            : ms.state !== 'complete' ? `<label style="display:block;margin:6px 0;"><input type="checkbox" id="joProceed"> Recommend proceeding with incomplete materials (needs supervisor and manager approval)</label>` : ''}
          <input type="text" id="joCheckNote" placeholder="${ms.state !== 'complete' && ms.state !== 'no_mrf' ? 'Reason to proceed, or what is wrong' : 'Note (what is missing or wrong, if anything)'}" style="margin-top:6px;" />
          <button class="btn primary sm" style="margin-top:8px;" onclick="submitJoCheck('${job.id}')">Save check</button>
        </div>` : ''}
      ${isSup && st !== 'approved' ? `
        <div style="margin-top:12px;padding-top:12px;border-top:1px dashed var(--border);">
          <label class="field-label">Supervisor / manager</label>
          ${acting && !pmesCan('manager') ? '<div class="callout info" style="margin:6px 0;">You are approving <strong>on behalf of ' + escapeHtml(acting.name || acting.email) + '</strong> (delegated until ' + fmtDate(acting.until) + '). It is recorded that way.</div>' : ''}
          <input type="text" id="joSupNote" placeholder="Note (required when returning, or when approving at your discretion)" />
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
            ${approveBtn}
            <button class="btn outline sm" onclick="submitJoReturn('${job.id}','staff')">Return to staff</button>
            <button class="btn outline sm" onclick="submitJoReturn('${job.id}','modcraft')">Return to Modcraft</button>
          </div>
        </div>` : ''}
      ${hist ? '<div style="margin-top:12px;"><div class="field-label">History</div>' + hist + '</div>' : ''}
    </div>`;
}
async function submitJoCheck(jobId) {
  const d = document.getElementById('joDetailsOk').checked;
  const mEl = document.getElementById('joMaterialsOk'), pEl = document.getElementById('joProceed');
  const m = mEl ? mEl.checked : false, proceed = pEl ? pEl.checked : false;
  const note = document.getElementById('joCheckNote').value.trim();
  const ms = State.jobMaterialState || { state: 'no_mrf' };
  const matOk = ms.state === 'no_mrf' ? m : ms.state === 'complete';
  if (!d && !note) return toast('Say what is wrong.', 'error');
  if (d && !matOk && !proceed && !note) return toast('Materials are not complete — say what is missing, or recommend proceeding with a reason.', 'error');
  if (proceed && !note) return toast('Give the reason to proceed with incomplete materials.', 'error');
  try {
    const r = await Data.joCheck(jobId, d, m, note, proceed);
    const msg = { checked: 'Checked — waiting for the supervisor.', recommend_proceed: 'Recommended — needs supervisor, then manager.' }[r && r.action] || 'Check saved; the Job Order is not ready yet.';
    toast(msg, 'success'); render();
  } catch (e) { toast(e.message, 'error'); }
}
async function submitJoApprove(jobId, discretion) {
  const note = document.getElementById('joSupNote').value.trim();
  if (discretion && !note) return toast('Write the reason in the note (e.g. supervisor absent, staff on leave, delegated) — it is recorded.', 'error');
  if (!confirm(discretion ? 'Approve at your discretion? Your reason is recorded in the history.' : 'Approve this Job Order?')) return;
  try {
    const r = await Data.joApprove(jobId, note);
    toast(r && r.status === 'supervisor_ok' ? 'Supervisor approval recorded — a manager must approve next (materials incomplete).' : 'Approved — it can now be printed and scheduled.', 'success'); render();
  } catch (e) { toast(e.message, 'error'); }
}
async function submitJoReturn(jobId, to) {
  const note = document.getElementById('joSupNote').value.trim();
  if (!note) return toast('Write the reason in the note first.', 'error');
  if (!confirm('Return this Job Order to ' + (to === 'modcraft' ? 'the Modcraft user who prepared the quotation' : 'staff') + '?')) return;
  try { const r = await Data.joReturn(jobId, to, note); toast(to === 'modcraft' ? 'Returned — ' + ((r && r.notified) || 0) + ' person(s) messaged in Modcraft.' : 'Returned to staff.', 'success'); render(); }
  catch (e) { toast(e.message, 'error'); }
}

/* ---- Actual output (Piece 2) ---------------------------------------------------------------
   What the returned process sheets say was done: per process, per day, per machine. Staff enters
   it; a supervisor confirms (or rejects with a note). Confirmed pieces move the stage against the
   pieces the JO routes through it. Only on an approved JO. */
function _outputTotals(stage, components, outputs, job) {
  const planned = componentsForStage(components, stage.stage_code, job).length;
  const mine = outputs.filter((o) => o.stage_id === stage.id);
  const confirmed = mine.filter((o) => o.status === 'confirmed').reduce((a, o) => a + o.pieces, 0);
  const pending = mine.filter((o) => o.status === 'entered').reduce((a, o) => a + o.pieces, 0);
  return { planned, confirmed, pending };
}
function _outputLine(stage, components, outputs, job) {
  const t = _outputTotals(stage, components, outputs, job);
  if (!t.planned && !t.confirmed && !t.pending) return '';
  return ' · actual <strong>' + t.confirmed + '</strong> / ' + t.planned + ' pcs' + (t.pending ? ' (+' + t.pending + ' awaiting confirmation)' : '');
}
function renderOutputCard(job, stages, components, outputs, machines) {
  const canEnter = pmesCan('staff'), canConfirm = pmesCan('supervisor');
  const today = new Date().toISOString().slice(0, 10);
  const stageLabel = (code) => { const t = State.stageTypes.find((x) => x.code === code); return t ? t.label : code; };
  const machineName = (id) => { const m = machines.find((x) => x.id === id); return m ? m.name : ''; };
  const rows = outputs.map((o) => {
    const badge = { entered: '<span class="badge amber">awaiting confirmation</span>', confirmed: '<span class="badge green">confirmed</span>', rejected: '<span class="badge red">rejected</span>' }[o.status];
    const who = escapeHtml(o.entered_by_name || o.entered_by);
    return '<tr><td>' + escapeHtml(o.work_date) + '</td><td>' + escapeHtml(stageLabel(o.stage_code)) + '</td><td><strong>' + o.pieces + '</strong></td>'
      + '<td>' + (o.hours != null ? o.hours : '—') + '</td><td>' + escapeHtml(o.operator || '—') + (o.machine_id ? '<br><span class="small">' + escapeHtml(machineName(o.machine_id)) + '</span>' : '') + '</td>'
      + '<td>' + badge + '<br><span class="small">' + who + (o.status !== 'entered' ? ' · ' + escapeHtml(o.confirmed_by_name || o.confirmed_by || '') : '') + '</span>'
      + (o.notes ? '<br><span class="small">' + escapeHtml(o.notes) + '</span>' : '') + (o.confirm_note ? '<br><span class="small">Supervisor: ' + escapeHtml(o.confirm_note) + '</span>' : '') + '</td>'
      + '<td style="white-space:nowrap">'
      + (canConfirm && o.status === 'entered' ? '<button class="btn primary sm" onclick="confirmOutput(\'' + o.id + '\',true)">Confirm</button> <button class="btn outline sm" onclick="confirmOutput(\'' + o.id + '\',false)">Reject</button> ' : '')
      + (o.status === 'entered' && (canConfirm || (State.me && o.entered_by === State.me.email)) ? '<button class="btn outline sm" onclick="deleteOutput(\'' + o.id + '\')">Remove</button>' : '')
      + '</td></tr>';
  }).join('');
  return `
    <div class="card">
      <h2>Actual output <span class="small">from the returned process sheets</span></h2>
      <div style="display:flex;flex-wrap:wrap;gap:12px;margin:8px 0 4px;">
        ${stages.map((s) => { const t = _outputTotals(s, components, outputs, job); const pct = t.planned ? Math.min(100, Math.round(t.confirmed / t.planned * 100)) : 0;
          return '<div style="min-width:140px;"><div class="small"><strong>' + escapeHtml(stageLabel(s.stage_code)) + '</strong> ' + t.confirmed + ' / ' + t.planned + '</div>'
            + '<div style="background:#e4e9ee;border-radius:4px;height:6px;margin-top:4px;overflow:hidden;"><div style="background:' + (pct >= 100 ? 'var(--green)' : 'var(--amber)') + ';height:100%;width:' + pct + '%;"></div></div></div>'; }).join('')}
      </div>
      ${canEnter ? `
        <div style="margin-top:12px;padding-top:12px;border-top:1px dashed var(--border);">
          <label class="field-label">Enter output from a returned sheet</label>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;">
            <select id="outStage">${stages.map((s) => '<option value="' + s.id + '">' + escapeHtml(stageLabel(s.stage_code)) + '</option>').join('')}</select>
            <input type="date" id="outDate" value="${today}" max="${today}">
            <input type="number" id="outPieces" min="0" step="1" placeholder="Pieces done">
            <input type="number" id="outHours" min="0" step="0.25" placeholder="Hours (optional)">
            <input type="text" id="outOperator" placeholder="Operator">
            <select id="outMachine"><option value="">Machine (optional)</option>${machines.filter((m) => m.active !== false).map((m) => '<option value="' + m.id + '">' + escapeHtml(m.name) + (m.stage_code ? ' · ' + m.stage_code : '') + '</option>').join('')}</select>
          </div>
          <input type="text" id="outNotes" placeholder="Notes (rework, breakage, why short)" style="margin-top:8px;">
          <button class="btn primary sm" style="margin-top:8px;" onclick="submitOutput('${job.id}')">Add entry</button>
          <span class="small" style="margin-left:8px;">A supervisor confirms each entry before it counts.</span>
        </div>` : ''}
      ${rows ? '<div style="margin-top:12px;overflow-x:auto;"><table class="comp-table"><thead><tr><th>Date</th><th>Process</th><th>Pcs</th><th>Hrs</th><th>Operator / machine</th><th>Status</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>'
             : '<p class="small" style="margin-top:10px;">No output entered yet.</p>'}
    </div>`;
}
async function submitOutput(jobId) {
  const pieces = parseInt(document.getElementById('outPieces').value, 10);
  if (isNaN(pieces) || pieces < 0) return toast('Enter the pieces done.', 'error');
  const hoursRaw = document.getElementById('outHours').value;
  try {
    await Data.outputEnter({ job_id: jobId, stage_id: document.getElementById('outStage').value, work_date: document.getElementById('outDate').value,
      pieces, hours: hoursRaw === '' ? null : Number(hoursRaw), operator: document.getElementById('outOperator').value.trim(),
      machine_id: document.getElementById('outMachine').value || null, notes: document.getElementById('outNotes').value.trim() });
    toast('Entered — waiting for a supervisor to confirm.', 'success'); render();
  } catch (e) { toast(e.message, 'error'); }
}
async function confirmOutput(id, ok) {
  const note = ok ? '' : (prompt('Why is this entry rejected?') || '').trim();
  if (!ok && !note) return;
  try { await Data.outputConfirm(id, ok, note); toast(ok ? 'Confirmed.' : 'Rejected.', 'success'); render(); }
  catch (e) { toast(e.message, 'error'); }
}
async function deleteOutput(id) {
  if (!confirm('Remove this entry?')) return;
  try { await Data.outputDelete(id); toast('Removed.', 'success'); render(); }
  catch (e) { toast(e.message, 'error'); }
}

/* ---- MRF (material request) — released with the JO from KEYSTONE ---------------------------
   KEYSTONE builds it from the quotation's materials (Modcraft BOM / cutting list / outsource) and
   authorizes it at release; the warehouse confirms "processed" there; production confirms here what
   actually arrived. Up to what was processed; partial is fine. A receipt also counts against the
   job's materials above, so the JO check can see it. */
function renderMRCard(job, mrs) {
  if (!mrs.length) return `<div class="card"><h2>Material requests (MRF)</h2><p class="small">No MRF for this job yet — KEYSTONE issues it with the Job Order at release.</p></div>`;
  return `<div class="card"><h2>Material requests (MRF)</h2>${renderMRBlocks(mrs)}</div>`;
}
// The MRF blocks themselves (lines + receive form). Used on the job page and the Materials page.
function renderMRBlocks(mrs) {
  const canReceive = (State.me && State.me.role === 'materials') || pmesCan('supervisor');
  const pill = (st) => { const c = { authorized: 'blue', partially_issued: 'amber', issued: 'amber', partially_received: 'amber', received: 'green', closed: 'gray', cancelled: 'red' }[st] || 'gray';
    const t = { authorized: 'Waiting for the warehouse', partially_issued: 'Warehouse partly processed', issued: 'Processed — confirm receipt', partially_received: 'Partly received', received: 'Received' }[st] || st;
    return '<span class="badge ' + c + '">' + escapeHtml(t) + '</span>'; };
  return mrs.map((m) => {
    const open = canReceive && ['partially_issued', 'issued', 'partially_received'].includes(m.status);
    return `<div style="border:1px solid var(--border);border-radius:10px;padding:10px;margin-top:10px;">
      <div class="flex-between"><strong class="mono">${escapeHtml(m.mr_no || '')}</strong> <span class="small">${m.stream === 'purchase' ? 'purchase (outsource / made-to-order)' : 'warehouse'}</span> ${pill(m.status)}</div>
      <div class="small" style="margin-top:4px;">${m.processed_by ? 'Processed by ' + escapeHtml(m.processed_by) + ', ' + fmtDate(m.processed_at) : 'Not yet processed by the warehouse'}${m.received_by ? ' · Received by ' + escapeHtml(m.received_by) + ', ' + fmtDate(m.received_at) : ''}</div>
      <table class="comp-table" style="margin-top:8px;"><thead><tr><th>Item</th><th>Unit</th><th>Requested</th><th>Processed</th><th>Received</th></tr></thead><tbody>
      ${(m.lines || []).map((l) => `<tr><td>${escapeHtml(l.item)}${l.area ? '<br><span class="small">' + escapeHtml(l.area) + '</span>' : ''}</td><td>${escapeHtml(l.unit || '')}</td><td>${l.qty}</td><td>${l.issued}</td>
        <td>${open && l.issued > 0 ? `<input type="number" min="0" max="${l.issued}" step="any" class="mrRecv" data-mr="${m.id}" data-line="${l.id}" value="${l.received || ''}" placeholder="0" style="width:80px;">` : l.received}</td></tr>`).join('')}
      </tbody></table>
      ${open ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
        <button class="btn outline sm" onclick="document.querySelectorAll('.mrRecv[data-mr=&quot;${m.id}&quot;]').forEach((i)=>{i.value=i.max;})">All processed arrived</button>
        <input type="text" id="mrNote_${m.id}" placeholder="Note (damage, shortage)" style="flex:1;min-width:160px;">
        <button class="btn primary sm" onclick="submitMRReceive('${m.id}')">Confirm received</button></div>` : ''}
    </div>`; }).join('');
}
async function submitMRReceive(mrId) {
  const lines = [...document.querySelectorAll('.mrRecv[data-mr="' + mrId + '"]')].map((i) => ({ id: i.dataset.line, qty: i.value === '' ? 0 : Number(i.value) }));
  if (lines.some((l) => !(l.qty >= 0))) return toast('Enter the quantity received for each line.', 'error');
  try { const r = await Data.receiveMR(mrId, lines, (document.getElementById('mrNote_' + mrId) || {}).value);
    toast('Receipt confirmed — ' + String(r.status).replace(/_/g, ' ') + '.', 'success'); render(); }
  catch (e) { toast(e.message, 'error'); }
}

function renderComponentsTable(components) {
  const shown = components.slice(0, 12);
  return `
    <table class="comp-table" style="margin-top:10px;">
      <thead><tr><th>Barcode ID</th><th>Stage</th><th>Status</th></tr></thead>
      <tbody>
        ${shown.map((c) => `
          <tr>
            <td class="id">${escapeHtml(c.full_barcode_id)}</td>
            <td>${c.current_stage_code || '—'}</td>
            <td>${c.status}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    ${components.length > 12 ? `<p class="small" style="margin-top:6px;">+ ${components.length - 12} more</p>` : ''}
  `;
}

function openAddJobMaterialSheet(jobId) {
  openSheet(`
    <div class="sheet-title">Add required material</div>
    <p class="small" style="margin-bottom:14px;">One line item this job needs before cutting can start.</p>
    <label class="field-label">Material *</label>
    <input type="text" id="jmMaterial" placeholder="e.g. Melamine Board" />
    <label class="field-label">Color / finish</label>
    <input type="text" id="jmColor" placeholder="e.g. White Oak" />
    <label class="field-label">Thickness (mm)</label>
    <input type="number" id="jmThickness" placeholder="e.g. 18" />
    <label class="field-label">Quantity required *</label>
    <div class="btn-row">
      <input type="number" id="jmQty" placeholder="Qty" style="flex:2;" min="0.01" step="0.01" />
      <select id="jmUnit" style="flex:1;">
        <option value="sheet">sheet</option>
        <option value="sqm">sqm</option>
        <option value="pcs">pcs</option>
        <option value="kg">kg</option>
        <option value="lm">lm</option>
        <option value="roll">roll</option>
        <option value="set">set</option>
        <option value="other">other</option>
      </select>
    </div>
    <label class="field-label">Sourcing</label>
    <select id="jmSourcing">
      <option value="">— not specified —</option>
      <option value="mto">MTO (Made-to-Order)</option>
      <option value="buy_stock">Buy / Stock</option>
    </select>
    <button class="btn primary block" style="margin-top:16px;" onclick="submitAddJobMaterial('${jobId}')">Add material line</button>
  `);
}

async function submitAddJobMaterial(jobId) {
  const material = document.getElementById('jmMaterial').value.trim();
  const color = document.getElementById('jmColor').value.trim() || null;
  const thickness_mm = parseFloat(document.getElementById('jmThickness').value) || null;
  const qty_required = parseFloat(document.getElementById('jmQty').value);
  const unit = document.getElementById('jmUnit').value;
  const sourcing = document.getElementById('jmSourcing').value || null;

  if (!material) return toast('Material is required.', 'error');
  if (!qty_required || qty_required <= 0) return toast('Enter a valid quantity required.', 'error');

  try {
    await Data.createJobMaterial({ job_id: jobId, material, color, thickness_mm, qty_required, unit, sourcing });
    closeSheet();
    toast('Material line added.', 'success');
    render();
  } catch (e) {
    toast('Could not add material: ' + e.message, 'error');
  }
}

function openReceiveMaterialSheet(jobMaterialId, jobId) {
  openSheet(`
    <div class="sheet-title">Log material receipt</div>
    <p class="small" style="margin-bottom:14px;">
      Recorded by the warehouse/materials team when a delivery arrives. Partial deliveries are
      fine — log each batch as it comes in.
    </p>
    <label class="field-label">Quantity received *</label>
    <input type="number" id="mrQty" min="0.01" step="0.01" placeholder="Qty" />
    <label class="field-label">Received by *</label>
    <input type="text" id="mrReceivedBy" placeholder="Warehouse staff name / badge id" />
    <label class="field-label">Source / delivery reference (optional)</label>
    <input type="text" id="mrSourceNote" placeholder="e.g. supplier PO, WCLI batch id" />
    <label class="field-label">Notes</label>
    <textarea id="mrNotes" placeholder="Optional"></textarea>
    <button class="btn primary block" style="margin-top:16px;" onclick="submitReceiveMaterial('${jobMaterialId}','${jobId}')">Log receipt</button>
  `);
}

async function submitReceiveMaterial(jobMaterialId, jobId) {
  const qty_received = parseFloat(document.getElementById('mrQty').value);
  const received_by = document.getElementById('mrReceivedBy').value.trim();
  const source_note = document.getElementById('mrSourceNote').value.trim() || null;
  const notes = document.getElementById('mrNotes').value.trim() || null;

  if (!qty_received || qty_received <= 0) return toast('Enter a valid quantity received.', 'error');
  if (!received_by) return toast('Enter who received the material.', 'error');

  try {
    await Data.createMaterialReceipt({ job_material_id: jobMaterialId, qty_received, received_by, source_note, notes });
    closeSheet();
    toast('Receipt logged.', 'success');
    render();
  } catch (e) {
    toast('Could not log receipt: ' + e.message, 'error');
  }
}

async function assignRoute(jobId) {
  const code = document.getElementById('routeAssignSelect').value;
  if (!code) return toast('Select a route first.', 'error');
  try {
    await Data.updateJob(jobId, { route_code: code });
    await buildJobStagesFromRoute(jobId, code);
    toast('Route assigned and stages created.', 'success');
    render();
  } catch (e) {
    toast('Could not assign route: ' + e.message, 'error');
  }
}

function openStageActionSheet(stageId, jobId) {
  openSheet(`
    <div class="sheet-title">Update stage</div>
    <p class="small" style="margin-bottom:14px;">Log actual progress for this stage. Delay flag + reason only — no approval workflow in v1.</p>
    <label class="field-label">Status</label>
    <select id="stageStatusSelect">
      <option value="queued">Queued</option>
      <option value="in_progress">In progress</option>
      <option value="complete">Complete</option>
    </select>
    <label class="field-label">Operator</label>
    <input type="text" id="stageOperator" placeholder="Operator name / badge id" value="${escapeHtml((State.me && State.me.name) || '')}" />
    <label class="field-label">Machine assignment (optional)</label>
    <input type="text" id="stageMachine" placeholder="e.g. EBA-1" />
    <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border);">
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;">
        <input type="checkbox" id="stageDelayFlag" style="width:20px;height:20px;" /> Flag a delay
      </label>
      <input type="text" id="stageDelayReason" placeholder="Delay reason" style="margin-top:8px;" />
    </div>
    <button class="btn primary block" style="margin-top:16px;" onclick="submitStageUpdate('${stageId}','${jobId}')">Save</button>
  `);
}

async function submitStageUpdate(stageId, jobId) {
  const status = document.getElementById('stageStatusSelect').value;
  const operator = document.getElementById('stageOperator').value.trim() || null;
  const machine_assignment = document.getElementById('stageMachine').value.trim() || null;
  const delay_flag = document.getElementById('stageDelayFlag').checked;
  const delay_reason = document.getElementById('stageDelayReason').value.trim() || null;

  const patch = { status, operator, machine_assignment, delay_flag, delay_reason };
  if (status === 'in_progress') patch.started_at = new Date().toISOString();
  if (status === 'complete') patch.completed_at = new Date().toISOString();

  try {
    await Data.updateJobStage(stageId, patch);
    closeSheet();
    toast('Stage updated.', 'success');
    render();
  } catch (e) {
    toast('Could not update stage: ' + e.message, 'error');
  }
}

/* ---- Cutting optimization / component generation ---- */

function openGenerateComponentsSheet(jobId) {
  const areaOpts = State.areas.map((a) => `<option value="${a.code}">${a.code} — ${escapeHtml(a.label)}</option>`).join('');
  const partOpts = State.partTypes.map((p) => `<option value="${p.code}">${p.code} — ${escapeHtml(p.label)}</option>`).join('');
  openSheet(`
    <div class="sheet-title">Generate components</div>
    <p class="small" style="margin-bottom:14px;">
      Simulates cutting optimization output: assigns component IDs and barcodes for this job
      (Section 5 / Section 8c). In v1 standalone mode this is entered manually; once bridged,
      this step will consume ModCraft's cutting list automatically.
    </p>
    <label class="field-label">Area</label>
    <select id="genArea">${areaOpts}</select>
    <label class="field-label">Component code</label>
    <input type="text" id="genComponent" placeholder="e.g. BASE01" />
    <label class="field-label">Part type</label>
    <select id="genPart">${partOpts}</select>
    <label class="field-label">Total quantity (identical parts)</label>
    <input type="number" id="genTotal" min="1" value="1" />
    <button class="btn primary block" style="margin-top:16px;" onclick="submitGenerateComponents('${jobId}')">Generate barcoded components</button>
  `);
}

async function submitGenerateComponents(jobId) {
  const area_code = document.getElementById('genArea').value;
  const component_code = document.getElementById('genComponent').value.trim().toUpperCase();
  const part_code = document.getElementById('genPart').value;
  const total = parseInt(document.getElementById('genTotal').value, 10);

  if (!component_code) return toast('Component code is required.', 'error');
  if (!total || total < 1) return toast('Quantity must be at least 1.', 'error');

  const rows = [];
  for (let i = 1; i <= total; i++) {
    rows.push({
      job_id: jobId, area_code, component_code, part_code,
      seq_number: i, seq_total: total,
      current_stage_code: null, status: 'pending',
    });
  }

  try {
    await Data.createComponents(rows);
    closeSheet();
    toast(`${total} component${total > 1 ? 's' : ''} generated with barcode IDs.`, 'success');
    render();
  } catch (e) {
    console.error(e);
    toast('Could not generate components: ' + e.message, 'error');
  }
}

/* ---- Packing + RTMS handoff ---- */

async function renderPackingBlock(job, components) {
  const el = document.getElementById('packingBlock');
  if (!el) return;
  let pl;
  try {
    pl = await Data.getPackingListForJob(job.id);
  } catch (e) {
    el.innerHTML = `<p class="small">Could not load packing list.</p>`;
    return;
  }

  const completeCount = components.filter((c) => c.status === 'complete').length;

  if (!pl) {
    el.innerHTML = `
      <p class="small">${completeCount} of ${components.length} components marked complete.</p>
      <button class="btn secondary sm" style="margin-top:8px;" onclick="createPackingListForJob('${job.id}')">
        Generate packing list &amp; tally card
      </button>
    `;
    return;
  }

  el.innerHTML = `
    <p class="small">Expected: ${pl.expected_component_count} · Scanned: ${pl.scanned_component_count}</p>
    ${badgeForJobStatus(pl.status === 'handed_off' ? 'handed_off' : (pl.status === 'confirmed' ? 'packing' : 'intake'))}
    ${pl.status !== 'handed_off' ? `
      <div class="btn-row" style="margin-top:10px;">
        <button class="btn outline sm" onclick="confirmPackingList('${pl.id}','${job.id}')">Confirm scan count</button>
        <button class="btn primary sm" onclick="handOffToRTMS('${pl.id}','${job.id}')">Hand off to RTMS</button>
      </div>
      <p class="hint">Handoff carries the destination_company flag (${job.destination_company}). RTMS owns the
      actual transfer/receiving transaction from here — Production's responsibility ends at handoff (Section 8).</p>
    ` : `<p class="small" style="margin-top:8px;">Handed off ${fmtDate(pl.handed_off_at)}.</p>`}
  `;
}

async function createPackingListForJob(jobId) {
  try {
    const components = await Data.listComponents(jobId);
    const job = await Data.getJob(jobId);
    const pl = await Data.createPackingList({
      job_id: jobId,
      destination_company: job.destination_company,
      expected_component_count: components.length,
      scanned_component_count: components.filter((c) => c.status === 'complete').length,
    });

    // build tally card breakdown by area/part
    const buckets = {};
    components.forEach((c) => {
      const key = c.area_code + '|' + c.part_code;
      if (!buckets[key]) buckets[key] = { area_code: c.area_code, part_code: c.part_code, expected_count: 0, scanned_count: 0 };
      buckets[key].expected_count++;
      if (c.status === 'complete') buckets[key].scanned_count++;
    });
    const rows = Object.values(buckets).map((b) => ({ ...b, packing_list_id: pl.id }));
    if (rows.length) await Data.createTallyCards(rows);

    await Data.updateJob(jobId, { status: 'packing' });
    toast('Packing list and tally card generated.', 'success');
    render();
  } catch (e) {
    console.error(e);
    toast('Could not generate packing list: ' + e.message, 'error');
  }
}

async function confirmPackingList(plId, jobId) {
  try {
    const components = await Data.listComponents(jobId);
    const scanned = components.filter((c) => c.status === 'complete').length;
    await Data.updatePackingList(plId, { scanned_component_count: scanned, status: 'confirmed' });
    toast('Scan count confirmed.', 'success');
    render();
  } catch (e) {
    toast('Could not confirm: ' + e.message, 'error');
  }
}

async function handOffToRTMS(plId, jobId) {
  try {
    await Data.updatePackingList(plId, { status: 'handed_off', handed_off_at: new Date().toISOString() });
    await Data.updateJob(jobId, { status: 'handed_off' });
    toast('Handed off to RTMS.', 'success');
    render();
  } catch (e) {
    toast('Handoff failed: ' + e.message, 'error');
  }
}
