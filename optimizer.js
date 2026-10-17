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
   2026-10-17: packBest also tries the three-stage pass (pack3OnBoards) both ways — first cut along
   the length or across the width, pieces side by side in a segment — as Modcraft now does, and keeps
   the best. Pieces turn only where the Job Order gives no grain (a plain board).
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
  // Piece orders tried — kept in step with Modcraft's _GPACK_ORDERS (2026-10-17). "width" is the
  // original single pass and runs first, so a tie keeps the layout it gave before.
  const ORDERS = {
    width: (a, b) => b.width - a.width,
    length: (a, b) => (b.length - a.length) || (b.width - a.width),
    area: (a, b) => (b.length * b.width - a.length * a.width) || (b.width - a.width),
    perim: (a, b) => ((b.length + b.width) - (a.length + a.width)) || (b.width - a.width),
    side: (a, b) => (Math.max(b.length, b.width) - Math.max(a.length, a.width)) || (b.width - a.width),
  };
  function packOnBoards(pieces, boards, kerf, allowRotate, extraW, extraH, order) {
    const items = pieces.slice().sort(ORDERS[order] || ORDERS.width);
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
        shelves: b.shelves.map((s) => ({ xStart: s.xStart, width: s.height - kerf })),
        plan: { dir: 'L', strips: b.shelves.map((s) => ({ off: s.xStart, size: s.height - kerf,
          segs: b.layout.map((q, i) => ({ q, i })).filter((x) => x.q.x === s.xStart).sort((a, c) => a.q.y - c.q.y).map((x) => ({ off: x.q.y, len: x.q.h, pieces: [x.i] })) })) } })),
      realUsed: used.filter((b) => !b.extra).length,
      realUnused: bs.filter((b) => !b.extra && !b.layout.length).map((b) => b.no),
      extraNeeded: used.filter((b) => b.extra).length,
      utilization: boardArea ? usedArea / boardArea : 0,
      oversizedCount: oversized, oversizedRefs,
    };
  }

  /* THREE-STAGE pass on the real boards (2026-10-17) — in step with Modcraft's _gpack3Once: strips
     (dir 'L' along the board's length, 'W' across its width), each strip crosscut into segments, a
     segment cut into pieces side by side; every cut end to end. Defects stay no-cut zones: a new
     segment moves down its strip past a defect, a new strip moves sideways past one, and a piece
     beside another in a segment is placed only where it clears every defect. 'W' is the same
     problem with the boards (and their defects) turned, turned back afterwards. */
  function pack3OnBoards(pieces, boards, kerf, allowRotate, extraW, extraH, order, dir) {
    const T = dir === 'W';
    const tr = (d) => ({ x: d.y, y: d.x, w: d.h, h: d.w, type: d.type });
    const items = pieces.slice().sort(ORDERS[order] || ORDERS.width);
    const bs = boards.map((b) => ({ no: b.no, ow: b.w, oh: b.h, odef: b.defects || [], w: T ? b.h : b.w, h: T ? b.w : b.h,
      defects: (b.defects || []).map((d) => (T ? tr(d) : d)), extra: false, widthUsed: 0, strips: [], layout: [] }));
    const EW = T ? extraH : extraW, EH = T ? extraW : extraH;
    let oversized = 0; const oversizedRefs = [];
    for (const p of items) {
      const pl = T ? p.width : p.length, pw = T ? p.length : p.width;
      let ors = [{ length: pl, width: pw, rot: false }];
      const locked = p.grain === 'length' || p.grain === 'width';
      if (allowRotate && !locked && p.length !== p.width) ors.push({ length: pw, width: pl, rot: true });
      const maxH = Math.max(EH, ...bs.map((b) => b.h)), maxW = Math.max(EW, ...bs.map((b) => b.w));
      ors = ors.filter((o) => o.length + kerf <= maxH && o.width + kerf <= maxW);
      if (!ors.length) { oversized++; if (p.ref != null) oversizedRefs.push(p.ref); continue; }
      let best = null;
      const take = (c) => { if (!best || c.sc < best.sc) best = c; };
      for (const o of ors) bs.forEach((bd, bi) => {
        if (!bd.layout.length) return;
        bd.strips.forEach((st, si) => {
          st.segs.forEach((sg, gi) => {   // 3: beside the pieces already in a segment
            const x = st.off + sg.used;
            if (o.length > sg.len || x + o.width + kerf > st.off + st.size + kerf) return;
            if (bd.defects.some((d) => hits(x, sg.off, o.width + kerf, o.length + kerf, d))) return;
            take({ t: 3, bi, si, gi, o, x, y: sg.off, sc: (st.size - (sg.used + o.width)) + (sg.len - o.length) * 0.01 });
          });
          if (o.width <= st.size) {        // 2: a new segment down the strip
            const y = placeY(bd, st.off, o.width, o.length, st.lenUsed, kerf);
            if (y >= 0) take({ t: 2, bi, si, o, x: st.off, y, sc: 1e4 + (st.size - o.width) * 10 + (bd.h - y - o.length) * 0.01 });
          }
        });
        const at = placeStrip(bd, o, kerf);   // 1: a new strip on a board in use
        if (at) take({ t: 1, bi, o, x: at.x, y: at.y, sc: 1e8 + (bd.w - at.x - o.width) });
      });
      if (!best) {                            // the next untouched real board, in inspection order
        for (let bi = 0; bi < bs.length && !best; bi++) {
          const bd = bs[bi]; if (bd.layout.length || bd.extra) continue;
          for (const o of ors) { const at = placeStrip(bd, o, kerf); if (at) { best = { t: 1, bi, o, x: at.x, y: at.y }; break; } }
        }
      }
      if (!best) {                            // an extra (clean) board
        const o = ors.find((q) => q.length + kerf <= EH && q.width + kerf <= EW);
        if (!o) { oversized++; if (p.ref != null) oversizedRefs.push(p.ref); continue; }
        bs.push({ no: 'extra ' + (bs.filter((b) => b.extra).length + 1), ow: T ? EH : EW, oh: T ? EW : EH, odef: [], w: EW, h: EH, defects: [], extra: true, widthUsed: 0, strips: [], layout: [] });
        best = { t: 1, bi: bs.length - 1, o, x: 0, y: 0 };
      }
      const bd = bs[best.bi], o = best.o, idx = bd.layout.length;
      if (best.t === 3) { const st = bd.strips[best.si], sg = st.segs[best.gi]; sg.used += o.width + kerf; sg.pieces.push(idx); }
      else if (best.t === 2) { const st = bd.strips[best.si]; st.segs.push({ off: best.y, len: o.length, used: o.width + kerf, pieces: [idx] }); st.lenUsed = best.y + o.length + kerf; }
      else { bd.strips.push({ off: best.x, size: o.width, lenUsed: best.y + o.length + kerf, segs: [{ off: best.y, len: o.length, used: o.width + kerf, pieces: [idx] }] }); bd.widthUsed = best.x + o.width + kerf; }
      bd.layout.push(T ? { x: best.y, y: best.x, w: o.length, h: o.width, rotated: o.rot, ref: p.ref, part: p.part }
                       : { x: best.x, y: best.y, w: o.width, h: o.length, rotated: o.rot, ref: p.ref, part: p.part });
    }
    const used = bs.filter((b) => b.layout.length);
    const pieceArea = (b) => b.layout.reduce((n, q) => n + q.w * q.h, 0);
    const usedArea = used.reduce((n, b) => n + pieceArea(b), 0), boardArea = used.reduce((n, b) => n + b.ow * b.oh, 0);
    return {
      boards: used.map((b) => ({ no: b.no, w: b.ow, h: b.oh, extra: b.extra, defects: b.odef, layout: b.layout,
        shelves: T ? [] : b.strips.map((s) => ({ xStart: s.off, width: s.size })),
        plan: { dir: T ? 'W' : 'L', strips: b.strips.map((s) => ({ off: s.off, size: s.size, segs: s.segs.map((g) => ({ off: g.off, len: g.len, pieces: g.pieces.slice() })) })) } })),
      realUsed: used.filter((b) => !b.extra).length,
      realUnused: bs.filter((b) => !b.extra && !b.layout.length).map((b) => b.no),
      extraNeeded: used.filter((b) => b.extra).length,
      utilization: boardArea ? usedArea / boardArea : 0,
      oversizedCount: oversized, oversizedRefs,
    };
  }

  // Same rule as Modcraft's guillotinePackBoards: try every order (and no rotation when rotation
  // is allowed), keep the best — fewest pieces left off, fewest extra boards, fewest real boards,
  // then the waste gathered on as few boards as possible. Never worse than the single pass.
  function packBest(pieces, boards, kerf, allowRotate, extraW, extraH) {
    let best = packOnBoards(pieces, boards, kerf, allowRotate, extraW, extraH, 'width');
    best.strategy = 'width' + (allowRotate ? ' + rotate' : '');
    if (!pieces || pieces.length < 2) return best;
    const minFill = (r) => { let m = Infinity; r.boards.forEach((b) => { const a = b.layout.reduce((n, q) => n + q.w * q.h, 0) / (b.w * b.h); if (a < m) m = a; }); return m === Infinity ? 0 : m; };
    const better = (r, b) => {
      if (r.oversizedCount !== b.oversizedCount) return r.oversizedCount < b.oversizedCount;
      if (r.extraNeeded !== b.extraNeeded) return r.extraNeeded < b.extraNeeded;
      if (r.realUsed !== b.realUsed) return r.realUsed < b.realUsed;
      return minFill(r) < minFill(b) - 0.02;
    };
    Object.keys(ORDERS).forEach((ord) => (allowRotate ? [true, false] : [false]).forEach((rot) => {
      if (!(ord === 'width' && rot === !!allowRotate)) {
        const r = packOnBoards(pieces, boards, kerf, rot, extraW, extraH, ord);
        if (better(r, best)) { r.strategy = ord + (rot ? ' + rotate' : ''); best = r; }
      }
      ['L', 'W'].forEach((dir) => {
        const r3 = pack3OnBoards(pieces, boards, kerf, rot, extraW, extraH, ord, dir);
        if (better(r3, best)) { r3.strategy = '3-stage ' + (dir === 'W' ? 'across' : 'along') + ' · ' + ord + (rot ? ' + rotate' : ''); best = r3; }
      });
    }));
    return best;
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
      const r = packBest(pieces, boards, +g.kerf || 0, !!g.allowRotate, g.boardW, g.boardH);
      return Object.assign(r, { group_key: key, label, boardW: g.boardW, boardH: g.boardH, kerf: +g.kerf || 0, allowRotate: !!g.allowRotate,
        planned: g.boardsNeeded || 0, received: mine.length, rejected: rejected.map((b) => b.board_no), assumedClean: assumed,
        defectCount: usable.reduce((n, b) => n + ((b.defects || []).length), 0), pieces: pieces.length });
    });
  }

  root.PmesOptimizer = { groupKey, groupLabel, packOnBoards, pack3OnBoards, packBest, optimizeJob, placeY };
})(typeof window !== 'undefined' ? window : globalThis);
if (typeof module !== 'undefined') module.exports = globalThis.PmesOptimizer;
