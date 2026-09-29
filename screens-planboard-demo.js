/* =====================================================================
   Schedule — PRACTICE MODE (2026-09-29, Rommel: "populate it with dummy data to see how it will really look").
   Sample Job Orders built in the browser only. Nothing is read from or written to the database:
   every button still works (edit dates, approve, delay decision, hand-out) but only changes the sample
   in memory; work-calendar and off-day changes are refused with a message. Leaving practice reloads the
   real schedule.

   The sample is made to show every state the Gantt can: finished, on plan, behind plan (and the Job
   Orders it pushes, which then get the delay alert), approved but not started, a draft with only
   recommended dates, and one that ends on lamination (ready the day after the 24-hour cure).
   Capacity is sample capacity in each process's own unit, so the dates come out of the real scheduler
   (schedule.js) exactly as they would for real Job Orders.
   ===================================================================== */

// Sample daily capacity, in the unit the Job Order measures each process in (as PMES → IE → Process capacity).
const PB_DEMO_CAP = { CUT: [110, 'lm'], SCUT: [35, 'lm'], EBA: [90, 'lm'], EBB: [90, 'lm'], MEB: [30, 'lm'], HPL: [6, 'boards'], MHPL: [3, 'boards'],
  GRV: [40, 'lm'], DRL: [160, 'holes'], ASM: [14, 'pieces'], QC: [40, 'pieces'], PACK: [45, 'pieces'] };
const PB_DEMO_JOBS = [
  // pieces, route, pace = share of the planned pieces actually done so far, schedule status. Approved in this order.
  { k: 1, client: 'Sample Client A', project: 'Pantry cabinets', n: 36, route: ['CUT', 'EBB', 'DRL', 'ASM', 'QC', 'PACK'], pace: 1.0, ss: 'approved' },
  { k: 2, client: 'Sample Client B', project: 'Kitchen — 3 m run', n: 84, route: ['CUT', 'SCUT', 'EBB', 'GRV', 'DRL', 'ASM', 'QC', 'PACK'], pace: 0.45, ss: 'approved' },
  { k: 3, client: 'Sample Client C', project: 'Wardrobes (2 rooms)', n: 60, route: ['CUT', 'EBB', 'DRL', 'ASM', 'QC', 'PACK'], pace: 1.0, ss: 'approved' },
  { k: 4, client: 'Sample Client D', project: 'Office storage', n: 48, route: ['CUT', 'EBB', 'DRL', 'ASM', 'QC', 'PACK'], pace: 0, ss: 'supervisor_ok' },
  { k: 5, client: 'Sample Client E', project: 'HPL wall panels (for pick-up)', n: 20, route: ['CUT', 'HPL', 'CURE'], pace: 1.0, ss: 'approved' },
  { k: 6, client: 'Sample Client F', project: 'Reception counter', n: 30, route: ['CUT', 'SCUT', 'EBB', 'HPL', 'CURE', 'DRL', 'ASM', 'QC', 'PACK'], pace: 1.0, ss: 'draft' },
];
const PB_DEMO_START_BACK = 12; // the plan began this many working days ago

function pbDemoData(co) {
  const today = pbDay(new Date());
  const known = (State.stageTypes || []).map((t) => t.code);
  const keep = (c) => !known.length || known.indexOf(c) >= 0;
  // Work calendar: Mon–Sat, one shift 08:00–17:00; Sundays are rest days.
  const cal = {}, from = new Date(today); from.setDate(from.getDate() - 60);
  for (let i = 0; i < 300; i++) {
    const d = new Date(from); d.setDate(from.getDate() + i);
    const sun = d.getDay() === 0;
    cal[pbIso(d)] = { date: pbIso(d), working: !sun, shifts: sun ? [] : [{ start: '08:00', end: '17:00', break: 60 }], holiday: null, off_kind: sun ? 'restday' : null, request: null };
  }
  const dayInfo = (d) => { const i = cal[pbIso(d)]; return i ? { working: i.working, shifts: i.shifts.length } : { working: false, shifts: 0 }; };
  const workBack = (n) => { const d = new Date(today); let k = 0; while (k < n) { d.setDate(d.getDate() - 1); if (d.getDay() !== 0) k++; } return d; };
  const capacity = {};
  Object.keys(PB_DEMO_CAP).forEach((c) => { capacity[c] = { stage_code: c, daily_capacity: PB_DEMO_CAP[c][0], unit: PB_DEMO_CAP[c][1], shifts_per_day: 1, workdays_per_week: 6, company: co }; });
  const me = (State.me && (State.me.name || State.me.email)) || 'you';

  // Bundles as the real screen builds them: a job, its stages and its pieces (no mother JO → load in pieces).
  const bundles = PB_DEMO_JOBS.map((x) => {
    const route = x.route.filter(keep);
    const approvedAt = new Date(workBack(PB_DEMO_START_BACK + 1)); approvedAt.setHours(8, x.k, 0, 0);
    const job = { id: 'demo-' + x.k, job_code: 'JO-DEMO' + String(x.k).padStart(3, '0') + '-1', quotation_serial: 'QT-DEMO' + String(x.k).padStart(4, '0'),
      destination_company: co, jo_review_status: 'approved', jo_approved_at: approvedAt.toISOString(), status: 'in_production',
      schedule_status: x.ss,
      // A mother JO like Modcraft sends: the loads per process come from these figures (schedule.js stageLoad).
      mother_jo: { client: x.client, project: x.project, parts: [{ qty: x.n, route }],
        services: { cuttingLM: Math.round(x.n * 2.6), edgebandingLM: Math.round(x.n * 2.1), holeCount: x.n * 4,
          extraServicesByName: route.indexOf('GRV') >= 0 ? [{ service: 'Grooving', qty: Math.round(x.n * 0.6) }] : [] },
        boards: route.indexOf('HPL') >= 0 ? [{ material: 'HPL on MDF', color: '', boardsNeeded: Math.ceil(x.n / 3) }] : [] },
      schedule_supervisor_by: x.ss !== 'draft' ? 'Sample Supervisor' : null, schedule_supervisor_at: x.ss !== 'draft' ? approvedAt.toISOString() : null,
      schedule_approved_by: x.ss === 'approved' ? 'Sample Manager' : null, schedule_approved_at: x.ss === 'approved' ? approvedAt.toISOString() : null };
    const stages = route.map((c, i) => ({ id: job.id + '-s' + c, job_id: job.id, stage_code: c, sequence_index: i, status: 'not_started' }));
    const components = Array.from({ length: x.n }, (_, i) => ({ id: job.id + '-p' + i, route }));
    return { job, stages, components, outputs: [], _x: x };
  });

  // The PLAN the Job Orders were given when approved: the scheduler run from the plan start, as if all went to plan.
  const plan = {};
  PmesSchedule.forwardSchedule(bundles.filter((b) => b._x.ss !== 'draft').map((o) => ({ job: o.job, stages: o.stages, components: o.components, outputs: [] })),
    capacity, workBack(PB_DEMO_START_BACK), { dayInfo }).rows.forEach((r) => { plan[r.job_id + ':' + r.stage_code] = r; });

  // Pieces done: each process gets its planned pieces up to today, times how well the Job Order is keeping pace.
  const done = [];
  const pjos = [];
  bundles.forEach((b) => {
    b.doneByStage = {};
    b.stages.forEach((s) => {
      // CURE has no dates of its own: its pieces are done the day after lamination (the 24-hour cure).
      let p = plan[b.job.id + ':' + s.stage_code];
      if (s.stage_code === 'CURE') { const l = plan[b.job.id + ':HPL'] || plan[b.job.id + ':MHPL']; if (l && l.start) { const a = new Date(l.start), z = new Date(l.end); a.setDate(a.getDate() + 1); z.setDate(z.getDate() + 1); p = { start: a, end: z }; } }
      let n = 0, days = [];
      if (p && p.start && p.start <= today && b._x.pace > 0) {
        for (let d = new Date(p.start); d <= p.end && d <= today; d.setDate(d.getDate() + 1)) if (d.getDay() !== 0) days.push(new Date(d));
        const planDays = Math.max(1, (() => { let k = 0; for (let d = new Date(p.start); d <= p.end; d.setDate(d.getDate() + 1)) if (d.getDay() !== 0) k++; return k; })());
        n = Math.min(b.components.length, Math.round(b.components.length * Math.min(1, days.length / planDays) * b._x.pace));
      }
      for (let i = 0; i < n; i++) {
        const d = new Date(days[Math.min(days.length - 1, Math.floor(i * days.length / Math.max(1, n)))]);
        d.setHours(8 + (i % 8), (i * 7) % 60, 0, 0);
        if (d > new Date()) d.setTime(Date.now() - (n - i) * 60000);
        done.push({ job_id: b.job.id, stage_code: s.stage_code, done_at: d.toISOString() });
      }
      b.doneByStage[s.stage_code] = n;
      if (n >= b.components.length) s.status = 'complete'; else if (n > 0) s.status = 'in_progress';
      const status = n >= b.components.length ? 'done' : n > 0 ? 'in_progress' : b._x.ss === 'approved' ? 'scheduled' : 'to_schedule';
      const started = n > 0;
      pjos.push({ id: b.job.id + '-pjo-' + s.stage_code, job_id: b.job.id, stage_code: s.stage_code, sequence_index: s.sequence_index,
        pjo_no: b.job.job_code + '-' + s.stage_code, planned_pieces: b.components.length, status,
        planned_start: b._x.ss !== 'draft' && p && p.start && s.stage_code !== 'CURE' ? pbIso(p.start) : null, planned_end: b._x.ss !== 'draft' && p && p.end && s.stage_code !== 'CURE' ? pbIso(p.end) : null,
        machine_name: started ? 'Sample machine ' + s.stage_code : null, operators: started ? ['Sample Operator'] : [],
        handed_out_at: started ? b.job.jo_approved_at : null, handed_out_by_name: started ? 'Sample Shift Head' : null });
    });
  });

  // The recommendation: re-plan from today with the pieces actually done (this is what finds delays).
  const rec = PmesSchedule.forwardSchedule(bundles, capacity, today, { dayInfo });
  const caps = Object.keys(capacity).map((c) => capacity[c]);
  return { co, caps, capacity, bundles, rec, machines: [], users: [{ email: 'operator@sample', name: 'Sample Operator', role: 'operator', company: '' }],
    pjos, done, decisions: [], cal, offdays: [], approver: {}, weeks: [], defDays: null, _demoMe: me, _dayInfo: dayInfo };
}

// Recompute the recommendation after a change to the sample (dates saved, etc.).
function pbDemoRecalc() {
  const d = PB.data; d.rec = PmesSchedule.forwardSchedule(d.bundles, d.capacity, pbDay(new Date()), { dayInfo: d._dayInfo });
}

/* ---- Wrap the real screen: practice data in, every save kept in the browser ---- */
(function () {
  const realRender = renderSchedule, realDraw = pbDraw, realGoToJob = goToJob;
  const said = (m) => toast('Practice — ' + m, 'success');

  window.renderSchedule = async function (main) {
    if (!PB.demo) return realRender(main);
    PB.data = pbDemoData(schedCompany());
    main.innerHTML = `<div id="pbTop"></div><div id="pbBody"></div>`;
    pbDraw();
  };
  window.pbDraw = function () {
    realDraw();
    const top = document.getElementById('pbTop'); if (!top || !PB.data) return;
    const bar = document.createElement('div');
    bar.innerHTML = PB.demo
      ? `<div class="callout" style="background:#fff4d6;border:1px solid #e0b43a;color:#5a4200;margin-bottom:10px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
          <strong>PRACTICE — sample Job Orders.</strong><span class="small">Sample capacity (lm, boards, holes, pieces per day) and a Mon–Sat work week. Every button works, but nothing is saved and nobody is notified.</span>
          <span style="flex:1"></span><button class="btn outline sm" onclick="pbDemoStart()">Start over</button> <button class="btn primary sm" onclick="pbDemoStop()">Back to the real schedule</button></div>`
      : (pmesCan('production_engineer') || pmesCan('shift_head') ? `<div style="text-align:right;margin:-4px 0 8px"><a href="#" class="small" onclick="pbDemoStart();return false" title="See the schedule filled with sample Job Orders — nothing is saved">▶ Practice with sample Job Orders</a></div>` : '');
    top.insertBefore(bar, top.firstChild);
  };
  window.goToJob = function (id, tab) {
    if (PB.demo && String(id).indexOf('demo-') === 0) { said('sample Job Orders have no job page. Leave practice to open a real one.'); return; }
    return realGoToJob(id, tab);
  };

  // Saving dates: kept on the sample; an approved schedule goes back to draft, as the real rule does.
  const realSave = pbSave;
  window.pbSave = async function (jobId) {
    if (!PB.demo) return realSave(jobId);
    const d = PB.data, b = d.bundles.find((x) => x.job.id === jobId); if (!b) return;
    d.pjos.filter((p) => p.job_id === jobId && p.status !== 'done').forEach((p) => {
      const dr = PB.draft[p.stage_code] || {}; p.planned_start = dr.start || null; p.planned_end = dr.end || dr.start || null;
      if (p.planned_start && p.status === 'to_schedule') p.status = 'scheduled';
    });
    const was = b.job.schedule_status; b.job.schedule_status = 'draft';
    b.job.schedule_supervisor_by = b.job.schedule_supervisor_at = b.job.schedule_approved_by = b.job.schedule_approved_at = null;
    PB.edit = null; pbDemoRecalc(); pbDraw();
    said(was === 'approved' ? 'dates saved on the sample; the schedule needs approval again.' : 'dates saved on the sample.');
  };
  const realApprove = pbApprove;
  window.pbApprove = async function (jobId) {
    if (!PB.demo) return realApprove(jobId);
    const b = PB.data.bundles.find((x) => x.job.id === jobId); if (!b) return;
    const now = new Date().toISOString();
    if (b.job.schedule_status === 'draft') { b.job.schedule_status = 'supervisor_ok'; b.job.schedule_supervisor_by = PB.data._demoMe; b.job.schedule_supervisor_at = now; said('approved as supervisor — a manager approves next.'); }
    else if (b.job.schedule_status === 'supervisor_ok') { b.job.schedule_status = 'approved'; b.job.schedule_approved_by = PB.data._demoMe; b.job.schedule_approved_at = now; said('schedule approved (in real use it now shows in Modcraft).'); }
    pbDraw();
  };
  const realDecide = pbDelayDecide;
  window.pbDelayDecide = async function (jobId, decision) {
    if (!PB.demo) return realDecide(jobId, decision);
    const imp = pbDelayImpacts(pbJobs())[jobId]; if (!imp) return;
    let note = null;
    if (decision === 'keep') { note = prompt('Keep the original plan? Optional reason:'); if (note === null) return; }
    PB.data.decisions.unshift({ job_id: jobId, decision, planned_end: pbIso(imp.planEnd), projected_end: pbIso(imp.projEnd), caused_by: imp.causes, note: note || null,
      decided_at: new Date().toISOString(), decided_by: PB.data._demoMe });
    if (decision === 'change') { PB.edit = null; pbOpenEdit(jobId); pbUseRec(jobId); said('recommended dates filled in — Save dates, then it needs approval again.'); }
    else { pbDraw(); said('original plan kept; you would be asked again only if the delay gets worse.'); }
  };
  const realHandoutSave = pbHandoutSave;
  window.pbHandoutSave = async function (pjoId) {
    if (!PB.demo) return realHandoutSave(pjoId);
    const p = PB.data.pjos.find((x) => x.id === pjoId); if (!p) return;
    const m = document.getElementById('hoMachine');
    p.operators = [...document.querySelectorAll('.hoOp:checked')].map((i) => i.value).concat(document.getElementById('hoOther').value.split(',').map((s) => s.trim()).filter(Boolean));
    p.machine_name = m && m.value ? m.options[m.selectedIndex].text : p.machine_name;
    p.handout_note = document.getElementById('hoNote').value || null;
    p.handed_out_at = new Date().toISOString(); p.handed_out_by_name = PB.data._demoMe;
    if (p.status === 'scheduled') p.status = 'handed_out';
    closeSheet(); pbDraw(); said('handed out on the sample.');
  };
  // The work calendar and off-day approvals are the plant's real settings — not changed from practice.
  ['pbSaveWeek', 'pbResetWeek', 'pbOffdayRequest', 'pbOffdayDecide', 'pbOffdayCancel'].forEach((name) => {
    const real = window[name];
    window[name] = function () {
      if (PB.demo) { toast('Practice — the work calendar is the plant\'s real setting and is not changed from practice. Leave practice to change it.', 'error'); return; }
      return real.apply(this, arguments);
    };
  });
})();

function pbDemoStart() { PB.demo = true; PB.edit = null; PB.draft = {}; render(); }
function pbDemoStop() { PB.demo = false; PB.edit = null; PB.draft = {}; PB.data = null; render(); }
