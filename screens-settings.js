/* --------------------------- 8. Screen: Setup --------------------------- */

async function renderSettings(main) {
  main.innerHTML = `
    ${pmesCan('admin') ? '<div class="card" id="pmesUsersCard"><h2>Production users</h2><p class="small">Loading…</p></div>' : ''}
    ${pmesCan('manager') || (State.me && State.me.acting_for) ? '<div class="card" id="pmesDelegCard"><h2>Approval delegation</h2><p class="small">Loading…</p></div>' : ''}
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
  if (document.getElementById('pmesDelegCard')) renderDelegations();
}

/* ---- Approval delegation. A manager hands their Job Order approval authority to a named person for
   a period (leave, site visit). Enforced in the database (pmes_delegate_create / pmes_jo_approve);
   the approval history then says "On behalf of …". History is kept: ended, never deleted. ---- */
async function renderDelegations() {
  const box = document.getElementById('pmesDelegCard');
  if (!box) return;
  const [dq, uq] = await Promise.all([
    sb.from('pmes_delegations').select('*').order('starts_at', { ascending: false }).limit(40),
    sb.from('pmes_users').select('email,name,role,active').eq('active', true).order('name'),
  ]);
  if (dq.error || uq.error) { box.innerHTML = `<h2>Approval delegation</h2><div class="callout blocked">Could not load: ${escapeHtml((dq.error || uq.error).message)}</div>`; return; }
  const users = uq.data || [], nameOf = (e) => ((users.find((u) => u.email === e) || {}).name || e);
  const me = State.me.email, isAdmin = pmesCan('admin'), now = Date.now();
  const status = (d) => d.revoked_at ? ['gray', 'Ended ' + fmtDate(d.revoked_at)]
    : new Date(d.ends_at) <= now ? ['gray', 'Expired'] : new Date(d.starts_at) > now ? ['blue', 'Upcoming'] : ['green', 'Active'];
  const mine = (dq.data || []).filter((d) => isAdmin || d.from_email === me || d.to_email === me);
  const managers = users.filter((u) => ['manager', 'admin'].includes(u.role));
  const delegates = users.filter((u) => ['staff', 'supervisor', 'manager'].includes(u.role));
  const pad = (n) => String(n).padStart(2, '0');
  const local = (dt) => dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate()) + 'T' + pad(dt.getHours()) + ':' + pad(dt.getMinutes());
  const start = new Date(), end = new Date(Date.now() + 7 * 864e5);
  box.innerHTML = `
    <h2>Approval delegation</h2>
    <p class="small">When a manager is away, they can hand their Job Order approval authority to a named person for a set period
      (up to 60 days). Approvals made that way are recorded as “On behalf of …”. The two-person rule still applies.</p>
    ${State.me.acting_for ? `<div class="callout info" style="margin:8px 0;">You are currently approving on behalf of <strong>${escapeHtml(State.me.acting_for.name || State.me.acting_for.email)}</strong> until ${fmtDate(State.me.acting_for.until)}.</div>` : ''}
    ${pmesCan('manager') ? `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;margin:10px 0;">
        <div><label class="field-label">Manager</label>
          ${isAdmin ? `<select id="dgFrom">${managers.map((u) => `<option value="${escapeHtml(u.email)}" ${u.email === me ? 'selected' : ''}>${escapeHtml(u.name || u.email)}</option>`).join('')}</select>`
                    : `<div style="padding:8px 0">${escapeHtml(State.me.name || me)}</div>`}</div>
        <div><label class="field-label">Delegate to</label>
          <select id="dgTo"><option value="">— choose —</option>${delegates.filter((u) => u.email !== me).map((u) => `<option value="${escapeHtml(u.email)}">${escapeHtml(u.name || u.email)} · ${u.role}</option>`).join('')}</select></div>
        <div><label class="field-label">From</label><input type="datetime-local" id="dgStart" value="${local(start)}"></div>
        <div><label class="field-label">Until</label><input type="datetime-local" id="dgEnd" value="${local(end)}"></div>
      </div>
      <input type="text" id="dgReason" placeholder="Reason (e.g. on leave, site visit)">
      <button class="btn primary" style="margin-top:8px" onclick="submitDelegation()">Delegate approval</button>` : ''}
    <table class="comp-table" style="margin-top:12px">
      <thead><tr><th>Manager</th><th>Delegate</th><th>Period</th><th>Reason</th><th>Status</th><th></th></tr></thead>
      <tbody>${mine.length ? mine.map((d) => { const [c, t] = status(d); return `<tr>
        <td>${escapeHtml(nameOf(d.from_email))}</td><td>${escapeHtml(nameOf(d.to_email))}</td>
        <td class="small">${fmtDate(d.starts_at)} – ${fmtDate(d.ends_at)}</td><td class="small">${escapeHtml(d.reason)}${d.revoke_note ? '<br>Ended: ' + escapeHtml(d.revoke_note) : ''}</td>
        <td><span class="badge ${c}">${t}</span></td>
        <td>${!d.revoked_at && new Date(d.ends_at) > now ? `<button class="btn outline sm" onclick="endDelegation('${d.id}')">End now</button>` : ''}</td></tr>`; }).join('')
        : '<tr><td colspan="6" class="small">No delegations yet.</td></tr>'}</tbody>
    </table>`;
}

async function submitDelegation() {
  const from = document.getElementById('dgFrom') ? document.getElementById('dgFrom').value : State.me.email;
  const to = document.getElementById('dgTo').value;
  const s = document.getElementById('dgStart').value, e = document.getElementById('dgEnd').value;
  const reason = document.getElementById('dgReason').value.trim();
  if (!to) return toast('Choose who receives the approval authority.', 'error');
  if (!s || !e) return toast('Set the period.', 'error');
  if (!reason) return toast('Give the reason (e.g. on leave).', 'error');
  const { error } = await sb.rpc('pmes_delegate_create', { p_from: from, p_to: to, p_start: new Date(s).toISOString(), p_end: new Date(e).toISOString(), p_reason: reason });
  if (error) return toast(error.message, 'error');
  toast('Delegated. The person must reload PMES to see it.', 'success');
  renderDelegations();
}

async function endDelegation(id) {
  const note = prompt('End this delegation now? Optional note:');
  if (note === null) return;
  const { error } = await sb.rpc('pmes_delegate_revoke', { p_id: id, p_note: note });
  if (error) return toast(error.message, 'error');
  toast('Delegation ended.', 'success');
  renderDelegations();
}

/* ---- Production users (PMES admin). Same list the Command Center manages. ---- */
const PMES_ROLES = ['staff', 'materials', 'operator', 'supervisor', 'manager', 'admin'];

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
