/* =====================================================================
   Screen: Industrial Engineering
   Primary view is a single capacity sheet — Machine | Services |
   Capacity | UOM | Remarks — matching the person's own spreadsheet
   layout exactly, no tab-switching required to see it all at once.
   Machine detail (standard times, OEE) and line balancing are
   secondary views, reached from within the sheet.
   ===================================================================== */

const IEState = {
  view: 'sheet',           // 'sheet' | 'machineDetail' | 'balance'
  selectedMachineId: null,
};

async function renderIE(main) {
  main.innerHTML = `<div id="ieBody"></div>`;
  const body = document.getElementById('ieBody');

  if (IEState.view === 'machineDetail') {
    await renderMachineDetail(body, IEState.selectedMachineId);
  } else if (IEState.view === 'balance') {
    await renderLineBalancing(body);
  } else {
    await renderCapacitySheet(body);
  }
}

/* --------------------------- Capacity sheet (primary view) --------------------------- */

async function renderCapacitySheet(el) {
  el.innerHTML = `<div class="empty"><p>Loading capacity sheet…</p></div>`;

  let rows = [], machines = [];
  try {
    [rows, machines] = await Promise.all([Data.listServiceCapacityMap(), Data.listMachines()]);
  } catch (e) {
    el.innerHTML = `<div class="empty"><p>Could not load capacity data.</p></div>`;
    return;
  }

  // Group services by machine (machine-bound only get a machine row; labor-only get grouped under a virtual "— No machine (labor) —" bucket)
  const byMachine = {};
  const unassignedMachineBound = [];
  const laborOnly = [];

  rows.forEach((r) => {
    if (r.modcraft_machine_type && r.machine_id) {
      if (!byMachine[r.machine_id]) byMachine[r.machine_id] = { machine: machines.find((m) => m.id === r.machine_id), services: [] };
      byMachine[r.machine_id].services.push(r);
    } else if (r.modcraft_machine_type && !r.machine_id) {
      unassignedMachineBound.push(r);
    } else {
      laborOnly.push(r);
    }
  });

  const assignedCount = rows.filter((r) => r.machine_id).length;
  const machineBoundCount = rows.filter((r) => r.modcraft_machine_type).length;

  el.innerHTML = `
    <p class="page-sub">Machine, services, and capacity in one sheet — the source of truth for production capability.</p>

    <div class="stat-grid">
      <div class="stat-box"><div class="num">${rows.length}</div><div class="lbl">Total services</div></div>
      <div class="stat-box"><div class="num">${assignedCount}/${machineBoundCount}</div><div class="lbl">Machine-assigned</div></div>
      <div class="stat-box"><div class="num">${Object.keys(byMachine).length}</div><div class="lbl">Machines in use</div></div>
      <div class="stat-box"><div class="num">${laborOnly.length}</div><div class="lbl">Labor-only</div></div>
    </div>

    <div class="btn-row" style="margin-bottom:14px;">
      <button class="btn secondary sm" onclick="openAddMachineSheet()">+ Add machine</button>
      <button class="btn outline sm" onclick="goToLineBalancing()">Line balancing tools →</button>
    </div>

    <div class="sheet-scroll">
      <table class="sheet-table">
        <thead>
          <tr><th style="width:170px;">Machine</th><th>Services</th><th style="width:100px;">Capacity</th><th style="width:80px;">UOM</th><th style="width:160px;">Remarks</th></tr>
        </thead>
        <tbody id="sheetBody"></tbody>
      </table>
    </div>
  `;

  const tbody = document.getElementById('sheetBody');
  let html = '';

  // Machine-bound groups, each machine gets one merged cell down its service rows
  Object.values(byMachine).forEach(({ machine, services }) => {
    if (!machine) return;
    services.forEach((svc, i) => {
      html += `<tr class="${i === 0 ? 'group-start' : ''}">`;
      if (i === 0) {
        html += `
          <td class="machine-cell" rowspan="${services.length}">
            <div class="machine-thumb">${getMachineIllustration(machine.machine_type)}</div>
            <input type="text" class="machine-name-input" value="${escapeHtml(machine.name)}"
              onchange="renameMachine('${machine.id}', this.value)" />
            <div class="small" style="margin-top:2px;">${escapeHtml((MACHINE_TYPE_OPTIONS.find(t=>t.value===machine.machine_type)||{}).label || machine.machine_type)}</div>
            <button class="btn outline sm" style="margin-top:6px;padding:4px 8px;min-height:auto;font-size:10px;" onclick="openMachineDetail('${machine.id}')">Time studies →</button>
          </td>`;
      }
      html += renderServiceCells(svc, machine.id);
      html += `</tr>`;
    });
  });

  // Unassigned machine-bound services — need attention, own visual group
  if (unassignedMachineBound.length) {
    unassignedMachineBound.forEach((svc, i) => {
      html += `<tr class="${i === 0 ? 'group-start' : ''}">`;
      if (i === 0) {
        html += `
          <td class="machine-cell" rowspan="${unassignedMachineBound.length}" style="background:#fbe9e7;">
            <div class="small" style="font-weight:700;color:#a3291a;">⚠ Unassigned</div>
            <div class="small">(${escapeHtml(unassignedMachineBound[0].modcraft_machine_type)})</div>
          </td>`;
      }
      html += renderServiceCells(svc, null);
      html += `</tr>`;
    });
  }

  // Labor-only services, grouped under one visual "Others / Labor" block
  if (laborOnly.length) {
    laborOnly.forEach((svc, i) => {
      html += `<tr class="${i === 0 ? 'group-start' : ''}">`;
      if (i === 0) {
        html += `
          <td class="machine-cell" rowspan="${laborOnly.length}" style="background:#eef2f6;">
            <div style="font-weight:700;">Others</div>
            <div class="small">Labor / crew-based</div>
          </td>`;
      }
      html += renderServiceCells(svc, null);
      html += `</tr>`;
    });
  }

  tbody.innerHTML = html;
}

function renderServiceCells(r, machineId) {
  return `
    <td class="svc-cell">${escapeHtml(r.service_name)}</td>
    <td class="num-cell">
      <input type="number" class="cell-input" value="${r.display_capacity != null ? r.display_capacity : ''}"
        placeholder="—" onchange="updateCapacityCell(${r.price_service_id}, '${machineId || ''}', 'capacity', this.value)" />
    </td>
    <td>
      <input type="text" class="cell-input text-left" value="${escapeHtml(r.display_uom || '')}"
        placeholder="unit" onchange="updateCapacityCell(${r.price_service_id}, '${machineId || ''}', 'uom', this.value)" />
    </td>
    <td>
      <input type="text" class="cell-input text-left" value="${escapeHtml(r.remarks || '')}"
        placeholder="—" onchange="updateCapacityCell(${r.price_service_id}, '${machineId || ''}', 'remarks', this.value)" />
    </td>
  `;
}

async function renameMachine(machineId, newName) {
  const name = newName.trim();
  if (!name) return toast('Machine name cannot be empty.', 'error');
  try {
    await Data.updateMachine(machineId, { name });
    toast('Machine renamed.', 'success');
  } catch (e) {
    toast('Could not rename: ' + e.message, 'error');
    render();
  }
}

async function updateCapacityCell(priceServiceId, machineId, field, value) {
  try {
    if (!machineId) {
      // no assignment exists yet for this service (unassigned or labor-only) — need to
      // create the assignment row first before it can hold capacity/uom/remarks
      if (!value) return;
      toast('Assign a machine first, or this is a labor-only service — use "Set crew capacity" from the Services view.', 'error');
      return;
    }
    const patch = {};
    if (field === 'capacity') patch.capacity_override = value === '' ? null : parseFloat(value);
    if (field === 'uom') patch.uom_override = value || null;
    if (field === 'remarks') patch.remarks = value || null;

    const { error } = await sb.from(T('service_machine_assignments'))
      .update(patch).eq('price_service_id', priceServiceId).eq('machine_id', machineId);
    if (error) throw error;
    toast('Saved.', 'success');
  } catch (e) {
    console.error(e);
    toast('Could not save: ' + e.message, 'error');
  }
}

function openMachineDetail(machineId) {
  IEState.view = 'machineDetail';
  IEState.selectedMachineId = machineId;
  render();
}

function goToLineBalancing() {
  IEState.view = 'balance';
  render();
}

function backToSheet() {
  IEState.view = 'sheet';
  IEState.selectedMachineId = null;
  render();
}

function openAddMachineSheet() {
  openSheet(`
    <div class="sheet-title">Add machine</div>
    <label class="field-label">Name *</label>
    <input type="text" id="mName" placeholder="e.g. Panel Saw 3" />
    <label class="field-label">Machine type *</label>
    <select id="mType">
      ${MACHINE_TYPE_OPTIONS.map((t) => `<option value="${t.value}">${t.label}</option>`).join('')}
    </select>
    <label class="field-label">Related stage (optional)</label>
    <select id="mStage">
      <option value="">— none —</option>
      ${State.stageTypes.map((s) => `<option value="${s.code}">${s.code} — ${escapeHtml(s.label)}</option>`).join('')}
    </select>
    <label class="field-label">Location (optional)</label>
    <input type="text" id="mLocation" placeholder="e.g. Bay 2" />
    <button class="btn primary block" style="margin-top:16px;" onclick="submitAddMachine()">Add machine</button>
  `);
}

async function submitAddMachine() {
  const name = document.getElementById('mName').value.trim();
  const machine_type = document.getElementById('mType').value;
  const stage_code = document.getElementById('mStage').value || null;
  const location = document.getElementById('mLocation').value.trim() || null;
  if (!name) return toast('Machine name is required.', 'error');

  try {
    await Data.createMachine({ name, machine_type, stage_code, location });
    closeSheet();
    toast('Machine added.', 'success');
    render();
  } catch (e) {
    toast('Could not add machine: ' + e.message, 'error');
  }
}

/* --------------------------- Machine detail (time studies, OEE) --------------------------- */

async function renderMachineDetail(el, machineId) {
  let machine, standards;
  try {
    const machines = await Data.listMachines();
    machine = machines.find((m) => m.id === machineId);
    standards = await Data.listMachineStandards(machineId);
  } catch (e) {
    el.innerHTML = `<div class="empty"><p>Could not load machine.</p></div>`;
    return;
  }
  if (!machine) { el.innerHTML = `<div class="empty"><p>Machine not found.</p></div>`; return; }

  el.innerHTML = `
    <button class="btn outline sm" style="margin-bottom:12px;" onclick="backToSheet()">← Capacity sheet</button>

    <div class="machine-hero">
      <div class="illus">${getMachineIllustration(machine.machine_type)}</div>
      <div style="font-size:18px;font-weight:700;color:var(--navy);">${escapeHtml(machine.name)}</div>
      <div class="small">${escapeHtml((MACHINE_TYPE_OPTIONS.find(t => t.value === machine.machine_type) || {}).label || machine.machine_type)}${machine.location ? ' · ' + escapeHtml(machine.location) : ''}</div>
    </div>

    <div class="card">
      <div class="flex-between">
        <h2 class="mb-0">Standard times (${standards.length})</h2>
        <button class="btn secondary sm" onclick="openTimeStudySheet('${machine.id}')">+ Log time study</button>
      </div>
      ${standards.length ? standards.map((s) => `
        <div class="std-row">
          <div>
            <div class="op-name">${escapeHtml(s.operation_label)} ${s.cycle_time_source === 'time_study' ? `<span class="badge green" style="font-size:9px;">TIME STUDY (n=${s.observation_count})</span>` : `<span class="badge gray" style="font-size:9px;">MANUAL</span>`}</div>
            <div class="op-meta">Cycle ${Number(s.observed_cycle_time_sec).toFixed(2)}s · Rating ${s.performance_rating} · Allow ${(Number(s.personal_allowance_pct)+Number(s.fatigue_allowance_pct)+Number(s.delay_allowance_pct)).toFixed(0)}%</div>
          </div>
          <div>
            <div class="op-time">${Number(s.standard_time_sec).toFixed(1)}s</div>
            <div class="op-cap">${s.units_per_hour}/hr</div>
          </div>
          <button class="btn outline sm" onclick="openTimeStudySheet('${machine.id}','${s.operation_code}')" style="margin-left:8px;">View/Edit</button>
        </div>
      `).join('') : `<p class="small" style="margin-top:8px;">No standard times recorded yet for this machine. Tap "+ Log time study" to record real stopwatch readings.</p>`}
    </div>

    <div class="card">
      <div class="flex-between">
        <h2 class="mb-0">OEE — production runs</h2>
        <button class="btn secondary sm" onclick="openLogRunSheet('${machine.id}')">+ Log run</button>
      </div>
      <p class="small">Overall Equipment Effectiveness = Availability × Performance × Quality, from logged production runs.</p>
      <div id="runsList"></div>
    </div>

    <div class="card">
      <h2>Machine info</h2>
      <p class="small">${machine.notes ? escapeHtml(machine.notes) : 'No notes.'}</p>
    </div>
  `;

  renderRunsList(machine.id);
}

async function renderRunsList(machineId) {
  const el = document.getElementById('runsList');
  let runs = [];
  try { runs = await Data.listProductionRuns(machineId); } catch (e) { el.innerHTML = `<p class="small">Could not load runs.</p>`; return; }
  if (!runs.length) { el.innerHTML = `<p class="small" style="margin-top:8px;">No production runs logged yet.</p>`; return; }
  el.innerHTML = runs.slice(0, 8).map((r) => `
    <div class="std-row">
      <div>
        <div class="op-name">${fmtDate(r.run_date)} ${r.operation_label ? '· ' + escapeHtml(r.operation_label) : ''}</div>
        <div class="op-meta">${r.good_units}/${r.total_units_produced} good · ${r.downtime_min}min downtime of ${r.planned_time_min}min</div>
      </div>
      <div>
        <div class="op-time">${r.oee_pct != null ? r.oee_pct + '%' : '—'}</div>
        <div class="op-cap">OEE</div>
      </div>
    </div>
  `).join('');
}

/* --------------------------- Time study logging --------------------------- */

async function openTimeStudySheet(machineId, existingOpCode) {
  const operations = await Data.listOperations();
  let observations = [];
  let summary = null;
  if (existingOpCode) {
    [observations, summary] = await Promise.all([
      Data.listTimeObservations(machineId, existingOpCode),
      Data.getObservationSummary(machineId, existingOpCode),
    ]);
  }

  openSheet(`
    <div class="sheet-title">Time study</div>
    <p class="small" style="margin-bottom:14px;">
      Log each stopwatch reading separately. Readings more than 2 standard deviations from the
      mean are automatically flagged as outliers and excluded from the average.
    </p>
    <label class="field-label">Operation *</label>
    <select id="tsOperation" ${existingOpCode ? 'disabled' : ''} onchange="reloadTimeStudySheet('${machineId}')">
      <option value="">— select —</option>
      ${operations.map((o) => `<option value="${o.code}" ${existingOpCode === o.code ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
    </select>

    <div id="tsObservations">${renderObservationsList(observations)}</div>

    <div style="margin-top:14px;padding-top:14px;border-top:1px dashed var(--border);">
      <label class="field-label">Add reading (seconds)</label>
      <div class="btn-row">
        <input type="number" id="tsNewReading" min="0.1" step="0.1" placeholder="e.g. 35" style="flex:2;" />
        <input type="text" id="tsObservedBy" placeholder="Observed by" style="flex:2;" />
      </div>
      <button class="btn outline sm" style="margin-top:8px;" onclick="submitAddReading('${machineId}')">+ Add reading</button>
    </div>

    <div id="tsSummary" class="callout info" style="margin-top:14px;">${renderObservationSummaryBox(summary)}</div>

    ${summary && summary.accepted_count > 0 ? `
      <div style="margin-top:14px;padding-top:14px;border-top:1px dashed var(--border);">
        <p class="small" style="font-weight:700;margin-bottom:8px;">Standard time inputs (uses the accepted average above)</p>
        <label class="field-label">Performance rating</label>
        <input type="number" id="tsRating" min="0.1" step="0.01" value="1.0" />
        <div class="btn-row">
          <div style="flex:1;"><label class="field-label">Personal %</label><input type="number" id="tsPersonal" min="0" step="0.5" value="5" /></div>
          <div style="flex:1;"><label class="field-label">Fatigue %</label><input type="number" id="tsFatigue" min="0" step="0.5" value="4" /></div>
          <div style="flex:1;"><label class="field-label">Delay %</label><input type="number" id="tsDelay" min="0" step="0.5" value="3" /></div>
        </div>
        <div id="tsStdPreview" class="callout info" style="margin-top:10px;"></div>
        <button class="btn primary block" style="margin-top:10px;" onclick="submitStandardFromStudy('${machineId}')">Save as standard time</button>
      </div>
    ` : ''}
  `);

  if (summary && summary.accepted_count > 0) {
    const updatePreview = () => {
      const avg = Number(summary.avg_observed_time_sec);
      const rating = parseFloat(document.getElementById('tsRating').value) || 1;
      const p = parseFloat(document.getElementById('tsPersonal').value) || 0;
      const f = parseFloat(document.getElementById('tsFatigue').value) || 0;
      const d = parseFloat(document.getElementById('tsDelay').value) || 0;
      const normal = avg * rating;
      const std = normal * (1 + (p + f + d) / 100);
      document.getElementById('tsStdPreview').innerHTML =
        `Normal: <strong>${normal.toFixed(2)}s</strong> · Standard: <strong>${std.toFixed(2)}s</strong> · Capacity: <strong>${(3600/std).toFixed(1)}/hr</strong>`;
    };
    ['tsRating','tsPersonal','tsFatigue','tsDelay'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', updatePreview);
    });
    updatePreview();
  }

  window.__tsMachineId = machineId;
}

function renderObservationsList(observations) {
  if (!observations.length) return `<p class="small" style="margin-top:10px;">No readings logged yet for this operation.</p>`;
  return `
    <div style="margin-top:10px;max-height:200px;overflow-y:auto;">
      ${observations.map((o) => `
        <div class="flex-between" style="padding:6px 0;border-bottom:1px solid var(--border);font-size:13px;">
          <span class="mono">${Number(o.observed_time_sec).toFixed(1)}s</span>
          <span class="small">${o.observed_by ? escapeHtml(o.observed_by) : '—'}</span>
          ${o.is_outlier ? '<span class="badge red" style="font-size:9px;">OUTLIER</span>' :
            (o.excluded ? '<span class="badge gray" style="font-size:9px;">EXCLUDED</span>' : '<span class="badge green" style="font-size:9px;">OK</span>')}
          <button class="btn outline sm" style="padding:4px 8px;min-height:auto;font-size:11px;" onclick="removeObservation('${o.id}')">✕</button>
        </div>
      `).join('')}
    </div>
  `;
}

function renderObservationSummaryBox(summary) {
  if (!summary || summary.total_count === 0) return 'No readings yet — add at least 3 for outlier detection to activate.';
  return `Accepted: <strong>${summary.accepted_count}</strong> · Rejected: <strong>${summary.rejected_count}</strong> · Average: <strong>${summary.avg_observed_time_sec}s</strong> ${summary.stddev_observed_time_sec ? `(σ=${summary.stddev_observed_time_sec})` : ''}`;
}

async function reloadTimeStudySheet(machineId) {
  const opCode = document.getElementById('tsOperation').value;
  if (!opCode) return;
  openTimeStudySheet(machineId, opCode);
}

async function submitAddReading(machineId) {
  const opCode = document.getElementById('tsOperation').value;
  const reading = parseFloat(document.getElementById('tsNewReading').value);
  const observed_by = document.getElementById('tsObservedBy').value.trim() || null;
  if (!opCode) return toast('Select an operation first.', 'error');
  if (!reading || reading <= 0) return toast('Enter a valid reading.', 'error');

  try {
    await Data.addTimeObservation({ machine_id: machineId, operation_code: opCode, observed_time_sec: reading, observed_by });
    toast('Reading added.', 'success');
    openTimeStudySheet(machineId, opCode);
  } catch (e) {
    toast('Could not add reading: ' + e.message, 'error');
  }
}

async function removeObservation(id) {
  try {
    await Data.deleteTimeObservation(id);
    const opCode = document.getElementById('tsOperation').value;
    toast('Reading removed.', 'success');
    openTimeStudySheet(window.__tsMachineId, opCode);
  } catch (e) {
    toast('Could not remove: ' + e.message, 'error');
  }
}

async function submitStandardFromStudy(machineId) {
  const opCode = document.getElementById('tsOperation').value;
  const summary = await Data.getObservationSummary(machineId, opCode);
  if (!summary || summary.accepted_count === 0) return toast('No accepted readings to build a standard from.', 'error');

  const performance_rating = parseFloat(document.getElementById('tsRating').value) || 1;
  const personal_allowance_pct = parseFloat(document.getElementById('tsPersonal').value) || 0;
  const fatigue_allowance_pct = parseFloat(document.getElementById('tsFatigue').value) || 0;
  const delay_allowance_pct = parseFloat(document.getElementById('tsDelay').value) || 0;

  try {
    await Data.upsertStandard({
      machine_id: machineId, operation_code: opCode, unit: 'piece',
      observed_cycle_time_sec: summary.avg_observed_time_sec,
      performance_rating, personal_allowance_pct, fatigue_allowance_pct, delay_allowance_pct,
      cycle_time_source: 'time_study', observation_count: summary.accepted_count,
    });
    closeSheet();
    toast('Standard time saved from time study.', 'success');
    render();
  } catch (e) {
    console.error(e);
    toast('Could not save: ' + e.message, 'error');
  }
}

/* --------------------------- OEE: log production run --------------------------- */

async function openLogRunSheet(machineId) {
  const operations = await Data.listOperations();
  openSheet(`
    <div class="sheet-title">Log production run</div>
    <p class="small" style="margin-bottom:14px;">For OEE: Availability × Performance × Quality, from real output over a period.</p>
    <label class="field-label">Operation</label>
    <select id="runOperation">
      <option value="">— optional —</option>
      ${operations.map((o) => `<option value="${o.code}">${escapeHtml(o.label)}</option>`).join('')}
    </select>
    <label class="field-label">Run date</label>
    <input type="text" id="runDate" placeholder="YYYY-MM-DD" value="${new Date().toISOString().slice(0,10)}" />
    <div class="btn-row">
      <div style="flex:1;"><label class="field-label">Planned time (min) *</label><input type="number" id="runPlanned" min="1" placeholder="480" /></div>
      <div style="flex:1;"><label class="field-label">Downtime (min)</label><input type="number" id="runDowntime" min="0" value="0" /></div>
    </div>
    <label class="field-label">Ideal cycle time (seconds) *</label>
    <input type="number" id="runIdealCycle" min="0.1" step="0.1" placeholder="e.g. 40 — usually the standard time" />
    <div class="btn-row">
      <div style="flex:1;"><label class="field-label">Total units produced *</label><input type="number" id="runTotal" min="0" /></div>
      <div style="flex:1;"><label class="field-label">Good units *</label><input type="number" id="runGood" min="0" /></div>
    </div>
    <label class="field-label">Recorded by</label>
    <input type="text" id="runRecordedBy" placeholder="Name" />
    <div id="runPreview" class="callout info" style="margin-top:14px;"></div>
    <button class="btn primary block" style="margin-top:10px;" onclick="submitLogRun('${machineId}')">Save run</button>
  `);

  const updatePreview = () => {
    const planned = parseFloat(document.getElementById('runPlanned').value) || 0;
    const downtime = parseFloat(document.getElementById('runDowntime').value) || 0;
    const ideal = parseFloat(document.getElementById('runIdealCycle').value) || 0;
    const total = parseFloat(document.getElementById('runTotal').value) || 0;
    const good = parseFloat(document.getElementById('runGood').value) || 0;
    const runTime = planned - downtime;
    if (!planned || !runTime || !total) { document.getElementById('runPreview').innerHTML = 'Fill in the fields above to preview OEE.'; return; }
    const availability = (runTime / planned) * 100;
    const performance = Math.min(100, ((ideal * total) / 60 / runTime) * 100);
    const quality = total > 0 ? (good / total) * 100 : 0;
    const oee = (availability/100) * (performance/100) * (quality/100) * 100;
    document.getElementById('runPreview').innerHTML =
      `Availability: <strong>${availability.toFixed(1)}%</strong> · Performance: <strong>${performance.toFixed(1)}%</strong> · Quality: <strong>${quality.toFixed(1)}%</strong> · <strong>OEE: ${oee.toFixed(1)}%</strong>`;
  };
  ['runPlanned','runDowntime','runIdealCycle','runTotal','runGood'].forEach((id) => {
    document.getElementById(id).addEventListener('input', updatePreview);
  });
}

async function submitLogRun(machineId) {
  const operation_code = document.getElementById('runOperation').value || null;
  const run_date = document.getElementById('runDate').value || new Date().toISOString().slice(0,10);
  const planned_time_min = parseFloat(document.getElementById('runPlanned').value);
  const downtime_min = parseFloat(document.getElementById('runDowntime').value) || 0;
  const ideal_cycle_time_sec = parseFloat(document.getElementById('runIdealCycle').value);
  const total_units_produced = parseInt(document.getElementById('runTotal').value, 10);
  const good_units = parseInt(document.getElementById('runGood').value, 10);
  const recorded_by = document.getElementById('runRecordedBy').value.trim() || null;

  if (!planned_time_min || planned_time_min <= 0) return toast('Enter valid planned time.', 'error');
  if (!ideal_cycle_time_sec || ideal_cycle_time_sec <= 0) return toast('Enter valid ideal cycle time.', 'error');
  if (total_units_produced == null || isNaN(total_units_produced)) return toast('Enter total units produced.', 'error');
  if (good_units == null || isNaN(good_units)) return toast('Enter good units.', 'error');
  if (good_units > total_units_produced) return toast('Good units cannot exceed total units.', 'error');

  try {
    await Data.createProductionRun({
      machine_id: machineId, operation_code, run_date, planned_time_min, downtime_min,
      ideal_cycle_time_sec, total_units_produced, good_units, recorded_by,
    });
    closeSheet();
    toast('Production run logged.', 'success');
    render();
  } catch (e) {
    console.error(e);
    toast('Could not save run: ' + e.message, 'error');
  }
}

/* --------------------------- Line balancing --------------------------- */

async function renderLineBalancing(el) {
  let allStandards = [];
  try {
    allStandards = await Data.listAllStandards();
  } catch (e) {
    el.innerHTML = `<button class="btn outline sm" style="margin-bottom:12px;" onclick="backToSheet()">← Capacity sheet</button><div class="empty"><p>Could not load standard time data.</p></div>`;
    return;
  }

  if (!allStandards.length) {
    el.innerHTML = `<button class="btn outline sm" style="margin-bottom:12px;" onclick="backToSheet()">← Capacity sheet</button><div class="empty"><div class="ic">📐</div><p>No standard time data yet.</p><p>Go to a machine's "Time studies" page from the capacity sheet and tap "+ Log time study" to record readings.</p></div>`;
    return;
  }

  el.innerHTML = `
    <button class="btn outline sm" style="margin-bottom:12px;" onclick="backToSheet()">← Capacity sheet</button>

    <div class="card">
      <h2>Takt time</h2>
      <p class="small">Takt time = available production time ÷ customer demand. It's the pace the line needs to match.</p>
      <div class="btn-row">
        <div style="flex:1;">
          <label class="field-label">Available time / shift (min)</label>
          <input type="number" id="taktAvailable" value="480" />
        </div>
        <div style="flex:1;">
          <label class="field-label">Demand (units / shift)</label>
          <input type="number" id="taktDemand" value="100" />
        </div>
      </div>
      <button class="btn secondary sm" style="margin-top:10px;" onclick="computeTakt()">Compute takt time</button>
      <div id="taktResult" class="callout info" style="margin-top:12px;display:none;"></div>
    </div>

    <div class="card">
      <div class="flex-between">
        <h2 class="mb-0">Route to balance</h2>
      </div>
      <label class="field-label">Choose a route</label>
      <select id="balanceRouteSelect" onchange="renderWorkstationLoad()">
        <option value="">— select a route —</option>
        ${State.routeMappings.map((r) => `<option value="${r.code}">${escapeHtml(r.label)}</option>`).join('')}
      </select>
    </div>

    <div class="card" id="loadChartCard" style="display:none;">
      <h2>Workstation load</h2>
      <p class="small" style="margin-bottom:12px;">Bars show standard time per stage against takt time (orange line). Bars past the line are the bottleneck.</p>
      <div id="loadChart"></div>
      <div id="bottleneckSummary" style="margin-top:10px;"></div>
    </div>

    <div class="card" id="balanceMetricsCard" style="display:none;">
      <h2>Line balance metrics</h2>
      <div id="balanceMetrics" class="stat-grid"></div>
      <p class="small">Line efficiency = (sum of station standard times) ÷ (stations × bottleneck time) × 100.</p>
    </div>

    <div class="card" id="yamazumiCard" style="display:none;">
      <h2>Yamazumi — task breakdown per station</h2>
      <p class="small" style="margin-bottom:12px;">Each station's standard time broken into normal time (value-added) vs. allowances, stacked, against takt.</p>
      <div id="yamazumiChart"></div>
    </div>
  `;
}

let __taktSeconds = null;

function computeTakt() {
  const available = parseFloat(document.getElementById('taktAvailable').value);
  const demand = parseFloat(document.getElementById('taktDemand').value);
  if (!available || !demand) return toast('Enter both values.', 'error');
  __taktSeconds = (available * 60) / demand;
  const box = document.getElementById('taktResult');
  box.style.display = 'block';
  box.innerHTML = `Takt time: <strong>${__taktSeconds.toFixed(1)} seconds/unit</strong> (${(available/demand).toFixed(2)} min/unit).`;
  renderWorkstationLoad();
}

async function renderWorkstationLoad() {
  const routeSelectEl = document.getElementById('balanceRouteSelect');
  const routeCode = routeSelectEl ? routeSelectEl.value : '';
  const loadCard = document.getElementById('loadChartCard');
  const metricsCard = document.getElementById('balanceMetricsCard');
  const yamazumiCard = document.getElementById('yamazumiCard');
  if (!routeCode) {
    [loadCard, metricsCard, yamazumiCard].forEach((c) => { if (c) c.style.display = 'none'; });
    return;
  }

  let rows;
  try {
    rows = await Data.getRouteBalanceMetrics(routeCode);
  } catch (e) {
    console.error(e);
    toast('Could not compute balance metrics: ' + e.message, 'error');
    return;
  }
  if (!rows || !rows.length) return;

  loadCard.style.display = 'block';
  metricsCard.style.display = 'block';
  yamazumiCard.style.display = 'block';

  const chart = document.getElementById('loadChart');
  const maxTime = Math.max(__taktSeconds || 0, ...rows.map((r) => r.standard_time_sec ? Number(r.standard_time_sec) : 0), 1);

  chart.innerHTML = rows.map((r) => {
    if (r.standard_time_sec == null) {
      return `
        <div class="load-bar-row">
          <div class="lbl"><span class="name">${escapeHtml(r.stage_label || r.stage_code)}</span><span class="small">No standard time recorded</span></div>
          <div class="load-bar-track"><div class="load-bar-fill under" style="width:2%;"></div></div>
        </div>`;
    }
    const t = Number(r.standard_time_sec);
    const pct = Math.min(100, (t / maxTime) * 100);
    let cls = 'balanced';
    if (__taktSeconds) {
      cls = t > __taktSeconds * 1.05 ? 'over' : (t < __taktSeconds * 0.7 ? 'under' : 'balanced');
    }
    const taktPct = __taktSeconds ? Math.min(100, (__taktSeconds / maxTime) * 100) : null;
    return `
      <div class="load-bar-row">
        <div class="lbl"><span class="name">${escapeHtml(r.stage_label || r.stage_code)}${r.is_bottleneck ? ' 🔺' : ''}</span><span>${t.toFixed(1)}s (${escapeHtml(r.machine_name || '')})</span></div>
        <div class="load-bar-track">
          <div class="load-bar-fill ${cls}" style="width:${pct}%;"></div>
          ${taktPct !== null ? `<div class="takt-line" style="left:${taktPct}%;"></div>` : ''}
        </div>
      </div>`;
  }).join('');

  const bottleneck = rows.find((r) => r.is_bottleneck);
  const summary = document.getElementById('bottleneckSummary');
  if (bottleneck) {
    const overTakt = __taktSeconds && Number(bottleneck.standard_time_sec) > __taktSeconds;
    summary.innerHTML = `
      <div class="callout ${overTakt ? 'blocked' : 'info'}">
        <strong>Bottleneck: ${escapeHtml(bottleneck.stage_label || bottleneck.stage_code)}</strong> at ${Number(bottleneck.standard_time_sec).toFixed(1)}s/unit
        (${escapeHtml(bottleneck.machine_name || '')}).
        ${__taktSeconds ? (overTakt
          ? ' This exceeds takt time — the line cannot meet demand at this pace.'
          : ' This is within takt time.') : ' Set a takt time above to compare.'}
      </div>`;
  } else {
    summary.innerHTML = `<p class="small">No stages in this route have standard time data yet.</p>`;
  }

  const metrics = rows[0];
  document.getElementById('balanceMetrics').innerHTML = `
    <div class="stat-box"><div class="num">${metrics.line_efficiency_pct != null ? metrics.line_efficiency_pct + '%' : '—'}</div><div class="lbl">Line efficiency</div></div>
    <div class="stat-box"><div class="num">${metrics.balance_delay_pct != null ? metrics.balance_delay_pct + '%' : '—'}</div><div class="lbl">Balance delay</div></div>
    <div class="stat-box"><div class="num">${metrics.station_count}</div><div class="lbl">Measured stations</div></div>
    <div class="stat-box"><div class="num">${metrics.bottleneck_time_sec ? Number(metrics.bottleneck_time_sec).toFixed(1) + 's' : '—'}</div><div class="lbl">Bottleneck time</div></div>
  `;

  const allStandards = await Data.listAllStandards();
  const yamChart = document.getElementById('yamazumiChart');
  yamChart.innerHTML = rows.map((r) => {
    if (r.standard_time_sec == null) {
      return `<div class="load-bar-row"><div class="lbl"><span class="name">${escapeHtml(r.stage_label || r.stage_code)}</span><span class="small">No data</span></div><div class="load-bar-track"></div></div>`;
    }
    const std = allStandards.find((s) => s.machine_id === r.machine_id && Number(s.standard_time_sec) === Number(r.standard_time_sec));
    const normal = std ? Number(std.normal_time_sec) : Number(r.standard_time_sec) * 0.88;
    const allowance = Number(r.standard_time_sec) - normal;
    const normalPct = (normal / maxTime) * 100;
    const allowPct = (allowance / maxTime) * 100;
    return `
      <div class="load-bar-row">
        <div class="lbl"><span class="name">${escapeHtml(r.stage_label || r.stage_code)}</span><span>${normal.toFixed(1)}s + ${allowance.toFixed(1)}s allow</span></div>
        <div class="load-bar-track" style="display:flex;">
          <div style="background:var(--steel);height:100%;width:${normalPct}%;"></div>
          <div style="background:var(--amber);height:100%;width:${allowPct}%;"></div>
        </div>
      </div>`;
  }).join('') + `<p class="small" style="margin-top:10px;"><span style="display:inline-block;width:10px;height:10px;background:var(--steel);margin-right:4px;"></span>Normal (value-added) &nbsp; <span style="display:inline-block;width:10px;height:10px;background:var(--amber);margin-right:4px;"></span>Allowances</p>`;
}
