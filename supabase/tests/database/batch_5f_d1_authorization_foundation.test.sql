BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(83);

CREATE TEMP TABLE batch_5f_d1_rbac_snapshot AS
SELECT jsonb_build_object(
  'permissions', (SELECT count(*) FROM public.permissions),
  'organizations', (SELECT count(*) FROM public.organizations),
  'memberships', (SELECT count(*) FROM public.organization_members),
  'roles', (SELECT count(*) FROM public.organization_roles),
  'role_permissions', (SELECT count(*) FROM public.organization_role_permissions),
  'member_roles', (SELECT count(*) FROM public.organization_member_roles),
  'platform_admins', (SELECT count(*) FROM public.platform_admins)
) AS counts;

CREATE FUNCTION pg_temp.batch_5f_d1_set_claims(
  p_auth_uid text,
  p_subject text,
  p_session_id text,
  p_role text,
  p_state text
)
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
  claims jsonb := '{}'::jsonb;
BEGIN
  IF p_subject IS NOT NULL THEN
    claims := pg_catalog.jsonb_set(
      claims, '{sub}', pg_catalog.to_jsonb(p_subject), true
    );
  END IF;
  IF p_session_id IS NOT NULL THEN
    claims := pg_catalog.jsonb_set(
      claims, '{session_id}', pg_catalog.to_jsonb(p_session_id), true
    );
  END IF;
  IF p_role IS NOT NULL THEN
    claims := pg_catalog.jsonb_set(
      claims, '{role}', pg_catalog.to_jsonb(p_role), true
    );
  END IF;
  IF p_state IS NOT NULL THEN
    claims := pg_catalog.jsonb_set(
      claims,
      '{purplelok_session_state}',
      pg_catalog.to_jsonb(p_state),
      true
    );
  END IF;

  PERFORM pg_catalog.set_config(
    'request.jwt.claim.sub', coalesce(p_auth_uid, ''), true
  );
  PERFORM pg_catalog.set_config('request.jwt.claims', claims::text, true);
END
$function$;

-- Transaction-only identities are created through the existing Auth trigger,
-- which also creates their public profiles.
INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES
  ('00000000-0000-0000-0000-00000005d201', 'd1-valid@example.test', '{}'::jsonb),
  ('00000000-0000-0000-0000-00000005d202', 'd1-other@example.test', '{}'::jsonb),
  ('00000000-0000-0000-0000-00000005d203', 'd1-inactive-profile@example.test', '{}'::jsonb),
  ('00000000-0000-0000-0000-00000005d204', 'd1-missing-profile@example.test', '{}'::jsonb),
  ('00000000-0000-0000-0000-00000005d205', 'd1-deleted-user@example.test', '{}'::jsonb),
  ('00000000-0000-0000-0000-00000005d206', 'd1-client@example.test', '{}'::jsonb),
  ('00000000-0000-0000-0000-00000005d207', 'd1-suspended@example.test', '{}'::jsonb),
  ('00000000-0000-0000-0000-00000005d208', 'd1-removed@example.test', '{}'::jsonb),
  ('00000000-0000-0000-0000-00000005d209', 'd1-inactive-org@example.test', '{}'::jsonb),
  ('00000000-0000-0000-0000-00000005d210', 'd1-roleless@example.test', '{}'::jsonb),
  ('00000000-0000-0000-0000-00000005d211', 'd1-no-membership@example.test', '{}'::jsonb),
  ('00000000-0000-0000-0000-00000005d212', 'd1-mixed-client@example.test', '{}'::jsonb),
  ('00000000-0000-0000-0000-00000005d213', 'd1-invited@example.test', '{}'::jsonb),
  ('00000000-0000-0000-0000-00000005d214', 'd1-stale-session@example.test', '{}'::jsonb),
  ('00000000-0000-0000-0000-00000005d215', 'd1-owner@example.test', '{}'::jsonb),
  ('00000000-0000-0000-0000-00000005d216', 'd1-archived-org@example.test', '{}'::jsonb);

UPDATE public.profiles
SET active = false
WHERE id = '00000000-0000-0000-0000-00000005d203';

DELETE FROM public.profiles
WHERE id = '00000000-0000-0000-0000-00000005d204';

UPDATE auth.users
SET deleted_at = pg_catalog.clock_timestamp()
WHERE id = '00000000-0000-0000-0000-00000005d205';

INSERT INTO auth.sessions (id, user_id)
VALUES
  ('00000000-0000-0000-0000-00000005d301', '00000000-0000-0000-0000-00000005d201'),
  ('00000000-0000-0000-0000-00000005d302', '00000000-0000-0000-0000-00000005d202'),
  ('00000000-0000-0000-0000-00000005d303', '00000000-0000-0000-0000-00000005d203'),
  ('00000000-0000-0000-0000-00000005d304', '00000000-0000-0000-0000-00000005d204'),
  ('00000000-0000-0000-0000-00000005d305', '00000000-0000-0000-0000-00000005d205'),
  ('00000000-0000-0000-0000-00000005d306', '00000000-0000-0000-0000-00000005d206'),
  ('00000000-0000-0000-0000-00000005d307', '00000000-0000-0000-0000-00000005d207'),
  ('00000000-0000-0000-0000-00000005d308', '00000000-0000-0000-0000-00000005d208'),
  ('00000000-0000-0000-0000-00000005d309', '00000000-0000-0000-0000-00000005d209'),
  ('00000000-0000-0000-0000-00000005d310', '00000000-0000-0000-0000-00000005d210'),
  ('00000000-0000-0000-0000-00000005d311', '00000000-0000-0000-0000-00000005d211'),
  ('00000000-0000-0000-0000-00000005d312', '00000000-0000-0000-0000-00000005d212'),
  ('00000000-0000-0000-0000-00000005d313', '00000000-0000-0000-0000-00000005d213'),
  ('00000000-0000-0000-0000-00000005d314', '00000000-0000-0000-0000-00000005d214'),
  ('00000000-0000-0000-0000-00000005d315', '00000000-0000-0000-0000-00000005d215'),
  ('00000000-0000-0000-0000-00000005d316', '00000000-0000-0000-0000-00000005d216');

INSERT INTO public.organizations (id, name, slug, status)
VALUES
  ('00000000-0000-0000-0000-00000005d101', 'D1 Active A', 'd1-active-a', 'active'),
  ('00000000-0000-0000-0000-00000005d102', 'D1 Active B', 'd1-active-b', 'active'),
  ('00000000-0000-0000-0000-00000005d103', 'D1 Inactive', 'd1-inactive', 'suspended'),
  ('00000000-0000-0000-0000-00000005d104', 'D1 Archived', 'd1-archived', 'archived');

INSERT INTO public.organization_members (
  id, organization_id, user_id, status
)
VALUES
  ('00000000-0000-0000-0000-00000005d501', '00000000-0000-0000-0000-00000005d101', '00000000-0000-0000-0000-00000005d201', 'active'),
  ('00000000-0000-0000-0000-00000005d502', '00000000-0000-0000-0000-00000005d102', '00000000-0000-0000-0000-00000005d202', 'active'),
  ('00000000-0000-0000-0000-00000005d506', '00000000-0000-0000-0000-00000005d101', '00000000-0000-0000-0000-00000005d206', 'active'),
  ('00000000-0000-0000-0000-00000005d507', '00000000-0000-0000-0000-00000005d101', '00000000-0000-0000-0000-00000005d207', 'suspended'),
  ('00000000-0000-0000-0000-00000005d508', '00000000-0000-0000-0000-00000005d101', '00000000-0000-0000-0000-00000005d208', 'removed'),
  ('00000000-0000-0000-0000-00000005d509', '00000000-0000-0000-0000-00000005d103', '00000000-0000-0000-0000-00000005d209', 'active'),
  ('00000000-0000-0000-0000-00000005d510', '00000000-0000-0000-0000-00000005d101', '00000000-0000-0000-0000-00000005d210', 'active'),
  ('00000000-0000-0000-0000-00000005d512', '00000000-0000-0000-0000-00000005d101', '00000000-0000-0000-0000-00000005d212', 'active'),
  ('00000000-0000-0000-0000-00000005d513', '00000000-0000-0000-0000-00000005d101', '00000000-0000-0000-0000-00000005d213', 'invited'),
  ('00000000-0000-0000-0000-00000005d514', '00000000-0000-0000-0000-00000005d101', '00000000-0000-0000-0000-00000005d215', 'active'),
  ('00000000-0000-0000-0000-00000005d515', '00000000-0000-0000-0000-00000005d104', '00000000-0000-0000-0000-00000005d216', 'active');

INSERT INTO public.organization_roles (
  id, organization_id, name, key, is_system
)
VALUES
  ('00000000-0000-0000-0000-00000005d401', '00000000-0000-0000-0000-00000005d101', 'D1 Staff', 'staff', true),
  ('00000000-0000-0000-0000-00000005d402', '00000000-0000-0000-0000-00000005d101', 'D1 Client', 'client', true),
  ('00000000-0000-0000-0000-00000005d403', '00000000-0000-0000-0000-00000005d101', 'D1 Limited', 'limited', false),
  ('00000000-0000-0000-0000-00000005d404', '00000000-0000-0000-0000-00000005d102', 'D1 Other Staff', 'staff', true),
  ('00000000-0000-0000-0000-00000005d405', '00000000-0000-0000-0000-00000005d103', 'D1 Inactive Staff', 'staff', true),
  ('00000000-0000-0000-0000-00000005d406', '00000000-0000-0000-0000-00000005d101', 'D1 Owner', 'owner', true),
  ('00000000-0000-0000-0000-00000005d407', '00000000-0000-0000-0000-00000005d104', 'D1 Archived Staff', 'staff', true);

-- When this historical D1 suite is rerun after D2, create its intentionally
-- invalid Client fixtures under postgres with only the two D2 Client guards
-- transaction-locally suppressed. The guards are restored immediately below;
-- the complete test transaction is always rolled back.
DO $d2_fixture_guards$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'public.organization_role_permissions'::regclass
      AND tgname = 'organization_role_permissions_restrict_client'
      AND NOT tgisinternal
  ) THEN
    EXECUTE 'ALTER TABLE public.organization_role_permissions DISABLE TRIGGER organization_role_permissions_restrict_client';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'public.organization_member_roles'::regclass
      AND tgname = 'organization_member_roles_reject_client'
      AND NOT tgisinternal
  ) THEN
    EXECUTE 'ALTER TABLE public.organization_member_roles DISABLE TRIGGER organization_member_roles_reject_client';
  END IF;
END
$d2_fixture_guards$;

INSERT INTO public.organization_role_permissions (
  organization_id, organization_role_id, permission_key
)
VALUES
  ('00000000-0000-0000-0000-00000005d101', '00000000-0000-0000-0000-00000005d401', 'clients.read'),
  ('00000000-0000-0000-0000-00000005d101', '00000000-0000-0000-0000-00000005d402', 'clients.read'),
  ('00000000-0000-0000-0000-00000005d102', '00000000-0000-0000-0000-00000005d404', 'clients.read'),
  ('00000000-0000-0000-0000-00000005d103', '00000000-0000-0000-0000-00000005d405', 'clients.read'),
  ('00000000-0000-0000-0000-00000005d101', '00000000-0000-0000-0000-00000005d406', 'clients.read'),
  ('00000000-0000-0000-0000-00000005d104', '00000000-0000-0000-0000-00000005d407', 'clients.read');

INSERT INTO public.organization_member_roles (
  organization_id, organization_member_id, organization_role_id
)
VALUES
  ('00000000-0000-0000-0000-00000005d101', '00000000-0000-0000-0000-00000005d501', '00000000-0000-0000-0000-00000005d401'),
  ('00000000-0000-0000-0000-00000005d102', '00000000-0000-0000-0000-00000005d502', '00000000-0000-0000-0000-00000005d404'),
  ('00000000-0000-0000-0000-00000005d101', '00000000-0000-0000-0000-00000005d506', '00000000-0000-0000-0000-00000005d402'),
  ('00000000-0000-0000-0000-00000005d101', '00000000-0000-0000-0000-00000005d507', '00000000-0000-0000-0000-00000005d401'),
  ('00000000-0000-0000-0000-00000005d101', '00000000-0000-0000-0000-00000005d508', '00000000-0000-0000-0000-00000005d401'),
  ('00000000-0000-0000-0000-00000005d103', '00000000-0000-0000-0000-00000005d509', '00000000-0000-0000-0000-00000005d405'),
  ('00000000-0000-0000-0000-00000005d101', '00000000-0000-0000-0000-00000005d512', '00000000-0000-0000-0000-00000005d401'),
  ('00000000-0000-0000-0000-00000005d101', '00000000-0000-0000-0000-00000005d512', '00000000-0000-0000-0000-00000005d402'),
  ('00000000-0000-0000-0000-00000005d101', '00000000-0000-0000-0000-00000005d513', '00000000-0000-0000-0000-00000005d401'),
  ('00000000-0000-0000-0000-00000005d101', '00000000-0000-0000-0000-00000005d514', '00000000-0000-0000-0000-00000005d406'),
  ('00000000-0000-0000-0000-00000005d104', '00000000-0000-0000-0000-00000005d515', '00000000-0000-0000-0000-00000005d407');

DO $d2_fixture_guards$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'public.organization_role_permissions'::regclass
      AND tgname = 'organization_role_permissions_restrict_client'
      AND NOT tgisinternal
  ) THEN
    EXECUTE 'ALTER TABLE public.organization_role_permissions ENABLE TRIGGER organization_role_permissions_restrict_client';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'public.organization_member_roles'::regclass
      AND tgname = 'organization_member_roles_reject_client'
      AND NOT tgisinternal
  ) THEN
    EXECUTE 'ALTER TABLE public.organization_member_roles ENABLE TRIGGER organization_member_roles_reject_client';
  END IF;
END
$d2_fixture_guards$;

INSERT INTO public.platform_admins (user_id, status)
VALUES ('00000000-0000-0000-0000-00000005d211', 'active');

-- ============ CATALOGUE / FUNCTION SECURITY ============

SELECT is(
  (SELECT count(*)::integer
   FROM pg_catalog.pg_proc AS procedure
   JOIN pg_catalog.pg_namespace AS namespace
     ON namespace.oid = procedure.pronamespace
   WHERE namespace.nspname = 'private'
     AND procedure.proname = ANY (ARRAY[
       'purplelok_current_session_id',
       'purplelok_has_normal_session',
       'purplelok_has_active_membership',
       'purplelok_has_permission',
       'purplelok_can_access_resource'
     ])),
  5,
  'exactly five D1 authorization functions exist'
);

SELECT is(
  (SELECT array_agg(
     procedure.oid::regprocedure::text || ':'
     || pg_catalog.pg_get_function_result(procedure.oid)
     ORDER BY procedure.oid::regprocedure::text
   )::text
   FROM pg_catalog.pg_proc AS procedure
   WHERE procedure.oid = ANY (ARRAY[
     'private.purplelok_current_session_id()'::regprocedure,
     'private.purplelok_has_normal_session()'::regprocedure,
     'private.purplelok_has_active_membership(uuid)'::regprocedure,
     'private.purplelok_has_permission(uuid,text)'::regprocedure,
     'private.purplelok_can_access_resource(uuid,text)'::regprocedure
   ]::oid[])),
  ARRAY[
    'private.purplelok_can_access_resource(uuid,text):boolean',
    'private.purplelok_current_session_id():uuid',
    'private.purplelok_has_active_membership(uuid):boolean',
    'private.purplelok_has_normal_session():boolean',
    'private.purplelok_has_permission(uuid,text):boolean'
  ]::text[]::text,
  'D1 function signatures and return types are exact'
);

SELECT is(
  (SELECT count(*)::integer
   FROM pg_catalog.pg_proc AS procedure
   WHERE procedure.oid = ANY (ARRAY[
     'private.purplelok_current_session_id()'::regprocedure,
     'private.purplelok_has_normal_session()'::regprocedure,
     'private.purplelok_has_active_membership(uuid)'::regprocedure,
     'private.purplelok_has_permission(uuid,text)'::regprocedure,
     'private.purplelok_can_access_resource(uuid,text)'::regprocedure
   ]::oid[])
     AND procedure.provolatile = 's'
     AND pg_catalog.pg_get_userbyid(procedure.proowner) = 'postgres'),
  5,
  'all D1 functions are STABLE and postgres-owned'
);

SELECT is(
  (SELECT count(*)::integer
   FROM pg_catalog.pg_proc AS procedure
   WHERE procedure.oid = ANY (ARRAY[
     'private.purplelok_has_normal_session()'::regprocedure,
     'private.purplelok_has_active_membership(uuid)'::regprocedure,
     'private.purplelok_has_permission(uuid,text)'::regprocedure
   ]::oid[])
     AND procedure.prosecdef
     AND procedure.proconfig @> ARRAY['row_security=off']::text[]),
  3,
  'the three catalogue-reading predicates are hardened SECURITY DEFINER functions'
);

SELECT is(
  (SELECT count(*)::integer
   FROM pg_catalog.pg_proc AS procedure
   WHERE procedure.oid = ANY (ARRAY[
     'private.purplelok_current_session_id()'::regprocedure,
     'private.purplelok_can_access_resource(uuid,text)'::regprocedure
   ]::oid[])
     AND NOT procedure.prosecdef
     AND procedure.proconfig @> ARRAY['row_security=on']::text[]),
  2,
  'claim parsing and composition helpers remain SECURITY INVOKER'
);

SELECT is(
  (SELECT count(*)::integer
   FROM pg_catalog.pg_proc AS procedure
   WHERE procedure.oid = ANY (ARRAY[
     'private.purplelok_current_session_id()'::regprocedure,
     'private.purplelok_has_normal_session()'::regprocedure,
     'private.purplelok_has_active_membership(uuid)'::regprocedure,
     'private.purplelok_has_permission(uuid,text)'::regprocedure,
     'private.purplelok_can_access_resource(uuid,text)'::regprocedure
   ]::oid[])
     AND EXISTS (
       SELECT 1 FROM unnest(procedure.proconfig) AS setting
       WHERE setting ~ '^search_path=(""|)$'
     )),
  5,
  'all D1 functions have an empty search_path'
);

SELECT ok(
  NOT pg_catalog.has_function_privilege(
    'authenticated', 'private.purplelok_current_session_id()', 'EXECUTE'
  )
  AND pg_catalog.has_function_privilege(
    'authenticated', 'private.purplelok_has_normal_session()', 'EXECUTE'
  )
  AND pg_catalog.has_function_privilege(
    'authenticated', 'private.purplelok_has_active_membership(uuid)', 'EXECUTE'
  )
  AND pg_catalog.has_function_privilege(
    'authenticated', 'private.purplelok_has_permission(uuid,text)', 'EXECUTE'
  )
  AND pg_catalog.has_function_privilege(
    'authenticated', 'private.purplelok_can_access_resource(uuid,text)', 'EXECUTE'
  ),
  'authenticated can execute only the four external D1 predicates'
);

SELECT is(
  (SELECT count(*)::integer
   FROM pg_catalog.pg_proc AS procedure
   CROSS JOIN LATERAL pg_catalog.aclexplode(
     coalesce(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
   ) AS privilege
   WHERE procedure.oid = ANY (ARRAY[
     'private.purplelok_current_session_id()'::regprocedure,
     'private.purplelok_has_normal_session()'::regprocedure,
     'private.purplelok_has_active_membership(uuid)'::regprocedure,
     'private.purplelok_has_permission(uuid,text)'::regprocedure,
     'private.purplelok_can_access_resource(uuid,text)'::regprocedure
   ]::oid[])
     AND privilege.grantee = 0
     AND privilege.privilege_type = 'EXECUTE'),
  0,
  'PUBLIC cannot execute any D1 predicate'
);

SELECT ok(
  NOT pg_catalog.has_function_privilege('anon', 'private.purplelok_current_session_id()', 'EXECUTE')
  AND NOT pg_catalog.has_function_privilege('anon', 'private.purplelok_has_normal_session()', 'EXECUTE')
  AND NOT pg_catalog.has_function_privilege('anon', 'private.purplelok_has_active_membership(uuid)', 'EXECUTE')
  AND NOT pg_catalog.has_function_privilege('anon', 'private.purplelok_has_permission(uuid,text)', 'EXECUTE')
  AND NOT pg_catalog.has_function_privilege('anon', 'private.purplelok_can_access_resource(uuid,text)', 'EXECUTE'),
  'anon cannot execute D1 predicates'
);

SELECT ok(
  NOT pg_catalog.has_function_privilege('service_role', 'private.purplelok_current_session_id()', 'EXECUTE')
  AND NOT pg_catalog.has_function_privilege('service_role', 'private.purplelok_has_normal_session()', 'EXECUTE')
  AND NOT pg_catalog.has_function_privilege('service_role', 'private.purplelok_has_active_membership(uuid)', 'EXECUTE')
  AND NOT pg_catalog.has_function_privilege('service_role', 'private.purplelok_has_permission(uuid,text)', 'EXECUTE')
  AND NOT pg_catalog.has_function_privilege('service_role', 'private.purplelok_can_access_resource(uuid,text)', 'EXECUTE'),
  'service_role cannot execute D1 predicates'
);

SELECT ok(
  NOT pg_catalog.has_function_privilege('supabase_auth_admin', 'private.purplelok_current_session_id()', 'EXECUTE')
  AND NOT pg_catalog.has_function_privilege('supabase_auth_admin', 'private.purplelok_has_normal_session()', 'EXECUTE')
  AND NOT pg_catalog.has_function_privilege('supabase_auth_admin', 'private.purplelok_has_active_membership(uuid)', 'EXECUTE')
  AND NOT pg_catalog.has_function_privilege('supabase_auth_admin', 'private.purplelok_has_permission(uuid,text)', 'EXECUTE')
  AND NOT pg_catalog.has_function_privilege('supabase_auth_admin', 'private.purplelok_can_access_resource(uuid,text)', 'EXECUTE'),
  'Auth hook role cannot execute D1 predicates'
);

SELECT ok(
  pg_catalog.pg_get_functiondef('private.purplelok_has_normal_session()'::regprocedure)
    LIKE '%FROM auth.sessions%'
  AND pg_catalog.pg_get_functiondef('private.purplelok_has_normal_session()'::regprocedure)
    LIKE '%auth_session.user_id = caller_id%'
  AND pg_catalog.pg_get_functiondef('private.purplelok_has_normal_session()'::regprocedure)
    LIKE '%auth_user.deleted_at IS NULL%',
  'normal-session predicate checks exact session ownership and a live Auth user'
);

SELECT ok(
  pg_catalog.pg_get_functiondef('private.purplelok_has_normal_session()'::regprocedure)
    LIKE '%FROM private.auth_session_gates%'
  AND pg_catalog.pg_get_functiondef('private.purplelok_has_normal_session()'::regprocedure)
    LIKE '%profile.active = true%',
  'normal-session predicate checks recovery gates and active profile state'
);

SELECT ok(
  pg_catalog.pg_get_functiondef('private.purplelok_has_permission(uuid,text)'::regprocedure)
    NOT LIKE '%platform_admins%'
  AND pg_catalog.pg_get_functiondef('private.purplelok_has_permission(uuid,text)'::regprocedure)
    NOT LIKE '%profile.role%'
  AND pg_catalog.pg_get_functiondef('private.purplelok_has_active_membership(uuid)'::regprocedure)
    NOT LIKE '%platform_admins%'
  AND pg_catalog.pg_get_functiondef('private.purplelok_has_active_membership(uuid)'::regprocedure)
    NOT LIKE '%profile.role%',
  'legacy profile role and platform-admin rows provide no D1 bypass'
);

SELECT ok(
  EXISTS (SELECT 1 FROM pg_catalog.pg_index WHERE indexrelid = 'auth.sessions_pkey'::regclass AND indisvalid)
  AND EXISTS (SELECT 1 FROM pg_catalog.pg_index WHERE indexrelid = 'private.auth_session_gates_pkey'::regclass AND indisvalid)
  AND EXISTS (SELECT 1 FROM pg_catalog.pg_index WHERE indexrelid = 'profiles_pkey'::regclass AND indisvalid)
  AND EXISTS (SELECT 1 FROM pg_catalog.pg_index WHERE indexrelid = 'organizations_pkey'::regclass AND indisvalid)
  AND EXISTS (SELECT 1 FROM pg_catalog.pg_index WHERE indexrelid = 'organization_members_organization_user_key'::regclass AND indisvalid)
  AND EXISTS (SELECT 1 FROM pg_catalog.pg_index WHERE indexrelid = 'organization_member_roles_pkey'::regclass AND indisvalid)
  AND EXISTS (SELECT 1 FROM pg_catalog.pg_index WHERE indexrelid = 'organization_role_permissions_pkey'::regclass AND indisvalid)
  AND EXISTS (SELECT 1 FROM pg_catalog.pg_index WHERE indexrelid = 'permissions_pkey'::regclass AND indisvalid),
  'existing primary and unique indexes support every D1 lookup path'
);

SELECT is(
  (SELECT count(*)::integer FROM pg_catalog.pg_policies
   WHERE schemaname = 'public'
     AND tablename = ANY (ARRAY[
       'clients', 'client_contacts', 'client_notes', 'leads', 'quotes',
       'quote_items', 'invoices', 'invoice_items', 'payments', 'projects',
       'project_milestones', 'tasks', 'task_comments', 'meetings', 'documents',
       'tickets', 'ticket_messages', 'activities', 'notifications', 'channels',
       'messages'
     ])),
  84,
  'D1 leaves exactly 84 domain policies in place'
);

SELECT is(
  (SELECT count(*)::integer
   FROM pg_catalog.pg_class AS relation
   JOIN pg_catalog.pg_namespace AS namespace
     ON namespace.oid = relation.relnamespace
   WHERE namespace.nspname = 'public'
     AND relation.relname = ANY (ARRAY[
       'clients', 'client_contacts', 'client_notes', 'leads', 'quotes',
       'quote_items', 'invoices', 'invoice_items', 'payments', 'projects',
       'project_milestones', 'tasks', 'task_comments', 'meetings', 'documents',
       'tickets', 'ticket_messages', 'activities', 'notifications', 'channels',
       'messages'
     ])
     AND relation.relrowsecurity
     AND NOT relation.relforcerowsecurity),
  21,
  'D1 leaves ordinary RLS enabled on all 21 domain tables'
);

-- ============ NORMAL SESSION CONTRACT ============

SELECT pg_temp.batch_5f_d1_set_claims(NULL, NULL, NULL, NULL, NULL);
SELECT is(private.purplelok_has_normal_session(), false, 'unauthenticated claims are denied');

SELECT pg_temp.batch_5f_d1_set_claims(
  '00000000-0000-0000-0000-00000005d201',
  '00000000-0000-0000-0000-00000005d201',
  '00000000-0000-0000-0000-00000005d301',
  NULL,
  'normal_v1'
);
SELECT is(private.purplelok_has_normal_session(), false, 'missing JWT role is denied');

SELECT pg_temp.batch_5f_d1_set_claims(
  '00000000-0000-0000-0000-00000005d201',
  '00000000-0000-0000-0000-00000005d201',
  '00000000-0000-0000-0000-00000005d301',
  'anon',
  'normal_v1'
);
SELECT is(private.purplelok_has_normal_session(), false, 'non-authenticated JWT role is denied');

SELECT pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '00000000-0000-0000-0000-00000005d201',
    'session_id', '00000000-0000-0000-0000-00000005d301',
    'role', 42,
    'purplelok_session_state', 'normal_v1'
  )::text,
  true
);
SELECT pg_catalog.set_config(
  'request.jwt.claim.sub', '00000000-0000-0000-0000-00000005d201', true
);
SELECT is(private.purplelok_has_normal_session(), false, 'non-string JWT role is denied');

SELECT pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '00000000-0000-0000-0000-00000005d201',
    'session_id', '00000000-0000-0000-0000-00000005d301',
    'role', pg_catalog.jsonb_build_array('authenticated'),
    'purplelok_session_state', 'normal_v1'
  )::text,
  true
);
SELECT is(private.purplelok_has_normal_session(), false, 'array JWT role is denied');

SELECT pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '00000000-0000-0000-0000-00000005d201',
    'session_id', '00000000-0000-0000-0000-00000005d301',
    'role', pg_catalog.jsonb_build_object('name', 'authenticated'),
    'purplelok_session_state', 'normal_v1'
  )::text,
  true
);
SELECT is(private.purplelok_has_normal_session(), false, 'object JWT role is denied');

SELECT pg_temp.batch_5f_d1_set_claims(
  '00000000-0000-0000-0000-00000005d201', NULL,
  '00000000-0000-0000-0000-00000005d301', 'authenticated', 'normal_v1'
);
SELECT is(private.purplelok_has_normal_session(), false, 'missing JWT subject is denied');

SELECT pg_temp.batch_5f_d1_set_claims(
  '00000000-0000-0000-0000-00000005d201', 'not-a-uuid',
  '00000000-0000-0000-0000-00000005d301', 'authenticated', 'normal_v1'
);
SELECT is(private.purplelok_has_normal_session(), false, 'malformed JWT subject is denied without throwing');

SELECT pg_temp.batch_5f_d1_set_claims(
  '00000000-0000-0000-0000-00000005d202',
  '00000000-0000-0000-0000-00000005d201',
  '00000000-0000-0000-0000-00000005d301', 'authenticated', 'normal_v1'
);
SELECT is(private.purplelok_has_normal_session(), false, 'JWT subject mismatch with auth.uid is denied');

SELECT pg_temp.batch_5f_d1_set_claims(
  '00000000-0000-0000-0000-00000005d201',
  '00000000-0000-0000-0000-00000005d201',
  NULL, 'authenticated', 'normal_v1'
);
SELECT is(private.purplelok_current_session_id(), NULL::uuid, 'missing session_id parses to NULL');
SELECT is(private.purplelok_has_normal_session(), false, 'missing session_id is denied');

SELECT pg_temp.batch_5f_d1_set_claims(
  '00000000-0000-0000-0000-00000005d201',
  '00000000-0000-0000-0000-00000005d201',
  'malformed', 'authenticated', 'normal_v1'
);
SELECT is(private.purplelok_current_session_id(), NULL::uuid, 'malformed session_id parses to NULL');
SELECT is(private.purplelok_has_normal_session(), false, 'malformed session_id is denied without throwing');

SELECT pg_temp.batch_5f_d1_set_claims(
  '00000000-0000-0000-0000-00000005d201',
  '00000000-0000-0000-0000-00000005d201',
  '00000000-0000-0000-0000-00000005d399', 'authenticated', 'normal_v1'
);
SELECT is(private.purplelok_has_normal_session(), false, 'missing live auth.sessions row is denied');

SELECT pg_temp.batch_5f_d1_set_claims(
  '00000000-0000-0000-0000-00000005d201',
  '00000000-0000-0000-0000-00000005d201',
  '00000000-0000-0000-0000-00000005d302', 'authenticated', 'normal_v1'
);
SELECT is(private.purplelok_has_normal_session(), false, 'session owned by another user is denied');

SELECT pg_temp.batch_5f_d1_set_claims(
  '00000000-0000-0000-0000-00000005d201',
  '00000000-0000-0000-0000-00000005d201',
  '00000000-0000-0000-0000-00000005d301', 'authenticated', NULL
);
SELECT is(private.purplelok_has_normal_session(), false, 'missing session-state claim is denied');

SELECT pg_temp.batch_5f_d1_set_claims(
  '00000000-0000-0000-0000-00000005d201',
  '00000000-0000-0000-0000-00000005d201',
  '00000000-0000-0000-0000-00000005d301', 'authenticated', 'future_state'
);
SELECT is(private.purplelok_has_normal_session(), false, 'unknown session-state claim is denied');

SELECT pg_temp.batch_5f_d1_set_claims(
  '00000000-0000-0000-0000-00000005d201',
  '00000000-0000-0000-0000-00000005d201',
  '00000000-0000-0000-0000-00000005d301', 'authenticated', 'recovery_pending_v1'
);
SELECT is(private.purplelok_has_normal_session(), false, 'recovery_pending_v1 is denied');

SELECT pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '00000000-0000-0000-0000-00000005d201',
    'session_id', '00000000-0000-0000-0000-00000005d301',
    'role', 'authenticated',
    'purplelok_session_state', pg_catalog.jsonb_build_array('normal_v1')
  )::text,
  true
);
SELECT is(private.purplelok_has_normal_session(), false, 'array session-state claim is denied');

SELECT pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '00000000-0000-0000-0000-00000005d201',
    'session_id', '00000000-0000-0000-0000-00000005d301',
    'role', 'authenticated',
    'purplelok_session_state', pg_catalog.jsonb_build_object('state', 'normal_v1')
  )::text,
  true
);
SELECT is(private.purplelok_has_normal_session(), false, 'object session-state claim is denied');

SELECT pg_catalog.set_config(
  'request.jwt.claims',
  pg_catalog.jsonb_build_object(
    'sub', '00000000-0000-0000-0000-00000005d201',
    'session_id', '00000000-0000-0000-0000-00000005d301',
    'role', 'authenticated',
    'purplelok_session_state', NULL
  )::text,
  true
);
SELECT is(private.purplelok_has_normal_session(), false, 'JSON null session-state claim is denied');

INSERT INTO private.auth_session_gates (session_id, user_id, gate_type)
VALUES (
  '00000000-0000-0000-0000-00000005d301',
  '00000000-0000-0000-0000-00000005d201',
  'RECOVERY_PENDING'
);
SELECT pg_temp.batch_5f_d1_set_claims(
  '00000000-0000-0000-0000-00000005d201',
  '00000000-0000-0000-0000-00000005d201',
  '00000000-0000-0000-0000-00000005d301', 'authenticated', 'normal_v1'
);
SELECT is(private.purplelok_has_normal_session(), false, 'normal_v1 plus an exact recovery gate is denied');
DELETE FROM private.auth_session_gates
WHERE session_id = '00000000-0000-0000-0000-00000005d301';

INSERT INTO private.auth_session_gates (session_id, user_id, gate_type)
VALUES (
  '00000000-0000-0000-0000-00000005d302',
  '00000000-0000-0000-0000-00000005d202',
  'RECOVERY_PENDING'
);
SELECT is(private.purplelok_has_normal_session(), true, 'an unrelated session gate does not deny the exact normal session');
DELETE FROM private.auth_session_gates
WHERE session_id = '00000000-0000-0000-0000-00000005d302';

SET LOCAL ROLE authenticated;
SELECT is(private.purplelok_has_normal_session(), true, 'valid live normal authenticated session is accepted');
RESET ROLE;
SELECT is(
  private.purplelok_current_session_id(),
  '00000000-0000-0000-0000-00000005d301'::uuid,
  'valid session_id is parsed internally under postgres'
);

SELECT pg_temp.batch_5f_d1_set_claims(
  '00000000-0000-0000-0000-00000005d205',
  '00000000-0000-0000-0000-00000005d205',
  '00000000-0000-0000-0000-00000005d305', 'authenticated', 'normal_v1'
);
SELECT is(private.purplelok_has_normal_session(), false, 'deleted Auth user is denied');

SELECT pg_temp.batch_5f_d1_set_claims(
  '00000000-0000-0000-0000-00000005d204',
  '00000000-0000-0000-0000-00000005d204',
  '00000000-0000-0000-0000-00000005d304', 'authenticated', 'normal_v1'
);
SELECT is(private.purplelok_has_normal_session(), false, 'missing profile is denied');

SELECT pg_temp.batch_5f_d1_set_claims(
  '00000000-0000-0000-0000-00000005d203',
  '00000000-0000-0000-0000-00000005d203',
  '00000000-0000-0000-0000-00000005d303', 'authenticated', 'normal_v1'
);
SELECT is(private.purplelok_has_normal_session(), false, 'inactive profile is denied');

SELECT pg_temp.batch_5f_d1_set_claims(
  '00000000-0000-0000-0000-00000005d214',
  '00000000-0000-0000-0000-00000005d214',
  '00000000-0000-0000-0000-00000005d314', 'authenticated', 'normal_v1'
);
SELECT is(private.purplelok_has_normal_session(), true, 'live session is accepted before revocation');
DELETE FROM auth.sessions
WHERE id = '00000000-0000-0000-0000-00000005d314';
SELECT is(private.purplelok_has_normal_session(), false, 'stale JWT is denied immediately after auth.sessions deletion');

SELECT pg_catalog.set_config('request.jwt.claims', 'not-json', true);
SELECT pg_catalog.set_config('request.jwt.claim.sub', '', true);
SELECT is(private.purplelok_current_session_id(), NULL::uuid, 'malformed claims JSON returns NULL from the parser');
SELECT is(private.purplelok_has_normal_session(), false, 'malformed claims JSON denies without throwing');

SELECT pg_catalog.set_config('request.jwt.claims', 'null', true);
SELECT is(private.purplelok_has_normal_session(), false, 'non-object claims JSON denies without throwing');

-- ============ ORGANIZATION / MEMBERSHIP CONTRACT ============

SELECT pg_temp.batch_5f_d1_set_claims(
  '00000000-0000-0000-0000-00000005d201',
  '00000000-0000-0000-0000-00000005d201',
  '00000000-0000-0000-0000-00000005d301', 'authenticated', 'normal_v1'
);
SELECT is(private.purplelok_has_active_membership(NULL), false, 'NULL organization is denied');
SELECT is(
  private.purplelok_has_active_membership('00000000-0000-0000-0000-00000005d199'),
  false,
  'missing organization is denied'
);
SELECT is(
  private.purplelok_has_active_membership('00000000-0000-0000-0000-00000005d102'),
  false,
  'membership in another active organization is denied'
);

SELECT pg_temp.batch_5f_d1_set_claims(
  '00000000-0000-0000-0000-00000005d209',
  '00000000-0000-0000-0000-00000005d209',
  '00000000-0000-0000-0000-00000005d309', 'authenticated', 'normal_v1'
);
SELECT is(private.purplelok_has_active_membership('00000000-0000-0000-0000-00000005d103'), false, 'inactive organization is denied');

SELECT pg_temp.batch_5f_d1_set_claims(
  '00000000-0000-0000-0000-00000005d216',
  '00000000-0000-0000-0000-00000005d216',
  '00000000-0000-0000-0000-00000005d316', 'authenticated', 'normal_v1'
);
SELECT is(private.purplelok_has_active_membership('00000000-0000-0000-0000-00000005d104'), false, 'archived organization is denied');

SELECT pg_temp.batch_5f_d1_set_claims(
  '00000000-0000-0000-0000-00000005d211',
  '00000000-0000-0000-0000-00000005d211',
  '00000000-0000-0000-0000-00000005d311', 'authenticated', 'normal_v1'
);
SELECT is(private.purplelok_has_active_membership('00000000-0000-0000-0000-00000005d101'), false, 'missing membership is denied');

SELECT pg_temp.batch_5f_d1_set_claims(
  '00000000-0000-0000-0000-00000005d213',
  '00000000-0000-0000-0000-00000005d213',
  '00000000-0000-0000-0000-00000005d313', 'authenticated', 'normal_v1'
);
SELECT is(private.purplelok_has_active_membership('00000000-0000-0000-0000-00000005d101'), false, 'invited inactive membership is denied');

SELECT pg_temp.batch_5f_d1_set_claims(
  '00000000-0000-0000-0000-00000005d207',
  '00000000-0000-0000-0000-00000005d207',
  '00000000-0000-0000-0000-00000005d307', 'authenticated', 'normal_v1'
);
SELECT is(private.purplelok_has_active_membership('00000000-0000-0000-0000-00000005d101'), false, 'suspended membership is denied');

SELECT pg_temp.batch_5f_d1_set_claims(
  '00000000-0000-0000-0000-00000005d208',
  '00000000-0000-0000-0000-00000005d208',
  '00000000-0000-0000-0000-00000005d308', 'authenticated', 'normal_v1'
);
SELECT is(private.purplelok_has_active_membership('00000000-0000-0000-0000-00000005d101'), false, 'removed membership is denied');

SELECT pg_temp.batch_5f_d1_set_claims(
  '00000000-0000-0000-0000-00000005d210',
  '00000000-0000-0000-0000-00000005d210',
  '00000000-0000-0000-0000-00000005d310', 'authenticated', 'normal_v1'
);
SELECT is(private.purplelok_has_active_membership('00000000-0000-0000-0000-00000005d101'), false, 'roleless active membership is denied');

SELECT pg_temp.batch_5f_d1_set_claims(
  '00000000-0000-0000-0000-00000005d206',
  '00000000-0000-0000-0000-00000005d206',
  '00000000-0000-0000-0000-00000005d306', 'authenticated', 'normal_v1'
);
SELECT is(private.purplelok_has_active_membership('00000000-0000-0000-0000-00000005d101'), false, 'Client-only role membership is denied');

SELECT pg_temp.batch_5f_d1_set_claims(
  '00000000-0000-0000-0000-00000005d212',
  '00000000-0000-0000-0000-00000005d212',
  '00000000-0000-0000-0000-00000005d312', 'authenticated', 'normal_v1'
);
SELECT is(private.purplelok_has_active_membership('00000000-0000-0000-0000-00000005d101'), false, 'mixed Client and internal role assignment fails closed');

SELECT pg_temp.batch_5f_d1_set_claims(
  '00000000-0000-0000-0000-00000005d201',
  '00000000-0000-0000-0000-00000005d201',
  '00000000-0000-0000-0000-00000005d301', 'authenticated', 'normal_v1'
);
SELECT is(private.purplelok_has_active_membership('00000000-0000-0000-0000-00000005d101'), true, 'active internal-role membership is accepted');

SELECT pg_temp.batch_5f_d1_set_claims(
  '00000000-0000-0000-0000-00000005d211',
  '00000000-0000-0000-0000-00000005d211',
  '00000000-0000-0000-0000-00000005d311', 'authenticated', 'normal_v1'
);
SELECT is(private.purplelok_has_active_membership('00000000-0000-0000-0000-00000005d101'), false, 'platform administrator row does not bypass membership contract');

-- ============ PERMISSION / RESOURCE CONTRACT ============

SELECT pg_temp.batch_5f_d1_set_claims(
  '00000000-0000-0000-0000-00000005d201',
  '00000000-0000-0000-0000-00000005d201',
  '00000000-0000-0000-0000-00000005d301', 'authenticated', 'normal_v1'
);
SELECT is(private.purplelok_has_permission('00000000-0000-0000-0000-00000005d101', NULL), false, 'NULL permission is denied');
SELECT is(private.purplelok_has_permission('00000000-0000-0000-0000-00000005d101', ''), false, 'empty permission is denied');
SELECT is(private.purplelok_has_permission('00000000-0000-0000-0000-00000005d101', '   '), false, 'blank permission is denied');
SELECT is(private.purplelok_has_permission('00000000-0000-0000-0000-00000005d101', 'missing.permission'), false, 'missing permission catalogue key is denied');
SELECT is(private.purplelok_has_permission('00000000-0000-0000-0000-00000005d101', 'CLIENTS.READ'), false, 'uppercase permission variant is denied');
SELECT is(private.purplelok_has_permission('00000000-0000-0000-0000-00000005d101', 'clients.read '), false, 'trailing-space permission variant is denied');
SELECT is(private.purplelok_has_permission('00000000-0000-0000-0000-00000005d101', pg_catalog.repeat('x', 4096)), false, 'arbitrarily long unmatched permission is denied');
SELECT is(private.purplelok_has_permission('00000000-0000-0000-0000-00000005d101', 'clients.write'), false, 'existing but unmapped permission is denied');
SELECT is(private.purplelok_has_permission('00000000-0000-0000-0000-00000005d101', 'clients.read'), true, 'same-organization mapped permission is accepted');
SELECT is(private.purplelok_can_access_resource('00000000-0000-0000-0000-00000005d101', 'clients.read'), true, 'same-organization resource helper accepts mapped capability');
SELECT is(private.purplelok_can_access_resource('00000000-0000-0000-0000-00000005d102', 'clients.read'), false, 'cross-organization resource access is denied');

SELECT pg_temp.batch_5f_d1_set_claims(
  '00000000-0000-0000-0000-00000005d215',
  '00000000-0000-0000-0000-00000005d215',
  '00000000-0000-0000-0000-00000005d315', 'authenticated', 'normal_v1'
);
SELECT is(private.purplelok_has_permission('00000000-0000-0000-0000-00000005d101', 'clients.read'), true, 'Owner-only role receives its mapped permission');
SELECT is(private.purplelok_has_permission('00000000-0000-0000-0000-00000005d101', 'clients.write'), false, 'Owner-only role receives no unmapped permission bypass');

SELECT pg_temp.batch_5f_d1_set_claims(
  '00000000-0000-0000-0000-00000005d206',
  '00000000-0000-0000-0000-00000005d206',
  '00000000-0000-0000-0000-00000005d306', 'authenticated', 'normal_v1'
);
SELECT is(private.purplelok_has_permission('00000000-0000-0000-0000-00000005d101', 'clients.read'), false, 'mapped Client role cannot grant internal permission');

SELECT pg_temp.batch_5f_d1_set_claims(
  '00000000-0000-0000-0000-00000005d212',
  '00000000-0000-0000-0000-00000005d212',
  '00000000-0000-0000-0000-00000005d312', 'authenticated', 'normal_v1'
);
SELECT is(private.purplelok_has_permission('00000000-0000-0000-0000-00000005d101', 'clients.read'), false, 'mixed Client/internal membership cannot gain internal permission');

SELECT pg_temp.batch_5f_d1_set_claims(
  '00000000-0000-0000-0000-00000005d211',
  '00000000-0000-0000-0000-00000005d211',
  '00000000-0000-0000-0000-00000005d311', 'authenticated', 'normal_v1'
);
UPDATE public.profiles
SET role = 'super_admin'
WHERE id = '00000000-0000-0000-0000-00000005d211';
SELECT is(private.purplelok_has_permission('00000000-0000-0000-0000-00000005d101', 'clients.read'), false, 'legacy super_admin profile role and platform-admin row grant no capability');

SELECT throws_ok(
  $$INSERT INTO public.organization_member_roles (
      organization_id, organization_member_id, organization_role_id
    ) VALUES (
      '00000000-0000-0000-0000-00000005d101',
      '00000000-0000-0000-0000-00000005d501',
      '00000000-0000-0000-0000-00000005d404'
    )$$,
  '23503',
  NULL,
  'composite foreign key rejects cross-organization role assignment'
);

SELECT pg_temp.batch_5f_d1_set_claims(
  '00000000-0000-0000-0000-00000005d209',
  '00000000-0000-0000-0000-00000005d209',
  '00000000-0000-0000-0000-00000005d309', 'authenticated', 'normal_v1'
);
SELECT is(private.purplelok_has_permission('00000000-0000-0000-0000-00000005d103', 'clients.read'), false, 'role in an inactive organization is unusable');

SELECT is(
  (SELECT counts FROM batch_5f_d1_rbac_snapshot),
  jsonb_build_object(
    'permissions', (SELECT count(*) FROM public.permissions),
    'organizations', (SELECT count(*) FROM public.organizations) - 4,
    'memberships', (SELECT count(*) FROM public.organization_members) - 11,
    'roles', (SELECT count(*) FROM public.organization_roles) - 7,
    'role_permissions', (SELECT count(*) FROM public.organization_role_permissions) - 6,
    'member_roles', (SELECT count(*) FROM public.organization_member_roles) - 11,
    'platform_admins', (SELECT count(*) FROM public.platform_admins) - 1
  ),
  'D1 migration and predicates do not mutate the pre-existing RBAC graph'
);

SELECT * FROM finish();

ROLLBACK;
