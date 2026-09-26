// ModCraft PMES — connection config
// This app runs against the SAME Supabase project as ModCraft (nkpekroogqsmfilypowd),
// using the pmes_* table prefix to stay clearly scoped alongside ModCraft's own tables
// (quotations, board_layouts, drawing_analyses, etc).
//
// IMPORTANT — bridging note (see PRODUCTION_CONTEXT.md Section 11):
// This app is intentionally built to run STANDALONE tonight. It does NOT read live from
// ModCraft's quotations/board_layouts/drawing_analyses tables yet. The "New Job" intake
// screen captures a quotation_serial as a free-text reference field only — wiring that up
// to actually pull real service-spec / cutting-list data from ModCraft is the deferred
// bridging step. See MODCRAFT_BRIDGE_NOTES.md for exactly what that step will involve.

const PMES_CONFIG = {
  supabaseUrl: "https://nkpekroogqsmfilypowd.supabase.co",
  supabaseAnonKey: "sb_publishable_jpp6ZiFup3v0VVRJtjCOTQ_bF-SEpt4",
  tablePrefix: "pmes_",
};
