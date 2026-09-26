/* --------------------------- 8. Screen: Setup --------------------------- */

async function renderSettings(main) {
  main.innerHTML = `
    ${pmesCan('admin') ? '<div class="card" id="pmesUsersCard"><h2>Production users</h2><p class="small">Loading…</p></div>' : ''}
    <p class="page-sub">Editable lookup tables that drive routing and component IDs — nothing here is hardcoded (Section 4 / 8c).</p>

    <div class="card">
      <div class="flex-between">
        <h2 class="mb-0">Route mappings (${State.routeMappings.length})</h2>
      </div>
      ${State.routeMappings.map((r) => `
        <div style="padding:10px 0;border-bottom:1px solid var(--border);">
          <div style="font-weight:700;font-size:13px;">${escapeHtml(r.label)}</div>
          <div class="route-flow" style="margin-top:6px;">
            ${r.stage_sequence.map((s, i) => `<span class="route-step">${s}</span>` + (i < r.stage_sequence.length - 1 ? '<span class="route-arrow">→</span>' : '')).join('')}
          </div>
        </div>
      `).join('')}
      <p class="hint" style="margin-top:10px;">Adding a new route (e.g. "Route 6") means adding a row here — no schema change (Section 4).</p>
    </div>

    <div class="card">
      <h2>Stage types (${State.stageTypes.length})</h2>
      <table class="comp-table">
        <thead><tr><th>Code</th><th>Label</th></tr></thead>
        <tbody>
          ${State.stageTypes.map((s) => `<tr><td class="id">${s.code}</td><td>${escapeHtml(s.label)}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>

    <div class="card">
      <h2>Areas (${State.areas.length})</h2>
      <table class="comp-table">
        <thead><tr><th>Code</th><th>Label</th></tr></thead>
        <tbody>
          ${State.areas.map((a) => `<tr><td class="id">${a.code}</td><td>${escapeHtml(a.label)}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>

    <div class="card">
      <h2>Part types (${State.partTypes.length})</h2>
      <table class="comp-table">
        <thead><tr><th>Code</th><th>Label</th></tr></thead>
        <tbody>
          ${State.partTypes.map((p) => `<tr><td class="id">${p.code}</td><td>${escapeHtml(p.label)}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>

    <div class="card">
      <h2>About this build</h2>
      <p class="small">ModCraft PMES v1 — standalone build. Connected to the shared ModCraft Supabase project
      (<span class="mono">nkpekroogqsmfilypowd</span>) using <span class="mono">pmes_</span>-prefixed tables.</p>
      <p class="small" style="margin-top:8px;">ModCraft linkage (live quotation/cutting-list ingestion), Cabinet Vision
      import, Odoo sync, and PPIC integration are intentionally deferred — see MODCRAFT_BRIDGE_NOTES.md and
      PRODUCTION_CONTEXT.md Section 9 for the full v1 scope boundary.</p>
    </div>
  `;
  if (pmesCan('admin')) renderPmesUsers();
}

/* ---- Production users (PMES admin). Same list the Command Center manages. ---- */
const PMES_ROLES = ['staff', 'operator', 'supervisor', 'manager', 'admin'];

async function renderPmesUsers() {
  const box = document.getElementById('pmesUsersCard');
  if (!box) return;
  const { data, error } = await sb.from('pmes_users').select('*').order('active', { ascending: false }).order('name');
  if (error) { box.innerHTML = `<h2>Production users</h2><div class="callout blocked">Could not load: ${escapeHtml(error.message)}</div>`; return; }
  const stageOpts = (sel) => State.stageTypes.map((st) =>
    `<label style="display:inline-flex;gap:4px;margin:2px 8px 2px 0;font-size:12px"><input type="checkbox" value="${st.code}" ${sel.includes(st.code) ? 'checked' : ''}>${st.code}</label>`).join('');
  box.innerHTML = `
    <h2>Production users (${data.filter((u) => u.active).length} active)</h2>
    <p class="small">Operators log work only at the stations ticked (none ticked = any station). Changes are logged.</p>
    <table class="comp-table">
      <thead><tr><th>Name / email</th><th>Role</th><th>Stations</th><th>Active</th><th></th></tr></thead>
      <tbody>
        ${data.map((u) => `
          <tr data-email="${escapeHtml(u.email)}" style="${u.active ? '' : 'opacity:.55'}">
            <td><input class="pu-name" value="${escapeHtml(u.name)}" style="width:100%"><div class="small mono">${escapeHtml(u.email)}</div></td>
            <td><select class="pu-role">${PMES_ROLES.map((r) => `<option ${r === u.role ? 'selected' : ''}>${r}</option>`).join('')}</select></td>
            <td class="pu-stations">${stageOpts(u.stations || [])}</td>
            <td><input type="checkbox" class="pu-active" ${u.active ? 'checked' : ''}></td>
            <td><button class="btn outline" onclick="savePmesUser(this)">Save</button></td>
          </tr>`).join('')}
      </tbody>
    </table>
    <h2 style="margin-top:14px">Add a user</h2>
    <input id="puNewEmail" placeholder="company email" style="margin-bottom:6px">
    <input id="puNewName" placeholder="name" style="margin-bottom:6px">
    <select id="puNewRole">${PMES_ROLES.map((r) => `<option>${r}</option>`).join('')}</select>
    <div id="puNewStations" style="margin:6px 0">${stageOpts([])}</div>
    <button class="btn primary block" onclick="addPmesUser()">Add user</button>`;
}

function _puStations(el) {
  return [...el.querySelectorAll('input[type=checkbox]:checked')].map((c) => c.value);
}

async function savePmesUser(btn) {
  const tr = btn.closest('tr');
  const email = tr.dataset.email;
  if (email === State.me.email && tr.querySelector('.pu-role').value !== 'admin'
      && !confirm('You are removing your own admin role. Continue?')) return;
  const { error } = await sb.from('pmes_users').update({
    name: tr.querySelector('.pu-name').value.trim(),
    role: tr.querySelector('.pu-role').value,
    stations: _puStations(tr.querySelector('.pu-stations')),
    active: tr.querySelector('.pu-active').checked,
  }).eq('email', email);
  if (error) return toast('Could not save: ' + error.message, 'error');
  toast('Saved ' + email, 'success');
  renderPmesUsers();
}

async function addPmesUser() {
  const email = document.getElementById('puNewEmail').value.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return toast('Enter a valid email.', 'error');
  const { error } = await sb.from('pmes_users').insert({
    email,
    name: document.getElementById('puNewName').value.trim(),
    role: document.getElementById('puNewRole').value,
    stations: _puStations(document.getElementById('puNewStations')),
  });
  if (error) return toast(error.code === '23505' ? 'That email is already on the list.' : 'Could not add: ' + error.message, 'error');
  toast('Added ' + email, 'success');
  renderPmesUsers();
}
