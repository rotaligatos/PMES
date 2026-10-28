/* --------------------------- Screen: My work ---------------------------
   Phase 3 of the department restructure (2026-10-29). Each person's queue: the open jobs with a
   step THEY can act on now, from pmes_my_work (built on pmes_job_flow, so it always agrees with
   the job page and the job status). Every job shows the same 5-step strip; your step is the button,
   the rest is a read-only guide to where the job is. */

const MW_STATE = { done: ['green', 'Done'], now: ['amber', 'In progress'], wait: ['gray', 'Waiting'], block: ['red', 'Needs attention'], na: ['gray', 'Not needed'] };

async function renderMyWork(main) {
  let co = null;
  try { co = localStorage.getItem('pmes_dash_co'); } catch (e) {}
  if (co === null && typeof _dashCoKey === 'function') co = _dashCoKey(State.me && State.me.company);
  const info = (State.me && State.me.role_info) || {};
  main.innerHTML = `
    <div class="flex-between" style="margin-bottom:10px;gap:8px;flex-wrap:wrap;">
      <p class="page-sub" style="margin:0;">${escapeHtml(info.label || pmesRoleLabel((State.me && State.me.role) || ''))} — jobs waiting on you. Tap your step to open it.</p>
      <select id="mwCo" style="width:auto;min-width:160px;">
        <option value="">All plants</option><option value="MSSI">MSSI</option><option value="WCLI">WCLI</option><option value="CWLI">CWLI</option>
      </select>
    </div>
    <div id="mwBody"><div class="empty"><p>Loading…</p></div></div>`;
  const sel = document.getElementById('mwCo');
  sel.value = co || '';
  sel.onchange = () => { try { localStorage.setItem('pmes_dash_co', sel.value); } catch (e) {} drawMyWork(); };
  await drawMyWork();
}

async function drawMyWork() {
  const box = document.getElementById('mwBody'); if (!box) return;
  const co = document.getElementById('mwCo').value;
  const { data, error } = await sb.rpc('pmes_my_work', { p_company: co || null });
  if (error) { box.innerHTML = `<div class="callout blocked">Could not load your work: ${escapeHtml(error.message)}</div>`; return; }
  const rows = data || [];
  if (!rows.length) {
    box.innerHTML = `<div class="empty"><div class="ic">✓</div><p><strong>Nothing is waiting on you right now.</strong></p>
      <p class="small">Jobs appear here when they reach your step. <a href="#" onclick="goToScreen('jobs');return false;">See all jobs</a></p></div>`;
    return;
  }
  const n = rows.reduce((t, r) => t + (r.mine || []).length, 0);
  box.innerHTML = `<p class="small" style="margin:0 0 8px;">${n} step${n === 1 ? '' : 's'} on ${rows.length} job${rows.length === 1 ? '' : 's'}</p>` + rows.map(mwCard).join('');
}

function mwCard(r) {
  const sub = [r.client, r.project].filter(Boolean).map(escapeHtml).join(' — ');
  const w = r.waiting_on;
  const mine = (r.mine || []).map((m) => {
    const c = MW_STATE[m.state] || MW_STATE.wait;
    return `<button class="mw-act ${m.state}" onclick="goToJob('${r.job_id}','${m.key}')">
      <span class="mw-act-t"><strong>${escapeHtml(m.why)}</strong> <span class="badge ${c[0]}">${c[1]}</span></span>
      <span class="small">Step ${m.n} · ${escapeHtml(m.title)} — ${escapeHtml(m.note || '')}</span>
      <span class="mw-go">Open →</span></button>`;
  }).join('');
  const strip = (r.steps || []).map((s) => `<span class="mw-seg ${s.state}" title="${escapeHtml(s.n + ' ' + s.title + ' · ' + s.dept + ' · ' + s.team + ' — ' + (s.note || ''))}">
      <span class="mw-seg-bar"></span><span class="mw-seg-l">${s.n} ${escapeHtml(s.title)}</span></span>`).join('');
  return `<div class="card mw-card">
    <div class="flex-between" style="gap:8px;flex-wrap:wrap;">
      <div><strong class="mono" style="cursor:pointer" onclick="goToJob('${r.job_id}','overview')">${escapeHtml(r.job_code)}</strong>
        ${r.is_test ? '<span class="badge test-tag" title="Test quotation — not a real job">TEST</span>' : ''} ${badgeForDest(r.destination)}
        ${r.released ? '' : '<span class="badge gray" title="KEYSTONE has not released it (payment)">Not released</span>'}
        ${sub ? `<div class="small">${sub}</div>` : ''}</div>
    </div>
    <div class="mw-strip">${strip}</div>
    ${w ? `<p class="small" style="margin:4px 0 8px;">Job is waiting on <strong>${escapeHtml(w.dept)} · ${escapeHtml(w.team)}</strong></p>` : ''}
    <div class="mw-acts">${mine}</div>
  </div>`;
}
