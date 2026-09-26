# ModCraft PMES — Production (v1 scaffold)

## Start here (Claude Code cold-start checklist)

If you're picking this up with no memory of how it was built, do these in order before
writing any code:

1. **Don't re-create the database.** It already exists and is live. Supabase project ID is
   `nkpekroogqsmfilypowd` (name: "Modcraft"). Run `list_tables` on it — you'll see ~12
   `pmes_`-prefixed tables plus ModCraft's own existing tables (`quotations`,
   `pending_orders`, `board_layouts`, `drawing_analyses`, etc.) in the same project. If you
   see a different/empty project, you're in the wrong one — check `config.js` for the
   canonical URL/key this app actually uses.
2. **Don't assume `nssviuuagtlvxjvvvagt` is relevant.** An earlier draft of
   `PRODUCTION_CONTEXT.md` referenced that project ID; it's a different, unrelated app
   ("Social-Content-Manager"). This was corrected — see that file's own changelog if you
   want the paper trail, but don't re-investigate it.
3. **Read `MODCRAFT_BRIDGE_NOTES.md` in full before touching intake or component
   generation.** It documents exactly what ModCraft's real schema already contains and the
   six concrete steps the bridge involves. Don't start that work without reading it — it'll
   save you from re-deriving conclusions that are already there.
4. **The app has never been opened in an actual browser.** It was validated by syntax
   checking + exercising the full data flow directly via SQL against the live database
   (mirrors what the JS does). Logic should be sound, but nobody has looked at the rendered
   UI. Do this first — `python3 -m http.server` from this folder, open `index.html`, click
   through Jobs → New Job → a job detail → Scan → Excess → Setup once before changing
   anything, so any layout/rendering issues are yours, not inherited confusion.
5. **The single highest-leverage next step, if picking a task fresh, is investigative, not
   code:** inspect `drawing_analyses.raw_file_path` / `output_file_path` for one real
   ModCraft job (bridge step 1 in `MODCRAFT_BRIDGE_NOTES.md`). It determines whether
   automatic barcode/component generation is realistic or needs a manual mapping step —
   most other bridge work depends on that answer.

---

Single-file-per-concern vanilla JS PWA. No build step, no framework — same pattern as
ModCraft/SCM/RTMS. Built 2026-07-17 in one session; intended to move to Claude Code next.

## Run it

Any static file server works — there's no backend beyond Supabase:

```
python3 -m http.server 8080
# open http://localhost:8080/index.html
```

## Files

| File | Purpose |
|---|---|
| `index.html` | App shell: layout, nav, design tokens (CSS vars), all styling |
| `config.js` | Supabase URL + publishable key. **Read the comment at the top** — explains the standalone-vs-bridged status. |
| `app.js` | Data access layer (`Data.*` — one method per table operation), app state, router, shared UI helpers (toast/sheet/badges) |
| `machine-illustrations.js` | Generic flat SVG illustrations per machine type, used by the IE module |
| `screens-jobs.js` | Jobs list screen + "Register approved quotation" (job registration, stands in for a ModCraft quotation reaching Client Approved) |
| `screens-job-detail.js` | Job detail: payment status display + test trigger, materials required/receiving, route/stage tracking, component generation, packing/RTMS handoff |
| `screens-scan.js` | Scan station — barcode lookup and stage completion |
| `screens-excess.js` | Excess material recording + withdrawal |
| `screens-ie.js` | Industrial Engineering module — machine roster, standard time studies, line balancing (takt time, bottleneck detection, workstation load chart) |
| `screens-settings.js` | Read-only view of the editable vocab tables (areas/parts/stages/routes) |
| `manifest.json` | PWA manifest |
| `MODCRAFT_BRIDGE_NOTES.md` | **Read this before touching intake/component-generation logic.** Documents exactly what's deferred and why, and what ModCraft's real schema already offers. |

## Database

Lives in the **same Supabase project as ModCraft** (`nkpekroogqsmfilypowd`, not the
`nssviuuagtlvxjvvvagt` project referenced in older versions of PRODUCTION_CONTEXT.md — that
was a different, unrelated app). All Production tables use a `pmes_` prefix:

```
pmes_areas, pmes_part_types, pmes_stage_types      -- seeded vocab (Section 8c)
pmes_route_mappings                                 -- 5 seed routes (Section 4)
pmes_production_jobs                                -- job header
pmes_job_stages                                     -- per-job stage instances
pmes_components                                     -- barcoded trackable units
pmes_component_stage_events                         -- scan/completion audit log
pmes_packing_lists, pmes_tally_cards                -- packing + RTMS handoff
pmes_excess_materials, pmes_material_withdrawals    -- Section 8a
```

Full DDL is applied directly (via Supabase migrations already run against the live
project) — there's no local schema.sql to re-run. Use `Supabase:list_migrations` /
`list_tables` against `nkpekroogqsmfilypowd` to see current state.

RLS follows the exact same permissive "authenticated full access" pattern already used by
every other table in this project, plus an `anon` read-only policy for shop-floor scan
stations that may run unauthenticated in v1. This mirrors the existing project's own
security posture — not a new pattern I introduced.

## What's real vs. stubbed tonight

**Fully working, tested end-to-end against live data:**
- Job registration (stands in for a ModCraft quotation reaching "Client Approved") — every job starts inactive/grayed out
- Received payment status display (`not_yet_paid`/`paid`/`vouched`) with a clearly-labeled "🧪 Simulate Admin update" test control standing in for the real Admin→Production feed. `job_active` derives automatically via a database trigger.
- Itemized materials-required list per job + a warehouse-role receiving log, with computed readiness (received ≥ required per line, not a manually-picked status)
- Route assignment + stage sequence generation from `pmes_route_mappings`
- Stage-by-stage tracking with delay flag/reason
- Component generation with **real, correct Code128-ready barcode IDs**
  (verified format: `JOB-AREA-COMPONENT-PART-SEQ/TOTAL`)
- Scan-station barcode lookup + stage completion logging
- Mismatch/no-match scan logging (fixed a real bug here — see below)
- Packing list + tally card generation
- RTMS handoff (status flip + timestamp; Production doesn't own the transfer transaction,
  per Section 8's explicit boundary)
- Excess material recording + manual withdrawal
- Industrial Engineering module: machine roster with images, real time-study logging with
  automatic outlier detection (not a single typed number), standard time formula, line
  efficiency/balance delay, Yamazumi task breakdown, OEE production-run tracking, and takt
  time/bottleneck/workstation load tools — all formula-verified against hand calculation

**Deliberately stubbed / manual for tonight (see MODCRAFT_BRIDGE_NOTES.md):**
- ModCraft quotation linkage — `quotation_serial` is a free-text field, not a live lookup
- Cutting list ingestion — component generation is a manual form, not reading
  `drawing_analyses`
- Cabinet Vision import — selectable as a `cutting_list_source` value to record intent, but
  no actual file import exists
- Odoo sync for excess materials — `odoo_sync_status` column exists, always `not_synced`

**Not addressed at all (carried over from PRODUCTION_CONTEXT.md Section 11, still open):**
- Operator/user identity model (all "operator" fields are free text — no auth, no roles)
- Machine/floor queuing when both machines of a type are busy
- Barcode label size / printer hardware
- Excess-material withdrawal *matching* (v1 lets a human eyeball-pick a job to withdraw
  into — no dimension/material auto-match)
- Camera-based barcode scanning (scan screen takes typed/pasted input — works fine with a
  handheld scanner in keyboard-wedge mode, but there's no `getUserMedia`/camera decode)

## One bug found and fixed during tonight's build

`pmes_component_stage_events.component_id` was originally `NOT NULL`, but the mismatch-scan
code path (barcode doesn't match any component) has no component to attach to by
definition. The insert was silently failing inside an empty catch block. Fixed by making
the column nullable — mismatch events now actually get recorded, which matters for the
Section 11 "barcode mis-scan/no-match handling" open item: you can't analyze mis-scan
patterns from a log that was never being written.

## Suggested first Claude Code session

1. Read `MODCRAFT_BRIDGE_NOTES.md` in full.
2. Start with bridge step 1 (inspect `drawing_analyses.raw_file_path` for a real job) —
   it's pure investigation and determines how much of steps 3–5 is straightforward vs. hard.
3. Only after that, decide whether to tackle the bridge or the "not addressed at all" list
   first — they're independent, so either order works.
