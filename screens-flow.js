/* ------------------------- Job flow + QA inspection -------------------------
   Rommel 2026-10-19: acceptance is two people — Material Receiving verifies only the right item and
   the quantity; QA inspects quality (damage, board defects). The job page now follows the flow in
   order, each step saying who does it:
     Overview (where the job is) · 1 Receiving · 2 QA inspection · 3 Review & plan · 4 Production · 5 QA & release
   Database: pmes_qa_inspect (MRF lines + client items), pmes_board_save (QA), pmes_job_material_state
   (complete = received in full AND passed by QA). */

function _qaCan() { return pmesIsQa(); }   // Phase 2: QA's step only (production supervisors see it read-only)

/* ---- QA inspection of received materials ---- */
function renderQaInspect(job, mrs, client) {
  const lines = [];
  (mrs || []).forEach((m) => (m.lines || []).forEach((l) => lines.push({ kind: 'mr', parent: m.id, ref: m.mr_no, id: l.id, item: l.item, area: l.area, unit: l.unit, received: +l.received || 0,
    res: l.qa_result, dq: +l.qa_damaged_qty || 0, note: l.qa_note, photo: l.qa_photo, by: l.qa_by, at: l.qa_at })));
  (client || []).forEach((l) => lines.push({ kind: 'client', parent: job.id, ref: 'Client-supplied', id: l.id, item: l.item, unit: l.unit, received: +l.qty_received || 0,
    res: l.qa_result, dq: +l.qa_damaged_qty || 0, note: l.qa_note, photo: l.qa_photo, by: l.qa_by, at: l.qa_at }));
  const can = _qaCan(), rec = lines.filter((l) => l.received > 0), waiting = lines.filter((l) => !l.received);
  const pill = (l) => !l.res ? '<span class="badge amber">To inspect</span>' : l.res === 'pass' ? '<span class="badge green">Passed</span>' : '<span class="badge red">' + l.dq + ' damaged</span>';
  return `<div class="card" id="qaInspect"><div class="flex-between" style="gap:8px;flex-wrap:wrap;"><h2 class="mb-0">Material quality — QA</h2>
      <span class="small">${rec.filter((l) => l.res).length} of ${rec.length} received line(s) inspected${waiting.length ? ' · ' + waiting.length + ' not received yet' : ''}</span></div>
    <p class="small" style="margin-top:6px;">Receiving has confirmed the item and quantity. QA checks the quality of what arrived: <strong>Pass</strong>, or <strong>Damaged</strong> with how many, a note and a photo. Damaged pieces do not count towards the job.</p>
    ${rec.length ? rec.map((l) => can ? `<div class="mr-line qa-line" data-kind="${l.kind}" data-parent="${l.parent}" data-line="${l.id}" data-rec="${l.received}" ${l.res ? 'data-res="' + l.res + '"' : ''}>
        <div class="flex-between" style="gap:8px;flex-wrap:wrap;"><div><strong>${escapeHtml(l.item)}</strong>${l.area ? '<br><span class="small">' + escapeHtml(l.area) + '</span>' : ''}<br><span class="small">${escapeHtml(l.ref || '')}</span></div>
          <div class="small">Received ${l.received} ${escapeHtml(l.unit || '')} ${pill(l)}${l.by ? ' · ' + escapeHtml(l.by) : ''}</div></div>
        <div class="mr-line-inputs">
          <div class="mr-cond">${[['pass', 'Pass'], ['damaged', 'Damaged']].map(([v, t]) => `<button type="button" class="mr-cond-btn ${l.res === v ? 'on ' + (v === 'pass' ? 'ok' : 'damaged') : ''}" data-v="${v}" onclick="qaSetRes(this,'${v}')">${t}</button>`).join('')}</div>
          <label class="small qaDmg" style="${l.res === 'damaged' ? '' : 'display:none;'}">How many damaged<input type="number" min="1" max="${l.received}" step="any" class="qaQty" value="${l.dq || ''}"></label>
          <input type="text" class="qaNote" placeholder="Note — what is wrong (required for damaged)" value="${escapeHtml(l.note || '')}">
          <div class="qaPhotoWrap" style="${l.res === 'damaged' ? '' : 'display:none;'}"><label class="small">Photo of the damage (required)<input type="file" accept="image/*" capture="environment" class="qaPhoto"></label>
            ${l.photo ? `<button class="btn outline sm" onclick="viewReceiptPhoto('${encodeURIComponent(l.photo)}')">View saved photo</button>` : ''}</div>
        </div></div>`
      : `<div class="mr-line"><div class="flex-between"><div><strong>${escapeHtml(l.item)}</strong> <span class="small">${escapeHtml(l.ref || '')}</span></div><div class="small">Received ${l.received} ${pill(l)}</div></div>${l.note ? '<div class="small">' + escapeHtml(l.note) + '</div>' : ''}</div>`).join('')
      : '<p class="small">Nothing received yet — Receiving confirms the item and quantity first.</p>'}
    ${can && rec.length ? `<div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:10px;"><button class="btn outline sm" onclick="qaAllPass()">All pass</button><button class="btn primary sm" onclick="qaSubmit('${job.id}')">Save QA inspection</button></div>` : ''}
  </div>`;
}
function qaSetRes(btn, v) {
  const row = btn.closest('.qa-line'); row.dataset.res = v;
  row.querySelectorAll('.mr-cond-btn').forEach((b) => { b.className = 'mr-cond-btn' + (b.dataset.v === v ? ' on ' + (v === 'pass' ? 'ok' : 'damaged') : ''); });
  row.querySelector('.qaDmg').style.display = v === 'damaged' ? '' : 'none';
  row.querySelector('.qaPhotoWrap').style.display = v === 'damaged' ? '' : 'none';
}
function qaAllPass() { document.querySelectorAll('.qa-line').forEach((row) => { if (!row.dataset.res) qaSetRes(row.querySelector('.mr-cond-btn[data-v="pass"]'), 'pass'); }); }
async function qaSubmit(jobId) {
  const groups = {};
  for (const row of document.querySelectorAll('.qa-line')) {
    const res = row.dataset.res; if (!res) continue;
    const item = row.querySelector('strong').textContent, note = row.querySelector('.qaNote').value.trim();
    const line = { id: row.dataset.line, result: res, note: note || null };
    if (res === 'damaged') {
      const q = Number(row.querySelector('.qaQty').value); if (!(q > 0)) return toast('How many of ' + item + ' are damaged?', 'error');
      if (!note) return toast('Describe the damage on ' + item + '.', 'error');
      line.damaged_qty = q;
      const f = row.querySelector('.qaPhoto').files[0];
      if (f) {
        const ext = (f.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
        const path = 'qa/' + row.dataset.parent + '/' + row.dataset.line + '/' + Date.now() + '.' + ext;
        const { error } = await sb.storage.from('pmes-receipts').upload(path, f, { contentType: f.type || 'image/jpeg', upsert: false });
        if (error) return toast('Photo upload failed for ' + item + ': ' + error.message, 'error');
        line.photo = path;
      } else if (!row.querySelector('.qaPhotoWrap button')) return toast('Take a photo of the damage on ' + item + '.', 'error');
    }
    const k = row.dataset.kind + '|' + row.dataset.parent; (groups[k] = groups[k] || []).push(line);
  }
  const keys = Object.keys(groups); if (!keys.length) return toast('Mark at least one line Pass or Damaged.', 'error');
  try {
    for (const k of keys) { const [kind, parent] = k.split('|'); await sb.rpc('pmes_qa_inspect', { p_kind: kind, p_parent: parent, p_lines: groups[k] }).then(({ error }) => { if (error) throw error; }); }
    toast('QA inspection saved.', 'success'); render();
  } catch (e) { toast(e.message, 'error'); }
}

/* ---- Overview: where the job is in the flow ---- */
async function renderJobFlow(job, el) {
  // Phase 1 (2026-10-29): the strip comes from pmes_job_flow — the same answer the job status,
  // the gate and (next) every list use. Nothing about the steps is worked out here any more.
  let f = null;
  try { const { data, error } = await sb.rpc('pmes_job_flow', { p_job: job.id }); if (error) throw error; f = data; }
  catch (e) { el.innerHTML = '<div class="callout blocked">Could not load where this job is: ' + escapeHtml(e.message) + '</div>'; return; }
  if (!f) { el.innerHTML = ''; return; }
  const col = { done: ['green', '✓ Done'], now: ['amber', 'In progress'], wait: ['gray', 'Waiting'], block: ['red', 'Needs attention'], na: ['gray', 'Not needed'] };
  const w = f.waiting_on;
  el.innerHTML = `<div class="card"><h2>Where this job is</h2>
    ${w ? `<p class="small" style="margin:0 0 8px;"><strong>Waiting on ${escapeHtml(w.dept)} · ${escapeHtml(w.team)}</strong> — ${escapeHtml(w.note)}</p>` : '<p class="small" style="margin:0 0 8px;"><strong>All steps done.</strong></p>'}
    <div class="flow-steps">${(f.steps || []).map((s) => { const c = col[s.state] || col.wait;
      return `<button class="flow-step ${s.state}" onclick="setJobTab('${s.key}')"><span class="flow-n">${s.state === 'done' ? '✓' : s.n}</span>
        <span class="flow-body"><strong>${escapeHtml(s.title)}</strong><span class="small">${escapeHtml(s.dept + ' · ' + s.team)}</span><span class="small">${escapeHtml(s.note || '')}</span></span>
        <span class="badge ${c[0]}">${c[1]}</span></button>`; }).join('')}</div></div>`;
}

/* ---- Production: the supervisor assigns operators to each process JO (Rommel 2026-10-19) ---- */
async function renderAssignCard(job, el) {
  let pjos = [], users = [];
  try {
    const [a, b] = await Promise.all([sb.from(T('process_jos')).select('*').eq('job_id', job.id).order('sequence_index'), sb.from('pmes_users').select('email,name,role,company,active')]);
    pjos = a.data || []; users = (b.data || []).filter((u) => u.active && u.role === 'operator');
  } catch (e) { el.innerHTML = ''; return; }
  if (!pjos.length) { el.innerHTML = ''; return; }
  State.assignCtx = { job, pjos, users };
  const sup = pmesCan('supervisor'), sched = job.schedule_status === 'approved';
  el.innerHTML = `<div class="card"><div class="flex-between" style="gap:8px;flex-wrap:wrap;"><h2 class="mb-0">Operators by process</h2>
      <span class="small">${pjos.filter((p) => (p.operators || []).length || p.machine_name).length} of ${pjos.length} assigned</span></div>
    <p class="small" style="margin-top:6px;">The supervisor assigned to the job enters the machine and operator(s) for each process; the process JO then goes to them.${sched ? '' : ' <strong>The loading schedule must be approved first</strong> (Schedule page).'}</p>
    <table class="comp-table" style="margin-top:8px;"><thead><tr><th>Process JO</th><th>Plan</th><th>Machine</th><th>Operator(s)</th><th>Status</th><th></th></tr></thead><tbody>
    ${pjos.map((p) => `<tr><td><strong>${escapeHtml(p.pjo_no || p.stage_code)}</strong><div class="small">${escapeHtml(p.stage_code)} · ${p.planned_pieces || 0} pieces</div></td>
      <td class="small">${p.planned_start ? fmtDate(p.planned_start) + ' → ' + fmtDate(p.planned_end) : '—'}</td>
      <td>${escapeHtml(p.machine_name || '—')}</td><td>${(p.operators || []).length ? escapeHtml(p.operators.join(', ')) : '<span class="small">Not assigned</span>'}</td>
      <td>${badgeForStageStatus(p.status === 'handed_out' ? 'queued' : p.status === 'done' ? 'complete' : p.status === 'in_progress' ? 'in_progress' : 'not_started')}</td>
      <td style="white-space:nowrap">${sup && p.status !== 'done' ? `<button class="btn ${(p.operators || []).length ? 'outline' : 'primary'} sm" ${sched ? '' : 'disabled title="Approve the loading schedule first"'} onclick="assignOpen('${p.id}')">${(p.operators || []).length ? 'Change' : 'Assign'}</button>` : ''}
        <button class="btn outline sm" onclick="printProcessJO('${job.id}','${p.stage_code}')">Print</button>
        ${pmesCan('shift_head') && p.status !== 'done' ? `<button class="btn outline sm" onclick="openEncodeSheet('${job.id}','${p.stage_code}')" title="Enter the pieces ticked on the returned paper sheet">Encode sheet</button>` : ''}</td></tr>`).join('')}
    </tbody></table></div>`;
}
function assignOpen(pjoId) {
  const c = State.assignCtx, p = c.pjos.find((x) => x.id === pjoId); if (!p) return;
  const ms = (State.jd && State.jd.machines) || [];
  openSheet(`<div class="sheet-title">Assign ${escapeHtml(p.pjo_no || p.stage_code)}</div>
    <label class="field-label">Machine</label>
    <select id="asMachine"><option value="">— none —</option>${ms.map((m) => `<option value="${m.id}" ${m.id === p.machine_id ? 'selected' : ''}>${escapeHtml(m.name || m.code || m.id)}</option>`).join('')}</select>
    <label class="field-label">Operator(s)</label>
    <div>${c.users.map((u) => `<label class="small" style="display:inline-flex;gap:4px;margin:2px 10px 2px 0;"><input type="checkbox" class="asOp" value="${escapeHtml(u.name || u.email)}" ${(p.operators || []).includes(u.name || u.email) ? 'checked' : ''}> ${escapeHtml(u.name || u.email)}</label>`).join('') || '<span class="small">No operator accounts yet — type names below.</span>'}</div>
    <input type="text" id="asOther" placeholder="Other operators (names, comma-separated)" value="${escapeHtml((p.operators || []).filter((n) => !c.users.some((u) => (u.name || u.email) === n)).join(', '))}">
    <input type="text" id="asNote" placeholder="Note (optional)" value="${escapeHtml(p.handout_note || '')}" style="margin-top:8px;">
    <button class="btn primary block" style="margin-top:12px;" onclick="assignSave('${p.id}')">Assign and hand out</button>`);
}
async function assignSave(pjoId) {
  const ops = [...document.querySelectorAll('.asOp:checked')].map((i) => i.value)
    .concat((document.getElementById('asOther').value || '').split(',').map((x) => x.trim()).filter(Boolean));
  const { error } = await sb.rpc('pmes_pjo_handout', { p_pjo: pjoId, p_machine: document.getElementById('asMachine').value || null, p_operators: ops, p_note: document.getElementById('asNote').value || null });
  if (error) return toast(error.message, 'error');
  closeSheet(); toast('Assigned — the process JO is with the operator(s).', 'success'); render();
}
