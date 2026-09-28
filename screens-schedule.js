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

// renderSchedule lives in screens-planboard.js (loading schedule per Job Order, 2026-09-28).

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
