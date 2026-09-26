/* --------------------------- 3. Screen: Jobs list --------------------------- */

async function renderJobsList(main) {
  main.innerHTML = `
    <div class="searchbar">
      <span>🔍</span>
      <input type="text" id="jobSearch" placeholder="Search job code, quotation, client or project…" />
    </div>
    <div class="card" id="jobsCard" style="padding:0;">
      <div style="padding:16px 16px 0;">
        <h2 style="margin-bottom:2px;">All jobs</h2>
      </div>
      <div id="jobsList"></div>
    </div>
  `;

  let jobs = [];
  try {
    jobs = await Data.listJobs();
  } catch (e) {
    document.getElementById('jobsList').innerHTML = `<div class="empty"><div class="ic">⚠️</div><p>Could not load jobs.</p></div>`;
    return;
  }

  function paint(list) {
    const box = document.getElementById('jobsList');
    if (!list.length) {
      box.innerHTML = `<div class="empty"><div class="ic">📭</div><p>No jobs yet.</p><p>Jobs arrive here when KEYSTONE releases a Job Order.</p></div>`;
      return;
    }
    box.innerHTML = list.map((j) => `
      <div class="job-row" style="${j.job_active ? '' : 'opacity:0.55;'}" onclick="goToJob('${j.id}')">
        <div class="left">
          <span class="code">${escapeHtml(j.job_code)}</span>
          <span class="meta">${j.mother_jo && j.mother_jo.client ? escapeHtml(j.mother_jo.client) + (j.mother_jo.project ? ' — ' + escapeHtml(j.mother_jo.project) : '') + ' · ' : ''}${j.quotation_serial ? 'Quotation ' + escapeHtml(j.quotation_serial) : 'No quotation ref'} · ${fmtDate(j.created_at)}</span>
        </div>
        <div class="right">
          ${!j.job_active ? '<span class="badge gray">Inactive</span>' : ''}
          ${badgeForDest(j.destination_company)}
          ${badgeForJoReview(j)}
          ${badgeForJobStatus(j.status)}
        </div>
      </div>
    `).join('');
  }

  paint(jobs);

  document.getElementById('jobSearch').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    if (!q) return paint(jobs);
    paint(jobs.filter((j) =>
      [j.job_code, j.quotation_serial, j.mother_jo && j.mother_jo.client, j.mother_jo && j.mother_jo.project]
        .join(' ').toLowerCase().includes(q)
    ));
  });
}

/* --------------------------- 4. Screen: New Job intake --------------------------- */

async function renderIntake(main) {
  const routeOptions = State.routeMappings.map((r) => `<option value="${r.code}">${escapeHtml(r.label)}</option>`).join('');

  main.innerHTML = `
    <h1 class="page-title">Register approved quotation</h1>
    <p class="page-sub">Stands in for a ModCraft quotation reaching "Client Approved."</p>

    <div class="callout info">
      <strong>This is not a "start production" form.</strong> In the real flow, a job appears in
      Production automatically the moment a ModCraft quotation is client-approved — it does not
      mean production can begin. The job is created here <strong>inactive</strong>: payment status
      starts at "not yet paid," and nothing (materials receiving, cutting, anything) can proceed
      until an incoming payment/vouched signal from the Admin app activates it. Since that Admin
      feed doesn't exist yet, this screen is the manual stand-in for "a quotation just got
      approved" — not a form for deciding to start work.
    </div>

    <div class="card">
      <h2>Job identity</h2>

      <label class="field-label">Job code *</label>
      <input type="text" id="f_job_code" placeholder="e.g. J4821" />
      <p class="hint">This becomes the JOB segment of every component barcode ID for this job.</p>

      <label class="field-label">ModCraft quotation reference (optional)</label>
      <input type="text" id="f_quotation_serial" placeholder="e.g. QT-M00000017" />
      <p class="hint">Free-text reference for now — not yet linked live to ModCraft's quotations table (see MODCRAFT_BRIDGE_NOTES.md).</p>

      <label class="field-label">Destination company *</label>
      <div class="chip-group" id="f_destination">
        <div class="chip" data-val="MSSI">MSSI — direct dispatch</div>
        <div class="chip" data-val="WCLI">WCLI — internal transfer</div>
        <div class="chip" data-val="CWLI">CWLI — per delivery instr.</div>
      </div>

      <h3>Cutting list source</h3>
      <div class="chip-group" id="f_cl_source">
        <div class="chip" data-val="existing_known">Existing / repeat order</div>
        <div class="chip" data-val="modcraft_conversion">ModCraft conversion</div>
        <div class="chip" data-val="cabinet_vision_import">Cabinet Vision import</div>
      </div>
      <p class="hint" id="cvHint" style="display:none;color:#a5610f;">
        Cabinet Vision file-bridge import is post-v1 (deferred, file-based only — see Section 7). You can select
        this to record intent, but the actual import step isn't built yet.
      </p>
    </div>

    <div class="card">
      <h2>Material sourcing</h2>
      <label class="field-label">Overall sourcing mode</label>
      <div class="chip-group" id="f_sourcing">
        <div class="chip" data-val="mto">MTO (Made-to-Order)</div>
        <div class="chip" data-val="buy_stock">Buy / Stock</div>
      </div>
      <p class="hint">MTO lead time is 4–7 days from client payment. This is a general note for the job — the
      actual required materials, payment confirmation, and receiving are tracked on the job page after creation,
      since a job can need several material lines and each is tracked separately.</p>
    </div>

    <div class="card">
      <h2>Route</h2>
      <label class="field-label">Production route *</label>
      <select id="f_route_code">
        <option value="">— Select the route derived from ModCraft's service spec —</option>
        ${routeOptions}
      </select>
      <p class="hint">
        Route is determined by the finalized ModCraft service spec, never decided independently in Production
        (Section 4). Selecting it here manually is the standalone-intake stand-in for that derivation.
      </p>
      <div id="routePreview"></div>
    </div>

    <div class="card">
      <h2>Notes</h2>
      <textarea id="f_notes" placeholder="Any additional context for this job…"></textarea>
    </div>

    <button class="btn primary block" id="submitIntake">Register job (inactive)</button>
  `;

  setupChipGroup('f_destination');
  setupChipGroup('f_cl_source', (val) => {
    document.getElementById('cvHint').style.display = val === 'cabinet_vision_import' ? 'block' : 'none';
  });
  setupChipGroup('f_sourcing');

  document.getElementById('f_route_code').addEventListener('change', (e) => {
    const route = State.routeMappings.find((r) => r.code === e.target.value);
    const box = document.getElementById('routePreview');
    if (!route) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="route-flow" style="margin-top:10px;">${route.stage_sequence.map((code, i) =>
      `<span class="route-step">${code}</span>` + (i < route.stage_sequence.length - 1 ? '<span class="route-arrow">→</span>' : '')
    ).join('')}</div>`;
  });

  document.getElementById('submitIntake').addEventListener('click', submitIntakeForm);
}

function setupChipGroup(id, onChange) {
  const group = document.getElementById(id);
  group.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      group.querySelectorAll('.chip').forEach((c) => c.classList.remove('selected'));
      chip.classList.add('selected');
      if (onChange) onChange(chip.dataset.val);
    });
  });
}

function getSelectedChip(id) {
  const el = document.querySelector(`#${id} .chip.selected`);
  return el ? el.dataset.val : null;
}

async function submitIntakeForm() {
  const job_code = document.getElementById('f_job_code').value.trim().toUpperCase();
  const quotation_serial = document.getElementById('f_quotation_serial').value.trim() || null;
  const destination_company = getSelectedChip('f_destination');
  const cutting_list_source = getSelectedChip('f_cl_source');
  const material_sourcing = getSelectedChip('f_sourcing');
  const route_code = document.getElementById('f_route_code').value || null;
  const notes = document.getElementById('f_notes').value.trim() || null;

  if (!job_code) return toast('Job code is required.', 'error');
  if (!destination_company) return toast('Select a destination company.', 'error');
  if (!material_sourcing) return toast('Select a material sourcing mode.', 'error');

  const btn = document.getElementById('submitIntake');
  btn.disabled = true;
  btn.textContent = 'Registering…';

  try {
    const job = await Data.createJob({
      job_code, quotation_serial, destination_company, cutting_list_source,
      material_sourcing, route_code, notes,
      status: 'material_wait',
      payment_status: 'not_yet_paid',   // always starts inactive — Production never assumes payment
      payment_status_source: 'manual_test',
      source_quotation_status: 'Client Approved', // matches what real ModCraft data calls this state
    });

    // route can be pre-assigned, but stages only matter once the job is actually active.
    // Building them now is harmless (they just sit unused until payment_status flips).
    if (route_code) {
      await buildJobStagesFromRoute(job.id, route_code);
    }

    toast('Job registered, inactive. Use the test trigger on the job page to simulate payment.', 'success');
    goToJob(job.id);
  } catch (e) {
    console.error(e);
    toast('Could not register job: ' + (e.message || 'unknown error'), 'error');
    btn.disabled = false;
    btn.textContent = 'Register job (inactive)';
  }
}

async function buildJobStagesFromRoute(jobId, routeCode) {
  const route = State.routeMappings.find((r) => r.code === routeCode);
  if (!route) return;
  const rows = route.stage_sequence.map((stageCode, i) => ({
    job_id: jobId, stage_code: stageCode, sequence_index: i,
    status: i === 0 ? 'queued' : 'not_started',
  }));
  await Data.createJobStages(rows);
}
