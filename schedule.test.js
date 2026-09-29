// node schedule.test.js — pure checks on the Piece 3 scheduler. No network, no DOM.
const S = require('./schedule.js');
let fails = 0; const ok = (c, m) => { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fails++; };

const stages = ['CUT', 'EBA', 'DRL', 'ASM', 'QC', 'PACK'].map((c, i) => ({ id: 's' + c, stage_code: c, sequence_index: i, status: 'not_started' }));
const parts = [
  { p: 1, qty: 10, route: ['CUT', 'EBA', 'DRL', 'ASM', 'QC', 'PACK'] },
  { p: 2, qty: 10, route: ['CUT', 'EBA', 'ASM', 'QC', 'PACK'] },
];
const comps = [];
parts.forEach((p) => { for (let i = 0; i < p.qty; i++) comps.push({ route: p.route }); });
const job = { id: 'j1', job_code: 'JO-1', jo_approved_at: '2026-09-26T01:00:00Z',
  mother_jo: { parts, boards: [], services: { cuttingLM: 120, edgebandingLM: 90, holeCount: 40, extraServicesByName: [] } } };

const load = S.stageLoad(job, comps, stages);
ok(load.CUT.qty === 120 && load.CUT.unit === 'lm', 'cutting load = the JO cutting lm');
ok(load.EBA.qty === 90 && load.EBA.unit === 'lm', 'edge-banding load = the JO edgebanding lm');
ok(load.DRL.qty === 40 && load.DRL.unit === 'holes' && load.DRL.pieces === 10, 'drilling load = holes, only the 10 drilled pieces count');
ok(load.ASM.qty === 20 && load.ASM.unit === 'pieces', 'assembly load = pieces');

const cap = { CUT: { daily_capacity: 60, unit: 'lm', workdays_per_week: 6 }, EBA: { daily_capacity: 45, unit: 'lm', workdays_per_week: 6 },
  DRL: { daily_capacity: 40, unit: 'holes', workdays_per_week: 6 }, ASM: { daily_capacity: 10, unit: 'pieces', workdays_per_week: 6 } };
const mon = new Date(2026, 8, 28); // Monday
const r = S.forwardSchedule([{ job, stages, components: comps, outputs: [] }], cap, mon);
const row = (c) => r.rows.find((x) => x.stage_code === c);
ok(row('CUT').days === 2 && row('CUT').start.getDate() === 28 && row('CUT').end.getDate() === 29, 'CUT 120 lm at 60/day = 2 days, Mon–Tue');
ok(row('EBA').days === 2 && row('EBA').start.getDate() === 28 && row('EBA').end.getDate() === 29, 'EBA starts the day CUT starts (Mon), finishes Tue');
ok(row('DRL').start.getDate() === 28 && row('DRL').end.getDate() === 29, 'DRL needs 1 day of capacity but cannot finish before EBA (Tue)');
ok(row('ASM').start.getDate() === 28 && row('ASM').end.getDate() === 29, 'ASM runs alongside, Mon–Tue');
const rS = S.forwardSchedule([{ job, stages: stages.filter((x) => x.stage_code === 'ASM'), components: comps, outputs: [] }], cap, new Date(2026, 9, 3));
ok(rS.rows[0].start.getDate() === 3 && rS.rows[0].end.getDate() === 5, 'ASM from Sat 3: Sat then Mon 5 — Sunday skipped');
ok(row('QC').days === 0 && /no capacity/.test(row('QC').note), 'a process with no capacity is reported, not silently scheduled');

// two jobs on one process: the second waits for the first
const job2 = Object.assign({}, job, { id: 'j2', job_code: 'JO-2', jo_approved_at: '2026-09-26T02:00:00Z' });
const r2 = S.forwardSchedule([{ job: job2, stages, components: comps, outputs: [] }, { job, stages, components: comps, outputs: [] }], cap, mon);
const cut1 = r2.rows.find((x) => x.job_code === 'JO-1' && x.stage_code === 'CUT'), cut2 = r2.rows.find((x) => x.job_code === 'JO-2' && x.stage_code === 'CUT');
ok(cut1.start.getDate() === 28 && cut2.start.getDate() === 30, 'earlier-approved job goes first; the next waits for the saw');

// confirmed output shortens what is left
const outputs = [{ stage_id: 'sCUT', status: 'confirmed', pieces: 10 }];
const r3 = S.forwardSchedule([{ job, stages, components: comps, outputs }], cap, mon);
ok(r3.rows.find((x) => x.stage_code === 'CUT').remaining === 60 && r3.rows.find((x) => x.stage_code === 'CUT').days === 1, '10 of 20 pieces cut -> half the lm left -> 1 day');

// unit mismatch is refused loudly
const r4 = S.forwardSchedule([{ job, stages, components: comps, outputs: [] }], { CUT: { daily_capacity: 100, unit: 'pieces', workdays_per_week: 6 } }, mon);
ok(/capacity is in pieces/.test(r4.rows.find((x) => x.stage_code === 'CUT').note), 'capacity in the wrong unit is named, not divided');

// 5-day week skips Saturday
const r5 = S.forwardSchedule([{ job, stages, components: comps, outputs: [] }], { ASM: { daily_capacity: 10, unit: 'pieces', workdays_per_week: 5 } }, new Date(2026, 9, 2));
ok(r5.rows.find((x) => x.stage_code === 'ASM').end.getDate() === 5, 'ASM from Fri 2 Oct on a 5-day week ends Mon 5 (Sat+Sun skipped)');

// a hand-made job (no mother JO) is loaded in pieces everywhere
const plain = S.stageLoad({ id: 'x', job_code: 'X' }, comps, stages);
ok(plain.CUT.qty === 20 && plain.CUT.unit === 'pieces', 'no mother JO -> pieces on every process');


// work calendar (2026-09-28): shifts per day vary; holidays / rest days are off unless approved
const cap3 = { CUT: { daily_capacity: 60, unit: 'lm', shifts_per_day: 1, workdays_per_week: 6 } };
const cal = (d) => { const k = d.getDate(); if (d.getMonth() === 8 && k === 28) return { working: true, shifts: 3 }; if (k === 29) return { working: false, shifts: 1 }; return { working: d.getDay() !== 0, shifts: 1 }; };
const jobCut = Object.assign({}, job, { mother_jo: Object.assign({}, job.mother_jo, { services: { cuttingLM: 240, edgebandingLM: 0, holeCount: 0, extraServicesByName: [] } }) });
const r6 = S.forwardSchedule([{ job: jobCut, stages: stages.slice(0, 1), components: comps, outputs: [] }], cap3, mon, { dayInfo: cal });
const c6 = r6.rows[0];
ok(c6.days === 2 && c6.start.getDate() === 28 && c6.end.getDate() === 30, '240 lm: Mon 3 shifts (180) + Tue off (holiday) + Wed 60 = ends Wed 30');
const r7 = S.forwardSchedule([{ job: jobCut, stages: stages.slice(0, 1), components: comps, outputs: [], doneByStage: { CUT: 20 } }], cap3, mon, { dayInfo: cal });
ok(r7.rows[0].remaining === 0, 'pieces ticked done (doneByStage) replace confirmed output');

// 2026-09-29: a day fills up to capacity — the next Job Order uses what the previous one left that day
const jobA = Object.assign({}, job, { id: 'ja', job_code: 'JO-A', jo_approved_at: '2026-09-26T01:00:00Z', mother_jo: Object.assign({}, job.mother_jo, { services: { cuttingLM: 90, edgebandingLM: 0, holeCount: 0, extraServicesByName: [] } }) });
const jobB = Object.assign({}, jobA, { id: 'jb', job_code: 'JO-B', jo_approved_at: '2026-09-26T02:00:00Z' });
const r8 = S.forwardSchedule([{ job: jobA, stages: stages.slice(0, 1), components: comps, outputs: [] }, { job: jobB, stages: stages.slice(0, 1), components: comps, outputs: [] }], cap, mon);
const a8 = r8.rows.find((x) => x.job_code === 'JO-A'), b8 = r8.rows.find((x) => x.job_code === 'JO-B');
ok(a8.start.getDate() === 28 && a8.end.getDate() === 29, 'JO-A 90 lm at 60/day: Mon full + half of Tue');
ok(b8.start.getDate() === 29 && b8.end.getDate() === 30, 'JO-B takes the other half of Tue, finishes Wed (90 = 30 + 60)');
const cap2s = { CUT: { daily_capacity: 60, unit: 'lm', shifts_per_day: 1, workdays_per_week: 6 } };
const two = (d) => ({ working: d.getDay() !== 0, shifts: 2 });
const r9 = S.forwardSchedule([{ job: jobA, stages: stages.slice(0, 1), components: comps, outputs: [] }, { job: jobB, stages: stages.slice(0, 1), components: comps, outputs: [] }], cap2s, mon, { dayInfo: two });
ok(r9.rows[0].end.getDate() === 28 && r9.rows[1].start.getDate() === 28 && r9.rows[1].end.getDate() === 29, 'two shifts = 120 lm/day: JO-A done Mon, JO-B uses Mon\'s spare 30 then 60 on Tue');
// lamination: 24-hour cure before the next process, only on lamination's first day
const lamStages = ['CUT', 'HPL', 'CURE', 'DRL'].map((c, i) => ({ id: 's' + c, stage_code: c, sequence_index: i, status: 'not_started' }));
const capL = { CUT: { daily_capacity: 1000, unit: 'pieces', workdays_per_week: 6 }, HPL: { daily_capacity: 10, unit: 'pieces', workdays_per_week: 6 }, DRL: { daily_capacity: 1000, unit: 'pieces', workdays_per_week: 6 } };
const rL = S.forwardSchedule([{ job: { id: 'jl', job_code: 'JO-L' }, stages: lamStages, components: Array.from({ length: 20 }, () => ({ route: [] })), outputs: [] }], capL, mon);
const L = (c) => rL.rows.find((x) => x.stage_code === c);
ok(L('HPL').start.getDate() === 28 && L('HPL').end.getDate() === 29, 'HPL 20 pieces at 10/day: Mon–Tue');
ok(L('CURE').days === 0 && /24-hour/.test(L('CURE').note), 'CURE takes no days of its own');
ok(L('DRL').start.getDate() === 29, 'after lamination: next process starts the day after lamination\'s FIRST day (Tue), not after it ends');
ok(L('DRL').end.getDate() === 30, '…and finishes no earlier than the day after lamination\'s last day (Wed)');
console.log(fails ? fails + ' FAILED' : 'All passed'); process.exit(fails ? 1 : 0);
