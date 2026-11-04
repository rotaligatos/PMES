-- PMES access: add-only, per stage, Receiving/QA separation, My work follows grants
-- Rommel 2026-11-04:
--   1. A person's access only ADDS to their role; it never removes. (To give less, change the role.)
--   2. Piece marking given to someone whose role can't mark is limited to the stages set for them.
--   3. A grant never lets one person both receive and QA-inspect materials.
--   4. My work shows what a person was given, not only what their role does.

-- 1 + 3. Effective access = role defaults OR person grants (grantable actions only).
create or replace function public.pmes_access_effective(p_role text, p_access jsonb)
 returns jsonb
 language plpgsql
 immutable
as $function$
declare d jsonb := public.pmes_role_defaults(p_role); a jsonb := coalesce(p_access, '{}'::jsonb);
  acts jsonb := '{}'::jsonb; c jsonb; k text; o jsonb; dv boolean; tabs jsonb; more jsonb; home text;
begin
  for c in select x from jsonb_array_elements(public.pmes_access_catalog()->'actions') x loop
    k := c->>'key'; o := a->'actions'->k; dv := coalesce((d->'actions'->>k)::boolean, false);
    acts := acts || jsonb_build_object(k, dv or (coalesce((c->>'grant')::boolean, false)
      and o is not null and jsonb_typeof(o) = 'boolean' and o::text::boolean));
  end loop;
  -- Separation: whoever receives materials does not also pass them at QA (and the reverse).
  -- The role's own action wins; the granted one is dropped.
  if (acts->>'qa_inspect')::boolean and (acts->>'receive_materials')::boolean then
    if not coalesce((d->'actions'->>'qa_inspect')::boolean, false) then acts := acts || '{"qa_inspect": false}';
    elsif not coalesce((d->'actions'->>'receive_materials')::boolean, false) then acts := acts || '{"receive_materials": false}';
    end if;
  end if;
  -- Tabs and More: role's list plus anything added for the person.
  tabs := coalesce(d->'tabs', '[]'::jsonb);
  if jsonb_typeof(a->'tabs') = 'array' then
    tabs := tabs || coalesce((select jsonb_agg(x) from jsonb_array_elements(a->'tabs') x where not tabs @> jsonb_build_array(x)), '[]'::jsonb);
  end if;
  more := coalesce(d->'more', '[]'::jsonb);
  if jsonb_typeof(a->'more') = 'array' then
    more := more || coalesce((select jsonb_agg(x) from jsonb_array_elements(a->'more') x where not more @> jsonb_build_array(x)), '[]'::jsonb);
  end if;
  home := coalesce(nullif(a->>'home',''), d->>'home');
  if not tabs ? home then home := coalesce(d->>'home', tabs->>0, 'mywork'); end if;
  if not tabs ? home then home := coalesce(tabs->>0, 'mywork'); end if;
  return jsonb_build_object('tabs', tabs, 'more', more, 'home', home, 'actions', acts,
    'custom', (a ?| array['tabs','more','home']) or coalesce(a->'actions','{}'::jsonb) <> '{}'::jsonb);
end $function$;

-- 1 + 3. The check every action uses: the role's rule, or a person grant (after the separation rule).
create or replace function public.pmes_allow(p_action text, p_role_ok boolean)
 returns boolean
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare u record;
begin
  if coalesce(p_role_ok, false) then return true; end if;
  select role, access into u from public.pmes_users where email = public.pmes_viewer_email() and active limit 1;
  if not found then return false; end if;
  return coalesce((public.pmes_access_effective(u.role, u.access)->'actions'->>p_action)::boolean, false);
end $function$;

-- 2. Piece marking given by grant needs stages. (Only the stage check is new; the rest is unchanged.)
create or replace function public.pmes_component_mark(p_components uuid[], p_stage text, p_done boolean, p_note text default null::text, p_via text default 'manual'::text, p_operators text[] default null::text[])
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare me text := public.app_current_email(); nm text; rk int := public.pmes_rank(); stns text[] := public.pmes_stations();
        c public.pmes_components%rowtype; v_job uuid; marked int := 0; skipped jsonb := '[]'::jsonb; ex public.pmes_component_done%rowtype;
        rt text[]; nxt text; cid uuid; ndone int; st uuid; planned int; dn int; ops text[]; who text;
begin
  if not (case when p_via = 'paper' then public.pmes_allow('encode_paper', coalesce(public.pmes_role(),'') = 'staff' or rk >= 20) else public.pmes_allow('mark_pieces', rk >= 10) end) then raise exception 'Only operators, supervisors and above may mark pieces done.'; end if;
  if p_stage is null or btrim(p_stage) = '' then raise exception 'Say which process.'; end if;
  -- Rommel 2026-11-04: someone whose role can't mark pieces (e.g. Receiving) may mark only at the stages set for them.
  if p_via <> 'paper' and rk < 10 and coalesce(array_length(stns,1),0) = 0 then
    raise exception 'You were given piece marking without stages. Ask the admin to set your stages (Command Center → PMES → Users).'; end if;
  if rk < 20 and coalesce(array_length(stns,1),0) > 0 and not (p_stage = any(stns)) then
    raise exception 'You may only mark pieces at your own stations (%).', array_to_string(stns, ', '); end if;
  if not p_done and coalesce(btrim(p_note),'') = '' then raise exception 'Say why the piece is not done after all.'; end if;
  select name into nm from public.pmes_users where email = me;
  ops := array(select btrim(x) from unnest(coalesce(p_operators,'{}')) x where btrim(x) <> '');
  foreach cid in array coalesce(p_components,'{}') loop
    select * into c from public.pmes_components where id = cid for update;
    if not found then raise exception 'A piece was not found.'; end if;
    if v_job is null then v_job := c.job_id;
      if not public.pmes_jo_is_approved(v_job) then raise exception 'This Job Order has not been approved for the line yet.'; end if;
      -- No operator given: the people the process JO for this process was handed out to.
      if coalesce(array_length(ops,1),0) = 0 then
        select coalesce(pj.operators,'{}') into ops from public.pmes_process_jos pj where pj.job_id = v_job and pj.stage_code = p_stage
          order by pj.handed_out_at desc nulls last limit 1;
        ops := coalesce(ops,'{}');
      end if;
      who := coalesce(nullif(array_to_string(ops, ', '),''), nm, me);
    elsif v_job <> c.job_id then raise exception 'All pieces must belong to one job.'; end if;
    if c.status = 'scrapped' then skipped := skipped || jsonb_build_object('id',c.id,'why','scrapped'); continue; end if;
    if p_done and c.hold = 'reject_pending' then skipped := skipped || jsonb_build_object('id',c.id,'why','rejected — waiting for the supervisor'); continue; end if;
    rt := case when c.route is not null and array_length(c.route,1) > 0 then c.route else null end;
    if rt is null then select r.stage_sequence into rt from public.pmes_production_jobs j left join public.pmes_route_mappings r on r.code=j.route_code where j.id=c.job_id; end if;
    if rt is not null and not (p_stage = any(rt)) then skipped := skipped || jsonb_build_object('id',c.id,'why','not on its route'); continue; end if;
    select * into ex from public.pmes_component_done where component_id = c.id and stage_code = p_stage;
    if p_done then
      if found then skipped := skipped || jsonb_build_object('id',c.id,'why','already done'); continue; end if;
      insert into public.pmes_component_done(component_id,job_id,stage_code,done_by,done_by_name,via,note,operators)
        values (c.id,c.job_id,p_stage,me,nm,case when p_via='scan' then 'scan' else 'manual' end,nullif(btrim(p_note),''),nullif(ops,'{}'));
      insert into public.pmes_component_stage_events(component_id,stage_code,event_type,operator,scanned_value) values (c.id,p_stage,'done',who,nullif(btrim(p_note),''));
    else
      if not found then skipped := skipped || jsonb_build_object('id',c.id,'why','not marked done'); continue; end if;
      if not (rk >= 20 or ex.done_by = me) then raise exception 'Only the person who marked it, or a supervisor, may undo it.'; end if;
      delete from public.pmes_component_done where component_id = c.id and stage_code = p_stage;
      insert into public.pmes_component_stage_events(component_id,stage_code,event_type,operator,scanned_value) values (c.id,p_stage,'undone',coalesce(nm,me),btrim(p_note));
    end if;
    select count(*) into ndone from public.pmes_component_done where component_id = c.id;
    nxt := null;
    if rt is not null then
      select x into nxt from unnest(rt) with ordinality u(x,o) where not exists (select 1 from public.pmes_component_done d where d.component_id=c.id and d.stage_code=u.x) order by o limit 1;
    end if;
    update public.pmes_components set status = case when rt is not null and nxt is null then 'complete' when ndone > 0 then 'in_process' else 'pending' end,
      current_stage_code = case when rt is not null and nxt is null then null else nxt end where id = c.id;
    marked := marked + 1;
  end loop;
  if v_job is null then raise exception 'No pieces given.'; end if;
  select id into st from public.pmes_job_stages where job_id = v_job and stage_code = p_stage limit 1;
  if st is not null then perform public.pmes_stage_sync(st); end if;
  planned := public.pmes_stage_planned(v_job, p_stage);
  select count(*) into dn from public.pmes_component_done where job_id = v_job and stage_code = p_stage;
  return jsonb_build_object('marked',marked,'skipped',skipped,'done',dn,'planned',planned);
end $function$;

-- 4. My work: each line is the role's rule OR the person's grant (pmes_allow), so granted work shows up.
--    Granted piece marking shows only on jobs that have one of the person's stages.
create or replace function public.pmes_my_work(p_company text default null::text)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare rl text := coalesce(public.pmes_role(), ''); rk int := public.pmes_rank(); qa int := public.pmes_qa_level();
  stns text[] := public.pmes_stations();
  sees_test boolean := public.app_sees_test(); co text := nullif(btrim(coalesce(p_company,'')), '');
  can_recv boolean := public.pmes_allow('receive_materials', rl in ('materials','supervisor','manager'));
  can_qa boolean := public.pmes_allow('qa_inspect', qa >= 1);
  can_check boolean := public.pmes_allow('jo_check', rl = 'staff');
  can_reject boolean := public.pmes_allow('reject_verify', rl in ('supervisor','manager'));
  can_plan boolean := public.pmes_allow('schedule_plan', rl = 'production_engineer');
  can_hand boolean := public.pmes_allow('handout_pjo', rl = 'shift_head');
  can_encode boolean := public.pmes_allow('encode_paper', rl = 'staff');
  can_mark boolean := public.pmes_allow('mark_pieces', rl = 'operator');
  can_off boolean := public.pmes_allow('handoff', qa >= 1);
  j record; f jsonb; s jsonb; acts jsonb; why text; out jsonb := '[]'::jsonb; st text; tm text; k text;
begin
  if rk <= 0 then raise exception 'Not a Production user.'; end if;
  for j in
    select * from public.pmes_production_jobs
     where status <> 'handed_off'
       and (co is null or destination_company = co)
       and (sees_test or not public.pmes_job_is_test(id))
     order by created_at
  loop
    f := public.pmes_job_flow(j.id);
    acts := '[]'::jsonb;
    for s in select x from jsonb_array_elements(f->'steps') x loop
      k := s->>'key'; st := s->>'state'; tm := s->>'team'; why := null;
      if st in ('done','na') then continue; end if;
      if rl = 'admin' then
        why := 'Admin';
      elsif k = 'receive' and can_recv then
        why := 'Receive the materials';
      elsif k = 'qa_in' and can_qa and st <> 'wait' then
        why := 'Inspect materials and boards';
      elsif k = 'review' and can_check and (j.jo_review_status in ('received','returned') or st = 'block') then
        why := case when st = 'block' then 'Resolve the material concern' else 'Check the Job Order and plan the cut' end;
      elsif k = 'review' and rl in ('supervisor','manager') and j.jo_review_status = 'checked' then
        why := 'Approve the Job Order';
      elsif k = 'review' and rl = 'manager' and j.jo_review_status = 'supervisor_ok' then
        why := 'Second approval (materials incomplete)';
      elsif k = 'production' and st = 'block' and tm like 'Supervisor%' and can_reject then
        why := 'Decide on rejected pieces';
      elsif k = 'production' and st = 'now' and can_plan and coalesce(j.schedule_status,'none') in ('none','draft') then
        why := 'Plan the schedule';
      elsif k = 'production' and st = 'now' and rl = 'supervisor' and j.schedule_status = 'draft' then
        why := 'Approve the schedule';
      elsif k = 'production' and st = 'now' and rl = 'manager' and j.schedule_status = 'supervisor_ok' then
        why := 'Approve the schedule (manager)';
      elsif k = 'production' and st = 'now' and can_hand then
        why := 'Hand out process JOs and run the floor';
      elsif k = 'production' and st = 'now' and can_encode then
        why := 'Encode returned process JO sheets';
      elsif k = 'production' and st = 'now' and can_mark
        and (rk >= 10 or exists (select 1 from public.pmes_job_stages js where js.job_id = j.id and js.stage_code = any(stns))) then
        why := case when rk >= 10 or coalesce(array_length(stns,1),0) = 0 then 'Mark pieces done at your process'
          else 'Mark pieces done — ' || array_to_string(stns, ', ') end;
      elsif k = 'release' and can_off and st = 'now' then
        why := 'Final check, packing list and hand-off';
      end if;
      if why is not null then acts := acts || (s || jsonb_build_object('why', why)); end if;
    end loop;
    if jsonb_array_length(acts) > 0 then
      out := out || jsonb_build_object('job_id', j.id, 'job_code', j.job_code, 'destination', j.destination_company,
        'client', j.mother_jo->>'client', 'project', j.mother_jo->>'project', 'is_test', public.pmes_job_is_test(j.id),
        'status', f->'status', 'released', f->'released', 'steps', f->'steps', 'waiting_on', f->'waiting_on', 'mine', acts);
    end if;
  end loop;
  return out;
end $function$;
