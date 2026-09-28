/* --------------------------- Screen: Materials ---------------------------
   The materials person's page (Rommel 2026-09-27: receiving belongs on its own page, not inside
   each job). Across all open jobs: what the warehouse has processed and still needs confirming,
   boards still to inspect, and extra-board requests in progress. One call: pmes_materials_inbox. */

async function renderMaterials(main) {
  let co = null;
  try { co = localStorage.getItem('pmes_dash_co'); } catch (e) {}
  if (co === null) co = _dashCoKey(State.me && State.me.company);
  let onlyAction = true;
  try { onlyAction = localStorage.getItem('pmes_mat_all') !== '1'; } catch (e) {}
  main.innerHTML = `
    <div class="flex-between" style="margin-bottom:10px;gap:8px;flex-wrap:wrap;">
      <p class="page-sub" style="margin:0;">Receive what the warehouse sent, inspect boards, follow extra-board requests.</p>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <label class="small" style="display:flex;gap:6px;align-items:center;"><input type="checkbox" id="matOnly" ${onlyAction ? 'checked' : ''}> Needs action only</label>
        <select id="matCo" style="width:auto;min-width:160px;"><option value="">All plants</option><option value="MSSI">MSSI</option><option value="WCLI">WCLI</option><option value="CWLI">CWLI</option></select>
      </div>
    </div>
    <div id="matBody"><div class="empty"><p>Loading…</p></div></div>`;
  const sel = document.getElementById('matCo'), chk = document.getElementById('matOnly');
  sel.value = co || '';
  sel.onchange = () => { try { localStorage.setItem('pmes_dash_co', sel.value); } catch (e) {} drawMaterials(); };
  chk.onchange = () => { try { localStorage.setItem('pmes_mat_all', chk.checked ? '0' : '1'); } catch (e) {} drawMaterials(); };
  await drawMaterials();
}

async function drawMaterials() {
  const box = document.getElementById('matBody'); if (!box) return;
  const co = document.getElementById('matCo').value, onlyAction = document.getElementById('matOnly').checked;
  const { data, error } = await sb.rpc('pmes_materials_inbox', { p_company: co || null });
  if (error) { box.innerHTML = `<div class="callout blocked">Could not load: ${escapeHtml(error.message)}</div>`; return; }
  const jobs = data || [];
  const toReceive = (j) => (j.mrs || []).filter((m) => ['partially_issued', 'issued', 'partially_received'].includes(m.status)).length;
  const toInspect = (j) => Math.max(0, (j.boards_planned || 0) - (j.boards_inspected || 0));
  const needs = (j) => toReceive(j) > 0 || toInspect(j) > 0 || (j.board_requests_open || 0) > 0;
  const tot = { recv: jobs.reduce((n, j) => n + toReceive(j), 0), insp: jobs.reduce((n, j) => n + toInspect(j), 0),
    req: jobs.reduce((n, j) => n + (j.board_requests_open || 0), 0),
    wait: jobs.reduce((n, j) => n + (j.mrs || []).filter((m) => m.status === 'authorized').length, 0) };
  const shown = jobs.filter((j) => !onlyAction || needs(j));
  const matLbl = { complete: ['green', 'Materials complete'], partial: ['amber', 'Materials partial'], none: ['red', 'Materials not received'], no_mrf: ['gray', 'No MRF'] };
  box.innerHTML = `
    <div class="stat-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));">
      <div class="stat-box" style="${tot.recv ? 'border:2px solid var(--amber,#d97706);' : ''}"><div class="num">${tot.recv}</div><div class="lbl">MRFs to receive</div><div class="small">Warehouse processed — confirm what arrived</div></div>
      <div class="stat-box"><div class="num">${tot.wait}</div><div class="lbl">Waiting for the warehouse</div><div class="small">Authorized, not yet processed</div></div>
      <div class="stat-box" style="${tot.insp ? 'border:2px solid var(--amber,#d97706);' : ''}"><div class="num">${tot.insp}</div><div class="lbl">Boards to inspect</div><div class="small">Planned boards not yet inspected</div></div>
      <div class="stat-box"><div class="num">${tot.req}</div><div class="lbl">Extra-board requests open</div><div class="small">Supervisor / manager / KEYSTONE</div></div>
    </div>
    ${shown.length ? shown.map((j) => {
      const m = matLbl[j.material_state] || ['gray', j.material_state];
      const insp = toInspect(j);
      return `<div class="card">
        <div class="flex-between" style="gap:8px;flex-wrap:wrap;">
          <div><strong class="mono">${escapeHtml(j.job_code)}</strong> <span class="badge ${m[0]}">${m[1]}</span>
            <div class="small">${escapeHtml(j.client || '—')}${j.project ? ' — ' + escapeHtml(j.project) : ''}${j.serial ? ' · ' + escapeHtml(j.serial) : ''} · ${escapeHtml(j.company || '')}</div></div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            ${j.boards_planned ? `<button class="btn ${insp ? 'primary' : 'outline'} sm" onclick="goToBoards('${j.job_id}','bdInspect')">Inspect boards (${j.boards_inspected}/${j.boards_planned})${j.boards_rejected ? ', ' + j.boards_rejected + ' rejected' : ''}</button>${_bdCanRun() ? `<button class="btn outline sm" onclick="goToBoards('${j.job_id}','bdOptimize')">Cutting optimizer</button>` : ''}` : ''}
            ${j.board_requests_open ? `<button class="btn outline sm" onclick="goToBoards('${j.job_id}','bdOptimize')">${j.board_requests_open} extra-board request(s)</button>` : ''}
            <button class="btn outline sm" onclick="goToJob('${j.job_id}','materials')">Open job</button>
          </div>
        </div>
        ${(j.mrs || []).length ? renderMRBlocks(j.mrs) : '<p class="small" style="margin-top:8px;">No MRF on this job.</p>'}
      </div>`;
    }).join('') : `<div class="empty"><div class="ic">✅</div><p>${onlyAction ? 'Nothing waiting on materials.' : 'No open jobs.'}</p></div>`}`;
}
