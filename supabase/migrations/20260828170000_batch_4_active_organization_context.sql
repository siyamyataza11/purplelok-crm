/*
# Batch 4: Active organization context

Adds the minimum read-only browser surface needed to resolve the authenticated
caller's own usable organization memberships, assigned roles, and effective
permissions. Domain-table policies and tenant-owned data are intentionally
unchanged; Batch 5 remains the tenant-isolation cutover.
*/

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '2min';

-- Fail closed if the verified Batch 1 baseline has drifted. In particular, an
-- unexpected existing policy could broaden the read model created below.
DO $preflight$
DECLARE
  identity_table text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'private') THEN
    RAISE EXCEPTION 'Batch 4 precondition: private schema already exists; review it before continuing';
  END IF;

  FOREACH identity_table IN ARRAY ARRAY[
    'organizations',
    'organization_members',
    'permissions',
    'organization_roles',
    'organization_role_permissions',
    'organization_member_roles',
    'platform_admins'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = identity_table
        AND c.relkind = 'r'
        AND c.relrowsecurity
        AND NOT c.relforcerowsecurity
        AND pg_get_userbyid(c.relowner) = 'postgres'
    ) THEN
      RAISE EXCEPTION
        'Batch 4 precondition: public.% must exist, be owned by postgres, have RLS enabled, and not FORCE RLS',
        identity_table;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = ANY (ARRAY[
        'organizations',
        'organization_members',
        'permissions',
        'organization_roles',
        'organization_role_permissions',
        'organization_member_roles',
        'platform_admins'
      ])
  ) THEN
    RAISE EXCEPTION 'Batch 4 precondition: unexpected identity/RBAC policy already exists';
  END IF;
END
$preflight$;

CREATE SCHEMA private AUTHORIZATION postgres;

REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA private TO authenticated;

CREATE FUNCTION private.user_active_membership_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
SET row_security = 'off'
AS $function$
  SELECT membership.id
  FROM public.organization_members AS membership
  JOIN public.organizations AS organization
    ON organization.id = membership.organization_id
  WHERE membership.user_id = (SELECT auth.uid())
    AND membership.status = 'active'
    AND organization.status = 'active'
$function$;

ALTER FUNCTION private.user_active_membership_ids() OWNER TO postgres;

CREATE FUNCTION private.user_role_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
SET row_security = 'off'
AS $function$
  SELECT DISTINCT member_role.organization_role_id
  FROM public.organization_member_roles AS member_role
  JOIN public.organization_members AS membership
    ON membership.id = member_role.organization_member_id
   AND membership.organization_id = member_role.organization_id
  JOIN public.organizations AS organization
    ON organization.id = membership.organization_id
  JOIN public.organization_roles AS organization_role
    ON organization_role.id = member_role.organization_role_id
   AND organization_role.organization_id = member_role.organization_id
  WHERE membership.user_id = (SELECT auth.uid())
    AND membership.status = 'active'
    AND organization.status = 'active'
$function$;

ALTER FUNCTION private.user_role_ids() OWNER TO postgres;

REVOKE ALL ON FUNCTION private.user_active_membership_ids()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.user_role_ids()
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION private.user_active_membership_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION private.user_role_ids() TO authenticated;

-- Reassert the complete browser privilege boundary before adding SELECT.
REVOKE ALL ON TABLE public.organizations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.organization_members FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.permissions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.organization_roles FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.organization_role_permissions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.organization_member_roles FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.platform_admins FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.organizations TO authenticated;
GRANT SELECT ON TABLE public.organization_members TO authenticated;
GRANT SELECT ON TABLE public.permissions TO authenticated;
GRANT SELECT ON TABLE public.organization_roles TO authenticated;
GRANT SELECT ON TABLE public.organization_role_permissions TO authenticated;
GRANT SELECT ON TABLE public.organization_member_roles TO authenticated;

CREATE POLICY organizations_read_own_memberships
  ON public.organizations
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.organization_members AS membership
      WHERE membership.organization_id = organizations.id
        AND membership.user_id = (SELECT auth.uid())
        AND membership.status IN ('invited', 'active', 'suspended')
    )
  );

CREATE POLICY organization_members_read_own
  ON public.organization_members
  FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY organization_member_roles_read_own_active
  ON public.organization_member_roles
  FOR SELECT
  TO authenticated
  USING (
    organization_member_id IN (
      SELECT private.user_active_membership_ids()
    )
  );

CREATE POLICY organization_roles_read_assigned
  ON public.organization_roles
  FOR SELECT
  TO authenticated
  USING (
    id IN (
      SELECT private.user_role_ids()
    )
  );

CREATE POLICY organization_role_permissions_read_assigned
  ON public.organization_role_permissions
  FOR SELECT
  TO authenticated
  USING (
    organization_role_id IN (
      SELECT private.user_role_ids()
    )
  );

CREATE POLICY permissions_read_catalogue
  ON public.permissions
  FOR SELECT
  TO authenticated
  USING (true);

-- Postconditions make accidental privilege or policy expansion abort the whole
-- migration. service_role grants are intentionally not changed.
DO $postconditions$
DECLARE
  readable_table text;
BEGIN
  FOREACH readable_table IN ARRAY ARRAY[
    'organizations',
    'organization_members',
    'permissions',
    'organization_roles',
    'organization_role_permissions',
    'organization_member_roles'
  ]
  LOOP
    IF NOT has_table_privilege('authenticated', 'public.' || readable_table, 'SELECT')
       OR has_table_privilege('authenticated', 'public.' || readable_table, 'INSERT')
       OR has_table_privilege('authenticated', 'public.' || readable_table, 'UPDATE')
       OR has_table_privilege('authenticated', 'public.' || readable_table, 'DELETE')
       OR has_table_privilege('authenticated', 'public.' || readable_table, 'TRUNCATE')
       OR has_table_privilege('authenticated', 'public.' || readable_table, 'REFERENCES')
       OR has_table_privilege('authenticated', 'public.' || readable_table, 'TRIGGER') THEN
      RAISE EXCEPTION 'Batch 4 postcondition: unexpected authenticated privilege on public.%', readable_table;
    END IF;
  END LOOP;

  IF has_table_privilege('authenticated', 'public.platform_admins', 'SELECT')
     OR has_table_privilege('authenticated', 'public.platform_admins', 'INSERT')
     OR has_table_privilege('authenticated', 'public.platform_admins', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.platform_admins', 'DELETE') THEN
    RAISE EXCEPTION 'Batch 4 postcondition: platform_admins is browser-accessible';
  END IF;

  IF (SELECT count(*) FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = ANY (ARRAY[
          'organizations',
          'organization_members',
          'permissions',
          'organization_roles',
          'organization_role_permissions',
          'organization_member_roles'
        ])) <> 6
     OR EXISTS (
       SELECT 1
       FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename = 'platform_admins'
     ) THEN
    RAISE EXCEPTION 'Batch 4 postcondition: unexpected identity/RBAC policy catalogue';
  END IF;
END
$postconditions$;

COMMENT ON FUNCTION private.user_active_membership_ids() IS
  'RLS-only helper returning auth.uid() active memberships in active organizations.';

COMMENT ON FUNCTION private.user_role_ids() IS
  'RLS-only helper returning roles assigned through auth.uid() active memberships in active organizations.';

COMMIT;
