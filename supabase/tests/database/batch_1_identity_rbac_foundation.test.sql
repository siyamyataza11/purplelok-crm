BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(20);

-- Test users are transaction-scoped fixtures. The existing auth trigger creates
-- their global profiles, which also verifies compatibility with the foundation.
INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES
  ('00000000-0000-0000-0000-00000000b101', 'batch1-user-1@example.test', '{"full_name":"Batch 1 User 1"}'::jsonb),
  ('00000000-0000-0000-0000-00000000b102', 'batch1-user-2@example.test', '{"full_name":"Batch 1 User 2"}'::jsonb);

INSERT INTO organizations (id, name, slug)
VALUES
  ('00000000-0000-0000-0000-00000000a001', 'Batch 1 Organization A', 'batch-1-organization-a'),
  ('00000000-0000-0000-0000-00000000a002', 'Batch 1 Organization B', 'batch-1-organization-b');

INSERT INTO organization_members (id, organization_id, user_id, status)
VALUES
  (
    '00000000-0000-0000-0000-00000000c101',
    '00000000-0000-0000-0000-00000000a001',
    '00000000-0000-0000-0000-00000000b101',
    'active'
  ),
  (
    '00000000-0000-0000-0000-00000000c102',
    '00000000-0000-0000-0000-00000000a002',
    '00000000-0000-0000-0000-00000000b101',
    'active'
  );

INSERT INTO organization_roles (id, organization_id, name, key, is_system)
VALUES
  (
    '00000000-0000-0000-0000-00000000d101',
    '00000000-0000-0000-0000-00000000a001',
    'Owner',
    'owner',
    true
  ),
  (
    '00000000-0000-0000-0000-00000000d102',
    '00000000-0000-0000-0000-00000000a002',
    'Owner',
    'owner',
    true
  );

INSERT INTO organization_role_permissions (
  organization_id,
  organization_role_id,
  permission_key
)
VALUES (
  '00000000-0000-0000-0000-00000000a001',
  '00000000-0000-0000-0000-00000000d101',
  'clients.read'
);

SELECT throws_ok(
  $$
    INSERT INTO organization_members (organization_id, user_id)
    VALUES (
      '00000000-0000-0000-0000-00000000a001',
      '00000000-0000-0000-0000-00000000b101'
    )
  $$,
  '23505',
  'duplicate key value violates unique constraint "organization_members_organization_user_key"',
  'duplicate organization membership is rejected'
);

SELECT throws_ok(
  $$
    INSERT INTO organization_members (organization_id, user_id, status)
    VALUES (
      '00000000-0000-0000-0000-00000000a001',
      '00000000-0000-0000-0000-00000000b102',
      'disabled'
    )
  $$,
  '23514',
  'new row for relation "organization_members" violates check constraint "organization_members_status_check"',
  'invalid membership status is rejected'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM organization_roles
    WHERE key = 'owner'
  ),
  2,
  'the same role key is valid in different organizations'
);

SELECT throws_ok(
  $$
    INSERT INTO organization_roles (organization_id, name, key)
    VALUES (
      '00000000-0000-0000-0000-00000000a001',
      'Organization Owner',
      'owner'
    )
  $$,
  '23505',
  'duplicate key value violates unique constraint "organization_roles_organization_key_key"',
  'role keys are unique within an organization'
);

SELECT throws_ok(
  $$
    INSERT INTO organization_role_permissions (
      organization_id,
      organization_role_id,
      permission_key
    )
    VALUES (
      '00000000-0000-0000-0000-00000000a001',
      '00000000-0000-0000-0000-00000000d101',
      'not.a_real_permission'
    )
  $$,
  '23503',
  'insert or update on table "organization_role_permissions" violates foreign key constraint "organization_role_permissions_permission_key_fkey"',
  'invalid permission references are rejected'
);

SELECT throws_ok(
  $$
    INSERT INTO organization_member_roles (
      organization_id,
      organization_member_id,
      organization_role_id
    )
    VALUES (
      '00000000-0000-0000-0000-00000000a001',
      '00000000-0000-0000-0000-00000000c101',
      '00000000-0000-0000-0000-00000000d102'
    )
  $$,
  '23503',
  'insert or update on table "organization_member_roles" violates foreign key constraint "organization_member_roles_role_organization_fkey"',
  'roles cannot be assigned across organizations'
);

SELECT ok(NOT has_table_privilege('anon', 'public.organizations', 'SELECT'), 'anon cannot read organizations');
SELECT ok(NOT has_table_privilege('anon', 'public.organization_members', 'SELECT'), 'anon cannot read organization members');
SELECT ok(NOT has_table_privilege('anon', 'public.permissions', 'SELECT'), 'anon cannot read permissions');
SELECT ok(NOT has_table_privilege('anon', 'public.organization_roles', 'SELECT'), 'anon cannot read organization roles');
SELECT ok(NOT has_table_privilege('anon', 'public.organization_role_permissions', 'SELECT'), 'anon cannot read role permissions');
SELECT ok(NOT has_table_privilege('anon', 'public.organization_member_roles', 'SELECT'), 'anon cannot read member roles');
SELECT ok(NOT has_table_privilege('anon', 'public.platform_admins', 'SELECT'), 'anon cannot read platform administrators');

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.platform_admins', 'INSERT'),
  'authenticated users cannot create platform administrators'
);

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.organization_role_permissions', 'INSERT'),
  'authenticated users cannot create role-permission mappings'
);

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.organization_role_permissions', 'UPDATE'),
  'authenticated users cannot alter role-permission mappings'
);

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.organization_member_roles', 'INSERT'),
  'authenticated users cannot create member-role mappings'
);

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.organization_member_roles', 'DELETE'),
  'authenticated users cannot remove member-role mappings'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN (
        'organizations',
        'organization_members',
        'permissions',
        'organization_roles',
        'organization_role_permissions',
        'organization_member_roles',
        'platform_admins'
      )
      AND c.relrowsecurity
  ),
  7,
  'RLS is enabled on every Batch 1 table'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM permissions
  ),
  28,
  'the immutable permission catalogue contains all 28 Batch 1 capabilities'
);

SELECT * FROM finish();

ROLLBACK;
