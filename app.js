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
  // Piece 4: service capacity lives in PMES per company (pmes_service_capacity); Modcraft reads it.
  async listServiceCapacityMap(company) {
    const { data, error } = await sb.rpc('pmes_service_capacity_sheet', { p_company: company });
    if (error) throw error;
    return (data || []).map((r) => Object.assign(r, { modcraft_machine_type: r.machine_type, display_uom: r.unit, display_capacity: r.daily_capacity }));
  },
  async setServiceCapacity(company, name, patch) {
    const { error } = await sb.rpc('pmes_service_capacity_set', { p_company: company, p_name: name,
      p_teams: patch.teams === undefined ? null : patch.teams, p_shifts: patch.shifts === undefined ? null : patch.shifts,
      p_output: patch.output === undefined ? null : patch.output, p_svc_type: patch.svc_type || null,
      p_machine_type: patch.machine_type === undefined ? null : patch.machine_type, p_remarks: patch.remarks === undefined ? null : patch.remarks });
    if (error) throw error;
  },
  async seedServiceCapacity(company, force) {
    const { data, error } = await sb.rpc('pmes_service_capacity_seed', { p_company: company, p_force: !!force });
    if (error) throw error; return data;
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
  async joCheck(jobId, detailsOk, materialsOk, note, proceedIncomplete) {
    const { data, error } = await sb.rpc('pmes_jo_check', { p_job: jobId, p_details_ok: detailsOk, p_materials_ok: materialsOk, p_note: note || null, p_proceed_incomplete: !!proceedIncomplete });
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
  // Process capacity per company (Piece 3) — the home of capacity; Modcraft is mirrored in once.
  async listStageCapacity(company) {
    const { data, error } = await sb.from(T('stage_capacity')).select('*').eq('company', company);
    if (error) throw error; return data || [];
  },
  async setStageCapacity(company, stage, unit, teams, shifts, output, workdays, note) {
    const { error } = await sb.rpc('pmes_capacity_set', { p_company: company, p_stage: stage, p_unit: unit, p_teams: teams, p_shifts: shifts, p_output: output, p_workdays: workdays, p_note: note || null });
    if (error) throw error;
  },
  async mirrorCapacity(company, force) {
    const { data, error } = await sb.rpc('pmes_capacity_mirror_modcraft', { p_company: company, p_force: !!force });
    if (error) throw error; return data;
  },
  // MRF from KEYSTONE (warehouse processes it there; production confirms receipt here).
  async jobMaterialState(jobId) {
    const { data, error } = await sb.rpc('pmes_job_material_state', { p_job: jobId });
    if (error) throw error; return data || { state: 'no_mrf' };
  },
  async listJobMRs(jobId) {
    const { data, error } = await sb.rpc('pmes_job_mrs', { p_job: jobId });
    if (error) throw error; return data || [];
  },
  async receiveMR(mrId, lines, note) {
    const { data, error } = await sb.rpc('pmes_mr_receive', { p_mr: mrId, p_lines: lines, p_note: note || null });
    if (error) throw error; return data;
  },
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
    // QR labels (2026-10-17) spell out "CODE | size | board | EB …" — the part code is the first field.
    barcode = String(barcode || '').split('|')[0].trim();
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
  screen: 'mywork',
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

// Phase 4 (2026-10-29): opening a job keeps the tab you were on, and Back returns there.
const SCREEN_LABEL = { mywork: 'My work', jobs: 'Jobs', schedule: 'Schedule', scan: 'Scan', dashboard: 'Overview', materials: 'Materials overview' };
function goToJob(id, tab) {
  if (State.screen !== 'jobDetail') State.backTo = SCREEN_LABEL[State.screen] ? State.screen : 'jobs';
  State.screen = 'jobDetail';
  State.currentJobId = id;
  State.jobTabNext = tab || null;
  render();
}

// Screens reached from the More menu light up the More tab.
const MORE_SCREENS = ['intake', 'excess', 'ie', 'settings', 'dashboard', 'materials'];
function goToScreen(name) { if (typeof stopCameraScan === 'function' && name !== 'scan') stopCameraScan();
  const tab = MORE_SCREENS.includes(name) ? 'more' : name;
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.screen === tab));
  State.screen = name;
  State.currentJobId = null;
  render();
}
// What the More menu offers this person (Rommel 2026-09-27: IE and Setup are for managers).
function moreItems() {
  const acting = !!(State.me && State.me.acting_for);
  const notOp = (State.me && State.me.role) !== 'operator';
  return [
    ['dashboard', '📊', 'Overview', 'Every open job and the counts behind each step', pmesCan('supervisor') || pmesIsQa('supervisor')],
    ['materials', '📦', 'Materials overview', 'Receiving, QA and office lanes across all jobs', notOp],
    ['intake', '➕', 'New Job', 'Make a job by hand (jobs normally come from KEYSTONE)', pmesCan('supervisor')],
    ['excess', '🪵', 'Excess material', 'Offcuts and leftover stock', pmesCan('supervisor')],
    ['ie', '📐', 'Industrial Engineering', 'Capacity, standards, line balance', pmesCan('manager')],
    ['settings', '⚙️', 'Setup', 'Users, delegation, routes and lists', pmesCan('manager') || acting],
  ].filter((x) => {
    // Per-user screens (Command Center → PMES → Users → Screens). Delegated managers keep Setup.
    const acc = State.me && State.me.access;
    if (acc && Array.isArray(acc.more)) return acc.more.includes(x[0]) || (x[0] === 'settings' && acting);
    return x[4];
  });
}
function renderMore(main) {
  const items = moreItems();
  // PMES admins: preview the app as any user (read-only). Not offered while already previewing (use the banner).
  const va = State.realMe && State.realMe.role === 'admin' && !State.viewAs
    ? `<button onclick="pmesViewAsPicker()"><span class="ic">👁</span><span><strong>View as…</strong><span class="small">See PMES exactly as another user does (read-only)</span></span></button>` : '';
  main.innerHTML = items.length || va
    ? `<div class="more-grid">${items.map(([k, ic, t, d]) => `<button onclick="goToScreen('${k}')"><span class="ic">${ic}</span><span><strong>${t}</strong><span class="small">${d}</span></span></button>`).join('')}${va}</div>`
    : '<div class="empty"><p>Nothing else for your role.</p></div>';
}

/* --------------------------- Router --------------------------- */

async function render() {
  const main = document.getElementById('main');
  const title = document.getElementById('screenTitle');
  main.classList.remove('no-pad');

  switch (State.screen) {
    case 'mywork':
      title.textContent = 'My work';
      await renderMyWork(main);
      break;
    case 'dashboard':
      title.textContent = 'Overview';
      await renderDashboard(main);
      break;
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
    case 'schedule':
      title.textContent = 'Schedule';
      await renderSchedule(main);
      break;
    case 'ie':
      title.textContent = 'Industrial Engineering';
      await renderIE(main);
      break;
    case 'settings':
      title.textContent = 'Setup';
      if (!(pmesCan('manager') || (State.me && State.me.acting_for))) { main.innerHTML = '<div class="callout blocked">Setup is for managers and admins.</div>'; break; }
      await renderSettings(main);
      break;
    case 'materials':
      title.textContent = 'Materials';
      await renderMaterials(main);
      break;
    case 'more':
      title.textContent = 'More';
      renderMore(main);
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
  const map = { received: ['amber', 'JO to check'], checked: ['blue', 'JO awaiting approval'], supervisor_ok: ['amber', 'JO awaiting manager'],
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

/* Test quotations (QT-X…, Modcraft) reach PMES only for admins (database rule). Mark them on every
   screen anyway, so an admin cannot mistake a test job for a real one. Takes a job or a serial. */
function isTestJob(x) { return /^QT-X/.test(String((x && typeof x === 'object') ? (x.quotation_serial || x.serial || '') : (x || ''))); }
function testTag(x) { return isTestJob(x) ? '<span class="badge test-tag" title="Test quotation — not a real job">TEST</span>' : ''; }

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
// materials = the person who completes the material transfer (confirms MRF receipt); same rank as staff.
// Phase 2 (2026-10-29): two departments. The production ladder below is Production's; QA roles sit
// outside it (rank 1 = may read everything, acts only on QA steps) and use pmesIsQa() instead.
const PMES_RANK = { staff: 5, materials: 5, operator: 10, shift_head: 15, production_engineer: 18, supervisor: 20, manager: 30, admin: 40,
  qa: 1, qa_supervisor: 1, qa_manager: 1 };
const PMES_QA_LEVEL = { qa: 1, qa_supervisor: 2, qa_manager: 3, admin: 9 };
// QA steps (incoming inspection, boards, final check and hand-off). Admin counts as QA.
function pmesIsQa(min) { return (PMES_QA_LEVEL[State.me && State.me.role] || 0) >= ({ supervisor: 2, manager: 3 }[min] || 1); }
function pmesDept() { const i = State.me && State.me.role_info; return (i && i.department) || 'production'; }
// Which department owns each step of the job flow (Phase 4). Other steps are shown read-only.
const STEP_OWNER = { receive: 'Production · Receiving', qa_in: 'QA · Inspection', review: 'Production · Office staff and supervisor',
  production: 'Production · Floor (shift head, operators, supervisor)', release: 'QA · Final check' };
// Returned process JO sheets are encoded by office staff, supervisor and above as backup (Rommel 2026-10-29).
function pmesCanEncode() { return pmesAct('encode_paper', (State.me && State.me.role === 'staff') || pmesCan('supervisor')); }
// Per-user action switches (Command Center → PMES → Users → Actions). pmes_me returns the effective
// value (role default with the user's override); the database enforces the same thing (pmes_allow).
// roleOk is the old role rule, used only if the database has not sent access yet.
function pmesAct(key, roleOk) {
  const a = State.me && State.me.access && State.me.access.actions;
  return (a && typeof a[key] === 'boolean') ? a[key] : !!roleOk;
}
function pmesOwnsStep(key) {
  const r = (State.me && State.me.role) || '';
  if (r === 'admin' || !STEP_OWNER[key]) return true;
  if (key === 'qa_in' || key === 'release') return pmesIsQa();
  if (key === 'receive') return ['materials', 'supervisor', 'manager'].includes(r);
  if (key === 'review') return ['staff', 'supervisor', 'manager'].includes(r);
  if (key === 'production') return ['operator', 'shift_head', 'production_engineer', 'staff', 'supervisor', 'manager'].includes(r);
  return false;
}
// The 5-step strip, compact (lists, job header). onClick: a function name taking the step key, or none.
function pmesFlowStrip(steps, onClick) {
  return '<div class="mw-strip">' + (steps || []).map((s) => {
    const tip = s.n + ' ' + s.title + ' · ' + s.dept + ' · ' + s.team + ' — ' + (s.note || '');
    return '<span class="mw-seg ' + s.state + (onClick ? ' click' : '') + (pmesOwnsStep(s.key) ? ' mine' : '') + '" title="' + escapeHtml(tip) + '"'
      + (onClick ? ' onclick="event.stopPropagation();' + onClick + '(\'' + s.key + '\')"' : '') + '>'
      + '<span class="mw-seg-bar"></span><span class="mw-seg-l">' + s.n + ' ' + escapeHtml(s.title) + '</span></span>';
  }).join('') + '</div>';
}
function pmesWaitingLine(f) {
  const w = f && f.waiting_on;
  if (!f) return '';
  if (!w) return '<span class="small">All steps done</span>';
  return '<span class="small">Waiting on <strong>' + escapeHtml(w.dept + ' · ' + w.team) + '</strong> — ' + escapeHtml(w.note || '') + '</span>';
}
function pmesRoleLabel(role) {
  return ({ materials: 'Receiving', staff: 'Office staff', operator: 'Operator', shift_head: 'Shift head (foreman)',
    production_engineer: 'Production engineer (IE)', supervisor: 'Production supervisor', manager: 'Production manager',
    qa: 'QA/QC technician', qa_supervisor: 'QA supervisor', qa_manager: 'QA manager', admin: 'Admin' })[role] || role;
}
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
// Phase 3 (2026-10-29): each role sees only the tabs for its own work (plan: "What each person sees").
const PMES_TABS = {
  operator: ['scan', 'mywork'],
  materials: ['mywork', 'jobs', 'more'],
  staff: ['mywork', 'jobs', 'more'],
  shift_head: ['mywork', 'jobs', 'schedule', 'more'],
  production_engineer: ['mywork', 'jobs', 'schedule', 'more'],
  supervisor: ['mywork', 'jobs', 'scan', 'schedule', 'more'],
  qa: ['mywork', 'jobs', 'scan', 'more'], qa_supervisor: ['mywork', 'jobs', 'scan', 'more'], qa_manager: ['mywork', 'jobs', 'scan', 'more'],
};
function pmesTabs() {
  const acc = State.me && State.me.access;
  if (acc && Array.isArray(acc.tabs)) return acc.tabs;
  return PMES_TABS[(State.me && State.me.role) || ''] || ['mywork', 'jobs', 'scan', 'schedule', 'more'];
}
function pmesHome() {
  const acc = State.me && State.me.access, me = State.me || {};
  if (acc && acc.home) return acc.home;
  return me.role === 'operator' ? 'scan' : ['shift_head', 'production_engineer'].includes(me.role) ? 'schedule' : 'mywork';
}
function applyRoleToNav() {
  const tabs = pmesTabs();
  document.querySelectorAll('.tab-btn').forEach((b) => {
    const k = b.dataset.screen;
    b.style.display = (tabs.includes(k) && !(k === 'more' && !moreItems().length)) ? '' : 'none';
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
  chip.textContent = (State.me.name || State.me.email) + ' · ' + pmesRoleLabel(State.me.role);
  chip.title = State.viewAs ? 'Previewing — tap to stop' : 'Sign out';
  chip.onclick = State.viewAs ? () => pmesStopViewAs() : () => { if (confirm('Sign out of Production?')) pmesSignOut(); };
  pmesViewAsBanner();
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
  State.realMe = me;
  document.querySelector('nav.tabbar').style.display = '';
  // Command Center's "View in PMES" opens ?viewas=<email>; only a PMES admin can preview.
  const va = new URLSearchParams(location.search).get('viewas');
  if (va && me.role === 'admin') {
    history.replaceState(null, '', location.pathname);
    if (await pmesStartViewAs(va, true)) { bootstrap(); return; }
  }
  pmesEnterAsCurrent();
  bootstrap();
}
// Lay the app out for State.me: tabs, More, landing screen (role default or per-user setting).
function pmesEnterAsCurrent() {
  applyRoleToNav();
  // Landing: operators on Scan, shift head / engineer on Schedule, everyone else My work — unless set per user.
  let home = pmesHome();
  if (!pmesTabs().includes(home)) home = pmesTabs()[0] || 'mywork';
  State.screen = home;
  State.currentJobId = null;
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.screen === home));
  renderUserChip();
}

// ── View as (PMES admins) ───────────────────────────────────────────────────
// The admin sees PMES exactly as that user: the database answers every read as them
// (header x-pmes-view-as, honoured only on GET for a PMES admin — pmes_viewing_as()).
// Nothing can be changed while previewing: reads go out as GET, every other request is stopped here,
// and the database would refuse anyway (GET runs read-only; writes use the admin's own account).
State.viewAs = null;
const _pmesFetch = window.fetch.bind(window);
window.fetch = function (input, init) {
  if (State.viewAs) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    if (url.indexOf(PMES_CONFIG.supabaseUrl) === 0 && !/\/auth\/v1\//.test(url) && method !== 'GET' && method !== 'HEAD') {
      return Promise.resolve(new Response(JSON.stringify({ message: 'Preview only — you are viewing PMES as ' + State.viewAs.email + '. Stop the preview to make changes.', code: 'PREVIEW' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }));
    }
  }
  return _pmesFetch(input, init);
};
// Reads through rpc() must be GET while previewing (arrays and objects encoded for the URL).
const _pmesRpc = sb.rpc.bind(sb);
// Database functions that change data — refused while previewing (the database would refuse too).
const PMES_WRITE_RPCS = new Set(['pmes_attach_job_order', 'pmes_board_request_approve', 'pmes_board_request_create', 'pmes_board_request_escalate', 'pmes_board_save', 'pmes_calendar_reset_week', 'pmes_calendar_save', 'pmes_capacity_mirror_modcraft', 'pmes_capacity_set', 'pmes_client_mat_add', 'pmes_client_mat_receive', 'pmes_component_mark', 'pmes_component_mark_paper', 'pmes_component_reject', 'pmes_component_remake', 'pmes_concern_raise', 'pmes_concern_resolve', 'pmes_cut_plan_adopt', 'pmes_cut_plan_save', 'pmes_delegate_create', 'pmes_delegate_revoke', 'pmes_jo_approve', 'pmes_jo_check', 'pmes_jo_return', 'pmes_job_handoff', 'pmes_mr_receive', 'pmes_offday_cancel', 'pmes_offday_decide', 'pmes_offday_request', 'pmes_output_confirm', 'pmes_output_delete', 'pmes_output_enter', 'pmes_pjo_handout', 'pmes_process_jos_create', 'pmes_qa_inspect', 'pmes_reject_link_plan', 'pmes_reject_verify', 'pmes_schedule_approve', 'pmes_schedule_save', 'pmes_service_capacity_seed', 'pmes_service_capacity_set', 'pmes_view_as_log', 'pmes_flag_outliers', 'pmes_route_balance_metrics']);
sb.rpc = function (fn, args, opts) {
  if (!State.viewAs) return _pmesRpc(fn, args, opts);
  if (PMES_WRITE_RPCS.has(fn)) return Promise.resolve({ data: null, error: { message: 'Preview only — you are viewing PMES as ' + State.viewAs.email + '. Stop the preview to make changes.', code: 'PREVIEW' } });
  const enc = {};
  Object.entries(args || {}).forEach(([k, v]) => {
    if (v === undefined) return;
    enc[k] = Array.isArray(v) ? '{' + v.map((x) => (x === null ? 'NULL' : '"' + String(x).replace(/(["\\])/g, '\\$1') + '"')).join(',') + '}'
      : (v !== null && typeof v === 'object') ? JSON.stringify(v) : v;
  });
  return _pmesRpc(fn, enc, Object.assign({}, opts, { get: true }));
};
function _pmesSetViewHeader(email) {
  const h = sb.rest && sb.rest.headers;
  if (!h) return false;
  if (typeof h.set === 'function') { if (email) h.set('x-pmes-view-as', email); else h.delete('x-pmes-view-as'); }
  else if (email) h['x-pmes-view-as'] = email; else delete h['x-pmes-view-as'];
  return true;
}
async function pmesStartViewAs(email, quiet) {
  const real = State.realMe;
  email = String(email || '').trim().toLowerCase();
  if (!real || real.role !== 'admin') { toast('Only a PMES admin can view PMES as another user.', 'error'); return false; }
  if (!email || email === real.email) return false;
  if (State.viewAs) { _pmesSetViewHeader(null); State.viewAs = null; State.me = real; }   // switching user
  const { error: le } = await _pmesRpc('pmes_view_as_log', { p_email: email });   // audit first, as the admin
  if (le) { toast('Could not start the preview: ' + le.message, 'error'); return false; }
  if (!_pmesSetViewHeader(email)) { toast('This browser could not start the preview.', 'error'); return false; }
  State.viewAs = { email };
  const { data: me, error } = await sb.rpc('pmes_me');
  if (error || !me || me.email !== email || !me.viewing_as) {
    _pmesSetViewHeader(null); State.viewAs = null;
    toast('Could not preview ' + email + (error ? ': ' + error.message : ' — the database did not switch (is the access update installed?).'), 'error');
    return false;
  }
  State.viewAs = { email, name: me.name || email };
  State.me = me;
  pmesEnterAsCurrent();
  if (!quiet) render();
  if (!quiet) toast('Viewing PMES as ' + (me.name || email) + '. Changes are off until you stop.', 'success');
  return true;
}
function pmesStopViewAs() {
  if (!State.viewAs) return;
  _pmesSetViewHeader(null);
  State.viewAs = null;
  State.me = State.realMe;
  pmesEnterAsCurrent();
  render();
  toast('Back to your own view.', 'success');
}
function pmesViewAsBanner() {
  let b = document.getElementById('viewAsBanner');
  if (!State.viewAs) { if (b) b.remove(); return; }
  if (!b) {
    b = document.createElement('div');
    b.id = 'viewAsBanner';
    b.style.cssText = 'position:sticky;top:0;z-index:50;background:#7c2d12;color:#fff;padding:8px 14px;font-size:13px;display:flex;gap:10px;align-items:center;flex-wrap:wrap';
    const top = document.querySelector('header.topbar');
    top.parentNode.insertBefore(b, top.nextSibling);
  }
  const m = State.me || {}, acc = m.access || {};
  b.innerHTML = '<span>👁 Viewing as <strong>' + escapeHtml(m.name || m.email) + '</strong> · ' + escapeHtml(pmesRoleLabel(m.role))
    + (m.company ? ' · ' + escapeHtml(m.company) : '') + (acc.custom ? ' · <em>custom access</em>' : '')
    + ' — read-only preview, nothing can be changed.</span>'
    + '<button class="btn sm" style="margin-left:auto;background:#fff;color:#7c2d12" onclick="pmesViewAsPicker()">Switch user</button>'
    + '<button class="btn sm" style="background:#fff;color:#7c2d12" onclick="pmesStopViewAs()">Stop preview</button>';
}
// Picker (sheet) listing everyone the admin may preview.
async function pmesViewAsPicker() {
  const { data, error } = await _pmesRpcAsAdmin('pmes_view_as_list');
  if (error) return toast('Could not load users: ' + error.message, 'error');
  const rows = (data || []).map((u) => '<button class="btn outline block" style="text-align:left;margin-bottom:6px" onclick="closeSheet();pmesStartViewAs(\'' + escapeHtml(u.email) + '\')">'
    + '<strong>' + escapeHtml(u.name || u.email) + '</strong> <span class="small">· ' + escapeHtml(pmesRoleLabel(u.role)) + (u.company ? ' · ' + escapeHtml(u.company) : '')
    + (u.custom ? ' · custom access' : '') + '</span></button>').join('');
  openSheet('<h2>View PMES as…</h2><p class="small" style="margin-bottom:10px">See the app exactly as this person does — their tabs, My work and jobs. Read-only; nothing can be changed while previewing. Each preview is logged.</p>'
    + (rows || '<p class="small">No other active users.</p>'));
}
// The picker list is admin-only, so ask without the preview header even while previewing.
async function _pmesRpcAsAdmin(fn, args) {
  const was = State.viewAs; if (was) { _pmesSetViewHeader(null); State.viewAs = null; }
  try { return await _pmesRpc(fn, args || {}); } finally { if (was) { State.viewAs = was; _pmesSetViewHeader(was.email); } }
}

sb.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') renderSignIn(); });

// start on load
authGate();

// Installable: a no-cache worker (see sw.js — it must never cache).
if ('serviceWorker' in navigator && location.protocol === 'https:')
  navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(function () {});
