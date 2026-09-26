/* --------------------------- Screen: Dashboard ---------------------------
   PMES home (Rommel 2026-09-27). What needs doing now — the tiles for the signed-in person's role
   are marked "your action" — and where every open job stands. One call: pmes_dashboard(company). */

function _dashCoKey(name) {
  const s = String(name || '').toLowerCase();
  return s.includes('cebu') ? 'CWLI' : s.includes('module') ? 'MSSI' : s.includes('world class') ? 'WCLI' : '';
}

async function renderDashboard(main) {
  let co = '';
  try { co = localStorage.getItem('pmes_dash_co'); } catch (e) {}
  if (co === null || co === undefined) co = _dashCoKey(State.me && State.me.company);
  main.innerHTML = `
    <div class="flex-between" style="margin-bottom:10px;gap:8px;flex-wrap:wrap;">
      <p class="page-sub" style="margin:0;">Hello ${escapeHtml((State.me && (State.me.name || State.me.email)) || '')} — here is what needs doing.</p>
      <select id="dashCo" style="width:auto;min-width:180px;">
        <option value="">All plants</option><option value="MSSI">MSSI</option><option value="WCLI">WCLI</option><option value="CWLI">CWLI</option>
      </select>
    </div>
    <div id="dashBody"><div class="empty"><p>Loading…</p></div></div>`;
  const sel = document.getElementById('dashCo');
  sel.value = co || '';
  sel.onchange = () => { try { localStorage.setItem('pmes_dash_co', sel.value); } catch (e) {} drawDashboard(sel.value); };
  await drawDashboard(sel.value);
}

async function drawDashboard(co) {
  const box = document.getElementById('dashBody');
  if (!box) return;
  const { data, error } = await sb.rpc('pmes_dashboard', { p_company: co || null });
  if (error) { box.innerHTML = `<div class="callout blocked">Could not load the dashboard: ${escapeHtml(error.message)}</div>`; return; }
  const c = data.counts || {}, jobs = data.jobs || [];
  const role = (State.me && State.me.role) || '', acting = State.me && State.me.acting_for;
  const isSup = pmesCan('supervisor') || !!acting, isMgr = pmesCan('manager') || !!acting;
  // Which tiles are this person's to act on.
  const mine = {
    to_check: ['staff', 'supervisor', 'manager', 'admin'].includes(role),
    to_approve: isSup, to_manager: isMgr, returned: isSup,
    output_to_confirm: isSup, mrf_to_receive: role === 'materials' || isSup, board_requests: isSup,
  };
  const tiles = [
    ['to_check', 'Job Orders to check', 'Received — staff check details and materials'],
    ['to_approve', 'Waiting for approval', 'Checked — a supervisor approves'],
    ['to_manager', 'Waiting for a manager', 'Incomplete materials — second approval'],
    ['returned', 'Returned', 'Sent back to staff or Modcraft'],
    ['mrf_to_receive', 'Materials to receive', 'Issued by the warehouse, not yet received'],
    ['output_to_confirm', 'Output to confirm', 'Entered, waiting for a supervisor'],
    ['board_requests', 'Board requests pending', 'Extra boards awaiting a decision'],
    ['in_production', 'In production', 'Approved for the line'],
    ['handed_off_30d', 'Handed off (30 days)', 'Completed and handed over'],
  ];
  const tile = ([k, label, hint]) => {
    const n = c[k] || 0, act = mine[k] && n > 0;
    return `<div class="stat-box" style="${act ? 'border:2px solid var(--amber,#d97706);' : ''}">
      <div class="num">${n}</div><div class="lbl">${label}</div>
      <div class="small" style="margin-top:4px;">${hint}${act ? ' · <strong>your action</strong>' : ''}</div></div>`;
  };
  const reviewLbl = { received: ['amber', 'To check'], checked: ['blue', 'To approve'], supervisor_ok: ['amber', 'To manager'],
    approved: ['green', 'Approved'], returned: ['red', 'Returned'] };
  const matLbl = { complete: ['green', 'Materials complete'], partial: ['amber', 'Materials partial'], none: ['red', 'Materials not received'], no_mrf: ['gray', 'No MRF'] };
  const badge = (m, k) => { const v = m[k]; return v ? `<span class="badge ${v[0]}">${v[1]}</span>` : ''; };
  const rows = jobs.map((j) => {
    const pct = j.planned > 0 ? Math.round(j.done / j.planned * 100) : 0;
    return `<tr style="cursor:pointer" onclick="goToJob('${j.id}')">
      <td><strong class="mono">${escapeHtml(j.job_code)}</strong><div class="small">${escapeHtml(j.serial || '')}</div></td>
      <td>${escapeHtml(j.client || '—')}${j.project ? '<div class="small">' + escapeHtml(j.project) + '</div>' : ''}</td>
      <td>${escapeHtml(j.company || '')}</td>
      <td>${badge(reviewLbl, j.review)} ${badge(matLbl, j.material)}</td>
      <td style="min-width:140px;">
        <div style="height:8px;background:var(--border,#e4e9ee);border-radius:4px;overflow:hidden;"><i style="display:block;height:100%;width:${pct}%;background:var(--green,#1e7a45);"></i></div>
        <div class="small">${pct}% · ${j.stages_done}/${j.stages} processes${j.next_stage && j.review === 'approved' ? ' · next ' + escapeHtml(j.next_stage) : ''}</div></td>
    </tr>`;
  }).join('');
  box.innerHTML = `
    <div class="stat-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));">${tiles.map(tile).join('')}</div>
    <div class="card" style="padding:0;margin-top:12px;">
      <div style="padding:16px 16px 6px;"><h2 class="mb-0">Open jobs (${jobs.length})</h2>
        <p class="small">Tap a job to open it. Progress = confirmed output against the pieces planned for every process.</p></div>
      ${jobs.length ? `<table class="comp-table"><thead><tr><th>Job</th><th>Client / project</th><th>Plant</th><th>Status</th><th>Progress</th></tr></thead><tbody>${rows}</tbody></table>`
        : '<div class="empty"><p>No open jobs for this plant.</p></div>'}
    </div>`;
}
