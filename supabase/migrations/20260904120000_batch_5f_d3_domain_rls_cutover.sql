/*
# Batch 5F-D3: atomic authoritative domain RLS cutover

Replaces the 84 legacy authenticated USING(true) domain policies with an exact
tenant-, live-session-, and capability-aware policy catalogue.  The cutover is
transactional and deliberately leaves profiles, identity/RBAC tables, Auth,
Storage, realtime publication, and table grants unchanged.
*/

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '3min';

LOCK TABLE
  public.clients, public.client_contacts, public.client_notes, public.leads,
  public.quotes, public.quote_items, public.invoices, public.invoice_items,
  public.payments, public.projects, public.project_milestones, public.tasks,
  public.task_comments, public.meetings, public.documents, public.tickets,
  public.ticket_messages, public.activities, public.notifications,
  public.channels, public.messages
IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE batch_5f_d3_tables (table_name text PRIMARY KEY) ON COMMIT DROP;
INSERT INTO batch_5f_d3_tables (table_name) VALUES
  ('clients'), ('client_contacts'), ('client_notes'), ('leads'), ('quotes'),
  ('quote_items'), ('invoices'), ('invoice_items'), ('payments'), ('projects'),
  ('project_milestones'), ('tasks'), ('task_comments'), ('meetings'),
  ('documents'), ('tickets'), ('ticket_messages'), ('activities'),
  ('notifications'), ('channels'), ('messages');

CREATE TEMP TABLE batch_5f_d3_policy_snapshot ON COMMIT DROP AS
SELECT policy.schemaname, policy.tablename, policy.policyname,
       policy.permissive, policy.roles, policy.cmd, policy.qual,
       policy.with_check
FROM pg_catalog.pg_policies AS policy
JOIN batch_5f_d3_tables AS domain_table
  ON domain_table.table_name = policy.tablename
WHERE policy.schemaname = 'public';

CREATE TEMP TABLE batch_5f_d3_rls_snapshot ON COMMIT DROP AS
SELECT namespace.nspname AS schemaname, relation.relname AS tablename,
       relation.relrowsecurity, relation.relforcerowsecurity
FROM pg_catalog.pg_class AS relation
JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
JOIN batch_5f_d3_tables AS domain_table ON domain_table.table_name = relation.relname
WHERE namespace.nspname = 'public' AND relation.relkind = 'r';

CREATE TEMP TABLE batch_5f_d3_acl_snapshot ON COMMIT DROP AS
SELECT relation.oid AS relation_id, relation.relacl
FROM pg_catalog.pg_class AS relation
JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
JOIN batch_5f_d3_tables AS domain_table ON domain_table.table_name = relation.relname
WHERE namespace.nspname = 'public' AND relation.relkind = 'r';

CREATE TEMP TABLE batch_5f_d3_expected_policies (
  table_name text NOT NULL,
  policy_name text PRIMARY KEY,
  command text NOT NULL,
  permission_key text NOT NULL,
  contract text NOT NULL
) ON COMMIT DROP;

INSERT INTO batch_5f_d3_expected_policies
  (table_name, policy_name, command, permission_key, contract)
VALUES
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

CREATE TEMP TABLE batch_5f_d3_expected_role_permissions (
  role_key text NOT NULL,
  permission_key text NOT NULL,
  PRIMARY KEY (role_key, permission_key)
) ON COMMIT DROP;

INSERT INTO batch_5f_d3_expected_role_permissions (role_key, permission_key)
SELECT desired.role_key, expanded.permission_key
FROM (
  VALUES
    ('owner', ARRAY(SELECT key FROM public.permissions ORDER BY key)),
    ('admin', ARRAY(SELECT key FROM public.permissions ORDER BY key)),
    ('finance', ARRAY[
      'clients.read','projects.read','quotes.read','quotes.write','quotes.approve',
      'invoices.read','invoices.write','invoices.approve','payments.read',
      'payments.record','documents.read','reports.read','settings.read',
      'members.read','collaboration.read','collaboration.write']::text[]),
    ('project_manager', ARRAY[
      'clients.read','projects.read','projects.write','projects.manage','tasks.read',
      'tasks.write','documents.read','documents.write','tickets.read','tickets.write',
      'reports.read','settings.read','members.read','collaboration.read',
      'collaboration.write']::text[]),
    ('staff', ARRAY[
      'clients.read','projects.read','tasks.read','tasks.write','documents.read',
      'documents.write','tickets.read','tickets.write','settings.read','members.read',
      'collaboration.read','collaboration.write']::text[]),
    ('client', ARRAY[
      'projects.read','documents.read','quotes.read','invoices.read','tickets.read',
      'tickets.write']::text[])
) AS desired(role_key, permission_keys)
CROSS JOIN LATERAL pg_catalog.unnest(desired.permission_keys)
  AS expanded(permission_key);

DO $preflight$
DECLARE
  old_policy_hash text;
  tenant_table_record record;
  null_tenant_rows bigint;
BEGIN
  SELECT pg_catalog.md5(pg_catalog.string_agg(
    pg_catalog.format('%s|%s|%s|%s|%s|%s|%s', schemaname, tablename,
      policyname, permissive, roles::text, cmd,
      coalesce(qual,'') || '|' || coalesce(with_check,'')),
    E'\n' ORDER BY schemaname,tablename,policyname))
  INTO old_policy_hash
  FROM batch_5f_d3_policy_snapshot;

  IF (SELECT count(*) FROM batch_5f_d3_policy_snapshot) <> 84
     OR old_policy_hash <> 'eb744436bf76a7cc18e32b06734b5478' THEN
    RAISE EXCEPTION 'Batch 5F-D3 precondition: legacy domain policy baseline differs';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM batch_5f_d3_tables AS domain_table
    CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE')) AS operation(command)
    LEFT JOIN batch_5f_d3_policy_snapshot AS policy
      ON policy.tablename = domain_table.table_name
     AND policy.policyname = domain_table.table_name || '_' || pg_catalog.lower(operation.command)
     AND policy.cmd = operation.command
     AND policy.permissive = 'PERMISSIVE'
     AND policy.roles = ARRAY['authenticated']::name[]
     AND (operation.command NOT IN ('SELECT','UPDATE','DELETE') OR policy.qual = 'true')
     AND (operation.command NOT IN ('INSERT','UPDATE') OR policy.with_check = 'true')
    WHERE policy.policyname IS NULL
  ) THEN
    RAISE EXCEPTION 'Batch 5F-D3 precondition: legacy policy definitions are not exact';
  END IF;

  IF (SELECT count(*) FROM batch_5f_d3_rls_snapshot) <> 21
     OR EXISTS (SELECT 1 FROM batch_5f_d3_rls_snapshot
               WHERE NOT relrowsecurity OR relforcerowsecurity) THEN
    RAISE EXCEPTION 'Batch 5F-D3 precondition: domain RLS flags differ';
  END IF;

  IF (SELECT count(*) FROM information_schema.columns AS column_definition
      JOIN batch_5f_d3_tables AS domain_table
        ON domain_table.table_name = column_definition.table_name
      WHERE column_definition.table_schema='public'
        AND column_definition.column_name='organization_id'
        AND column_definition.data_type='uuid'
        AND column_definition.is_nullable='YES'
        AND column_definition.column_default IS NULL) <> 21 THEN
    RAISE EXCEPTION 'Batch 5F-D3 precondition: domain tenant columns differ';
  END IF;

  IF EXISTS (
    SELECT 1 FROM batch_5f_d3_tables AS domain_table
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint AS constraint_definition
      JOIN pg_catalog.pg_class AS child ON child.oid=constraint_definition.conrelid
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid=child.relnamespace
      JOIN pg_catalog.pg_attribute AS tenant_column
        ON tenant_column.attrelid=child.oid
       AND tenant_column.attname='organization_id'
      WHERE namespace.nspname='public'
        AND child.relname=domain_table.table_name
        AND constraint_definition.contype='f'
        AND constraint_definition.confrelid='public.organizations'::regclass
        AND constraint_definition.conkey=ARRAY[tenant_column.attnum]::smallint[]
        AND constraint_definition.confdeltype='r'
        AND constraint_definition.convalidated
    )
  ) THEN
    RAISE EXCEPTION 'Batch 5F-D3 precondition: domain tenant ownership is incomplete';
  END IF;

  FOR tenant_table_record IN SELECT table_name FROM batch_5f_d3_tables LOOP
    EXECUTE pg_catalog.format(
      'SELECT count(*) FROM public.%I WHERE organization_id IS NULL',
      tenant_table_record.table_name
    ) INTO null_tenant_rows;
    IF null_tenant_rows <> 0 THEN
      RAISE EXCEPTION
        'Batch 5F-D3 precondition: %.organization_id contains NULL rows',
        tenant_table_record.table_name;
    END IF;
  END LOOP;

  IF (
    SELECT count(*)
    FROM pg_catalog.pg_proc AS function_definition
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid=function_definition.pronamespace
    JOIN (VALUES
      ('private.purplelok_current_session_id()', false, 'on'::text),
      ('private.purplelok_has_normal_session()', true, 'off'::text),
      ('private.purplelok_has_active_membership(uuid)', true, 'off'::text),
      ('private.purplelok_has_permission(uuid,text)', true, 'off'::text),
      ('private.purplelok_can_access_resource(uuid,text)', false, 'on'::text)
    ) AS expected(function_signature, security_definer, row_security)
      ON function_definition.oid=pg_catalog.to_regprocedure(expected.function_signature)
    WHERE namespace.nspname='private'
      AND pg_catalog.pg_get_userbyid(function_definition.proowner)='postgres'
      AND function_definition.prosecdef=expected.security_definer
      AND function_definition.provolatile='s'
      AND function_definition.proconfig @> ARRAY[
        'row_security=' || expected.row_security
      ]
      AND EXISTS (
        SELECT 1
        FROM pg_catalog.unnest(function_definition.proconfig) AS setting(value)
        WHERE setting.value ~ '^search_path=(""|)$'
      )
      AND pg_catalog.cardinality(function_definition.proconfig)=2
  ) <> 5
  OR pg_catalog.has_function_privilege(
       'authenticated', 'private.purplelok_current_session_id()', 'EXECUTE')
  OR EXISTS (
    SELECT 1
    FROM (VALUES
      ('private.purplelok_has_normal_session()'),
      ('private.purplelok_has_active_membership(uuid)'),
      ('private.purplelok_has_permission(uuid,text)'),
      ('private.purplelok_can_access_resource(uuid,text)')
    ) AS exposed(function_signature)
    WHERE NOT pg_catalog.has_function_privilege(
      'authenticated', exposed.function_signature, 'EXECUTE')
  )
  OR EXISTS (
    SELECT 1
    FROM (VALUES
      ('private.purplelok_current_session_id()'),
      ('private.purplelok_has_normal_session()'),
      ('private.purplelok_has_active_membership(uuid)'),
      ('private.purplelok_has_permission(uuid,text)'),
      ('private.purplelok_can_access_resource(uuid,text)')
    ) AS helper(function_signature)
    CROSS JOIN (VALUES ('anon'),('service_role'),('supabase_auth_admin'))
      AS forbidden(role_name)
    WHERE pg_catalog.has_function_privilege(
      forbidden.role_name, helper.function_signature, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'Batch 5F-D3 precondition: D1 predicate metadata or ACLs differ';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_catalog.pg_trigger AS trigger_definition
    JOIN pg_catalog.pg_class AS relation ON relation.oid=trigger_definition.tgrelid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid=relation.relnamespace
    JOIN pg_catalog.pg_proc AS trigger_function
      ON trigger_function.oid=trigger_definition.tgfoid
    JOIN pg_catalog.pg_namespace AS function_namespace
      ON function_namespace.oid=trigger_function.pronamespace
    JOIN (VALUES
      ('organization_roles','organization_roles_protect_system_identity',
       'purplelok_protect_system_role_identity',31::smallint),
      ('organization_member_roles','organization_member_roles_reject_client',
       'purplelok_reject_client_role_assignment',23::smallint),
      ('organization_role_permissions','organization_role_permissions_restrict_client',
       'purplelok_restrict_client_permissions',23::smallint)
    ) AS expected(table_name, trigger_name, function_name, trigger_type)
      ON expected.table_name=relation.relname
     AND expected.trigger_name=trigger_definition.tgname
     AND expected.function_name=trigger_function.proname
     AND expected.trigger_type=trigger_definition.tgtype
    WHERE namespace.nspname='public'
      AND function_namespace.nspname='private'
      AND NOT trigger_definition.tgisinternal
      AND trigger_definition.tgenabled='O'
  ) <> 3 THEN
    RAISE EXCEPTION 'Batch 5F-D3 precondition: D2 protection triggers differ';
  END IF;

  IF (SELECT count(*) FROM public.permissions) <> 32
     OR EXISTS (
       (SELECT key FROM public.permissions
        EXCEPT SELECT pg_catalog.unnest(ARRAY[
          'members.read','members.manage','roles.read','roles.manage',
          'clients.read','clients.write','leads.read','leads.write',
          'projects.read','projects.write','projects.manage','tasks.read',
          'tasks.write','quotes.read','quotes.write','quotes.approve',
          'invoices.read','invoices.write','invoices.approve','payments.read',
          'payments.record','documents.read','documents.write','tickets.read',
          'tickets.write','reports.read','settings.read','settings.manage',
          'activities.read','collaboration.read','collaboration.write',
          'collaboration.manage']::text[]))
       UNION ALL
       (SELECT pg_catalog.unnest(ARRAY[
          'members.read','members.manage','roles.read','roles.manage',
          'clients.read','clients.write','leads.read','leads.write',
          'projects.read','projects.write','projects.manage','tasks.read',
          'tasks.write','quotes.read','quotes.write','quotes.approve',
          'invoices.read','invoices.write','invoices.approve','payments.read',
          'payments.record','documents.read','documents.write','tickets.read',
          'tickets.write','reports.read','settings.read','settings.manage',
          'activities.read','collaboration.read','collaboration.write',
          'collaboration.manage']::text[])
        EXCEPT SELECT key FROM public.permissions)
     )
     OR EXISTS (
       SELECT organization.id
       FROM public.organizations AS organization
       LEFT JOIN public.organization_roles AS role
         ON role.organization_id=organization.id AND role.is_system
       GROUP BY organization.id
       HAVING count(*) <> 6
          OR count(*) FILTER (WHERE role.key=ANY(ARRAY[
            'owner','admin','finance','project_manager','staff','client'])) <> 6
     )
     OR EXISTS (
       SELECT 1 FROM public.organization_roles AS role
       WHERE role.is_system AND EXISTS (
         (SELECT mapping.permission_key FROM public.organization_role_permissions AS mapping
          WHERE mapping.organization_id=role.organization_id
            AND mapping.organization_role_id=role.id
          EXCEPT
          SELECT expected.permission_key FROM batch_5f_d3_expected_role_permissions AS expected
          WHERE expected.role_key=role.key)
         UNION ALL
         (SELECT expected.permission_key FROM batch_5f_d3_expected_role_permissions AS expected
          WHERE expected.role_key=role.key
          EXCEPT
          SELECT mapping.permission_key FROM public.organization_role_permissions AS mapping
          WHERE mapping.organization_id=role.organization_id
            AND mapping.organization_role_id=role.id)
       )
     )
     OR EXISTS (
       SELECT 1 FROM public.organization_member_roles AS member_role
       JOIN public.organization_roles AS role
         ON role.id=member_role.organization_role_id
        AND role.organization_id=member_role.organization_id
       WHERE role.key='client'
     )
     OR EXISTS (SELECT 1 FROM public.platform_admins) THEN
    RAISE EXCEPTION 'Batch 5F-D3 precondition: D2 catalogue or role mappings differ';
  END IF;

  IF (SELECT count(*)
      FROM pg_catalog.pg_constraint AS constraint_definition
      JOIN pg_catalog.pg_class AS child
        ON child.oid=constraint_definition.conrelid
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid=child.relnamespace
      WHERE namespace.nspname='public'
        AND constraint_definition.conname=ANY(ARRAY[
        'client_contacts_client_organization_fkey','client_notes_client_organization_fkey',
        'leads_client_organization_fkey','quotes_client_organization_fkey',
        'quote_items_quote_organization_fkey','invoices_client_organization_fkey',
        'invoices_quote_organization_fkey','invoice_items_invoice_organization_fkey',
        'payments_invoice_organization_fkey','payments_client_organization_fkey',
        'projects_client_organization_fkey','project_milestones_project_organization_fkey',
        'tasks_project_organization_fkey','tasks_client_organization_fkey',
        'task_comments_task_organization_fkey','meetings_project_organization_fkey',
        'meetings_client_organization_fkey','documents_folder_organization_fkey',
        'documents_client_organization_fkey','tickets_client_organization_fkey',
        'ticket_messages_ticket_organization_fkey','messages_channel_organization_fkey'])
        AND constraint_definition.contype='f'
        AND constraint_definition.convalidated) <> 22 THEN
    RAISE EXCEPTION 'Batch 5F-D3 precondition: composite tenant foreign keys differ';
  END IF;

  IF pg_catalog.to_regprocedure('private.purplelok_can_reference_members(uuid,text,uuid[])') IS NOT NULL
     OR pg_catalog.to_regprocedure('private.purplelok_protect_domain_update()') IS NOT NULL THEN
    RAISE EXCEPTION 'Batch 5F-D3 precondition: a D3 helper already exists';
  END IF;
END
$preflight$;

CREATE FUNCTION private.purplelok_can_reference_members(
  p_organization_id uuid,
  p_permission_key text,
  p_user_ids uuid[]
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
SET row_security = 'off'
AS $function$
  SELECT private.purplelok_has_permission(p_organization_id, p_permission_key)
     AND NOT EXISTS (
       SELECT 1
       FROM pg_catalog.unnest(coalesce(p_user_ids, ARRAY[]::uuid[])) AS requested(user_id)
       WHERE requested.user_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1
           FROM public.organization_members AS membership
           JOIN public.organizations AS organization
             ON organization.id=membership.organization_id
           JOIN auth.users AS auth_user ON auth_user.id=membership.user_id
           JOIN public.profiles AS profile ON profile.id=membership.user_id
           WHERE membership.organization_id=p_organization_id
             AND membership.user_id=requested.user_id
             AND membership.status='active'
             AND organization.status='active'
             AND auth_user.deleted_at IS NULL
             AND profile.active=true
         )
     )
$function$;

ALTER FUNCTION private.purplelok_can_reference_members(uuid,text,uuid[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.purplelok_can_reference_members(uuid,text,uuid[])
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION private.purplelok_can_reference_members(uuid,text,uuid[])
  TO authenticated;

CREATE FUNCTION private.purplelok_protect_domain_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
SET row_security = 'on'
AS $function$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Domain organization identity is immutable';
  END IF;

  IF TG_TABLE_NAME='clients' THEN
    IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Domain creator identity is immutable';
    END IF;
  ELSIF TG_TABLE_NAME='projects' THEN
    IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Domain creator identity is immutable';
    END IF;
    IF (NEW.assigned_to IS DISTINCT FROM OLD.assigned_to
        OR NEW.health IS DISTINCT FROM OLD.health
        OR NEW.status IS DISTINCT FROM OLD.status)
       AND NOT private.purplelok_can_access_resource(
         OLD.organization_id, 'projects.manage'
       ) THEN
      RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Project management permission is required';
    END IF;
  ELSIF TG_TABLE_NAME='tasks' THEN
    IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Domain creator identity is immutable';
    END IF;
  ELSIF TG_TABLE_NAME='documents' THEN
    IF NEW.uploaded_by IS DISTINCT FROM OLD.uploaded_by THEN
      RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Document uploader identity is immutable';
    END IF;
  ELSIF TG_TABLE_NAME='tickets' THEN
    IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Domain creator identity is immutable';
    END IF;
  ELSIF TG_TABLE_NAME='notifications' THEN
    IF current_user='authenticated'
       AND (pg_catalog.to_jsonb(NEW)-'read') IS DISTINCT FROM
           (pg_catalog.to_jsonb(OLD)-'read') THEN
      RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Only notification read state may be updated';
    END IF;
  ELSIF TG_TABLE_NAME='channels' THEN
    IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Domain creator identity is immutable';
    END IF;
  END IF;

  RETURN NEW;
END
$function$;

ALTER FUNCTION private.purplelok_protect_domain_update() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.purplelok_protect_domain_update()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

DO $drop_legacy$
DECLARE
  domain_table record;
  operation text;
BEGIN
  FOR domain_table IN SELECT table_name FROM batch_5f_d3_tables LOOP
    FOREACH operation IN ARRAY ARRAY['select','insert','update','delete'] LOOP
      EXECUTE pg_catalog.format('DROP POLICY %I ON public.%I',
        domain_table.table_name || '_' || operation, domain_table.table_name);
    END LOOP;
  END LOOP;
END
$drop_legacy$;

CREATE POLICY domain_clients_select ON public.clients FOR SELECT TO authenticated
  USING (private.purplelok_can_access_resource(organization_id,'clients.read'));
CREATE POLICY domain_clients_insert ON public.clients FOR INSERT TO authenticated
  WITH CHECK (private.purplelok_can_access_resource(organization_id,'clients.write') AND created_by=auth.uid());
CREATE POLICY domain_clients_update ON public.clients FOR UPDATE TO authenticated
  USING (private.purplelok_can_access_resource(organization_id,'clients.write'))
  WITH CHECK (private.purplelok_can_access_resource(organization_id,'clients.write'));

CREATE POLICY domain_client_contacts_select ON public.client_contacts FOR SELECT TO authenticated
  USING (private.purplelok_can_access_resource(organization_id,'clients.read'));
CREATE POLICY domain_client_contacts_insert ON public.client_contacts FOR INSERT TO authenticated
  WITH CHECK (private.purplelok_can_access_resource(organization_id,'clients.write'));
CREATE POLICY domain_client_contacts_update ON public.client_contacts FOR UPDATE TO authenticated
  USING (private.purplelok_can_access_resource(organization_id,'clients.write'))
  WITH CHECK (private.purplelok_can_access_resource(organization_id,'clients.write'));

CREATE POLICY domain_client_notes_select ON public.client_notes FOR SELECT TO authenticated
  USING (private.purplelok_can_access_resource(organization_id,'clients.read'));
CREATE POLICY domain_client_notes_insert ON public.client_notes FOR INSERT TO authenticated
  WITH CHECK (private.purplelok_can_access_resource(organization_id,'clients.write') AND author_id=auth.uid());
CREATE POLICY domain_client_notes_delete ON public.client_notes FOR DELETE TO authenticated
  USING (private.purplelok_can_access_resource(organization_id,'clients.write') AND author_id=auth.uid());

CREATE POLICY domain_leads_select ON public.leads FOR SELECT TO authenticated
  USING (private.purplelok_can_access_resource(organization_id,'leads.read'));
CREATE POLICY domain_leads_insert ON public.leads FOR INSERT TO authenticated
  WITH CHECK (private.purplelok_can_reference_members(organization_id,'leads.write',ARRAY[assigned_to]::uuid[]));
CREATE POLICY domain_leads_update ON public.leads FOR UPDATE TO authenticated
  USING (private.purplelok_can_access_resource(organization_id,'leads.write'))
  WITH CHECK (private.purplelok_can_reference_members(organization_id,'leads.write',ARRAY[assigned_to]::uuid[]));

CREATE POLICY domain_quotes_select ON public.quotes FOR SELECT TO authenticated
  USING (private.purplelok_can_access_resource(organization_id,'quotes.read'));
CREATE POLICY domain_quotes_insert ON public.quotes FOR INSERT TO authenticated
  WITH CHECK (private.purplelok_can_access_resource(organization_id,'quotes.write')
    AND created_by=auth.uid() AND status='draft'
    AND coalesce(approved_by_client,false)=false AND approved_at IS NULL);

CREATE POLICY domain_quote_items_select ON public.quote_items FOR SELECT TO authenticated
  USING (private.purplelok_can_access_resource(organization_id,'quotes.read'));
CREATE POLICY domain_quote_items_insert ON public.quote_items FOR INSERT TO authenticated
  WITH CHECK (private.purplelok_can_access_resource(organization_id,'quotes.write') AND EXISTS (
    SELECT 1 FROM public.quotes AS parent
    WHERE parent.id=quote_items.quote_id
      AND parent.organization_id=quote_items.organization_id
      AND parent.status='draft'));

CREATE POLICY domain_invoices_select ON public.invoices FOR SELECT TO authenticated
  USING (private.purplelok_can_access_resource(organization_id,'invoices.read'));
CREATE POLICY domain_invoices_insert ON public.invoices FOR INSERT TO authenticated
  WITH CHECK (private.purplelok_can_access_resource(organization_id,'invoices.write')
    AND created_by=auth.uid() AND status='draft' AND coalesce(amount_paid,0)=0);

CREATE POLICY domain_invoice_items_select ON public.invoice_items FOR SELECT TO authenticated
  USING (private.purplelok_can_access_resource(organization_id,'invoices.read'));
CREATE POLICY domain_invoice_items_insert ON public.invoice_items FOR INSERT TO authenticated
  WITH CHECK (private.purplelok_can_access_resource(organization_id,'invoices.write') AND EXISTS (
    SELECT 1 FROM public.invoices AS parent
    WHERE parent.id=invoice_items.invoice_id
      AND parent.organization_id=invoice_items.organization_id
      AND parent.status='draft'));

CREATE POLICY domain_payments_select ON public.payments FOR SELECT TO authenticated
  USING (private.purplelok_can_access_resource(organization_id,'payments.read'));
CREATE POLICY domain_payments_insert ON public.payments FOR INSERT TO authenticated
  WITH CHECK (private.purplelok_can_access_resource(organization_id,'payments.record') AND EXISTS (
    SELECT 1 FROM public.invoices AS parent
    WHERE parent.id=payments.invoice_id
      AND parent.organization_id=payments.organization_id
      AND parent.client_id=payments.client_id));

CREATE POLICY domain_projects_select ON public.projects FOR SELECT TO authenticated
  USING (private.purplelok_can_access_resource(organization_id,'projects.read'));
CREATE POLICY domain_projects_insert ON public.projects FOR INSERT TO authenticated
  WITH CHECK (private.purplelok_can_reference_members(organization_id,'projects.write',assigned_to)
    AND created_by=auth.uid() AND (
      private.purplelok_can_access_resource(organization_id,'projects.manage') OR
      (coalesce(pg_catalog.cardinality(assigned_to),0)=0 AND status='planning' AND health='on_track')));
CREATE POLICY domain_projects_update ON public.projects FOR UPDATE TO authenticated
  USING (private.purplelok_can_access_resource(organization_id,'projects.write'))
  WITH CHECK (private.purplelok_can_reference_members(organization_id,'projects.write',assigned_to));

CREATE POLICY domain_project_milestones_select ON public.project_milestones FOR SELECT TO authenticated
  USING (private.purplelok_can_access_resource(organization_id,'projects.read'));
CREATE POLICY domain_project_milestones_insert ON public.project_milestones FOR INSERT TO authenticated
  WITH CHECK (private.purplelok_can_access_resource(organization_id,'projects.write'));
CREATE POLICY domain_project_milestones_update ON public.project_milestones FOR UPDATE TO authenticated
  USING (private.purplelok_can_access_resource(organization_id,'projects.write'))
  WITH CHECK (private.purplelok_can_access_resource(organization_id,'projects.write'));

CREATE POLICY domain_tasks_select ON public.tasks FOR SELECT TO authenticated
  USING (private.purplelok_can_access_resource(organization_id,'tasks.read'));
CREATE POLICY domain_tasks_insert ON public.tasks FOR INSERT TO authenticated
  WITH CHECK (private.purplelok_can_reference_members(organization_id,'tasks.write',ARRAY[assigned_to]::uuid[])
    AND created_by=auth.uid());
CREATE POLICY domain_tasks_update ON public.tasks FOR UPDATE TO authenticated
  USING (private.purplelok_can_access_resource(organization_id,'tasks.write'))
  WITH CHECK (private.purplelok_can_reference_members(organization_id,'tasks.write',ARRAY[assigned_to]::uuid[]));

CREATE POLICY domain_task_comments_select ON public.task_comments FOR SELECT TO authenticated
  USING (private.purplelok_can_access_resource(organization_id,'tasks.read'));
CREATE POLICY domain_task_comments_insert ON public.task_comments FOR INSERT TO authenticated
  WITH CHECK (private.purplelok_can_access_resource(organization_id,'tasks.write') AND author_id=auth.uid());

CREATE POLICY domain_meetings_select ON public.meetings FOR SELECT TO authenticated
  USING (private.purplelok_can_access_resource(organization_id,'projects.read'));
CREATE POLICY domain_meetings_insert ON public.meetings FOR INSERT TO authenticated
  WITH CHECK (private.purplelok_can_reference_members(organization_id,'projects.write',ARRAY[assigned_to]::uuid[]));
CREATE POLICY domain_meetings_update ON public.meetings FOR UPDATE TO authenticated
  USING (private.purplelok_can_access_resource(organization_id,'projects.write'))
  WITH CHECK (private.purplelok_can_reference_members(organization_id,'projects.write',ARRAY[assigned_to]::uuid[]));

CREATE POLICY domain_documents_select ON public.documents FOR SELECT TO authenticated
  USING (private.purplelok_can_access_resource(organization_id,'documents.read'));
CREATE POLICY domain_documents_insert ON public.documents FOR INSERT TO authenticated
  WITH CHECK (private.purplelok_can_access_resource(organization_id,'documents.write') AND uploaded_by=auth.uid());
CREATE POLICY domain_documents_update ON public.documents FOR UPDATE TO authenticated
  USING (private.purplelok_can_access_resource(organization_id,'documents.write'))
  WITH CHECK (private.purplelok_can_access_resource(organization_id,'documents.write'));

CREATE POLICY domain_tickets_select ON public.tickets FOR SELECT TO authenticated
  USING (private.purplelok_can_access_resource(organization_id,'tickets.read'));
CREATE POLICY domain_tickets_insert ON public.tickets FOR INSERT TO authenticated
  WITH CHECK (private.purplelok_can_reference_members(organization_id,'tickets.write',ARRAY[assigned_to]::uuid[])
    AND created_by=auth.uid());
CREATE POLICY domain_tickets_update ON public.tickets FOR UPDATE TO authenticated
  USING (private.purplelok_can_access_resource(organization_id,'tickets.write'))
  WITH CHECK (private.purplelok_can_reference_members(organization_id,'tickets.write',ARRAY[assigned_to]::uuid[]));

CREATE POLICY domain_ticket_messages_select ON public.ticket_messages FOR SELECT TO authenticated
  USING (private.purplelok_can_access_resource(organization_id,'tickets.read'));
CREATE POLICY domain_ticket_messages_insert ON public.ticket_messages FOR INSERT TO authenticated
  WITH CHECK (private.purplelok_can_access_resource(organization_id,'tickets.write') AND author_id=auth.uid());

CREATE POLICY domain_activities_select ON public.activities FOR SELECT TO authenticated
  USING (private.purplelok_can_access_resource(organization_id,'activities.read'));

CREATE POLICY domain_notifications_select ON public.notifications FOR SELECT TO authenticated
  USING (private.purplelok_has_active_membership(organization_id) AND user_id=auth.uid());
CREATE POLICY domain_notifications_update ON public.notifications FOR UPDATE TO authenticated
  USING (private.purplelok_has_active_membership(organization_id) AND user_id=auth.uid())
  WITH CHECK (private.purplelok_has_active_membership(organization_id) AND user_id=auth.uid());

CREATE POLICY domain_channels_select ON public.channels FOR SELECT TO authenticated
  USING (private.purplelok_can_access_resource(organization_id,'collaboration.read'));
CREATE POLICY domain_channels_insert ON public.channels FOR INSERT TO authenticated
  WITH CHECK (private.purplelok_can_access_resource(organization_id,'collaboration.manage') AND created_by=auth.uid());
CREATE POLICY domain_channels_update ON public.channels FOR UPDATE TO authenticated
  USING (private.purplelok_can_access_resource(organization_id,'collaboration.manage'))
  WITH CHECK (private.purplelok_can_access_resource(organization_id,'collaboration.manage'));

CREATE POLICY domain_messages_select ON public.messages FOR SELECT TO authenticated
  USING (private.purplelok_can_access_resource(organization_id,'collaboration.read'));
CREATE POLICY domain_messages_insert ON public.messages FOR INSERT TO authenticated
  WITH CHECK (private.purplelok_can_access_resource(organization_id,'collaboration.write') AND author_id=auth.uid());

DO $create_triggers$
DECLARE
  domain_table record;
BEGIN
  FOR domain_table IN SELECT table_name FROM batch_5f_d3_tables LOOP
    EXECUTE pg_catalog.format(
      'CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.purplelok_protect_domain_update()',
      'domain_' || domain_table.table_name || '_protect_update',
      domain_table.table_name
    );
  END LOOP;
END
$create_triggers$;

DO $postconditions$
DECLARE
  policy_manifest_hash text;
BEGIN
  IF (SELECT count(*) FROM pg_catalog.pg_policies AS policy
      JOIN batch_5f_d3_tables AS domain_table ON domain_table.table_name=policy.tablename
      WHERE policy.schemaname='public') <> 52 THEN
    RAISE EXCEPTION 'Batch 5F-D3 postcondition: policy count is not 52';
  END IF;

  IF EXISTS (
    (SELECT table_name, policy_name, command FROM batch_5f_d3_expected_policies
     EXCEPT
     SELECT policy.tablename, policy.policyname, policy.cmd
     FROM pg_catalog.pg_policies AS policy
     JOIN batch_5f_d3_tables AS domain_table ON domain_table.table_name=policy.tablename
     WHERE policy.schemaname='public'
       AND policy.permissive='PERMISSIVE'
       AND policy.roles=ARRAY['authenticated']::name[])
    UNION ALL
    (SELECT policy.tablename, policy.policyname, policy.cmd
     FROM pg_catalog.pg_policies AS policy
     JOIN batch_5f_d3_tables AS domain_table ON domain_table.table_name=policy.tablename
     WHERE policy.schemaname='public'
     EXCEPT
     SELECT table_name, policy_name, command FROM batch_5f_d3_expected_policies)
  ) THEN
    RAISE EXCEPTION 'Batch 5F-D3 postcondition: policy catalogue differs';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM batch_5f_d3_expected_policies AS expected
    JOIN pg_catalog.pg_policies AS policy
      ON policy.schemaname='public'
     AND policy.tablename=expected.table_name
     AND policy.policyname=expected.policy_name
    WHERE expected.permission_key <> ''
      AND CASE expected.command
      WHEN 'SELECT' THEN policy.qual IS NULL OR policy.with_check IS NOT NULL
        OR pg_catalog.strpos(policy.qual,pg_catalog.quote_literal(expected.permission_key))=0
      WHEN 'DELETE' THEN policy.qual IS NULL OR policy.with_check IS NOT NULL
        OR pg_catalog.strpos(policy.qual,pg_catalog.quote_literal(expected.permission_key))=0
      WHEN 'INSERT' THEN policy.qual IS NOT NULL OR policy.with_check IS NULL
        OR pg_catalog.strpos(policy.with_check,pg_catalog.quote_literal(expected.permission_key))=0
      WHEN 'UPDATE' THEN policy.qual IS NULL OR policy.with_check IS NULL
        OR pg_catalog.strpos(policy.qual,pg_catalog.quote_literal(expected.permission_key))=0
        OR pg_catalog.strpos(policy.with_check,pg_catalog.quote_literal(expected.permission_key))=0
      ELSE true
    END
  ) THEN
    RAISE EXCEPTION 'Batch 5F-D3 postcondition: policy permission expressions differ';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM batch_5f_d3_expected_policies AS expected
    JOIN pg_catalog.pg_policies AS policy
      ON policy.schemaname='public'
     AND policy.tablename=expected.table_name
     AND policy.policyname=expected.policy_name
    WHERE expected.command='INSERT'
      AND expected.contract IN (
      'creator','author','uploader','author_parent','draft_creator',
      'creator_member','project_fields'
    )
      AND pg_catalog.strpos(coalesce(policy.qual,'')||coalesce(policy.with_check,''),'auth.uid()')=0
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies AS policy
    WHERE policy.policyname IN ('domain_notifications_select','domain_notifications_update')
      AND (
        pg_catalog.strpos(
          coalesce(policy.qual,'')||coalesce(policy.with_check,''),'auth.uid()')=0
        OR pg_catalog.strpos(
          coalesce(policy.qual,'')||coalesce(policy.with_check,''),
          'purplelok_has_active_membership')=0
      )
  ) THEN
    RAISE EXCEPTION 'Batch 5F-D3 postcondition: identity-bound policy expressions differ';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies AS policy
    JOIN batch_5f_d3_tables AS domain_table ON domain_table.table_name=policy.tablename
    WHERE policy.schemaname='public'
      AND (policy.policyname=policy.tablename||'_'||pg_catalog.lower(policy.cmd)
           OR policy.qual='true' OR policy.with_check='true')
  ) THEN
    RAISE EXCEPTION 'Batch 5F-D3 postcondition: a legacy permissive policy remains';
  END IF;

  IF EXISTS (
    SELECT 1 FROM batch_5f_d3_rls_snapshot AS original
    JOIN pg_catalog.pg_class AS relation ON relation.relname=original.tablename
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid=relation.relnamespace
    WHERE namespace.nspname='public'
      AND (NOT relation.relrowsecurity OR relation.relforcerowsecurity)
  ) THEN
    RAISE EXCEPTION 'Batch 5F-D3 postcondition: domain RLS flags differ';
  END IF;

  IF EXISTS (
    (SELECT relation_id, relacl FROM batch_5f_d3_acl_snapshot
     EXCEPT SELECT relation.oid, relation.relacl FROM pg_catalog.pg_class AS relation
            WHERE relation.oid IN (SELECT relation_id FROM batch_5f_d3_acl_snapshot))
    UNION ALL
    (SELECT relation.oid, relation.relacl FROM pg_catalog.pg_class AS relation
     WHERE relation.oid IN (SELECT relation_id FROM batch_5f_d3_acl_snapshot)
     EXCEPT SELECT relation_id, relacl FROM batch_5f_d3_acl_snapshot)
  ) THEN
    RAISE EXCEPTION 'Batch 5F-D3 postcondition: domain table grants changed';
  END IF;

  IF (SELECT count(*) FROM pg_catalog.pg_trigger AS trigger
      JOIN pg_catalog.pg_class AS relation ON relation.oid=trigger.tgrelid
      JOIN batch_5f_d3_tables AS domain_table ON domain_table.table_name=relation.relname
      WHERE trigger.tgname='domain_'||relation.relname||'_protect_update'
        AND NOT trigger.tgisinternal AND trigger.tgenabled='O'
        AND trigger.tgtype=19
        AND trigger.tgfoid='private.purplelok_protect_domain_update()'::regprocedure) <> 21 THEN
    RAISE EXCEPTION 'Batch 5F-D3 postcondition: update protection triggers differ';
  END IF;

  SELECT pg_catalog.md5(pg_catalog.string_agg(
    pg_catalog.format('%s|%s|%s|%s|%s',table_name,policy_name,command,permission_key,contract),
    E'\n' ORDER BY table_name,policy_name))
  INTO policy_manifest_hash
  FROM batch_5f_d3_expected_policies;

  IF policy_manifest_hash <> 'ce50cde59a1bd0116a593f0db805e1d8' THEN
    RAISE EXCEPTION 'Batch 5F-D3 postcondition: intended policy manifest hash differs';
  END IF;
END
$postconditions$;

COMMIT;
