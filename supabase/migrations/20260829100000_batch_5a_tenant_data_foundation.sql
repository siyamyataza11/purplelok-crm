/*
# Batch 5A: tenant data foundation

Adds the narrow active-organization member directory used by future tenant-
aware assignment controls. Domain RLS, tenant columns, data, memberships, and
the permission catalogue are intentionally unchanged.
*/

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '2min';

DO $preflight$
DECLARE
  required_column record;
BEGIN
  IF to_regprocedure('public.get_organization_member_directory(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION
      'Batch 5A precondition: public.get_organization_member_directory(uuid) already exists';
  END IF;

  FOR required_column IN
    SELECT *
    FROM (VALUES
      ('organizations', 'id'),
      ('organizations', 'status'),
      ('organization_members', 'id'),
      ('organization_members', 'organization_id'),
      ('organization_members', 'user_id'),
      ('organization_members', 'job_title'),
      ('organization_members', 'status'),
      ('profiles', 'id'),
      ('profiles', 'full_name'),
      ('profiles', 'email'),
      ('profiles', 'avatar_url'),
      ('profiles', 'active')
    ) AS required(table_name, column_name)
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns AS column_catalogue
      WHERE column_catalogue.table_schema = 'public'
        AND column_catalogue.table_name = required_column.table_name
        AND column_catalogue.column_name = required_column.column_name
    ) THEN
      RAISE EXCEPTION
        'Batch 5A precondition: required column public.%.% is missing',
        required_column.table_name,
        required_column.column_name;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'auth'
      AND table_name = 'users'
      AND column_name = 'id'
      AND data_type = 'uuid'
  ) OR NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'auth'
      AND table_name = 'users'
      AND column_name = 'deleted_at'
      AND data_type = 'timestamp with time zone'
  ) THEN
    RAISE EXCEPTION
      'Batch 5A precondition: auth.users(id uuid, deleted_at timestamptz) is required';
  END IF;
END
$preflight$;

-- SECURITY DEFINER is required because profiles RLS deliberately does not
-- expose a global teammate directory. Authority still derives exclusively
-- from auth.uid() and an active membership in the requested active tenant.
CREATE FUNCTION public.get_organization_member_directory(
  target_organization_id uuid
)
RETURNS TABLE (
  organization_id uuid,
  membership_id uuid,
  user_id uuid,
  full_name text,
  email text,
  job_title text,
  avatar_url text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
SET row_security = 'off'
AS $function$
  SELECT
    member.organization_id,
    member.id AS membership_id,
    member.user_id,
    profile.full_name,
    profile.email,
    member.job_title,
    profile.avatar_url
  FROM public.organization_members AS member
  JOIN public.profiles AS profile
    ON profile.id = member.user_id
  JOIN auth.users AS member_identity
    ON member_identity.id = member.user_id
   AND member_identity.deleted_at IS NULL
  JOIN public.organizations AS organization
    ON organization.id = member.organization_id
  WHERE member.organization_id = target_organization_id
    AND member.status = 'active'
    AND profile.active
    AND organization.status = 'active'
    AND (SELECT auth.uid()) IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.organization_members AS caller_membership
      JOIN auth.users AS caller_identity
        ON caller_identity.id = caller_membership.user_id
       AND caller_identity.deleted_at IS NULL
      WHERE caller_membership.organization_id = target_organization_id
        AND caller_membership.user_id = (SELECT auth.uid())
        AND caller_membership.status = 'active'
    )
  ORDER BY profile.full_name, profile.email, member.id
$function$;

ALTER FUNCTION public.get_organization_member_directory(uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.get_organization_member_directory(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_organization_member_directory(uuid)
  TO authenticated;

COMMENT ON FUNCTION public.get_organization_member_directory(uuid) IS
  'Returns the minimal active-member directory for an active organization in which auth.uid() has an active membership.';

DO $postconditions$
DECLARE
  function_oid oid := to_regprocedure(
    'public.get_organization_member_directory(uuid)'
  );
  function_definition text;
BEGIN
  IF function_oid IS NULL OR NOT EXISTS (
    SELECT 1
    FROM pg_proc AS procedure
    WHERE procedure.oid = function_oid
      AND procedure.prosecdef
      AND procedure.provolatile = 's'
      AND pg_get_userbyid(procedure.proowner) = 'postgres'
      AND procedure.proconfig @> ARRAY['row_security=off']::text[]
      AND EXISTS (
        SELECT 1
        FROM unnest(procedure.proconfig) AS setting
        WHERE setting ~ '^search_path=(""|)$'
      )
  ) THEN
    RAISE EXCEPTION 'Batch 5A postcondition: directory function security contract is invalid';
  END IF;

  SELECT pg_get_functiondef(function_oid)
  INTO function_definition;

  IF function_definition NOT LIKE '%JOIN auth.users AS member_identity%'
     OR function_definition NOT LIKE '%member_identity.deleted_at IS NULL%'
     OR function_definition NOT LIKE '%JOIN auth.users AS caller_identity%'
     OR function_definition NOT LIKE '%caller_identity.deleted_at IS NULL%'
     OR function_definition NOT LIKE '%(SELECT auth.uid()) IS NOT NULL%'
     OR function_definition NOT LIKE '%caller_membership.user_id = (SELECT auth.uid())%' THEN
    RAISE EXCEPTION
      'Batch 5A postcondition: directory function live Auth identity checks are invalid';
  END IF;

  IF NOT has_function_privilege(
      'authenticated',
      'public.get_organization_member_directory(uuid)',
      'EXECUTE'
    )
    OR has_function_privilege(
      'anon',
      'public.get_organization_member_directory(uuid)',
      'EXECUTE'
    )
    OR has_function_privilege(
      'service_role',
      'public.get_organization_member_directory(uuid)',
      'EXECUTE'
    )
    OR EXISTS (
      SELECT 1
      FROM aclexplode((SELECT proacl FROM pg_proc WHERE oid = function_oid)) AS acl
      WHERE acl.grantee = 0
        AND acl.privilege_type = 'EXECUTE'
    ) THEN
    RAISE EXCEPTION 'Batch 5A postcondition: directory function ACL is invalid';
  END IF;
END
$postconditions$;

COMMIT;
