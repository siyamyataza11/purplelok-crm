/*
# Batch 5F-D2: Final permission catalogue and role mappings

Expands the fixed capability catalogue to 32 keys, reconciles the six system
roles to the frozen mapping, and protects canonical system/Client role identity.
Domain RLS policies are intentionally unchanged.
*/

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '2min';

LOCK TABLE
  public.permissions,
  public.organization_roles,
  public.organization_role_permissions,
  public.organization_member_roles,
  public.platform_admins
IN SHARE ROW EXCLUSIVE MODE;

CREATE TEMP TABLE batch_5f_d2_domain_policy_snapshot ON COMMIT DROP AS
SELECT
  policy.schemaname,
  policy.tablename,
  policy.policyname,
  policy.permissive,
  policy.roles,
  policy.cmd,
  policy.qual,
  policy.with_check
FROM pg_catalog.pg_policies AS policy
WHERE policy.schemaname = 'public'
  AND policy.tablename = ANY (ARRAY[
    'clients', 'client_contacts', 'client_notes', 'leads', 'quotes',
    'quote_items', 'invoices', 'invoice_items', 'payments', 'projects',
    'project_milestones', 'tasks', 'task_comments', 'meetings', 'documents',
    'tickets', 'ticket_messages', 'activities', 'notifications', 'channels',
    'messages'
  ]);

CREATE TEMP TABLE batch_5f_d2_domain_rls_snapshot ON COMMIT DROP AS
SELECT
  namespace.nspname AS schemaname,
  relation.relname AS tablename,
  relation.relrowsecurity,
  relation.relforcerowsecurity
FROM pg_catalog.pg_class AS relation
JOIN pg_catalog.pg_namespace AS namespace
  ON namespace.oid = relation.relnamespace
WHERE namespace.nspname = 'public'
  AND relation.relkind = 'r'
  AND relation.relname = ANY (ARRAY[
    'clients', 'client_contacts', 'client_notes', 'leads', 'quotes',
    'quote_items', 'invoices', 'invoice_items', 'payments', 'projects',
    'project_milestones', 'tasks', 'task_comments', 'meetings', 'documents',
    'tickets', 'ticket_messages', 'activities', 'notifications', 'channels',
    'messages'
  ]);

CREATE TEMP TABLE batch_5f_d2_desired_permissions (
  key text PRIMARY KEY,
  description text NOT NULL,
  is_new boolean NOT NULL
) ON COMMIT DROP;

INSERT INTO batch_5f_d2_desired_permissions (key, description, is_new) VALUES
  ('members.read', 'View organization members', false),
  ('members.manage', 'Invite, suspend, remove, and manage organization members', false),
  ('roles.read', 'View organization roles and their permissions', false),
  ('roles.manage', 'Create and manage organization roles and permission mappings', false),
  ('clients.read', 'View clients', false),
  ('clients.write', 'Create and modify clients', false),
  ('leads.read', 'View leads', false),
  ('leads.write', 'Create and modify leads', false),
  ('projects.read', 'View projects', false),
  ('projects.write', 'Create and modify project content', false),
  ('projects.manage', 'Manage project lifecycle and assignments', false),
  ('tasks.read', 'View tasks', false),
  ('tasks.write', 'Create and modify tasks', false),
  ('quotes.read', 'View quotes', false),
  ('quotes.write', 'Create and modify quotes', false),
  ('quotes.approve', 'Approve and accept quotes', false),
  ('invoices.read', 'View invoices', false),
  ('invoices.write', 'Create and modify invoices', false),
  ('invoices.approve', 'Approve and issue invoices', false),
  ('payments.read', 'View payments', false),
  ('payments.record', 'Record payments', false),
  ('documents.read', 'View documents', false),
  ('documents.write', 'Upload and manage documents', false),
  ('tickets.read', 'View support tickets', false),
  ('tickets.write', 'Create and modify support tickets', false),
  ('reports.read', 'View reports and analytics', false),
  ('settings.read', 'View organization settings', false),
  ('settings.manage', 'Manage organization settings', false),
  ('activities.read', 'View organization activity history', true),
  ('collaboration.read', 'Read organization channels and messages', true),
  ('collaboration.write', 'Send messages to organization channels', true),
  ('collaboration.manage', 'Create and manage organization channels', true);

CREATE TEMP TABLE batch_5f_d2_desired_role_permissions (
  role_key text NOT NULL,
  permission_key text NOT NULL,
  PRIMARY KEY (role_key, permission_key)
) ON COMMIT DROP;

INSERT INTO batch_5f_d2_desired_role_permissions (role_key, permission_key)
SELECT desired.role_key, expanded.permission_key
FROM (
  VALUES
    ('owner', ARRAY(SELECT key FROM batch_5f_d2_desired_permissions ORDER BY key)),
    ('admin', ARRAY(SELECT key FROM batch_5f_d2_desired_permissions ORDER BY key)),
    ('finance', ARRAY[
      'clients.read', 'projects.read', 'quotes.read', 'quotes.write',
      'quotes.approve', 'invoices.read', 'invoices.write', 'invoices.approve',
      'payments.read', 'payments.record', 'documents.read', 'reports.read',
      'settings.read', 'members.read', 'collaboration.read', 'collaboration.write'
    ]::text[]),
    ('project_manager', ARRAY[
      'clients.read', 'projects.read', 'projects.write', 'projects.manage',
      'tasks.read', 'tasks.write', 'documents.read', 'documents.write',
      'tickets.read', 'tickets.write', 'reports.read', 'settings.read',
      'members.read', 'collaboration.read', 'collaboration.write'
    ]::text[]),
    ('staff', ARRAY[
      'clients.read', 'projects.read', 'tasks.read', 'tasks.write',
      'documents.read', 'documents.write', 'tickets.read', 'tickets.write',
      'settings.read', 'members.read', 'collaboration.read', 'collaboration.write'
    ]::text[]),
    ('client', ARRAY[
      'projects.read', 'documents.read', 'quotes.read', 'invoices.read',
      'tickets.read', 'tickets.write'
    ]::text[])
) AS desired(role_key, permission_keys)
CROSS JOIN LATERAL pg_catalog.unnest(desired.permission_keys)
  AS expanded(permission_key);

DO $preflight$
DECLARE
  policy_count integer;
  policy_hash text;
BEGIN
  SELECT
    count(*)::integer,
    pg_catalog.md5(pg_catalog.string_agg(
      pg_catalog.format(
        '%s|%s|%s|%s|%s|%s|%s',
        policy.schemaname,
        policy.tablename,
        policy.policyname,
        policy.permissive,
        policy.roles::text,
        policy.cmd,
        coalesce(policy.qual, '') || '|' || coalesce(policy.with_check, '')
      ),
      E'\n' ORDER BY policy.schemaname, policy.tablename, policy.policyname
    ))
    INTO policy_count, policy_hash
  FROM pg_catalog.pg_policies AS policy
  WHERE policy.schemaname = 'public'
    AND policy.tablename = ANY (ARRAY[
      'clients', 'client_contacts', 'client_notes', 'leads', 'quotes',
      'quote_items', 'invoices', 'invoice_items', 'payments', 'projects',
      'project_milestones', 'tasks', 'task_comments', 'meetings', 'documents',
      'tickets', 'ticket_messages', 'activities', 'notifications', 'channels',
      'messages'
    ]);

  IF policy_count <> 84
     OR policy_hash <> 'eb744436bf76a7cc18e32b06734b5478' THEN
    RAISE EXCEPTION
      'Batch 5F-D2 precondition: domain policy baseline differs from the approved catalogue';
  END IF;

  IF (SELECT count(*) FROM batch_5f_d2_domain_rls_snapshot) <> 21
     OR EXISTS (
       SELECT 1 FROM batch_5f_d2_domain_rls_snapshot
       WHERE NOT relrowsecurity OR relforcerowsecurity
     ) THEN
    RAISE EXCEPTION
      'Batch 5F-D2 precondition: domain RLS flags differ from the approved baseline';
  END IF;

  IF EXISTS (
    (SELECT permission.key FROM public.permissions AS permission
     EXCEPT
     SELECT desired.key FROM batch_5f_d2_desired_permissions AS desired
     WHERE NOT desired.is_new)
    UNION ALL
    (SELECT desired.key FROM batch_5f_d2_desired_permissions AS desired
     WHERE NOT desired.is_new
     EXCEPT
     SELECT permission.key FROM public.permissions AS permission)
  ) OR EXISTS (
    SELECT 1
    FROM public.permissions AS permission
    JOIN batch_5f_d2_desired_permissions AS desired ON desired.key = permission.key
    WHERE desired.is_new
  ) THEN
    RAISE EXCEPTION
      'Batch 5F-D2 precondition: permission catalogue is not the exact 28-key baseline';
  END IF;

  IF EXISTS (
    SELECT organization.id
    FROM public.organizations AS organization
    LEFT JOIN public.organization_roles AS role
      ON role.organization_id = organization.id
    GROUP BY organization.id
    HAVING count(*) FILTER (WHERE role.is_system) <> 6
       OR count(*) FILTER (
         WHERE role.is_system
           AND role.key = ANY (ARRAY[
             'owner', 'admin', 'finance', 'project_manager', 'staff', 'client'
           ])
       ) <> 6
  ) THEN
    RAISE EXCEPTION
      'Batch 5F-D2 precondition: an organization lacks the exact six canonical system roles';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.organization_member_roles AS member_role
    JOIN public.organization_roles AS role
      ON role.id = member_role.organization_role_id
     AND role.organization_id = member_role.organization_id
    WHERE role.key = 'client'
  ) THEN
    RAISE EXCEPTION
      'Batch 5F-D2 precondition: Client role assignments must be empty';
  END IF;

  IF EXISTS (SELECT 1 FROM public.platform_admins) THEN
    RAISE EXCEPTION
      'Batch 5F-D2 precondition: platform administrators must remain dormant';
  END IF;

  IF pg_catalog.to_regprocedure('private.purplelok_has_permission(uuid,text)') IS NULL
     OR pg_catalog.to_regprocedure('private.purplelok_has_active_membership(uuid)') IS NULL THEN
    RAISE EXCEPTION
      'Batch 5F-D2 precondition: Batch 5F-D1 authorization predicates are missing';
  END IF;

  IF pg_catalog.to_regprocedure('private.purplelok_protect_system_role_identity()') IS NOT NULL
     OR pg_catalog.to_regprocedure('private.purplelok_reject_client_role_assignment()') IS NOT NULL
     OR pg_catalog.to_regprocedure('private.purplelok_restrict_client_permissions()') IS NOT NULL THEN
    RAISE EXCEPTION
      'Batch 5F-D2 precondition: a D2 protection function already exists';
  END IF;
END
$preflight$;

INSERT INTO public.permissions (key, description)
SELECT desired.key, desired.description
FROM batch_5f_d2_desired_permissions AS desired
WHERE desired.is_new
ORDER BY desired.key;

DELETE FROM public.organization_role_permissions AS role_permission
USING public.organization_roles AS role
WHERE role.id = role_permission.organization_role_id
  AND role.organization_id = role_permission.organization_id
  AND role.is_system
  AND role.key = ANY (ARRAY[
    'owner', 'admin', 'finance', 'project_manager', 'staff', 'client'
  ])
  AND NOT EXISTS (
    SELECT 1
    FROM batch_5f_d2_desired_role_permissions AS desired
    WHERE desired.role_key = role.key
      AND desired.permission_key = role_permission.permission_key
  );

INSERT INTO public.organization_role_permissions (
  organization_id,
  organization_role_id,
  permission_key
)
SELECT role.organization_id, role.id, desired.permission_key
FROM public.organization_roles AS role
JOIN batch_5f_d2_desired_role_permissions AS desired
  ON desired.role_key = role.key
WHERE role.is_system
  AND NOT EXISTS (
    SELECT 1
    FROM public.organization_role_permissions AS existing
    WHERE existing.organization_id = role.organization_id
      AND existing.organization_role_id = role.id
      AND existing.permission_key = desired.permission_key
  )
ORDER BY role.organization_id, role.id, desired.permission_key;

CREATE FUNCTION private.purplelok_protect_system_role_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = 'off'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.is_system
       AND NEW.key <> ALL (ARRAY[
         'owner', 'admin', 'finance', 'project_manager', 'staff', 'client'
       ]) THEN
      RAISE EXCEPTION USING
        ERRCODE = '42501',
        MESSAGE = 'Unrecognized system role key';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.is_system THEN
    IF TG_OP = 'DELETE' THEN
      -- Preserve the existing organization -> role ON DELETE CASCADE while
      -- rejecting direct deletion of a canonical role from a live tenant.
      IF EXISTS (
        SELECT 1
        FROM public.organizations AS organization
        WHERE organization.id = OLD.organization_id
      ) THEN
        RAISE EXCEPTION USING
          ERRCODE = '42501',
          MESSAGE = 'System roles cannot be deleted';
      END IF;
      RETURN OLD;
    END IF;

    IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
       OR NEW.key IS DISTINCT FROM OLD.key
       OR NEW.is_system IS DISTINCT FROM true THEN
      RAISE EXCEPTION USING
        ERRCODE = '42501',
        MESSAGE = 'System role identity is immutable';
    END IF;
  ELSIF TG_OP = 'UPDATE'
        AND NEW.is_system
        AND NEW.key <> ALL (ARRAY[
          'owner', 'admin', 'finance', 'project_manager', 'staff', 'client'
        ]) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Unrecognized system role key';
  END IF;

  RETURN NEW;
END
$function$;

ALTER FUNCTION private.purplelok_protect_system_role_identity() OWNER TO postgres;

CREATE FUNCTION private.purplelok_reject_client_role_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = 'off'
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.organization_roles AS role
    WHERE role.id = NEW.organization_role_id
      AND role.organization_id = NEW.organization_id
      AND role.key = 'client'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Client role assignment is disabled until client-scoped authorization exists';
  END IF;

  RETURN NEW;
END
$function$;

ALTER FUNCTION private.purplelok_reject_client_role_assignment() OWNER TO postgres;

CREATE FUNCTION private.purplelok_restrict_client_permissions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = 'off'
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.organization_roles AS role
    WHERE role.id = NEW.organization_role_id
      AND role.organization_id = NEW.organization_id
      AND role.key = 'client'
  ) AND NEW.permission_key <> ALL (ARRAY[
    'projects.read', 'documents.read', 'quotes.read', 'invoices.read',
    'tickets.read', 'tickets.write'
  ]) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Client role cannot receive internal permissions';
  END IF;

  RETURN NEW;
END
$function$;

ALTER FUNCTION private.purplelok_restrict_client_permissions() OWNER TO postgres;

REVOKE ALL ON FUNCTION private.purplelok_protect_system_role_identity()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION private.purplelok_reject_client_role_assignment()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION private.purplelok_restrict_client_permissions()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE TRIGGER organization_roles_protect_system_identity
BEFORE INSERT OR UPDATE OR DELETE ON public.organization_roles
FOR EACH ROW
EXECUTE FUNCTION private.purplelok_protect_system_role_identity();

CREATE TRIGGER organization_member_roles_reject_client
BEFORE INSERT OR UPDATE ON public.organization_member_roles
FOR EACH ROW
EXECUTE FUNCTION private.purplelok_reject_client_role_assignment();

CREATE TRIGGER organization_role_permissions_restrict_client
BEFORE INSERT OR UPDATE ON public.organization_role_permissions
FOR EACH ROW
EXECUTE FUNCTION private.purplelok_restrict_client_permissions();

DO $postconditions$
DECLARE
  policy_count integer;
  policy_hash text;
BEGIN
  IF EXISTS (
    (SELECT key FROM public.permissions
     EXCEPT SELECT key FROM batch_5f_d2_desired_permissions)
    UNION ALL
    (SELECT key FROM batch_5f_d2_desired_permissions
     EXCEPT SELECT key FROM public.permissions)
  ) OR (SELECT count(*) FROM public.permissions) <> 32 THEN
    RAISE EXCEPTION
      'Batch 5F-D2 postcondition: permission catalogue is not the exact 32-key set';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.organization_roles AS role
    WHERE role.is_system
      AND role.key = ANY (ARRAY[
        'owner', 'admin', 'finance', 'project_manager', 'staff', 'client'
      ])
      AND EXISTS (
        (SELECT role_permission.permission_key
         FROM public.organization_role_permissions AS role_permission
         WHERE role_permission.organization_id = role.organization_id
           AND role_permission.organization_role_id = role.id
         EXCEPT
         SELECT desired.permission_key
         FROM batch_5f_d2_desired_role_permissions AS desired
         WHERE desired.role_key = role.key)
        UNION ALL
        (SELECT desired.permission_key
         FROM batch_5f_d2_desired_role_permissions AS desired
         WHERE desired.role_key = role.key
         EXCEPT
         SELECT role_permission.permission_key
         FROM public.organization_role_permissions AS role_permission
         WHERE role_permission.organization_id = role.organization_id
           AND role_permission.organization_role_id = role.id)
      )
  ) THEN
    RAISE EXCEPTION
      'Batch 5F-D2 postcondition: a system role mapping differs from the frozen matrix';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.organization_member_roles AS member_role
    JOIN public.organization_roles AS role
      ON role.id = member_role.organization_role_id
     AND role.organization_id = member_role.organization_id
    WHERE role.key = 'client'
  ) THEN
    RAISE EXCEPTION
      'Batch 5F-D2 postcondition: Client role assignment exists';
  END IF;

  IF EXISTS (SELECT 1 FROM public.platform_admins) THEN
    RAISE EXCEPTION
      'Batch 5F-D2 postcondition: platform administrator state changed';
  END IF;

  IF EXISTS (
    (SELECT * FROM batch_5f_d2_domain_policy_snapshot
     EXCEPT
     SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
     FROM pg_catalog.pg_policies
     WHERE schemaname = 'public'
       AND tablename = ANY (ARRAY[
         'clients', 'client_contacts', 'client_notes', 'leads', 'quotes',
         'quote_items', 'invoices', 'invoice_items', 'payments', 'projects',
         'project_milestones', 'tasks', 'task_comments', 'meetings', 'documents',
         'tickets', 'ticket_messages', 'activities', 'notifications', 'channels',
         'messages'
       ]))
    UNION ALL
    (SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
     FROM pg_catalog.pg_policies
     WHERE schemaname = 'public'
       AND tablename = ANY (ARRAY[
         'clients', 'client_contacts', 'client_notes', 'leads', 'quotes',
         'quote_items', 'invoices', 'invoice_items', 'payments', 'projects',
         'project_milestones', 'tasks', 'task_comments', 'meetings', 'documents',
         'tickets', 'ticket_messages', 'activities', 'notifications', 'channels',
         'messages'
       ])
     EXCEPT SELECT * FROM batch_5f_d2_domain_policy_snapshot)
  ) THEN
    RAISE EXCEPTION
      'Batch 5F-D2 postcondition: domain policy catalogue changed';
  END IF;

  IF EXISTS (
    (SELECT * FROM batch_5f_d2_domain_rls_snapshot
     EXCEPT
     SELECT namespace.nspname, relation.relname,
            relation.relrowsecurity, relation.relforcerowsecurity
     FROM pg_catalog.pg_class AS relation
     JOIN pg_catalog.pg_namespace AS namespace
       ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'public'
       AND relation.relkind = 'r'
       AND relation.relname = ANY (ARRAY[
         'clients', 'client_contacts', 'client_notes', 'leads', 'quotes',
         'quote_items', 'invoices', 'invoice_items', 'payments', 'projects',
         'project_milestones', 'tasks', 'task_comments', 'meetings', 'documents',
         'tickets', 'ticket_messages', 'activities', 'notifications', 'channels',
         'messages'
       ]))
    UNION ALL
    (SELECT namespace.nspname, relation.relname,
            relation.relrowsecurity, relation.relforcerowsecurity
     FROM pg_catalog.pg_class AS relation
     JOIN pg_catalog.pg_namespace AS namespace
       ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'public'
       AND relation.relkind = 'r'
       AND relation.relname = ANY (ARRAY[
         'clients', 'client_contacts', 'client_notes', 'leads', 'quotes',
         'quote_items', 'invoices', 'invoice_items', 'payments', 'projects',
         'project_milestones', 'tasks', 'task_comments', 'meetings', 'documents',
         'tickets', 'ticket_messages', 'activities', 'notifications', 'channels',
         'messages'
       ])
     EXCEPT SELECT * FROM batch_5f_d2_domain_rls_snapshot)
  ) THEN
    RAISE EXCEPTION
      'Batch 5F-D2 postcondition: domain RLS flags changed';
  END IF;

  SELECT
    count(*)::integer,
    pg_catalog.md5(pg_catalog.string_agg(
      pg_catalog.format(
        '%s|%s|%s|%s|%s|%s|%s',
        policy.schemaname,
        policy.tablename,
        policy.policyname,
        policy.permissive,
        policy.roles::text,
        policy.cmd,
        coalesce(policy.qual, '') || '|' || coalesce(policy.with_check, '')
      ),
      E'\n' ORDER BY policy.schemaname, policy.tablename, policy.policyname
    ))
    INTO policy_count, policy_hash
  FROM pg_catalog.pg_policies AS policy
  WHERE policy.schemaname = 'public'
    AND policy.tablename = ANY (ARRAY[
      'clients', 'client_contacts', 'client_notes', 'leads', 'quotes',
      'quote_items', 'invoices', 'invoice_items', 'payments', 'projects',
      'project_milestones', 'tasks', 'task_comments', 'meetings', 'documents',
      'tickets', 'ticket_messages', 'activities', 'notifications', 'channels',
      'messages'
    ]);

  IF policy_count <> 84
     OR policy_hash <> 'eb744436bf76a7cc18e32b06734b5478' THEN
    RAISE EXCEPTION
      'Batch 5F-D2 postcondition: canonical domain policy fingerprint changed';
  END IF;

  IF (SELECT count(*)
      FROM (
        VALUES
          ('organization_roles_protect_system_identity', 'organization_roles',
           'private', 'purplelok_protect_system_role_identity', 31::smallint),
          ('organization_member_roles_reject_client', 'organization_member_roles',
           'private', 'purplelok_reject_client_role_assignment', 23::smallint),
          ('organization_role_permissions_restrict_client', 'organization_role_permissions',
           'private', 'purplelok_restrict_client_permissions', 23::smallint)
      ) AS expected(trigger_name, table_name, function_schema, function_name, trigger_type)
      JOIN pg_catalog.pg_trigger AS trigger
        ON trigger.tgname = expected.trigger_name
       AND NOT trigger.tgisinternal
       AND trigger.tgenabled = 'O'
       AND trigger.tgtype = expected.trigger_type
      JOIN pg_catalog.pg_class AS relation
        ON relation.oid = trigger.tgrelid
       AND relation.relname = expected.table_name
      JOIN pg_catalog.pg_namespace AS table_namespace
        ON table_namespace.oid = relation.relnamespace
       AND table_namespace.nspname = 'public'
      JOIN pg_catalog.pg_proc AS procedure
        ON procedure.oid = trigger.tgfoid
       AND procedure.proname = expected.function_name
      JOIN pg_catalog.pg_namespace AS function_namespace
        ON function_namespace.oid = procedure.pronamespace
       AND function_namespace.nspname = expected.function_schema) <> 3
     OR (SELECT count(*)
         FROM pg_catalog.pg_trigger
         WHERE tgname = ANY (ARRAY[
           'organization_roles_protect_system_identity',
           'organization_member_roles_reject_client',
           'organization_role_permissions_restrict_client'
         ])) <> 3 THEN
    RAISE EXCEPTION
      'Batch 5F-D2 postcondition: protection trigger catalogue mismatch';
  END IF;

  IF (SELECT count(*)
      FROM pg_catalog.pg_proc AS procedure
      WHERE procedure.oid = ANY (ARRAY[
        'private.purplelok_protect_system_role_identity()'::regprocedure,
        'private.purplelok_reject_client_role_assignment()'::regprocedure,
        'private.purplelok_restrict_client_permissions()'::regprocedure
      ])
        AND procedure.prosecdef
        AND procedure.provolatile = 'v'
        AND pg_catalog.pg_get_userbyid(procedure.proowner) = 'postgres'
        AND procedure.proconfig @> ARRAY[
          'search_path=""',
          'row_security=off'
        ]::text[]) <> 3
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.pg_proc AS procedure
       CROSS JOIN LATERAL pg_catalog.aclexplode(
         coalesce(
           procedure.proacl,
           pg_catalog.acldefault('f', procedure.proowner)
         )
       ) AS privilege
       WHERE procedure.oid = ANY (ARRAY[
         'private.purplelok_protect_system_role_identity()'::regprocedure,
         'private.purplelok_reject_client_role_assignment()'::regprocedure,
         'private.purplelok_restrict_client_permissions()'::regprocedure
       ])
         AND privilege.privilege_type = 'EXECUTE'
         AND privilege.grantee = ANY (ARRAY[
           0::oid,
           'anon'::regrole::oid,
           'authenticated'::regrole::oid,
           'service_role'::regrole::oid,
           'supabase_auth_admin'::regrole::oid
         ])
     ) THEN
    RAISE EXCEPTION
      'Batch 5F-D2 postcondition: protection function security mismatch';
  END IF;
END
$postconditions$;

COMMIT;
