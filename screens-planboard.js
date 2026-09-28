/* =====================================================================
   Screen: Schedule — the loading schedule, per Job Order (Rommel 2026-09-28)
   Flow: mother JO approved → one Job Order per process is created (pmes_process_jos)
   → a production engineer / supervisor sets the dates (or takes the system's
   recommendation from capacity) → the supervisor approves the schedule (shows in
   Modcraft) → the shift head hands each process JO to a machine and operators →
   pieces ticked done give the actual, shown against the plan.
   Views: Gantt · Kanban · Calendar · Today (shift). The user's choice is remembered.
   The database enforces who may do what (pmes_schedule_save / _approve / pmes_pjo_handout).
   ===================================================================== */

const PB = { view: null, edit: null, draft: {}, month: null, data: null };
const PB_VIEWS = [['gantt', 'Gantt'], ['kanban', 'Kanban'], ['calendar', 'Calendar'], ['today', 'Today (shift)']];
const PJO_STATUS = { to_schedule: ['gray', 'To schedule'], scheduled: ['blue', 'Scheduled'], handed_out: ['amber', 'Handed out'], in_progress: ['amber', 'In progress'], done: ['green', 'Done'] };
const SHIFT_HOURS = [8, 9, 10, 11, 13, 14, 15, 16];   // 8:00–17:00 with a 12:00 lunch break

function pbView() {
  if (PB.view) return PB.view;
  try { PB.view = localStorage.getItem('pmes_sched_view'); } catch (e) {}
  if (!PB.view) PB.view = State.me && State.me.role === 'shift_head' ? 'today' : 'gantt';
  return PB.view;
}
function pbSetView(v) { PB.view = v; try { localStorage.setItem('pmes_sched_view', v); } catch (e) {} pbDraw(); }
function pbDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function pbIso(d) { const x = pbDay(d); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); }
function pbParse(s) { if (!s) return null; const p = String(s).slice(0, 10).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
function pbWorkdays(a, b) { let n = 0; const d = new Date(a); while (d <= b) { if (d.getDay() !== 0) n++; d.setDate(d.getDate() + 1); } return Math.max(1, n); }
function pbStageLabel(code) { const t = State.stageTypes.find((x) => x.code === code); return t ? t.label : code; }
function pbPill(st) { const s = PJO_STATUS[st] || ['gray', st]; return `<span class="badge ${s[0]}">${s[1]}</span>`; }

async function renderSchedule(main) {
  main.innerHTML = `<div class="empty"><p>Loading the schedule…</p></div>`;
  const co = schedCompany();
  try {
    const [caps, jobs, machines] = await Promise.all([Data.listStageCapacity(co), Data.listJobs(), Data.listMachines().catch(() => [])]);
    const open = jobs.filter((j) => j.destination_company === co && j.jo_review_status === 'approved' && j.status !== 'handed_off');
    const ids = open.map((j) => j.id);
    const [pjoR, doneR, usersR] = ids.length ? await Promise.all([
      sb.from(T('process_jos')).select('*').in('job_id', ids),
      sb.from(T('component_done')).select('job_id,stage_code,done_at').in('job_id', ids),
      sb.from('pmes_users').select('email,name,role,company,active').eq('active', true).order('name'),
    ]) : [{ data: [] }, { data: [] }, { data: [] }];
    if (pjoR.error) throw pjoR.error;
    const bundles = await Promise.all(open.map(async (job) => {
      const [stages, components, outputs] = await Promise.all([Data.listJobStages(job.id), Data.listComponents(job.id), Data.listStageOutputs(job.id).catch(() => [])]);
      return { job, stages, components, outputs };
    }));
    const capacity = {}; caps.forEach((c) => { capacity[c.stage_code] = c; });
    const rec = PmesSchedule.forwardSchedule(bundles, capacity, new Date());
    PB.data = { co, caps, capacity, bundles, rec, machines: machines || [], users: (usersR && usersR.data) || [],
      pjos: pjoR.data || [], done: (doneR && doneR.data) || [] };
  } catch (e) { main.innerHTML = `<div class="empty"><div class="ic">⚠️</div><p>Could not load: ${escapeHtml(e.message)}</p></div>`; return; }
  main.innerHTML = `<div id="pbTop"></div><div id="pbBody"></div>`;
  pbDraw();
}

// Everything a view needs about one mother JO, computed once.
function pbJobs() {
  const d = PB.data, today = pbDay(new Date());
  return d.bundles.map((b) => {
    const pjos = d.pjos.filter((p) => p.job_id === b.job.id).sort((x, y) => x.sequence_index - y.sequence_index);
    pjos.forEach((p) => {
      const dn = d.done.filter((x) => x.job_id === b.job.id && x.stage_code === p.stage_code);
      p._done = dn.length; p._doneRows = dn;
      p._pct = p.planned_pieces ? Math.min(100, Math.round(p._done / p.planned_pieces * 100)) : (p.status === 'done' ? 100 : 0);
      p._s = pbParse(p.planned_start); p._e = pbParse(p.planned_end) || p._s;
      p._late = p.status !== 'done' && p._e && p._e < today;
      p._rec = d.rec.rows.find((r) => r.job_id === b.job.id && r.stage_code === p.stage_code);
      p._job = b.job;
    });
    const actualAt = pjos.find((p) => p.status !== 'done' && p.planned_pieces > 0);
    const planAt = pjos.filter((p) => p._s && p._s <= today && p.planned_pieces > 0).pop();
    const mo = b.job.mother_jo || {};
    return { b, job: b.job, pjos, actualAt, planAt, late: pjos.some((p) => p._late), client: mo.client || '', project: mo.project || '' };
  });
}
function pbWhere(J) {
  if (!J.pjos.length) return '<span class="small">No process Job Orders yet.</span>';
  if (!J.actualAt) return '<span class="badge green">All processes done</span>';
  return `<span class="small">Now at <strong>${escapeHtml(pbStageLabel(J.actualAt.stage_code))}</strong>${J.planAt ? ' · plan says <strong>' + escapeHtml(pbStageLabel(J.planAt.stage_code)) + '</strong>' : ''}</span>
    ${J.late ? ' <span class="badge red">Behind plan</span>' : (J.planAt && J.actualAt.sequence_index >= J.planAt.sequence_index ? ' <span class="badge green">On plan</span>' : '')}`;
}

function pbDraw() {
  const d = PB.data, top = document.getElementById('pbTop'), body = document.getElementById('pbBody'); if (!d || !top || !body) return;
  const v = pbView(), jobs = pbJobs();
  top.innerHTML = `<div class="flex-between" style="gap:8px;flex-wrap:wrap;margin-bottom:10px;">
      <div class="seg">${PB_VIEWS.map(([k, l]) => `<button class="${v === k ? 'on' : ''}" onclick="pbSetView('${k}')">${l}</button>`).join('')}</div>
      ${pmesCan('manager') ? `<select onchange="SchedState.company=this.value;render()">${COMPANY_CODES.map((c) => `<option ${c === d.co ? 'selected' : ''}>${c}</option>`).join('')}</select>` : `<span class="small">${d.co}</span>`}
    </div>
    ${!d.caps.length ? `<div class="callout blocked">No process capacity is set for ${d.co}, so the system cannot recommend dates — IE → Process capacity.</div>` : ''}`;
  if (!jobs.length) { body.innerHTML = `<div class="empty"><div class="ic">📅</div><p>No approved Job Orders for ${d.co}.</p><p class="small">A Job Order appears here once it is approved; its process Job Orders are created then.</p></div>`; return; }
  body.innerHTML = v === 'kanban' ? pbKanban(jobs) : v === 'calendar' ? pbCalendar(jobs) : v === 'today' ? pbToday(jobs) : pbGantt(jobs);
}

/* ---- Per-JO header with schedule actions (shared by Gantt) ---- */
function pbJobHead(J) {
  const ss = J.job.schedule_status || 'none';
  const canPlan = pmesCan('production_engineer'), canApprove = pmesCan('supervisor');
  const hasDates = J.pjos.filter((p) => p.planned_pieces > 0 && p.status !== 'done').every((p) => p.planned_start);
  return `<div class="flex-between" style="gap:8px;flex-wrap:wrap;">
      <div><strong class="mono" style="cursor:pointer" onclick="goToJob('${J.job.id}')">${escapeHtml(J.job.job_code)}</strong>
        ${ss === 'approved' ? '<span class="badge green">Schedule approved</span>' : '<span class="badge amber">Schedule draft</span>'}
        <div class="small">${escapeHtml(J.client)}${J.project ? ' — ' + escapeHtml(J.project) : ''}${J.job.quotation_serial ? ' · ' + escapeHtml(J.job.quotation_serial) : ''}</div>
        <div>${pbWhere(J)}</div></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        ${canPlan ? `<button class="btn outline sm" onclick="pbOpenEdit('${J.job.id}')">${PB.edit === J.job.id ? 'Editing…' : 'Edit dates'}</button>` : ''}
        ${canApprove && ss !== 'approved' ? `<button class="btn primary sm" ${hasDates ? '' : 'disabled title="Give every process dates first"'} onclick="pbApprove('${J.job.id}')">Approve schedule</button>` : ''}
      </div></div>
    ${ss === 'approved' && J.job.schedule_approved_at ? `<div class="small">Approved by ${escapeHtml(J.job.schedule_approved_by || '')} ${fmtDate(J.job.schedule_approved_at)}${J.job.schedule_note ? ' · ' + escapeHtml(J.job.schedule_note) : ''}</div>` : ''}
    ${PB.edit === J.job.id ? pbEditor(J) : ''}`;
}
function pbOpenEdit(jobId) {
  PB.edit = PB.edit === jobId ? null : jobId;
  const J = pbJobs().find((x) => x.job.id === jobId);
  if (J && PB.edit) { PB.draft = {}; J.pjos.forEach((p) => { PB.draft[p.stage_code] = { start: p.planned_start || '', end: p.planned_end || '' }; }); }
  pbDraw();
}
function pbEditor(J) {
  return `<div class="pb-edit"><p class="small">Set each process's dates, or take the system's recommendation (from ${escapeHtml(PB.data.co)}'s process capacity and the other approved Job Orders). Saving a change to an approved schedule sends it back for approval.</p>
    <table class="comp-table"><thead><tr><th>Process</th><th>Pieces</th><th>Load</th><th>Recommended</th><th>Start</th><th>End</th><th>Status</th></tr></thead><tbody>
    ${J.pjos.map((p) => { const r = p._rec, dr = PB.draft[p.stage_code] || {};
      return `<tr><td>${escapeHtml(pbStageLabel(p.stage_code))}</td><td>${p._done}/${p.planned_pieces}</td><td class="small">${r ? r.load + ' ' + escapeHtml(r.unit) : '—'}</td>
        <td class="small">${r && r.start ? fmtDay(r.start) + ' → ' + fmtDay(r.end) : escapeHtml((r && r.note) || '—')}</td>
        <td><input type="date" value="${escapeHtml(dr.start || '')}" onchange="PB.draft['${p.stage_code}'].start=this.value" ${p.status === 'done' ? 'disabled' : ''}></td>
        <td><input type="date" value="${escapeHtml(dr.end || '')}" onchange="PB.draft['${p.stage_code}'].end=this.value" ${p.status === 'done' ? 'disabled' : ''}></td>
        <td>${pbPill(p.status)}</td></tr>`; }).join('')}
    </tbody></table>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
      <button class="btn outline sm" onclick="pbUseRec('${J.job.id}')">Use recommended dates</button>
      <button class="btn primary sm" onclick="pbSave('${J.job.id}')">Save dates</button>
      <button class="btn outline sm" onclick="PB.edit=null;pbDraw()">Cancel</button></div></div>`;
}
function pbUseRec(jobId) {
  const J = pbJobs().find((x) => x.job.id === jobId); if (!J) return;
  J.pjos.forEach((p) => { if (p.status !== 'done' && p._rec && p._rec.start) PB.draft[p.stage_code] = { start: pbIso(p._rec.start), end: pbIso(p._rec.end) }; });
  pbDraw();
}
async function pbSave(jobId) {
  const J = pbJobs().find((x) => x.job.id === jobId); if (!J) return;
  const rows = J.pjos.filter((p) => p.status !== 'done').map((p) => { const dr = PB.draft[p.stage_code] || {};
    return { stage_code: p.stage_code, start: dr.start || '', end: dr.end || dr.start || '', qty: p._rec ? p._rec.load : '', unit: p._rec ? p._rec.unit : '' }; });
  try {
    const { data, error } = await sb.rpc('pmes_schedule_save', { p_job: jobId, p_rows: rows });
    if (error) throw error;
    toast(data.was === 'approved' ? 'Dates saved — the schedule needs approval again.' : 'Dates saved.', 'success');
    PB.edit = null; render();
  } catch (e) { toast(e.message, 'error'); }
}
async function pbApprove(jobId) {
  const note = prompt('Approve this loading schedule? It will show in Modcraft. Optional note:');
  if (note === null) return;
  try { const { error } = await sb.rpc('pmes_schedule_approve', { p_job: jobId, p_note: note || null }); if (error) throw error; toast('Schedule approved.', 'success'); render(); }
  catch (e) { toast(e.message, 'error'); }
}

/* ---- Gantt: one block per JO, a row per process — plan bar, actual fill, today line ---- */
function pbGantt(jobs) {
  const today = pbDay(new Date());
  let lo = new Date(today), hi = new Date(today); lo.setDate(lo.getDate() - 3); hi.setDate(hi.getDate() + 14);
  jobs.forEach((J) => J.pjos.forEach((p) => { const s = p._s || (p._rec && p._rec.start), e = p._e || (p._rec && p._rec.end); if (s && s < lo) lo = pbDay(s); if (e && e > hi) hi = pbDay(e); }));
  const days = Math.min(70, Math.round((hi - lo) / 864e5) + 1), W = 100 / days;
  const dayHead = Array.from({ length: days }, (_, i) => { const d = new Date(lo); d.setDate(d.getDate() + i);
    return `<div class="gd ${d.getDay() === 0 ? 'sun' : ''} ${+d === +today ? 'tod' : ''}" style="width:${W}%">${d.getDate() === 1 || i === 0 ? '<b>' + d.toLocaleDateString(undefined, { month: 'short' }) + '</b><br>' : ''}${d.getDate()}</div>`; }).join('');
  const pos = (s, e) => { const l = Math.max(0, (pbDay(s) - lo) / 864e5), r = Math.min(days, (pbDay(e) - lo) / 864e5 + 1); return `left:${l * W}%;width:${Math.max(W * 0.6, (r - l) * W)}%`; };
  const todayLeft = ((today - lo) / 864e5 + 0.5) * W;
  return `<div class="small" style="margin-bottom:6px;">Bar = planned dates (dashed = not approved yet, faint = system recommendation only) · fill = pieces done · red = past its planned end and not done · blue line = today.</div>` +
    jobs.map((J) => `<div class="card">${pbJobHead(J)}
      <div class="gantt"><div class="g-row g-head"><div class="g-lab"></div><div class="g-track">${dayHead}</div></div>
      ${J.pjos.map((p) => { const approved = J.job.schedule_status === 'approved';
        const s = p._s, e = p._e, rs = p._rec && p._rec.start, re = p._rec && p._rec.end;
        const bar = s ? `<div class="g-bar ${p._late ? 'late' : p.status === 'done' ? 'done' : ''} ${approved ? '' : 'draft'}" style="${pos(s, e)}" title="${escapeHtml(pbStageLabel(p.stage_code))}: ${fmtDay(s)} → ${fmtDay(e)} · ${p._done}/${p.planned_pieces} pieces"><div class="g-fill" style="width:${p._pct}%"></div><span>${p._done}/${p.planned_pieces}</span></div>`
          : rs ? `<div class="g-bar rec" style="${pos(rs, re)}" title="Recommended ${fmtDay(rs)} → ${fmtDay(re)}"><span>rec.</span></div>` : '';
        return `<div class="g-row"><div class="g-lab"><strong>${escapeHtml(p.stage_code)}</strong> ${pbPill(p.status)}${p.operators && p.operators.length || p.machine_name ? '<div class="small">' + escapeHtml([p.machine_name].concat(p.operators || []).filter(Boolean).join(', ')) + '</div>' : ''}</div>
          <div class="g-track">${bar}<div class="g-today" style="left:${todayLeft}%"></div></div></div>`; }).join('')}
      </div></div>`).join('');
}

/* ---- Kanban: process Job Orders by status ---- */
function pbKanban(jobs) {
  const all = []; jobs.forEach((J) => J.pjos.forEach((p) => { if (p.planned_pieces > 0 || p.status !== 'to_schedule') all.push({ J, p }); }));
  return `<div class="kanban">${Object.keys(PJO_STATUS).map((st) => { const items = all.filter((x) => x.p.status === st);
    return `<div class="kb-col"><div class="kb-h">${PJO_STATUS[st][1]} <span class="small">${items.length}</span></div>
      ${items.map(({ J, p }) => `<div class="kb-card ${p._late ? 'late' : ''}">
        <div class="flex-between"><strong>${escapeHtml(pbStageLabel(p.stage_code))}</strong>${p._late ? '<span class="badge red">Behind</span>' : ''}</div>
        <div class="small mono" style="cursor:pointer" onclick="goToJob('${J.job.id}')">${escapeHtml(p.pjo_no)}</div>
        <div class="small">${escapeHtml(J.client)}${J.project ? ' — ' + escapeHtml(J.project) : ''}</div>
        <div class="small">${p._s ? fmtDay(p._s) + (p._e && +p._e !== +p._s ? ' → ' + fmtDay(p._e) : '') : 'No dates'}${J.job.schedule_status === 'approved' ? '' : ' · draft'}</div>
        <div class="pc-line">${pieceBar({ pct: p._pct })}<span class="small">${p._done}/${p.planned_pieces}</span></div>
        ${p.machine_name || (p.operators || []).length ? '<div class="small">👷 ' + escapeHtml([p.machine_name].concat(p.operators || []).filter(Boolean).join(', ')) + '</div>' : ''}
        ${pbHandoutBtn(J, p)}</div>`).join('') || '<p class="small">—</p>'}</div>`; }).join('')}</div>`;
}

/* ---- Calendar: a month, process Job Orders on their planned days ---- */
function pbCalendar(jobs) {
  const m = PB.month || new Date(); const first = new Date(m.getFullYear(), m.getMonth(), 1), start = new Date(first); start.setDate(1 - first.getDay());
  const today = pbDay(new Date()), items = []; jobs.forEach((J) => J.pjos.forEach((p) => { if (p._s) items.push({ J, p }); }));
  const cells = Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i);
    const on = items.filter(({ p }) => p._s <= d && d <= p._e);
    return `<div class="cal-d ${d.getMonth() !== m.getMonth() ? 'out' : ''} ${+d === +today ? 'tod' : ''} ${d.getDay() === 0 ? 'sun' : ''}"><div class="small"><b>${d.getDate()}</b></div>
      ${on.slice(0, 5).map(({ J, p }) => `<div class="cal-chip ${p.status === 'done' ? 'done' : p._late ? 'late' : ''}" title="${escapeHtml(p.pjo_no + ' · ' + J.client + ' · ' + p._done + '/' + p.planned_pieces)}" onclick="goToJob('${J.job.id}')">${escapeHtml(p.stage_code)} · ${escapeHtml(J.job.job_code)}</div>`).join('')}
      ${on.length > 5 ? '<div class="small">+' + (on.length - 5) + ' more</div>' : ''}</div>`; }).join('');
  const nav = (k) => `PB.month=new Date(${m.getFullYear()},${m.getMonth() + k},1);pbDraw()`;
  return `<div class="card"><div class="flex-between"><button class="btn outline sm" onclick="${nav(-1)}">←</button>
    <h2 class="mb-0">${m.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h2><button class="btn outline sm" onclick="${nav(1)}">→</button></div>
    <div class="cal">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((x) => `<div class="cal-w">${x}</div>`).join('')}${cells}</div></div>`;
}

/* ---- Today (shift head): what is due today, hand-out, plan vs actual by hour ---- */
function pbToday(jobs) {
  const today = pbDay(new Date()), iso = pbIso(today), rows = [];
  jobs.forEach((J) => J.pjos.forEach((p) => { if (p.status === 'done' || !p._s) return; if (p._s <= today && (p._e >= today || p._late)) rows.push({ J, p }); }));
  if (!rows.length) return `<div class="empty"><div class="ic">🗓️</div><p>Nothing is scheduled for today.</p><p class="small">Only process Job Orders with dates covering today (or past due and not done) show here.</p></div>`;
  const nowH = new Date().getHours();
  return `<p class="small" style="margin-bottom:8px;">Plan for today = pieces left spread over the working days left in the plan; per hour over a 8:00–17:00 shift (lunch 12–1). Actual = pieces ticked done (Pieces tab or scanner).</p>` +
    rows.map(({ J, p }) => {
      const left = Math.max(0, p.planned_pieces - p._doneRows.filter((x) => new Date(x.done_at) < today).length);
      const daysLeft = p._late ? 1 : pbWorkdays(today, p._e);
      const planToday = Math.ceil(left / daysLeft);
      const doneToday = p._doneRows.filter((x) => new Date(x.done_at) >= today);
      const perHour = planToday / SHIFT_HOURS.length;
      let cumP = 0, cumA = 0;
      const hrs = SHIFT_HOURS.map((h) => { const a = doneToday.filter((x) => new Date(x.done_at).getHours() === h).length; cumP += perHour; cumA += a;
        const past = h < nowH; return `<tr class="${h === nowH ? 'now' : ''}"><td>${h}:00</td><td>${Math.round(cumP)}</td><td>${h <= nowH ? a : ''}</td><td>${h <= nowH ? '<strong>' + cumA + '</strong>' : ''}</td><td>${h <= nowH ? (cumA >= Math.round(cumP) ? '<span class="badge green">on</span>' : past ? '<span class="badge red">' + (cumA - Math.round(cumP)) + '</span>' : '') : ''}</td></tr>`; }).join('');
      return `<div class="card"><div class="flex-between" style="gap:8px;flex-wrap:wrap;">
          <div><strong>${escapeHtml(pbStageLabel(p.stage_code))}</strong> ${pbPill(p.status)} ${p._late ? '<span class="badge red">Past planned end ' + fmtDay(p._e) + '</span>' : ''}
            <div class="small mono">${escapeHtml(p.pjo_no)}</div><div class="small">${escapeHtml(J.client)}${J.project ? ' — ' + escapeHtml(J.project) : ''} · plan ${fmtDay(p._s)} → ${fmtDay(p._e)}</div>
            <div class="small">${p.handed_out_at ? '👷 ' + escapeHtml([p.machine_name].concat(p.operators || []).filter(Boolean).join(', ')) + ' · handed out by ' + escapeHtml(p.handed_out_by_name || p.handed_out_by || '') + ' ' + fmtDate(p.handed_out_at) : 'Not handed out yet'}</div></div>
          <div style="text-align:right"><div style="font-size:22px;font-weight:800">${doneToday.length} <span class="small">/ ${planToday} today</span></div>
            <div class="small">${p._done}/${p.planned_pieces} pieces overall</div>
            <div style="display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap;margin-top:6px;">${pbHandoutBtn(J, p)}
              <button class="btn outline sm" onclick="PieceState.stage='${p.stage_code}';PieceState.notDone=true;goToJob('${J.job.id}','parts')">Tick pieces done</button></div></div></div>
        <details style="margin-top:8px;"><summary class="small">Plan vs actual by hour</summary>
          <table class="comp-table" style="margin-top:6px;"><thead><tr><th>Hour</th><th>Plan (cum.)</th><th>Done</th><th>Actual (cum.)</th><th></th></tr></thead><tbody>${hrs}</tbody></table></details></div>`;
    }).join('');
}

function pbHandoutBtn(J, p) {
  if (!pmesCan('shift_head') || p.status === 'done') return '';
  if (J.job.schedule_status !== 'approved') return '<span class="small">Hand-out after the schedule is approved</span>';
  return `<button class="btn ${p.handed_out_at ? 'outline' : 'primary'} sm" onclick="pbHandout('${p.id}')">${p.handed_out_at ? 'Change hand-out' : 'Hand out'}</button>`;
}
function pbHandout(pjoId) {
  const d = PB.data, p = d.pjos.find((x) => x.id === pjoId); if (!p) return;
  const ops = d.users.filter((u) => u.role === 'operator' && (!u.company || companyCodeOf(u.company) === d.co));
  openSheet(`<div class="sheet-title">Hand out ${escapeHtml(p.pjo_no)}</div>
    <p class="small">${escapeHtml(pbStageLabel(p.stage_code))} · ${p.planned_pieces} pieces · plan ${fmtDay(pbParse(p.planned_start))} → ${fmtDay(pbParse(p.planned_end))}</p>
    <label class="field-label">Machine</label>
    <select id="hoMachine"><option value="">— none —</option>${d.machines.map((m) => `<option value="${m.id}" ${m.id === p.machine_id ? 'selected' : ''}>${escapeHtml(m.name || m.code || m.id)}</option>`).join('')}</select>
    <label class="field-label">Operator(s)</label>
    <div>${ops.map((u) => `<label class="small" style="display:inline-flex;gap:4px;margin:2px 10px 2px 0;"><input type="checkbox" class="hoOp" value="${escapeHtml(u.name || u.email)}" ${(p.operators || []).includes(u.name || u.email) ? 'checked' : ''}> ${escapeHtml(u.name || u.email)}</label>`).join('') || '<p class="small">No operators on the PMES user list for this plant — type names below.</p>'}</div>
    <input type="text" id="hoOther" placeholder="Other operators (names, comma-separated)" value="${escapeHtml((p.operators || []).filter((n) => !ops.some((u) => (u.name || u.email) === n)).join(', '))}">
    <input type="text" id="hoNote" placeholder="Note (optional)" value="${escapeHtml(p.handout_note || '')}" style="margin-top:8px;">
    <button class="btn primary block" style="margin-top:12px;" onclick="pbHandoutSave('${p.id}')">Hand out</button>`);
}
async function pbHandoutSave(pjoId) {
  const ops = [...document.querySelectorAll('.hoOp:checked')].map((i) => i.value)
    .concat(document.getElementById('hoOther').value.split(',').map((s) => s.trim()).filter(Boolean));
  try {
    const { error } = await sb.rpc('pmes_pjo_handout', { p_pjo: pjoId, p_machine: document.getElementById('hoMachine').value || null, p_operators: ops, p_note: document.getElementById('hoNote').value || null });
    if (error) throw error; closeSheet(); toast('Handed out.', 'success'); render();
  } catch (e) { toast(e.message, 'error'); }
}
