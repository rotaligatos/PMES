// node optimizer.test.js — the PMES optimizer, including a fidelity check against Modcraft's own
// guillotinePackBoards (read straight out of ../../Modcraft/index.html when it is present).
const fs = require('fs'), path = require('path');
const O = require('./optimizer.js');
let fails = 0; const ok = (c, m) => { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fails++; };
const overlaps = (a, d) => a.x < d.x + d.w && a.x + a.w > d.x && a.y < d.y + d.h && a.y + a.h > d.y;

// 1. Fidelity: no defects + enough boards = Modcraft's result, piece for piece.
const mc = path.resolve(__dirname, '../../Modcraft/index.html');
if (fs.existsSync(mc)) {
  const src = fs.readFileSync(mc, 'utf8');
  const start = src.indexOf('function guillotinePackBoards(');
  const end = src.indexOf('\nfunction prodComputeBom(', start);
  const gpb = new Function(src.slice(start, end) + '\nreturn guillotinePackBoards;')();
  const pcs = []; let r = 1;
  [[600, 400, 6], [900, 300, 4], [720, 560, 5], [1800, 580, 3], [400, 400, 8], [2100, 600, 2]].forEach(([l, w, q]) => { for (let i = 0; i < q; i++) pcs.push({ length: l, width: w, ref: r++, grain: i % 2 ? 'length' : '' }); });
  [false, true].forEach((rot) => {
    const m = gpb(pcs, 1220, 2440, 3, rot);
    const p = O.packOnBoards(pcs, Array.from({ length: 20 }, (_, i) => ({ no: i + 1, w: 1220, h: 2440, defects: [] })), 3, rot, 1220, 2440);
    const norm = (lay) => JSON.stringify(lay.map((b) => b.map((q) => [q.x, q.y, q.w, q.h, q.ref])));
    ok(p.realUsed === m.boardsNeeded && norm(p.boards.map((b) => b.layout)) === norm(m.layout), 'same boards and same placements as Modcraft (rotation ' + (rot ? 'on' : 'off') + ', ' + m.boardsNeeded + ' boards)');
  });
} else console.log('  (Modcraft index.html not found beside PMES — fidelity check skipped)');

// 2. A defect is never cut into.
const defect = { x: 0, y: 1000, w: 1220, h: 200 };  // a band across the whole board
const pcs2 = Array.from({ length: 8 }, (_, i) => ({ length: 600, width: 600, ref: i }));
const r2 = O.packOnBoards(pcs2, [{ no: 1, w: 1220, h: 2440, defects: [defect] }], 3, false, 1220, 2440);
const all2 = r2.boards.filter((b) => !b.extra).flatMap((b) => b.layout);
ok(all2.length > 0 && all2.every((q) => !overlaps(q, defect)), 'no piece overlaps the defect band (' + all2.length + ' pieces on the real board)');
ok(all2.some((q) => q.y >= 1200), 'pieces continue after the defect on the same strip');
ok(r2.extraNeeded === 1 && r2.boards.length === 2, 'the pieces that no longer fit go on 1 extra board');
const clean = O.packOnBoards(pcs2, [{ no: 1, w: 1220, h: 2440, defects: [] }], 3, false, 1220, 2440);
ok(clean.extraNeeded === 0, 'without the defect the same 8 pieces fit one board');

// 3. The job: rejected boards are left out; shortfall counted; not-inspected groups assumed clean.
const mjo = { boards: [{ material: 'PB', color: 'White', thickness: 18, faces: 2, boardW: 1220, boardH: 2440, kerf: 3, allowRotate: false, boardsNeeded: 2 },
                       { material: 'MDF', color: 'Oak', thickness: 18, faces: 2, boardW: 1220, boardH: 2440, kerf: 3, allowRotate: false, boardsNeeded: 1 }],
  parts: [{ p: 'P1', ref: 0, material: 'PB', color: 'White', thickness: 18, faces: 2, cutL: 2400, cutW: 580, qty: 4 },
          { p: 'P2', ref: 1, material: 'MDF', color: 'Oak', thickness: 18, faces: 2, cutL: 700, cutW: 500, qty: 2 }] };
const key = O.groupKey(mjo.boards[0]);
const insp = [{ group_key: key, board_no: 1, board_w: 1220, board_h: 2440, status: 'defect', defects: [{ x: 0, y: 0, w: 100, h: 100, defect_type: 'chip' }] },
              { group_key: key, board_no: 2, board_w: 1220, board_h: 2440, status: 'rejected', defects: [] }];
const job = O.optimizeJob(mjo, insp);
ok(job[0].rejected.length === 1 && job[0].boards.every((b) => b.no !== 2), 'the rejected board is never used');
// 2400-long pieces cannot start below a 100mm corner chip, so the first strip moves right of it
// (x=100); the second strip no longer fits (100+583+583 > 1220): 1 piece on board 1, 3 left = 2 extra.
ok(job[0].realUsed === 1 && job[0].extraNeeded === 2 && job[0].boards[0].layout[0].x === 100, 'PB: corner chip pushes the strip sideways — 1 piece on board 1, 2 extra boards');
ok(job[0].boards.filter((b) => !b.extra).flatMap((b) => b.layout).every((q) => !overlaps(q, { x: 0, y: 0, w: 100, h: 100 })), 'the corner chip is avoided');
ok(job[1].assumedClean && job[1].extraNeeded === 0 && job[1].realUsed === 1, 'MDF not inspected: assumed as planned, fits');

console.log(fails ? fails + ' FAILED' : 'All passed'); process.exit(fails ? 1 : 0);
