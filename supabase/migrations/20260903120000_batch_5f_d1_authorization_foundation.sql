/*
# Batch 5F-D1: Centralized normal-session authorization foundation

Adds fail-closed predicates for live normal Auth sessions, active internal
organization membership, capability checks, and same-organization resource
access. Existing domain RLS policies and RBAC mappings are not changed.
*/

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '2min';

-- Preserve the complete domain-policy and RLS catalogue across this migration.
CREATE TEMP TABLE batch_5f_d1_domain_policy_snapshot ON COMMIT DROP AS
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

CREATE TEMP TABLE batch_5f_d1_domain_rls_snapshot ON COMMIT DROP AS
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

DO $preflight$
DECLARE
  dependency_name text;
BEGIN
  IF (SELECT count(*) FROM batch_5f_d1_domain_policy_snapshot) <> 84 THEN
    RAISE EXCEPTION
      'Batch 5F-D1 precondition: expected exactly 84 domain policies';
  END IF;

  IF (SELECT count(*) FROM batch_5f_d1_domain_rls_snapshot) <> 21
     OR EXISTS (
       SELECT 1
       FROM batch_5f_d1_domain_rls_snapshot
       WHERE NOT relrowsecurity OR relforcerowsecurity
     ) THEN
    RAISE EXCEPTION
      'Batch 5F-D1 precondition: domain RLS catalogue differs from the approved baseline';
  END IF;

  FOREACH dependency_name IN ARRAY ARRAY[
    'auth.users',
    'auth.sessions',
    'private.auth_session_gates',
    'public.profiles',
    'public.organizations',
    'public.organization_members',
    'public.permissions',
    'public.organization_roles',
    'public.organization_role_permissions',
    'public.organization_member_roles',
    'public.platform_admins'
  ]
  LOOP
    IF pg_catalog.to_regclass(dependency_name) IS NULL THEN
      RAISE EXCEPTION
        'Batch 5F-D1 precondition: required relation % is missing',
        dependency_name;
    END IF;
  END LOOP;

  IF pg_catalog.to_regprocedure('private.purplelok_custom_access_token_hook(jsonb)') IS NULL
     OR pg_catalog.to_regprocedure('private.purplelok_assert_auth_session_identity(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION
      'Batch 5F-D1 precondition: Batch 5F-C1 session-gate foundation is missing';
  END IF;

  IF pg_catalog.pg_get_userbyid(
       (SELECT namespace.nspowner
        FROM pg_catalog.pg_namespace AS namespace
        WHERE namespace.nspname = 'private')
     ) <> 'postgres'
     OR NOT pg_catalog.has_schema_privilege('authenticated', 'private', 'USAGE')
     OR pg_catalog.has_schema_privilege('authenticated', 'private', 'CREATE')
     OR pg_catalog.has_schema_privilege('anon', 'private', 'USAGE')
     OR pg_catalog.has_schema_privilege('service_role', 'private', 'USAGE') THEN
    RAISE EXCEPTION
      'Batch 5F-D1 precondition: private schema ownership or API-role ACL differs from the approved baseline';
  END IF;

  IF pg_catalog.to_regprocedure('private.purplelok_current_session_id()') IS NOT NULL
     OR pg_catalog.to_regprocedure('private.purplelok_has_normal_session()') IS NOT NULL
     OR pg_catalog.to_regprocedure('private.purplelok_has_active_membership(uuid)') IS NOT NULL
     OR pg_catalog.to_regprocedure('private.purplelok_has_permission(uuid,text)') IS NOT NULL
     OR pg_catalog.to_regprocedure('private.purplelok_can_access_resource(uuid,text)') IS NOT NULL THEN
    RAISE EXCEPTION
      'Batch 5F-D1 precondition: an authorization-foundation function already exists';
  END IF;
END
$preflight$;

CREATE FUNCTION private.purplelok_current_session_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
SET row_security = 'on'
AS $function$
DECLARE
  claims jsonb;
  parsed_session_id uuid;
BEGIN
  BEGIN
    claims := auth.jwt();
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;

  IF pg_catalog.jsonb_typeof(claims) IS DISTINCT FROM 'object'
     OR NOT claims ? 'session_id'
     OR pg_catalog.jsonb_typeof(claims->'session_id') IS DISTINCT FROM 'string'
     OR pg_catalog.btrim(claims->>'session_id') = '' THEN
    RETURN NULL;
  END IF;

  BEGIN
    parsed_session_id := (claims->>'session_id')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN NULL;
  END;

  RETURN parsed_session_id;
END
$function$;

ALTER FUNCTION private.purplelok_current_session_id() OWNER TO postgres;

CREATE FUNCTION private.purplelok_has_normal_session()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
SET row_security = 'off'
AS $function$
DECLARE
  claims jsonb;
  caller_id uuid;
  claimed_subject uuid;
  current_session_id uuid;
BEGIN
  BEGIN
    claims := auth.jwt();
  EXCEPTION WHEN OTHERS THEN
    RETURN false;
  END;

  IF pg_catalog.jsonb_typeof(claims) IS DISTINCT FROM 'object'
     OR NOT claims ? 'role'
     OR pg_catalog.jsonb_typeof(claims->'role') IS DISTINCT FROM 'string'
     OR claims->>'role' <> 'authenticated'
     OR NOT claims ? 'sub'
     OR pg_catalog.jsonb_typeof(claims->'sub') IS DISTINCT FROM 'string'
     OR pg_catalog.btrim(claims->>'sub') = ''
     OR NOT claims ? 'purplelok_session_state'
     OR pg_catalog.jsonb_typeof(claims->'purplelok_session_state') IS DISTINCT FROM 'string'
     OR claims->>'purplelok_session_state' <> 'normal_v1' THEN
    RETURN false;
  END IF;

  BEGIN
    claimed_subject := (claims->>'sub')::uuid;
    caller_id := auth.uid();
  EXCEPTION WHEN OTHERS THEN
    RETURN false;
  END;

  IF caller_id IS NULL OR claimed_subject IS DISTINCT FROM caller_id THEN
    RETURN false;
  END IF;

  current_session_id := private.purplelok_current_session_id();
  IF current_session_id IS NULL THEN
    RETURN false;
  END IF;

  IF (SELECT count(*)
      FROM auth.sessions AS auth_session
      JOIN auth.users AS auth_user
        ON auth_user.id = auth_session.user_id
      WHERE auth_session.id = current_session_id
        AND auth_session.user_id = caller_id
        AND auth_user.id = caller_id
        AND auth_user.deleted_at IS NULL) <> 1 THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM private.auth_session_gates AS gate
    WHERE gate.session_id = current_session_id
  ) THEN
    RETURN false;
  END IF;

  RETURN (
    SELECT count(*) = 1
    FROM public.profiles AS profile
    WHERE profile.id = caller_id
      AND profile.active = true
  );
END
$function$;

ALTER FUNCTION private.purplelok_has_normal_session() OWNER TO postgres;

CREATE FUNCTION private.purplelok_has_active_membership(
  p_organization_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
SET row_security = 'off'
AS $function$
DECLARE
  caller_id uuid;
  membership_id uuid;
  membership_count bigint;
  has_internal_role boolean;
  has_client_role boolean;
BEGIN
  IF p_organization_id IS NULL
     OR NOT private.purplelok_has_normal_session() THEN
    RETURN false;
  END IF;

  BEGIN
    caller_id := auth.uid();
  EXCEPTION WHEN OTHERS THEN
    RETURN false;
  END;

  SELECT count(*), (pg_catalog.array_agg(membership.id))[1]
    INTO membership_count, membership_id
  FROM public.organization_members AS membership
  JOIN public.organizations AS organization
    ON organization.id = membership.organization_id
  WHERE membership.organization_id = p_organization_id
    AND membership.user_id = caller_id
    AND membership.status = 'active'
    AND organization.status = 'active';

  IF membership_count <> 1 OR membership_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT
    coalesce(pg_catalog.bool_or(organization_role.key <> 'client'), false),
    coalesce(pg_catalog.bool_or(organization_role.key = 'client'), false)
    INTO has_internal_role, has_client_role
  FROM public.organization_member_roles AS member_role
  JOIN public.organization_roles AS organization_role
    ON organization_role.id = member_role.organization_role_id
   AND organization_role.organization_id = member_role.organization_id
  WHERE member_role.organization_id = p_organization_id
    AND member_role.organization_member_id = membership_id;

  -- V1 internal authority rejects client-only and mixed Client/internal roles.
  RETURN has_internal_role AND NOT has_client_role;
END
$function$;

ALTER FUNCTION private.purplelok_has_active_membership(uuid) OWNER TO postgres;

CREATE FUNCTION private.purplelok_has_permission(
  p_organization_id uuid,
  p_permission_key text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
SET row_security = 'off'
AS $function$
DECLARE
  caller_id uuid;
BEGIN
  IF p_organization_id IS NULL
     OR p_permission_key IS NULL
     OR pg_catalog.btrim(p_permission_key) = ''
     OR NOT private.purplelok_has_active_membership(p_organization_id) THEN
    RETURN false;
  END IF;

  BEGIN
    caller_id := auth.uid();
  EXCEPTION WHEN OTHERS THEN
    RETURN false;
  END;

  RETURN EXISTS (
    SELECT 1
    FROM public.organization_members AS membership
    JOIN public.organization_member_roles AS member_role
      ON member_role.organization_member_id = membership.id
     AND member_role.organization_id = membership.organization_id
    JOIN public.organization_roles AS organization_role
      ON organization_role.id = member_role.organization_role_id
     AND organization_role.organization_id = member_role.organization_id
    JOIN public.organization_role_permissions AS role_permission
      ON role_permission.organization_role_id = organization_role.id
     AND role_permission.organization_id = organization_role.organization_id
    JOIN public.permissions AS permission
      ON permission.key = role_permission.permission_key
    WHERE membership.organization_id = p_organization_id
      AND membership.user_id = caller_id
      AND membership.status = 'active'
      AND organization_role.key <> 'client'
      AND permission.key = p_permission_key
  );
END
$function$;

ALTER FUNCTION private.purplelok_has_permission(uuid, text) OWNER TO postgres;

CREATE FUNCTION private.purplelok_can_access_resource(
  p_organization_id uuid,
  p_permission_key text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
SET row_security = 'on'
AS $function$
  SELECT private.purplelok_has_permission(p_organization_id, p_permission_key)
$function$;

ALTER FUNCTION private.purplelok_can_access_resource(uuid, text) OWNER TO postgres;

REVOKE ALL ON FUNCTION private.purplelok_current_session_id()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION private.purplelok_has_normal_session()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION private.purplelok_has_active_membership(uuid)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION private.purplelok_has_permission(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION private.purplelok_can_access_resource(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

GRANT EXECUTE ON FUNCTION private.purplelok_has_normal_session()
  TO authenticated;
GRANT EXECUTE ON FUNCTION private.purplelok_has_active_membership(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION private.purplelok_has_permission(uuid, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION private.purplelok_can_access_resource(uuid, text)
  TO authenticated;

COMMENT ON FUNCTION private.purplelok_current_session_id() IS
  'Fail-closed parser for the signed JWT session_id claim; malformed or absent values return NULL.';
COMMENT ON FUNCTION private.purplelok_has_normal_session() IS
  'Authoritative live normal-session predicate: exact JWT identity, auth.sessions ownership, no recovery gate, live Auth user, and active profile.';
COMMENT ON FUNCTION private.purplelok_has_active_membership(uuid) IS
  'Authoritative active internal membership predicate for one active organization; Client-only and mixed Client/internal assignments are denied.';
COMMENT ON FUNCTION private.purplelok_has_permission(uuid, text) IS
  'Capability predicate resolved only through an active same-organization membership, assigned non-Client role, role-permission mapping, and permission catalogue row.';
COMMENT ON FUNCTION private.purplelok_can_access_resource(uuid, text) IS
  'RLS composition helper authorizing a resource organization and required capability through the centralized D1 predicates.';

DO $postconditions$
DECLARE
  function_signature text;
BEGIN
  IF EXISTS (
    (SELECT * FROM batch_5f_d1_domain_policy_snapshot
     EXCEPT
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
       ]))
    UNION ALL
    (SELECT
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
       ])
     EXCEPT
     SELECT * FROM batch_5f_d1_domain_policy_snapshot)
  ) THEN
    RAISE EXCEPTION
      'Batch 5F-D1 postcondition: domain policy catalogue changed';
  END IF;

  IF EXISTS (
    (SELECT * FROM batch_5f_d1_domain_rls_snapshot
     EXCEPT
     SELECT
       namespace.nspname,
       relation.relname,
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
       ]))
    UNION ALL
    (SELECT
       namespace.nspname,
       relation.relname,
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
       ])
     EXCEPT
     SELECT * FROM batch_5f_d1_domain_rls_snapshot)
  ) THEN
    RAISE EXCEPTION
      'Batch 5F-D1 postcondition: domain RLS flags changed';
  END IF;

  FOREACH function_signature IN ARRAY ARRAY[
    'private.purplelok_has_normal_session()',
    'private.purplelok_has_active_membership(uuid)',
    'private.purplelok_has_permission(uuid,text)',
    'private.purplelok_can_access_resource(uuid,text)'
  ]
  LOOP
    IF pg_catalog.to_regprocedure(function_signature) IS NULL
       OR NOT pg_catalog.has_function_privilege(
         'authenticated', function_signature, 'EXECUTE'
       )
       OR pg_catalog.has_function_privilege('anon', function_signature, 'EXECUTE')
       OR pg_catalog.has_function_privilege('service_role', function_signature, 'EXECUTE')
       OR pg_catalog.has_function_privilege(
         'supabase_auth_admin', function_signature, 'EXECUTE'
       ) THEN
      RAISE EXCEPTION
        'Batch 5F-D1 postcondition: function ACL mismatch for %',
        function_signature;
    END IF;
  END LOOP;

  IF pg_catalog.has_function_privilege(
       'authenticated',
       'private.purplelok_current_session_id()',
       'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'anon',
       'private.purplelok_current_session_id()',
       'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'service_role',
       'private.purplelok_current_session_id()',
       'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'supabase_auth_admin',
       'private.purplelok_current_session_id()',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION
      'Batch 5F-D1 postcondition: an API/Auth role can execute the internal session-id parser';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      coalesce(
        procedure.proacl,
        pg_catalog.acldefault('f', procedure.proowner)
      )
    ) AS privilege
    WHERE procedure.oid = ANY (ARRAY[
      'private.purplelok_current_session_id()'::regprocedure,
      'private.purplelok_has_normal_session()'::regprocedure,
      'private.purplelok_has_active_membership(uuid)'::regprocedure,
      'private.purplelok_has_permission(uuid,text)'::regprocedure,
      'private.purplelok_can_access_resource(uuid,text)'::regprocedure
    ]::oid[])
      AND privilege.grantee = 0
      AND privilege.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION
      'Batch 5F-D1 postcondition: PUBLIC can execute an authorization function';
  END IF;
END
$postconditions$;

COMMIT;
