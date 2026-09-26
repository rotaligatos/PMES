/* =====================================================================
   ModCraft PMES — Production Manufacturing Execution System
   Single-file PWA app logic. Vanilla JS, no build step, per the same
   architecture pattern as ModCraft/SCM/RTMS (PRODUCTION_CONTEXT.md Sec 10).

   Structure:
     1. Supabase client + generic data helpers
     2. App state + navigation
     3. Screen: Jobs list
     4. Screen: New Job intake
     5. Screen: Job detail (material gate, route, stages, components, packing)
     6. Screen: Scan station
     7. Screen: Excess material
     8. Screen: Setup (vocab tables — areas/parts/stages/routes)
     9. Shared UI helpers (toast, sheet, badges)
   ===================================================================== */

const sb = supabase.createClient(PMES_CONFIG.supabaseUrl, PMES_CONFIG.supabaseAnonKey);
const T = (name) => PMES_CONFIG.tablePrefix + name;

/* --------------------------- 1. Data helpers --------------------------- */

const Data = {
  async listJobs() {
    const { data, error } = await sb.from(T('production_jobs')).select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  },
  async getJob(id) {
    const { data, error } = await sb.from(T('production_jobs')).select('*').eq('id', id).single();
    if (error) throw error;
    return data;
  },
  async createJob(payload) {
    const { data, error } = await sb.from(T('production_jobs')).insert(payload).select().single();
    if (error) throw error;
    return data;
  },
  async updateJob(id, patch) {
    const { data, error } = await sb.from(T('production_jobs')).update(patch).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },

  async simulatePaymentStatus(id, newStatus) {
    // TEST-ONLY: stands in for the real Admin-app -> Production payment/vouched feed,
    // which doesn't exist yet (see MODCRAFT_BRIDGE_NOTES.md). In real usage this write
    // would come from an incoming webhook/update, never from a Production user action.
    const { data, error } = await sb.from(T('production_jobs')).update({
      payment_status: newStatus,
      payment_status_source: 'manual_test',
    }).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },

  async listJobMaterials(jobId) {
    const { data, error } = await sb.from(T('job_materials')).select('*').eq('job_id', jobId).order('created_at');
    if (error) throw error;
    return data;
  },
  async createJobMaterial(row) {
    const { data, error } = await sb.from(T('job_materials')).insert(row).select().single();
    if (error) throw error;
    return data;
  },
  async deleteJobMaterial(id) {
    const { error } = await sb.from(T('job_materials')).delete().eq('id', id);
    if (error) throw error;
  },

  async getJobMaterialReadiness(jobId) {
    const { data, error } = await sb.from('pmes_job_material_readiness').select('*').eq('job_id', jobId);
    if (error) throw error;
    return data;
  },
  async getJobMaterialSummary(jobId) {
    const { data, error } = await sb.from('pmes_job_material_summary').select('*').eq('job_id', jobId).maybeSingle();
    if (error) throw error;
    return data;
  },

  async listMaterialReceipts(jobMaterialId) {
    const { data, error } = await sb.from(T('material_receipts')).select('*').eq('job_material_id', jobMaterialId).order('received_at', { ascending: false });
    if (error) throw error;
    return data;
  },
  async createMaterialReceipt(row) {
    const { data, error } = await sb.from(T('material_receipts')).insert(row).select().single();
    if (error) throw error;
    return data;
  },

  // ---- Industrial Engineering module ----
  async listMachines() {
    const { data, error } = await sb.from(T('machines')).select('*').order('created_at');
    if (error) throw error;
    return data;
  },
  async createMachine(row) {
    const { data, error } = await sb.from(T('machines')).insert(row).select().single();
    if (error) throw error;
    return data;
  },
  async updateMachine(id, patch) {
    const { data, error } = await sb.from(T('machines')).update(patch).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },
  async deleteMachine(id) {
    const { error } = await sb.from(T('machines')).delete().eq('id', id);
    if (error) throw error;
  },

  async listOperations() {
    const { data, error } = await sb.from(T('operations')).select('*').eq('active', true).order('sort_order');
    if (error) throw error;
    return data;
  },
  async createOperation(row) {
    const { data, error } = await sb.from(T('operations')).insert(row).select().single();
    if (error) throw error;
    return data;
  },

  async listMachineStandards(machineId) {
    const { data, error } = await sb.from('pmes_machine_operation_capacity').select('*').eq('machine_id', machineId).order('operation_code');
    if (error) throw error;
    return data;
  },
  async listAllStandards() {
    const { data, error } = await sb.from('pmes_machine_operation_capacity').select('*').order('machine_name');
    if (error) throw error;
    return data;
  },
  async upsertStandard(row) {
    const { data, error } = await sb.from(T('machine_operation_standards'))
      .upsert(row, { onConflict: 'machine_id,operation_code' }).select().single();
    if (error) throw error;
    return data;
  },
  async deleteStandard(id) {
    const { error } = await sb.from(T('machine_operation_standards')).delete().eq('id', id);
    if (error) throw error;
  },

  // ---- Time study observations ----
  async listTimeObservations(machineId, operationCode) {
    const { data, error } = await sb.from(T('time_observations')).select('*')
      .eq('machine_id', machineId).eq('operation_code', operationCode)
      .order('observed_at', { ascending: false });
    if (error) throw error;
    return data;
  },
  async addTimeObservation(row) {
    const { data, error } = await sb.from(T('time_observations')).insert(row).select().single();
    if (error) throw error;
    return data;
  },
  async setObservationExcluded(id, excluded, reason) {
    const { data, error } = await sb.from(T('time_observations'))
      .update({ excluded, exclude_reason: reason || null }).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },
  async deleteTimeObservation(id) {
    const { error } = await sb.from(T('time_observations')).delete().eq('id', id);
    if (error) throw error;
  },
  async getObservationSummary(machineId, operationCode) {
    const { data, error } = await sb.from('pmes_time_observation_summary').select('*')
      .eq('machine_id', machineId).eq('operation_code', operationCode).maybeSingle();
    if (error) throw error;
    return data;
  },

  // ---- Line balancing metrics (efficiency / balance delay) ----
  async getRouteBalanceMetrics(routeCode) {
    const { data, error } = await sb.rpc('pmes_route_balance_metrics', { p_route_code: routeCode });
    if (error) throw error;
    return data;
  },

  // ---- OEE production runs ----
  async listProductionRuns(machineId) {
    let q = sb.from('pmes_production_run_oee').select('*').order('run_date', { ascending: false });
    if (machineId) q = q.eq('machine_id', machineId);
    const { data, error } = await q;
    if (error) throw error;
    return data;
  },
  async createProductionRun(row) {
    const { data, error } = await sb.from(T('production_runs')).insert(row).select().single();
    if (error) throw error;
    return data;
  },

  // ---- ModCraft price_services reference (real, existing service catalog + capacity) ----
  async listServiceCapacityMap() {
    const { data, error } = await sb.from('pmes_service_capacity_map').select('*').order('service_name');
    if (error) throw error;
    return data;
  },
  async listLinkedServices(operationCode) {
    const { data, error } = await sb.from(T('operation_service_links')).select('*, price_services(*)').eq('operation_code', operationCode);
    if (error) throw error;
    return data;
  },
  async listAllServiceLinks() {
    const { data, error } = await sb.from(T('operation_service_links')).select('operation_code, price_service_id');
    if (error) throw error;
    return data;
  },
  async assignServiceToMachine(priceServiceId, machineId) {
    const { data, error } = await sb.from(T('service_machine_assignments'))
      .upsert({ price_service_id: priceServiceId, machine_id: machineId }, { onConflict: 'price_service_id,machine_id' })
      .select().single();
    if (error) throw error;
    return data;
  },
  async unassignService(priceServiceId) {
    const { error } = await sb.from(T('service_machine_assignments')).delete().eq('price_service_id', priceServiceId);
    if (error) throw error;
  },

  // ---- Crew/labor operation standards (non-machine services) ----
  async listCrewStandards(operationCode) {
    let q = sb.from('pmes_crew_operation_capacity').select('*');
    if (operationCode) q = q.eq('operation_code', operationCode);
    const { data, error } = await q;
    if (error) throw error;
    return data;
  },
  async upsertCrewStandard(row) {
    const { data, error } = await sb.from(T('crew_operation_standards'))
      .upsert(row, { onConflict: 'operation_code,crew_size' }).select().single();
    if (error) throw error;
    return data;
  },

  async listRouteMappings() {
    const { data, error } = await sb.from(T('route_mappings')).select('*').eq('active', true).order('sort_order');
    if (error) throw error;
    return data;
  },
  // Job Order review gate (Piece 1): staff check -> supervisor approve; returns go to staff or Modcraft.
  async listJoReviews(jobId) {
    const { data, error } = await sb.from(T('jo_reviews')).select('*').eq('job_id', jobId).order('at', { ascending: false });
    if (error) throw error; return data || [];
  },
  async joCheck(jobId, detailsOk, materialsOk, note) {
    const { data, error } = await sb.rpc('pmes_jo_check', { p_job: jobId, p_details_ok: detailsOk, p_materials_ok: materialsOk, p_note: note || null });
    if (error) throw error; return data;
  },
  async joApprove(jobId, note) {
    const { data, error } = await sb.rpc('pmes_jo_approve', { p_job: jobId, p_note: note || null });
    if (error) throw error; return data;
  },
  async joReturn(jobId, to, note) {
    const { data, error } = await sb.rpc('pmes_jo_return', { p_job: jobId, p_to: to, p_note: note });
    if (error) throw error; return data;
  },
  // Job Order review gate (Piece 1): staff check -> supervisor approve; returns go to staff or Modcraft.
  async listJoReviews(jobId) {
    const { data, error } = await sb.from(T('jo_reviews')).select('*').eq('job_id', jobId).order('at', { ascending: false });
    if (error) throw error; return data || [];
  },
  async joCheck(jobId, detailsOk, materialsOk, note) {
    const { data, error } = await sb.rpc('pmes_jo_check', { p_job: jobId, p_details_ok: detailsOk, p_materials_ok: materialsOk, p_note: note || null });
    if (error) throw error; return data;
  },
  async joApprove(jobId, note) {
    const { data, error } = await sb.rpc('pmes_jo_approve', { p_job: jobId, p_note: note || null });
    if (error) throw error; return data;
  },
  async joReturn(jobId, to, note) {
    const { data, error } = await sb.rpc('pmes_jo_return', { p_job: jobId, p_to: to, p_note: note });
    if (error) throw error; return data;
  },
  // Job Order review gate (Piece 1): staff check -> supervisor approve; returns go to staff or Modcraft.
  async listJoReviews(jobId) {
    const { data, error } = await sb.from(T('jo_reviews')).select('*').eq('job_id', jobId).order('at', { ascending: false });
    if (error) throw error; return data || [];
  },
  async joCheck(jobId, detailsOk, materialsOk, note) {
    const { data, error } = await sb.rpc('pmes_jo_check', { p_job: jobId, p_details_ok: detailsOk, p_materials_ok: materialsOk, p_note: note || null });
    if (error) throw error; return data;
  },
  async joApprove(jobId, note) {
    const { data, error } = await sb.rpc('pmes_jo_approve', { p_job: jobId, p_note: note || null });
    if (error) throw error; return data;
  },
  async joReturn(jobId, to, note) {
    const { data, error } = await sb.rpc('pmes_jo_return', { p_job: jobId, p_to: to, p_note: note });
    if (error) throw error; return data;
  },
  // Job Order review gate (Piece 1): staff check -> supervisor approve; returns go to staff or Modcraft.
  async listJoReviews(jobId) {
    const { data, error } = await sb.from(T('jo_reviews')).select('*').eq('job_id', jobId).order('at', { ascending: false });
    if (error) throw error; return data || [];
  },
  async joCheck(jobId, detailsOk, materialsOk, note) {
    const { data, error } = await sb.rpc('pmes_jo_check', { p_job: jobId, p_details_ok: detailsOk, p_materials_ok: materialsOk, p_note: note || null });
    if (error) throw error; return data;
  },
  async joApprove(jobId, note) {
    const { data, error } = await sb.rpc('pmes_jo_approve', { p_job: jobId, p_note: note || null });
    if (error) throw error; return data;
  },
  async joReturn(jobId, to, note) {
    const { data, error } = await sb.rpc('pmes_jo_return', { p_job: jobId, p_to: to, p_note: note });
    if (error) throw error; return data;
  },
  // Actual output (Piece 2): staff keys it from the returned process sheets; supervisor confirms.
  async listStageOutputs(jobId) {
    const { data, error } = await sb.from(T('stage_outputs')).select('*').eq('job_id', jobId).order('work_date', { ascending: false }).order('entered_at', { ascending: false });
    if (error) throw error; return data || [];
  },
  async outputEnter(row) {
    const { data, error } = await sb.rpc('pmes_output_enter', { p_job: row.job_id, p_stage: row.stage_id, p_date: row.work_date, p_pieces: row.pieces,
      p_hours: row.hours, p_operator: row.operator || null, p_machine: row.machine_id || null, p_notes: row.notes || null });
    if (error) throw error; return data;
  },
  async outputDelete(id) { const { error } = await sb.rpc('pmes_output_delete', { p_id: id }); if (error) throw error; },
  async outputConfirm(id, ok, note) { const { error } = await sb.rpc('pmes_output_confirm', { p_id: id, p_ok: ok, p_note: note || null }); if (error) throw error; },
  async listStageTypes() {
    const { data, error } = await sb.from(T('stage_types')).select('*').eq('active', true).order('sort_order');
    if (error) throw error;
    return data;
  },
  async listAreas() {
    const { data, error } = await sb.from(T('areas')).select('*').eq('active', true).order('sort_order');
    if (error) throw error;
    return data;
  },
  async listPartTypes() {
    const { data, error } = await sb.from(T('part_types')).select('*').eq('active', true).order('sort_order');
    if (error) throw error;
    return data;
  },

  async listJobStages(jobId) {
    const { data, error } = await sb.from(T('job_stages')).select('*').eq('job_id', jobId).order('sequence_index');
    if (error) throw error;
    return data;
  },
  async createJobStages(rows) {
    const { data, error } = await sb.from(T('job_stages')).insert(rows).select();
    if (error) throw error;
    return data;
  },
  async updateJobStage(id, patch) {
    const { data, error } = await sb.from(T('job_stages')).update(patch).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },

  async listComponents(jobId) {
    const { data, error } = await sb.from(T('components')).select('*').eq('job_id', jobId).order('full_barcode_id');
    if (error) throw error;
    return data;
  },
  async createComponents(rows) {
    const { data, error } = await sb.from(T('components')).insert(rows).select();
    if (error) throw error;
    return data;
  },
  async updateComponent(id, patch) {
    const { data, error } = await sb.from(T('components')).update(patch).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },
  async findComponentByBarcode(barcode) {
    // Labels printed by Modcraft's Job Order encode the SHORT scan code (e.g. W00000130-V1-P12-01);
    // the long job-area-component-part-NN/TT ID is printed underneath as text. Accept either.
    const bySc = await sb.from(T('components')).select('*').eq('scan_code', barcode).maybeSingle();
    if (bySc.error) throw bySc.error;
    if (bySc.data) return bySc.data;
    const { data, error } = await sb.from(T('components')).select('*').eq('full_barcode_id', barcode).maybeSingle();
    if (error) throw error;
    return data;
  },

  async logStageEvent(row) {
    const { data, error } = await sb.from(T('component_stage_events')).insert(row).select().single();
    if (error) throw error;
    return data;
  },

  async listExcessMaterials(status) {
    let q = sb.from(T('excess_materials')).select('*').order('created_at', { ascending: false });
    if (status) q = q.eq('status', status);
    const { data, error } = await q;
    if (error) throw error;
    return data;
  },
  async createExcessMaterial(row) {
    const { data, error } = await sb.from(T('excess_materials')).insert(row).select().single();
    if (error) throw error;
    return data;
  },
  async withdrawExcessMaterial(excessId, jobId, withdrawnBy, notes) {
    const { error: e1 } = await sb.from(T('excess_materials')).update({ status: 'withdrawn' }).eq('id', excessId);
    if (e1) throw e1;
    const { data, error } = await sb.from(T('material_withdrawals')).insert({
      excess_material_id: excessId, job_id: jobId, withdrawn_by: withdrawnBy, notes
    }).select().single();
    if (error) throw error;
    return data;
  },

  async createPackingList(row) {
    const { data, error } = await sb.from(T('packing_lists')).insert(row).select().single();
    if (error) throw error;
    return data;
  },
  async getPackingListForJob(jobId) {
    const { data, error } = await sb.from(T('packing_lists')).select('*').eq('job_id', jobId).maybeSingle();
    if (error) throw error;
    return data;
  },
  async updatePackingList(id, patch) {
    const { data, error } = await sb.from(T('packing_lists')).update(patch).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },
  async createTallyCards(rows) {
    const { data, error } = await sb.from(T('tally_cards')).insert(rows).select();
    if (error) throw error;
    return data;
  },
  async listTallyCards(packingListId) {
    const { data, error } = await sb.from(T('tally_cards')).select('*').eq('packing_list_id', packingListId);
    if (error) throw error;
    return data;
  },
};

/* --------------------------- 2. App state --------------------------- */

const State = {
  screen: 'jobs',
  routeMappings: [],
  stageTypes: [],
  areas: [],
  partTypes: [],
  currentJobId: null,
};

async function bootstrap() {
  setConn(true);
  try {
    const [routes, stages, areas, parts] = await Promise.all([
      Data.listRouteMappings(), Data.listStageTypes(), Data.listAreas(), Data.listPartTypes()
    ]);
    State.routeMappings = routes;
    State.stageTypes = stages;
    State.areas = areas;
    State.partTypes = parts;
  } catch (e) {
    setConn(false);
    toast('Could not reach Production database. Check connection.', 'error');
    console.error(e);
  }
  render();
}

function setConn(ok) {
  const dot = document.getElementById('connDot');
  const lbl = document.getElementById('connLabel');
  if (!dot) return;
  dot.classList.toggle('off', !ok);
  lbl.textContent = ok ? 'online' : 'offline';
}

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    State.screen = btn.dataset.screen;
    State.currentJobId = null;
    render();
  });
});

function goToJob(id) {
  State.screen = 'jobDetail';
  State.currentJobId = id;
  render();
}

function goToScreen(name) {
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.screen === name));
  State.screen = name;
  render();
}

/* --------------------------- Router --------------------------- */

async function render() {
  const main = document.getElementById('main');
  const title = document.getElementById('screenTitle');
  main.classList.remove('no-pad');

  switch (State.screen) {
    case 'jobs':
      title.textContent = 'Jobs';
      await renderJobsList(main);
      break;
    case 'intake':
      title.textContent = 'New Job';
      if (!pmesCan('supervisor')) { main.innerHTML = '<div class="callout blocked">Creating jobs needs a supervisor, manager or admin.</div>'; break; }
      await renderIntake(main);
      break;
    case 'jobDetail':
      title.textContent = 'Job';
      await renderJobDetail(main);
      break;
    case 'scan':
      title.textContent = 'Scan Station';
      await renderScan(main);
      break;
    case 'excess':
      title.textContent = 'Excess Material';
      await renderExcess(main);
      break;
    case 'ie':
      title.textContent = 'Industrial Engineering';
      await renderIE(main);
      break;
    case 'settings':
      title.textContent = 'Setup';
      await renderSettings(main);
      break;
    default:
      main.innerHTML = '<div class="empty"><p>Unknown screen.</p></div>';
  }
}

/* --------------------------- Shared UI helpers --------------------------- */

let toastTimer = null;
function toast(msg, kind) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = kind ? kind : '';
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

function openSheet(html) {
  document.getElementById('sheet').innerHTML =
    '<button class="sheet-close" onclick="closeSheet()">✕</button><div class="sheet-handle"></div>' + html;
  document.getElementById('sheetBackdrop').classList.add('open');
}
function closeSheet() {
  document.getElementById('sheetBackdrop').classList.remove('open');
}
document.getElementById('sheetBackdrop').addEventListener('click', (e) => {
  if (e.target.id === 'sheetBackdrop') closeSheet();
});

function badgeForMaterialStatus(status) {
  const map = {
    pending_payment: ['gray', 'Pending Payment'],
    mto_in_progress: ['amber', 'MTO In Progress'],
    in_stock: ['blue', 'In Stock'],
    ready_for_cutting: ['green', 'Ready for Cutting'],
  };
  const [cls, label] = map[status] || ['gray', status];
  return `<span class="badge ${cls}">${label}</span>`;
}
function badgeForJobStatus(status) {
  const map = {
    intake: ['gray', 'Intake'],
    material_wait: ['amber', 'Material Wait'],
    in_production: ['blue', 'In Production'],
    packing: ['navy', 'Packing'],
    handed_off: ['green', 'Handed Off'],
    on_hold: ['red', 'On Hold'],
  };
  const [cls, label] = map[status] || ['gray', status];
  return `<span class="badge ${cls}">${label}</span>`;
}
// Job Order review state — shown beside the production status wherever a job is listed.
function badgeForJoReview(job) {
  const s = job && job.jo_review_status;
  if (!s || s === 'approved') return '';
  const map = { received: ['amber', 'JO to check'], checked: ['blue', 'JO awaiting approval'],
    returned: ['red', job.jo_returned_to === 'modcraft' ? 'JO returned to Modcraft' : 'JO returned to staff'] };
  const [cls, label] = map[s] || ['gray', s];
  return '<span class="badge ' + cls + '">' + label + '</span>';
}
function joApproved(job) { return !!job && job.jo_review_status === 'approved'; }
// Job Order review state — shown beside the production status wherever a job is listed.
function badgeForJoReview(job) {
  const s = job && job.jo_review_status;
  if (!s || s === 'approved') return '';
  const map = { received: ['amber', 'JO to check'], checked: ['blue', 'JO awaiting approval'],
    returned: ['red', job.jo_returned_to === 'modcraft' ? 'JO returned to Modcraft' : 'JO returned to staff'] };
  const [cls, label] = map[s] || ['gray', s];
  return '<span class="badge ' + cls + '">' + label + '</span>';
}
function joApproved(job) { return !!job && job.jo_review_status === 'approved'; }
// Job Order review state — shown beside the production status wherever a job is listed.
function badgeForJoReview(job) {
  const s = job && job.jo_review_status;
  if (!s || s === 'approved') return '';
  const map = { received: ['amber', 'JO to check'], checked: ['blue', 'JO awaiting approval'],
    returned: ['red', job.jo_returned_to === 'modcraft' ? 'JO returned to Modcraft' : 'JO returned to staff'] };
  const [cls, label] = map[s] || ['gray', s];
  return '<span class="badge ' + cls + '">' + label + '</span>';
}
function joApproved(job) { return !!job && job.jo_review_status === 'approved'; }
// Job Order review state — shown beside the production status wherever a job is listed.
function badgeForJoReview(job) {
  const s = job && job.jo_review_status;
  if (!s || s === 'approved') return '';
  const map = { received: ['amber', 'JO to check'], checked: ['blue', 'JO awaiting approval'],
    returned: ['red', job.jo_returned_to === 'modcraft' ? 'JO returned to Modcraft' : 'JO returned to staff'] };
  const [cls, label] = map[s] || ['gray', s];
  return '<span class="badge ' + cls + '">' + label + '</span>';
}
function joApproved(job) { return !!job && job.jo_review_status === 'approved'; }
function badgeForDest(dest) {
  const map = { MSSI: 'navy', WCLI: 'blue', CWLI: 'amber' };
  return `<span class="badge ${map[dest] || 'gray'}">${dest}</span>`;
}
function badgeForStageStatus(status) {
  const map = {
    not_started: ['gray', 'Not started'],
    queued: ['amber', 'Queued'],
    in_progress: ['blue', 'In progress'],
    complete: ['green', 'Complete'],
    delayed: ['red', 'Delayed'],
  };
  const [cls, label] = map[status] || ['gray', status];
  return `<span class="badge ${cls}">${label}</span>`;
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function escapeHtml(s) {
  return (s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── Sign-in ─────────────────────────────────────────────────────────────────
// Google sign-in with a company account. Production has its OWN user list (pmes_users),
// separate from Modcraft's and KEYSTONE's — managed in the Command Center or, by a PMES admin,
// in Setup → Users. pmes_me() and every table's row-level security check that list, by role:
//   operator   — scan and log work, only at their own stations (if any are set)
//   supervisor — all stations, jobs, job materials, packing
//   manager    — + setup lists, machines, standards
//   admin      — + manage Production users
State.me = null;
// staff = office production staff (not a machine operator): reads everything, writes nothing yet.
const PMES_RANK = { staff: 5, operator: 10, supervisor: 20, manager: 30, admin: 40 };
function pmesCan(minRole) {
  return (PMES_RANK[State.me && State.me.role] || 0) >= (PMES_RANK[minRole] || 99);
}
function pmesStations() {
  return (State.me && Array.isArray(State.me.stations)) ? State.me.stations : [];
}
// An operator with stations set may only log those stages; everyone above sees all of them.
function pmesStageAllowed(code) {
  if (pmesCan('supervisor')) return true;
  const st = pmesStations();
  return !st.length || st.includes(code);
}
function applyRoleToNav() {
  const hide = { intake: !pmesCan('supervisor') };
  document.querySelectorAll('.tab-btn').forEach((b) => {
    b.style.display = hide[b.dataset.screen] ? 'none' : '';
  });
}

function renderSignIn(message) {
  document.getElementById('screenTitle').textContent = 'Sign in';
  document.querySelector('nav.tabbar').style.display = 'none';
  document.getElementById('main').innerHTML = `
    <div class="card" style="max-width:420px;margin:40px auto;text-align:center">
      <h2>ModCraft Production</h2>
      <p class="small" style="margin:8px 0 18px">Sign in with your company Google account. Your account must be on the Production user list.</p>
      ${message ? `<div class="callout blocked" style="margin-bottom:14px;text-align:left">${message}</div>` : ''}
      <button class="btn primary block" onclick="pmesSignIn()">Sign in with Google</button>
      ${message ? `<button class="btn outline block" style="margin-top:8px" onclick="pmesSignOut()">Use a different account</button>` : ''}
    </div>`;
}

async function pmesSignIn() {
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: location.origin + location.pathname },
  });
  if (error) renderSignIn('Could not start sign-in: ' + escapeHtml(error.message));
}

async function pmesSignOut() {
  await sb.auth.signOut();
  State.me = null;
  renderSignIn();
}

function renderUserChip() {
  const conn = document.querySelector('header.topbar .conn');
  if (!conn || !State.me) return;
  let chip = document.getElementById('userChip');
  if (!chip) {
    chip = document.createElement('span');
    chip.id = 'userChip';
    chip.style.cssText = 'margin-left:10px;cursor:pointer;text-decoration:underline';
    chip.title = 'Sign out';
    chip.onclick = () => { if (confirm('Sign out of Production?')) pmesSignOut(); };
    conn.appendChild(chip);
  }
  chip.textContent = (State.me.name || State.me.email) + ' · ' + State.me.role;
}

async function authGate() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return renderSignIn();
  const { data: me, error } = await sb.rpc('pmes_me');
  if (error) return renderSignIn('Could not check your account: ' + escapeHtml(error.message));
  if (!me) {
    return renderSignIn('<strong>' + escapeHtml(session.user.email || '') + '</strong> is not on the Production user list, '
      + 'or has been deactivated. Ask a Production admin to add you (Command Center, or PMES Setup → Users).');
  }
  State.me = me;
  document.querySelector('nav.tabbar').style.display = '';
  applyRoleToNav();
  if (!pmesCan('supervisor')) {
    State.screen = 'scan';
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.screen === 'scan'));
  }
  renderUserChip();
  bootstrap();
}

sb.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') renderSignIn(); });

// start on load
authGate();

// Installable: a no-cache worker (see sw.js — it must never cache).
if ('serviceWorker' in navigator && location.protocol === 'https:')
  navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(function () {});
