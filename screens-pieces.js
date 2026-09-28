/* --------------------------- Pieces × processes ---------------------------
   Rommel 2026-09-28: a process being "in progress" is not enough — every piece of the JO is marked
   done at each process, so progress % is real and everyone can see which piece is still not done.
   Truth lives in pmes_component_done; marking goes through pmes_component_mark (the database checks
   the role, the operator's stations, the JO gate, the piece's route, and asks a reason to undo). */

const PieceState = { stage: '', notDone: false, q: '', sel: {} };

async function loadPieceDone(jobId) {
  const { data, error } = await sb.from(T('component_done')).select('*').eq('job_id', jobId);
  if (error) throw error; return data || [];
}
function _doneMap(done) { const m = {}; (done || []).forEach((d) => { m[d.component_id + '|' + d.stage_code] = d; }); return m; }
function _pieceLabel(c) {
  const s = c.spec || {};
  return { part: s.part || c.part_code || '', name: s.name || c.component_code || '', size: s.cutL && s.cutW ? s.cutL + '×' + s.cutW : '' };
}
function _pieceRoute(c, job) { return stageSequenceFor(c, job) || []; }
// Pieces planned at a process and how many are done — the one progress figure used everywhere.
function pieceStats(stageCode, components, job, done) {
  const m = _doneMap(done), planned = componentsForStage(components, stageCode, job).filter((c) => c.status !== 'scrapped');
  const n = planned.filter((c) => m[c.id + '|' + stageCode]).length;
  return { planned: planned.length, done: n, pct: planned.length ? Math.round(n / planned.length * 100) : 0, notDone: planned.filter((c) => !m[c.id + '|' + stageCode]) };
}
function pieceBar(st) {
  return `<div class="pc-bar"><div style="width:${st.pct}%;background:${st.pct === 100 ? 'var(--green)' : 'var(--amber)'}"></div></div>`;
}
function pieceProgressLine(stage, components, job, done) {
  const st = pieceStats(stage.stage_code, components, job, done);
  if (!st.planned) return '';
  return `<div class="pc-line">${pieceBar(st)}<span><strong>${st.done}</strong> / ${st.planned} pieces done (${st.pct}%)</span>
    ${st.notDone.length && st.notDone.length <= 3 ? '<span class="small"> · not done: ' + st.notDone.map((c) => escapeHtml(_pieceLabel(c).part || c.full_barcode_id)).join(', ') + '</span>'
      : st.notDone.length ? `<a href="#" class="small" onclick="showNotDone('${stage.stage_code}');return false"> · ${st.notDone.length} not done — see which</a>` : ''}</div>`;
}
function showNotDone(code) { PieceState.stage = code; PieceState.notDone = true; setJobTab('parts'); }

function renderPieceMatrix(job, stages, components, done) {
  if (!components.length) return '';
  const m = _doneMap(done), codes = stages.map((s) => s.stage_code);
  const canMark = pmesCan('operator') && joApproved(job);
  const q = PieceState.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const rows = components.filter((c) => {
    const L = _pieceLabel(c), txt = [L.part, L.name, L.size, c.full_barcode_id, c.scan_code].join(' ').toLowerCase();
    if (!q.every((w) => txt.includes(w))) return false;
    if (PieceState.stage) {
      const onRoute = _pieceRoute(c, job).includes(PieceState.stage);
      if (!onRoute) return false;
      if (PieceState.notDone && m[c.id + '|' + PieceState.stage]) return false;
    } else if (PieceState.notDone && c.status === 'complete') return false;
    return true;
  });
  const sel = Object.keys(PieceState.sel).filter((k) => PieceState.sel[k]);
  const head = codes.map((code) => { const st = pieceStats(code, components, job, done);
    return `<th class="pc-h" title="${escapeHtml(code)}: ${st.done}/${st.planned} done">${escapeHtml(code)}<div class="small">${st.done}/${st.planned}</div></th>`; }).join('');
  const cell = (c, code) => {
    const onRoute = _pieceRoute(c, job).includes(code);
    if (!onRoute) return '<td class="pc-na">—</td>';
    const d = m[c.id + '|' + code];
    const may = canMark && pmesStageAllowed(code);
    if (d) return `<td class="pc-done"><button class="pc-cell done" title="Done by ${escapeHtml(d.done_by_name || d.done_by)} · ${fmtDate(d.done_at)}${d.via === 'scan' ? ' (scan)' : ''}${d.note ? ' · ' + escapeHtml(d.note) : ''}" ${may ? `onclick="pieceUndo('${c.id}','${code}')"` : 'disabled'}>✓</button></td>`;
    return `<td><button class="pc-cell" title="${may ? 'Mark done at ' + code : 'Not done'}" ${may ? `onclick="pieceMark(['${c.id}'],'${code}')"` : 'disabled'}>○</button></td>`;
  };
  return `<div class="card"><div class="flex-between" style="gap:8px;flex-wrap:wrap;"><h2 class="mb-0">Pieces by process</h2>
      <span class="small">${components.filter((c) => c.status === 'complete').length} of ${components.length} pieces finished every process</span></div>
    <p class="small" style="margin-top:4px;">✓ done · ○ not done yet · — not on that piece's route. ${canMark ? 'Tap ○ to mark a piece done at that process; tap ✓ to undo (a reason is asked). Or tick pieces and mark them together.' : ''}</p>
    <div class="pc-tools">
      <input type="text" placeholder="Search part, name, size, barcode…" value="${escapeHtml(PieceState.q)}" oninput="PieceState.q=this.value;_redrawPieces()">
      <select onchange="PieceState.stage=this.value;_redrawPieces()"><option value="">All processes</option>${codes.map((c) => `<option ${PieceState.stage === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}</select>
      <label class="small" style="display:flex;gap:6px;align-items:center;"><input type="checkbox" ${PieceState.notDone ? 'checked' : ''} onchange="PieceState.notDone=this.checked;_redrawPieces()"> Not done only</label>
    </div>
    ${canMark ? `<div class="pc-tools"><span class="small"><strong>${sel.length}</strong> ticked</span>
      <select id="pcBulkStage">${codes.filter(pmesStageAllowed).map((c) => `<option ${PieceState.stage === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}</select>
      <button class="btn primary sm" ${sel.length ? '' : 'disabled'} onclick="pieceMark(Object.keys(PieceState.sel).filter(k=>PieceState.sel[k]),document.getElementById('pcBulkStage').value)">Mark ticked done</button>
      <button class="btn outline sm" onclick="document.querySelectorAll('.pc-sel').forEach(i=>{PieceState.sel[i.value]=true});_redrawPieces()">Tick all shown</button>
      <button class="btn outline sm" ${sel.length ? '' : 'disabled'} onclick="PieceState.sel={};_redrawPieces()">Clear</button></div>` : ''}
    <div style="overflow-x:auto;"><table class="comp-table pc-table"><thead><tr>${canMark ? '<th></th>' : ''}<th>Part</th><th>Piece</th><th>Size</th>${head}<th>Now at</th></tr></thead><tbody>
      ${rows.map((c) => { const L = _pieceLabel(c);
        return `<tr class="${c.status === 'complete' ? 'pc-fin' : ''}">${canMark ? `<td><input type="checkbox" class="pc-sel" value="${c.id}" ${PieceState.sel[c.id] ? 'checked' : ''} onchange="PieceState.sel['${c.id}']=this.checked;_redrawPieces()"></td>` : ''}
          <td><strong>${escapeHtml(L.part || '—')}</strong></td><td>${escapeHtml(L.name)}<div class="small mono">${escapeHtml(c.scan_code || c.full_barcode_id)}</div></td><td class="small">${escapeHtml(L.size)}</td>
          ${codes.map((code) => cell(c, code)).join('')}
          <td>${c.status === 'complete' ? '<span class="badge green">Finished</span>' : c.status === 'scrapped' ? '<span class="badge red">Scrapped</span>' : (c.current_stage_code ? '<span class="badge amber">' + escapeHtml(c.current_stage_code) + '</span>' : '<span class="badge gray">Not started</span>')}</td></tr>`; }).join('')
        || `<tr><td colspan="${codes.length + 5}" class="small">No pieces match.</td></tr>`}
    </tbody></table></div></div>`;
}
function _redrawPieces() {
  const box = document.getElementById('pcBox'), d = State.jd; if (!box || !d) return;
  const f = document.activeElement && document.activeElement.closest('#pcBox') && document.activeElement.type === 'text';
  box.innerHTML = renderPieceMatrix(d.job, d.stages, d.components, d.done);
  if (f) { const i = box.querySelector('.pc-tools input[type=text]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }
}
async function _reloadPieces(jobId) {
  const d = State.jd; if (!d) return;
  const [done, components, stages] = await Promise.all([loadPieceDone(jobId), Data.listComponents(jobId), Data.listJobStages(jobId)]);
  d.done = done; d.components = components; d.stages = stages;
  drawJobTab();
}
async function pieceMark(ids, code) {
  if (!ids || !ids.length) return;
  try {
    const { data, error } = await sb.rpc('pmes_component_mark', { p_components: ids, p_stage: code, p_done: true, p_note: null, p_via: 'manual' });
    if (error) throw error;
    const sk = (data.skipped || []).length;
    toast(`${data.marked} piece(s) done at ${code} — ${data.done}/${data.planned}${sk ? ' · ' + sk + ' skipped (' + [...new Set(data.skipped.map((s) => s.why))].join(', ') + ')' : ''}.`, 'success');
    ids.forEach((i) => { delete PieceState.sel[i]; });
    await _reloadPieces(State.jd.job.id);
  } catch (e) { toast(e.message, 'error'); }
}
async function pieceUndo(id, code) {
  const why = prompt('This piece is NOT done at ' + code + ' after all? Say why (e.g. rework, chipped):');
  if (why === null) return;
  if (!why.trim()) return toast('A reason is needed to undo.', 'error');
  try {
    const { error } = await sb.rpc('pmes_component_mark', { p_components: [id], p_stage: code, p_done: false, p_note: why.trim(), p_via: 'manual' });
    if (error) throw error;
    toast('Undone at ' + code + '.', 'success'); await _reloadPieces(State.jd.job.id);
  } catch (e) { toast(e.message, 'error'); }
}
