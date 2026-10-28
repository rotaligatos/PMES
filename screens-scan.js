/* --------------------------- 6. Screen: Scan station --------------------------- */

async function renderScan(main) {
  main.innerHTML = `
    <p class="page-sub">Scan or manually enter a component barcode ID to log stage progress.</p>

    <div class="callout info">
      Scan the QR on the part label with a USB scanner (it types the code here), or tap
      <b>Scan with camera</b> on a phone or tablet.
    </div>

    <div class="card">
      <label class="field-label">Component barcode ID</label>
      <input type="text" id="scanInput" placeholder="e.g. J4821-KIT-BASE01-DR-02/05" autocomplete="off" />
      <button class="btn primary block" style="margin-top:12px;" onclick="lookupScannedComponent()">Look up component</button>
      <button class="btn outline block" style="margin-top:8px;" id="camBtn" onclick="toggleCameraScan()">📷 Scan with camera</button>
      <div id="camBox" style="margin-top:10px;display:none;max-width:420px;"></div>
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
  State.scanJobId = job.id;
  if (!joApproved(job)) {
    resultBox.innerHTML = `<div class="card"><h2 class="mono">${escapeHtml(component.full_barcode_id)}</h2>
      <p class="small">Job ${escapeHtml(job.job_code)} ${testTag(job)} ${badgeForJoReview(job)}</p>
      <div class="callout blocked">This Job Order has not been approved for the line yet. Nothing can be logged against it until staff have checked it and a supervisor has approved it.</div></div>`;
    return;
  }
  const seq = stageSequenceFor(component, job);
  const stageIdx = seq ? seq.indexOf(component.current_stage_code) : -1;
  const nextStage = seq ? (stageIdx === -1 ? seq[0] : seq[stageIdx + 1]) : null;
  // An operator only logs the stations they are assigned to; the rest of the route is shown, not offered.
  const doneRows = await sb.from(T('component_done')).select('stage_code,done_by_name,done_at').eq('component_id', component.id);
  const doneSet = new Set(((doneRows && doneRows.data) || []).map((d) => d.stage_code));
  const allowed = seq ? seq.filter((s) => pmesStageAllowed(s) && !doneSet.has(s)) : [];
  const pick = allowed.includes(nextStage) ? nextStage : allowed[0];

  resultBox.innerHTML = `
    <div class="card">
      <h2 class="mono">${escapeHtml(component.full_barcode_id)}</h2>
      ${component.spec ? `<p class="small">${escapeHtml([component.spec.part, component.spec.name, component.spec.cutL && component.spec.cutW ? component.spec.cutL + ' × ' + component.spec.cutW + ' mm' : '', component.spec.special ? 'SPECIAL: ' + component.spec.special : ''].filter(Boolean).join(' · '))}</p>` : ''}
      <p class="small">Job ${escapeHtml(job.job_code)} ${testTag(job)} · ${badgeForDest(job.destination_company)}</p>
      <p class="small">Now at: <strong>${component.current_stage_code || (component.status === 'complete' ? 'Finished' : 'Not started')}</strong> · Status: <strong>${component.status}</strong></p>
      ${seq ? '<div class="route-flow">' + seq.map((s) => '<span class="route-step ' + (doneSet.has(s) ? 'done' : '') + '">' + (doneSet.has(s) ? '✓ ' : '') + s + '</span>').join('<span class="route-arrow">→</span>') + '</div>' : ''}

      ${nextStage && !allowed.length ? `
        <div class="callout blocked">Next stage is <strong>${nextStage}</strong>. None of this piece's stages are at your
        station${pmesStations().length > 1 ? 's' : ''} (${pmesStations().join(', ')}). Pass it to the right station.</div>
      ` : nextStage ? `
        ${nextStage !== pick ? `<div class="callout info">Next stage is <strong>${nextStage}</strong>, which is not your station.</div>` : ''}
        <label class="field-label">Mark this piece done at</label>
        <select id="scanStageSelect">
          ${allowed.map((s) => `<option value="${s}" ${s === pick ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
        <label class="field-label">Operator(s) who did the work</label>
        <input type="text" id="scanOperator" placeholder="Name(s), comma separated — blank = the operators the process JO was handed to" value="${escapeHtml(_scanOperatorSaved())}" />
        ${component.hold === 'reject_pending' ? '<div class="callout blocked" style="margin-top:10px;">This piece is rejected and waiting for the supervisor. Do not process it.</div>' : `${pmesCan('operator') ? `<button class="btn primary block" style="margin-top:12px;" onclick="logScanCompletion('${component.id}')">
          Good — mark done
        </button>` : '<p class="small" style="margin-top:12px;">Operators mark pieces done. QA can reject a piece here.</p>'}
        <button class="btn danger block" style="margin-top:8px;" onclick="pieceReject('${component.id}', document.getElementById('scanStageSelect').value, 'scan')">Reject this piece…</button>`}
        ${component.remake_no ? '<p class="small" style="margin-top:6px;"><span class="badge red">Remake ' + component.remake_no + '</span></p>' : ''}
      ` : `<p class="small">No route assigned to this job — cannot determine next stage.</p>`}
    </div>
  `;
}

async function logScanCompletion(componentId) {
  const stage_code = document.getElementById('scanStageSelect').value;
  const operator = document.getElementById('scanOperator').value.trim();
  try { localStorage.setItem('pmes_operator', operator); } catch (e) {}
  const ops = operator ? operator.split(',').map((x) => x.trim()).filter(Boolean) : null;

  try {
    const { data, error } = await sb.rpc('pmes_component_mark', { p_components: [componentId], p_stage: stage_code, p_done: true, p_note: null, p_via: 'scan', p_operators: ops });
    if (error) throw error;
    if (data.marked) toast('Done at ' + stage_code + ' — ' + data.done + '/' + data.planned + ' pieces at this process.', 'success');
    else toast('Not marked: ' + ((data.skipped && data.skipped[0] && data.skipped[0].why) || 'nothing to do') + '.', 'error');
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

/* Camera scanning (2026-10-17): reads the part label's QR with the phone/tablet camera and runs the
   same lookup a USB scanner does. html5-qrcode is loaded only when the camera is first used. */
let _camScanner = null;
function _loadCamLib() {
  if (window.Html5Qrcode) return Promise.resolve();
  return new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/html5-qrcode/2.3.8/html5-qrcode.min.js'; sc.onload = res; sc.onerror = () => rej(new Error('camera scanner could not load')); document.head.appendChild(sc); });
}
async function stopCameraScan() {
  const box = document.getElementById('camBox'), btn = document.getElementById('camBtn');
  if (_camScanner) { try { await _camScanner.stop(); } catch (e) {} try { _camScanner.clear(); } catch (e) {} _camScanner = null; }
  if (box) box.style.display = 'none'; if (btn) btn.textContent = '📷 Scan with camera';
}
async function toggleCameraScan() {
  if (_camScanner) return stopCameraScan();
  const box = document.getElementById('camBox'), btn = document.getElementById('camBtn');
  try { await _loadCamLib(); } catch (e) { return toast(e.message, 'error'); }
  box.style.display = 'block'; box.innerHTML = '<div id="camView"></div>'; btn.textContent = '■ Stop camera';
  _camScanner = new Html5Qrcode('camView');
  try {
    await _camScanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: 240 }, async (text) => {
      await stopCameraScan();
      const inp = document.getElementById('scanInput'); if (inp) inp.value = text;
      lookupScannedComponent();
    });
  } catch (e) { toast('Camera not available: ' + (e && e.message || e), 'error'); stopCameraScan(); }
}

// The operator(s) at this station are remembered on this device until changed.
function _scanOperatorSaved() { try { return localStorage.getItem('pmes_operator') || ''; } catch (e) { return ''; } }
