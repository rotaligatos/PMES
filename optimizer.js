/* --------------------------- Board cutting optimizer (PMES) ---------------------------
   Re-runs the cut plan on the boards that actually arrived. Pure: no DOM, no network, tested by
   `node optimizer.test.js`, including against Modcraft's own guillotinePackBoards.

   It is Modcraft's packer (guillotine shelves = rip-cut strips across the board width, pieces
   crosscut along each strip; best-fit on existing strips, then a new strip on the fullest board,
   then a new board) with three differences:
     1. the boards are the REAL ones, opened up front, in inspection order; rejected boards are
        never offered;
     2. every marked defect is a no-cut zone — a piece may not overlap it. Along a strip the piece
        simply moves past the defect (one extra crosscut of waste), which keeps every cut guillotine;
     3. when the real boards run out it keeps going on clean "extra" boards and COUNTS them — that
        is the number of additional boards to request.
   With no defects and enough boards the result is identical to Modcraft's (checked by the test).
   --------------------------------------------------------------------------------------------- */
(function (root) {
  function groupKey(o) {
    return [o.material || 'Unknown', o.color || '', o.texture || '', +o.thickness || 0, +o.faces || 0].join('|');
  }
  function groupLabel(o) {
    return [o.material || 'Board', o.color || '', o.thickness ? o.thickness + 'mm' : '', o.faces ? o.faces + 'F' : ''].filter(Boolean).join(' ');
  }
  function hits(x, y, w, h, d) { return x < d.x + d.w && x + w > d.x && y < d.y + d.h && y + h > d.y; }
  // First y >= startY where a (w × h) piece at x clears every defect and still fits the board.
  function placeY(board, x, w, h, startY, kerf) {
    let y = startY;
    for (let guard = 0; guard < 500; guard++) {
      if (y + h + kerf > board.h) return -1;
      const d = board.defects.find((q) => hits(x, y, w + kerf, h + kerf, q));
      if (!d) return y;
      y = d.y + d.h;
    }
    return -1;
  }

  // Where a NEW strip for piece o can start on this board: at the next free width, moved sideways
  // past any defect that blocks it (one extra rip cut of waste). null when it cannot fit.
  function placeStrip(board, o, kerf) {
    let x = board.widthUsed;
    for (let guard = 0; guard < 200; guard++) {
      if (x + o.width + kerf > board.w) return null;
      const y = placeY(board, x, o.width, o.length, 0, kerf);
      if (y >= 0) return { x, y };
      const blockers = board.defects.filter((d) => x < d.x + d.w && x + o.width + kerf > d.x);
      if (!blockers.length) return null;
      x = Math.min(...blockers.map((d) => d.x + d.w).filter((e) => e > x));
      if (!isFinite(x)) return null;
    }
    return null;
  }

  /* pieces:  [{length, width, grain, ref, part}]
     boards:  [{no, w, h, defects:[{x,y,w,h}]}] — usable real boards (rejected already removed)
     extraW/extraH: size of a clean extra board. */
  function packOnBoards(pieces, boards, kerf, allowRotate, extraW, extraH) {
    const items = pieces.slice().sort((a, b) => b.width - a.width);
    const bs = boards.map((b) => ({ no: b.no, w: b.w, h: b.h, defects: b.defects || [], extra: false, widthUsed: 0, shelves: [], layout: [] }));
    let oversized = 0; const oversizedRefs = [];
    for (const p of items) {
      let orientations = [p];
      const grainLocked = p.grain === 'length' || p.grain === 'width';
      if (allowRotate && !grainLocked && p.length !== p.width) orientations.push({ length: p.width, width: p.length });
      const maxH = Math.max(extraH, ...bs.map((b) => b.h)), maxW = Math.max(extraW, ...bs.map((b) => b.w));
      orientations = orientations.filter((o) => o.length + kerf <= maxH && o.width + kerf <= maxW);
      if (!orientations.length) { oversized++; if (p.ref != null) oversizedRefs.push(p.ref); continue; }
      const place = (bd, x, y, o) => bd.layout.push({ x, y, w: o.width, h: o.length, rotated: o !== p, ref: p.ref, part: p.part });
      // 1. best fit on existing strips
      let choice = null;
      for (const o of orientations) bs.forEach((bd, bi) => bd.shelves.forEach((sh, si) => {
        if (sh.height < o.width + kerf) return;
        const y = placeY(bd, sh.xStart, o.width, o.length, sh.lenUsed, kerf);
        if (y < 0) return;
        const rem = bd.h - y;
        if (!choice || rem < choice.rem) choice = { bi, si, o, y, rem };
      }));
      if (choice) {
        const bd = bs[choice.bi], sh = bd.shelves[choice.si];
        place(bd, sh.xStart, choice.y, choice.o); sh.lenUsed = choice.y + choice.o.length + kerf; continue;
      }
      // 2. new strip on a board ALREADY IN USE, the one with the least width left afterwards
      //    (Modcraft only considers open boards here; an untouched board is opened in step 3).
      for (const o of orientations) bs.forEach((bd, bi) => {
        if (!bd.layout.length) return;
        const at = placeStrip(bd, o, kerf);
        if (!at) return;
        const left = bd.w - (at.x + o.width + kerf);
        if (!choice || left < choice.rem) choice = { bi, o, x: at.x, y: at.y, rem: left };
      });
      if (!choice) {
        // 3. open the next untouched real board, in inspection order (Modcraft: first allowed orientation)
        for (let bi = 0; bi < bs.length && !choice; bi++) {
          const bd = bs[bi]; if (bd.layout.length || bd.extra) continue;
          for (const o of orientations) { const at = placeStrip(bd, o, kerf); if (at) { choice = { bi, o, x: at.x, y: at.y }; break; } }
        }
      }
      if (choice) {
        const bd = bs[choice.bi];
        bd.shelves.push({ height: choice.o.width + kerf, lenUsed: choice.y + choice.o.length + kerf, xStart: choice.x });
        place(bd, choice.x, choice.y, choice.o); bd.widthUsed = choice.x + choice.o.width + kerf; continue;
      }
      // 4. an extra (clean) board
      const o3 = orientations.find((o) => o.length + kerf <= extraH && o.width + kerf <= extraW);
      if (!o3) { oversized++; if (p.ref != null) oversizedRefs.push(p.ref); continue; }
      const nb = { no: 'extra ' + (bs.filter((b) => b.extra).length + 1), w: extraW, h: extraH, defects: [], extra: true, widthUsed: o3.width + kerf,
        shelves: [{ height: o3.width + kerf, lenUsed: o3.length + kerf, xStart: 0 }], layout: [] };
      nb.layout.push({ x: 0, y: 0, w: o3.width, h: o3.length, rotated: o3 !== p, ref: p.ref, part: p.part });
      bs.push(nb);
    }
    const used = bs.filter((b) => b.layout.length);
    const pieceArea = (b) => b.layout.reduce((n, q) => n + q.w * q.h, 0);
    const usedArea = used.reduce((n, b) => n + pieceArea(b), 0), boardArea = used.reduce((n, b) => n + b.w * b.h, 0);
    return {
      boards: used.map((b) => ({ no: b.no, w: b.w, h: b.h, extra: b.extra, defects: b.defects, layout: b.layout,
        shelves: b.shelves.map((s) => ({ xStart: s.xStart, width: s.height - kerf })) })),
      realUsed: used.filter((b) => !b.extra).length,
      realUnused: bs.filter((b) => !b.extra && !b.layout.length).map((b) => b.no),
      extraNeeded: used.filter((b) => b.extra).length,
      utilization: boardArea ? usedArea / boardArea : 0,
      oversizedCount: oversized, oversizedRefs,
    };
  }

  /* The whole job: one run per board group of the mother JO.
     inspected: [{group_key, board_no, board_w, board_h, status, defects:[...]}] */
  function optimizeJob(mjo, inspected) {
    const parts = (mjo && mjo.parts) || [];
    return ((mjo && mjo.boards) || []).map((g) => {
      const key = groupKey(g), label = groupLabel(g);
      const pieces = [];
      parts.forEach((p) => {
        if (groupKey(p) !== key) return;
        const q = Math.max(1, parseInt(p.qty, 10) || 1);
        for (let i = 0; i < q; i++) pieces.push({ length: +p.cutL || +p.L || 0, width: +p.cutW || +p.W || 0, grain: p.grain || '', ref: p.ref, part: p.p });
      });
      const mine = (inspected || []).filter((b) => b.group_key === key).sort((a, b) => a.board_no - b.board_no);
      const rejected = mine.filter((b) => b.status === 'rejected');
      const usable = mine.filter((b) => b.status !== 'rejected');
      // Not inspected yet: assume the boards the JO planned, clean, and say so.
      const assumed = !mine.length;
      const boards = assumed
        ? Array.from({ length: g.boardsNeeded || 0 }, (_, i) => ({ no: i + 1, w: g.boardW, h: g.boardH, defects: [] }))
        : usable.map((b) => ({ no: b.board_no, w: +b.board_w, h: +b.board_h, defects: (b.defects || []).map((d) => ({ x: +d.x, y: +d.y, w: +d.w, h: +d.h, type: d.defect_type || d.type })) }));
      const r = packOnBoards(pieces, boards, +g.kerf || 0, !!g.allowRotate, g.boardW, g.boardH);
      return Object.assign(r, { group_key: key, label, boardW: g.boardW, boardH: g.boardH, kerf: +g.kerf || 0, allowRotate: !!g.allowRotate,
        planned: g.boardsNeeded || 0, received: mine.length, rejected: rejected.map((b) => b.board_no), assumedClean: assumed,
        defectCount: usable.reduce((n, b) => n + ((b.defects || []).length), 0), pieces: pieces.length });
    });
  }

  root.PmesOptimizer = { groupKey, groupLabel, packOnBoards, optimizeJob, placeY };
})(typeof window !== 'undefined' ? window : globalThis);
if (typeof module !== 'undefined') module.exports = globalThis.PmesOptimizer;
