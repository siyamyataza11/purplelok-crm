/*
# Batch 5E-B2R: profile write authority containment

Removes the legacy authenticated-browser write surface from public.profiles
without changing domain-table RLS. Self-service edits are limited to the four
presentation fields already exposed by the application settings screen.
*/

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '2min';

DO $preflight$
BEGIN
  IF to_regprocedure('public.update_own_profile(text,text,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION
      'Batch 5E-B2R precondition: public.update_own_profile(text,text,text,text) already exists';
  END IF;

  IF to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'Batch 5E-B2R precondition: public.profiles is missing';
  END IF;

  IF (
    SELECT array_agg(column_name::text ORDER BY column_name)
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name IN (
        'id', 'email', 'full_name', 'avatar_url', 'phone', 'position',
        'role', 'active', 'created_at', 'updated_at'
      )
  ) IS DISTINCT FROM ARRAY[
    'active', 'avatar_url', 'created_at', 'email', 'full_name', 'id',
    'phone', 'position', 'role', 'updated_at'
  ]::text[] THEN
    RAISE EXCEPTION 'Batch 5E-B2R precondition: required profile columns are missing';
  END IF;

END
$preflight$;

CREATE FUNCTION private.batch_5e_b2r_profile_policy_baseline_matches()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT NOT EXISTS (
    SELECT 1
    FROM (
      (
        SELECT *
        FROM (VALUES
          ('profiles_insert'::text, 'INSERT'::text, 'PERMISSIVE'::text,
            ARRAY['authenticated']::name[], NULL::text, 'true'::text),
          ('profiles_update'::text, 'UPDATE'::text, 'PERMISSIVE'::text,
            ARRAY['authenticated']::name[], 'true'::text, 'true'::text),
          ('profiles_delete'::text, 'DELETE'::text, 'PERMISSIVE'::text,
            ARRAY['authenticated']::name[], 'true'::text, NULL::text)
        ) AS expected(policy_name, command, permissiveness, roles, using_expression, check_expression)
        EXCEPT ALL
        SELECT
          policy.policyname::text,
          policy.cmd::text,
          policy.permissive::text,
          policy.roles,
          policy.qual::text,
          policy.with_check::text
        FROM pg_catalog.pg_policies AS policy
        WHERE policy.schemaname = 'public'
          AND policy.tablename = 'profiles'
          AND policy.cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
      )
      UNION ALL
      (
        SELECT
          policy.policyname::text,
          policy.cmd::text,
          policy.permissive::text,
          policy.roles,
          policy.qual::text,
          policy.with_check::text
        FROM pg_catalog.pg_policies AS policy
        WHERE policy.schemaname = 'public'
          AND policy.tablename = 'profiles'
          AND policy.cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
        EXCEPT ALL
        SELECT *
        FROM (VALUES
          ('profiles_insert'::text, 'INSERT'::text, 'PERMISSIVE'::text,
            ARRAY['authenticated']::name[], NULL::text, 'true'::text),
          ('profiles_update'::text, 'UPDATE'::text, 'PERMISSIVE'::text,
            ARRAY['authenticated']::name[], 'true'::text, 'true'::text),
          ('profiles_delete'::text, 'DELETE'::text, 'PERMISSIVE'::text,
            ARRAY['authenticated']::name[], 'true'::text, NULL::text)
        ) AS expected(policy_name, command, permissiveness, roles, using_expression, check_expression)
      )
    ) AS policy_difference
  );
$function$;

ALTER FUNCTION private.batch_5e_b2r_profile_policy_baseline_matches()
  OWNER TO postgres;

REVOKE ALL ON FUNCTION private.batch_5e_b2r_profile_policy_baseline_matches()
  FROM PUBLIC, anon, authenticated, service_role;

DO $policy_preflight$
BEGIN
  IF NOT private.batch_5e_b2r_profile_policy_baseline_matches() THEN
    RAISE EXCEPTION
      'Batch 5E-B2R precondition: profile mutation policies do not exactly match the approved legacy baseline';
  END IF;
END
$policy_preflight$;

DROP POLICY profiles_insert ON public.profiles;
DROP POLICY profiles_update ON public.profiles;
DROP POLICY profiles_delete ON public.profiles;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.profiles
  FROM PUBLIC, anon, authenticated;
REVOKE INSERT (
  id, email, full_name, avatar_url, phone, position, role, active,
  created_at, updated_at
), UPDATE (
  id, email, full_name, avatar_url, phone, position, role, active,
  created_at, updated_at
), REFERENCES (
  id, email, full_name, avatar_url, phone, position, role, active,
  created_at, updated_at
) ON TABLE public.profiles
  FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.update_own_profile(
  p_full_name text,
  p_phone text,
  p_position text,
  p_avatar_url text
)
RETURNS TABLE (
  id uuid,
  full_name text,
  phone text,
  "position" text,
  avatar_url text,
  updated_at timestamptz
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET row_security = 'off'
AS $function$
DECLARE
  caller_id uuid := (SELECT auth.uid());
  affected_rows integer;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Authenticated profile access is required';
  END IF;

  IF p_full_name IS NULL
     OR length(btrim(p_full_name)) = 0
     OR length(p_full_name) > 200
     OR length(COALESCE(p_phone, '')) > 64
     OR length(COALESCE(p_position, '')) > 160
     OR length(COALESCE(p_avatar_url, '')) > 2048 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'Profile presentation fields are invalid';
  END IF;

  RETURN QUERY
  UPDATE public.profiles AS profile
  SET
    full_name = p_full_name,
    phone = p_phone,
    "position" = p_position,
    avatar_url = p_avatar_url
  WHERE profile.id = caller_id
    AND profile.active
    AND EXISTS (
      SELECT 1
      FROM auth.users AS identity
      WHERE identity.id = caller_id
        AND identity.deleted_at IS NULL
    )
  RETURNING
    profile.id,
    profile.full_name,
    profile.phone,
    profile."position",
    profile.avatar_url,
    profile.updated_at;

  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows <> 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Active profile access is required';
  END IF;
END
$function$;

ALTER FUNCTION public.update_own_profile(text, text, text, text)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.update_own_profile(text, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_own_profile(text, text, text, text)
  TO authenticated;

COMMENT ON FUNCTION public.update_own_profile(text, text, text, text) IS
  'Updates only the authenticated caller''s non-authoritative profile presentation fields.';

DO $postconditions$
DECLARE
  function_oid oid := to_regprocedure(
    'public.update_own_profile(text,text,text,text)'
  );
  baseline_function_oid oid := to_regprocedure(
    'private.batch_5e_b2r_profile_policy_baseline_matches()'
  );
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_policies AS policy
    WHERE policy.schemaname = 'public'
      AND policy.tablename = 'profiles'
      AND policy.cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
      AND 'authenticated' = ANY(policy.roles)
  ) THEN
    RAISE EXCEPTION 'Batch 5E-B2R postcondition: authenticated profile mutation policy remains';
  END IF;

  IF has_table_privilege('authenticated', 'public.profiles', 'INSERT')
     OR has_table_privilege('authenticated', 'public.profiles', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.profiles', 'DELETE')
     OR has_any_column_privilege('authenticated', 'public.profiles', 'INSERT')
     OR has_any_column_privilege('authenticated', 'public.profiles', 'UPDATE')
     OR has_any_column_privilege('authenticated', 'public.profiles', 'REFERENCES') THEN
    RAISE EXCEPTION 'Batch 5E-B2R postcondition: authenticated profile table writes remain';
  END IF;

  IF function_oid IS NULL OR NOT EXISTS (
    SELECT 1
    FROM pg_proc AS procedure
    WHERE procedure.oid = function_oid
      AND procedure.prosecdef
      AND procedure.provolatile = 'v'
      AND pg_get_userbyid(procedure.proowner) = 'postgres'
      AND procedure.proconfig @> ARRAY['row_security=off']::text[]
      AND EXISTS (
        SELECT 1
        FROM unnest(procedure.proconfig) AS setting
        WHERE setting ~ '^search_path=(""|)$'
      )
  ) THEN
    RAISE EXCEPTION 'Batch 5E-B2R postcondition: self-profile function security contract is invalid';
  END IF;

  IF NOT has_function_privilege(
      'authenticated',
      'public.update_own_profile(text,text,text,text)',
      'EXECUTE'
    )
    OR has_function_privilege(
      'anon',
      'public.update_own_profile(text,text,text,text)',
      'EXECUTE'
    )
    OR has_function_privilege(
      'service_role',
      'public.update_own_profile(text,text,text,text)',
      'EXECUTE'
    )
    OR EXISTS (
      SELECT 1
      FROM aclexplode((SELECT proacl FROM pg_proc WHERE oid = function_oid)) AS acl
      WHERE acl.grantee = 0
        AND acl.privilege_type = 'EXECUTE'
    ) THEN
    RAISE EXCEPTION 'Batch 5E-B2R postcondition: self-profile function ACL is invalid';
  END IF;

  IF baseline_function_oid IS NULL OR NOT EXISTS (
    SELECT 1
    FROM pg_proc AS procedure
    WHERE procedure.oid = baseline_function_oid
      AND NOT procedure.prosecdef
      AND procedure.provolatile = 's'
      AND pg_get_userbyid(procedure.proowner) = 'postgres'
      AND EXISTS (
        SELECT 1
        FROM unnest(procedure.proconfig) AS setting
        WHERE setting ~ '^search_path=(""|)$'
      )
  ) OR has_function_privilege(
      'anon',
      'private.batch_5e_b2r_profile_policy_baseline_matches()',
      'EXECUTE'
    )
    OR has_function_privilege(
      'authenticated',
      'private.batch_5e_b2r_profile_policy_baseline_matches()',
      'EXECUTE'
    )
    OR has_function_privilege(
      'service_role',
      'private.batch_5e_b2r_profile_policy_baseline_matches()',
      'EXECUTE'
    )
    OR EXISTS (
      SELECT 1
      FROM aclexplode((SELECT proacl FROM pg_proc WHERE oid = baseline_function_oid)) AS acl
      WHERE acl.grantee = 0
        AND acl.privilege_type = 'EXECUTE'
    ) THEN
    RAISE EXCEPTION 'Batch 5E-B2R postcondition: exact policy-baseline helper security contract is invalid';
  END IF;

  IF to_regprocedure('public.handle_new_user()') IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM pg_trigger AS trigger
       JOIN pg_class AS relation ON relation.oid = trigger.tgrelid
       JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
       WHERE namespace.nspname = 'auth'
         AND relation.relname = 'users'
         AND trigger.tgname = 'on_auth_user_created'
         AND NOT trigger.tgisinternal
         AND trigger.tgenabled = 'O'
         AND trigger.tgfoid = 'public.handle_new_user()'::regprocedure
     ) THEN
    RAISE EXCEPTION 'Batch 5E-B2R postcondition: Auth profile-creation trigger is unavailable';
  END IF;
END
$postconditions$;

COMMIT;
