BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(117);

CREATE TEMP TABLE batch_5f_d3_expected_policies (
  table_name text NOT NULL,
  policy_name text PRIMARY KEY,
  command text NOT NULL,
  permission_key text NOT NULL,
  contract text NOT NULL
);

INSERT INTO batch_5f_d3_expected_policies VALUES
  ('clients','domain_clients_select','SELECT','clients.read','tenant'),
  ('clients','domain_clients_insert','INSERT','clients.write','creator'),
  ('clients','domain_clients_update','UPDATE','clients.write','tenant'),
  ('client_contacts','domain_client_contacts_select','SELECT','clients.read','tenant'),
  ('client_contacts','domain_client_contacts_insert','INSERT','clients.write','parent'),
  ('client_contacts','domain_client_contacts_update','UPDATE','clients.write','parent'),
  ('client_notes','domain_client_notes_select','SELECT','clients.read','tenant'),
  ('client_notes','domain_client_notes_insert','INSERT','clients.write','author'),
  ('client_notes','domain_client_notes_delete','DELETE','clients.write','own_author'),
  ('leads','domain_leads_select','SELECT','leads.read','tenant'),
  ('leads','domain_leads_insert','INSERT','leads.write','member_reference'),
  ('leads','domain_leads_update','UPDATE','leads.write','member_reference'),
  ('quotes','domain_quotes_select','SELECT','quotes.read','tenant'),
  ('quotes','domain_quotes_insert','INSERT','quotes.write','draft_creator'),
  ('quote_items','domain_quote_items_select','SELECT','quotes.read','tenant'),
  ('quote_items','domain_quote_items_insert','INSERT','quotes.write','draft_parent'),
  ('invoices','domain_invoices_select','SELECT','invoices.read','tenant'),
  ('invoices','domain_invoices_insert','INSERT','invoices.write','draft_creator'),
  ('invoice_items','domain_invoice_items_select','SELECT','invoices.read','tenant'),
  ('invoice_items','domain_invoice_items_insert','INSERT','invoices.write','draft_parent'),
  ('payments','domain_payments_select','SELECT','payments.read','tenant'),
  ('payments','domain_payments_insert','INSERT','payments.record','invoice_client'),
  ('projects','domain_projects_select','SELECT','projects.read','tenant'),
  ('projects','domain_projects_insert','INSERT','projects.write','project_fields'),
  ('projects','domain_projects_update','UPDATE','projects.write','project_fields'),
  ('project_milestones','domain_project_milestones_select','SELECT','projects.read','tenant'),
  ('project_milestones','domain_project_milestones_insert','INSERT','projects.write','parent'),
  ('project_milestones','domain_project_milestones_update','UPDATE','projects.write','parent'),
  ('tasks','domain_tasks_select','SELECT','tasks.read','tenant'),
  ('tasks','domain_tasks_insert','INSERT','tasks.write','creator_member'),
  ('tasks','domain_tasks_update','UPDATE','tasks.write','member_reference'),
  ('task_comments','domain_task_comments_select','SELECT','tasks.read','tenant'),
  ('task_comments','domain_task_comments_insert','INSERT','tasks.write','author'),
  ('meetings','domain_meetings_select','SELECT','projects.read','tenant'),
  ('meetings','domain_meetings_insert','INSERT','projects.write','member_reference'),
  ('meetings','domain_meetings_update','UPDATE','projects.write','member_reference'),
  ('documents','domain_documents_select','SELECT','documents.read','tenant'),
  ('documents','domain_documents_insert','INSERT','documents.write','uploader'),
  ('documents','domain_documents_update','UPDATE','documents.write','tenant'),
  ('tickets','domain_tickets_select','SELECT','tickets.read','tenant'),
  ('tickets','domain_tickets_insert','INSERT','tickets.write','creator_member'),
  ('tickets','domain_tickets_update','UPDATE','tickets.write','member_reference'),
  ('ticket_messages','domain_ticket_messages_select','SELECT','tickets.read','tenant'),
  ('ticket_messages','domain_ticket_messages_insert','INSERT','tickets.write','author'),
  ('activities','domain_activities_select','SELECT','activities.read','tenant'),
  ('notifications','domain_notifications_select','SELECT','','recipient_membership'),
  ('notifications','domain_notifications_update','UPDATE','','recipient_membership_read_only'),
  ('channels','domain_channels_select','SELECT','collaboration.read','tenant'),
  ('channels','domain_channels_insert','INSERT','collaboration.manage','creator'),
  ('channels','domain_channels_update','UPDATE','collaboration.manage','tenant'),
  ('messages','domain_messages_select','SELECT','collaboration.read','tenant'),
  ('messages','domain_messages_insert','INSERT','collaboration.write','author_parent');

CREATE FUNCTION pg_temp.batch_5f_d3_set_actor(
  p_user_id uuid,
  p_session_id uuid,
  p_state text DEFAULT 'normal_v1'
)
RETURNS void LANGUAGE plpgsql AS $function$
BEGIN
  PERFORM pg_catalog.set_config('request.jwt.claim.sub',p_user_id::text,true);
  PERFORM pg_catalog.set_config('request.jwt.claims',
    pg_catalog.jsonb_build_object(
      'sub',p_user_id::text,'session_id',p_session_id::text,
      'role','authenticated','purplelok_session_state',p_state
    )::text,true);
END
$function$;

SELECT pg_catalog.set_config('batch_5f_d3.org_a',
  (SELECT id::text FROM public.organizations WHERE slug='purplelok'),true);
SELECT pg_catalog.set_config('batch_5f_d3.org_b',
  (SELECT id::text FROM public.organizations WHERE slug='purplelok-demo'),true);

-- ============ CATALOGUE ============

SELECT is((SELECT count(*)::integer FROM pg_catalog.pg_policies AS policy
  WHERE policy.schemaname='public' AND policy.tablename IN
    (SELECT DISTINCT table_name FROM pg_temp.batch_5f_d3_expected_policies)),52,
  'D3 installs exactly 52 domain policies');
SELECT set_eq(
  $$SELECT policyname FROM pg_catalog.pg_policies
    WHERE schemaname='public' AND tablename IN
      (SELECT DISTINCT table_name FROM pg_temp.batch_5f_d3_expected_policies)$$,
  $$SELECT policy_name FROM pg_temp.batch_5f_d3_expected_policies$$,
  'D3 policy names are the exact intended set');
SELECT is((SELECT count(*)::integer FROM pg_catalog.pg_policies
  WHERE policyname IN (SELECT policy_name FROM pg_temp.batch_5f_d3_expected_policies)
    AND permissive='PERMISSIVE' AND roles=ARRAY['authenticated']::name[]),52,
  'every D3 policy is permissive and authenticated-only');
SELECT is((SELECT count(*)::integer FROM pg_catalog.pg_policies AS policy
  WHERE policy.schemaname='public' AND policy.tablename IN
    (SELECT table_name FROM pg_temp.batch_5f_d3_expected_policies)
    AND policy.policyname=policy.tablename||'_'||pg_catalog.lower(policy.cmd)),0,
  'no legacy domain policy remains');
SELECT is((SELECT count(*)::integer FROM pg_catalog.pg_class AS relation
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid=relation.relnamespace
  WHERE namespace.nspname='public' AND relation.relname IN
    (SELECT DISTINCT table_name FROM pg_temp.batch_5f_d3_expected_policies)
    AND relation.relrowsecurity AND NOT relation.relforcerowsecurity),21,
  'all 21 domain tables retain enabled non-forced RLS');
SELECT is((SELECT count(*)::integer FROM information_schema.columns
  WHERE table_schema='public' AND column_name='organization_id'
    AND table_name IN (SELECT DISTINCT table_name FROM pg_temp.batch_5f_d3_expected_policies)
    AND data_type='uuid' AND is_nullable='YES' AND column_default IS NULL),21,
  'all 21 domain tenant columns retain the approved nullable uuid shape');
SELECT is((SELECT pg_catalog.md5(pg_catalog.string_agg(
  pg_catalog.format('%s|%s|%s|%s|%s',table_name,policy_name,command,permission_key,contract),
  E'\n' ORDER BY table_name,policy_name)) FROM pg_temp.batch_5f_d3_expected_policies),
  'ce50cde59a1bd0116a593f0db805e1d8','D3 semantic policy manifest hash is canonical');
SELECT is((SELECT count(*)::integer FROM pg_catalog.pg_policies
  WHERE tablename='activities' AND policyname LIKE 'domain_activities_%'),1,
  'activities exposes SELECT only');
SELECT is((SELECT count(*)::integer FROM pg_catalog.pg_policies
  WHERE tablename IN ('quotes','invoices') AND cmd='UPDATE'),0,
  'quote and invoice generic UPDATE policies are absent');
SELECT is((SELECT count(*)::integer FROM pg_catalog.pg_policies
  WHERE tablename='client_notes' AND cmd='DELETE'),1,
  'client notes has the sole intentional browser DELETE policy');
SELECT is((SELECT count(*)::integer FROM pg_catalog.pg_trigger AS trigger
  JOIN pg_catalog.pg_class AS relation ON relation.oid=trigger.tgrelid
  WHERE trigger.tgname='domain_'||relation.relname||'_protect_update'
    AND NOT trigger.tgisinternal AND trigger.tgenabled='O' AND trigger.tgtype=19
    AND trigger.tgfoid='private.purplelok_protect_domain_update()'::regprocedure),21,
  'all 21 update-protection triggers are enabled with exact bindings');
SELECT ok(pg_catalog.has_function_privilege('authenticated',
  'private.purplelok_can_reference_members(uuid,text,uuid[])','EXECUTE'),
  'authenticated may execute only the policy-facing member-reference predicate');
SELECT is((SELECT count(*)::integer FROM pg_catalog.pg_proc AS procedure
  WHERE procedure.oid='private.purplelok_can_reference_members(uuid,text,uuid[])'::regprocedure
    AND procedure.prosecdef AND procedure.provolatile='s'
    AND pg_catalog.pg_get_userbyid(procedure.proowner)='postgres'
    AND procedure.proconfig @> ARRAY['search_path=""','row_security=off']::text[]),1,
  'member-reference predicate is hardened postgres-owned SECURITY DEFINER STABLE');
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      coalesce(procedure.proacl,pg_catalog.acldefault('f',procedure.proowner))
    ) AS privilege
    WHERE procedure.oid='private.purplelok_can_reference_members(uuid,text,uuid[])'::regprocedure
      AND privilege.privilege_type='EXECUTE'
      AND privilege.grantee IN (0::oid,'anon'::regrole::oid,'service_role'::regrole::oid,
        'supabase_auth_admin'::regrole::oid)
  ),
  'member-reference predicate is unavailable outside authenticated and postgres');
SELECT ok(NOT pg_catalog.has_function_privilege('authenticated',
  'private.purplelok_protect_domain_update()','EXECUTE'),
  'authenticated cannot execute the update trigger function directly');
SELECT is((SELECT count(*)::integer FROM (
  SELECT policy.tablename,policy.cmd
  FROM pg_catalog.pg_policies AS policy
  WHERE policy.schemaname='public'
    AND policy.tablename IN (SELECT DISTINCT table_name FROM pg_temp.batch_5f_d3_expected_policies)
  GROUP BY policy.tablename,policy.cmd HAVING count(*) <> 1
) AS overlap),0,'every allowed table and command has exactly one policy without permissive overlap');
SELECT is((SELECT count(*)::integer FROM pg_catalog.pg_policies AS policy
  WHERE policy.schemaname='public'
    AND policy.tablename IN (SELECT DISTINCT table_name FROM pg_temp.batch_5f_d3_expected_policies)
    AND (policy.qual='true' OR policy.with_check='true')),0,
  'no D3 policy contains a bare true authorization expression');
SELECT is((SELECT count(*)::integer FROM pg_catalog.pg_policies AS policy
  WHERE policy.schemaname='public'
    AND policy.tablename IN (SELECT DISTINCT table_name FROM pg_temp.batch_5f_d3_expected_policies)
    AND 'anon'=ANY(policy.roles)),0,'no domain policy grants anon access');
SELECT is((SELECT count(*)::integer FROM pg_catalog.pg_roles
  WHERE rolname IN ('anon','authenticated') AND (rolsuper OR rolbypassrls)),0,
  'browser roles are neither superusers nor BYPASSRLS roles');
SELECT is((SELECT count(*)::integer FROM pg_catalog.pg_class AS relation
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid=relation.relnamespace
  WHERE namespace.nspname='public'
    AND relation.relname IN (SELECT DISTINCT table_name FROM pg_temp.batch_5f_d3_expected_policies)
    AND relation.relowner IN ('anon'::regrole::oid,'authenticated'::regrole::oid)),0,
  'no browser role owns a protected domain table');
SELECT is((SELECT count(*)::integer FROM pg_catalog.pg_class AS relation
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid=relation.relnamespace
  WHERE namespace.nspname='public'
    AND relation.relname IN (SELECT DISTINCT table_name FROM pg_temp.batch_5f_d3_expected_policies)
    AND pg_catalog.has_table_privilege('authenticated',relation.oid,'SELECT')
    AND pg_catalog.has_table_privilege('authenticated',relation.oid,'INSERT')
    AND pg_catalog.has_table_privilege('authenticated',relation.oid,'UPDATE')
    AND pg_catalog.has_table_privilege('authenticated',relation.oid,'DELETE')),21,
  'authenticated retains existing CRUD table privileges while RLS supplies authority');
SELECT is((SELECT count(*)::integer FROM information_schema.role_table_grants AS privilege
  WHERE privilege.grantee='authenticated' AND privilege.table_schema='public'
    AND privilege.table_name IN (
      SELECT DISTINCT table_name FROM pg_temp.batch_5f_d3_expected_policies)
    AND privilege.privilege_type IN (
      'SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')),147,
  'authenticated retains the exact seven standard Supabase table privileges on all 21 tables');
SELECT is((SELECT count(*)::integer
  FROM pg_catalog.pg_constraint AS constraint_definition
  JOIN pg_catalog.pg_class AS child ON child.oid=constraint_definition.conrelid
  JOIN pg_catalog.pg_namespace AS child_namespace ON child_namespace.oid=child.relnamespace
  JOIN pg_catalog.pg_class AS parent ON parent.oid=constraint_definition.confrelid
  JOIN pg_catalog.pg_namespace AS parent_namespace ON parent_namespace.oid=parent.relnamespace
  JOIN (VALUES
    ('client_contacts_client_organization_fkey','client_contacts','client_id','clients'),
    ('client_notes_client_organization_fkey','client_notes','client_id','clients'),
    ('quote_items_quote_organization_fkey','quote_items','quote_id','quotes'),
    ('invoice_items_invoice_organization_fkey','invoice_items','invoice_id','invoices'),
    ('project_milestones_project_organization_fkey','project_milestones','project_id','projects'),
    ('task_comments_task_organization_fkey','task_comments','task_id','tasks'),
    ('ticket_messages_ticket_organization_fkey','ticket_messages','ticket_id','tickets'),
    ('messages_channel_organization_fkey','messages','channel_id','channels')
  ) AS expected(constraint_name,child_table,parent_column,parent_table)
    ON expected.constraint_name=constraint_definition.conname
   AND expected.child_table=child.relname
   AND expected.parent_table=parent.relname
  WHERE child_namespace.nspname='public' AND parent_namespace.nspname='public'
    AND constraint_definition.contype='f' AND constraint_definition.convalidated
    AND (SELECT pg_catalog.array_agg(attribute.attname ORDER BY key_position.ordinality)
         FROM pg_catalog.unnest(constraint_definition.conkey) WITH ORDINALITY AS key_position(attnum,ordinality)
         JOIN pg_catalog.pg_attribute AS attribute
           ON attribute.attrelid=child.oid AND attribute.attnum=key_position.attnum)
        =ARRAY[expected.parent_column,'organization_id']::name[]
    AND (SELECT pg_catalog.array_agg(attribute.attname ORDER BY key_position.ordinality)
         FROM pg_catalog.unnest(constraint_definition.confkey) WITH ORDINALITY AS key_position(attnum,ordinality)
         JOIN pg_catalog.pg_attribute AS attribute
           ON attribute.attrelid=parent.oid AND attribute.attnum=key_position.attnum)
        =ARRAY['id','organization_id']::name[]),8,
  'all eight reviewed child relations have validated exact composite tenant foreign keys');
SELECT is((SELECT count(*)::integer FROM information_schema.columns
  WHERE table_schema='public'
    AND (table_name,column_name) IN (VALUES
      ('client_contacts','client_id'),('client_notes','client_id'),
      ('quote_items','quote_id'),('invoice_items','invoice_id'),
      ('project_milestones','project_id'),('task_comments','task_id'),
      ('ticket_messages','ticket_id'),('messages','channel_id'))
    AND is_nullable='NO'),8,
  'all eight reviewed child parent references are non-null and cannot bypass binding through NULL');

-- ============ DISPOSABLE ACTORS ============

INSERT INTO auth.users (id,email,raw_user_meta_data) VALUES
 ('00000000-0000-0000-0000-0000000d3301','d3-owner-a@example.test','{}'),
 ('00000000-0000-0000-0000-0000000d3302','d3-admin-a@example.test','{}'),
 ('00000000-0000-0000-0000-0000000d3303','d3-finance-a@example.test','{}'),
 ('00000000-0000-0000-0000-0000000d3304','d3-pm-a@example.test','{}'),
 ('00000000-0000-0000-0000-0000000d3305','d3-staff-a@example.test','{}'),
 ('00000000-0000-0000-0000-0000000d3306','d3-owner-b@example.test','{}'),
 ('00000000-0000-0000-0000-0000000d3307','d3-recovery@example.test','{}'),
 ('00000000-0000-0000-0000-0000000d3308','d3-gated@example.test','{}'),
 ('00000000-0000-0000-0000-0000000d3309','d3-inactive@example.test','{}'),
 ('00000000-0000-0000-0000-0000000d3310','d3-suspended@example.test','{}'),
 ('00000000-0000-0000-0000-0000000d3311','d3-client@example.test','{}'),
 ('00000000-0000-0000-0000-0000000d3312','d3-revoked@example.test','{}'),
 ('00000000-0000-0000-0000-0000000d3313','d3-no-membership@example.test','{}');

UPDATE public.profiles SET active=false WHERE id='00000000-0000-0000-0000-0000000d3309';

INSERT INTO auth.sessions (id,user_id) VALUES
 ('00000000-0000-0000-0000-0000000d3401','00000000-0000-0000-0000-0000000d3301'),
 ('00000000-0000-0000-0000-0000000d3402','00000000-0000-0000-0000-0000000d3302'),
 ('00000000-0000-0000-0000-0000000d3403','00000000-0000-0000-0000-0000000d3303'),
 ('00000000-0000-0000-0000-0000000d3404','00000000-0000-0000-0000-0000000d3304'),
 ('00000000-0000-0000-0000-0000000d3405','00000000-0000-0000-0000-0000000d3305'),
 ('00000000-0000-0000-0000-0000000d3406','00000000-0000-0000-0000-0000000d3306'),
 ('00000000-0000-0000-0000-0000000d3407','00000000-0000-0000-0000-0000000d3307'),
 ('00000000-0000-0000-0000-0000000d3408','00000000-0000-0000-0000-0000000d3308'),
 ('00000000-0000-0000-0000-0000000d3409','00000000-0000-0000-0000-0000000d3309'),
 ('00000000-0000-0000-0000-0000000d3410','00000000-0000-0000-0000-0000000d3310'),
 ('00000000-0000-0000-0000-0000000d3411','00000000-0000-0000-0000-0000000d3311'),
 ('00000000-0000-0000-0000-0000000d3412','00000000-0000-0000-0000-0000000d3312');

INSERT INTO public.organization_members (id,organization_id,user_id,status)
SELECT actor.membership_id, actor.organization_id, actor.user_id, actor.status
FROM (VALUES
 ('00000000-0000-0000-0000-0000000d3501'::uuid,current_setting('batch_5f_d3.org_a')::uuid,'00000000-0000-0000-0000-0000000d3301'::uuid,'active'),
 ('00000000-0000-0000-0000-0000000d3502',current_setting('batch_5f_d3.org_a')::uuid,'00000000-0000-0000-0000-0000000d3302','active'),
 ('00000000-0000-0000-0000-0000000d3503',current_setting('batch_5f_d3.org_a')::uuid,'00000000-0000-0000-0000-0000000d3303','active'),
 ('00000000-0000-0000-0000-0000000d3504',current_setting('batch_5f_d3.org_a')::uuid,'00000000-0000-0000-0000-0000000d3304','active'),
 ('00000000-0000-0000-0000-0000000d3505',current_setting('batch_5f_d3.org_a')::uuid,'00000000-0000-0000-0000-0000000d3305','active'),
 ('00000000-0000-0000-0000-0000000d3506',current_setting('batch_5f_d3.org_b')::uuid,'00000000-0000-0000-0000-0000000d3306','active'),
 ('00000000-0000-0000-0000-0000000d3507',current_setting('batch_5f_d3.org_a')::uuid,'00000000-0000-0000-0000-0000000d3307','active'),
 ('00000000-0000-0000-0000-0000000d3508',current_setting('batch_5f_d3.org_a')::uuid,'00000000-0000-0000-0000-0000000d3308','active'),
 ('00000000-0000-0000-0000-0000000d3509',current_setting('batch_5f_d3.org_a')::uuid,'00000000-0000-0000-0000-0000000d3309','active'),
 ('00000000-0000-0000-0000-0000000d3510',current_setting('batch_5f_d3.org_a')::uuid,'00000000-0000-0000-0000-0000000d3310','suspended'),
 ('00000000-0000-0000-0000-0000000d3511',current_setting('batch_5f_d3.org_a')::uuid,'00000000-0000-0000-0000-0000000d3311','active'),
 ('00000000-0000-0000-0000-0000000d3512',current_setting('batch_5f_d3.org_a')::uuid,'00000000-0000-0000-0000-0000000d3312','active')
) AS actor(membership_id,organization_id,user_id,status);

INSERT INTO public.organization_member_roles (organization_id,organization_member_id,organization_role_id)
SELECT membership.organization_id,membership.id,role.id
FROM public.organization_members AS membership
JOIN (VALUES
 ('00000000-0000-0000-0000-0000000d3501'::uuid,'owner'),
 ('00000000-0000-0000-0000-0000000d3502','admin'),
 ('00000000-0000-0000-0000-0000000d3503','finance'),
 ('00000000-0000-0000-0000-0000000d3504','project_manager'),
 ('00000000-0000-0000-0000-0000000d3505','staff'),
 ('00000000-0000-0000-0000-0000000d3506','owner'),
 ('00000000-0000-0000-0000-0000000d3507','owner'),
 ('00000000-0000-0000-0000-0000000d3508','owner'),
 ('00000000-0000-0000-0000-0000000d3509','owner'),
 ('00000000-0000-0000-0000-0000000d3510','owner'),
 ('00000000-0000-0000-0000-0000000d3512','owner')
) AS assignment(membership_id,role_key) ON assignment.membership_id=membership.id
JOIN public.organization_roles AS role ON role.organization_id=membership.organization_id
  AND role.key=assignment.role_key;

ALTER TABLE public.organization_member_roles DISABLE TRIGGER organization_member_roles_reject_client;
INSERT INTO public.organization_member_roles (organization_id,organization_member_id,organization_role_id)
SELECT membership.organization_id,membership.id,role.id
FROM public.organization_members AS membership
JOIN public.organization_roles AS role ON role.organization_id=membership.organization_id AND role.key='client'
WHERE membership.id='00000000-0000-0000-0000-0000000d3511';
ALTER TABLE public.organization_member_roles ENABLE TRIGGER organization_member_roles_reject_client;

INSERT INTO private.auth_session_gates (session_id,user_id,gate_type)
VALUES ('00000000-0000-0000-0000-0000000d3408','00000000-0000-0000-0000-0000000d3308','RECOVERY_PENDING');

INSERT INTO public.clients (id,organization_id,company_name,created_by) VALUES
 ('00000000-0000-0000-0000-0000000d3601',current_setting('batch_5f_d3.org_a')::uuid,'D3 Org A Client','00000000-0000-0000-0000-0000000d3301'),
 ('00000000-0000-0000-0000-0000000d3602',current_setting('batch_5f_d3.org_b')::uuid,'D3 Org B Client','00000000-0000-0000-0000-0000000d3306');
INSERT INTO public.quotes (id,organization_id,quote_number,client_id,title,status,created_by) VALUES
 ('00000000-0000-0000-0000-0000000d3611',current_setting('batch_5f_d3.org_a')::uuid,'D3-QUO-A','00000000-0000-0000-0000-0000000d3601','A quote','draft','00000000-0000-0000-0000-0000000d3301'),
 ('00000000-0000-0000-0000-0000000d3612',current_setting('batch_5f_d3.org_b')::uuid,'D3-QUO-B','00000000-0000-0000-0000-0000000d3602','B quote','draft','00000000-0000-0000-0000-0000000d3306');
INSERT INTO public.invoices (id,organization_id,invoice_number,client_id,title,status,created_by) VALUES
 ('00000000-0000-0000-0000-0000000d3621',current_setting('batch_5f_d3.org_a')::uuid,'D3-INV-A','00000000-0000-0000-0000-0000000d3601','A invoice','draft','00000000-0000-0000-0000-0000000d3301'),
 ('00000000-0000-0000-0000-0000000d3622',current_setting('batch_5f_d3.org_b')::uuid,'D3-INV-B','00000000-0000-0000-0000-0000000d3602','B invoice','draft','00000000-0000-0000-0000-0000000d3306');
INSERT INTO public.projects (id,organization_id,name,client_id,assigned_to,created_by) VALUES
 ('00000000-0000-0000-0000-0000000d3631',current_setting('batch_5f_d3.org_a')::uuid,'A project','00000000-0000-0000-0000-0000000d3601',ARRAY['00000000-0000-0000-0000-0000000d3301','00000000-0000-0000-0000-0000000d3302']::uuid[],'00000000-0000-0000-0000-0000000d3301'),
 ('00000000-0000-0000-0000-0000000d3632',current_setting('batch_5f_d3.org_b')::uuid,'B project','00000000-0000-0000-0000-0000000d3602',ARRAY['00000000-0000-0000-0000-0000000d3306']::uuid[],'00000000-0000-0000-0000-0000000d3306'),
 ('00000000-0000-0000-0000-0000000d3633',current_setting('batch_5f_d3.org_a')::uuid,'A null-assignee project','00000000-0000-0000-0000-0000000d3601',NULL,'00000000-0000-0000-0000-0000000d3301');
INSERT INTO public.tasks (id,organization_id,title,project_id,client_id,created_by) VALUES
 ('00000000-0000-0000-0000-0000000d3641',current_setting('batch_5f_d3.org_a')::uuid,'A task','00000000-0000-0000-0000-0000000d3631','00000000-0000-0000-0000-0000000d3601','00000000-0000-0000-0000-0000000d3301'),
 ('00000000-0000-0000-0000-0000000d3642',current_setting('batch_5f_d3.org_b')::uuid,'B task','00000000-0000-0000-0000-0000000d3632','00000000-0000-0000-0000-0000000d3602','00000000-0000-0000-0000-0000000d3306');
INSERT INTO public.tickets (id,organization_id,ticket_number,client_id,subject,created_by) VALUES
 ('00000000-0000-0000-0000-0000000d3651',current_setting('batch_5f_d3.org_a')::uuid,'D3-TKT-A','00000000-0000-0000-0000-0000000d3601','A ticket','00000000-0000-0000-0000-0000000d3301'),
 ('00000000-0000-0000-0000-0000000d3652',current_setting('batch_5f_d3.org_b')::uuid,'D3-TKT-B','00000000-0000-0000-0000-0000000d3602','B ticket','00000000-0000-0000-0000-0000000d3306');
INSERT INTO public.channels (id,organization_id,name,created_by) VALUES
 ('00000000-0000-0000-0000-0000000d3661',current_setting('batch_5f_d3.org_a')::uuid,'A channel','00000000-0000-0000-0000-0000000d3301'),
 ('00000000-0000-0000-0000-0000000d3662',current_setting('batch_5f_d3.org_b')::uuid,'B channel','00000000-0000-0000-0000-0000000d3306');
INSERT INTO public.activities (id,organization_id,user_id,type,description) VALUES
 ('00000000-0000-0000-0000-0000000d3671',current_setting('batch_5f_d3.org_a')::uuid,'00000000-0000-0000-0000-0000000d3301','d3','A activity');
INSERT INTO public.notifications (id,organization_id,user_id,title) VALUES
 ('00000000-0000-0000-0000-0000000d3681',current_setting('batch_5f_d3.org_a')::uuid,'00000000-0000-0000-0000-0000000d3301','Owner notice'),
 ('00000000-0000-0000-0000-0000000d3682',current_setting('batch_5f_d3.org_a')::uuid,'00000000-0000-0000-0000-0000000d3302','Admin notice'),
 ('00000000-0000-0000-0000-0000000d3685',current_setting('batch_5f_d3.org_b')::uuid,'00000000-0000-0000-0000-0000000d3306','Org B notice');
INSERT INTO public.client_notes (id,organization_id,client_id,author_id,body) VALUES
 ('00000000-0000-0000-0000-0000000d3683',current_setting('batch_5f_d3.org_b')::uuid,'00000000-0000-0000-0000-0000000d3602','00000000-0000-0000-0000-0000000d3306','Org B note'),
 ('00000000-0000-0000-0000-0000000d3684',current_setting('batch_5f_d3.org_a')::uuid,'00000000-0000-0000-0000-0000000d3601','00000000-0000-0000-0000-0000000d3303','Finance note');
INSERT INTO public.clients (id,organization_id,company_name,created_by)
VALUES ('00000000-0000-0000-0000-0000000d3695',NULL,'D3 NULL tenant fixture','00000000-0000-0000-0000-0000000d3301');

-- ============ SESSION AND TENANT DENIAL ============

SELECT pg_catalog.set_config('request.jwt.claims','{}',true);
SET LOCAL ROLE anon;
SELECT is((SELECT count(*)::integer FROM public.clients WHERE id='00000000-0000-0000-0000-0000000d3601'),0,'unauthenticated cannot read domain data');
RESET ROLE;

SELECT pg_temp.batch_5f_d3_set_actor('00000000-0000-0000-0000-0000000d3312','00000000-0000-0000-0000-0000000d3499');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::integer FROM public.clients),0,'stale session cannot read domain data');
RESET ROLE;
SELECT pg_temp.batch_5f_d3_set_actor('00000000-0000-0000-0000-0000000d3307','00000000-0000-0000-0000-0000000d3407','recovery_pending_v1');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::integer FROM public.clients),0,'recovery-pending session cannot read domain data');
RESET ROLE;
SELECT pg_temp.batch_5f_d3_set_actor('00000000-0000-0000-0000-0000000d3308','00000000-0000-0000-0000-0000000d3408');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::integer FROM public.clients),0,'normal claim plus recovery gate cannot read domain data');
RESET ROLE;
SELECT pg_temp.batch_5f_d3_set_actor('00000000-0000-0000-0000-0000000d3309','00000000-0000-0000-0000-0000000d3409');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::integer FROM public.clients),0,'inactive profile cannot read domain data');
RESET ROLE;
SELECT pg_temp.batch_5f_d3_set_actor('00000000-0000-0000-0000-0000000d3310','00000000-0000-0000-0000-0000000d3410');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::integer FROM public.clients),0,'suspended membership cannot read domain data');
RESET ROLE;

SELECT pg_temp.batch_5f_d3_set_actor('00000000-0000-0000-0000-0000000d3301','00000000-0000-0000-0000-0000000d3401');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::integer FROM public.clients WHERE id='00000000-0000-0000-0000-0000000d3601'),1,'Org A Owner reads Org A row');
SELECT is((SELECT count(*)::integer FROM public.clients WHERE id='00000000-0000-0000-0000-0000000d3602'),0,'Org A cannot SELECT Org B row');
UPDATE public.clients SET company_name='forged update' WHERE id='00000000-0000-0000-0000-0000000d3602';
RESET ROLE;
SELECT is((SELECT company_name FROM public.clients WHERE id='00000000-0000-0000-0000-0000000d3602'),'D3 Org B Client','Org A UPDATE cannot change Org B row');
SET LOCAL ROLE authenticated;
DELETE FROM public.client_notes WHERE id='00000000-0000-0000-0000-0000000d3683';
RESET ROLE;
SELECT is((SELECT count(*)::integer FROM public.client_notes WHERE id='00000000-0000-0000-0000-0000000d3683'),1,'Org A DELETE cannot affect Org B row');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$INSERT INTO public.clients (organization_id,company_name,created_by)
  VALUES (current_setting('batch_5f_d3.org_b')::uuid,'forged tenant','00000000-0000-0000-0000-0000000d3301')$$,
  '42501',NULL::text,'Org A cannot INSERT using Org B organization_id');
RESET ROLE;

-- ============ RBAC ============

SELECT pg_temp.batch_5f_d3_set_actor('00000000-0000-0000-0000-0000000d3303','00000000-0000-0000-0000-0000000d3403');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::integer FROM public.clients WHERE id='00000000-0000-0000-0000-0000000d3601'),1,'Finance retains intended clients.read');
SELECT throws_ok($$INSERT INTO public.clients (organization_id,company_name,created_by)
 VALUES (current_setting('batch_5f_d3.org_a')::uuid,'Finance forged client','00000000-0000-0000-0000-0000000d3303')$$,
 '42501',NULL::text,'Finance without clients.write cannot INSERT client');
UPDATE public.clients SET company_name='Finance forged update'
WHERE id='00000000-0000-0000-0000-0000000d3601';
SELECT is((SELECT company_name FROM public.clients WHERE id='00000000-0000-0000-0000-0000000d3601'),
  'D3 Org A Client','Finance without clients.write cannot UPDATE client');
DELETE FROM public.client_notes WHERE id='00000000-0000-0000-0000-0000000d3684';
SELECT is((SELECT count(*)::integer FROM public.client_notes WHERE id='00000000-0000-0000-0000-0000000d3684'),
  1,'Finance without clients.write cannot DELETE own note');
SELECT is((SELECT count(*)::integer FROM public.leads),0,'Finance without leads.read cannot SELECT leads');
RESET ROLE;

SELECT pg_temp.batch_5f_d3_set_actor('00000000-0000-0000-0000-0000000d3302','00000000-0000-0000-0000-0000000d3402');
SET LOCAL ROLE authenticated;
INSERT INTO public.clients (id,organization_id,company_name,created_by) VALUES
 ('00000000-0000-0000-0000-0000000d3691',current_setting('batch_5f_d3.org_a')::uuid,'Admin client','00000000-0000-0000-0000-0000000d3302');
SELECT is((SELECT count(*)::integer FROM public.clients WHERE id='00000000-0000-0000-0000-0000000d3691'),1,'Admin has intended client creation authority');
RESET ROLE;

SELECT pg_temp.batch_5f_d3_set_actor('00000000-0000-0000-0000-0000000d3304','00000000-0000-0000-0000-0000000d3404');
SET LOCAL ROLE authenticated;
UPDATE public.projects SET status='in_progress' WHERE id='00000000-0000-0000-0000-0000000d3631';
SELECT is((SELECT status FROM public.projects WHERE id='00000000-0000-0000-0000-0000000d3631'),'in_progress','Project Manager may perform management transition');
RESET ROLE;

SELECT pg_temp.batch_5f_d3_set_actor('00000000-0000-0000-0000-0000000d3305','00000000-0000-0000-0000-0000000d3405');
SET LOCAL ROLE authenticated;
UPDATE public.projects SET progress=25,assigned_to=assigned_to
WHERE id='00000000-0000-0000-0000-0000000d3631';
SELECT is((SELECT progress FROM public.projects WHERE id='00000000-0000-0000-0000-0000000d3631'),25,'Staff projects.write may update ordinary progress');
SELECT throws_ok($$UPDATE public.projects
 SET assigned_to=ARRAY['00000000-0000-0000-0000-0000000d3301']::uuid[]
 WHERE id='00000000-0000-0000-0000-0000000d3633'$$,
 '42501','Project management permission is required','projects.write cannot change assigned_to from NULL to a value');
SELECT throws_ok($$UPDATE public.projects SET assigned_to=NULL
 WHERE id='00000000-0000-0000-0000-0000000d3631'$$,
 '42501','Project management permission is required','projects.write cannot change assigned_to from a value to NULL');
SELECT throws_ok($$UPDATE public.projects
 SET assigned_to=ARRAY['00000000-0000-0000-0000-0000000d3301']::uuid[]
 WHERE id='00000000-0000-0000-0000-0000000d3631'$$,
 '42501','Project management permission is required','projects.write cannot replace one assignment array with another');
SELECT throws_ok($$UPDATE public.projects
 SET assigned_to=ARRAY['00000000-0000-0000-0000-0000000d3302','00000000-0000-0000-0000-0000000d3301']::uuid[]
 WHERE id='00000000-0000-0000-0000-0000000d3631'$$,
 '42501','Project management permission is required','projects.write cannot bypass management by reordering assignments');
SELECT throws_ok($$UPDATE public.projects SET status='completed'
 WHERE id='00000000-0000-0000-0000-0000000d3631'$$,
 '42501','Project management permission is required','Staff cannot perform project management transition');
SELECT throws_ok($$UPDATE public.projects SET progress=80,health='at_risk'
 WHERE id='00000000-0000-0000-0000-0000000d3631'$$,
 '42501','Project management permission is required','one protected field blocks a mixed ordinary and management update');
SELECT is((SELECT count(*)::integer FROM public.quotes),0,'Staff without quotes.read cannot SELECT quotes');
SELECT throws_ok($$INSERT INTO public.channels (organization_id,name,created_by)
 VALUES (current_setting('batch_5f_d3.org_a')::uuid,'Staff forged channel','00000000-0000-0000-0000-0000000d3305')$$,
 '42501',NULL::text,'collaboration.write does not grant channel management');
RESET ROLE;

SELECT pg_temp.batch_5f_d3_set_actor('00000000-0000-0000-0000-0000000d3311','00000000-0000-0000-0000-0000000d3411');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::integer FROM public.projects),0,'Client-only actor has no internal domain authority');
RESET ROLE;

-- ============ CROSS-TENANT CHILD REFERENCES ============

SELECT pg_temp.batch_5f_d3_set_actor('00000000-0000-0000-0000-0000000d3301','00000000-0000-0000-0000-0000000d3401');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$INSERT INTO public.client_contacts (organization_id,client_id,name)
 VALUES (current_setting('batch_5f_d3.org_a')::uuid,'00000000-0000-0000-0000-0000000d3602','forged')$$,
 '23503',NULL::text,'contact attached to foreign client is denied');
SELECT throws_ok($$INSERT INTO public.client_notes (organization_id,client_id,author_id,body)
 VALUES (current_setting('batch_5f_d3.org_a')::uuid,'00000000-0000-0000-0000-0000000d3602','00000000-0000-0000-0000-0000000d3301','forged')$$,
 '23503',NULL::text,'client note attached to foreign client is denied');
SELECT throws_ok($$INSERT INTO public.quote_items (organization_id,quote_id,description)
 VALUES (current_setting('batch_5f_d3.org_a')::uuid,'00000000-0000-0000-0000-0000000d3612','forged')$$,
 '42501',NULL::text,'quote item attached to foreign quote is denied');
SELECT throws_ok($$INSERT INTO public.invoice_items (organization_id,invoice_id,description)
 VALUES (current_setting('batch_5f_d3.org_a')::uuid,'00000000-0000-0000-0000-0000000d3622','forged')$$,
 '42501',NULL::text,'invoice item attached to foreign invoice is denied');
SELECT throws_ok($$INSERT INTO public.project_milestones (organization_id,project_id,title)
 VALUES (current_setting('batch_5f_d3.org_a')::uuid,'00000000-0000-0000-0000-0000000d3632','forged')$$,
 '23503',NULL::text,'milestone attached to foreign project is denied');
SELECT throws_ok($$INSERT INTO public.task_comments (organization_id,task_id,author_id,body)
 VALUES (current_setting('batch_5f_d3.org_a')::uuid,'00000000-0000-0000-0000-0000000d3642','00000000-0000-0000-0000-0000000d3301','forged')$$,
 '23503',NULL::text,'task comment attached to foreign task is denied');
SELECT throws_ok($$INSERT INTO public.ticket_messages (organization_id,ticket_id,author_id,body)
 VALUES (current_setting('batch_5f_d3.org_a')::uuid,'00000000-0000-0000-0000-0000000d3652','00000000-0000-0000-0000-0000000d3301','forged')$$,
 '23503',NULL::text,'ticket message attached to foreign ticket is denied');
SELECT throws_ok($$INSERT INTO public.messages (organization_id,channel_id,author_id,body)
 VALUES (current_setting('batch_5f_d3.org_a')::uuid,'00000000-0000-0000-0000-0000000d3662','00000000-0000-0000-0000-0000000d3301','forged')$$,
 '23503',NULL::text,'message attached to foreign channel is denied');
RESET ROLE;

-- ============ SPECIAL CONTRACTS ============

SELECT pg_temp.batch_5f_d3_set_actor('00000000-0000-0000-0000-0000000d3301','00000000-0000-0000-0000-0000000d3401');
SET LOCAL ROLE authenticated;
SELECT ok(NOT private.purplelok_can_reference_members(
  current_setting('batch_5f_d3.org_b')::uuid,'projects.write',ARRAY[]::uuid[]),
  'member-reference helper arguments cannot authorize an organization the caller lacks');
SELECT ok(NOT private.purplelok_can_reference_members(
  current_setting('batch_5f_d3.org_a')::uuid,'arbitrary.permission',ARRAY[]::uuid[]),
  'arbitrary permission input cannot broaden member-reference authority');
SELECT ok(private.purplelok_can_reference_members(
  current_setting('batch_5f_d3.org_a')::uuid,'projects.write',NULL),
  'NULL member arrays are intentionally accepted when the business field is nullable');
SELECT ok(private.purplelok_can_reference_members(
  current_setting('batch_5f_d3.org_a')::uuid,'projects.write',ARRAY[]::uuid[]),
  'empty project assignment arrays are intentionally accepted');
SELECT ok(private.purplelok_can_reference_members(
  current_setting('batch_5f_d3.org_a')::uuid,'projects.write',
  ARRAY['00000000-0000-0000-0000-0000000d3302','00000000-0000-0000-0000-0000000d3302']::uuid[]),
  'duplicate valid assignment values do not bypass or invalidate member checks');
SELECT ok(NOT private.purplelok_can_reference_members(
  current_setting('batch_5f_d3.org_a')::uuid,'projects.write',
  ARRAY['00000000-0000-0000-0000-0000000d3302','00000000-0000-0000-0000-0000000d3306']::uuid[]),
  'one foreign member poisons an otherwise valid project assignment array');
SELECT ok(NOT private.purplelok_can_reference_members(
  current_setting('batch_5f_d3.org_a')::uuid,'projects.write',
  ARRAY['00000000-0000-0000-0000-0000000d3309']::uuid[]),
  'inactive-profile member references are denied');
SELECT ok(NOT private.purplelok_can_reference_members(
  current_setting('batch_5f_d3.org_a')::uuid,'projects.write',
  ARRAY['00000000-0000-0000-0000-0000000d3310']::uuid[]),
  'suspended member references are denied');
SELECT ok(NOT private.purplelok_can_reference_members(
  current_setting('batch_5f_d3.org_a')::uuid,'projects.write',
  ARRAY['00000000-0000-0000-0000-0000000d3313']::uuid[]),
  'live users without a same-organization membership are denied as references');
SELECT ok(NOT private.purplelok_can_reference_members(
  current_setting('batch_5f_d3.org_a')::uuid,'projects.write',
  ARRAY['00000000-0000-0000-0000-0000000d3399']::uuid[]),
  'nonexistent user UUIDs are denied as member references');
INSERT INTO public.meetings (id,organization_id,title,assigned_to)
VALUES ('00000000-0000-0000-0000-0000000d3696',current_setting('batch_5f_d3.org_a')::uuid,
  'Nullable assignee meeting',NULL);
SELECT is((SELECT count(*)::integer FROM public.meetings
  WHERE id='00000000-0000-0000-0000-0000000d3696'),1,
  'NULL scalar assignee is accepted where the schema and meeting business model allow it');
SELECT throws_ok($$INSERT INTO public.activities (organization_id,user_id,type,description)
 VALUES (current_setting('batch_5f_d3.org_a')::uuid,'00000000-0000-0000-0000-0000000d3301','forged','forged')$$,
 '42501',NULL::text,'activities browser INSERT is denied even to Owner');
SELECT is((SELECT count(*)::integer FROM public.notifications WHERE id='00000000-0000-0000-0000-0000000d3681'),1,'notification recipient sees own notification');
SELECT is((SELECT count(*)::integer FROM public.notifications WHERE id='00000000-0000-0000-0000-0000000d3682'),0,'notification recipient cannot see another member notification');
SELECT is((SELECT count(*)::integer FROM public.notifications WHERE id='00000000-0000-0000-0000-0000000d3685'),0,'notification recipient cannot see a notification from another organization');
SELECT throws_ok($$INSERT INTO public.notifications (organization_id,user_id,title)
 VALUES (current_setting('batch_5f_d3.org_b')::uuid,'00000000-0000-0000-0000-0000000d3306','spoofed')$$,
 '42501',NULL::text,'browser cannot fabricate a cross-organization recipient notification');
UPDATE public.notifications SET read=true WHERE id='00000000-0000-0000-0000-0000000d3681';
SELECT is((SELECT read FROM public.notifications WHERE id='00000000-0000-0000-0000-0000000d3681'),true,'recipient may mark own notification read');
SELECT throws_ok($$UPDATE public.notifications SET title='forged'
 WHERE id='00000000-0000-0000-0000-0000000d3681'$$,
 '42501','Only notification read state may be updated','recipient cannot mutate notification content');
SELECT throws_ok($$UPDATE public.notifications
 SET body='forged',type='warning',link='/forged',created_at=clock_timestamp()
 WHERE id='00000000-0000-0000-0000-0000000d3681'$$,
 '42501','Only notification read state may be updated','recipient cannot mutate body, type, link, or timestamp');
SELECT throws_ok($$UPDATE public.notifications
 SET user_id='00000000-0000-0000-0000-0000000d3302'
 WHERE id='00000000-0000-0000-0000-0000000d3681'$$,
 '42501','Only notification read state may be updated','recipient cannot change notification recipient within the tenant');
SELECT throws_ok($$UPDATE public.notifications
 SET organization_id=current_setting('batch_5f_d3.org_b')::uuid,
     user_id='00000000-0000-0000-0000-0000000d3306'
 WHERE id='00000000-0000-0000-0000-0000000d3681'$$,
 '42501','Domain organization identity is immutable','recipient cannot move a notification to another tenant');
SELECT throws_ok($$INSERT INTO public.messages (organization_id,channel_id,author_id,body)
 VALUES (current_setting('batch_5f_d3.org_a')::uuid,'00000000-0000-0000-0000-0000000d3661','00000000-0000-0000-0000-0000000d3302','impersonated')$$,
 '42501',NULL::text,'message sender impersonation is denied');
INSERT INTO public.messages (id,organization_id,channel_id,author_id,body) VALUES
 ('00000000-0000-0000-0000-0000000d3692',current_setting('batch_5f_d3.org_a')::uuid,'00000000-0000-0000-0000-0000000d3661','00000000-0000-0000-0000-0000000d3301','own message');
SELECT is((SELECT count(*)::integer FROM public.messages WHERE id='00000000-0000-0000-0000-0000000d3692'),1,'collaboration.write permits identity-bound same-tenant message');
INSERT INTO public.channels (id,organization_id,name,created_by) VALUES
 ('00000000-0000-0000-0000-0000000d3693',current_setting('batch_5f_d3.org_a')::uuid,'Owner channel','00000000-0000-0000-0000-0000000d3301');
SELECT is((SELECT count(*)::integer FROM public.channels WHERE id='00000000-0000-0000-0000-0000000d3693'),1,'collaboration.manage permits channel creation');
UPDATE public.quotes SET status='accepted' WHERE id='00000000-0000-0000-0000-0000000d3611';
SELECT is((SELECT status FROM public.quotes WHERE id='00000000-0000-0000-0000-0000000d3611'),'draft','generic quote UPDATE cannot bypass approval workflow');
UPDATE public.invoices SET status='sent' WHERE id='00000000-0000-0000-0000-0000000d3621';
SELECT is((SELECT status FROM public.invoices WHERE id='00000000-0000-0000-0000-0000000d3621'),'draft','generic invoice UPDATE cannot bypass approval workflow');
SELECT throws_ok($$INSERT INTO public.clients (organization_id,company_name,created_by)
 VALUES (current_setting('batch_5f_d3.org_a')::uuid,'impersonated creator','00000000-0000-0000-0000-0000000d3302')$$,
 '42501',NULL::text,'creator identity impersonation is denied');
SELECT throws_ok($$INSERT INTO public.client_notes (organization_id,client_id,author_id,body)
 VALUES (current_setting('batch_5f_d3.org_a')::uuid,'00000000-0000-0000-0000-0000000d3601','00000000-0000-0000-0000-0000000d3302','impersonated')$$,
 '42501',NULL::text,'client-note author impersonation is denied');
SELECT throws_ok($$INSERT INTO public.quotes (organization_id,quote_number,client_id,title,status,created_by)
 VALUES (current_setting('batch_5f_d3.org_a')::uuid,'D3-IMPERSONATED-QUOTE','00000000-0000-0000-0000-0000000d3601','impersonated','draft','00000000-0000-0000-0000-0000000d3302')$$,
 '42501',NULL::text,'quote creator impersonation is denied');
SELECT throws_ok($$INSERT INTO public.invoices (organization_id,invoice_number,client_id,title,status,created_by)
 VALUES (current_setting('batch_5f_d3.org_a')::uuid,'D3-IMPERSONATED-INVOICE','00000000-0000-0000-0000-0000000d3601','impersonated','draft','00000000-0000-0000-0000-0000000d3302')$$,
 '42501',NULL::text,'invoice creator impersonation is denied');
SELECT throws_ok($$INSERT INTO public.projects (organization_id,name,client_id,created_by)
 VALUES (current_setting('batch_5f_d3.org_a')::uuid,'impersonated','00000000-0000-0000-0000-0000000d3601','00000000-0000-0000-0000-0000000d3302')$$,
 '42501',NULL::text,'project creator impersonation is denied');
SELECT throws_ok($$INSERT INTO public.tasks (organization_id,title,project_id,client_id,created_by)
 VALUES (current_setting('batch_5f_d3.org_a')::uuid,'impersonated','00000000-0000-0000-0000-0000000d3631','00000000-0000-0000-0000-0000000d3601','00000000-0000-0000-0000-0000000d3302')$$,
 '42501',NULL::text,'task creator impersonation is denied');
SELECT throws_ok($$INSERT INTO public.task_comments (organization_id,task_id,author_id,body)
 VALUES (current_setting('batch_5f_d3.org_a')::uuid,'00000000-0000-0000-0000-0000000d3641','00000000-0000-0000-0000-0000000d3302','impersonated')$$,
 '42501',NULL::text,'task-comment author impersonation is denied');
SELECT throws_ok($$INSERT INTO public.documents (organization_id,name,uploaded_by)
 VALUES (current_setting('batch_5f_d3.org_a')::uuid,'impersonated','00000000-0000-0000-0000-0000000d3302')$$,
 '42501',NULL::text,'document uploader impersonation is denied');
SELECT throws_ok($$INSERT INTO public.tickets (organization_id,ticket_number,subject,created_by)
 VALUES (current_setting('batch_5f_d3.org_a')::uuid,'D3-IMPERSONATED-TICKET','impersonated','00000000-0000-0000-0000-0000000d3302')$$,
 '42501',NULL::text,'ticket creator impersonation is denied');
SELECT throws_ok($$INSERT INTO public.ticket_messages (organization_id,ticket_id,author_id,body)
 VALUES (current_setting('batch_5f_d3.org_a')::uuid,'00000000-0000-0000-0000-0000000d3651','00000000-0000-0000-0000-0000000d3302','impersonated')$$,
 '42501',NULL::text,'ticket-message author impersonation is denied');
SELECT throws_ok($$INSERT INTO public.channels (organization_id,name,created_by)
 VALUES (current_setting('batch_5f_d3.org_a')::uuid,'impersonated channel','00000000-0000-0000-0000-0000000d3302')$$,
 '42501',NULL::text,'channel creator impersonation is denied');
SELECT throws_ok($$INSERT INTO public.leads (organization_id,company_name,assigned_to)
 VALUES (current_setting('batch_5f_d3.org_a')::uuid,'foreign assignee','00000000-0000-0000-0000-0000000d3306')$$,
 '42501',NULL::text,'cross-tenant assignee reference is denied');
SELECT throws_ok($$INSERT INTO public.leads (organization_id,company_name,assigned_to)
 VALUES (current_setting('batch_5f_d3.org_a')::uuid,'suspended assignee','00000000-0000-0000-0000-0000000d3310')$$,
 '42501',NULL::text,'lead assignment to a suspended same-tenant member is denied');
SELECT throws_ok($$INSERT INTO public.projects (organization_id,name,client_id,assigned_to,created_by)
 VALUES (current_setting('batch_5f_d3.org_a')::uuid,'mixed assignees','00000000-0000-0000-0000-0000000d3601',
 ARRAY['00000000-0000-0000-0000-0000000d3302','00000000-0000-0000-0000-0000000d3306']::uuid[],
 '00000000-0000-0000-0000-0000000d3301')$$,
 '42501',NULL::text,'project assignment array rejects one valid and one foreign member');
SELECT throws_ok($$INSERT INTO public.tasks (organization_id,title,assigned_to,created_by)
 VALUES (current_setting('batch_5f_d3.org_a')::uuid,'suspended assignee','00000000-0000-0000-0000-0000000d3310','00000000-0000-0000-0000-0000000d3301')$$,
 '42501',NULL::text,'task assignment to a suspended member is denied');
SELECT throws_ok($$INSERT INTO public.meetings (organization_id,title,assigned_to)
 VALUES (current_setting('batch_5f_d3.org_a')::uuid,'missing assignee','00000000-0000-0000-0000-0000000d3399')$$,
 '42501',NULL::text,'meeting assignment to a nonexistent UUID is denied');
SELECT throws_ok($$INSERT INTO public.tickets (organization_id,ticket_number,subject,assigned_to,created_by)
 VALUES (current_setting('batch_5f_d3.org_a')::uuid,'D3-NO-MEMBER','missing membership','00000000-0000-0000-0000-0000000d3313','00000000-0000-0000-0000-0000000d3301')$$,
 '42501',NULL::text,'ticket assignment to a live user without membership is denied');
SELECT throws_ok($$UPDATE public.clients SET organization_id=NULL
 WHERE id='00000000-0000-0000-0000-0000000d3601'$$,
 '42501','Domain organization identity is immutable','domain organization cannot move from a tenant to NULL');
RESET ROLE;
SELECT throws_ok($$UPDATE public.clients
 SET organization_id=current_setting('batch_5f_d3.org_a')::uuid
 WHERE id='00000000-0000-0000-0000-0000000d3695'$$,
 '42501','Domain organization identity is immutable','domain organization cannot move from NULL to a tenant');

INSERT INTO public.organization_members (id,organization_id,user_id,status)
VALUES ('00000000-0000-0000-0000-0000000d3599',current_setting('batch_5f_d3.org_b')::uuid,'00000000-0000-0000-0000-0000000d3301','active');
INSERT INTO public.organization_member_roles (organization_id,organization_member_id,organization_role_id)
SELECT current_setting('batch_5f_d3.org_b')::uuid,'00000000-0000-0000-0000-0000000d3599',role.id
FROM public.organization_roles AS role
WHERE role.organization_id=current_setting('batch_5f_d3.org_b')::uuid AND role.key='owner';
SET LOCAL ROLE authenticated;
SELECT throws_ok($$UPDATE public.clients SET organization_id=current_setting('batch_5f_d3.org_b')::uuid
 WHERE id='00000000-0000-0000-0000-0000000d3601'$$,
 '42501','Domain organization identity is immutable','authorized multi-tenant user cannot move resource organization');
SELECT throws_ok($$INSERT INTO public.quotes (organization_id,quote_number,client_id,title,status,approved_by_client,created_by)
 VALUES (current_setting('batch_5f_d3.org_a')::uuid,'D3-FORGED-QUO','00000000-0000-0000-0000-0000000d3601','forged','accepted',true,'00000000-0000-0000-0000-0000000d3301')$$,
 '42501',NULL::text,'quote cannot be inserted in approved state');
SELECT throws_ok($$INSERT INTO public.invoices (organization_id,invoice_number,client_id,title,status,amount_paid,created_by)
 VALUES (current_setting('batch_5f_d3.org_a')::uuid,'D3-FORGED-INV','00000000-0000-0000-0000-0000000d3601','forged','paid',1,'00000000-0000-0000-0000-0000000d3301')$$,
 '42501',NULL::text,'invoice cannot be inserted in approved or paid state');

INSERT INTO public.client_notes (id,organization_id,client_id,author_id,body) VALUES
 ('00000000-0000-0000-0000-0000000d3694',current_setting('batch_5f_d3.org_a')::uuid,'00000000-0000-0000-0000-0000000d3601','00000000-0000-0000-0000-0000000d3301','own note');
SELECT is((SELECT count(*)::integer FROM public.client_notes WHERE id='00000000-0000-0000-0000-0000000d3694'),1,'clients.write permits identity-bound note insertion');
RESET ROLE;

SELECT pg_temp.batch_5f_d3_set_actor('00000000-0000-0000-0000-0000000d3302','00000000-0000-0000-0000-0000000d3402');
SET LOCAL ROLE authenticated;
DELETE FROM public.client_notes WHERE id='00000000-0000-0000-0000-0000000d3694';
SELECT is((SELECT count(*)::integer FROM public.client_notes WHERE id='00000000-0000-0000-0000-0000000d3694'),1,'clients.write cannot delete another author note');
RESET ROLE;
SELECT pg_temp.batch_5f_d3_set_actor('00000000-0000-0000-0000-0000000d3301','00000000-0000-0000-0000-0000000d3401');
SET LOCAL ROLE authenticated;
DELETE FROM public.client_notes WHERE id='00000000-0000-0000-0000-0000000d3694';
SELECT is((SELECT count(*)::integer FROM public.client_notes WHERE id='00000000-0000-0000-0000-0000000d3694'),0,'clients.write author may delete own note');
RESET ROLE;

SELECT pg_temp.batch_5f_d3_set_actor('00000000-0000-0000-0000-0000000d3305','00000000-0000-0000-0000-0000000d3405');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::integer FROM public.activities),0,'lower role without activities.read cannot read activity feed');
RESET ROLE;

-- Same JWT is revoked immediately when its disposable live session disappears.
SELECT pg_temp.batch_5f_d3_set_actor('00000000-0000-0000-0000-0000000d3312','00000000-0000-0000-0000-0000000d3412');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::integer FROM public.clients WHERE id='00000000-0000-0000-0000-0000000d3601'),1,'same valid JWT reads while auth.sessions row exists');
RESET ROLE;
DELETE FROM auth.sessions WHERE id='00000000-0000-0000-0000-0000000d3412';
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::integer FROM public.clients),0,'same JWT immediately loses domain access after session deletion');
RESET ROLE;

SELECT is((SELECT tgenabled FROM pg_catalog.pg_trigger
  WHERE tgrelid='public.organization_member_roles'::regclass
    AND tgname='organization_member_roles_reject_client'),'O'::"char",
  'D2 Client assignment protection remains enabled after D3 fixtures');
SELECT is((SELECT count(*)::integer FROM public.permissions),32,'D2 permission catalogue remains exact');
SELECT is((SELECT count(*)::integer FROM public.platform_admins),0,'platform administrators remain dormant');

SELECT * FROM finish();
ROLLBACK;
