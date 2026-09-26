/* --------------------------- 5. Screen: Job detail --------------------------- */

async function renderJobDetail(main) {
  const jobId = State.currentJobId;
  let job, stages, components, materials, materialSummary;
  try {
    [job, stages, components, materials, materialSummary] = await Promise.all([
      Data.getJob(jobId), Data.listJobStages(jobId), Data.listComponents(jobId),
      Data.listJobMaterials(jobId), Data.getJobMaterialSummary(jobId),
    ]);
  } catch (e) {
    main.innerHTML = `<div class="empty"><div class="ic">⚠️</div><p>Could not load job.</p></div>`;
    return;
  }

  document.getElementById('screenTitle').textContent = job.job_code;
  const route = State.routeMappings.find((r) => r.code === job.route_code);
  const materialsReady = materialSummary ? materialSummary.materials_ready : false;
  const canCut = job.job_active && materialsReady;

  // fetch per-line readiness for display
  let readiness = [];
  try { readiness = await Data.getJobMaterialReadiness(jobId); } catch (e) { /* non-fatal */ }

  const paymentBadge = {
    not_yet_paid: '<span class="badge red">Not yet paid</span>',
    paid: '<span class="badge green">Paid</span>',
    vouched: '<span class="badge blue">Vouched</span>',
  }[job.payment_status] || '<span class="badge gray">Unknown</span>';

  main.innerHTML = `
    <div class="flex-between" style="margin-bottom:10px;">
      <button class="btn outline sm" onclick="goToScreen('jobs')">← All jobs</button>
      ${badgeForJobStatus(job.status)}
    </div>

    <h1 class="page-title" style="display:flex;align-items:center;gap:10px;">
      <span class="mono">${escapeHtml(job.job_code)}</span> ${badgeForDest(job.destination_company)}
    </h1>
    <p class="page-sub">${job.quotation_serial ? 'Quotation ref: ' + escapeHtml(job.quotation_serial) : 'No quotation reference'} · Created ${fmtDate(job.created_at)}</p>

    ${!job.job_active ? `
      <div class="callout blocked">
        <strong>Inactive.</strong> This job is grayed out until the Admin app reports the linked
        quotation as paid or vouched. Production does not confirm payment itself — it only reacts
        to that status once the real feed exists (see MODCRAFT_BRIDGE_NOTES.md).
      </div>
    ` : ''}

    <div class="card">
      <div class="flex-between">
        <h2 class="mb-0">Payment status</h2>
        ${paymentBadge}
      </div>
      <p class="small" style="margin-top:8px;">
        Received from the Admin app once that feed is built — Production never sets this in real
        usage. ${job.payment_status_updated_at ? 'Last updated ' + fmtDate(job.payment_status_updated_at) + '.' : ''}
      </p>

      <div style="margin-top:14px;padding-top:14px;border-top:1px dashed var(--border);">
        <p class="small" style="font-weight:700;color:var(--amber);margin-bottom:8px;">
          🧪 Test-only — simulates an incoming Admin app update
        </p>
        <select id="paymentStatusTestSelect">
          <option value="not_yet_paid" ${job.payment_status === 'not_yet_paid' ? 'selected' : ''}>Not yet paid</option>
          <option value="paid" ${job.payment_status === 'paid' ? 'selected' : ''}>Paid</option>
          <option value="vouched" ${job.payment_status === 'vouched' ? 'selected' : ''}>Vouched</option>
        </select>
        <button class="btn outline sm" style="margin-top:8px;" onclick="simulatePaymentUpdate('${job.id}')">Simulate Admin update</button>
      </div>
    </div>

    <div class="card">
      <div class="flex-between">
        <h2 class="mb-0">Materials required &amp; received</h2>
        ${materialsReady ? '<span class="badge green">Ready for cutting</span>' :
          (materials.length ? '<span class="badge amber">Awaiting materials</span>' : '<span class="badge gray">Not specified</span>')}
      </div>

      ${!job.job_active ? `<div class="callout blocked" style="margin-top:10px;">Locked until this job is activated by a paid/vouched payment status above.</div>` : `
        ${materials.length ? materials.map((m) => {
          const r = readiness.find((x) => x.job_material_id === m.id);
          const recv = r ? Number(r.qty_received) : 0;
          const req = Number(m.qty_required);
          const pct = Math.min(100, Math.round((recv / req) * 100));
          return `
            <div style="padding:12px 0;border-bottom:1px solid var(--border);">
              <div class="flex-between">
                <div>
                  <div style="font-weight:700;font-size:14px;">${escapeHtml(m.material)}${m.color ? ' · ' + escapeHtml(m.color) : ''}${m.thickness_mm ? ' · ' + m.thickness_mm + 'mm' : ''}</div>
                  <div class="small">${recv} / ${req} ${escapeHtml(m.unit)} received${m.sourcing ? ' · ' + m.sourcing.replace('_',' ') : ''}</div>
                </div>
                ${r && r.line_fulfilled ? '<span class="badge green">Complete</span>' : '<span class="badge amber">Partial</span>'}
              </div>
              <div style="background:#e4e9ee;border-radius:4px;height:6px;margin-top:8px;overflow:hidden;">
                <div style="background:${r && r.line_fulfilled ? 'var(--green)' : 'var(--amber)'};height:100%;width:${pct}%;"></div>
              </div>
              <button class="btn outline sm" style="margin-top:8px;" onclick="openReceiveMaterialSheet('${m.id}','${job.id}')">+ Log receipt</button>
            </div>
          `;
        }).join('') : `<p class="small" style="margin-top:8px;">No materials specified yet for this job.</p>`}

        <button class="btn secondary sm" style="margin-top:12px;" onclick="openAddJobMaterialSheet('${job.id}')">+ Add required material</button>
      `}

      ${!canCut ? `<div class="callout blocked" style="margin-top:14px;">Cutting/optimization is blocked until this job is active (paid/vouched) <strong>and</strong> every required material line is fully received.</div>` : ''}
    </div>

    <div class="card">
      <h2>Route</h2>
      ${route ? `
        <p class="small">${escapeHtml(route.label)}</p>
        <div class="route-flow">
          ${route.stage_sequence.map((code, i) => {
            const st = stages.find((s) => s.sequence_index === i);
            const cls = st && st.status === 'complete' ? 'done' : (st && (st.status === 'in_progress' || st.status === 'queued') ? 'current' : '');
            return `<span class="route-step ${cls}">${code}</span>` + (i < route.stage_sequence.length - 1 ? '<span class="route-arrow">→</span>' : '');
          }).join('')}
        </div>
      ` : (stages.length && components.some((c) => Array.isArray(c.route) && c.route.length)) ? `
        <p class="small">Per-piece routes from Modcraft ${escapeHtml(String(job.source_file_ref || '').replace(/^job_orders:/, 'Job Order '))}. Each piece follows its own route; the stages below are every process this job needs.</p>
        <div class="route-flow">${stages.map((s, i) => `<span class="route-step">${s.stage_code}</span>` + (i < stages.length - 1 ? '<span class="route-arrow">→</span>' : '')).join('')}</div>
      ` : `<p class="small">No route assigned yet.</p>
        <select id="routeAssignSelect">
          <option value="">— Select route —</option>
          ${State.routeMappings.map((r) => `<option value="${r.code}">${escapeHtml(r.label)}</option>`).join('')}
        </select>
        <button class="btn secondary sm" style="margin-top:10px;" onclick="assignRoute('${job.id}')">Assign route</button>
      `}
    </div>

    ${stages.length ? `
      <div class="card">
        <h2>Stage execution</h2>
        ${stages.map((s, idx) => {
          const stageType = State.stageTypes.find((t) => t.code === s.stage_code);
          const cls = s.status === 'complete' ? 'complete' : s.status === 'delayed' ? 'delayed' : (s.status === 'in_progress' || s.status === 'queued') ? 'current' : '';
          return `
          <div class="stage-item ${cls}">
            <div class="stage-num">${idx + 1}</div>
            <div class="stage-body">
              <div class="stage-name">${stageType ? escapeHtml(stageType.label) : s.stage_code}</div>
              <div class="stage-meta">
                ${badgeForStageStatus(s.status)}
                ${s.operator ? ' · ' + escapeHtml(s.operator) : ''}
                ${s.delay_flag ? ' · ⚠ ' + escapeHtml(s.delay_reason || 'delayed') : ''}
              </div>
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
              ${components.length ? `<button class="btn outline sm" onclick="printProcessJO('${job.id}','${s.stage_code}')" title="Work order for this process: only the pieces that go through it">Process JO (${componentsForStage(components, s.stage_code, job).length})</button>` : ''}
              ${s.status !== 'complete' ? `<button class="btn outline sm" onclick="openStageActionSheet('${s.id}','${job.id}')">Update</button>` : ''}
            </div>
          </div>`;
        }).join('')}
      </div>
    ` : ''}

    <div class="card">
      <div class="flex-between">
        <h2 class="mb-0">Components ${components.length ? '(' + components.length + ')' : ''}</h2>
        ${canCut && stages.length > 0 ? `<button class="btn secondary sm" onclick="openGenerateComponentsSheet('${job.id}')">+ Generate</button>` : ''}
      </div>
      ${!canCut ? `<p class="small" style="margin-top:8px;">Component ID assignment happens during cutting optimization — blocked until this job is active and materials are ready.</p>` :
        (!stages.length ? `<p class="small" style="margin-top:8px;">Assign a route before generating components.</p>` : '')}
      ${components.length ? renderComponentsTable(components) : (canCut && stages.length ? `<p class="small" style="margin-top:8px;">No components yet. Tap "+ Generate" to run cutting optimization for this job.</p>` : '')}
    </div>

    ${components.length ? `
      <div class="card">
        <h2>Packing &amp; RTMS handoff</h2>
        <div id="packingBlock">Loading…</div>
      </div>
    ` : ''}

    <div class="card">
      <h2>Job notes</h2>
      <p class="small">${job.notes ? escapeHtml(job.notes) : 'No notes.'}</p>
    </div>
  `;

  if (components.length) renderPackingBlock(job, components);
}

function renderComponentsTable(components) {
  const shown = components.slice(0, 12);
  return `
    <table class="comp-table" style="margin-top:10px;">
      <thead><tr><th>Barcode ID</th><th>Stage</th><th>Status</th></tr></thead>
      <tbody>
        ${shown.map((c) => `
          <tr>
            <td class="id">${escapeHtml(c.full_barcode_id)}</td>
            <td>${c.current_stage_code || '—'}</td>
            <td>${c.status}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    ${components.length > 12 ? `<p class="small" style="margin-top:6px;">+ ${components.length - 12} more</p>` : ''}
  `;
}

async function simulatePaymentUpdate(jobId) {
  const newStatus = document.getElementById('paymentStatusTestSelect').value;
  try {
    await Data.simulatePaymentStatus(jobId, newStatus);
    toast(`Simulated: payment status set to "${newStatus.replace('_', ' ')}."`, 'success');
    render();
  } catch (e) {
    toast('Could not update: ' + e.message, 'error');
  }
}

function openAddJobMaterialSheet(jobId) {
  openSheet(`
    <div class="sheet-title">Add required material</div>
    <p class="small" style="margin-bottom:14px;">One line item this job needs before cutting can start.</p>
    <label class="field-label">Material *</label>
    <input type="text" id="jmMaterial" placeholder="e.g. Melamine Board" />
    <label class="field-label">Color / finish</label>
    <input type="text" id="jmColor" placeholder="e.g. White Oak" />
    <label class="field-label">Thickness (mm)</label>
    <input type="number" id="jmThickness" placeholder="e.g. 18" />
    <label class="field-label">Quantity required *</label>
    <div class="btn-row">
      <input type="number" id="jmQty" placeholder="Qty" style="flex:2;" min="0.01" step="0.01" />
      <select id="jmUnit" style="flex:1;">
        <option value="sheet">sheet</option>
        <option value="sqm">sqm</option>
        <option value="pcs">pcs</option>
        <option value="kg">kg</option>
        <option value="other">other</option>
      </select>
    </div>
    <label class="field-label">Sourcing</label>
    <select id="jmSourcing">
      <option value="">— not specified —</option>
      <option value="mto">MTO (Made-to-Order)</option>
      <option value="buy_stock">Buy / Stock</option>
    </select>
    <button class="btn primary block" style="margin-top:16px;" onclick="submitAddJobMaterial('${jobId}')">Add material line</button>
  `);
}

async function submitAddJobMaterial(jobId) {
  const material = document.getElementById('jmMaterial').value.trim();
  const color = document.getElementById('jmColor').value.trim() || null;
  const thickness_mm = parseFloat(document.getElementById('jmThickness').value) || null;
  const qty_required = parseFloat(document.getElementById('jmQty').value);
  const unit = document.getElementById('jmUnit').value;
  const sourcing = document.getElementById('jmSourcing').value || null;

  if (!material) return toast('Material is required.', 'error');
  if (!qty_required || qty_required <= 0) return toast('Enter a valid quantity required.', 'error');

  try {
    await Data.createJobMaterial({ job_id: jobId, material, color, thickness_mm, qty_required, unit, sourcing });
    closeSheet();
    toast('Material line added.', 'success');
    render();
  } catch (e) {
    toast('Could not add material: ' + e.message, 'error');
  }
}

function openReceiveMaterialSheet(jobMaterialId, jobId) {
  openSheet(`
    <div class="sheet-title">Log material receipt</div>
    <p class="small" style="margin-bottom:14px;">
      Recorded by the warehouse/materials team when a delivery arrives. Partial deliveries are
      fine — log each batch as it comes in.
    </p>
    <label class="field-label">Quantity received *</label>
    <input type="number" id="mrQty" min="0.01" step="0.01" placeholder="Qty" />
    <label class="field-label">Received by *</label>
    <input type="text" id="mrReceivedBy" placeholder="Warehouse staff name / badge id" />
    <label class="field-label">Source / delivery reference (optional)</label>
    <input type="text" id="mrSourceNote" placeholder="e.g. supplier PO, WCLI batch id" />
    <label class="field-label">Notes</label>
    <textarea id="mrNotes" placeholder="Optional"></textarea>
    <button class="btn primary block" style="margin-top:16px;" onclick="submitReceiveMaterial('${jobMaterialId}','${jobId}')">Log receipt</button>
  `);
}

async function submitReceiveMaterial(jobMaterialId, jobId) {
  const qty_received = parseFloat(document.getElementById('mrQty').value);
  const received_by = document.getElementById('mrReceivedBy').value.trim();
  const source_note = document.getElementById('mrSourceNote').value.trim() || null;
  const notes = document.getElementById('mrNotes').value.trim() || null;

  if (!qty_received || qty_received <= 0) return toast('Enter a valid quantity received.', 'error');
  if (!received_by) return toast('Enter who received the material.', 'error');

  try {
    await Data.createMaterialReceipt({ job_material_id: jobMaterialId, qty_received, received_by, source_note, notes });
    closeSheet();
    toast('Receipt logged.', 'success');
    render();
  } catch (e) {
    toast('Could not log receipt: ' + e.message, 'error');
  }
}

async function assignRoute(jobId) {
  const code = document.getElementById('routeAssignSelect').value;
  if (!code) return toast('Select a route first.', 'error');
  try {
    await Data.updateJob(jobId, { route_code: code });
    await buildJobStagesFromRoute(jobId, code);
    toast('Route assigned and stages created.', 'success');
    render();
  } catch (e) {
    toast('Could not assign route: ' + e.message, 'error');
  }
}

function openStageActionSheet(stageId, jobId) {
  openSheet(`
    <div class="sheet-title">Update stage</div>
    <p class="small" style="margin-bottom:14px;">Log actual progress for this stage. Delay flag + reason only — no approval workflow in v1.</p>
    <label class="field-label">Status</label>
    <select id="stageStatusSelect">
      <option value="queued">Queued</option>
      <option value="in_progress">In progress</option>
      <option value="complete">Complete</option>
    </select>
    <label class="field-label">Operator</label>
    <input type="text" id="stageOperator" placeholder="Operator name / badge id" value="${escapeHtml((State.me && State.me.name) || '')}" />
    <label class="field-label">Machine assignment (optional)</label>
    <input type="text" id="stageMachine" placeholder="e.g. EBA-1" />
    <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border);">
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;">
        <input type="checkbox" id="stageDelayFlag" style="width:20px;height:20px;" /> Flag a delay
      </label>
      <input type="text" id="stageDelayReason" placeholder="Delay reason" style="margin-top:8px;" />
    </div>
    <button class="btn primary block" style="margin-top:16px;" onclick="submitStageUpdate('${stageId}','${jobId}')">Save</button>
  `);
}

async function submitStageUpdate(stageId, jobId) {
  const status = document.getElementById('stageStatusSelect').value;
  const operator = document.getElementById('stageOperator').value.trim() || null;
  const machine_assignment = document.getElementById('stageMachine').value.trim() || null;
  const delay_flag = document.getElementById('stageDelayFlag').checked;
  const delay_reason = document.getElementById('stageDelayReason').value.trim() || null;

  const patch = { status, operator, machine_assignment, delay_flag, delay_reason };
  if (status === 'in_progress') patch.started_at = new Date().toISOString();
  if (status === 'complete') patch.completed_at = new Date().toISOString();

  try {
    await Data.updateJobStage(stageId, patch);
    closeSheet();
    toast('Stage updated.', 'success');
    render();
  } catch (e) {
    toast('Could not update stage: ' + e.message, 'error');
  }
}

/* ---- Cutting optimization / component generation ---- */

function openGenerateComponentsSheet(jobId) {
  const areaOpts = State.areas.map((a) => `<option value="${a.code}">${a.code} — ${escapeHtml(a.label)}</option>`).join('');
  const partOpts = State.partTypes.map((p) => `<option value="${p.code}">${p.code} — ${escapeHtml(p.label)}</option>`).join('');
  openSheet(`
    <div class="sheet-title">Generate components</div>
    <p class="small" style="margin-bottom:14px;">
      Simulates cutting optimization output: assigns component IDs and barcodes for this job
      (Section 5 / Section 8c). In v1 standalone mode this is entered manually; once bridged,
      this step will consume ModCraft's cutting list automatically.
    </p>
    <label class="field-label">Area</label>
    <select id="genArea">${areaOpts}</select>
    <label class="field-label">Component code</label>
    <input type="text" id="genComponent" placeholder="e.g. BASE01" />
    <label class="field-label">Part type</label>
    <select id="genPart">${partOpts}</select>
    <label class="field-label">Total quantity (identical parts)</label>
    <input type="number" id="genTotal" min="1" value="1" />
    <button class="btn primary block" style="margin-top:16px;" onclick="submitGenerateComponents('${jobId}')">Generate barcoded components</button>
  `);
}

async function submitGenerateComponents(jobId) {
  const area_code = document.getElementById('genArea').value;
  const component_code = document.getElementById('genComponent').value.trim().toUpperCase();
  const part_code = document.getElementById('genPart').value;
  const total = parseInt(document.getElementById('genTotal').value, 10);

  if (!component_code) return toast('Component code is required.', 'error');
  if (!total || total < 1) return toast('Quantity must be at least 1.', 'error');

  const rows = [];
  for (let i = 1; i <= total; i++) {
    rows.push({
      job_id: jobId, area_code, component_code, part_code,
      seq_number: i, seq_total: total,
      current_stage_code: null, status: 'pending',
    });
  }

  try {
    await Data.createComponents(rows);
    closeSheet();
    toast(`${total} component${total > 1 ? 's' : ''} generated with barcode IDs.`, 'success');
    render();
  } catch (e) {
    console.error(e);
    toast('Could not generate components: ' + e.message, 'error');
  }
}

/* ---- Packing + RTMS handoff ---- */

async function renderPackingBlock(job, components) {
  const el = document.getElementById('packingBlock');
  if (!el) return;
  let pl;
  try {
    pl = await Data.getPackingListForJob(job.id);
  } catch (e) {
    el.innerHTML = `<p class="small">Could not load packing list.</p>`;
    return;
  }

  const completeCount = components.filter((c) => c.status === 'complete').length;

  if (!pl) {
    el.innerHTML = `
      <p class="small">${completeCount} of ${components.length} components marked complete.</p>
      <button class="btn secondary sm" style="margin-top:8px;" onclick="createPackingListForJob('${job.id}')">
        Generate packing list &amp; tally card
      </button>
    `;
    return;
  }

  el.innerHTML = `
    <p class="small">Expected: ${pl.expected_component_count} · Scanned: ${pl.scanned_component_count}</p>
    ${badgeForJobStatus(pl.status === 'handed_off' ? 'handed_off' : (pl.status === 'confirmed' ? 'packing' : 'intake'))}
    ${pl.status !== 'handed_off' ? `
      <div class="btn-row" style="margin-top:10px;">
        <button class="btn outline sm" onclick="confirmPackingList('${pl.id}','${job.id}')">Confirm scan count</button>
        <button class="btn primary sm" onclick="handOffToRTMS('${pl.id}','${job.id}')">Hand off to RTMS</button>
      </div>
      <p class="hint">Handoff carries the destination_company flag (${job.destination_company}). RTMS owns the
      actual transfer/receiving transaction from here — Production's responsibility ends at handoff (Section 8).</p>
    ` : `<p class="small" style="margin-top:8px;">Handed off ${fmtDate(pl.handed_off_at)}.</p>`}
  `;
}

async function createPackingListForJob(jobId) {
  try {
    const components = await Data.listComponents(jobId);
    const job = await Data.getJob(jobId);
    const pl = await Data.createPackingList({
      job_id: jobId,
      destination_company: job.destination_company,
      expected_component_count: components.length,
      scanned_component_count: components.filter((c) => c.status === 'complete').length,
    });

    // build tally card breakdown by area/part
    const buckets = {};
    components.forEach((c) => {
      const key = c.area_code + '|' + c.part_code;
      if (!buckets[key]) buckets[key] = { area_code: c.area_code, part_code: c.part_code, expected_count: 0, scanned_count: 0 };
      buckets[key].expected_count++;
      if (c.status === 'complete') buckets[key].scanned_count++;
    });
    const rows = Object.values(buckets).map((b) => ({ ...b, packing_list_id: pl.id }));
    if (rows.length) await Data.createTallyCards(rows);

    await Data.updateJob(jobId, { status: 'packing' });
    toast('Packing list and tally card generated.', 'success');
    render();
  } catch (e) {
    console.error(e);
    toast('Could not generate packing list: ' + e.message, 'error');
  }
}

async function confirmPackingList(plId, jobId) {
  try {
    const components = await Data.listComponents(jobId);
    const scanned = components.filter((c) => c.status === 'complete').length;
    await Data.updatePackingList(plId, { scanned_component_count: scanned, status: 'confirmed' });
    toast('Scan count confirmed.', 'success');
    render();
  } catch (e) {
    toast('Could not confirm: ' + e.message, 'error');
  }
}

async function handOffToRTMS(plId, jobId) {
  try {
    await Data.updatePackingList(plId, { status: 'handed_off', handed_off_at: new Date().toISOString() });
    await Data.updateJob(jobId, { status: 'handed_off' });
    toast('Handed off to RTMS.', 'success');
    render();
  } catch (e) {
    toast('Handoff failed: ' + e.message, 'error');
  }
}
