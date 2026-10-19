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
  // Modcraft's packer is the single pass (_guillotinePackOnce) plus the "try several orders"
  // wrapper (guillotinePackBoards). Both are compared: one pass vs one pass, best vs best.
  let start = src.indexOf('function _guillotinePackOnce(');
  if (start < 0) start = src.indexOf('function guillotinePackBoards(');
  const end = src.indexOf('\nfunction prodComputeBom(', start);
  const lib = new Function(src.slice(start, end) + '\nreturn {gpb:guillotinePackBoards, once:(typeof _guillotinePackOnce==="function"?_guillotinePackOnce:null)};')();
  const gpb = lib.once ? (a, b, c, d, e) => lib.once(a, b, c, d, e, 'width') : lib.gpb;
  const pcs = []; let r = 1;
  [[600, 400, 6], [900, 300, 4], [720, 560, 5], [1800, 580, 3], [400, 400, 8], [2100, 600, 2]].forEach(([l, w, q]) => { for (let i = 0; i < q; i++) pcs.push({ length: l, width: w, ref: r++, grain: i % 2 ? 'length' : '' }); });
  [false, true].forEach((rot) => {
    const m = gpb(pcs, 1220, 2440, 3, rot);
    const p = O.packOnBoards(pcs, Array.from({ length: 20 }, (_, i) => ({ no: i + 1, w: 1220, h: 2440, defects: [] })), 3, rot, 1220, 2440);
    const norm = (lay) => JSON.stringify(lay.map((b) => b.map((q) => [q.x, q.y, q.w, q.h, q.ref])));
    ok(p.realUsed === m.boardsNeeded && norm(p.boards.map((b) => b.layout)) === norm(m.layout), 'same boards and same placements as Modcraft (rotation ' + (rot ? 'on' : 'off') + ', ' + m.boardsNeeded + ' boards)');
    if (lib.once) {
      const mb = lib.gpb(pcs, 1220, 2440, 3, rot);
      const pb = O.packBest(pcs, Array.from({ length: 20 }, (_, i) => ({ no: i + 1, w: 1220, h: 2440, defects: [] })), 3, rot, 1220, 2440);
      // Modcraft also tries three-stage plans (first cut either way, pieces side by side) that PMES's
      // defect-aware packer does not make, so its best can only be as good or better.
      ok(mb.boardsNeeded <= pb.realUsed, 'Modcraft\'s best never needs more boards than PMES\'s (rotation ' + (rot ? 'on' : 'off') + ': Modcraft ' + mb.boardsNeeded + ', PMES ' + pb.realUsed + ', ' + mb.strategy + ')');
    }
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

// 4. Three-stage re-plan around defects (2026-10-17), in step with Modcraft: first cut either way,
//    pieces side by side in a segment, a defect never cut into, woodgrain never turned.
{
  const hit = (q, d) => q.x < d.x + d.w && d.x < q.x + q.w && q.y < d.y + d.h && d.y < q.y + q.h;
  // A 700-wide piece opens a strip; two 340-wide pieces share one segment, side by side.
  const side = O.pack3OnBoards([{ length: 300, width: 700, ref: 0 }, { length: 300, width: 340, ref: 1 }, { length: 300, width: 340, ref: 2 }],
    [{ no: 1, w: 1220, h: 2440, defects: [] }], 3, false, 1220, 2440, 'width', 'L');
  const seg = side.boards[0].plan.strips[0].segs.find((g) => g.pieces.length === 2);
  ok(side.realUsed === 1 && !!seg && side.boards[0].layout[seg.pieces[1]].x === 343, 'three-stage: two pieces side by side in one segment');
  // Random jobs on boards with random defects, both directions, rotation on: never on a defect, never
  // overlapping, locked grain never turned, every piece placed or reported, plan lists every piece.
  let seed = 21, bad = 0, oldN = 0, newN = 0, worse = 0;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let j = 0; j < 80; j++) {
    const pcs = []; for (let k = 0; k < 10 + Math.floor(rnd() * 40); k++) pcs.push({ length: 60 + Math.round(rnd() * 2000), width: 40 + Math.round(rnd() * 900), grain: rnd() < 0.5 ? 'length' : '', ref: k });
    const bds = []; for (let n = 0; n < 1 + Math.floor(rnd() * 5); n++) { const df = []; for (let d = 0; d < Math.floor(rnd() * 3); d++) df.push({ x: Math.round(rnd() * 1100), y: Math.round(rnd() * 2300), w: 20 + Math.round(rnd() * 300), h: 20 + Math.round(rnd() * 300) }); bds.push({ no: n + 1, w: 1220, h: 2440, defects: df }); }
    ['L', 'W'].forEach((dir) => {
      const r = O.pack3OnBoards(pcs, bds, 3, true, 1220, 2440, 'area', dir); let placed = 0;
      r.boards.forEach((bd) => {
        bd.layout.forEach((q, i) => { placed++; const p = pcs[q.ref];
          if (q.x < 0 || q.y < 0 || q.x + q.w > bd.w || q.y + q.h > bd.h) bad++;
          if (p.grain === 'length' && (q.h !== p.length || q.w !== p.width)) bad++;
          if ((bd.defects || []).some((d) => hit(q, d))) bad++;
          if (bd.layout.some((o, k) => k > i && hit(q, o))) bad++; });
        if (bd.plan.strips.reduce((n, t) => n + t.segs.reduce((u, g) => u + g.pieces.length, 0), 0) !== bd.layout.length) bad++;
      });
      if (placed + r.oversizedCount !== pcs.length) bad++;
    });
    const o = O.packOnBoards(pcs, bds, 3, true, 1220, 2440, 'width'), bst = O.packBest(pcs, bds, 3, true, 1220, 2440);
    oldN += o.realUsed + o.extraNeeded; newN += bst.realUsed + bst.extraNeeded; if (bst.realUsed + bst.extraNeeded > o.realUsed + o.extraNeeded) worse++;
  }
  ok(bad === 0, 'three-stage around defects: no defect cut into, no overlap, grain kept, nothing lost (160 random layouts)');
  ok(worse === 0 && newN <= oldN, 'best plan never needs more boards than the single strip pass (' + oldN + ' → ' + newN + ')');
}

// Remakes into offcuts: one strip of 600 wide leaves a 617-wide offcut beside it (1220 - 600 - 3).
{
  const offs = O.offcuts(1220, 2440, [{ x: 0, y: 0, w: 600, h: 2000 }], 3);
  ok(offs.some((o) => o.x === 603 && o.w === 617 && o.h === 2440) && offs.some((o) => o.y === 2003 && o.h === 437), 'offcuts: beside and below a piece, minus the kerf');
  const groups = [{ label3: 'PB white 18mm', boardW: 1220, boardH: 2440, kerf: 3, allowRotate: true, boards: [{ no: 1, layout: [{ x: 0, y: 0, w: 600, h: 2440 }], defects: [] }] }];
  const r = O.fitRemakes(groups, [{ id: 'c1', rejectId: 'r1', label3: 'PB white 18mm', boardNo: 1, L: 2000, W: 500, grain: 'length', part: 'P9' }]);
  const pc = r.placed[0];
  ok(r.placed.length === 1 && pc.x >= 603 && pc.w === 500 && pc.h === 2000, 'remake placed in the offcut, grain along the length');
  ok(r.groups[0].boards[0].layout.some((p) => p.remake && p.componentId === 'c1') && groups[0].boards[0].layout.length === 1, 'remake highlighted in the revised plan; original plan untouched');
  const lay = r.groups[0].boards[0].layout; ok(!lay.some((a, i) => lay.some((b, j) => i < j && overlaps(a, b))), 'no overlap with planned pieces');
  const r2 = O.fitRemakes(groups, [{ id: 'c2', label3: 'PB white 18mm', L: 2440, W: 700, grain: 'length' }]);
  ok(r2.placed.length === 0 && r2.unplaced.length === 1, 'too big for any offcut → reported, so extra boards can be requested');
  const r3 = O.fitRemakes([{ label3: 'X', boardW: 1220, boardH: 2440, kerf: 3, boards: [{ no: 1, layout: [{ x: 0, y: 0, w: 600, h: 2440 }], defects: [{ x: 700, y: 0, w: 100, h: 2440 }] }] }],
    [{ id: 'c3', label3: 'X', L: 2000, W: 500, grain: 'length' }]);
  ok(r3.placed.length === 0, 'a defect splitting the offcut is never cut into');
  const r4 = O.fitRemakes(groups, [{ id: 'c4', label3: 'PB white 18mm', L: 500, W: 1000, grain: 'none' }]);
  ok(r4.placed.length === 1 && r4.placed[0].w <= 617, 'plain board: remake turned to fit');
}

console.log(fails ? fails + ' FAILED' : 'All passed'); process.exit(fails ? 1 : 0);
