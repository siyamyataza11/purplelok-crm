BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(29);

-- Transaction-only identities and tenants. The auth signup trigger creates the
-- matching profile rows, which are then shaped for directory-specific cases.
INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES
  ('00000000-0000-0000-0000-00000005b101', 'batch5a-owner@example.test', '{"full_name":"Batch 5A Owner"}'::jsonb),
  ('00000000-0000-0000-0000-00000005b102', 'batch5a-teammate@example.test', '{"full_name":"Batch 5A Teammate"}'::jsonb),
  ('00000000-0000-0000-0000-00000005b103', 'batch5a-inactive@example.test', '{"full_name":"Batch 5A Inactive"}'::jsonb),
  ('00000000-0000-0000-0000-00000005b104', 'batch5a-demo@example.test', '{"full_name":"Batch 5A Demo"}'::jsonb),
  ('00000000-0000-0000-0000-00000005b105', 'batch5a-removed@example.test', '{"full_name":"Batch 5A Removed"}'::jsonb),
  ('00000000-0000-0000-0000-00000005b106', 'batch5a-suspended@example.test', '{"full_name":"Batch 5A Suspended"}'::jsonb),
  ('00000000-0000-0000-0000-00000005b107', 'batch5a-suspended-org@example.test', '{"full_name":"Batch 5A Suspended Org"}'::jsonb),
  ('00000000-0000-0000-0000-00000005b108', 'batch5a-no-membership@example.test', '{"full_name":"Batch 5A No Membership"}'::jsonb),
  ('00000000-0000-0000-0000-00000005b109', 'batch5a-soft-target@example.test', '{"full_name":"Batch 5A Soft Target"}'::jsonb),
  ('00000000-0000-0000-0000-00000005b110', 'batch5a-soft-caller@example.test', '{"full_name":"Batch 5A Soft Caller"}'::jsonb),
  ('00000000-0000-0000-0000-00000005b111', 'batch5a-hard-target@example.test', '{"full_name":"Batch 5A Hard Target"}'::jsonb),
  ('00000000-0000-0000-0000-00000005b112', 'batch5a-archived-org@example.test', '{"full_name":"Batch 5A Archived Org"}'::jsonb);

UPDATE public.profiles
SET avatar_url = 'https://example.test/avatar.png'
WHERE id = '00000000-0000-0000-0000-00000005b102';

UPDATE public.profiles
SET active = false
WHERE id = '00000000-0000-0000-0000-00000005b103';

INSERT INTO public.organizations (id, name, slug, status)
VALUES
  ('00000000-0000-0000-0000-00000005a101', 'Batch 5A PURPLELOK', 'batch-5a-purplelok', 'active'),
  ('00000000-0000-0000-0000-00000005a102', 'Batch 5A Demo', 'batch-5a-demo', 'active'),
  ('00000000-0000-0000-0000-00000005a103', 'Batch 5A Suspended', 'batch-5a-suspended', 'suspended'),
  ('00000000-0000-0000-0000-00000005a104', 'Batch 5A Archived', 'batch-5a-archived', 'archived');

INSERT INTO public.organization_members (
  id, organization_id, user_id, job_title, status
)
VALUES
  ('00000000-0000-0000-0000-00000005c101', '00000000-0000-0000-0000-00000005a101', '00000000-0000-0000-0000-00000005b101', 'Owner', 'active'),
  ('00000000-0000-0000-0000-00000005c102', '00000000-0000-0000-0000-00000005a101', '00000000-0000-0000-0000-00000005b102', 'Designer', 'active'),
  ('00000000-0000-0000-0000-00000005c103', '00000000-0000-0000-0000-00000005a101', '00000000-0000-0000-0000-00000005b103', 'Inactive Profile', 'active'),
  ('00000000-0000-0000-0000-00000005c104', '00000000-0000-0000-0000-00000005a102', '00000000-0000-0000-0000-00000005b104', 'Demo Admin', 'active'),
  ('00000000-0000-0000-0000-00000005c105', '00000000-0000-0000-0000-00000005a101', '00000000-0000-0000-0000-00000005b105', NULL, 'removed'),
  ('00000000-0000-0000-0000-00000005c106', '00000000-0000-0000-0000-00000005a101', '00000000-0000-0000-0000-00000005b106', NULL, 'suspended'),
  ('00000000-0000-0000-0000-00000005c107', '00000000-0000-0000-0000-00000005a103', '00000000-0000-0000-0000-00000005b107', NULL, 'active'),
  ('00000000-0000-0000-0000-00000005c109', '00000000-0000-0000-0000-00000005a101', '00000000-0000-0000-0000-00000005b109', NULL, 'active'),
  ('00000000-0000-0000-0000-00000005c110', '00000000-0000-0000-0000-00000005a101', '00000000-0000-0000-0000-00000005b110', NULL, 'active'),
  ('00000000-0000-0000-0000-00000005c111', '00000000-0000-0000-0000-00000005a101', '00000000-0000-0000-0000-00000005b111', NULL, 'active'),
  ('00000000-0000-0000-0000-00000005c112', '00000000-0000-0000-0000-00000005a104', '00000000-0000-0000-0000-00000005b112', NULL, 'active');

UPDATE auth.users
SET deleted_at = now()
WHERE id IN (
  '00000000-0000-0000-0000-00000005b109',
  '00000000-0000-0000-0000-00000005b110'
);

-- A hard-deleted Auth identity must cascade away its profile and membership;
-- the directory must never be able to observe a missing identity orphan.
DELETE FROM auth.users
WHERE id = '00000000-0000-0000-0000-00000005b111';

-- ============ CATALOGUE / ACL ============

SELECT is(
  (SELECT count(*)::integer
   FROM pg_proc AS procedure
   JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
   WHERE namespace.nspname = 'public'
     AND procedure.proname = 'get_organization_member_directory'
     AND procedure.pronargs = 1
     AND procedure.proargtypes = '2950'::oidvector),
  1,
  'the uuid member-directory function exists exactly once'
);

SELECT is(
  (SELECT count(*)::integer
   FROM pg_proc AS procedure
   WHERE procedure.oid = 'public.get_organization_member_directory(uuid)'::regprocedure
     AND procedure.prosecdef
     AND procedure.provolatile = 's'
     AND pg_get_userbyid(procedure.proowner) = 'postgres'),
  1,
  'directory is stable SECURITY DEFINER and owned by postgres'
);

SELECT ok(
  (SELECT procedure.proconfig @> ARRAY['row_security=off']::text[]
       AND EXISTS (
         SELECT 1
         FROM unnest(procedure.proconfig) AS setting
         WHERE setting ~ '^search_path=(""|)$'
       )
   FROM pg_proc AS procedure
   WHERE procedure.oid = 'public.get_organization_member_directory(uuid)'::regprocedure),
  'directory uses empty search_path and row_security off'
);

SELECT is(
  (SELECT array_agg(argument.name ORDER BY argument.ordinality)::text
   FROM pg_proc AS procedure
   CROSS JOIN LATERAL unnest(procedure.proargnames, procedure.proargmodes)
     WITH ORDINALITY AS argument(name, mode, ordinality)
   WHERE procedure.oid = 'public.get_organization_member_directory(uuid)'::regprocedure
     AND argument.mode = 't'),
  ARRAY[
    'organization_id', 'membership_id', 'user_id', 'full_name',
    'email', 'job_title', 'avatar_url'
  ]::text[]::text,
  'directory exposes exactly the approved seven fields'
);

SELECT ok(
  pg_get_functiondef('public.get_organization_member_directory(uuid)'::regprocedure)
    NOT LIKE '%profile.role%'
  AND pg_get_functiondef('public.get_organization_member_directory(uuid)'::regprocedure)
    NOT LIKE '%profile.position%'
  AND pg_get_functiondef('public.get_organization_member_directory(uuid)'::regprocedure)
    NOT LIKE '%platform_admins%',
  'directory does not return legacy authority or platform-admin state'
);

SELECT ok(
  pg_get_functiondef('public.get_organization_member_directory(uuid)'::regprocedure)
    LIKE '%JOIN auth.users AS member_identity%'
  AND pg_get_functiondef('public.get_organization_member_directory(uuid)'::regprocedure)
    LIKE '%member_identity.deleted_at IS NULL%'
  AND pg_get_functiondef('public.get_organization_member_directory(uuid)'::regprocedure)
    LIKE '%JOIN auth.users AS caller_identity%'
  AND pg_get_functiondef('public.get_organization_member_directory(uuid)'::regprocedure)
    LIKE '%caller_identity.deleted_at IS NULL%'
  AND pg_get_functiondef('public.get_organization_member_directory(uuid)'::regprocedure)
    LIKE '%(SELECT auth.uid()) IS NOT NULL%',
  'directory requires live Auth identities for both caller and returned members'
);

SELECT ok(has_function_privilege('authenticated', 'public.get_organization_member_directory(uuid)', 'EXECUTE'), 'authenticated can execute directory');
SELECT ok(NOT has_function_privilege('anon', 'public.get_organization_member_directory(uuid)', 'EXECUTE'), 'anon cannot execute directory');
SELECT ok(NOT has_function_privilege('service_role', 'public.get_organization_member_directory(uuid)', 'EXECUTE'), 'service_role cannot execute directory');
SELECT is(
  (SELECT count(*)::integer
   FROM pg_proc AS procedure
   CROSS JOIN LATERAL aclexplode(COALESCE(procedure.proacl, acldefault('f', procedure.proowner))) AS acl
   WHERE procedure.oid = 'public.get_organization_member_directory(uuid)'::regprocedure
     AND acl.grantee = 0
     AND acl.privilege_type = 'EXECUTE'),
  0,
  'PUBLIC cannot execute directory'
);

-- ============ AUTHENTICATED TENANT ISOLATION ============

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000005b101', true);
SELECT is(
  (SELECT count(*)::integer FROM public.get_organization_member_directory('00000000-0000-0000-0000-00000005a101')),
  2,
  'real owner sees only the two active profiles in the real organization'
);
SELECT is(
  (SELECT count(*)::integer FROM public.get_organization_member_directory('00000000-0000-0000-0000-00000005a102')),
  0,
  'real owner cannot enumerate Demo by supplying its UUID'
);
SELECT is(
  (SELECT count(*)::integer FROM public.get_organization_member_directory('00000000-0000-0000-0000-00000005afff')),
  0,
  'real owner cannot enumerate a nonexistent organization UUID'
);
SELECT is(
  (SELECT count(*)::integer FROM public.get_organization_member_directory('00000000-0000-0000-0000-00000005a101') WHERE user_id = '00000000-0000-0000-0000-00000005b103'),
  0,
  'inactive profile is excluded from the directory'
);
SELECT is(
  (SELECT count(*)::integer FROM public.get_organization_member_directory('00000000-0000-0000-0000-00000005a101') WHERE user_id IN ('00000000-0000-0000-0000-00000005b109', '00000000-0000-0000-0000-00000005b110')),
  0,
  'soft-deleted Auth identities are excluded from directory results'
);
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000005b104', true);
SELECT is(
  (SELECT count(*)::integer FROM public.get_organization_member_directory('00000000-0000-0000-0000-00000005a102')),
  1,
  'Demo member sees the active Demo directory'
);
SELECT is(
  (SELECT count(*)::integer FROM public.get_organization_member_directory('00000000-0000-0000-0000-00000005a101')),
  0,
  'Demo member cannot enumerate real PURPLELOK'
);
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000005b105', true);
SELECT is((SELECT count(*)::integer FROM public.get_organization_member_directory('00000000-0000-0000-0000-00000005a101')), 0, 'removed caller cannot enumerate directory');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000005b106', true);
SELECT is((SELECT count(*)::integer FROM public.get_organization_member_directory('00000000-0000-0000-0000-00000005a101')), 0, 'suspended caller cannot enumerate directory');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000005b107', true);
SELECT is((SELECT count(*)::integer FROM public.get_organization_member_directory('00000000-0000-0000-0000-00000005a103')), 0, 'active member cannot enumerate a suspended organization');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000005b108', true);
SELECT is((SELECT count(*)::integer FROM public.get_organization_member_directory('00000000-0000-0000-0000-00000005a101')), 0, 'target organization argument grants no access without membership');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000005b110', true);
SELECT is((SELECT count(*)::integer FROM public.get_organization_member_directory('00000000-0000-0000-0000-00000005a101')), 0, 'soft-deleted Auth caller cannot enumerate directory');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000005b112', true);
SELECT is((SELECT count(*)::integer FROM public.get_organization_member_directory('00000000-0000-0000-0000-00000005a104')), 0, 'active member cannot enumerate an archived organization');
RESET ROLE;

SELECT is(
  (SELECT count(*)::integer FROM public.organization_members WHERE user_id = '00000000-0000-0000-0000-00000005b111'),
  0,
  'hard-deleted Auth identity cannot leave a missing-identity membership'
);

SELECT is(
  (SELECT count(*)::integer
   FROM public.organization_members
   WHERE user_id IN (
     '00000000-0000-0000-0000-00000005b109',
     '00000000-0000-0000-0000-00000005b110'
   )),
  2,
  'soft-deleted Auth identities retain memberships while the directory excludes them'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT is((SELECT count(*)::integer FROM public.get_organization_member_directory('00000000-0000-0000-0000-00000005a101')), 0, 'NULL auth.uid caller cannot enumerate directory');
RESET ROLE;

SET LOCAL ROLE anon;
SELECT throws_ok(
  $$SELECT * FROM public.get_organization_member_directory('00000000-0000-0000-0000-00000005a101')$$,
  '42501',
  'permission denied for function get_organization_member_directory',
  'anon execution is denied'
);
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT throws_ok(
  $$SELECT * FROM public.get_organization_member_directory('00000000-0000-0000-0000-00000005a101')$$,
  '42501',
  'permission denied for function get_organization_member_directory',
  'service_role execution is denied'
);
RESET ROLE;

SELECT ok(
  pg_get_functiondef('public.get_organization_member_directory(uuid)'::regprocedure)
    LIKE '%auth.uid()%'
  AND pg_get_functiondef('public.get_organization_member_directory(uuid)'::regprocedure)
    LIKE '%caller_membership.status = ''active''%'
  AND pg_get_functiondef('public.get_organization_member_directory(uuid)'::regprocedure)
    LIKE '%organization.status = ''active''%',
  'directory authority derives from active auth.uid membership in an active organization'
);

SELECT * FROM finish();

ROLLBACK;
