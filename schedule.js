/* --------------------------- Schedule (Piece 3) ---------------------------
   Pure functions, no DOM, no network — so they can be tested in Node.

   A job's LOAD per process comes from the Modcraft Job Order copied at release
   (job.mother_jo), in the unit each process is measured in:
     CUT/SCUT  cutting lm (split by pieces routed to each)
     EBA/EBB/MEB  edge-banding lm (split by pieces routed to each)
     HPL/MHPL  boards of HPL material (split by pieces routed to each)
     GRV       grooving lm (the per-lm services whose name says grooving)
     DRL       holes
     everything else  pieces
   A job with no mother JO (hand-made) is loaded in pieces on every process.
   Confirmed actual output (Piece 2, in pieces) reduces the remaining load in
   proportion to pieces done.

   Forward scheduling: jobs in approval order, each job's processes in route
   order; a process is one resource per company, so a job waits for the
   process to be free AND for its own previous process to finish. Days on a
   process = remaining load ÷ daily capacity (rounded up, at least 1 when
   there is any load). Sundays are skipped; Saturdays too on a 5-day week.
   Nothing is stored — it is recomputed from what the JOs and the outputs say.
   --------------------------------------------------------------------------- */
(function (root) {
  const PIECE_STAGES = { ASM: 1, QC: 1, PACK: 1, CURE: 1 };

  function stageLoad(job, components, stages) {
    const mjo = job.mother_jo || null;
    const out = {};
    const routedCount = (code) => components.filter((c) => Array.isArray(c.route) && c.route.length ? c.route.includes(code) : true).length;
    stages.forEach((s) => { out[s.stage_code] = { qty: routedCount(s.stage_code), unit: 'pieces', pieces: routedCount(s.stage_code) }; });
    if (!mjo) return out;
    const sv = mjo.services || {};
    const parts = mjo.parts || [];
    const partPieces = (p) => Math.max(1, parseInt(p.qty, 10) || (Array.isArray(p.barcodes) ? p.barcodes.length : 1));
    const piecesOn = (code) => parts.reduce((n, p) => n + ((p.route || []).includes(code) ? partPieces(p) : 0), 0);
    const share = (codes, total, code) => {
      const all = codes.reduce((n, c) => n + piecesOn(c), 0);
      return all ? total * piecesOn(code) / all : 0;
    };
    const set = (code, qty, unit) => { if (out[code]) { out[code].qty = Math.round(qty * 100) / 100; out[code].unit = unit; } };
    ['CUT', 'SCUT'].forEach((c) => set(c, share(['CUT', 'SCUT'], sv.cuttingLM || 0, c), 'lm'));
    ['EBA', 'EBB', 'MEB'].forEach((c) => set(c, share(['EBA', 'EBB', 'MEB'], sv.edgebandingLM || 0, c), 'lm'));
    const hplBoards = (mjo.boards || []).filter((b) => /\bhpl\b/i.test((b.material || '') + ' ' + (b.color || ''))).reduce((n, b) => n + (b.boardsNeeded || 0), 0);
    ['HPL', 'MHPL'].forEach((c) => set(c, share(['HPL', 'MHPL'], hplBoards, c), 'boards'));
    const grv = (sv.extraServicesByName || []).filter((x) => /groov/i.test(x.service || '')).reduce((n, x) => n + (Number(x.qty) || 0), 0);
    if (out.GRV) set('GRV', grv, 'lm');
    if (out.DRL) set('DRL', sv.holeCount || 0, 'holes');
    return out;
  }

  function addWorkDays(date, days, workdaysPerWeek) {
    const d = new Date(date.getTime());
    let left = days;
    while (left > 0) {
      d.setDate(d.getDate() + 1);
      const wd = d.getDay();
      if (wd === 0 || (workdaysPerWeek <= 5 && wd === 6)) continue;
      left -= 1;
    }
    return d;
  }
  function nextWorkDay(date, workdaysPerWeek) {
    const d = new Date(date.getTime());
    while (d.getDay() === 0 || (workdaysPerWeek <= 5 && d.getDay() === 6)) d.setDate(d.getDate() + 1);
    return d;
  }

  /* jobs: [{ job, stages:[{stage_code, sequence_index, status}], components, outputs }]
     capacity: { [stage_code]: { daily_capacity, unit, workdays_per_week } }
     Returns { rows:[{job_code, stage_code, load, unit, remaining, days, start, end, note}], byStage:{code:{days, jobs}} } */
  function forwardSchedule(jobs, capacity, startDate) {
    const start = nextWorkDay(startDate || new Date(), 6);
    const stageFree = {};   // stage_code -> next free date
    const rows = [], byStage = {};
    const ordered = jobs.slice().sort((a, b) => String(a.job.jo_approved_at || '').localeCompare(String(b.job.jo_approved_at || '')));
    ordered.forEach((j) => {
      const load = stageLoad(j.job, j.components, j.stages);
      let prevEnd = start;
      j.stages.slice().sort((a, b) => a.sequence_index - b.sequence_index).forEach((s) => {
        const l = load[s.stage_code] || { qty: 0, unit: 'pieces', pieces: 0 };
        const done = (j.outputs || []).filter((o) => o.stage_id === s.id && o.status === 'confirmed').reduce((n, o) => n + o.pieces, 0);
        const frac = l.pieces ? Math.min(1, done / l.pieces) : 0;
        const remaining = s.status === 'complete' ? 0 : Math.round(l.qty * (1 - frac) * 100) / 100;
        const cap = capacity[s.stage_code];
        const wk = (cap && cap.workdays_per_week) || 6;
        let days = 0, note = '';
        if (remaining <= 0) note = s.status === 'complete' ? 'done' : 'nothing to do';
        else if (!cap || !(cap.daily_capacity > 0)) note = 'no capacity set — not scheduled';
        else if (cap.unit !== l.unit) note = 'capacity is in ' + cap.unit + ', load is in ' + l.unit + ' — set capacity in ' + l.unit;
        else days = Math.max(1, Math.ceil(remaining / cap.daily_capacity));
        let st = null, en = null;
        if (days) {
          const free = stageFree[s.stage_code] || start;
          st = nextWorkDay(new Date(Math.max(free.getTime(), prevEnd.getTime())), wk);
          en = addWorkDays(st, days - 1, wk);
          stageFree[s.stage_code] = addWorkDays(en, 1, wk);
          prevEnd = stageFree[s.stage_code];
          byStage[s.stage_code] = byStage[s.stage_code] || { days: 0, jobs: 0 };
          byStage[s.stage_code].days += days; byStage[s.stage_code].jobs += 1;
        }
        rows.push({ job_code: j.job.job_code, job_id: j.job.id, stage_code: s.stage_code, load: l.qty, unit: l.unit, remaining, days, start: st, end: en, note });
      });
    });
    return { rows, byStage, start };
  }

  root.PmesSchedule = { stageLoad, forwardSchedule, addWorkDays, nextWorkDay };
})(typeof window !== 'undefined' ? window : globalThis);
if (typeof module !== 'undefined') module.exports = globalThis.PmesSchedule;
