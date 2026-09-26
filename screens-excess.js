/* --------------------------- 7. Screen: Excess material --------------------------- */

async function renderExcess(main) {
  main.innerHTML = `
    <p class="page-sub">Leftover board offcuts recorded after cutting optimization. Odoo sync is deferred (Section 8a) — this is a simple internal inventory for v1.</p>

    <div class="btn-row" style="margin-bottom:14px;">
      <button class="btn secondary" onclick="openAddExcessSheet()">+ Record excess material</button>
    </div>

    <div class="card" style="padding:0;">
      <div style="padding:16px 16px 0;"><h2>Available stock</h2></div>
      <div id="excessAvailableList"></div>
    </div>

    <div class="card" style="padding:0;">
      <div style="padding:16px 16px 0;"><h2>Withdrawn</h2></div>
      <div id="excessWithdrawnList"></div>
    </div>
  `;

  await loadExcessLists();
}

async function loadExcessLists() {
  let available = [], withdrawn = [];
  try {
    [available, withdrawn] = await Promise.all([
      Data.listExcessMaterials('available'),
      Data.listExcessMaterials('withdrawn'),
    ]);
  } catch (e) {
    document.getElementById('excessAvailableList').innerHTML = `<div class="empty"><p>Could not load.</p></div>`;
    return;
  }

  const avEl = document.getElementById('excessAvailableList');
  avEl.innerHTML = available.length ? available.map((m) => `
    <div class="job-row">
      <div class="left">
        <span class="code" style="font-size:14px;">${escapeHtml(m.material)}${m.color ? ' · ' + escapeHtml(m.color) : ''}</span>
        <span class="meta">${m.length_mm || '?'}×${m.width_mm || '?'}×${m.thickness_mm || '?'} mm · recorded ${fmtDate(m.created_at)}</span>
      </div>
      <div class="right">
        <button class="btn outline sm" onclick="openWithdrawSheet('${m.id}')">Withdraw</button>
      </div>
    </div>
  `).join('') : `<div class="empty"><div class="ic">🪵</div><p>No excess material recorded yet.</p></div>`;

  const wEl = document.getElementById('excessWithdrawnList');
  wEl.innerHTML = withdrawn.length ? withdrawn.map((m) => `
    <div class="job-row" style="cursor:default;">
      <div class="left">
        <span class="code" style="font-size:14px;">${escapeHtml(m.material)}${m.color ? ' · ' + escapeHtml(m.color) : ''}</span>
        <span class="meta">${m.length_mm || '?'}×${m.width_mm || '?'}×${m.thickness_mm || '?'} mm</span>
      </div>
      <div class="right"><span class="badge gray">Withdrawn</span></div>
    </div>
  `).join('') : `<div class="empty"><p>None withdrawn yet.</p></div>`;
}

function openAddExcessSheet() {
  openSheet(`
    <div class="sheet-title">Record excess material</div>
    <p class="small" style="margin-bottom:14px;">Logged after cutting optimization produces leftover board (Section 8a).</p>
    <label class="field-label">Material *</label>
    <input type="text" id="exMaterial" placeholder="e.g. Melamine Board" />
    <label class="field-label">Color / finish</label>
    <input type="text" id="exColor" placeholder="e.g. White Oak" />
    <label class="field-label">Dimensions (mm)</label>
    <div class="btn-row">
      <input type="number" id="exLength" placeholder="Length" style="flex:1;" />
      <input type="number" id="exWidth" placeholder="Width" style="flex:1;" />
      <input type="number" id="exThickness" placeholder="Thickness" style="flex:1;" />
    </div>
    <label class="field-label">Source job code (optional)</label>
    <input type="text" id="exSourceJob" placeholder="e.g. J4821" />
    <label class="field-label">Notes</label>
    <textarea id="exNotes" placeholder="Anything else worth tracking"></textarea>
    <button class="btn primary block" style="margin-top:16px;" onclick="submitAddExcess()">Save</button>
  `);
}

async function submitAddExcess() {
  const material = document.getElementById('exMaterial').value.trim();
  const color = document.getElementById('exColor').value.trim() || null;
  const length_mm = parseFloat(document.getElementById('exLength').value) || null;
  const width_mm = parseFloat(document.getElementById('exWidth').value) || null;
  const thickness_mm = parseFloat(document.getElementById('exThickness').value) || null;
  const sourceCode = document.getElementById('exSourceJob').value.trim().toUpperCase();
  const notes = document.getElementById('exNotes').value.trim() || null;

  if (!material) return toast('Material is required.', 'error');

  let source_job_id = null;
  if (sourceCode) {
    const { data } = await sb.from(T('production_jobs')).select('id').eq('job_code', sourceCode).maybeSingle();
    if (data) source_job_id = data.id;
  }

  try {
    await Data.createExcessMaterial({ material, color, length_mm, width_mm, thickness_mm, source_job_id, notes });
    closeSheet();
    toast('Excess material recorded.', 'success');
    loadExcessLists();
  } catch (e) {
    toast('Could not save: ' + e.message, 'error');
  }
}

async function openWithdrawSheet(excessId) {
  const jobs = await Data.listJobs();
  const openJobs = jobs.filter((j) => j.status !== 'handed_off');
  openSheet(`
    <div class="sheet-title">Withdraw material</div>
    <p class="small" style="margin-bottom:14px;">
      Assign this offcut to a job instead of going through the MTO/buy gate (Section 8a).
      Matching against job requirements is manual in v1 — pick the job you've already confirmed it fits.
    </p>
    <label class="field-label">Job</label>
    <select id="withdrawJobSelect">
      ${openJobs.map((j) => `<option value="${j.id}">${escapeHtml(j.job_code)}</option>`).join('')}
    </select>
    <label class="field-label">Withdrawn by</label>
    <input type="text" id="withdrawBy" placeholder="Name / badge id" />
    <label class="field-label">Notes</label>
    <textarea id="withdrawNotes" placeholder="Optional"></textarea>
    <button class="btn primary block" style="margin-top:16px;" onclick="submitWithdraw('${excessId}')">Confirm withdrawal</button>
  `);
}

async function submitWithdraw(excessId) {
  const jobId = document.getElementById('withdrawJobSelect').value;
  const by = document.getElementById('withdrawBy').value.trim() || null;
  const notes = document.getElementById('withdrawNotes').value.trim() || null;
  if (!jobId) return toast('Select a job.', 'error');

  try {
    await Data.withdrawExcessMaterial(excessId, jobId, by, notes);
    closeSheet();
    toast('Material withdrawn to job.', 'success');
    loadExcessLists();
  } catch (e) {
    toast('Withdrawal failed: ' + e.message, 'error');
  }
}
