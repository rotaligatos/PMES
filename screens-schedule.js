/* =====================================================================
   Screen: Schedule (Piece 3)
   Approved Job Orders, forward-scheduled per process against the
   company's process capacity (pmes_stage_capacity). Derived every time
   from the JOs and the confirmed output — nothing is stored yet.
   ===================================================================== */

const COMPANY_CODES = ['MSSI', 'WCLI', 'CWLI'];
function companyCodeOf(name) {
  const s = String(name || '').toLowerCase();
  if (!s.trim()) return '';
  return s.indexOf('cebu') >= 0 ? 'CWLI' : s.indexOf('module') >= 0 ? 'MSSI' : 'WCLI';
}
const SchedState = { company: null };
function schedCompany() {
  if (SchedState.company) return SchedState.company;
  return companyCodeOf(State.me && State.me.company) || 'MSSI';
}
function fmtDay(d) { return d ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—'; }

async function renderSchedule(main) {
  main.innerHTML = `<div class="empty"><p>Building the schedule…</p></div>`;
  const co = schedCompany();
  let caps = [], jobs = [];
  try {
    [caps, jobs] = await Promise.all([Data.listStageCapacity(co), Data.listJobs()]);
  } catch (e) { main.innerHTML = `<div class="empty"><div class="ic">⚠️</div><p>Could not load: ${escapeHtml(e.message)}</p></div>`; return; }
  const capacity = {}; caps.forEach((c) => { capacity[c.stage_code] = c; });
  const open = jobs.filter((j) => j.destination_company === co && j.jo_review_status === 'approved' && j.job_active && j.status !== 'handed_off');
  const bundles = await Promise.all(open.map(async (job) => {
    const [stages, components, outputs] = await Promise.all([Data.listJobStages(job.id), Data.listComponents(job.id), Data.listStageOutputs(job.id).catch(() => [])]);
    return { job, stages, components, outputs };
  }));
  const sched = PmesSchedule.forwardSchedule(bundles, capacity, new Date());
  const stageLabel = (code) => { const t = State.stageTypes.find((x) => x.code === code); return t ? t.label : code; };
  const codes = State.stageTypes.map((t) => t.code).filter((c) => sched.rows.some((r) => r.stage_code === c));
  const canPick = pmesCan('manager');

  const perJob = {};
  sched.rows.forEach((r) => { (perJob[r.job_code] = perJob[r.job_code] || []).push(r); });
  const jobTable = Object.keys(perJob).map((code) => {
    const rows = perJob[code], b = bundles.find((x) => x.job.job_code === code);
    const first = rows.find((r) => r.start), last = rows.slice().reverse().find((r) => r.end);
    return `<div class="card">
      <div class="flex-between"><h2 class="mb-0 mono" style="cursor:pointer" onclick="goToJob('${b.job.id}')">${escapeHtml(code)}</h2>
        <span class="small">${b.job.quotation_serial ? escapeHtml(b.job.quotation_serial) + ' · ' : ''}approved ${fmtDate(b.job.jo_approved_at)}${first ? ' · <strong>' + fmtDay(first.start) + ' → ' + fmtDay(last.end) + '</strong>' : ''}</span></div>
      <table class="comp-table" style="margin-top:8px;"><thead><tr><th>Process</th><th>Load</th><th>Left</th><th>Days</th><th>Start</th><th>End</th><th></th></tr></thead><tbody>
      ${rows.map((r) => `<tr style="${r.days ? '' : 'opacity:.6'}"><td>${escapeHtml(stageLabel(r.stage_code))}</td><td>${r.load} ${escapeHtml(r.unit)}</td><td>${r.remaining} ${escapeHtml(r.unit)}</td>
        <td>${r.days || '—'}</td><td>${fmtDay(r.start)}</td><td>${fmtDay(r.end)}</td><td class="small">${escapeHtml(r.note)}</td></tr>`).join('')}
      </tbody></table></div>`;
  }).join('');

  main.innerHTML = `
    <div class="flex-between" style="margin-bottom:10px;">
      <p class="page-sub mb-0">Approved Job Orders in approval order, each process booked against <strong>${co}</strong>'s capacity from ${fmtDay(sched.start)}. Sundays${caps.some((c) => c.workdays_per_week <= 5) ? ' (and Saturdays)' : ''} are skipped. Confirmed output shortens what is left.</p>
      ${canPick ? `<select onchange="SchedState.company=this.value;render()">${COMPANY_CODES.map((c) => `<option ${c === co ? 'selected' : ''}>${c}</option>`).join('')}</select>` : ''}
    </div>
    ${!caps.length ? `<div class="callout blocked">No process capacity is set for ${co} yet — go to IE → Process capacity${pmesCan('manager') ? ' and mirror it from Modcraft or type it in' : ' (a manager can set it)'}.</div>` : ''}
    <div class="card"><h2>Booked days by process</h2>
      ${codes.length ? `<div style="display:flex;flex-wrap:wrap;gap:12px;margin-top:8px;">${codes.map((c) => { const b = sched.byStage[c], cap = capacity[c];
        return `<div style="min-width:150px;"><div class="small"><strong>${escapeHtml(stageLabel(c))}</strong></div><div style="font-size:20px;font-weight:800;color:var(--navy)">${b ? b.days : 0} <span class="small">day${b && b.days === 1 ? '' : 's'}</span></div>
          <div class="small">${b ? b.jobs + ' job' + (b.jobs === 1 ? '' : 's') : 'idle'} · ${cap && cap.daily_capacity > 0 ? cap.daily_capacity + ' ' + escapeHtml(cap.unit) + '/day' : '<span style="color:var(--red)">no capacity</span>'}</div></div>`; }).join('')}</div>`
      : '<p class="small">Nothing to schedule.</p>'}
    </div>
    ${jobTable || `<div class="empty"><div class="ic">📅</div><p>No approved Job Orders for ${co}.</p><p class="small">A JO appears here once staff have checked it and a supervisor has approved it.</p></div>`}
  `;
}

/* ---- Process capacity (the home of capacity; shown on the IE tab) ---- */
async function renderCapacityCard(el) {
  const co = schedCompany();
  let caps = [];
  try { caps = await Data.listStageCapacity(co); } catch (e) { el.innerHTML = `<div class="card"><p class="small">Could not load capacity: ${escapeHtml(e.message)}</p></div>`; return; }
  const byCode = {}; caps.forEach((c) => { byCode[c.stage_code] = c; });
  const canEdit = pmesCan('manager');
  el.innerHTML = `
    <div class="card">
      <div class="flex-between"><h2 class="mb-0">Process capacity — ${co}</h2>
        ${canEdit ? `<span><select id="capCo" onchange="SchedState.company=this.value;render()">${COMPANY_CODES.map((c) => `<option ${c === co ? 'selected' : ''}>${c}</option>`).join('')}</select>
          <button class="btn outline sm" onclick="mirrorCapacity('${co}')" title="Copy Modcraft's Services capacity in as the starting point. Rows you edited here are kept.">Mirror from Modcraft</button></span>` : ''}
      </div>
      <p class="small" style="margin-top:6px;">Per company. Daily capacity = teams × shifts × output per shift, in the unit the Job Order measures that process in. This is where capacity lives now; Modcraft's figure is only the starting point.</p>
      <div style="overflow-x:auto;"><table class="comp-table" style="margin-top:8px;"><thead><tr><th>Process</th><th>Unit</th><th>Teams</th><th>Shifts/day</th><th>Output/shift</th><th>Daily</th><th>Days/wk</th><th>Source</th>${canEdit ? '<th></th>' : ''}</tr></thead><tbody>
      ${State.stageTypes.map((t) => { const c = byCode[t.code] || {}; const id = 'cap_' + t.code;
        const cell = (f, v, step) => canEdit ? `<input type="number" id="${id}_${f}" value="${v == null ? '' : v}" min="0" step="${step}" style="width:80px;">` : (v == null ? '—' : v);
        return `<tr><td><strong>${escapeHtml(t.label)}</strong> <span class="small mono">${t.code}</span></td>
          <td>${canEdit ? `<input type="text" id="${id}_unit" value="${escapeHtml(c.unit || '')}" placeholder="pieces" style="width:70px;">` : escapeHtml(c.unit || '—')}</td>
          <td>${cell('teams', c.teams, '0.5')}</td><td>${cell('shifts', c.shifts_per_day, '0.5')}</td><td>${cell('output', c.output_per_shift, '0.01')}</td>
          <td><strong>${c.daily_capacity != null ? Number(c.daily_capacity).toFixed(2) : '—'}</strong></td>
          <td>${canEdit ? `<select id="${id}_wk"><option value="6" ${(c.workdays_per_week || 6) === 6 ? 'selected' : ''}>6</option><option value="5" ${c.workdays_per_week === 5 ? 'selected' : ''}>5</option></select>` : (c.workdays_per_week || '—')}</td>
          <td class="small">${c.source ? `<span class="badge ${c.source === 'modcraft' ? 'blue' : 'green'}">${c.source}</span>` : '<span class="badge gray">not set</span>'}${c.source_note ? '<br>' + escapeHtml(c.source_note) : ''}</td>
          ${canEdit ? `<td><button class="btn primary sm" onclick="saveCapacity('${co}','${t.code}')">Save</button></td>` : ''}</tr>`; }).join('')}
      </tbody></table></div>
    </div>`;
}
async function saveCapacity(co, code) {
  const g = (f) => document.getElementById('cap_' + code + '_' + f);
  const num = (f) => { const v = g(f).value; return v === '' ? null : Number(v); };
  try {
    await Data.setStageCapacity(co, code, g('unit').value.trim(), num('teams'), num('shifts'), num('output'), parseInt(g('wk').value, 10), '');
    toast('Capacity saved for ' + code + '.', 'success'); render();
  } catch (e) { toast(e.message, 'error'); }
}
async function mirrorCapacity(co) {
  if (!confirm('Copy Modcraft\'s Services capacity into ' + co + '? Rows you have edited here are kept.')) return;
  try { const r = await Data.mirrorCapacity(co, false); toast('Mirrored ' + r.written + ' process(es)' + (r.kept_pmes_edits ? ', kept ' + r.kept_pmes_edits + ' PMES edit(s)' : '') + '.', 'success'); render(); }
  catch (e) { toast(e.message, 'error'); }
}
