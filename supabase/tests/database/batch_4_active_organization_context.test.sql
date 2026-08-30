BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(55);

-- Transaction-scoped fixtures model the two production tenants plus negative
-- membership and organization states. Nothing persists after ROLLBACK.
INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES
  ('00000000-0000-0000-0000-00000004b101', 'batch4-owner@example.test', '{"full_name":"Batch 4 Owner"}'::jsonb),
  ('00000000-0000-0000-0000-00000004b102', 'batch4-admin@example.test', '{"full_name":"Batch 4 Admin"}'::jsonb),
  ('00000000-0000-0000-0000-00000004b103', 'batch4-removed@example.test', '{"full_name":"Batch 4 Removed"}'::jsonb),
  ('00000000-0000-0000-0000-00000004b104', 'batch4-suspended@example.test', '{"full_name":"Batch 4 Suspended"}'::jsonb),
  ('00000000-0000-0000-0000-00000004b105', 'batch4-org-suspended@example.test', '{"full_name":"Batch 4 Org Suspended"}'::jsonb),
  ('00000000-0000-0000-0000-00000004b106', 'batch4-no-membership@example.test', '{"full_name":"Batch 4 No Membership"}'::jsonb);

INSERT INTO public.organizations (id, name, slug, status)
VALUES
  ('00000000-0000-0000-0000-00000004a101', 'Batch 4 PURPLELOK', 'batch-4-purplelok', 'active'),
  ('00000000-0000-0000-0000-00000004a102', 'Batch 4 PURPLELOK Demo', 'batch-4-purplelok-demo', 'active'),
  ('00000000-0000-0000-0000-00000004a103', 'Batch 4 Suspended Organization', 'batch-4-suspended', 'suspended');

INSERT INTO public.organization_members (
  id, organization_id, user_id, job_title, status
)
VALUES
  ('00000000-0000-0000-0000-00000004c101', '00000000-0000-0000-0000-00000004a101', '00000000-0000-0000-0000-00000004b101', 'Co-Founder & CEO', 'active'),
  ('00000000-0000-0000-0000-00000004c102', '00000000-0000-0000-0000-00000004a102', '00000000-0000-0000-0000-00000004b102', 'Demo Administrator', 'active'),
  ('00000000-0000-0000-0000-00000004c103', '00000000-0000-0000-0000-00000004a101', '00000000-0000-0000-0000-00000004b103', NULL, 'removed'),
  ('00000000-0000-0000-0000-00000004c104', '00000000-0000-0000-0000-00000004a101', '00000000-0000-0000-0000-00000004b104', NULL, 'suspended'),
  ('00000000-0000-0000-0000-00000004c105', '00000000-0000-0000-0000-00000004a103', '00000000-0000-0000-0000-00000004b105', NULL, 'active');

INSERT INTO public.organization_roles (id, organization_id, name, key, is_system)
VALUES
  ('00000000-0000-0000-0000-00000004d101', '00000000-0000-0000-0000-00000004a101', 'Owner', 'owner', true),
  ('00000000-0000-0000-0000-00000004d102', '00000000-0000-0000-0000-00000004a102', 'Admin', 'admin', true),
  ('00000000-0000-0000-0000-00000004d103', '00000000-0000-0000-0000-00000004a101', 'Extra Reader', 'extra_reader', false);

INSERT INTO public.organization_role_permissions (
  organization_id, organization_role_id, permission_key
)
SELECT '00000000-0000-0000-0000-00000004a101', '00000000-0000-0000-0000-00000004d101', key
FROM public.permissions;

INSERT INTO public.organization_role_permissions (
  organization_id, organization_role_id, permission_key
)
SELECT '00000000-0000-0000-0000-00000004a102', '00000000-0000-0000-0000-00000004d102', key
FROM public.permissions;

INSERT INTO public.organization_role_permissions (
  organization_id, organization_role_id, permission_key
)
VALUES (
  '00000000-0000-0000-0000-00000004a101',
  '00000000-0000-0000-0000-00000004d103',
  'clients.read'
);

INSERT INTO public.organization_member_roles (
  organization_id, organization_member_id, organization_role_id
)
VALUES
  ('00000000-0000-0000-0000-00000004a101', '00000000-0000-0000-0000-00000004c101', '00000000-0000-0000-0000-00000004d101'),
  ('00000000-0000-0000-0000-00000004a101', '00000000-0000-0000-0000-00000004c101', '00000000-0000-0000-0000-00000004d103'),
  ('00000000-0000-0000-0000-00000004a102', '00000000-0000-0000-0000-00000004c102', '00000000-0000-0000-0000-00000004d102');

-- ============ CATALOGUE / ACL HARDENING ============

SELECT is(
  (SELECT count(*)::integer FROM pg_namespace WHERE nspname = 'private'),
  1,
  'private schema exists exactly once'
);

SELECT is(
  (SELECT count(*)::integer
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'private'
      AND p.proname IN ('user_active_membership_ids', 'user_role_ids')),
  2,
  'the two private RLS helper functions exist'
);

SELECT is(
  (SELECT count(*)::integer
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'private'
      AND p.proname IN ('user_active_membership_ids', 'user_role_ids')
      AND p.prosecdef
      AND p.provolatile = 's'
      AND p.pronargs = 0
      AND pg_get_userbyid(p.proowner) = 'postgres'),
  2,
  'both helpers are no-argument stable SECURITY DEFINER functions owned by postgres'
);

SELECT is(
  (SELECT count(*)::integer
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'private'
      AND p.proname IN ('user_active_membership_ids', 'user_role_ids')
      AND EXISTS (
        SELECT 1
        FROM unnest(p.proconfig) AS setting
        WHERE setting ~ '^search_path=(""|)$'
      )),
  2,
  'both helpers have an empty search_path'
);

SELECT is(
  (SELECT count(*)::integer
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'private'
      AND p.proname IN ('user_active_membership_ids', 'user_role_ids')
      AND pg_get_functiondef(p.oid) LIKE '%auth.uid()%'),
  2,
  'both helpers derive caller identity from auth.uid()'
);

SELECT ok(has_function_privilege('authenticated', 'private.user_active_membership_ids()', 'EXECUTE'), 'authenticated can execute the membership helper');
SELECT ok(has_function_privilege('authenticated', 'private.user_role_ids()', 'EXECUTE'), 'authenticated can execute the role helper');
SELECT ok(NOT has_function_privilege('anon', 'private.user_active_membership_ids()', 'EXECUTE'), 'anon cannot execute the membership helper');
SELECT ok(NOT has_function_privilege('anon', 'private.user_role_ids()', 'EXECUTE'), 'anon cannot execute the role helper');
SELECT ok(NOT has_function_privilege('service_role', 'private.user_active_membership_ids()', 'EXECUTE'), 'service_role cannot execute the membership helper');
SELECT ok(NOT has_function_privilege('service_role', 'private.user_role_ids()', 'EXECUTE'), 'service_role cannot execute the role helper');

SELECT is(
  (SELECT count(*)::integer
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
     CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
    WHERE n.nspname = 'private'
      AND p.proname IN ('user_active_membership_ids', 'user_role_ids')
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'),
  0,
  'PUBLIC has no helper execution grant'
);

SELECT is(
  (SELECT count(*)::integer
     FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'organizations', 'organization_members', 'permissions',
        'organization_roles', 'organization_role_permissions',
        'organization_member_roles'
      )
      AND cmd = 'SELECT'
      AND roles = ARRAY['authenticated']::name[]),
  6,
  'exactly six authenticated SELECT policies exist'
);

SELECT is(
  (SELECT count(*)::integer FROM pg_policies WHERE schemaname = 'public' AND tablename = 'platform_admins'),
  0,
  'platform_admins has no browser policy'
);

SELECT ok(
  has_table_privilege('authenticated', 'public.organization_members', 'SELECT'),
  'authenticated can select organization memberships'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.organization_members', 'INSERT'),
  'authenticated cannot insert organization memberships'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.organization_members', 'UPDATE'),
  'authenticated cannot update organization memberships'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.organization_members', 'DELETE'),
  'authenticated cannot delete organization memberships'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.organization_roles', 'INSERT'),
  'authenticated cannot insert organization roles'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.organization_role_permissions', 'INSERT'),
  'authenticated cannot insert role-permission mappings'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.organization_role_permissions', 'UPDATE'),
  'authenticated cannot update role-permission mappings'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.organization_member_roles', 'INSERT'),
  'authenticated cannot insert member-role mappings'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.platform_admins', 'SELECT'),
  'authenticated cannot read platform_admins'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.platform_admins', 'INSERT'),
  'authenticated cannot create platform_admins'
);

-- ============ OWNER ACCESS ============

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000004b101', true);

SELECT is((SELECT count(*)::integer FROM public.organization_members), 1, 'owner reads only their own membership');
SELECT is((SELECT count(*)::integer FROM public.organization_members WHERE organization_id = '00000000-0000-0000-0000-00000004a102'), 0, 'owner cannot read the Demo membership');
SELECT is((SELECT count(*)::integer FROM public.organizations), 1, 'owner resolves only PURPLELOK');
SELECT is((SELECT count(*)::integer FROM private.user_active_membership_ids()), 1, 'owner has one usable membership');
SELECT is((SELECT count(*)::integer FROM public.organization_member_roles), 2, 'owner sees only their own two role assignments');
SELECT is((SELECT count(*)::integer FROM public.organization_roles), 2, 'owner sees only assigned roles');
SELECT is((SELECT count(DISTINCT permission_key)::integer FROM public.organization_role_permissions), 28, 'Owner effective permission union contains 28 keys');
SELECT is((SELECT count(*)::integer FROM public.permissions), 28, 'authenticated reads the fixed 28-key permission catalogue');

SELECT throws_ok(
  $$INSERT INTO public.organization_members (organization_id, user_id) VALUES ('00000000-0000-0000-0000-00000004a101', '00000000-0000-0000-0000-00000004b106')$$,
  '42501',
  'permission denied for table organization_members',
  'browser membership insertion is denied at the privilege boundary'
);

SELECT throws_ok(
  $$UPDATE public.organization_members SET status = 'suspended' WHERE id = '00000000-0000-0000-0000-00000004c101'$$,
  '42501',
  'permission denied for table organization_members',
  'browser membership update is denied at the privilege boundary'
);

SELECT throws_ok(
  $$DELETE FROM public.organization_members WHERE id = '00000000-0000-0000-0000-00000004c101'$$,
  '42501',
  'permission denied for table organization_members',
  'browser membership deletion is denied at the privilege boundary'
);

SELECT throws_ok(
  $$SELECT count(*) FROM public.platform_admins$$,
  '42501',
  'permission denied for table platform_admins',
  'browser query access to platform_admins is denied'
);

RESET ROLE;

-- ============ DEMO ADMIN ACCESS ============

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000004b102', true);

SELECT is((SELECT count(*)::integer FROM public.organization_members), 1, 'Demo admin reads only their own membership');
SELECT is((SELECT count(*)::integer FROM public.organization_members WHERE organization_id = '00000000-0000-0000-0000-00000004a101'), 0, 'Demo admin cannot read the real owner membership');
SELECT is((SELECT count(*)::integer FROM public.organizations), 1, 'Demo admin resolves only PURPLELOK Demo');
SELECT is((SELECT count(*)::integer FROM private.user_active_membership_ids()), 1, 'Demo admin has one usable membership');
SELECT is((SELECT count(*)::integer FROM public.organization_member_roles), 1, 'Demo admin sees only their own role assignment');
SELECT is((SELECT count(*)::integer FROM public.organization_roles), 1, 'Demo admin sees only the assigned Admin role');
SELECT is((SELECT count(DISTINCT permission_key)::integer FROM public.organization_role_permissions), 28, 'Admin effective permissions contain 28 keys');

RESET ROLE;

-- ============ STATUS / ANONYMOUS NEGATIVE CASES ============

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000004b103', true);
SELECT is((SELECT count(*)::integer FROM public.organization_members), 1, 'removed membership remains visible for diagnostics');
SELECT is((SELECT count(*)::integer FROM public.organizations), 0, 'removed membership cannot reveal organization access');
SELECT is((SELECT count(*)::integer FROM private.user_active_membership_ids()), 0, 'removed membership is not usable');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000004b104', true);
SELECT is((SELECT count(*)::integer FROM public.organization_members), 1, 'suspended membership remains visible for diagnostics');
SELECT is((SELECT count(*)::integer FROM public.organizations), 1, 'suspended member can resolve organization status context');
SELECT is((SELECT count(*)::integer FROM private.user_active_membership_ids()), 0, 'suspended membership is not usable');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000004b105', true);
SELECT is((SELECT count(*)::integer FROM public.organizations), 1, 'suspended organization remains visible for diagnostics');
SELECT is((SELECT count(*)::integer FROM private.user_active_membership_ids()), 0, 'suspended organization is not usable');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000004b106', true);
SELECT is((SELECT count(*)::integer FROM public.organization_members), 0, 'user without membership reads no memberships');
SELECT is((SELECT count(*)::integer FROM public.organizations), 0, 'user without membership reads no organizations');
RESET ROLE;

SET LOCAL ROLE anon;
SELECT throws_ok(
  $$SELECT count(*) FROM public.organization_members$$,
  '42501',
  'permission denied for table organization_members',
  'anon cannot read identity memberships'
);
SELECT throws_ok(
  $$SELECT count(*) FROM public.permissions$$,
  '42501',
  'permission denied for table permissions',
  'anon cannot read the permission catalogue'
);
RESET ROLE;

SELECT * FROM finish();

ROLLBACK;
