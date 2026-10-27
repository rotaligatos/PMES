/* Job Order as a spreadsheet (Rommel 2026-10-20: "a choice beside pdf, like csv or excel").
   Same sheets as Modcraft's Job Order export, read from the mother JO copied into
   pmes_production_jobs.mother_jo at release, plus one sheet per process listing the pieces that go
   through it (with their scan codes) — the process JOs, in one file.
   Excel: one sheet per section. CSV: the parts cut list only. Nothing is recomputed. */

function _joxSvcText(p) {
  return (Array.isArray(p.services) ? p.services : []).filter((x) => /taper|rout|board\s*assembl/i.test(x.service || ''))
    .map((x) => x.service + (x.side ? ' — along ' + x.side : '')).join(' · ');
}

function _joxHplRows(jo) {
  const key = (o) => [String(o.material || '').toLowerCase(), String(o.color || '').toLowerCase(), +o.thickness || 0].join('|');
  return (jo.boards || []).filter((b) => b.hpl).map((b) => {
    const parts = (jo.parts || []).filter((p) => p.hpl && key(p) === key(b));
    const lamFirst = parts.length ? parts[0].hplOrder === 'laminate_first' : /^(MDF|PB)/i.test(b.material || '') && jo.hplOrder !== 'cut_first';
    const faces = +b.faces || 0, boards = Math.max(+b.boardsNeeded || 0, +b.hplOrdered || 0);
    const pieces = parts.reduce((n, p) => n + (+p.qty || 1), 0);
    const area = parts.reduce((n, p) => n + (+p.cutL || +p.L || 0) * (+p.cutW || +p.W || 0) * (+p.qty || 1) / 1e6, 0);
    return [[b.material, b.color].filter(Boolean).join(' ') + (b.thickness ? ' ' + b.thickness + 'mm' : ''),
      lamFirst ? 'Whole boards first, then cut' : 'Cut first, then by hand', boards, pieces, Math.round(area * 100) / 100,
      faces || '', faces ? boards * faces : '', lamFirst ? 'HPL > CURE, then CUT' : 'CUT, then MHPL',
      parts.map((p) => p.p + (+p.qty > 1 ? ' x' + p.qty : '')).join(', ')];
  });
}

function joExportRows(job, stages, components) {
  const jo = job.mother_jo || {}, sv = jo.services || {}, r = (v) => Math.round((+v || 0) * 100) / 100;
  const parts = [['Part', 'Area', 'Component', 'Material', 'Colour', 'Th (mm)', 'Finished W', 'Finished L', 'Cut W', 'Cut L', 'Qty', 'Edge code', 'Tape', 'Tape mm',
    'Grain', 'Groove', 'Special', 'Remarks', 'Route', 'PMES area', 'PMES part', 'Edge bander', 'Board']];
  (jo.parts || []).forEach((p) => parts.push([p.p, p.area, p.name, p.material, p.color, p.thickness || '', p.W, p.L, p.cutW, p.cutL, p.qty,
    pjoEbtLS(p), p.tape || '', p.tapeMm || '', p.grain || '', p.grooving || '', [p.special || '', _joxSvcText(p)].filter(Boolean).join(' · '),
    p.remark || '', (p.route || []).join(' > '), p.pmesArea || '', p.pmesPart || '', p.bander || '', (p.boardOf || []).map((n) => n + 1).join(', ')]));
  const pieces = [['Part', 'Component', 'Piece', 'Scan code', 'Barcode ID', 'Cut W', 'Cut L', 'Th (mm)', 'Material']];
  (jo.parts || []).forEach((p) => (p.barcodes || []).forEach((b, n) => pieces.push([p.p, p.name, (n + 1) + ' of ' + p.qty, (p.scan || [])[n] || '', b,
    p.cutW, p.cutL, p.thickness || '', [p.material, p.color].filter(Boolean).join(' ')])));
  const summary = [['Job Order', job.job_code || jo.joNumber || ''], ['Quotation', job.quotation_serial || jo.serial || ''], ['Option', jo.optionLabel || ''],
    ['Client', jo.client || ''], ['Project', jo.project || ''], ['Company', jo.company || ''], ['Prepared by', jo.preparedBy || ''],
    ['Job Order review', job.jo_review_status || ''], ['Pieces', jo.pieceCount || 0], ['Parts', (jo.parts || []).length], ['Boards', jo.boardCount || 0],
    ['Cutting (lm)', r(sv.cuttingLM)], ['Edge banding (lm)', r(sv.edgebandingLM)], ['Holes', sv.holeCount || 0],
    ['Machine', jo.machine ? jo.machine.label + ' · kerf ' + jo.machine.kerf + 'mm' : ''], ['HPL on MDF/PB', jo.hplOrder === 'cut_first' ? 'cut first' : 'laminate first']];
  const boards = [['Material', 'Colour', 'Th (mm)', 'Board size', 'Boards', 'Utilisation %', 'Pieces not on a layout']];
  (jo.boards || []).forEach((b) => boards.push([b.material, b.color, b.thickness || '', b.boardSize || '', b.boardsNeeded || 0, b.utilizationPct || 0, b.oversizedCount || 0]));
  const hw = [['Item', 'Cabinet', 'Qty', 'Unit', 'Notes']]; (jo.hardware || []).forEach((x) => hw.push([x.name, x.cabinet || '', x.qty, x.unit || '', x.notes || '']));
  const holes = [['Component', 'Type', 'Qty', 'Diameter (mm)', 'Notes']]; (jo.holes || []).forEach((x) => holes.push([x.component, x.holeType, x.qty, x.diameter || '', x.notes || '']));
  const svc = [['Item', 'Quantity', 'Unit']];
  (sv.edgebandingByTape || []).forEach((t) => svc.push(['Edge tape — ' + t.tape, r(t.lm), 'lm']));
  (sv.extraServicesByName || []).forEach((s) => svc.push([s.service, s.qty, s.unit || '']));
  const hpl = [['Board build', 'Method', 'Boards', 'Pieces', 'Area (m²)', 'Faces', 'HPL sheets', 'Process', 'Parts']].concat(_joxHplRows(jo));
  // One sheet per process: the pieces that go through it (the process JO).
  const procs = (stages || []).map((s) => {
    const st = (State.stageTypes || []).find((t) => t.code === s.stage_code);
    const rows = [['Scan code', 'Part', 'Name', 'Material', 'Th', 'Cut W', 'Cut L', 'Finished W', 'Finished L', 'Edges', 'Tape', 'Grain', 'Groove', 'Special', 'Remarks']];
    componentsForStage(components || [], s.stage_code, job).forEach((c) => {
      const p = c.spec || {};
      rows.push([c.scan_code || c.full_barcode_id || '', p.part || c.part_code || '', p.name || c.component_code || '', p.material || '', p.thickness || '',
        p.cutW || '', p.cutL || '', p.W || '', p.L || '', pjoEbtLS(p), p.tape || '', p.grain || '', p.grooving || '', p.special || '', p.remark || '']);
    });
    return { name: s.stage_code + ' ' + (st ? st.label : ''), rows };
  });
  return { summary, parts, pieces, boards, hw, holes, svc, hpl, procs };
}

async function exportJobOrder(jobId, fmt) {
  if (typeof XLSX === 'undefined') return toast('Spreadsheet library not loaded — try again in a moment.', 'error');
  let job, stages, components;
  const d = State.jd;
  if (d && d.job && d.job.id === jobId) ({ job, stages, components } = d);
  else {
    try { [job, components] = await Promise.all([Data.getJob(jobId), Data.listComponents(jobId)]); stages = []; }
    catch (e) { return toast('Could not load the job: ' + e.message, 'error'); }
  }
  if (!job.mother_jo) return toast('This job has no Modcraft Job Order to export.', 'error');
  const t = joExportRows(job, stages, components);
  const ok = joApproved(job);
  const base = String(job.job_code || 'JO').replace(/[^\w.-]+/g, '_') + (ok ? '' : '_NOT-APPROVED');
  if (fmt === 'csv') {
    const csv = XLSX.utils.sheet_to_csv(XLSX.utils.aoa_to_sheet(t.parts));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = base + '_parts.csv'; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    return;
  }
  if (!ok) t.summary.unshift(['NOT APPROVED FOR THE LINE', 'The Job Order has not been approved in PMES yet — do not cut from this copy.']);
  const wb = XLSX.utils.book_new(), used = {};
  const add = (rows, name) => {
    if (rows.length <= 1 && name !== 'Summary') return;
    let n = String(name).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31).trim(), k = 2;
    while (used[n]) n = n.slice(0, 28) + ' ' + (k++);
    used[n] = 1; XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), n);
  };
  add(t.summary, 'Summary'); add(t.parts, 'Parts'); add(t.pieces, 'Pieces & barcodes'); add(t.boards, 'Boards');
  add(t.hw, 'Hardware'); add(t.holes, 'Holes'); add(t.svc, 'Edge banding & services'); add(t.hpl, 'HPL lamination');
  t.procs.forEach((p) => add(p.rows, p.name));
  XLSX.writeFile(wb, base + '.xlsx');
}
