-- PMES per-user access + "View as" (2026-10-30)
-- 1. pmes_users.access (jsonb): per-user overrides, edited in Command Center → PMES → Users.
--      { "tabs": [..] | absent, "more": [..] | absent, "home": "..." | absent,
--        "actions": { "<action>": true|false, ... } }
--    Absent = the role's default. An action set to false blocks it; true allows it (only for
--    actions marked grantable — approvals with two-person rules can only be blocked).
-- 2. View as: a PMES admin's GET requests carrying header x-pmes-view-as: <email> are answered
--    as that user (role, rank, QA level, stations, My work, flows). Only GET (PostgREST runs it
--    read-only), so nothing can be changed while previewing; writes always use the real account.

alter table public.pmes_users add column if not exists access jsonb not null default '{}'::jsonb;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'pmes_users_access_object') then
    alter table public.pmes_users add constraint pmes_users_access_object check (jsonb_typeof(access) = 'object');
  end if;
end $$;

-- ── Who is asking ────────────────────────────────────────────────────────────
create or replace function public.pmes_viewing_as()
returns text language plpgsql stable security definer set search_path to 'public' as $$
declare real_e text := public.app_current_email(); m text; h jsonb; t text;
begin
  begin
    m := current_setting('request.method', true);
    h := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then return null; end;
  t := lower(btrim(coalesce(h->>'x-pmes-view-as', '')));
  if t = '' or t = real_e or coalesce(m, '') not in ('GET', 'HEAD') then return null; end if;
  if not exists (select 1 from public.pmes_users where email = real_e and active and role = 'admin') then return null; end if;
  if not exists (select 1 from public.pmes_users where email = t) then return null; end if;
  return t;
end $$;

create or replace function public.pmes_viewer_email()
returns text language sql stable security definer set search_path to 'public' as $$
  select coalesce(public.pmes_viewing_as(), public.app_current_email()) $$;

-- The identity helpers now answer for the viewer (= the real user unless an admin is previewing).
create or replace function public.pmes_role()
returns text language sql stable security definer set search_path to 'public' as $$
  select role from public.pmes_users where email = public.pmes_viewer_email() and active limit 1 $$;

create or replace function public.pmes_rank()
returns integer language sql stable security definer set search_path to 'public' as $$
  select coalesce((select case role when 'admin' then 40 when 'manager' then 30 when 'supervisor' then 20
    when 'production_engineer' then 18 when 'shift_head' then 15 when 'operator' then 10 when 'staff' then 5 when 'materials' then 5
    when 'qa' then 1 when 'qa_supervisor' then 1 when 'qa_manager' then 1 end
    from public.pmes_users where email = public.pmes_viewer_email() and active limit 1),0) $$;

create or replace function public.pmes_qa_level()
returns integer language sql stable security definer set search_path to 'public' as $$
  select coalesce((select case role when 'admin' then 9 when 'qa_manager' then 3 when 'qa_supervisor' then 2 when 'qa' then 1 end
    from public.pmes_users where email = public.pmes_viewer_email() and active limit 1),0) $$;

create or replace function public.pmes_acting_for()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object('email',d.from_email,'name',u.name,'until',d.ends_at,'id',d.id)
  from public.pmes_delegations d join public.pmes_users u on u.email=d.from_email
  where d.to_email=public.pmes_viewer_email() and d.revoked_at is null and now() >= d.starts_at and now() < d.ends_at
    and u.active and u.role in ('manager','admin')
  order by d.ends_at desc limit 1 $$;

-- (pmes_stations is replaced in the DO block below so its exact body is kept.)
create or replace function public.pmes_approver_caps()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object('plant_head', coalesce((select is_plant_head from public.adm_user_caps where lower(btrim(email)) = public.pmes_viewer_email()), false),
                            'md', coalesce((select is_md_approver from public.adm_user_caps where lower(btrim(email)) = public.pmes_viewer_email()), false)) $$;

-- While previewing, test jobs follow the previewed user's rank, not the admin's other app tiers.
create or replace function public.app_sees_test()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select case when public.pmes_viewing_as() is not null then coalesce(public.pmes_rank(),0) >= 40
    else coalesce(public.app_is_admin_tier(),false)
      or coalesce(public.ks_is_admin_tier(),false)
      or coalesce(public.pmes_rank(),0) >= 40 end $$;

-- ── Catalog and role defaults ─────────────────────────────────────────────────
create or replace function public.pmes_access_catalog()
returns jsonb language sql immutable as $$ select '{
 "tabs":[["mywork","My work"],["jobs","Jobs"],["scan","Scan"],["schedule","Schedule"],["more","More"]],
 "more":[["dashboard","Overview"],["materials","Materials overview"],["intake","New Job"],["excess","Excess material"],["ie","Industrial Engineering"],["settings","Setup"]],
 "actions":[
  {"key":"receive_materials","label":"Confirm materials received","step":"1 Receiving","grant":true},
  {"key":"qa_inspect","label":"Inspect materials and boards","step":"2 QA inspection","grant":true},
  {"key":"jo_check","label":"Check the Job Order","step":"3 Review & plan","grant":true},
  {"key":"jo_approve","label":"Approve the Job Order","step":"3 Review & plan","grant":false},
  {"key":"jo_return","label":"Return a Job Order","step":"3 Review & plan","grant":true},
  {"key":"schedule_plan","label":"Plan the schedule","step":"4 Production","grant":true},
  {"key":"schedule_approve","label":"Approve the schedule","step":"4 Production","grant":false},
  {"key":"handout_pjo","label":"Hand out process JOs","step":"4 Production","grant":true},
  {"key":"mark_pieces","label":"Mark pieces done (Scan / Pieces)","step":"4 Production","grant":true},
  {"key":"encode_paper","label":"Encode returned process JO sheets","step":"4 Production","grant":true},
  {"key":"reject_verify","label":"Decide on rejected pieces","step":"4 Production","grant":true},
  {"key":"handoff","label":"Final check and hand-off to Hatid","step":"5 QA & release","grant":true}
 ]}'::jsonb $$;

create or replace function public.pmes_role_defaults(p_role text)
returns jsonb language plpgsql immutable as $$
declare r int := case p_role when 'admin' then 40 when 'manager' then 30 when 'supervisor' then 20
    when 'production_engineer' then 18 when 'shift_head' then 15 when 'operator' then 10 when 'staff' then 5 when 'materials' then 5
    when 'qa' then 1 when 'qa_supervisor' then 1 when 'qa_manager' then 1 else 0 end;
  q int := case p_role when 'admin' then 9 when 'qa_manager' then 3 when 'qa_supervisor' then 2 when 'qa' then 1 else 0 end;
  tabs jsonb; more jsonb := '[]'::jsonb; home text;
begin
  tabs := case p_role
    when 'operator' then '["scan","mywork"]'
    when 'materials' then '["mywork","jobs","more"]'
    when 'staff' then '["mywork","jobs","more"]'
    when 'shift_head' then '["mywork","jobs","schedule","more"]'
    when 'production_engineer' then '["mywork","jobs","schedule","more"]'
    when 'supervisor' then '["mywork","jobs","scan","schedule","more"]'
    when 'qa' then '["mywork","jobs","scan","more"]'
    when 'qa_supervisor' then '["mywork","jobs","scan","more"]'
    when 'qa_manager' then '["mywork","jobs","scan","more"]'
    else '["mywork","jobs","scan","schedule","more"]' end::jsonb;
  if r >= 20 or q >= 2 then more := more || '"dashboard"'; end if;
  if p_role <> 'operator' then more := more || '"materials"'; end if;
  if r >= 20 then more := more || '["intake","excess"]'::jsonb; end if;
  if r >= 30 then more := more || '["ie","settings"]'::jsonb; end if;
  home := case when p_role = 'operator' then 'scan' when p_role in ('shift_head','production_engineer') then 'schedule' else 'mywork' end;
  return jsonb_build_object('tabs', tabs, 'more', more, 'home', home, 'actions', jsonb_build_object(
    'receive_materials', p_role = 'materials' or r >= 20,
    'qa_inspect', q >= 1,
    'jo_check', p_role in ('staff','supervisor','manager','admin'),
    'jo_approve', r >= 20,
    'jo_return', r >= 20,
    'schedule_plan', r >= 18,
    'schedule_approve', r >= 20,
    'handout_pjo', r >= 20,
    'mark_pieces', r >= 10,
    'encode_paper', p_role = 'staff' or r >= 20,
    'reject_verify', r >= 20,
    'handoff', q >= 1));
end $$;

-- What a user effectively gets: role defaults with their overrides applied.
create or replace function public.pmes_access_effective(p_role text, p_access jsonb)
returns jsonb language plpgsql immutable as $$
declare d jsonb := public.pmes_role_defaults(p_role); a jsonb := coalesce(p_access, '{}'::jsonb);
  acts jsonb := '{}'::jsonb; c jsonb; k text; o jsonb; tabs jsonb; home text;
begin
  for c in select x from jsonb_array_elements(public.pmes_access_catalog()->'actions') x loop
    k := c->>'key'; o := a->'actions'->k;
    acts := acts || jsonb_build_object(k, case
      when o is null or jsonb_typeof(o) <> 'boolean' then (d->'actions'->>k)::boolean
      when (c->>'grant')::boolean then (o)::text::boolean
      else (d->'actions'->>k)::boolean and (o)::text::boolean end);
  end loop;
  tabs := case when jsonb_typeof(a->'tabs') = 'array' then a->'tabs' else d->'tabs' end;
  home := coalesce(nullif(a->>'home',''), d->>'home');
  if not tabs ? home then home := coalesce(tabs->>0, 'mywork'); end if;
  return jsonb_build_object('tabs', tabs,
    'more', case when jsonb_typeof(a->'more') = 'array' then a->'more' else d->'more' end,
    'home', home, 'actions', acts,
    'custom', (a ?| array['tabs','more','home']) or coalesce(a->'actions','{}'::jsonb) <> '{}'::jsonb);
end $$;

-- The gate every action RPC uses. p_role_ok = what the role alone would allow.
create or replace function public.pmes_allow(p_action text, p_role_ok boolean)
returns boolean language plpgsql stable security definer set search_path to 'public' as $$
declare o jsonb; g boolean;
begin
  select access->'actions'->p_action into o from public.pmes_users where email = public.pmes_viewer_email() and active limit 1;
  select (x->>'grant')::boolean into g from jsonb_array_elements(public.pmes_access_catalog()->'actions') x where x->>'key' = p_action;
  if o is null or jsonb_typeof(o) <> 'boolean' then return coalesce(p_role_ok, false); end if;
  if coalesce(g, false) then return o::text::boolean; end if;
  return coalesce(p_role_ok, false) and o::text::boolean;
end $$;

-- ── pmes_me: + access (effective) and viewing_as ─────────────────────────────
create or replace function public.pmes_me()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object('email', u.email, 'name', u.name, 'role', u.role, 'stations', u.stations, 'company', u.company,
    'acting_for', public.pmes_acting_for(), 'role_info', public.pmes_role_info(u.role),
    'access', public.pmes_access_effective(u.role, u.access),
    'viewing_as', case when public.pmes_viewing_as() is not null then
      (select jsonb_build_object('real_email', r.email, 'real_name', r.name) from public.pmes_users r where r.email = public.app_current_email()) end)
  from public.pmes_users u where u.email = public.pmes_viewer_email() and u.active limit 1 $$;

-- Users an admin may preview (active ones). Admin only.
create or replace function public.pmes_view_as_list()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not exists (select 1 from public.pmes_users where email = public.app_current_email() and active and role = 'admin') then
    raise exception 'Only a PMES admin may view PMES as another user.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('email', email, 'name', name, 'role', role, 'company', company,
      'custom', (public.pmes_access_effective(role, access)->>'custom')::boolean) order by name)
    from public.pmes_users where active and email <> public.app_current_email()), '[]'::jsonb);
end $$;

-- Record that a preview started (audit, in the same log as user changes).
create or replace function public.pmes_view_as_log(p_email text)
returns void language plpgsql volatile security definer set search_path to 'public' as $$
declare me text := public.app_current_email(); t text := lower(btrim(coalesce(p_email,'')));
begin
  if not exists (select 1 from public.pmes_users where email = me and active and role = 'admin') then
    raise exception 'Only a PMES admin may view PMES as another user.'; end if;
  if not exists (select 1 from public.pmes_users where email = t) then raise exception 'No PMES user %.', t; end if;
  insert into public.user_access_log(app, email, action, before, after, changed_by)
  values ('PMES', t, 'view_as', null, jsonb_build_object('viewed_by', me), me);
end $$;

grant execute on function public.pmes_viewing_as(), public.pmes_viewer_email(), public.pmes_access_catalog(),
  public.pmes_role_defaults(text), public.pmes_access_effective(text, jsonb), public.pmes_allow(text, boolean),
  public.pmes_view_as_list(), public.pmes_view_as_log(text) to authenticated;

-- ── Wire the action switches into the action RPCs (exact-text edits, asserted) ─
do $$
declare
  edits text[][] := array[
    ['pmes_stations', 'public.app_current_email()', 'public.pmes_viewer_email()'],
    ['pmes_jo_check', $a$if coalesce(public.pmes_role(),'') not in ('staff','supervisor','manager','admin') then$a$,
                      $a$if not public.pmes_allow('jo_check', coalesce(public.pmes_role(),'') in ('staff','supervisor','manager','admin')) then$a$],
    ['pmes_jo_approve', 'if rk < 20 and not can_mgr then', $a$if not public.pmes_allow('jo_approve', rk >= 20 or can_mgr) then$a$],
    ['pmes_jo_return', 'if public.pmes_rank() < 20 then raise exception', $a$if not public.pmes_allow('jo_return', public.pmes_rank() >= 20) then raise exception$a$],
    ['pmes_component_mark', $a$if rk < 10 and not (p_via = 'paper' and coalesce(public.pmes_role(),'') = 'staff') then$a$,
                            $a$if not (case when p_via = 'paper' then public.pmes_allow('encode_paper', coalesce(public.pmes_role(),'') = 'staff' or rk >= 20) else public.pmes_allow('mark_pieces', rk >= 10) end) then$a$],
    ['pmes_component_mark_paper', $a$if not (coalesce(public.pmes_role(),'') = 'staff' or public.pmes_rank() >= 20) then$a$,
                                  $a$if not public.pmes_allow('encode_paper', coalesce(public.pmes_role(),'') = 'staff' or public.pmes_rank() >= 20) then$a$],
    ['pmes_reject_verify', 'if public.pmes_rank() < 20 then raise exception', $a$if not public.pmes_allow('reject_verify', public.pmes_rank() >= 20) then raise exception$a$],
    ['pmes_mr_receive', $a$if not (coalesce(public.pmes_role(),'') = 'materials' or public.pmes_rank() >= 20) then$a$,
                        $a$if not public.pmes_allow('receive_materials', coalesce(public.pmes_role(),'') = 'materials' or public.pmes_rank() >= 20) then$a$],
    ['pmes_client_mat_receive', $a$if not (coalesce(public.pmes_role(),'') = 'materials' or public.pmes_rank() >= 20) then$a$,
                                $a$if not public.pmes_allow('receive_materials', coalesce(public.pmes_role(),'') = 'materials' or public.pmes_rank() >= 20) then$a$],
    ['pmes_qa_inspect', 'if public.pmes_qa_level() < 1 then raise exception', $a$if not public.pmes_allow('qa_inspect', public.pmes_qa_level() >= 1) then raise exception$a$],
    ['pmes_board_save', 'if public.pmes_qa_level() < 1 then', $a$if not public.pmes_allow('qa_inspect', public.pmes_qa_level() >= 1) then$a$],
    ['pmes_schedule_save', 'if public.pmes_rank() < 18 then', $a$if not public.pmes_allow('schedule_plan', public.pmes_rank() >= 18) then$a$],
    ['pmes_schedule_approve', 'if rk < 20 then raise exception', $a$if not public.pmes_allow('schedule_approve', rk >= 20) then raise exception$a$],
    ['pmes_pjo_handout', 'if public.pmes_rank() < 20 then raise exception', $a$if not public.pmes_allow('handout_pjo', public.pmes_rank() >= 20) then raise exception$a$],
    ['pmes_job_handoff', 'if public.pmes_qa_level() < 1 then raise exception', $a$if not public.pmes_allow('handoff', public.pmes_qa_level() >= 1) then raise exception$a$]
  ];
  i int; fn regprocedure; def text; n int;
begin
  for i in 1 .. array_length(edits, 1) loop
    select p.oid::regprocedure into fn from pg_proc p join pg_namespace s on s.oid = p.pronamespace
      where s.nspname = 'public' and p.proname = edits[i][1];
    def := pg_get_functiondef(fn);
    n := (length(def) - length(replace(def, edits[i][2], ''))) / length(edits[i][2]);
    if n <> 1 then raise exception '%: expected the check text once, found % times', edits[i][1], n; end if;
    execute replace(def, edits[i][2], edits[i][3]);
  end loop;
end $$;

-- My work: leave out items whose action this user is blocked from.
do $$
declare fn regprocedure := 'public.pmes_my_work(text)'::regprocedure; def text; old text; new text;
begin
  def := pg_get_functiondef(fn);
  old := 'if why is not null then acts := acts || (s || jsonb_build_object(''why'', why)); end if;';
  new := 'if why is not null and rl <> ''admin'' and not public.pmes_allow(case
        when k = ''receive'' then ''receive_materials'' when k = ''qa_in'' then ''qa_inspect'' when k = ''release'' then ''handoff''
        when why like ''Check the Job Order%'' or why = ''Resolve the material concern'' then ''jo_check''
        when why like ''Approve the Job Order%'' or why like ''Second approval%'' then ''jo_approve''
        when why = ''Decide on rejected pieces'' then ''reject_verify''
        when why = ''Plan the schedule'' then ''schedule_plan''
        when why like ''Approve the schedule%'' then ''schedule_approve''
        when why like ''Hand out%'' then ''handout_pjo''
        when why like ''Encode%'' then ''encode_paper''
        when why like ''Mark pieces%'' then ''mark_pieces'' else ''-'' end, true) then why := null; end if;
      ' || old;
  if position(old in def) = 0 then raise exception 'pmes_my_work: anchor not found'; end if;
  execute replace(def, old, new);
end $$;
