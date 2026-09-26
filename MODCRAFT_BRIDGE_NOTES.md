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
