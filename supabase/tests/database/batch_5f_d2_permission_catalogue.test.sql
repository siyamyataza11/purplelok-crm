BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(72);

CREATE TEMP TABLE batch_5f_d2_expected_permissions (
  key text PRIMARY KEY
);

INSERT INTO batch_5f_d2_expected_permissions (key)
SELECT pg_catalog.unnest(ARRAY[
  'members.read', 'members.manage', 'roles.read', 'roles.manage',
  'clients.read', 'clients.write', 'leads.read', 'leads.write',
  'projects.read', 'projects.write', 'projects.manage', 'tasks.read',
  'tasks.write', 'quotes.read', 'quotes.write', 'quotes.approve',
  'invoices.read', 'invoices.write', 'invoices.approve', 'payments.read',
  'payments.record', 'documents.read', 'documents.write', 'tickets.read',
  'tickets.write', 'reports.read', 'settings.read', 'settings.manage',
  'activities.read', 'collaboration.read', 'collaboration.write',
  'collaboration.manage'
]::text[]);

CREATE TEMP TABLE batch_5f_d2_expected_role_permissions (
  role_key text NOT NULL,
  permission_key text NOT NULL,
  PRIMARY KEY (role_key, permission_key)
);

INSERT INTO batch_5f_d2_expected_role_permissions (role_key, permission_key)
SELECT desired.role_key, expanded.permission_key
FROM (
  VALUES
    ('owner', ARRAY(SELECT key FROM batch_5f_d2_expected_permissions ORDER BY key)),
    ('admin', ARRAY(SELECT key FROM batch_5f_d2_expected_permissions ORDER BY key)),
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

CREATE FUNCTION pg_temp.batch_5f_d2_role_mapping_matches(p_role_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $function$
  SELECT NOT EXISTS (
    SELECT 1
    FROM public.organization_roles AS role
    WHERE role.is_system
      AND role.key = p_role_key
      AND EXISTS (
        (SELECT role_permission.permission_key
         FROM public.organization_role_permissions AS role_permission
         WHERE role_permission.organization_id = role.organization_id
           AND role_permission.organization_role_id = role.id
         EXCEPT
         SELECT expected.permission_key
         FROM pg_temp.batch_5f_d2_expected_role_permissions AS expected
         WHERE expected.role_key = p_role_key)
        UNION ALL
        (SELECT expected.permission_key
         FROM pg_temp.batch_5f_d2_expected_role_permissions AS expected
         WHERE expected.role_key = p_role_key
         EXCEPT
         SELECT role_permission.permission_key
         FROM public.organization_role_permissions AS role_permission
         WHERE role_permission.organization_id = role.organization_id
           AND role_permission.organization_role_id = role.id)
      )
  )
$function$;

CREATE FUNCTION pg_temp.batch_5f_d2_set_claims(
  p_user_id uuid,
  p_session_id uuid
)
RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', p_user_id::text, true);
  PERFORM pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object(
      'sub', p_user_id::text,
      'session_id', p_session_id::text,
      'role', 'authenticated',
      'purplelok_session_state', 'normal_v1'
    )::text,
    true
  );
END
$function$;

CREATE FUNCTION pg_temp.batch_5f_d2_permission_reference_rejected(
  p_permission_key text
)
RETURNS boolean
LANGUAGE plpgsql
AS $function$
DECLARE
  rejected_constraint text;
BEGIN
  INSERT INTO public.organization_role_permissions (
    organization_id,
    organization_role_id,
    permission_key
  )
  SELECT role.organization_id, role.id, p_permission_key
  FROM public.organization_roles AS role
  JOIN public.organizations AS organization
    ON organization.id = role.organization_id
  WHERE organization.slug = 'purplelok'
    AND role.key = 'staff'
    AND role.is_system;

  RETURN false;
EXCEPTION
  WHEN foreign_key_violation THEN
    GET STACKED DIAGNOSTICS rejected_constraint = CONSTRAINT_NAME;
    RETURN rejected_constraint =
      'organization_role_permissions_permission_key_fkey';
END
$function$;

SELECT pg_catalog.set_config(
  'batch_5f_d2.organization_id',
  (SELECT id::text FROM public.organizations WHERE slug = 'purplelok'),
  true
);

-- ============ CATALOGUE AND EXACT MAPPINGS ============

SELECT is((SELECT count(*)::integer FROM public.permissions), 32, 'permission catalogue contains exactly 32 keys');

SELECT set_eq(
  $$SELECT key FROM public.permissions WHERE key IN (
      'activities.read', 'collaboration.read', 'collaboration.write', 'collaboration.manage'
    )$$,
  ARRAY['activities.read', 'collaboration.manage', 'collaboration.read', 'collaboration.write']::text[],
  'the four D2 permission keys exist exactly once'
);

SELECT set_eq(
  'SELECT key FROM public.permissions',
  'SELECT key FROM pg_temp.batch_5f_d2_expected_permissions',
  'permission catalogue contains no missing or unknown keys'
);

SELECT is(
  (SELECT count(*)::integer FROM public.permissions
   WHERE key IN ('activities.read', 'collaboration.read', 'collaboration.write', 'collaboration.manage')
     AND pg_catalog.btrim(description) <> ''),
  4,
  'all four D2 permissions have nonblank descriptions'
);

SELECT is((SELECT min(mapping_count)::integer FROM (SELECT count(*) mapping_count FROM public.organization_roles r JOIN public.organization_role_permissions rp ON rp.organization_role_id=r.id AND rp.organization_id=r.organization_id WHERE r.is_system AND r.key='owner' GROUP BY r.id) x), 32, 'every Owner role has 32 permissions');
SELECT is((SELECT min(mapping_count)::integer FROM (SELECT count(*) mapping_count FROM public.organization_roles r JOIN public.organization_role_permissions rp ON rp.organization_role_id=r.id AND rp.organization_id=r.organization_id WHERE r.is_system AND r.key='admin' GROUP BY r.id) x), 32, 'every Admin role has 32 permissions');
SELECT is((SELECT min(mapping_count)::integer FROM (SELECT count(*) mapping_count FROM public.organization_roles r JOIN public.organization_role_permissions rp ON rp.organization_role_id=r.id AND rp.organization_id=r.organization_id WHERE r.is_system AND r.key='finance' GROUP BY r.id) x), 16, 'every Finance role has 16 permissions');
SELECT is((SELECT min(mapping_count)::integer FROM (SELECT count(*) mapping_count FROM public.organization_roles r JOIN public.organization_role_permissions rp ON rp.organization_role_id=r.id AND rp.organization_id=r.organization_id WHERE r.is_system AND r.key='project_manager' GROUP BY r.id) x), 15, 'every Project Manager role has 15 permissions');
SELECT is((SELECT min(mapping_count)::integer FROM (SELECT count(*) mapping_count FROM public.organization_roles r JOIN public.organization_role_permissions rp ON rp.organization_role_id=r.id AND rp.organization_id=r.organization_id WHERE r.is_system AND r.key='staff' GROUP BY r.id) x), 12, 'every Staff role has 12 permissions');
SELECT is((SELECT min(mapping_count)::integer FROM (SELECT count(*) mapping_count FROM public.organization_roles r JOIN public.organization_role_permissions rp ON rp.organization_role_id=r.id AND rp.organization_id=r.organization_id WHERE r.is_system AND r.key='client' GROUP BY r.id) x), 6, 'every Client role has 6 permissions');

SELECT ok(pg_temp.batch_5f_d2_role_mapping_matches('owner'), 'Owner mapping is the exact frozen set');
SELECT ok(pg_temp.batch_5f_d2_role_mapping_matches('admin'), 'Admin mapping is the exact frozen set');
SELECT ok(pg_temp.batch_5f_d2_role_mapping_matches('finance'), 'Finance mapping is the exact frozen set');
SELECT ok(pg_temp.batch_5f_d2_role_mapping_matches('project_manager'), 'Project Manager mapping is the exact frozen set');
SELECT ok(pg_temp.batch_5f_d2_role_mapping_matches('staff'), 'Staff mapping is the exact frozen set');
SELECT ok(pg_temp.batch_5f_d2_role_mapping_matches('client'), 'Client mapping is the exact frozen six-key set');

SELECT is(
  (SELECT count(*)::integer
   FROM public.organization_role_permissions AS role_permission
   JOIN public.organization_roles AS role
     ON role.id = role_permission.organization_role_id
    AND role.organization_id = role_permission.organization_id
   JOIN public.organizations AS organization
     ON organization.id = role.organization_id
   WHERE organization.slug = 'purplelok'
     AND role.key = 'finance'
     AND role_permission.permission_key = 'members.manage'),
  0,
  'D2 removes the disposable unauthorized Finance mapping'
);

SELECT is(
  (SELECT count(*)::integer
   FROM public.organization_role_permissions AS role_permission
   JOIN public.organization_roles AS role
     ON role.id = role_permission.organization_role_id
    AND role.organization_id = role_permission.organization_id
   JOIN public.organizations AS organization
     ON organization.id = role.organization_id
   WHERE organization.slug = 'purplelok'
     AND role.key = 'staff'
     AND role_permission.permission_key = 'tasks.read'),
  1,
  'D2 restores the disposable missing Staff mapping'
);

SELECT is((SELECT count(*)::integer FROM public.organization_roles WHERE is_system AND key='owner' AND EXISTS (SELECT 1 FROM public.organization_role_permissions rp WHERE rp.organization_role_id=organization_roles.id AND rp.permission_key='activities.read')), (SELECT count(*)::integer FROM public.organization_roles WHERE is_system AND key='owner'), 'Owner has activities.read');
SELECT is((SELECT count(*)::integer FROM public.organization_roles WHERE is_system AND key='admin' AND EXISTS (SELECT 1 FROM public.organization_role_permissions rp WHERE rp.organization_role_id=organization_roles.id AND rp.permission_key='activities.read')), (SELECT count(*)::integer FROM public.organization_roles WHERE is_system AND key='admin'), 'Admin has activities.read');
SELECT is((SELECT count(*)::integer FROM public.organization_roles r JOIN public.organization_role_permissions rp ON rp.organization_role_id=r.id WHERE r.key='finance' AND rp.permission_key='activities.read'), 0, 'Finance lacks activities.read');
SELECT is((SELECT count(*)::integer FROM public.organization_roles r JOIN public.organization_role_permissions rp ON rp.organization_role_id=r.id WHERE r.key='project_manager' AND rp.permission_key='activities.read'), 0, 'Project Manager lacks activities.read');
SELECT is((SELECT count(*)::integer FROM public.organization_roles r JOIN public.organization_role_permissions rp ON rp.organization_role_id=r.id WHERE r.key='staff' AND rp.permission_key='activities.read'), 0, 'Staff lacks activities.read');
SELECT is((SELECT count(*)::integer FROM public.organization_roles r JOIN public.organization_role_permissions rp ON rp.organization_role_id=r.id WHERE r.key='client' AND rp.permission_key='activities.read'), 0, 'Client lacks activities.read');

SELECT is((SELECT count(*)::integer FROM public.organization_roles r WHERE r.key='owner' AND EXISTS (SELECT 1 FROM public.organization_role_permissions rp WHERE rp.organization_role_id=r.id AND rp.permission_key='collaboration.manage')), (SELECT count(*)::integer FROM public.organization_roles WHERE key='owner'), 'Owner has collaboration.manage');
SELECT is((SELECT count(*)::integer FROM public.organization_roles r WHERE r.key='admin' AND EXISTS (SELECT 1 FROM public.organization_role_permissions rp WHERE rp.organization_role_id=r.id AND rp.permission_key='collaboration.manage')), (SELECT count(*)::integer FROM public.organization_roles WHERE key='admin'), 'Admin has collaboration.manage');
SELECT is((SELECT count(*)::integer FROM public.organization_roles r JOIN public.organization_role_permissions rp ON rp.organization_role_id=r.id WHERE r.key='project_manager' AND rp.permission_key='collaboration.manage'), 0, 'Project Manager lacks collaboration.manage');
SELECT is((SELECT count(*)::integer FROM public.organization_roles r JOIN public.organization_role_permissions rp ON rp.organization_role_id=r.id WHERE r.key='project_manager' AND rp.permission_key IN ('collaboration.read','collaboration.write')), (SELECT count(*)::integer * 2 FROM public.organization_roles WHERE key='project_manager'), 'Project Manager has collaboration read and write');
SELECT is((SELECT count(*)::integer FROM public.organization_roles r JOIN public.organization_role_permissions rp ON rp.organization_role_id=r.id WHERE r.key='finance' AND rp.permission_key IN ('collaboration.read','collaboration.write')), (SELECT count(*)::integer * 2 FROM public.organization_roles WHERE key='finance'), 'Finance has collaboration read and write');
SELECT is((SELECT count(*)::integer FROM public.organization_roles r WHERE r.key='finance' AND EXISTS (SELECT 1 FROM public.organization_role_permissions rp WHERE rp.organization_role_id=r.id AND rp.permission_key='collaboration.manage')), 0, 'Finance lacks collaboration.manage');
SELECT is((SELECT count(*)::integer FROM public.organization_roles r JOIN public.organization_role_permissions rp ON rp.organization_role_id=r.id WHERE r.key='staff' AND rp.permission_key IN ('collaboration.read','collaboration.write')), (SELECT count(*)::integer * 2 FROM public.organization_roles WHERE key='staff'), 'Staff has collaboration read and write');
SELECT is((SELECT count(*)::integer FROM public.organization_roles r WHERE r.key='staff' AND EXISTS (SELECT 1 FROM public.organization_role_permissions rp WHERE rp.organization_role_id=r.id AND rp.permission_key='collaboration.manage')), 0, 'Staff lacks collaboration.manage');
SELECT is((SELECT count(*)::integer FROM public.organization_roles r JOIN public.organization_role_permissions rp ON rp.organization_role_id=r.id WHERE r.key='client' AND rp.permission_key='collaboration.read'), 0, 'Client lacks collaboration.read');
SELECT is((SELECT count(*)::integer FROM public.organization_roles r JOIN public.organization_role_permissions rp ON rp.organization_role_id=r.id WHERE r.key='client' AND rp.permission_key='collaboration.write'), 0, 'Client lacks collaboration.write');
SELECT is((SELECT count(*)::integer FROM public.organization_roles r JOIN public.organization_role_permissions rp ON rp.organization_role_id=r.id WHERE r.key='client' AND rp.permission_key='collaboration.manage'), 0, 'Client lacks collaboration.manage');

-- ============ DATABASE PROTECTION ============

SELECT is(
  (SELECT count(*)::integer
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
    AND function_namespace.nspname = expected.function_schema),
  3,
  'all three D2 protection triggers have exact bindings, events, row timing, and ordinary state'
);

SELECT is(
  (SELECT count(*)::integer
   FROM pg_catalog.pg_proc AS procedure
   WHERE procedure.oid IN (
     'private.purplelok_protect_system_role_identity()'::regprocedure,
     'private.purplelok_reject_client_role_assignment()'::regprocedure,
     'private.purplelok_restrict_client_permissions()'::regprocedure
   ) AND procedure.prosecdef
     AND procedure.provolatile='v'
     AND pg_catalog.pg_get_userbyid(procedure.proowner)='postgres'
     AND procedure.proconfig @> ARRAY['search_path=""','row_security=off']::text[]),
  3,
  'D2 trigger functions are hardened postgres-owned SECURITY DEFINER functions'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      coalesce(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
    ) AS privilege
    WHERE procedure.oid IN (
      'private.purplelok_protect_system_role_identity()'::regprocedure,
      'private.purplelok_reject_client_role_assignment()'::regprocedure,
      'private.purplelok_restrict_client_permissions()'::regprocedure
    )
      AND privilege.privilege_type = 'EXECUTE'
      AND privilege.grantee IN (
        0::oid,
        'anon'::regrole::oid,
        'authenticated'::regrole::oid,
        'service_role'::regrole::oid,
        'supabase_auth_admin'::regrole::oid
      )
  ),
  'PUBLIC, browser, service, and Auth roles cannot execute any D2 trigger function directly'
);

SELECT throws_ok(
  $$UPDATE public.organization_roles SET key='former_client'
    WHERE organization_id=(SELECT id FROM public.organizations WHERE slug='purplelok') AND key='client'$$,
  '42501', 'System role identity is immutable', 'Client role key cannot be renamed'
);
SELECT throws_ok(
  $$UPDATE public.organization_roles SET is_system=false
    WHERE organization_id=(SELECT id FROM public.organizations WHERE slug='purplelok') AND key='client'$$,
  '42501', 'System role identity is immutable', 'Client system identity cannot be downgraded'
);
SELECT throws_ok(
  $$DELETE FROM public.organization_roles
    WHERE organization_id=(SELECT id FROM public.organizations WHERE slug='purplelok') AND key='client'$$,
  '42501', 'System roles cannot be deleted', 'system Client role cannot be deleted'
);
SELECT throws_ok(
  $$UPDATE public.organization_roles SET key='former_staff'
    WHERE organization_id=(SELECT id FROM public.organizations WHERE slug='purplelok') AND key='staff'$$,
  '42501', 'System role identity is immutable', 'all canonical system role keys are immutable'
);

INSERT INTO public.organization_roles (id,organization_id,name,key,is_system)
SELECT '00000000-0000-0000-0000-00000005d901',id,'D2 Custom','d2_custom',false
FROM public.organizations WHERE slug='purplelok';
SELECT lives_ok(
  $$UPDATE public.organization_roles SET key='d2_custom_renamed'
    WHERE id='00000000-0000-0000-0000-00000005d901'$$,
  'custom role keys remain editable'
);

INSERT INTO public.organizations (id,name,slug,status)
VALUES (
  '00000000-0000-0000-0000-00000005d902',
  'D2 Role Move Target',
  'd2-role-move-target',
  'active'
);

SELECT throws_ok(
  $$UPDATE public.organization_roles
    SET organization_id='00000000-0000-0000-0000-00000005d902'
    WHERE organization_id=(SELECT id FROM public.organizations WHERE slug='purplelok')
      AND key='client'$$,
  '42501',
  'System role identity is immutable',
  'a system role cannot move to another organization'
);

SELECT is(
  (SELECT organization.slug
   FROM public.organization_roles AS role
   JOIN public.organizations AS organization
     ON organization.id = role.organization_id
   WHERE role.key = 'client'
     AND organization.slug = 'purplelok'),
  'purplelok',
  'the rejected system-role move leaves its organization unchanged'
);

SELECT lives_ok(
  $$UPDATE public.organization_roles
    SET organization_id='00000000-0000-0000-0000-00000005d902'
    WHERE id='00000000-0000-0000-0000-00000005d901'$$,
  'a custom role remains movable between organizations'
);

INSERT INTO public.organizations (id,name,slug,status)
VALUES (
  '00000000-0000-0000-0000-00000005d903',
  'D2 Cascade Fixture',
  'd2-cascade-fixture',
  'active'
);

INSERT INTO public.organization_roles (
  id,
  organization_id,
  name,
  key,
  is_system
)
SELECT fixture.id,
       '00000000-0000-0000-0000-00000005d903',
       fixture.name,
       fixture.key,
       true
FROM (VALUES
  ('00000000-0000-0000-0000-00000005d904'::uuid, 'Owner', 'owner'),
  ('00000000-0000-0000-0000-00000005d905'::uuid, 'Admin', 'admin'),
  ('00000000-0000-0000-0000-00000005d906'::uuid, 'Finance', 'finance'),
  ('00000000-0000-0000-0000-00000005d907'::uuid, 'Project Manager', 'project_manager'),
  ('00000000-0000-0000-0000-00000005d908'::uuid, 'Staff', 'staff'),
  ('00000000-0000-0000-0000-00000005d909'::uuid, 'Client', 'client')
) AS fixture(id,name,key);

INSERT INTO public.organization_role_permissions (
  organization_id,
  organization_role_id,
  permission_key
)
SELECT role.organization_id, role.id, expected.permission_key
FROM public.organization_roles AS role
JOIN pg_temp.batch_5f_d2_expected_role_permissions AS expected
  ON expected.role_key = role.key
WHERE role.organization_id = '00000000-0000-0000-0000-00000005d903';

SELECT is(
  (SELECT count(*)::integer
   FROM public.organization_roles
   WHERE organization_id='00000000-0000-0000-0000-00000005d903'
     AND is_system),
  6,
  'cascade fixture has the canonical six system roles'
);

SELECT lives_ok(
  $$DELETE FROM public.organizations
    WHERE id='00000000-0000-0000-0000-00000005d903'$$,
  'deleting an organization is not blocked by system-role protection'
);

SELECT is(
  (SELECT count(*)::integer
   FROM public.organizations
   WHERE id='00000000-0000-0000-0000-00000005d903'),
  0,
  'the disposable cascade organization is deleted'
);

SELECT is(
  (SELECT count(*)::integer
   FROM public.organization_roles
   WHERE organization_id='00000000-0000-0000-0000-00000005d903'),
  0,
  'the parent delete cascades through all protected system roles'
);

SELECT throws_ok(
  $$INSERT INTO public.organization_role_permissions (organization_id,organization_role_id,permission_key)
    SELECT organization_id,id,'activities.read' FROM public.organization_roles
    WHERE organization_id=(SELECT id FROM public.organizations WHERE slug='purplelok') AND key='client'$$,
  '42501', 'Client role cannot receive internal permissions', 'Client cannot receive an unauthorized internal permission'
);
SELECT throws_ok(
  $$INSERT INTO public.organization_role_permissions (organization_id,organization_role_id,permission_key)
    SELECT organization_id,id,'members.manage' FROM public.organization_roles
    WHERE organization_id=(SELECT id FROM public.organizations WHERE slug='purplelok') AND key='client'$$,
  '42501', 'Client role cannot receive internal permissions', 'Client cannot receive members.manage'
);
SELECT throws_ok(
  $$UPDATE public.organization_role_permissions SET permission_key='collaboration.read'
    WHERE organization_role_id=(SELECT id FROM public.organization_roles WHERE organization_id=(SELECT id FROM public.organizations WHERE slug='purplelok') AND key='client')
      AND permission_key='projects.read'$$,
  '42501', 'Client role cannot receive internal permissions', 'Client mapping cannot be rewritten to an internal permission'
);

SELECT ok(
  pg_temp.batch_5f_d2_permission_reference_rejected('unknown.permission'),
  'an unknown permission reference is rejected by the exact permission foreign key'
);

SELECT ok(
  pg_temp.batch_5f_d2_permission_reference_rejected('malformed permission key'),
  'a malformed permission reference is rejected by the exact permission foreign key'
);

-- ============ D1 COMPATIBILITY ============

INSERT INTO auth.users (id,email,raw_user_meta_data) VALUES
  ('00000000-0000-0000-0000-00000005d911','d2-owner@example.test','{}'::jsonb),
  ('00000000-0000-0000-0000-00000005d912','d2-staff@example.test','{}'::jsonb),
  ('00000000-0000-0000-0000-00000005d913','d2-client@example.test','{}'::jsonb),
  ('00000000-0000-0000-0000-00000005d914','d2-platform@example.test','{}'::jsonb);

INSERT INTO auth.sessions (id,user_id) VALUES
  ('00000000-0000-0000-0000-00000005d921','00000000-0000-0000-0000-00000005d911'),
  ('00000000-0000-0000-0000-00000005d922','00000000-0000-0000-0000-00000005d912'),
  ('00000000-0000-0000-0000-00000005d923','00000000-0000-0000-0000-00000005d913'),
  ('00000000-0000-0000-0000-00000005d924','00000000-0000-0000-0000-00000005d914');

INSERT INTO public.organization_members (id,organization_id,user_id,status)
SELECT fixture.id,organization.id,fixture.user_id,'active'
FROM public.organizations AS organization
CROSS JOIN (VALUES
  ('00000000-0000-0000-0000-00000005d931'::uuid,'00000000-0000-0000-0000-00000005d911'::uuid),
  ('00000000-0000-0000-0000-00000005d932'::uuid,'00000000-0000-0000-0000-00000005d912'::uuid),
  ('00000000-0000-0000-0000-00000005d933'::uuid,'00000000-0000-0000-0000-00000005d913'::uuid)
) AS fixture(id,user_id)
WHERE organization.slug='purplelok';

INSERT INTO public.organization_member_roles (organization_id,organization_member_id,organization_role_id)
SELECT organization.id,'00000000-0000-0000-0000-00000005d931',role.id
FROM public.organizations AS organization
JOIN public.organization_roles AS role ON role.organization_id=organization.id AND role.key='owner'
WHERE organization.slug='purplelok';

INSERT INTO public.organization_member_roles (organization_id,organization_member_id,organization_role_id)
SELECT organization.id,'00000000-0000-0000-0000-00000005d932',role.id
FROM public.organizations AS organization
JOIN public.organization_roles AS role ON role.organization_id=organization.id AND role.key='staff'
WHERE organization.slug='purplelok';

SELECT throws_ok(
  $$INSERT INTO public.organization_member_roles (organization_id,organization_member_id,organization_role_id)
    SELECT organization.id,'00000000-0000-0000-0000-00000005d933',role.id
    FROM public.organizations AS organization
    JOIN public.organization_roles AS role ON role.organization_id=organization.id AND role.key='client'
    WHERE organization.slug='purplelok'$$,
  '42501',
  'Client role assignment is disabled until client-scoped authorization exists',
  'Client role assignment is rejected'
);

SELECT throws_ok(
  $$UPDATE public.organization_member_roles
    SET organization_role_id=(SELECT id FROM public.organization_roles WHERE organization_id=organization_member_roles.organization_id AND key='client')
    WHERE organization_member_id='00000000-0000-0000-0000-00000005d932'$$,
  '42501',
  'Client role assignment is disabled until client-scoped authorization exists',
  'an internal assignment cannot be changed into Client authority'
);

ALTER TABLE public.organization_member_roles
  DISABLE TRIGGER organization_member_roles_reject_client;
INSERT INTO public.organization_member_roles (organization_id,organization_member_id,organization_role_id)
SELECT organization.id,'00000000-0000-0000-0000-00000005d933',role.id
FROM public.organizations AS organization
JOIN public.organization_roles AS role ON role.organization_id=organization.id AND role.key='client'
WHERE organization.slug='purplelok';
ALTER TABLE public.organization_member_roles
  ENABLE TRIGGER organization_member_roles_reject_client;

INSERT INTO public.platform_admins (user_id,status)
VALUES ('00000000-0000-0000-0000-00000005d914','active');

SELECT pg_temp.batch_5f_d2_set_claims('00000000-0000-0000-0000-00000005d911','00000000-0000-0000-0000-00000005d921');
SET LOCAL ROLE authenticated;
SELECT is(private.purplelok_has_permission(pg_catalog.current_setting('batch_5f_d2.organization_id')::uuid,'activities.read'),true,'D1 resolves Owner activities.read');
SELECT is(private.purplelok_has_permission(pg_catalog.current_setting('batch_5f_d2.organization_id')::uuid,'collaboration.read'),true,'D1 resolves Owner collaboration.read');
SELECT is(private.purplelok_has_permission(pg_catalog.current_setting('batch_5f_d2.organization_id')::uuid,'collaboration.write'),true,'D1 resolves Owner collaboration.write');
SELECT is(private.purplelok_has_permission(pg_catalog.current_setting('batch_5f_d2.organization_id')::uuid,'collaboration.manage'),true,'D1 resolves Owner collaboration.manage');
RESET ROLE;

SELECT pg_temp.batch_5f_d2_set_claims('00000000-0000-0000-0000-00000005d912','00000000-0000-0000-0000-00000005d922');
SET LOCAL ROLE authenticated;
SELECT is(private.purplelok_has_permission(pg_catalog.current_setting('batch_5f_d2.organization_id')::uuid,'collaboration.read'),true,'D1 resolves Staff collaboration.read');
SELECT is(private.purplelok_has_permission(pg_catalog.current_setting('batch_5f_d2.organization_id')::uuid,'collaboration.manage'),false,'D1 denies Staff collaboration.manage');
SELECT is(private.purplelok_has_permission(pg_catalog.current_setting('batch_5f_d2.organization_id')::uuid,'activities.read'),false,'D1 denies Staff activities.read');
RESET ROLE;

SELECT pg_temp.batch_5f_d2_set_claims('00000000-0000-0000-0000-00000005d913','00000000-0000-0000-0000-00000005d923');
SET LOCAL ROLE authenticated;
SELECT is(private.purplelok_has_active_membership(pg_catalog.current_setting('batch_5f_d2.organization_id')::uuid),false,'D1 still denies Client-only membership');
SELECT is(private.purplelok_has_permission(pg_catalog.current_setting('batch_5f_d2.organization_id')::uuid,'projects.read'),false,'D1 Client role cannot use its catalogue mapping');
RESET ROLE;

SELECT pg_temp.batch_5f_d2_set_claims('00000000-0000-0000-0000-00000005d914','00000000-0000-0000-0000-00000005d924');
SET LOCAL ROLE authenticated;
SELECT is(private.purplelok_has_permission(pg_catalog.current_setting('batch_5f_d2.organization_id')::uuid,'clients.read'),false,'platform administrator row does not bypass D1 organization authority');
RESET ROLE;

SELECT is(
  (SELECT tgenabled FROM pg_catalog.pg_trigger
   WHERE tgrelid='public.organization_member_roles'::regclass
     AND tgname='organization_member_roles_reject_client'),
  'O'::"char",
  'Client assignment trigger is restored after the isolated D1 compatibility fixture'
);

-- ============ DOMAIN AND PLATFORM REGRESSION ============

SELECT is((SELECT count(*)::integer FROM public.organization_member_roles mr JOIN public.organization_roles r ON r.id=mr.organization_role_id AND r.organization_id=mr.organization_id WHERE r.key='client') - 1, 0, 'no pre-existing Client assignment exists');
SELECT is((SELECT count(*)::integer FROM public.platform_admins) - 1, 0, 'D2 does not create a platform administrator');
SELECT is((SELECT count(*)::integer FROM pg_catalog.pg_policies WHERE schemaname='public' AND tablename=ANY(ARRAY['clients','client_contacts','client_notes','leads','quotes','quote_items','invoices','invoice_items','payments','projects','project_milestones','tasks','task_comments','meetings','documents','tickets','ticket_messages','activities','notifications','channels','messages'])),84,'D2 leaves all 84 domain policies in place');
SELECT is(
  (SELECT pg_catalog.md5(pg_catalog.string_agg(
    pg_catalog.format('%s|%s|%s|%s|%s|%s|%s',schemaname,tablename,policyname,permissive,roles::text,cmd,coalesce(qual,'')||'|'||coalesce(with_check,'')),
    E'\n' ORDER BY schemaname,tablename,policyname))
   FROM pg_catalog.pg_policies
   WHERE schemaname='public' AND tablename=ANY(ARRAY['clients','client_contacts','client_notes','leads','quotes','quote_items','invoices','invoice_items','payments','projects','project_milestones','tasks','task_comments','meetings','documents','tickets','ticket_messages','activities','notifications','channels','messages'])),
  'eb744436bf76a7cc18e32b06734b5478',
  'canonical domain policy fingerprint is unchanged'
);

SELECT * FROM finish();

ROLLBACK;
