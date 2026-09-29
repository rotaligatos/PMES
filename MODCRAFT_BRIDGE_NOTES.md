# MODCRAFT_BRIDGE_NOTES.md — ModCraft → Production linkage

**Status:** Not built. This document exists so the bridge is a defined, scoped task when
you're ready — not a rediscovery exercise. Written 2026-07-17 during the Production v1
scaffold, based on direct inspection of ModCraft's live schema.

---

## Why this is separate from the app itself

Production v1 was deliberately built **standalone** — job intake, route assignment, and
cutting-optimization/component-generation are all manual-entry screens right now. This
follows the same discipline the project already applies to Cabinet Vision and Odoo
(PRODUCTION_CONTEXT.md Sections 7 & 8a): don't build tight coupling to an integration
before its actual shape is confirmed and intentionally chosen.

The seam is real, though — every place Production will eventually read from ModCraft is
already marked in the code (search for "bridge" or "linkage" in the app's source) and the
schema has a soft (non-FK) reference (`pmes_production_jobs.quotation_serial`) sitting
exactly where the real link will attach.

---

## Where both apps actually live

**Same Supabase project:** `nkpekroogqsmfilypowd` ("Modcraft"). This is a correction from
an earlier version of PRODUCTION_CONTEXT.md, which referenced `nssviuuagtlvxjvvvagt` —
that project is actually "Social-Content-Manager," an unrelated app. Production's tables
were built directly in the same project as ModCraft's real data, using a `pmes_` prefix,
specifically so the eventual bridge is a same-database join rather than a cross-project
integration.

---

## What ModCraft's real schema already has (confirmed by inspection, 2026-07-17)

| Table | Relevant columns | What it's for |
|---|---|---|
| `quotations` | `serial` (PK), `status`, `stage`, `service_type`, `company`, `final_approved_at` | The finalized quotation. `serial` is the natural JOB key. `company` is very likely the `destination_company` source (MSSI/WCLI/CWLI). **Correction (2026-07-17 night, checked against real data):** `final_approved_at` is NOT a reliable signal — as of this check, zero quotations have it set, even though two exist at `status = 'Client Approved'` with `final_locked_at` populated. **The trigger to watch is `status = 'Client Approved'`, not the `final_approved_at` timestamp.** This directly affects bridge step 3a below. |
| `quotation_states` | `state` (jsonb), `cost_report` (jsonb) | Probably holds richer per-quotation detail than the flat columns above — worth inspecting `state`'s actual shape before building the route-derivation mapper. |
| `pending_orders` | `type_of_service`, `board_substrate`, `edging`, `boring`, `cutting`, `lipping`, `hg_included`, `hg_groove`, `hg_installation`, `hg_by`, `source_company` | **This answers the Section 11 open question** — service spec is discrete typed columns, not free text, at least at the intake stage. These map naturally onto route-mapping `match_criteria`. |
| `board_layouts` | `serial`, `material`, `color`, `texture`, `thickness_mm`, `board_size`, `boards_needed`, `utilization_pct`, `areas` | This is ModCraft's own cutting-optimization output — already close to what `pmes_excess_materials` needs, and `areas` here should be checked against whether it already uses the `KIT`/`BED`/etc. vocabulary or needs normalization. |
| `drawing_analyses` | `serial`, `file_name`, `file_type`, `component_count`, `raw_file_path`, `output_file_path` | **This is the uploaded cutting list / shop drawing / elevation file** referenced throughout Section 8c. It already has `component_count` — meaning ModCraft may already be parsing components before Production ever sees the job. This is the single most important table to inspect before building the intake bridge. |

---

## The bridge, broken into concrete steps (not yet started)

1. **Inspect `drawing_analyses.raw_file_path` / `output_file_path` contents for a real job.**
   Determines whether the Section 8c open item ("is the file structured or does it need
   normalization?") has an easy or hard answer. This is the highest-leverage single
   investigation — it determines the shape of everything downstream.

2. **Inspect `quotation_states.state` (jsonb) for a real approved quotation.**
   Determines whether service-flag detail lives here or is fully captured by
   `pending_orders`'s discrete columns. This directly feeds `pmes_route_mappings.match_criteria`.

3. **Replace the intake screen's manual destination/service-spec entry with a quotation
   picker** that reads `quotations` (filtered to `final_approved_at is not null`), pulls
   `company` → `destination_company`, and surfaces the linked `pending_orders` /
   `quotation_states` row for the operator to confirm rather than retype.

3a. **(Added 2026-07-17 late evening) Populate `pmes_job_materials` from ModCraft instead of
   manual entry.** As of tonight, required materials per job are entered by hand on the job
   detail page. `board_layouts` (material, color, thickness_mm, boards_needed) is the obvious
   ModCraft-side source once step 1's file inspection clarifies exactly what's available per
   quotation. This is a natural pairing with step 3 — the same quotation picker should be able
   to pre-fill the materials-required list, not just the service spec.

3b. **(Added 2026-07-17 night) Auto-create Production jobs when a quotation reaches Client
   Approved — this is the actual real trigger, not something a Production user does.** Right
   now the "Register approved quotation" screen is manual (a person types in a job code and
   picks options) — it's a stand-in for what should really be: something watches
   `quotations.status = 'Client Approved'` (confirmed as the reliable field — see the
   `quotations` table note above) and automatically inserts a `pmes_production_jobs` row,
   inactive, with `source_quotation_status` snapshotting that status. This could be a Postgres
   trigger on `quotations` itself (same database, so technically straightforward), or a
   polling/webhook approach if the eventual Admin app should be the one deciding when this
   happens instead of ModCraft directly. Worth deciding which owns this decision before
   building it — it's not just a wiring question, it's "does a job appear because ModCraft says
   so, or because Admin says so, once Admin exists."

3c. **(Added 2026-07-17 night) Real payment/vouched status feed.** `payment_status` and
   `job_active` are built and working (see PRODUCTION_CONTEXT.md Section 3), but nothing writes
   to `payment_status` except the manual "🧪 Simulate Admin update" test control. The real
   version needs the Admin app (not yet built at all, per Section 9's deferred list) to push a
   status update into `pmes_production_jobs.payment_status` when someone there marks a Sales
   Order as paid or vouched — likely a webhook Admin calls, or Admin writing directly into this
   same Supabase project if it ends up living here too. Not investigatable yet since Admin
   itself doesn't exist; flagged here so it's not forgotten once it does.

4. **Add the real FK.** Once quotation_serial is reliably populated by the bridge (not just
   an optional manual field), promote `pmes_production_jobs.quotation_serial` from a soft
   reference to `references quotations(serial)`.

5. **Wire `pmes_components` generation to `drawing_analyses`** instead of the manual
   "Generate components" sheet — this is the actual cutting-optimization step Section 5
   describes, and depends entirely on the answer from step 1.

6. **Decide `board_layouts` vs `pmes_excess_materials` overlap.** ModCraft already tracks
   board layout/utilization per quotation. Confirm whether Production's excess-material
   tracking should read/write into `board_layouts` directly or stay a separate table that
   references it — don't duplicate silently.

None of this is started. Steps 1 and 2 are pure investigation (read-only queries against
existing data) and are the natural next session's starting point.

---

## Update 2026-09-26 — bridge built (Modcraft Job Order → KEYSTONE → PMES)

Most of the steps above are now done, by a different route than planned:

- **Modcraft issues a mother Job Order** (`job_orders` table) at the Initial Quotation lock; it
  becomes `ready` when the Final Quotation is client-approved.
- **KEYSTONE's `adm_release_gate`** (Admin App) now, when releasing a ready Job Order:
  - uses the Job Order number as `job_code` (`cutting_list_source='modcraft_conversion'`,
    `source_file_ref='job_orders:<number>'`);
  - creates **one `pmes_components` row per physical piece**, with PMES area/part codes
    (MISC when unrecognised), the short label code in the new **`scan_code`** column, the piece's
    own **`route`** (text[] of stage codes) and its details in **`spec`** (jsonb: part, name,
    material, cut and finished size, edges, tape, bander, grain, grooving, special cut, HPL
    order, source board);
  - creates **one `pmes_job_stages` row per process the job needs**, in production order.
- **This app** (backup of the previous version: `../modcraft-pmes-app.PRE-PROCESSJO-backup`):
  - scan lookup accepts the short `scan_code` as well as `full_barcode_id`;
  - the scan station follows each piece's own `route` when it has one (else the job route);
  - the job page says the routes are per piece, and every stage has a **Process JO** print:
    the pieces that go through that process only, with the columns that process needs
    (cutting is grouped by board).
- Job-level `route_code` stays empty for these jobs; the per-piece routes replace it.

Still open: grooving has no stage type; hole details live on the mother JO only; PMES has no
sign-in, so everything above is readable with the public key (see the Modcraft notes on PMES
auth before adding anything sensitive).

## Update 2026-09-26 (later) — sign-in, mother JO copy, Process JO template

- **Sign-in required.** Google sign-in (same accounts as Modcraft). `pmes_me()` returns the
  signed-in person only if they are an ACTIVE user in Modcraft's `public.users`; every `pmes_*`
  table's policy is `app_current_role() is not null`; views run with `security_invoker`; anon has
  no grants. The site address PMES is served from must be added in Supabase → Authentication →
  URL Configuration → Redirect URLs, or sign-in bounces.
- **`pmes_production_jobs.mother_jo`** — a copy of the Modcraft mother Job Order taken at release
  (parts, board layouts + shelves, holes, hardware, services, `storageFolder`, `sourceKind`).
- **`process-jo.js`** — the Process JO: pieces with 6 working-day tick columns (D1–D6) + a daily
  log; cutting layout (board diagrams + cut sequence, other processes' pieces greyed) for
  CUT/SCUT; edge-banding layout (red = banded edge) + tape totals for EBA/EBB/MEB; boring schedule
  for DRL; HPL boards for HPL/CURE/MHPL; BOM summary; attached files listed from the quotation's
  Storage folder (source file / customer cutting list / elevation, shop drawing, client order
  attachments — quotation printouts are deliberately left out), linked with 7-day signed URLs.

## Update 2026-09-26 (Piece 1) — the Job Order review gate

A released JO is **received**, not runnable. Rommel's rule (MSSI first; per-company later):
`received` → staff ticks *details correct* + *materials available* → `checked` → supervisor
`approved` → only then the Process JOs print and the line can log work. A supervisor can return it
`returned` to staff (re-check) or to Modcraft (messages the quotation's preparer + Modcraft Admins,
and writes the note onto `job_orders.status_note`).

- Columns on `pmes_production_jobs`: `jo_review_status`, `jo_details_ok`, `jo_materials_ok`,
  `jo_checked_by/at`, `jo_approved_by/at`, `jo_returned_to`, `jo_return_note`.
- History: `pmes_jo_reviews` (append-only, read by any PMES user).
- RPCs (security definer, role-checked): `pmes_jo_check` (staff, rank ≥ 5), `pmes_jo_approve`
  (supervisor, rank ≥ 20, requires `checked`), `pmes_jo_return` (supervisor; note required).
- **The gate is a trigger** (`pmes_jo_gate_trg`) on `pmes_job_stages` / `pmes_components`
  (progress changes only — notes pass) and `pmes_component_stage_events`. The app also hides
  Update / Process JO buttons and refuses a scan on an unapproved JO, but the trigger is the rule.
- Staff is a real role now (rank 5, below operator): reads everything, and its ONLY write is the
  JO check (through the RPC).
- Existing test jobs: the one already in packing was marked approved ('setup'); the other waits.

**Coming next (agreed):** Piece 2 actual output (staff keys it from the returned sheets, supervisor
confirms); Piece 3 MSSI machine capacity — its home is PMES, mirrored from Modcraft to start —
then scheduling of approved JOs; Piece 4 status/progress back to Modcraft (later the CRM).
Also on the list: **the MRF released with the JO from KEYSTONE** (`adm_material_requests` is
already authorized at release) needs *processed by the warehouse* → *received by production*
confirmations; and barcode scanning stays the long-term way work is logged.

## Update 2026-09-26 (Piece 2) — actual output

Staff keys what the returned process sheets say was done — per process, per day, pieces, hours,
operator, machine, notes — and a supervisor confirms (or rejects with a note). Only on an approved
JO. Table `pmes_stage_outputs` (read by any PMES user; writes only through RPCs `pmes_output_enter`
staff ≥ 5 · `pmes_output_delete` own unconfirmed entry or supervisor · `pmes_output_confirm`
supervisor ≥ 20). Confirmed pieces drive the stage: `pmes_stage_sync_from_output` sets the stage
in progress at the first confirmed piece and complete when confirmed ≥ planned, where planned =
`pmes_stage_planned(job, stage)` = pieces routed through that stage (own route, else the job's route
mapping — the same rule as the app's `componentsForStage`). Never demotes a stage. First confirmed
output also moves a `material_wait` job to `in_production`. Job page: "Actual output" card with the
entry form, per-process progress bars, and the entry list with Confirm / Reject / Remove; each stage
row shows actual / planned. Nothing here touches barcode scanning — scans stay the long-term way.

## Update 2026-09-26 (Piece 3) — process capacity lives in PMES; schedule from approved JOs

- **`pmes_stage_capacity`** (company × process): unit, teams, shifts/day, output/shift →
  `daily_capacity`, days/week, `source` (modcraft | pmes). **This is the home of capacity now.**
  `pmes_capacity_mirror_modcraft(company)` copies Modcraft's Settings → Services capacity in as the
  starting point, one representative service per process (CUT ← "Cutting MDF/PB/Plywood (4'x8')",
  SCUT ← "Routeriing (Special Cut)", EBA/EBB ← "Edgebanding EVA" one team each, MEB ← "Manual
  Edgebanding EVA", HPL ← "HPL Lamination (MDF/PB, 1 Face)", MHPL ← "HPL Lamination (Plywood, 1 Face)",
  GRV ← "Grooving (3mm width melamine)", DRL ← "Boring 35mm (Hinges)"; workdays/week from PPIC's
  26/month → 6). Rows edited in PMES (`source='pmes'`) are kept by a re-mirror. **MSSI was
  mirrored on 2026-09-26 (9 processes).** ASM / QC / PACK / CURE have no Modcraft figure — set them
  in PMES. Edit: IE tab → "Process capacity" card (manager+; `pmes_capacity_set`).
- **Schedule tab** (`screens-schedule.js`, pure maths in `schedule.js`, tested by
  `node schedule.test.js`): approved, active, not-handed-off JOs of the company, in approval order;
  each process's load taken from the mother JO in that process's own unit (cutting lm, edge-banding
  lm, HPL boards, grooving lm, holes; pieces elsewhere), less confirmed output (Piece 2); days =
  load ÷ daily capacity; one resource per process; Sundays skipped (Saturdays too on a 5-day week).
  A process with no capacity, or capacity in a different unit than the load, is NAMED in the row,
  never divided. Nothing is stored — recomputed from the JOs and outputs. Manual overrides and a
  persisted plan are for later.
- Modcraft still holds its own Services capacity for pricing; PMES reading is the next hand-over
  (Piece 4 territory). Latent: `boot()` can call `render()` before later screen scripts have parsed
  if the session resolves instantly — only seen with a stubbed client, not on a real network.

### Same day — the IE capacity sheet was empty and ungrouped
`pmes_service_capacity_map` reads `price_services.teams/shifts_per_day/output_per_shift` and
`cost_data->>'machineType'`, but Modcraft never wrote those (its Services capacity lives only in
Settings CONFIG → `serviceCapacity`; `cost_data` was `{}`), so the sheet showed no capacity and no
machine grouping. Now (migration `pmes_services_mirror_modcraft_capacity`):
- `pmes_sync_services_from_modcraft()` copies CONFIG capacity into those columns and sets a machine
  type from the service name (cutting/ripping/tapering/routering → panel_saw · edgebanding/lipping/
  EBT slitting → edgebander · manual edgebanding → manual_edgebander · boring → boring_machine ·
  HPL lamination/glueing → press). Grooving, sanding, shaker door, postforming etc. stay "Others".
- `pmes_auto_assign_service_machines()` puts each machine-typed service under the first active
  machine of that type (only where nothing is assigned yet — moves you make are kept).
- Both run on every Modcraft **Save settings** (trigger on `settings.CONFIG`) and after any Price DB
  rewrite (statement trigger on `price_services` insert), so the sheet stays in step with Modcraft.
  Verified: changing a service's output in CONFIG updates `price_services` in the same transaction.
Result today: Panel Saw 1 (11 services), Edgebander A (10), Boring Machine 1 (9), Manual Lamination
Station 1 (5), Manual Edgebander 1 (2), Others (29). No app code change was needed.

## Update 2026-09-26 (Piece 4) — PMES owns capacity; Modcraft reads it + sees production progress

- **`pmes_service_capacity`** (company × service NAME): teams, shifts/day, output/shift → daily, type,
  Modcraft's machine label, remarks, source. Keyed by name so a Price DB rewrite cannot lose it.
  Seeded for MSSI from Modcraft's CONFIG (90 services). Edit: IE sheet (manager+;
  `pmes_service_capacity_set`), "Seed from Modcraft" for another company (`pmes_service_capacity_seed`,
  keeps PMES-edited rows). The sheet reads `pmes_service_capacity_sheet(company)` — company from the
  signed-in user, switchable by managers (shared with the Schedule/Process-capacity selector).
- **The Modcraft → PMES mirror triggers are DROPPED.** Modcraft's Save settings no longer touches
  PMES capacity (verified). `pmes_sync_services_from_modcraft()` still exists as a manual tool only.
- **Modcraft reads** `modcraft_service_capacity(company)` after its Price DB loads
  (`supaLoadPmesCapacity`, flag `CAPACITY_FROM_PMES`) and shows the capacity fields read-only in
  Settings → Services. Falls back to its own CONFIG copy when not connected. Pricing/cost breakdown
  use the signed-in user's company; a per-quotation company read is a later refinement.
- **Modcraft's Job Orders panel** calls `modcraft_jo_progress(serial)`: PMES job code/status, the
  review gate state, a return note when production sent it back, and per-process confirmed/planned.
  Read-only; any Modcraft user whose company may see the quotation.

## Update 2026-09-26 — MRF confirmations (warehouse processed → production received)

The MRF already existed in KEYSTONE: `adm_build_material_requests` builds it on a gate from
`adm_material_summary` ← `adm_extract_materials(serial)`, which reads the **Modcraft quotation's own
scope** (Final Quotation areas once it reached Stage 2): BOM items' materials/hardware, carcass
templates, cutting-list materials, outsource rows — client-supplied items excluded. Two streams:
warehouse (stock) and purchase (outsource + made-to-order). Authorized at release. New:
- **Warehouse "processed"** — KEYSTONE → Material Requests → Lines: per-line processed qty +
  Confirm processed (`adm_mr_process`, new cap **`can_issue`** "Warehouse issue", set in the Command
  Center; Admin/Director have it). Status → partially_issued / issued.
- **Production "received"** — PMES job page → "Material requests (MRF)": per-line received qty (up
  to processed) + Confirm received (`pmes_mr_receive`, staff+). Status → partially_received /
  received. Each received delta also writes a `pmes_material_receipts` row on the matching job
  material (`pmes_job_materials.mr_line_id`, now set by `adm_release_gate`), so material readiness
  and the JO check see it. PMES reads MRFs via `pmes_job_mrs(job)` (PMES users aren't KEYSTONE users).
- Both steps append to `adm_audit_log` (`mr.process`, `mr.receive`). Over-processing, over-receiving
  and processing without the cap are refused in the database (tested, rolled back).
- MRFs released BEFORE today have no `mr_line_id` link: their receipts update the MRF but not the
  job-material readiness bars. No MRF has been released yet, so nothing is affected.

## Update 2026-09-26 — materials status in the JO gate; proceeding with incomplete materials

Rommel: materials are completed (received) by a different person who also uses PMES; the staff
checking the JO see whether materials are complete or partial; staff may recommend proceeding with
incomplete materials, with the approval of a supervisor AND a manager.
- New PMES role **`materials`** (rank 5): the only non-supervisor who may confirm MRF receipt
  (`pmes_mr_receive` now requires role `materials` or rank ≥ 20). Staff can no longer receive.
- `pmes_job_material_state(job)` → complete / partial / none / no_mrf, from the job's MRF lines.
  The JO check reads it; the "materials available" tick only exists for jobs with no MRF.
- `pmes_jo_check(..., p_proceed_incomplete)`: details ok + materials complete → `checked`;
  details ok + incomplete + recommend (reason required) → `checked` with `jo_proceed_incomplete`.
  Only staff / supervisor / manager / admin may check (materials and operators may not).
- `pmes_jo_approve`: complete → one supervisor approval. Incomplete → supervisor first
  (`supervisor_ok`), then a manager, **two different people**; a manager cannot go first. If the
  materials become complete in between, the single approval suffices. Nothing reaches the line
  before `approved` (the Piece 1 trigger is unchanged).
- Tested by impersonation, rolled back (staff refused receiving; 4/10 received; manager-first and
  output-before-manager refused; history in order).
- **Cleanup:** re-running the Piece 1 patch had inserted the review-gate data methods and two
  helpers into app.js FOUR times (object keys / function declarations — last copy won, so it
  worked, but it was a mess). Deduplicated to one copy each.

## Update 2026-09-26 — board inspection, defect map, cutting optimization, additional boards

Boards are not always perfect. Rommel's flow (decided via questions): the **materials** person
inspects each board; **staff** re-run the cutting optimization, a **supervisor** adopts; extra boards
need **supervisor then manager** in PMES, then **KEYSTONE** accepts (→ MRF) or rejects; a rejection may
be **escalated to the Head of Plant Operations**, whose decision is final.
- `pmes_boards` (job, group_key = material|color|texture|thickness|faces — the JO's board group,
  board_no, size, status ok/defect/rejected) + `pmes_board_defects` (x, y, w, h in board mm, type).
  Saved through `pmes_board_save` (materials role or supervisor+). A board with defects cannot stay
  "ok". Job page → "Boards received — inspection": drag a box on the board drawing to mark a defect.
- `optimizer.js` (pure, `node optimizer.test.js`, 10 checks): Modcraft's guillotine shelf packer —
  **placement-for-placement identical to Modcraft's `guillotinePackBoards`** when there are no defects
  (the test loads Modcraft's own function from ../../Modcraft/index.html) — plus: real boards opened
  in inspection order, rejected boards never used, defects are no-cut zones (a strip moves along past a
  defect, or sideways past it = one extra rip/crosscut of waste, still guillotine), and clean "extra"
  boards counted when real ones run out. Pieces use the JO's cut sizes and grain.
- `pmes_cut_plans` (versions; staff save `pmes_cut_plan_save`, supervisor `pmes_cut_plan_adopt`). The
  process JO prints the ADOPTED plan's layout, with defects drawn red; otherwise Modcraft's.
  Known gap: the printed cut sequence does not list the extra waste crosscut where a strip skips a defect.
- `pmes_board_requests`: create (staff/materials/supervisor+, reason required) → `pmes_board_request_approve`
  (supervisor, then manager, different people) → KEYSTONE "Board Requests" tab:
  `adm_board_request_decide` (cap can_issue or can_release) → accept = `adm_mr_from_board_request`
  (warehouse MRF, authorized, lines linked to new pmes_job_materials rows) → processed/received as
  usual. Reject → `pmes_board_request_escalate` (PMES supervisor+) → `adm_board_request_final` —
  requires the explicit **`is_plant_head`** cap (NOT granted to Admins automatically, like KEYSTONE's
  other approver roles). Every decision in `adm_audit_log`. Whole chain tested, rolled back.
- Defect records are kept per board and job, so defect rates by material/supplier can be reported later.

## Update 2026-09-26 — first end-to-end test run (rolled back)
A test Job Order built by Modcraft's own code (`_cutListToAnalysis` → `_joBuild`, 11 pieces, 3 boards,
special cut, grooving, boring) was taken through gate → MRF → payment → release → warehouse issue →
receipt → board inspection → JO check → approval → output on all 8 processes → `modcraft_jo_progress`,
as the real people in each role, inside one rolled-back transaction. Everything worked; refusals held
(staff cannot receive, no output before approval). One fault fixed: release mapped only
sheet/sqm/pcs/kg, but the catalogue uses "pc" and "lm", so every real line arrived as "other".
Now `pmes_norm_unit()` (pc→pcs, lm→lm, roll, set …); `pmes_job_materials.unit` allows lm/roll/set;
an unrecognised unit is kept in the notes. Note: PMES users read MRFs only via `pmes_job_mrs()` —
they have no direct access to `adm_material_requests`.

## Update 2026-09-27 — two-person rule on the Job Order, manager's discretion
Whoever checked a Job Order cannot approve it. A manager (or admin) may approve their own check, or
approve an incomplete-materials JO without the supervisor step, only at their discretion when staff
or the supervisor is absent (or they delegated) — a written reason is required and recorded
("Manager discretion: …" in the history, `jo_manager_discretion` / `jo_discretion_reason`).
Enforced in `pmes_jo_approve`; the review card shows the matching button. Tested by impersonation,
rolled back: supervisor self-approval refused; manager without reason refused; with reason approved.

## Update 2026-09-27 — approval delegation
`pmes_delegations` (history, revoked never deleted). A manager (or a PMES admin for any manager)
delegates Job Order approval authority to an active staff/supervisor/manager for up to 60 days, with a
reason (`pmes_delegate_create`, `pmes_delegate_revoke`). `pmes_acting_for()` / `pmes_me().acting_for`.
`pmes_jo_approve` uses the delegation ONLY where manager authority is needed (a staff delegate's
approval, the manager step on incomplete materials, manager discretion) and then records
"On behalf of <manager> (delegated)" + `jo_approved_on_behalf_of`. A delegation from someone no
longer an active manager stops counting. Setup → Approval delegation. Tested by impersonation, rolled back.

## Update 2026-09-27 — Dashboard is the home screen; RTmo logo
`pmes_dashboard(company)` (one call): counts of JOs to check / to approve / to manager / returned, materials to receive, output to confirm, board requests, in production, handed off (30 days), plus every open job with review + material status and progress (confirmed vs planned). Tiles that are the signed-in person's to act on are marked. Plant filter defaults to the user's company (`pmes_me().company`). Operators still open on Scan. RTmo logo top right.

## Update 2026-09-27 — layout rework (Rommel: "not optimized and user friendly")
- Main tabs: Dashboard · Jobs · Materials · Scan · Schedule · More. More holds New Job and Excess
  (supervisor+), IE and Setup (manager+, Setup also for a delegate). On screens ≥900px the tabs sit under
  the header; phones keep them at the bottom. Landing: operators → Scan, materials → Materials, others → Dashboard.
- **Materials** (new, `pmes_materials_inbox`): every open job's MRFs with Receive in place, boards still
  to inspect, extra-board requests; "Needs action only" filter; plant filter shared with the Dashboard.
- **Job page** in sub-tabs: Overview (JO review, progress, notes) · Materials (the MRF; the hand-kept list
  only for jobs with no MRF — no more showing materials twice) · Cutting (Process JO for CUT/SCUT, board
  inspection, cutting plan, extra boards) · Production (route, processes, output) · Parts · Packing.
  `goToJob(id, tab)` opens a given sub-tab. Tabs carry a dot when something waits.
- Payment status card + its test simulator removed: every job in PMES was released paid or vouched, so it
  is now a tag by the job code. Jobs list: duplicate stat boxes removed, client/project shown and searchable.

## 2026-09-27 — Receipt checked item by item; boards & cutting easier to reach
- `adm_mr_lines` gained `receive_condition` (ok/short/damaged), `receive_note`, `receive_photo`, `receive_checked_by/at`.
- `pmes_mr_receive` now takes per line `{id, qty, condition, note, photo}` and enforces: OK only if the full processed qty arrived; Short and Damaged need a note; Damaged needs a photo that really exists in the private bucket `pmes-receipts` under `<mr_id>/<line_id>/`. Condition defaults to short/ok from the qty for old callers.
- Bucket `pmes-receipts` (private, images, 10 MB): upload = materials role or supervisor+; read = any PMES user, KEYSTONE user, or Modcraft admin tier. No update/delete (evidence).
- `pmes_job_mrs` returns the new fields. Screen: per-item OK / Short / Damaged buttons, note, camera photo on Damaged, "View photo" after. An MRF KEYSTONE has not processed says so and lists its lines.
- Job sub-tab "Cutting" renamed "Boards & cutting"; Overview has a Boards & cutting card (inspected count, plan state, Inspect boards / Cutting optimizer buttons); the Materials page has the same two buttons. `goToBoards(jobId, 'bdInspect'|'bdOptimize')` opens and scrolls.

## 2026-09-28 — Defect position typed in mm; optimizer is the office staff's job
- Board inspection: each defect can be entered as X (across the width, from the left) / Y (along the length, from the
  top = start) / Width / Length in mm, and every marked defect's numbers can be corrected. Dragging still works.
  A size running past the board edge is trimmed; the measured position is never moved.
- Cutting optimizer and extra-board requests belong to the office staff who review the JO (role `staff`) or supervisor+.
  The materials person inspects boards only: the optimizer buttons are hidden for them, `pmes_cut_plan_save` already
  refused them, and `pmes_board_request_create` now refuses them too (migration `pmes_board_request_office_staff_only`).

## 2026-09-28 — Every piece marked done at each process
- New table `pmes_component_done` (component × process, who/when, via manual|scan, note); read by any PMES user, written only
  through `pmes_component_mark(p_components[], p_stage, p_done, p_note, p_via)`: operator+ (operators only at their own
  stations), JO must be approved, the process must be on the piece's route, undo needs a reason and is the marker's or a
  supervisor's. Every mark/undo also lands in `pmes_component_stage_events` (`done` / `undone`).
- Process status now follows the pieces (`pmes_stage_sync`): all planned pieces done → complete, some → in progress, an undo
  moves it back. Jobs without pieces still follow confirmed output counts. `pmes_stage_complete_guard` refuses setting a
  process to Complete by hand while any of its pieces are not done.
- Screens: job sub-tab "Parts" → **Pieces**: a grid of pieces × processes (✓ done, ○ not done, — not on route), tap to mark,
  tap ✓ to undo, tick several + mark together, search, "not done only". Overview/Production show "N / M pieces done (x%)"
  and name the pieces not done. Scan station marks the scanned piece done (via 'scan') and shows its route with ticks.
- Modcraft `modcraft_jo_progress` now reports pieces done and a `not_done` list per process.

## 2026-09-28 — Process Job Orders, loading schedule, shift head
- Roles (org: MD – Head of Plant Ops – manager – supervisor – production engineer – shift head – staff – rank and file):
  new `shift_head` (rank 15) and `production_engineer` (rank 18). Staff/materials stay rank 5 — their powers are role-specific.
- `pmes_process_jos`: one Job Order per process, created automatically when the mother JO is approved
  (`pmes_process_jos_on_approve` trigger; existing approved jobs were backfilled). Status to_schedule → scheduled → handed_out →
  in_progress → done, kept in step with the pieces (`pmes_pjo_sync`, triggers on `pmes_job_stages` and `pmes_component_done`).
- Schedule: `pmes_schedule_save` (production engineer+) sets planned dates per process (the screen offers the capacity-based
  recommendation from `schedule.js`); saving a change to an approved schedule returns it to draft. `pmes_schedule_approve`
  (supervisor+) needs dates on every open process. `pmes_production_jobs.schedule_status` none/draft/approved.
- Hand-out: `pmes_pjo_handout` (shift head+) to a machine and/or operators, only once the schedule is approved.
- Screen Schedule (`screens-planboard.js`): Gantt / Kanban / Calendar / Today (shift), remembered per user. Today shows plan for
  the day vs pieces ticked done, and per hour over an assumed 8:00–17:00 shift (lunch 12–1). Shift heads land on it.
- Modcraft `modcraft_jo_progress`: schedule_status, planned dates per process (only once approved), process JO status.

## 2026-09-28 — Work calendar, holidays, off-day approval, two-step schedule approval
- Operating hours are not fixed: `pmes_work_default` (one default week per plant) and `pmes_work_weeks` (any week set differently:
  1–3 shifts, compressed weeks). Days are Monday-first, each {shifts:[{name,start,end,break}]}. `pmes_calendar_save` (production engineer+;
  the default week manager+), `pmes_calendar_reset_week`.
- Holidays: national (settings PH_HOLIDAYS, synced) + local per plant (CONFIG ordersSla.companies[..].localHolidays), via `pmes_holidays`.
  `pmes_calendar_range(company, from, to)` gives each day {shifts, holiday, off_kind holiday|restday, request, working}. A rest day = a day the
  DEFAULT week has no shift. Working a holiday or rest day needs `pmes_offday_requests`: manager → Head of Plant Operations
  (adm_user_caps.is_plant_head) → Managing Director (adm_user_caps.is_md_approver), three different people; only then the day counts.
- Schedule dates cannot start or end on a non-working day (`pmes_schedule_save`, `pmes_schedule_approve`). Approval is now two steps:
  supervisor, then a manager (different people); schedule_status draft → supervisor_ok → approved. Hand-out still needs 'approved'.
- `schedule.js` forwardSchedule(jobs, capacity, start, {dayInfo}) consumes each day's capacity = daily_capacity ÷ shifts_per_day × that day's
  shifts, skipping days that are not working; doneByStage (pieces ticked) replaces confirmed output. Tests in schedule.test.js.
- Screen: Schedule → Work calendar (week editor, quick-fill presets, requests with the approval chain). Today's hourly plan uses today's shifts.

## 2026-09-29 — Schedule practice mode + lamination "ready after cure"
- **Practice with sample Job Orders** (link top right of Schedule, production engineer / shift head and up;
  `screens-planboard-demo.js`). Six sample JOs built in the browser: finished, behind plan, pushed by that
  delay (delay alert), waiting for manager, ending on lamination, draft with recommended dates only. Dates
  come from the real `schedule.js` with sample capacity. Every button works on the sample in memory;
  work calendar / off-day changes are refused; nothing reads or writes the database. "Back to the real
  schedule" reloads. Wraps renderSchedule/pbDraw/pbSave/pbApprove/pbDelayDecide/pbHandoutSave/goToJob.
- **Lamination last** (Rommel): once cured the boards go where the JO says next. When nothing follows
  HPL/MHPL (except CURE) — pick-up or turnover to WCL — the Gantt finish reads "Ready after cure" = the
  day after lamination's last day. When a process follows, the existing rule stands (starts the day after
  lamination's first day, finishes no earlier than the day after its last).
