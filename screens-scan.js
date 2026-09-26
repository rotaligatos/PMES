/* --------------------------- 6. Screen: Scan station --------------------------- */

async function renderScan(main) {
  main.innerHTML = `
    <p class="page-sub">Scan or manually enter a component barcode ID to log stage progress.</p>

    <div class="callout info">
      Camera-based scanning isn't wired up in this v1 build. Type the barcode ID (or paste from a
      handheld scanner acting as a keyboard) below — the lookup/logging logic is the same either way,
      so swapping in a camera scanner later is a drop-in change to this input.
    </div>

    <div class="card">
      <label class="field-label">Component barcode ID</label>
      <input type="text" id="scanInput" placeholder="e.g. J4821-KIT-BASE01-DR-02/05" autocomplete="off" />
      <button class="btn primary block" style="margin-top:12px;" onclick="lookupScannedComponent()">Look up component</button>
    </div>

    <div id="scanResult"></div>
  `;

  document.getElementById('scanInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') lookupScannedComponent();
  });
  document.getElementById('scanInput').focus();
}

async function lookupScannedComponent() {
  const raw = document.getElementById('scanInput').value.trim();
  const resultBox = document.getElementById('scanResult');
  if (!raw) return;

  let component;
  try {
    component = await Data.findComponentByBarcode(raw);
  } catch (e) {
    resultBox.innerHTML = `<div class="empty"><div class="ic">⚠️</div><p>Lookup failed.</p></div>`;
    return;
  }

  if (!component) {
    // mismatch — log it so patterns of mis-scans are visible later (Section 11 open item).
    // component_id is nullable specifically for this case: a mismatch has no valid component.
    try {
      await sb.from(T('component_stage_events')).insert({
        component_id: null, stage_code: pmesStations()[0] || 'CUT', event_type: 'mismatch', scanned_value: raw,
      });
    } catch (e) {
      console.error('Could not log mismatch event:', e);
    }

    resultBox.innerHTML = `
      <div class="card">
        <div class="callout blocked">
          <strong>No match found</strong> for <span class="mono">${escapeHtml(raw)}</span>.
          Check the code and try again. Mis-scans should not be silently dropped — flag to a
          supervisor if this keeps happening on the same label.
        </div>
      </div>
    `;
    return;
  }

  const job = await Data.getJob(component.job_id);
  const seq = stageSequenceFor(component, job);
  const stageIdx = seq ? seq.indexOf(component.current_stage_code) : -1;
  const nextStage = seq ? (stageIdx === -1 ? seq[0] : seq[stageIdx + 1]) : null;
  // An operator only logs the stations they are assigned to; the rest of the route is shown, not offered.
  const allowed = seq ? seq.filter(pmesStageAllowed) : [];
  const pick = allowed.includes(nextStage) ? nextStage : allowed[0];

  resultBox.innerHTML = `
    <div class="card">
      <h2 class="mono">${escapeHtml(component.full_barcode_id)}</h2>
      ${component.spec ? `<p class="small">${escapeHtml([component.spec.part, component.spec.name, component.spec.cutL && component.spec.cutW ? component.spec.cutL + ' × ' + component.spec.cutW + ' mm' : '', component.spec.special ? 'SPECIAL: ' + component.spec.special : ''].filter(Boolean).join(' · '))}</p>` : ''}
      <p class="small">Job ${escapeHtml(job.job_code)} · ${badgeForDest(job.destination_company)}</p>
      <p class="small">Current stage: <strong>${component.current_stage_code || 'Not started'}</strong> · Status: <strong>${component.status}</strong></p>

      ${nextStage && !allowed.length ? `
        <div class="callout blocked">Next stage is <strong>${nextStage}</strong>. None of this piece's stages are at your
        station${pmesStations().length > 1 ? 's' : ''} (${pmesStations().join(', ')}). Pass it to the right station.</div>
      ` : nextStage ? `
        ${nextStage !== pick ? `<div class="callout info">Next stage is <strong>${nextStage}</strong>, which is not your station.</div>` : ''}
        <label class="field-label">Log completion of</label>
        <select id="scanStageSelect">
          ${allowed.map((s) => `<option value="${s}" ${s === pick ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
        <label class="field-label">Operator</label>
        <input type="text" id="scanOperator" placeholder="Operator name / badge id" value="${escapeHtml((State.me && State.me.name) || '')}" />
        <button class="btn primary block" style="margin-top:12px;" onclick="logScanCompletion('${component.id}')">
          Confirm scan-in / complete stage
        </button>
      ` : `<p class="small">No route assigned to this job — cannot determine next stage.</p>`}
    </div>
  `;
}

async function logScanCompletion(componentId) {
  const stage_code = document.getElementById('scanStageSelect').value;
  const operator = document.getElementById('scanOperator').value.trim() || null;

  try {
    await Data.logStageEvent({
      component_id: componentId, stage_code, event_type: 'scan_in', operator,
      scanned_value: null,
    });
    const isLast = await isLastStageForComponent(componentId, stage_code);
    await Data.updateComponent(componentId, {
      current_stage_code: stage_code,
      status: isLast ? 'complete' : 'in_process',
    });
    toast('Stage logged for component.', 'success');
    document.getElementById('scanInput').value = '';
    document.getElementById('scanResult').innerHTML = '';
    document.getElementById('scanInput').focus();
  } catch (e) {
    console.error(e);
    toast('Could not log stage: ' + e.message, 'error');
  }
}

async function isLastStageForComponent(componentId, stageCode) {
  const component = await sb.from(T('components')).select('job_id').eq('id', componentId).single();
  if (component.error) return false;
  const job = await Data.getJob(component.data.job_id);
  const full = await sb.from(T('components')).select('route').eq('id', componentId).single();
  const seq = stageSequenceFor(full.data || {}, job);
  if (!seq || !seq.length) return false;
  return seq[seq.length - 1] === stageCode;
}

// A piece released from a Modcraft Job Order carries its OWN route (special cut, which edge
// bander, HPL before or after cutting). Pieces without one follow the job's route as before.
function stageSequenceFor(component, job) {
  if (component && Array.isArray(component.route) && component.route.length) return component.route;
  const route = State.routeMappings.find((r) => r.code === job.route_code);
  return route ? route.stage_sequence : null;
}
