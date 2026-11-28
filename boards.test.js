// node boards.test.js — pure checks on QA board inspection for boards received through the Material request
// (screens-boards.js, 2026-11-28). No network, no DOM. Loads the real functions out of screens-boards.js,
// so it always tests what ships.
const fs = require('fs');
const path = require('path');
let fails = 0; const ok = (c, m) => { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fails++; };

// ---- load the board functions from the browser file
const src = fs.readFileSync(path.join(__dirname, 'screens-boards.js'), 'utf8');
const from = src.indexOf('function _bdGroups(job)'), to = src.indexOf('async function renderBoardsCards');
if (from < 0 || to < 0) { console.log('  FAIL could not find the board functions in screens-boards.js'); process.exit(1); }
global.State = {};
global.PmesOptimizer = { groupKey: (g) => g.material + '|' + g.thickness, groupLabel: (g) => g.material + ' ' + g.thickness + 'mm' };
const B = new Function(src.slice(from, to) + '\nreturn { _bdGroups, _bdLineSize, _bdIsBoardLine, _bdMatGroups, _bdInspectGroups, _bdHasInspect };')();

// ---- the real 14 received lines on JO-261023-65BB (adm_mr_lines, 2026-11-28)
const L65 = [
  ['Adjustable plinth100mm black (scanwolf)', 'set', 'hardware', 6],
  ['Marine plywood 6mm 4x8', 'pc', 'outsource_material', 5],
  ['Chipboard screw 4mmx30mm', 'pc', 'hardware', 120],
  ['Hi-lo Screw 8mmx50mm 2"', 'pc', 'hardware', 122],
  ['Hydraulic steel hinges full ( Sistema 32) ) (lexton)', 'pc', 'hardware', 44],
  ['Metal pegs ( iron shelf support )', 'pc', 'hardware', 44],
  ['Minifix screw (white) set', 'set', 'hardware', 204],
  ['Sw 821 suspension bracket (scanwolf)', 'set', 'hardware', 5],
  ['Wood Screw 4mm x 12mm', 'pc', 'hardware', 230],
  ['[SDP] Real White MDF 4x8 2F (18mm, Stipple)', 'pc', 'material', 6],
  ['[SDP] Real White MDF 4x8 2F (6mm, Stipple)', 'pc', 'material', 1.1],
  ['18mm Versaboard White', 'pc', 'material', 0.7],
  ['DuraSave Plywood 2F Real White 18mm', 'pc', 'material', 6.5],
  ['Real White 1mmx22mm Matte PVC Premium Edgeband', 'lm', 'material', 217],
];
const mrs = (rows, withCategory) => [{ mr_no: 'MR-261023-TEST', lines: rows.map(([item, unit, category, received], i) =>
  Object.assign({ id: 'L' + i, item, unit, received }, withCategory ? { category } : {})) }];

console.log('Which received lines are boards (JO-261023-65BB, by name only — category not sent)');
State.jobMRs = mrs(L65, false);
let g = B._bdMatGroups();
const names = g.map((x) => x.label.replace(' (MR-261023-TEST)', ''));
ok(g.length === 5, 'exactly 5 board lines found out of 14 (got ' + g.length + ')');
['Marine plywood 6mm 4x8', '[SDP] Real White MDF 4x8 2F (18mm, Stipple)', '[SDP] Real White MDF 4x8 2F (6mm, Stipple)',
  '18mm Versaboard White', 'DuraSave Plywood 2F Real White 18mm'].forEach((n) => ok(names.includes(n), 'board: ' + n));
['Chipboard screw', 'Wood Screw', 'Hi-lo Screw', 'hinges', 'Metal pegs', 'Minifix', 'bracket', 'plinth', 'Edgeband'].forEach((n) =>
  ok(!names.some((x) => x.toLowerCase().includes(n.toLowerCase())), 'not a board: ' + n));

console.log('Board count = received, rounded up');
const cnt = (n) => g.find((x) => x.label.startsWith(n)).g.boardsNeeded;
ok(cnt('Marine plywood') === 5, '5 received → 5 boards');
ok(cnt('[SDP] Real White MDF 4x8 2F (6mm') === 2, '1.1 received → 2 boards (one partly used)');
ok(cnt('18mm Versaboard') === 1, '0.7 received → 1 board');
ok(cnt('DuraSave') === 7, '6.5 received → 7 boards');
ok(g.every((x) => x.key.startsWith('mr:') && x.fromMr), "group key is 'mr:<line id>' — never clashes with Job Order group keys");

console.log('Same result when the category is sent (after the pmes_job_mrs change)');
State.jobMRs = mrs(L65, true);
ok(B._bdMatGroups().length === 5, 'still exactly 5 boards');
ok(!B._bdIsBoardLine({ item: 'Plywood 4x8 offcut bundle', unit: 'pc', category: 'hardware' }), 'a hardware-category line is never a board, whatever the name');
ok(B._bdIsBoardLine({ item: 'Marine plywood 6mm 4x8', unit: 'pc', category: 'outsource_material' }), 'outsource_material counts as material');

console.log('Board size from the item name');
const sz = (t) => B._bdLineSize(t).join('x');
ok(sz('Marine plywood 6mm 4x8') === '1220x2440', '4x8 → 1220×2440mm');
ok(sz('MDF 18mm 4x10') === '1220x3050', '4x10 → 1220×3050mm');
ok(sz('Plywood 3x6') === '915x1830', '3x6 → 915×1830mm');
ok(sz('HPL board 1220x2440mm') === '1220x2440', 'size in mm is read as is');
ok(sz('Board 2440 x 1220') === '1220x2440', 'mm size written length-first is turned the right way');
ok(sz('18mm Versaboard White') === '1220x2440', 'no size in the name → standard 1220×2440');
ok(sz('Wood Screw 4mm x 12mm') === '1220x2440' && !B._bdIsBoardLine({ item: 'Wood Screw 4mm x 12mm', unit: 'pc' }), '"4mm x 12mm" on a screw is not taken as a board');

console.log('Edge cases');
ok(!B._bdIsBoardLine({ item: 'MDF 18mm 4x8', unit: 'lm' }), 'unit lm (edgeband, trims) is never a board');
ok(B._bdIsBoardLine({ item: 'MDF 18mm 4x8', unit: 'Sheets' }), 'unit "Sheets" counts (case ignored)');
State.jobMRs = [{ mr_no: 'MR-X', lines: [{ id: 'a', item: 'MDF 18mm 4x8', unit: 'pc', received: 0 }, { id: 'b', item: 'MDF 6mm 4x8', unit: 'pc', received: null }] }];
ok(B._bdMatGroups().length === 0, 'lines not received yet are not shown');
State.jobMRs = undefined;
ok(B._bdMatGroups().length === 0, 'no material requests loaded → no groups, no error');

console.log('Job Order layout wins; the optimizer is untouched');
const joJob = { mother_jo: { boards: [{ material: 'PB', thickness: 18, boardW: 1220, boardH: 2440, boardsNeeded: 18 }, { material: 'PB', thickness: 6, boardW: 1220, boardH: 2440, boardsNeeded: 5 }] } };
State.jobMRs = mrs(L65, false);
ok(B._bdInspectGroups(joJob).length === 2 && !B._bdInspectGroups(joJob).some((x) => x.fromMr), 'job with a Modcraft layout (like X00000006) inspects its Job Order boards, not the MR lines');
ok(B._bdGroups({ mother_jo: null }).length === 0, 'optimizer groups stay empty for a job with no layout — the optimizer never sees MR boards');
ok(B._bdInspectGroups({ mother_jo: null }).length === 5 && B._bdHasInspect({ mother_jo: null }), 'job with no layout (like 65BB) inspects its received board lines');
State.jobMRs = mrs(L65.filter((r) => r[2] === 'hardware'), false);
ok(!B._bdHasInspect({ mother_jo: null }), 'job with only hardware → no board map (the QA tab shows the "No boards to map yet" note)');

console.log('QA tab wiring (screens-job-detail.js)');
const jd = fs.readFileSync(path.join(__dirname, 'screens-job-detail.js'), 'utf8');
const qa = jd.slice(jd.indexOf("else if (t === 'qa_in')"), jd.indexOf("else if (t === 'review')"));
ok(/_bdHasInspect\(job\)\)\s*renderBoardsCards\(job, document\.getElementById\('boardsBlock'\), 'inspect'\)/.test(qa), 'QA inspection tab draws the board map whenever there are boards to inspect');
ok(/No boards to map yet/.test(qa), 'QA inspection tab says why when there are none');

console.log(fails ? `\n${fails} FAILED` : '\nAll board inspection checks passed.');
process.exit(fails ? 1 : 0);
