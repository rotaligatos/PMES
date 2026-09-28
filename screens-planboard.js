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
const PB_VIEWS = [['gantt', 'Gantt'], ['kanban', 'Kanban'], ['calendar', 'Calendar'], ['today', 'Today (shift)'], ['workcal', 'Work calendar']];
const PJO_STATUS = { to_schedule: ['gray', 'To schedule'], scheduled: ['blue', 'Scheduled'], handed_out: ['amber', 'Handed out'], in_progress: ['amber', 'In progress'], done: ['green', 'Done'] };
const SCHED_STATUS = { none: ['gray', 'No schedule'], draft: ['amber', 'Schedule draft'], supervisor_ok: ['blue', 'Supervisor approved — waiting for manager'], approved: ['green', 'Schedule approved'] };
const OFFDAY_STATUS = { pending_manager: ['amber', 'Waiting for manager'], pending_hpo: ['amber', 'Waiting for Head of Plant Ops'], pending_md: ['amber', 'Waiting for Managing Director'], approved: ['green', 'Approved to work'], rejected: ['red', 'Rejected'], cancelled: ['gray', 'Cancelled'] };
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
// The day as the work calendar says (pmes_calendar_range): { working, shifts:[{start,end,break}], holiday, off_kind, request }
function pbDayInfo(d) { return (PB.data && PB.data.cal[pbIso(d)]) || null; }
// Hour slots of a day's shifts, in order (a night shift runs past midnight).
function pbShiftSlots(info) {
  const out = [];
  ((info && info.shifts) || []).forEach((s) => {
    const a = parseInt(String(s.start).slice(0, 2), 10), b = parseInt(String(s.end).slice(0, 2), 10);
    let h = a, n = 0; do { out.push(h); h = (h + 1) % 24; n++; } while (h !== b && n < 24);
  });
  return out;
}

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
function pbStageLabel(code) { const t = State.stageTypes.find((x) => x.code === code); return t ? t.label : code; }
function pbPill(st) { const s = PJO_STATUS[st] || ['gray', st]; return `<span class="badge ${s[0]}">${s[1]}</span>`; }

async function renderSchedule(main) {
  main.innerHTML = `<div class="empty"><p>Loading the schedule…</p></div>`;
  const co = schedCompany();
  try {
    const [caps, jobs, machines] = await Promise.all([Data.listStageCapacity(co), Data.listJobs(), Data.listMachines().catch(() => [])]);
    const open = jobs.filter((j) => j.destination_company === co && j.jo_review_status === 'approved' && j.status !== 'handed_off');
    const ids = open.map((j) => j.id);
    const [pjoR, doneR, usersR, decR] = ids.length ? await Promise.all([
      sb.from(T('process_jos')).select('*').in('job_id', ids),
      sb.from(T('component_done')).select('job_id,stage_code,done_at').in('job_id', ids),
      sb.from('pmes_users').select('email,name,role,company,active').eq('active', true).order('name'),
      sb.from(T('schedule_decisions')).select('*').in('job_id', ids).order('decided_at', { ascending: false }),
    ]) : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }];
    if (pjoR.error) throw pjoR.error;
    const bundles = await Promise.all(open.map(async (job) => {
      const [stages, components, outputs] = await Promise.all([Data.listJobStages(job.id), Data.listComponents(job.id), Data.listStageOutputs(job.id).catch(() => [])]);
      return { job, stages, components, outputs };
    }));
    const capacity = {}; caps.forEach((c) => { capacity[c.stage_code] = c; });
    const from = new Date(); from.setDate(from.getDate() - 60); const to = new Date(); to.setDate(to.getDate() + 240);
    const [calR, offR, capsR, weeksR, defR] = await Promise.all([
      sb.rpc('pmes_calendar_range', { p_company: co, p_from: pbIso(from), p_to: pbIso(to) }),
      sb.from(T('offday_requests')).select('*').eq('company', co).order('work_date', { ascending: false }),
      sb.rpc('pmes_approver_caps'),
      sb.from(T('work_weeks')).select('*').eq('company', co),
      sb.from(T('work_default')).select('*').eq('company', co).maybeSingle(),
    ]);
    if (calR.error) throw calR.error;
    const cal = {}; (calR.data || []).forEach((x) => { cal[String(x.date).slice(0, 10)] = x; });
    const done = (doneR && doneR.data) || [];
    bundles.forEach((b) => { b.doneByStage = {}; done.filter((x) => x.job_id === b.job.id).forEach((x) => { b.doneByStage[x.stage_code] = (b.doneByStage[x.stage_code] || 0) + 1; }); });
    const rec = PmesSchedule.forwardSchedule(bundles, capacity, new Date(), { dayInfo: (d) => { const i = cal[pbIso(d)]; return i ? { working: i.working, shifts: (i.shifts || []).length } : { working: false, shifts: 0 }; } });
    PB.data = { co, caps, capacity, bundles, rec, machines: machines || [], users: (usersR && usersR.data) || [],
      pjos: pjoR.data || [], done, decisions: (decR && decR.data) || [], cal, offdays: (offR && offR.data) || [], approver: (capsR && capsR.data) || {}, weeks: (weeksR && weeksR.data) || [], defDays: (defR && defR.data && defR.data.days) || null };
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
      ${pmesCan('manager') ? `<select style="width:auto;min-width:110px" onchange="SchedState.company=this.value;render()">${COMPANY_CODES.map((c) => `<option ${c === d.co ? 'selected' : ''}>${c}</option>`).join('')}</select>` : `<span class="small">${d.co}</span>`}
    </div>
    ${!d.caps.length ? `<div class="callout blocked">No process capacity is set for ${d.co}, so the system cannot recommend dates — IE → Process capacity.</div>` : ''}`;
  if (v === 'workcal') { body.innerHTML = pbWorkCal(); return; }
  if (!jobs.length) { body.innerHTML = `<div class="empty"><div class="ic">📅</div><p>No approved Job Orders for ${d.co}.</p><p class="small">A Job Order appears here once it is approved; its process Job Orders are created then.</p></div>`; return; }
  body.innerHTML = v === 'kanban' ? pbKanban(jobs) : v === 'calendar' ? pbCalendar(jobs) : v === 'today' ? pbToday(jobs) : pbGantt(jobs);
}

/* ---- Per-JO header with schedule actions (shared by Gantt) ---- */
function pbJobHead(J) {
  const ss = J.job.schedule_status || 'none', sp = SCHED_STATUS[ss] || SCHED_STATUS.none;
  const canPlan = pmesCan('production_engineer');
  const hasDates = J.pjos.filter((p) => p.planned_pieces > 0 && p.status !== 'done').every((p) => p.planned_start);
  const me = String((State.me && State.me.email) || '').toLowerCase();
  // Two approvals: a supervisor, then a manager (different people). The database enforces the same.
  const apBtn = ss === 'draft' && pmesCan('supervisor') && !pmesCan('manager') ? 'Approve (supervisor)'
    : ss === 'supervisor_ok' && pmesCan('manager') && String(J.job.schedule_supervisor_by || '').toLowerCase() !== me ? 'Approve (manager)' : '';
  return `<div class="flex-between" style="gap:8px;flex-wrap:wrap;">
      <div><strong class="mono" style="cursor:pointer" onclick="goToJob('${J.job.id}')">${escapeHtml(J.job.job_code)}</strong>
        <span class="badge ${sp[0]}">${sp[1]}</span>
        <div class="small">${escapeHtml(J.client)}${J.project ? ' — ' + escapeHtml(J.project) : ''}${J.job.quotation_serial ? ' · ' + escapeHtml(J.job.quotation_serial) : ''}</div>
        <div>${pbWhere(J)}</div></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        ${canPlan ? `<button class="btn outline sm" onclick="pbOpenEdit('${J.job.id}')">${PB.edit === J.job.id ? 'Editing…' : 'Edit dates'}</button>` : ''}
        ${apBtn ? `<button class="btn primary sm" ${hasDates ? '' : 'disabled title="Give every process dates first"'} onclick="pbApprove('${J.job.id}')">${apBtn}</button>` : ''}
      </div></div>
    ${J.job.schedule_supervisor_at ? `<div class="small">Supervisor: ${escapeHtml(J.job.schedule_supervisor_by || '')} ${fmtDate(J.job.schedule_supervisor_at)}${ss === 'approved' && J.job.schedule_approved_at ? ' · Manager: ' + escapeHtml(J.job.schedule_approved_by || '') + ' ' + fmtDate(J.job.schedule_approved_at) : ''}${J.job.schedule_note ? ' · ' + escapeHtml(J.job.schedule_note) : ''}</div>` : ''}
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
  const note = prompt('Approve this loading schedule? A supervisor approves first, then a manager — then it shows in Modcraft. Optional note:');
  if (note === null) return;
  try { const { data, error } = await sb.rpc('pmes_schedule_approve', { p_job: jobId, p_note: note || null }); if (error) throw error;
    toast(data && data.status === 'approved' ? 'Schedule approved — it now shows in Modcraft.' : 'Approved — now waiting for a manager.', 'success'); render(); }
  catch (e) { toast(e.message, 'error'); }
}

/* ---- Gantt: TWO lines per mother JO — Plan and Actual. Each process has its own colour (key above).
   A day shared by several processes is split into side-by-side stripes, so each line stays one row.
   Right-hand remark: planned finish (plan line) and finish projected from the pace of pieces done (actual line). ---- */
const PB_COLORS = ['#3d6fb6', '#e0913a', '#2e9e8f', '#8e5bb5', '#c9463d', '#6b8e23', '#d4a017', '#5b6770', '#b5577f', '#2b8fd8', '#7a5230', '#1b7f5a'];
function pbStageColor(code) {
  const i = State.stageTypes.findIndex((t) => t.code === code);
  if (i >= 0) return PB_COLORS[i % PB_COLORS.length];
  let h = 0; for (const ch of String(code)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PB_COLORS[h % PB_COLORS.length];
}
// Working day per the plant's work calendar; with no calendar row, Mon–Sat.
function pbIsWorking(d) { const i = pbDayInfo(d); return i ? !!i.working : pbDay(d).getDay() !== 0; }
function pbAddWorkDays(from, n) { const d = pbDay(from); let k = 0, guard = 0; while (k < n && guard++ < 800) { d.setDate(d.getDate() + 1); if (pbIsWorking(d)) k++; } return d; }
function pbWorkDaysBetween(a, b) { let n = 0; const d = pbDay(a), e = pbDay(b); let guard = 0; while (d <= e && guard++ < 800) { if (pbIsWorking(d)) n++; d.setDate(d.getDate() + 1); } return n; }

// Plan and actual spans per process, the planned finish, and the finish projected from the pace so far.
function pbJobTimeline(J) {
  const today = pbDay(new Date());
  const plan = [], act = [];
  let planEnd = null, anyPlanDates = false, first = null, lastDone = null, doneSteps = 0, totalSteps = 0;
  J.pjos.forEach((p) => {
    const s = p._s || (p._rec && p._rec.start && pbDay(p._rec.start)), e = p._e || (p._rec && p._rec.end && pbDay(p._rec.end)) || s;
    if (s) { plan.push({ code: p.stage_code, s: pbDay(s), e: pbDay(e), rec: !p._s, p }); if (!planEnd || pbDay(e) > planEnd) planEnd = pbDay(e); if (p._s) anyPlanDates = true; }
    const dates = (p._doneRows || []).map((r) => pbDay(r.done_at)).sort((a, b) => a - b);
    const pieces = p.planned_pieces || 0; totalSteps += pieces; doneSteps += Math.min(pieces || dates.length, dates.length);
    if (dates.length) {
      const a = dates[0], z = p.status === 'done' || (pieces && dates.length >= pieces) ? dates[dates.length - 1] : today;
      act.push({ code: p.stage_code, s: a, e: z < a ? a : z, p });
      if (!first || a < first) first = a; if (!lastDone || dates[dates.length - 1] > lastDone) lastDone = dates[dates.length - 1];
    }
  });
  let proj = null, projNote = '';
  const remaining = Math.max(0, totalSteps - doneSteps);
  if (totalSteps && remaining === 0) { proj = lastDone; projNote = 'Finished'; }
  else if (first && doneSteps > 0) {
    const days = Math.max(1, pbWorkDaysBetween(first, today));
    const pace = doneSteps / days; // piece-steps per working day, all processes together
    proj = pbAddWorkDays(today, Math.ceil(remaining / pace)); projNote = 'Projected finish';
  }
  return { plan, act, planEnd, anyPlanDates, proj, projNote, pace: first && doneSteps ? doneSteps / Math.max(1, pbWorkDaysBetween(first, today)) : 0, doneSteps, totalSteps };
}

function pbGantt(jobs) {
  const today = pbDay(new Date());
  const TL = jobs.map((J) => pbJobTimeline(J)), IMP = pbDelayImpacts(jobs);
  let lo = new Date(today), hi = new Date(today); lo.setDate(lo.getDate() - 3); hi.setDate(hi.getDate() + 14);
  TL.forEach((t) => { t.plan.concat(t.act).forEach((x) => { if (x.s < lo) lo = pbDay(x.s); if (x.e > hi) hi = pbDay(x.e); }); if (t.proj && t.proj > hi) hi = pbDay(t.proj); });
  const days = Math.min(90, Math.round((hi - lo) / 864e5) + 1), W = 100 / days;
  const dayList = Array.from({ length: days }, (_, i) => { const d = new Date(lo); d.setDate(d.getDate() + i); return d; });
  const dayHead = dayList.map((d, i) => { const inf = pbDayInfo(d) || {};
    const cls = inf.working === false ? 'off' : inf.request === 'approved' ? 'ot' : '';
    const tip = inf.holiday ? inf.holiday : inf.off_kind === 'restday' ? 'Rest day' : '';
    return `<div class="gd ${cls} ${+d === +today ? 'tod' : ''}" style="width:${W}%" title="${escapeHtml(tip + (inf.request ? ' · ' + (OFFDAY_STATUS[inf.request] || [0, inf.request])[1] : '') + (inf.working ? ' · ' + (inf.shifts || []).length + ' shift(s)' : ' · not working'))}">${d.getDate() === 1 || i === 0 ? '<b>' + d.toLocaleDateString(undefined, { month: 'short' }) + '</b><br>' : ''}${d.getDate()}${inf.working && (inf.shifts || []).length > 1 ? '<div class="gs">×' + inf.shifts.length + '</div>' : ''}</div>`; }).join('');
  const offCells = dayList.map((d, i) => pbIsWorking(d) ? '' : `<div class="g-offday" style="left:${i * W}%;width:${W}%"></div>`).join('');
  const todayLeft = ((today - lo) / 864e5 + 0.5) * W;
  // One line: per day, the processes on it, drawn as side-by-side stripes.
  const line = (spans, kind, approved) => dayList.map((d, i) => {
    const on = spans.filter((x) => x.s <= d && d <= x.e); if (!on.length) return '';
    const tip = on.map((x) => pbStageLabel(x.code) + ' (' + x.code + ')' + (kind === 'plan' ? (x.rec ? ' recommended ' : ' planned ') + fmtDay(x.s) + ' → ' + fmtDay(x.e) : ' actual ' + fmtDay(x.s) + ' → ' + (x.p.status === 'done' ? fmtDay(x.e) : 'ongoing')) + ' · ' + x.p._done + '/' + x.p.planned_pieces + ' pieces').join('\n');
    return `<div class="g-day ${kind}" style="left:${i * W}%;width:${W}%" title="${escapeHtml(fmtDay(d) + '\n' + tip)}">${on.map((x) => `<i class="${x.rec ? 'rec' : ''}" style="background:${pbStageColor(x.code)}"></i>`).join('')}</div>`;
  }).join('');
  const codes = []; jobs.forEach((J) => J.pjos.forEach((p) => { if (codes.indexOf(p.stage_code) < 0) codes.push(p.stage_code); }));
  codes.sort((a, b) => State.stageTypes.findIndex((t) => t.code === a) - State.stageTypes.findIndex((t) => t.code === b));
  const legend = `<div class="g-legend">${codes.map((c) => `<span class="g-key"><i style="background:${pbStageColor(c)}"></i><b>${escapeHtml(c)}</b> ${escapeHtml(pbStageLabel(c))}</span>`).join('')}</div>
    <div class="g-legend" style="margin-top:6px"><span class="g-key"><b>Plan</b> = planned dates</span><span class="g-key"><b>Actual</b> = first to last piece done (still running = up to today)</span>
    <span class="g-key"><i class="k-split"></i>striped day = processes sharing that day</span><span class="g-key"><i class="k-rec"></i>faint = recommended only</span>
    <span class="g-key"><i class="k-off"></i>grey = not a working day</span><span class="g-key"><i class="k-tod"></i>today</span></div>`;
  const row = (J, t) => {
    const ss = J.job.schedule_status || 'none', sp = SCHED_STATUS[ss] || SCHED_STATUS.none, approved = ss === 'approved';
    const ap = J.job.schedule_supervisor_at ? 'Supervisor: ' + (J.job.schedule_supervisor_by || '') + ' ' + fmtDate(J.job.schedule_supervisor_at) + (ss === 'approved' && J.job.schedule_approved_at ? ' · Manager: ' + (J.job.schedule_approved_by || '') + ' ' + fmtDate(J.job.schedule_approved_at) : '') : '';
    const canPlan = pmesCan('production_engineer'), me = String((State.me && State.me.email) || '').toLowerCase();
    const hasDates = J.pjos.filter((p) => p.planned_pieces > 0 && p.status !== 'done').every((p) => p.planned_start);
    const apBtn = ss === 'draft' && pmesCan('supervisor') && !pmesCan('manager') ? 'Approve (supervisor)'
      : ss === 'supervisor_ok' && pmesCan('manager') && String(J.job.schedule_supervisor_by || '').toLowerCase() !== me ? 'Approve (manager)' : '';
    const dot = { gray: 'var(--text-dim)', amber: 'var(--amber)', blue: '#1f5fa8', green: 'var(--green)' }[sp[0]] || 'var(--text-dim)';
    const who = J.client + (J.project ? ' — ' + J.project : '') + (J.job.quotation_serial ? ' · ' + J.job.quotation_serial : '');
    // Remarks
    const planRem = t.planEnd ? `Plan finish <b>${fmtDay(t.planEnd)}</b>${t.anyPlanDates ? (approved ? '' : ' <span class="small">(not approved)</span>') : ' <span class="small">(recommended)</span>'}` : '<span class="small">No dates yet</span>';
    let actRem = '<span class="small">Not started</span>';
    if (t.projNote === 'Finished') {
      const diff = t.planEnd ? pbWorkDaysBetween(t.planEnd < t.proj ? t.planEnd : t.proj, t.planEnd < t.proj ? t.proj : t.planEnd) - 1 : 0;
      actRem = `Finished <b>${fmtDay(t.proj)}</b>${t.planEnd && +t.proj !== +t.planEnd ? ` <span class="${t.proj > t.planEnd ? 'g-late' : 'g-early'}">${t.proj > t.planEnd ? '+' : '−'}${diff} d</span>` : t.planEnd ? ' <span class="g-early">on plan</span>' : ''}`;
    } else if (t.proj) {
      const late = t.planEnd && t.proj > t.planEnd, early = t.planEnd && t.proj < t.planEnd;
      const diff = t.planEnd ? pbWorkDaysBetween(late ? t.planEnd : t.proj, late ? t.proj : t.planEnd) - 1 : 0;
      actRem = `Projected <b>${fmtDay(t.proj)}</b>${late ? ` <span class="g-late">+${diff} d late</span>` : early ? ` <span class="g-early">${diff} d early</span>` : t.planEnd ? ' <span class="g-early">on plan</span>' : ''}`;
    }
    const paceTip = t.pace ? `Pace so far ${t.pace.toFixed(1)} piece-steps per working day · ${t.doneSteps}/${t.totalSteps} done (every piece counted once per process). Projection = remaining ÷ pace, working days only.` : '';
    return pbDelayLine(J, IMP[J.job.id]) + `<div class="g-row g-jo g-plan"><div class="g-lab">
        <div class="g-l1"><span class="g-dot" style="background:${dot}" title="${escapeHtml(sp[1] + (ap ? ' — ' + ap : ''))}"></span><strong class="mono" style="cursor:pointer" onclick="goToJob('${J.job.id}')" title="${escapeHtml(who)}">${escapeHtml(J.job.job_code)}</strong><span class="g-kind">Plan</span></div>
        <div class="small g-l2" title="${escapeHtml(who)}">${escapeHtml(J.client)}${J.project ? ' — ' + escapeHtml(J.project) : ''}</div>
      </div><div class="g-track">${offCells}${line(t.plan, 'plan', approved)}<div class="g-today" style="left:${todayLeft}%"></div></div><div class="g-rem">${planRem}</div></div>
      <div class="g-row g-jo g-act"><div class="g-lab">
        <div class="g-l1"><span class="g-kind" style="margin-left:15px">Actual</span></div>
        <div class="small g-l2">${canPlan ? `<a href="#" onclick="pbOpenEdit('${J.job.id}');return false">${PB.edit === J.job.id ? 'close' : 'edit dates'}</a>` : ''}${apBtn ? `${canPlan ? ' · ' : ''}<a href="#" onclick="${hasDates ? `pbApprove('${J.job.id}')` : `toast('Give every process dates first','error')`};return false">${apBtn.toLowerCase()}</a>` : ''}</div>
      </div><div class="g-track">${offCells}${line(t.act, 'act', true)}<div class="g-today" style="left:${todayLeft}%"></div></div><div class="g-rem" title="${escapeHtml(paceTip)}">${actRem}</div></div>
      ${PB.edit === J.job.id ? `<div class="g-editrow">${pbEditor(J)}</div>` : ''}`;
  };
  return `<div class="card">${legend}
    <div class="gantt"><div class="g-row g-head"><div class="g-lab"><span class="small">Job Order</span></div><div class="g-track">${dayHead}</div><div class="g-rem small">Finish</div></div>${jobs.map((J, i) => row(J, TL[i])).join('')}</div>
    <p class="small" style="margin:6px 0 0">Hover a day for the processes on it and their pieces; hover the projected finish to see the pace it is based on.</p></div>`;
}

/* ---- Delay knock-on (2026-09-29): the recommendation (PB.data.rec) re-plans every approved JO from
   today using the pieces actually done and each day's capacity. A JO whose re-planned finish is later
   than its own planned finish, while an earlier JO sharing one of its processes is behind plan, is being
   pushed by that delay. The Schedule asks whether to change its plan or keep the original; "keep" is
   recorded and not asked again unless the delay gets worse. ---- */
function pbDelayImpacts(jobs) {
  const d = PB.data, out = {};
  const recEnd = (id) => { let e = null; d.rec.rows.forEach((r) => { if (r.job_id === id && r.end && (!e || r.end > e)) e = pbDay(r.end); }); return e; };
  const planEnd = (J) => { let e = null; J.pjos.forEach((p) => { if (p._e && (!e || p._e > e)) e = pbDay(p._e); }); return e; };
  const info = jobs.map((J) => { const pe = planEnd(J), re = recEnd(J.job.id);
    return { J, pe, re, behind: J.late || !!(pe && re && re > pe), stages: J.pjos.map((p) => p.stage_code), at: String(J.job.jo_approved_at || '') }; });
  info.forEach((x) => {
    if (!x.pe || !x.re || !(x.re > x.pe)) return;
    const causes = info.filter((y) => y !== x && y.at < x.at && y.behind && y.stages.some((c) => x.stages.indexOf(c) >= 0));
    if (!causes.length) return;
    const last = (d.decisions || []).find((k) => k.job_id === x.J.job.id);
    const suppressed = !!(last && last.decision === 'keep' && last.projected_end && pbParse(last.projected_end) >= x.re);
    out[x.J.job.id] = { planEnd: x.pe, projEnd: x.re, causes: causes.map((y) => y.J.job.job_code), days: pbWorkDaysBetween(x.pe, x.re) - 1, suppressed, last };
  });
  return out;
}
function pbDelayLine(J, imp) {
  if (!imp) return '';
  if (imp.suppressed) return `<div class="g-alert kept">Original plan kept by ${escapeHtml(imp.last.decided_by)} ${fmtDate(imp.last.decided_at)} despite the delay from ${escapeHtml(imp.causes.join(', '))}${imp.last.note ? ' — ' + escapeHtml(imp.last.note) : ''}.</div>`;
  const can = pmesCan('production_engineer');
  return `<div class="g-alert">⚠ Delayed by <b>${escapeHtml(imp.causes.join(', '))}</b> — at today's progress this Job Order would finish <b>${fmtDay(imp.projEnd)}</b> instead of <b>${fmtDay(imp.planEnd)}</b> (+${imp.days} working day${imp.days === 1 ? '' : 's'}). Change the plan or keep the original?
    ${can ? `<button class="btn primary sm" onclick="pbDelayDecide('${J.job.id}','change')">Change plan</button> <button class="btn outline sm" onclick="pbDelayDecide('${J.job.id}','keep')">Keep original plan</button>` : '<span class="small">A production engineer, supervisor or manager decides.</span>'}</div>`;
}
async function pbDelayDecide(jobId, decision) {
  const J = pbJobs().find((x) => x.job.id === jobId), imp = J && pbDelayImpacts(pbJobs())[jobId]; if (!J || !imp) return;
  let note = null;
  if (decision === 'keep') { note = prompt('Keep the original plan for ' + J.job.job_code + '? Optional reason:'); if (note === null) return; }
  const row = { job_id: jobId, decision, planned_end: pbIso(imp.planEnd), projected_end: pbIso(imp.projEnd), caused_by: imp.causes, note: note || null };
  try {
    const { error } = await sb.from(T('schedule_decisions')).insert(row); if (error) throw error;
    PB.data.decisions.unshift(Object.assign({ decided_at: new Date().toISOString(), decided_by: (State.me && State.me.email) || '' }, row));
    if (decision === 'change') { PB.edit = null; pbOpenEdit(jobId); pbUseRec(jobId); toast('Recommended dates filled in — check and Save dates. The schedule then needs approval again.', 'success'); }
    else { toast('Original plan kept — you will be asked again only if the delay gets worse.', 'success'); pbDraw(); }
  } catch (e) { toast(e.message, 'error'); }
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
    const inf = pbDayInfo(d) || {};
    return `<div class="cal-d ${d.getMonth() !== m.getMonth() ? 'out' : ''} ${+d === +today ? 'tod' : ''} ${inf.working === false ? 'sun' : ''}"><div class="small"><b>${d.getDate()}</b>${inf.holiday ? ' <span class="cal-hol">' + escapeHtml(inf.holiday) + '</span>' : ''}${inf.request === 'approved' ? ' <span class="badge green" style="font-size:9px">work approved</span>' : ''}${inf.working && (inf.shifts || []).length > 1 ? ' <span class="small">×' + inf.shifts.length + ' shifts</span>' : ''}</div>
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
  const nowH = new Date().getHours(), tInfo = pbDayInfo(today), slots = pbShiftSlots(tInfo), nowIdx = slots.indexOf(nowH);
  const workLeft = (e) => { let n = 0; const d = new Date(today); while (d <= e) { const i = pbDayInfo(d); if (i && i.working) n++; d.setDate(d.getDate() + 1); } return Math.max(1, n); };
  return `<p class="small" style="margin-bottom:8px;">Today: ${tInfo && tInfo.working ? (tInfo.shifts || []).map((x) => escapeHtml(x.start + '–' + x.end)).join(', ') + ' (from the work calendar)' : '<strong>not a working day</strong>' + (tInfo && tInfo.holiday ? ' — ' + escapeHtml(tInfo.holiday) : '')}. Plan for today = pieces left spread over the working days left in the plan, then evenly over today's shift hours. Actual = pieces ticked done (Pieces tab or scanner).</p>` +
    rows.map(({ J, p }) => {
      const left = Math.max(0, p.planned_pieces - p._doneRows.filter((x) => new Date(x.done_at) < today).length);
      const daysLeft = p._late ? 1 : workLeft(p._e);
      const planToday = Math.ceil(left / daysLeft);
      const doneToday = p._doneRows.filter((x) => new Date(x.done_at) >= today);
      const perHour = slots.length ? planToday / slots.length : 0;
      let cumP = 0, cumA = 0;
      const hrs = slots.map((h, i) => { const a = doneToday.filter((x) => new Date(x.done_at).getHours() === h).length; cumP += perHour; cumA += a;
        const seen = nowIdx < 0 ? nowH > h : i <= nowIdx, past = nowIdx < 0 ? nowH > h : i < nowIdx;
        return `<tr class="${i === nowIdx ? 'now' : ''}"><td>${String(h).padStart(2, '0')}:00</td><td>${Math.round(cumP)}</td><td>${seen ? a : ''}</td><td>${seen ? '<strong>' + cumA + '</strong>' : ''}</td><td>${seen ? (cumA >= Math.round(cumP) ? '<span class="badge green">on</span>' : past ? '<span class="badge red">' + (cumA - Math.round(cumP)) + '</span>' : '') : ''}</td></tr>`; }).join('') || '<tr><td colspan="5" class="small">No shifts today in the work calendar.</td></tr>';
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

/* ---- Work calendar: operating hours per week (compressed weeks, 1–3 shifts), holidays, and approval to work
   a holiday or rest day (manager → Head of Plant Operations → Managing Director). ---- */
const WC_PRESETS = [
  ['Standard: 1 shift, Mon–Sat', [1, 1, 1, 1, 1, 1, 0], [['Day', '08:00', '17:00', 60]]],
  ['2 shifts, Mon–Sat', [1, 1, 1, 1, 1, 1, 0], [['Day', '06:00', '14:00', 30], ['Swing', '14:00', '22:00', 30]]],
  ['3 shifts, Mon–Fri', [1, 1, 1, 1, 1, 0, 0], [['Day', '06:00', '14:00', 30], ['Swing', '14:00', '22:00', 30], ['Night', '22:00', '06:00', 30]]],
  ['Compressed: Mon–Thu, 10-hour shift', [1, 1, 1, 1, 0, 0, 0], [['Day', '07:00', '18:00', 60]]],
];
function pbMonday(d) { const x = pbDay(d); const k = (x.getDay() + 6) % 7; x.setDate(x.getDate() - k); return x; }
function pbWeekDays(weekIso) {
  const w = PB.data.weeks.find((x) => String(x.week_start).slice(0, 10) === weekIso);
  return { custom: !!w, note: w ? w.note || '' : '', days: JSON.parse(JSON.stringify((w && w.days) || PB.data.defDays || Array.from({ length: 7 }, () => ({ shifts: [] })))) };
}
function pbWorkCal() {
  if (!PB.week) PB.week = pbMonday(new Date());
  const wIso = pbIso(PB.week);
  if (!PB.wk || PB.wk.weekIso !== wIso) { const w = pbWeekDays(wIso); PB.wk = { weekIso: wIso, custom: w.custom, note: w.note, days: w.days, dirty: false }; }
  const canEdit = pmesCan('production_engineer'), canDefault = pmesCan('manager');
  const nav = (k) => `PB.week=new Date(${PB.week.getFullYear()},${PB.week.getMonth()},${PB.week.getDate() + k});PB.wk=null;pbDraw()`;
  const cols = PB.wk.days.map((day, i) => {
    const d = new Date(PB.week); d.setDate(d.getDate() + i); const inf = pbDayInfo(d) || {}, iso = pbIso(d);
    const req = PB.data.offdays.find((r) => String(r.work_date).slice(0, 10) === iso && r.status !== 'rejected' && r.status !== 'cancelled');
    const offKind = inf.off_kind;
    const reqHtml = req ? '<div class="small" style="margin-top:6px"><span class="badge ' + OFFDAY_STATUS[req.status][0] + '">' + OFFDAY_STATUS[req.status][1] + '</span></div>'
      : canEdit ? `<button class="btn primary sm" style="margin-top:6px" onclick="pbOffdayRequest('${iso}')">Request to work this day</button>` : '';
    return `<div class="wc-day ${inf.working ? '' : 'off'}">
      <div class="flex-between"><strong>${DOW[i]} ${d.getDate()}</strong>${inf.working ? '<span class="badge green">Working</span>' : '<span class="badge gray">Off</span>'}</div>
      ${inf.holiday ? '<div class="small" style="color:#b33a2f">🎌 ' + escapeHtml(inf.holiday) + '</div>' : offKind === 'restday' ? '<div class="small">Rest day</div>' : ''}
      ${(day.shifts || []).map((s, k) => `<div class="wc-shift">
        <input type="text" value="${escapeHtml(s.name || '')}" placeholder="Shift" ${canEdit ? '' : 'disabled'} onchange="PB.wk.days[${i}].shifts[${k}].name=this.value;PB.wk.dirty=true">
        <div class="wc-times"><input type="time" value="${escapeHtml(s.start)}" ${canEdit ? '' : 'disabled'} onchange="PB.wk.days[${i}].shifts[${k}].start=this.value;PB.wk.dirty=true">
        <span>–</span><input type="time" value="${escapeHtml(s.end)}" ${canEdit ? '' : 'disabled'} onchange="PB.wk.days[${i}].shifts[${k}].end=this.value;PB.wk.dirty=true"></div>
        <label class="small">Break (min) <input type="number" min="0" step="5" value="${s.break == null ? '' : s.break}" ${canEdit ? '' : 'disabled'} onchange="PB.wk.days[${i}].shifts[${k}].break=Number(this.value)||0;PB.wk.dirty=true" style="width:60px"></label>
        ${canEdit ? `<button class="btn outline sm" onclick="PB.wk.days[${i}].shifts.splice(${k},1);PB.wk.dirty=true;pbDraw()">Remove</button>` : ''}</div>`).join('') || '<p class="small">No shift</p>'}
      ${canEdit ? `<button class="btn outline sm" onclick="PB.wk.days[${i}].shifts.push({name:'Shift',start:'08:00',end:'17:00',break:60});PB.wk.dirty=true;pbDraw()">+ Shift</button>` : ''}
      ${offKind ? reqHtml : ''}
      ${offKind && (day.shifts || []).length && !inf.working ? '<div class="small" style="margin-top:4px">Shifts set, but not counted until approved.</div>' : ''}
    </div>`;
  }).join('');
  const pend = PB.data.offdays.filter((r) => r.status.indexOf('pending') === 0);
  const rest = PB.data.offdays.filter((r) => r.status.indexOf('pending') !== 0).slice(0, 20);
  return `<div class="card"><div class="flex-between" style="gap:8px;flex-wrap:wrap;">
      <div style="display:flex;gap:6px;align-items:center;"><button class="btn outline sm" onclick="${nav(-7)}">←</button>
        <h2 class="mb-0">Week of ${PB.week.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</h2>
        <button class="btn outline sm" onclick="${nav(7)}">→</button></div>
      <span class="small">${PB.wk.custom ? '<span class="badge blue">Set for this week</span>' : '<span class="badge gray">Default week</span>'} · ${escapeHtml(PB.data.co)}</span></div>
    <p class="small" style="margin-top:6px;">Operating hours change week to week — set this week's shifts (or leave the default). Capacity per day follows the number of shifts. Holidays (national and local) and rest days are off: to work one, request approval — manager, then Head of Plant Operations, then Managing Director. Only then does the schedule count that day.</p>
    ${canEdit ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin:8px 0;"><span class="small" style="align-self:center">Quick fill:</span>${WC_PRESETS.map((p, i) => `<button class="btn outline sm" onclick="pbPreset(${i})">${escapeHtml(p[0])}</button>`).join('')}</div>` : ''}
    <div class="wc-week">${cols}</div>
    ${canEdit ? `<input type="text" id="wcNote" placeholder="Note for this week (optional, e.g. rush for Valera job)" value="${escapeHtml(PB.wk.note)}" style="margin-top:8px;" oninput="PB.wk.note=this.value">
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
        <button class="btn primary sm" onclick="pbSaveWeek(false)">Save this week</button>
        ${PB.wk.custom ? `<button class="btn outline sm" onclick="pbResetWeek()">Back to the default week</button>` : ''}
        ${canDefault ? `<button class="btn outline sm" onclick="pbSaveWeek(true)">Save as the default week</button>` : ''}
        ${PB.wk.dirty ? '<span class="small" style="align-self:center;color:#b33a2f">Not saved yet</span>' : ''}</div>` : ''}
  </div>
  <div class="card"><h2>Requests to work a holiday or rest day</h2>
    ${pend.length || rest.length ? pend.concat(rest).map(pbOffdayRow).join('') : '<p class="small">None.</p>'}</div>`;
}
function pbPreset(i) {
  const p = WC_PRESETS[i];
  PB.wk.days = p[1].map((on) => ({ shifts: on ? p[2].map((s) => ({ name: s[0], start: s[1], end: s[2], break: s[3] })) : [] }));
  PB.wk.dirty = true; pbDraw();
}
async function pbSaveWeek(asDefault) {
  if (asDefault && !confirm('Make this the default week for ' + PB.data.co + '? Weeks you set separately keep their own hours.')) return;
  try {
    const days = PB.wk.days.map((d) => ({ shifts: (d.shifts || []).map((s) => ({ name: s.name || '', start: s.start, end: s.end, break: Number(s.break) || 0 })) }));
    const { error } = await sb.rpc('pmes_calendar_save', { p_company: PB.data.co, p_week_start: asDefault ? null : PB.wk.weekIso, p_days: days, p_note: PB.wk.note || null });
    if (error) throw error;
    toast(asDefault ? 'Default week saved.' : 'Week saved.', 'success'); PB.wk = null; render();
  } catch (e) { toast(e.message, 'error'); }
}
async function pbResetWeek() {
  if (!confirm('Use the default week again for this week?')) return;
  try { const { error } = await sb.rpc('pmes_calendar_reset_week', { p_company: PB.data.co, p_week_start: PB.wk.weekIso }); if (error) throw error; PB.wk = null; render(); }
  catch (e) { toast(e.message, 'error'); }
}
async function pbOffdayRequest(iso) {
  const reason = prompt('Why must the plant work on ' + iso + '? (e.g. rush order, client deadline). It goes to a manager, then the Head of Plant Operations, then the Managing Director.');
  if (reason === null) return; if (!reason.trim()) return toast('A reason is needed.', 'error');
  try { const { error } = await sb.rpc('pmes_offday_request', { p_company: PB.data.co, p_date: iso, p_reason: reason.trim() }); if (error) throw error; toast('Request sent to a manager.', 'success'); render(); }
  catch (e) { toast(e.message, 'error'); }
}
function pbOffdayRow(r) {
  const o = OFFDAY_STATUS[r.status] || ['gray', r.status], me = String((State.me && State.me.email) || '').toLowerCase(), ap = PB.data.approver || {};
  const already = [r.manager_by, r.hpo_by].map((x) => String(x || '').toLowerCase()).indexOf(me) >= 0;
  const mine = (r.status === 'pending_manager' && pmesCan('manager')) || (r.status === 'pending_hpo' && ap.plant_head) || (r.status === 'pending_md' && ap.md);
  const step = (lbl, by, at) => by ? `<span class="badge green">${lbl} ✓</span> <span class="small">${escapeHtml(by)} ${fmtDate(at)}</span>` : `<span class="badge gray">${lbl}</span>`;
  const pending = r.status.indexOf('pending') === 0, wd = pbParse(r.work_date);
  return `<div style="border:1px solid var(--border);border-radius:10px;padding:10px;margin-top:8px;">
    <div class="flex-between" style="gap:8px;flex-wrap:wrap;"><strong>${fmtDay(wd)} ${wd.getFullYear()} — ${r.kind === 'holiday' ? '🎌 ' + escapeHtml(r.holiday_name || 'Holiday') : 'Rest day'}</strong><span class="badge ${o[0]}">${o[1]}</span></div>
    <div class="small" style="margin-top:4px;">Reason: ${escapeHtml(r.reason)} — ${escapeHtml(r.requested_by_name || r.requested_by)}, ${fmtDate(r.requested_at)}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;align-items:center;">${step('Manager', r.manager_by, r.manager_at)} ${step('Head of Plant Ops', r.hpo_by, r.hpo_at)} ${step('Managing Director', r.md_by, r.md_at)}</div>
    ${r.status === 'rejected' ? '<div class="small" style="color:#b33a2f">Rejected by ' + escapeHtml(r.rejected_by || '') + ': ' + escapeHtml(r.reject_note || '') + '</div>' : ''}
    ${pending ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
      ${mine && !already ? `<button class="btn primary sm" onclick="pbOffdayDecide('${r.id}',true)">Approve</button><button class="btn outline sm" onclick="pbOffdayDecide('${r.id}',false)">Reject</button>` : ''}
      ${mine && already ? '<span class="small">You approved an earlier step — another person approves this one.</span>' : ''}
      ${r.requested_by === me || pmesCan('manager') ? `<button class="btn outline sm" onclick="pbOffdayCancel('${r.id}')">Cancel request</button>` : ''}</div>` : ''}
  </div>`;
}
async function pbOffdayDecide(id, ok) {
  let note = null;
  if (!ok) { note = prompt('Why is it rejected?'); if (note === null) return; if (!note.trim()) return toast('Give the reason.', 'error'); }
  else if (!confirm('Approve working on this day?')) return;
  try {
    const { data, error } = await sb.rpc('pmes_offday_decide', { p_id: id, p_approve: ok, p_note: note }); if (error) throw error;
    const msg = { pending_hpo: 'Approved — now the Head of Plant Operations.', pending_md: 'Approved — now the Managing Director.', approved: 'Approved — the day now counts as working.' };
    toast(ok ? (msg[data.status] || 'Approved.') : 'Rejected.', 'success'); render();
  } catch (e) { toast(e.message, 'error'); }
}
async function pbOffdayCancel(id) {
  if (!confirm('Cancel this request?')) return;
  try { const { error } = await sb.rpc('pmes_offday_cancel', { p_id: id }); if (error) throw error; render(); } catch (e) { toast(e.message, 'error'); }
}
