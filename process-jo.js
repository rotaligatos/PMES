/* =====================================================================
   Process JOs
   Modcraft issues ONE mother JO per job. Production splits it into one work order per process
   (cutting, special cutting, each edge bander, HPL, drilling…). A process JO is the pieces whose
   route passes through that stage, plus what that process needs to do the work:
     cutting        → cutting layout (board diagrams + cut sequence)
     edge banding   → edge-banding layout (which edges, which tape) + tape totals
     drilling       → boring schedule
     HPL            → boards to laminate
   Every process JO also carries a 6-working-day tracker (work rarely finishes in one day), the BOM
   summary, and the job's files (source file, elevation, customer cutting list, shop drawing, order
   attachments). All of it comes from the mother JO copied into pmes_production_jobs.mother_jo at
   release, and from the quotation's file folder.
   Printed pages use fixed colours only.
   ===================================================================== */

const PJO_DAYS = 6;

// Which pieces go through a stage. Pieces from a Modcraft Job Order carry their own route; older
// pieces follow the job's route (every piece through every stage).
function componentsForStage(components, stageCode, job) {
  const jobRoute = State.routeMappings.find((r) => r.code === (job && job.route_code));
  return components.filter((c) => {
    if (Array.isArray(c.route) && c.route.length) return c.route.includes(stageCode);
    return jobRoute ? jobRoute.stage_sequence.includes(stageCode) : true;
  });
}

function _pjoPartNo(c) {
  const m = String((c.spec && c.spec.part) || '').match(/\d+/);
  return m ? +m[0] : 99999;
}
const _pjoE = (v) => escapeHtml(v == null ? '' : String(v));

// ── Board diagram + cut sequence (same geometry and rules as Modcraft's cut sheet) ──────────
function _pjoBoardSvg(pieces, boardW, boardH, maxPx, refsOn, defects) {
  const scale = maxPx / Math.max(boardW, boardH);
  const pw = Math.round(boardW * scale), ph = Math.round(boardH * scale);
  const fs = Math.round(10 / scale), sw = Math.max(1, Math.round(1.4 / scale));
  let r = '';
  pieces.forEach((pc, i) => {
    const on = !refsOn || refsOn.has(pc.ref);
    const hue = ((pc.ref != null ? pc.ref : i) * 47) % 360;
    r += `<rect x="${pc.x}" y="${pc.y}" width="${pc.w}" height="${pc.h}" fill="${on ? `hsl(${hue},55%,80%)` : '#eeeeee'}" stroke="#5a4a3a" stroke-width="${sw}"></rect>`;
    const label = (pc.ref != null ? 'P' + (pc.ref + 1) + ' ' : '') + Math.round(pc.h) + '×' + Math.round(pc.w) + (pc.rotated ? ' ⟳' : '');
    if (pc.w > fs * 0.62 * label.length && pc.h > fs * 1.5)
      r += `<text x="${pc.x + pc.w / 2}" y="${pc.y + pc.h / 2 + fs * 0.3}" font-size="${fs}" text-anchor="middle" fill="#222">${_pjoE(label)}</text>`;
    else if (pc.ref != null && pc.w > fs * 2.2 && pc.h > fs * 1.5)
      r += `<text x="${pc.x + pc.w / 2}" y="${pc.y + pc.h / 2 + fs * 0.3}" font-size="${fs}" text-anchor="middle" fill="#222">P${pc.ref + 1}</text>`;
  });
  (defects || []).forEach((d) => { r += `<rect x="${d.x}" y="${d.y}" width="${d.w}" height="${d.h}" fill="rgba(220,40,40,.35)" stroke="#c0271d" stroke-width="${sw * 1.5}"></rect>`; });
  return `<svg width="${pw}" height="${ph}" viewBox="0 0 ${boardW} ${boardH}" style="background:#fff;border:2px solid #8a7a63">${r}</svg>`;
}
function _pjoCutSequence(bm, bi) {
  const pieces = (bm.layout && bm.layout[bi]) || [];
  const shelves = ((bm.shelves && bm.shelves[bi]) || []).slice().sort((a, b) => a.xStart - b.xStart).map((s) => ({
    width: s.width, pieces: pieces.filter((p) => p.x === s.xStart).sort((a, b) => a.y - b.y),
  }));
  const steps = [];
  let rip = 0, cross = 0;
  shelves.forEach((s) => {
    rip += bm.boardH;
    const n = Math.max(0, s.pieces.length - 1);
    cross += n * s.width;
    steps.push(`Rip a ${Math.round(s.width)}mm strip (${bm.boardH}mm long).`);
    steps.push(`Crosscut it into ${s.pieces.length} pcs: ${s.pieces.map((p) => (p.ref != null ? 'P' + (p.ref + 1) + ' ' : '') + Math.round(p.h) + 'mm').join(', ')}.`);
  });
  return { steps, totalM: ((rip + cross) / 1000).toFixed(2) };
}
// Identical boards (same parts in the same places) are printed once, "×N".
function _pjoBoardGroups(bm) {
  const groups = [], bySig = {};
  (bm.layout || []).forEach((lay, bi) => {
    const sig = lay.map((p) => [p.x, p.y, p.w, p.h, p.ref].join(',')).sort().join('|');
    if (bySig[sig] == null) { bySig[sig] = groups.length; groups.push([bi]); } else groups[bySig[sig]].push(bi);
  });
  return groups;
}

// Cutting layout: only the boards that carry a piece of this process. Other pieces on the same
// board are drawn grey — they belong to another process JO but are cut from the same sheet.
function _pjoCuttingLayout(mjo, refs) {
  let h = '';
  (mjo.boards || []).forEach((bm) => {
    if (!(bm.layout && bm.layout.length)) return;
    const title = [bm.material, bm.color, bm.thickness ? bm.thickness + 'mm' : ''].filter(Boolean).join(' · ');
    _pjoBoardGroups(bm).forEach((grp) => {
      const bi = grp[0], lay = bm.layout[bi];
      if (!lay.some((p) => refs.has(p.ref))) return;
      const seq = _pjoCutSequence(bm, bi);
      const which = grp.length > 1 ? `Boards ${grp.map((b) => b + 1).join(', ')} (×${grp.length} identical)` : `Board ${bi + 1}`;
      h += `<div class="blk"><h4>${_pjoE(title)} — ${which} of ${bm.layout.length}${mjo._planVersion ? ' · adopted plan v' + mjo._planVersion + (bm.defects && (bm.defects[bi] || []).length ? ' · defects shown red, do not cut' : '') : ''} · ${bm.boardW}×${bm.boardH}mm · kerf ${_pjoE(bm.kerf)}mm</h4>`
        + `<div class="two"><div>${_pjoBoardSvg(lay, bm.boardW, bm.boardH, 330, refs, bm.defects && bm.defects[bi])}</div>`
        + `<div><ol>${seq.steps.map((s) => '<li>' + _pjoE(s) + '</li>').join('')}</ol><p><b>Cutting length:</b> ${seq.totalM} m per board</p></div></div></div>`;
    });
    if (bm.oversizedCount) h += `<p class="warn">⚠ ${bm.oversizedCount} piece(s) of ${_pjoE(title)} are too big for the board and are not on any layout: ${(bm.oversizedRefs || []).map((x) => 'P' + (x + 1)).join(', ')}</p>`;
  });
  return h || '<p class="muted">No board layout for these pieces in the mother JO.</p>';
}

// Edge-banding layout: each part drawn to proportion, banded edges in red. Edges along the length
// are the top/bottom lines; edges along the width are the sides.
function _pjoEdgeDiagram(p) {
  const L = +p.L || 0, W = +p.W || 0, box = 120;
  if (!(L > 0 && W > 0)) return '';
  const s = box / Math.max(L, W), w = Math.max(24, L * s), hgt = Math.max(14, W * s);
  const lc = +p.lc || 0, sc = +p.sc || 0, off = '#bbbbbb', on = '#d11a1a', th = 4;
  const line = (x1, y1, x2, y2, c) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c}" stroke-width="${c === on ? th : 1.5}"/>`;
  return `<svg width="${w + 8}" height="${hgt + 8}" viewBox="-4 -4 ${w + 8} ${hgt + 8}">`
    + line(0, 0, w, 0, lc >= 2 ? on : off) + line(0, hgt, w, hgt, lc >= 1 ? on : off)
    + line(0, 0, 0, hgt, sc >= 1 ? on : off) + line(w, 0, w, hgt, sc >= 2 ? on : off)
    + `<text x="${w / 2}" y="${hgt / 2 + 4}" font-size="11" text-anchor="middle" fill="#222">${_pjoE(p.p)}</text></svg>`;
}
function _pjoEdgeLayout(mjo, parts) {
  const banded = parts.filter((p) => (+p.sc || 0) + (+p.lc || 0) > 0);
  if (!banded.length) return '<p class="muted">No banded edges on these pieces.</p>';
  const tapes = {};
  banded.forEach((p) => {
    const lm = ((+p.sc || 0) * (+p.W || 0) + (+p.lc || 0) * (+p.L || 0)) / 1000 * (+p.qty || 1);
    const k = p.tape || 'Tape not named';
    tapes[k] = (tapes[k] || 0) + lm;
  });
  return '<div class="edges">' + banded.map((p) => `<div class="edge"><div>${_pjoEdgeDiagram(p)}</div>`
      + `<div><b>${_pjoE(p.p)}</b> ${_pjoE(p.name)} ×${p.qty}<br>${_pjoE(p.L)}×${_pjoE(p.W)} · <b>${_pjoE(p.ebt)}</b><br>${_pjoE(p.tape || '')}</div></div>`).join('') + '</div>'
    + '<p class="muted">Red = banded edge. Top/bottom lines run along the length; the sides along the width.</p>'
    + '<table class="t"><tr><th>Tape</th><th>Length (no wastage)</th></tr>'
    + Object.keys(tapes).map((k) => `<tr><td>${_pjoE(k)}</td><td>${tapes[k].toFixed(2)} m</td></tr>`).join('') + '</table>';
}
function _pjoBoringSchedule(mjo, parts) {
  const names = new Set(parts.map((p) => String(p.name || '').toLowerCase()));
  const holes = (mjo.holes || []).filter((h) => names.has(String(h.component || '').toLowerCase()));
  if (!holes.length) return '<p class="muted">No holes listed for these pieces in the mother JO.</p>';
  return '<table class="t"><tr><th>Component</th><th>Hole type</th><th>Qty</th><th>Ø</th><th>Position</th><th>Notes</th></tr>'
    + holes.map((h) => `<tr><td>${_pjoE(h.component)}</td><td>${_pjoE(h.holeType)}</td><td>${_pjoE(h.qty)}</td><td>${_pjoE(h.diameter)}mm</td><td>${_pjoE(h.position || '')}</td><td>${_pjoE(h.notes || '')}</td></tr>`).join('')
    + '</table>';
}
function _pjoHplBoards(mjo, parts) {
  const rows = (mjo.boards || []).filter((b) => /\bhpl\b/i.test([b.material, b.color].join(' ')));
  const byOrder = { laminate_first: 0, cut_first: 0 };
  parts.forEach((p) => { if (byOrder[p.hplOrder] != null) byOrder[p.hplOrder] += +p.qty || 1; });
  return '<table class="t"><tr><th>Board</th><th>Boards</th><th>Faces</th><th>HPL sheets</th></tr>'
    + rows.map((b) => `<tr><td>${_pjoE([b.material, b.color, b.thickness ? b.thickness + 'mm' : ''].filter(Boolean).join(' '))}</td><td>${_pjoE(b.boardsNeeded)}</td><td>${_pjoE(b.faces || '?')}</td><td>${(+b.boardsNeeded || 0) * (b.faces === 2 ? 2 : 1)}</td></tr>`).join('')
    + '</table>'
    + `<p class="muted">Whole boards laminated before cutting: ${byOrder.laminate_first} pcs · cut pieces laminated after cutting: ${byOrder.cut_first} pcs.</p>`;
}
function _pjoBomSummary(mjo) {
  const sv = mjo.services || {};
  let h = '<table class="t"><tr><th>Boards</th><th>Size</th><th>Qty</th><th>Used</th></tr>'
    + (mjo.boards || []).map((b) => `<tr><td>${_pjoE([b.material, b.color, b.thickness ? b.thickness + 'mm' : ''].filter(Boolean).join(' '))}</td><td>${_pjoE(b.boardSize)}</td><td>${_pjoE(b.boardsNeeded)}</td><td>${_pjoE(b.utilizationPct)}%</td></tr>`).join('')
    + '</table>';
  if ((mjo.hardware || []).length)
    h += '<table class="t"><tr><th>Hardware</th><th>Cabinet</th><th>Qty</th><th>Unit</th></tr>'
      + mjo.hardware.map((x) => `<tr><td>${_pjoE(x.name)}</td><td>${_pjoE(x.cabinet || '')}</td><td>${_pjoE(x.qty)}</td><td>${_pjoE(x.unit)}</td></tr>`).join('') + '</table>';
  const tapes = sv.edgebandingByTape || [], ex = sv.extraServicesByName || [];
  h += '<table class="t"><tr><th>Service / consumable</th><th>Quantity</th></tr>'
    + `<tr><td>Cutting</td><td>${(+sv.cuttingLM || 0).toFixed(1)} lm</td></tr>`
    + `<tr><td>Edge banding</td><td>${(+sv.edgebandingLM || 0).toFixed(1)} lm</td></tr>`
    + tapes.map((t) => `<tr><td>&nbsp;&nbsp;tape — ${_pjoE(t.tape)}</td><td>${(+t.lm || 0).toFixed(1)} lm</td></tr>`).join('')
    + ex.map((s) => `<tr><td>${_pjoE(s.service)}</td><td>${_pjoE(s.qty)} ${_pjoE(s.unit)}</td></tr>`).join('')
    + `<tr><td>Holes</td><td>${_pjoE(sv.holeCount || 0)}</td></tr></table>`;
  return h;
}

// The job's files, from the quotation's folder. Commercial documents (quotation printouts, cost
// detail) are left out — production gets the drawings and lists, not the prices.
const PJO_SOURCE_LABEL = { customer_list: 'Customer cutting list', elevation: 'Elevation drawing', drawing: 'Source file (shop drawing / cutting list)', typed_list: 'Source file' };
async function _pjoAttachments(mjo) {
  const folder = mjo && mjo.storageFolder;
  if (!folder) return [];
  const { data, error } = await sb.storage.from('quotations').list(folder, { limit: 100 });
  if (error || !data) return [];
  const out = [];
  data.forEach((f) => {
    const n = f.name, low = n.toLowerCase();
    let kind = '';
    if (low.includes('raw upload')) kind = PJO_SOURCE_LABEL[mjo.sourceKind] || 'Source file';
    else if (low.includes('shop drawing')) kind = 'Shop drawing';
    else if (low.includes('wufoo attachment') || low.includes('order attachment')) kind = 'Client order attachment';
    else if (/— bom\.html$/.test(low) || low.includes(' — bom')) kind = 'BOM report';
    if (kind) out.push({ kind, name: n, path: folder + '/' + n });
  });
  if (out.length) {
    const { data: urls } = await sb.storage.from('quotations').createSignedUrls(out.map((a) => a.path), 60 * 60 * 24 * 7);
    (urls || []).forEach((u, i) => { if (u && u.signedUrl) out[i].url = u.signedUrl; });
  }
  return out;
}

async function printProcessJO(jobId, stageCode) {
  let job, components;
  try {
    [job, components] = await Promise.all([Data.getJob(jobId), Data.listComponents(jobId)]);
  } catch (e) { return toast('Could not load the job: ' + e.message, 'error'); }
  if (!joApproved(job)) return toast('This Job Order is not approved for the line yet — nothing to hand to the operators.', 'error');
  const w = window.open('', '_blank');
  if (!w) return toast('Pop-up blocked — allow pop-ups to print.', 'error');
  w.document.write('<p style="font-family:Arial">Preparing the process JO…</p>');

  const st = State.stageTypes.find((t) => t.code === stageCode);
  const label = st ? st.label : stageCode;
  const list = componentsForStage(components, stageCode, job).sort((a, b) => _pjoPartNo(a) - _pjoPartNo(b) || (a.seq_number - b.seq_number));
  // The layout the line cuts from: the adopted cutting plan (real boards, defects avoided) if a
  // supervisor adopted one, else the Modcraft layout the quotation was based on.
  let mjo = job.mother_jo || null;
  try {
    const ap = mjo ? await BoardsData.adoptedPlan(jobId) : null;
    if (ap && ap.result && Array.isArray(ap.result.groups)) mjo = Object.assign({}, mjo, { boards: ap.result.groups, _planVersion: ap.version });
  } catch (e) { /* keep the Modcraft layout */ }
  const refs = new Set(list.map((c) => _pjoPartNo(c) - 1));
  const partNos = new Set(list.map((c) => c.spec && c.spec.part).filter(Boolean));
  const parts = mjo ? (mjo.parts || []).filter((p) => partNos.has(p.p)) : [];
  const attachments = mjo ? await _pjoAttachments(mjo) : [];

  const e = _pjoE, sp = (c) => c.spec || {};
  const size = (a, b) => (a && b ? a + ' × ' + b : '—');
  const cutting = stageCode === 'CUT' || stageCode === 'SCUT';
  const edge = stageCode === 'EBA' || stageCode === 'EBB' || stageCode === 'MEB';
  const hpl = stageCode === 'HPL' || stageCode === 'CURE' || stageCode === 'MHPL';
  const groove = stageCode === 'GRV';

  const cols = [['Scan code', (c) => '<span class="mono">' + e(c.scan_code || c.full_barcode_id) + '</span>'],
                ['Part', (c) => '<b>' + e(sp(c).part || c.part_code) + '</b>'],
                ['Name', (c) => e(sp(c).name || c.component_code)]];
  if (cutting) cols.push(['Material', (c) => e(sp(c).material || '')], ['Th', (c) => e(sp(c).thickness || '')],
    ['Cut L × W', (c) => '<b>' + size(sp(c).cutL, sp(c).cutW) + '</b>'],
    ['Grain', (c) => e(sp(c).grain || '')], ['Special', (c) => '<b>' + e(sp(c).special || '') + '</b>']);
  else if (edge) cols.push(['Finished L × W', (c) => '<b>' + size(sp(c).L, sp(c).W) + '</b>'],
    ['Edges', (c) => '<b>' + e(sp(c).ebt || '') + '</b>'], ['Tape', (c) => e(sp(c).tape || '') + (sp(c).tapeMm ? ' (' + sp(c).tapeMm + 'mm)' : '')]);
  else if (groove) cols.push(['Finished L × W', (c) => '<b>' + size(sp(c).L, sp(c).W) + '</b>'],
    ['Material', (c) => e(sp(c).material || '')], ['Grooving', (c) => '<b>' + e(sp(c).grooving || '') + '</b>'],
    ['Grain', (c) => e(sp(c).grain || '')]);
  else if (hpl) cols.push(['Material', (c) => e(sp(c).material || '')], ['Size', (c) => size(sp(c).cutL || sp(c).L, sp(c).cutW || sp(c).W)],
    ['Order', (c) => e(sp(c).hplOrder === 'laminate_first' ? 'whole board, before cutting' : 'after cutting')]);
  else cols.push(['Finished L × W', (c) => size(sp(c).L, sp(c).W)], ['Material', (c) => e(sp(c).material || '')]);
  // One tick box per working day — a piece is ticked on the day it was actually done.
  for (let d = 1; d <= PJO_DAYS; d++) cols.push(['D' + d, () => '<span class="box"></span>']);

  const table = (rows) => '<table class="t pieces"><tr>' + cols.map((k) => '<th>' + k[0] + '</th>').join('') + '</tr>'
    + rows.map((c) => '<tr>' + cols.map((k) => '<td>' + k[1](c) + '</td>').join('') + '</tr>').join('') + '</table>';

  let pieces;
  if (cutting) {
    const groups = {}, order = [];
    list.forEach((c) => { const b = sp(c).board || 'Not on a board layout'; if (!groups[b]) { groups[b] = []; order.push(b); } groups[b].push(c); });
    pieces = order.map((b) => '<h4>' + e(b) + ' — ' + groups[b].length + ' pcs</h4>' + table(groups[b])).join('');
  } else pieces = table(list);

  const days = '<table class="t days"><tr><th>Day</th><th>Date</th><th>Pieces done</th><th>Operator</th><th>Machine</th><th>Hours</th><th>Remarks</th><th>Supervisor</th></tr>'
    + Array.from({ length: PJO_DAYS }, (_, i) => `<tr><td><b>D${i + 1}</b></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>`).join('')
    + '</table>';

  let attach = '';
  if (!mjo) attach = '<p class="warn">This job was not released from a Modcraft Job Order, so no layouts or files are attached.</p>';
  else {
    if (cutting) attach += '<h3>Cutting layout</h3>' + _pjoCuttingLayout(mjo, refs);
    if (edge) attach += '<h3>Edge-banding layout</h3>' + _pjoEdgeLayout(mjo, parts);
    if (stageCode === 'DRL') attach += '<h3>Boring schedule</h3>' + _pjoBoringSchedule(mjo, parts);
    if (hpl) attach += '<h3>HPL boards</h3>' + _pjoHplBoards(mjo, parts);
    attach += '<h3>BOM summary (whole job)</h3>' + _pjoBomSummary(mjo);
    attach += '<h3>Attached files</h3>' + (attachments.length
      ? '<table class="t"><tr><th>File</th><th>Name</th></tr>' + attachments.map((a) => `<tr><td>${e(a.kind)}</td><td>${a.url ? `<a href="${e(a.url)}" target="_blank">${e(a.name)}</a>` : e(a.name)}</td></tr>`).join('') + '</table>'
        + '<p class="muted">Links open the file (valid 7 days from printing). Print them from there.</p>'
      : '<p class="muted">No drawings or source files were saved with this quotation.</p>');
  }

  w.document.open();
  w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>' + e(job.job_code + ' — ' + label) + '</title><style>'
    + '@page{size:A4 landscape;margin:9mm}body{font-family:Arial,Helvetica,sans-serif;color:#111;background:#fff;margin:14px;font-size:10.5px}'
    + 'h1{font-size:16px;margin:0}h3{font-size:13px;margin:16px 0 6px;border-bottom:1px solid #999;padding-bottom:2px}h4{font-size:11px;margin:10px 0 4px}'
    + '.sub{color:#444;margin:3px 0 10px}.muted{color:#666}.warn{color:#9a3412;font-weight:bold}'
    + 'table.t{border-collapse:collapse;width:100%;margin-bottom:6px}.t th,.t td{border:1px solid #999;padding:3px 5px;text-align:left;vertical-align:top}.t th{background:#eee}'
    + '.pieces td:nth-last-child(-n+' + PJO_DAYS + '),.pieces th:nth-last-child(-n+' + PJO_DAYS + '){width:24px;text-align:center}'
    + '.days td{height:22px}.mono{font-family:monospace;font-size:9.5px}.box{display:inline-block;width:12px;height:12px;border:1px solid #333}'
    + '.blk{page-break-inside:avoid;break-inside:avoid;margin-bottom:8px}.two{display:grid;grid-template-columns:auto 1fr;gap:14px}.two ol{margin:0 0 0 16px;padding:0}'
    + '.edges{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.edge{display:flex;gap:6px;align-items:center;border:1px solid #ccc;padding:4px;break-inside:avoid}'
    + '.sign{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-top:16px}.sign div{border-top:1px solid #333;padding-top:3px;color:#555}'
    + '@media print{.noprint{display:none}}</style></head><body>'
    + '<div class="noprint" style="margin-bottom:8px"><button onclick="window.print()">Print</button></div>'
    + '<h1>Process JO — ' + e(label) + ' (' + e(stageCode) + ')</h1>'
    + '<div class="sub">Job <b>' + e(job.job_code) + '</b> · mother JO ' + e(mjo ? mjo.joNumber : '—') + ' · quotation ' + e(job.quotation_serial || '—')
    + ' · ' + e(job.destination_company || '') + ' · <b>' + list.length + '</b> piece' + (list.length === 1 ? '' : 's') + ' of ' + components.length
    + ' · issued ' + e(new Date().toLocaleDateString()) + (State.me ? ' by ' + e(State.me.name || State.me.email) : '') + '</div>'
    + '<h3>Pieces — tick the day each piece was done (D1–D' + PJO_DAYS + ')</h3>' + pieces
    + '<h3>Daily log</h3>' + days
    + attach
    + '<div class="sign"><div>Prepared by</div><div>Received by (operator)</div><div>Completed / date</div><div>Checked by</div></div>'
    + '</body></html>');
  w.document.close();
}
