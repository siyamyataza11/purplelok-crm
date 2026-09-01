BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(42);

CREATE TEMP TABLE batch_5e_b2r_snapshot AS
SELECT
  (SELECT count(*) FROM public.platform_admins) AS platform_admins,
  jsonb_build_object(
    'permissions', (SELECT count(*) FROM public.permissions),
    'organization_roles', (SELECT count(*) FROM public.organization_roles),
    'organization_role_permissions', (SELECT count(*) FROM public.organization_role_permissions),
    'organization_member_roles', (SELECT count(*) FROM public.organization_member_roles)
  ) AS rbac_counts;

INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES
  ('00000000-0000-0000-0000-00000005e201', 'batch5e-b2r-self@example.test', '{"full_name":"Batch 5E Self"}'::jsonb),
  ('00000000-0000-0000-0000-00000005e202', 'batch5e-b2r-other@example.test', '{"full_name":"Batch 5E Other"}'::jsonb);

UPDATE public.profiles
SET active = false
WHERE id = '00000000-0000-0000-0000-00000005e202';

-- ============ EXACT LEGACY POLICY PREFLIGHT REGRESSION ============

SELECT ok(
  (SELECT NOT procedure.prosecdef
       AND procedure.provolatile = 's'
       AND pg_get_userbyid(procedure.proowner) = 'postgres'
       AND EXISTS (
         SELECT 1
         FROM unnest(procedure.proconfig) AS setting
         WHERE setting ~ '^search_path=(""|)$'
       )
   FROM pg_proc AS procedure
   WHERE procedure.oid = 'private.batch_5e_b2r_profile_policy_baseline_matches()'::regprocedure)
  AND NOT has_function_privilege(
    'authenticated',
    'private.batch_5e_b2r_profile_policy_baseline_matches()',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'private.batch_5e_b2r_profile_policy_baseline_matches()',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'private.batch_5e_b2r_profile_policy_baseline_matches()',
    'EXECUTE'
  ),
  'exact policy-baseline helper is invoker-only, postgres-owned, search-path controlled, and browser-inaccessible'
);

CREATE POLICY profiles_insert ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (true);
CREATE POLICY profiles_update ON public.profiles
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);
CREATE POLICY profiles_delete ON public.profiles
  FOR DELETE TO authenticated
  USING (true);

SELECT ok(
  private.batch_5e_b2r_profile_policy_baseline_matches(),
  'exact approved permissive profile mutation-policy baseline succeeds'
);

DROP POLICY profiles_insert ON public.profiles;
CREATE POLICY profiles_insert ON public.profiles
  AS RESTRICTIVE
  FOR INSERT TO authenticated
  WITH CHECK (true);
SELECT ok(
  NOT private.batch_5e_b2r_profile_policy_baseline_matches(),
  'restrictive replacement of an expected profile policy fails closed'
);
DROP POLICY profiles_insert ON public.profiles;
CREATE POLICY profiles_insert ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY profiles_update_unexpected ON public.profiles
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);
SELECT ok(
  NOT private.batch_5e_b2r_profile_policy_baseline_matches(),
  'an additional profile mutation policy fails the exact-set preflight'
);
DROP POLICY profiles_update_unexpected ON public.profiles;

DROP POLICY profiles_delete ON public.profiles;
SELECT ok(
  NOT private.batch_5e_b2r_profile_policy_baseline_matches(),
  'a missing expected profile mutation policy fails the exact-set preflight'
);

DROP POLICY profiles_insert ON public.profiles;
DROP POLICY profiles_update ON public.profiles;

-- ============ CATALOGUE / ACL ============

SELECT is(
  (SELECT count(*)::integer
   FROM pg_proc AS procedure
   JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
   WHERE namespace.nspname = 'public'
     AND procedure.proname = 'update_own_profile'
     AND procedure.proargtypes = '25 25 25 25'::oidvector),
  1,
  'self-profile function exists exactly once'
);

SELECT ok(
  (SELECT procedure.prosecdef
       AND procedure.provolatile = 'v'
       AND pg_get_userbyid(procedure.proowner) = 'postgres'
   FROM pg_proc AS procedure
   WHERE procedure.oid = 'public.update_own_profile(text,text,text,text)'::regprocedure),
  'self-profile function is volatile SECURITY DEFINER owned by postgres'
);

SELECT ok(
  (SELECT procedure.proconfig @> ARRAY['row_security=off']::text[]
       AND EXISTS (
         SELECT 1
         FROM unnest(procedure.proconfig) AS setting
         WHERE setting ~ '^search_path=(""|)$'
       )
   FROM pg_proc AS procedure
   WHERE procedure.oid = 'public.update_own_profile(text,text,text,text)'::regprocedure),
  'self-profile function has empty search_path and row_security off'
);

SELECT is(
  (SELECT procedure.proargnames[1:4]
   FROM pg_proc AS procedure
   WHERE procedure.oid = 'public.update_own_profile(text,text,text,text)'::regprocedure),
  ARRAY['p_full_name', 'p_phone', 'p_position', 'p_avatar_url']::text[],
  'self-profile function accepts only four explicit presentation parameters'
);

SELECT is(
  (SELECT array_agg(argument.name ORDER BY argument.ordinality)::text
   FROM pg_proc AS procedure
   CROSS JOIN LATERAL unnest(procedure.proargnames, procedure.proargmodes)
     WITH ORDINALITY AS argument(name, mode, ordinality)
   WHERE procedure.oid = 'public.update_own_profile(text,text,text,text)'::regprocedure
     AND argument.mode = 't'),
  ARRAY['id', 'full_name', 'phone', 'position', 'avatar_url', 'updated_at']::text[]::text,
  'self-profile function returns only identity and presentation fields'
);

SELECT ok(has_function_privilege('authenticated', 'public.update_own_profile(text,text,text,text)', 'EXECUTE'), 'authenticated can execute self-profile function');
SELECT is(
  (SELECT count(*)::integer
   FROM pg_proc AS procedure
   CROSS JOIN LATERAL aclexplode(COALESCE(procedure.proacl, acldefault('f', procedure.proowner))) AS acl
   WHERE procedure.oid = 'public.update_own_profile(text,text,text,text)'::regprocedure
     AND acl.grantee = 0
     AND acl.privilege_type = 'EXECUTE'),
  0,
  'PUBLIC cannot execute self-profile function'
);
SELECT ok(NOT has_function_privilege('anon', 'public.update_own_profile(text,text,text,text)', 'EXECUTE'), 'anon cannot execute self-profile function');
SELECT ok(NOT has_function_privilege('service_role', 'public.update_own_profile(text,text,text,text)', 'EXECUTE'), 'service_role cannot execute self-profile function');

SELECT ok(NOT has_table_privilege('authenticated', 'public.profiles', 'INSERT'), 'authenticated has no direct profile INSERT');
SELECT ok(NOT has_table_privilege('authenticated', 'public.profiles', 'UPDATE'), 'authenticated has no direct profile UPDATE');
SELECT ok(NOT has_table_privilege('authenticated', 'public.profiles', 'DELETE'), 'authenticated has no direct profile DELETE');
SELECT ok(NOT has_column_privilege('authenticated', 'public.profiles', 'active', 'UPDATE'), 'authenticated cannot update profile active');
SELECT ok(NOT has_column_privilege('authenticated', 'public.profiles', 'role', 'UPDATE'), 'authenticated cannot update legacy profile role');
SELECT ok(NOT has_column_privilege('authenticated', 'public.profiles', 'id', 'UPDATE'), 'authenticated cannot update profile identity linkage');

SELECT is(
  (SELECT count(*)::integer
   FROM pg_policies AS policy
   WHERE policy.schemaname = 'public'
     AND policy.tablename = 'profiles'
     AND policy.cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
     AND 'authenticated' = ANY(policy.roles)),
  0,
  'no authenticated profile mutation policy remains'
);

SELECT is(
  (SELECT count(*)::integer
   FROM pg_policies AS policy
   WHERE policy.schemaname = 'public'
     AND policy.tablename = 'profiles'
     AND policy.policyname = 'profiles_select'
     AND policy.cmd = 'SELECT'
     AND policy.qual = 'true'),
  1,
  'legacy profile SELECT behavior is unchanged by this containment migration'
);

-- ============ AUTHENTICATED ATTACKS ============

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000005e202', true);
SELECT throws_ok(
  $$UPDATE public.profiles SET active = true WHERE id = '00000000-0000-0000-0000-00000005e202'$$,
  '42501', NULL,
  'inactive authenticated user cannot reactivate their own profile directly'
);
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000005e201', true);
SELECT throws_ok($$UPDATE public.profiles SET role = 'super_admin' WHERE id = '00000000-0000-0000-0000-00000005e201'$$, '42501', NULL, 'authenticated user cannot change own legacy role');
SELECT throws_ok($$UPDATE public.profiles SET active = true WHERE id = '00000000-0000-0000-0000-00000005e202'$$, '42501', NULL, 'authenticated user cannot activate another profile');
SELECT throws_ok($$UPDATE public.profiles SET full_name = 'Forged Other' WHERE id = '00000000-0000-0000-0000-00000005e202'$$, '42501', NULL, 'authenticated user cannot update another profile presentation field');
SELECT throws_ok($$DELETE FROM public.profiles WHERE id = '00000000-0000-0000-0000-00000005e201'$$, '42501', NULL, 'authenticated user cannot delete own profile');
SELECT throws_ok($$DELETE FROM public.profiles WHERE id = '00000000-0000-0000-0000-00000005e202'$$, '42501', NULL, 'authenticated user cannot delete another profile');
SELECT throws_ok($$INSERT INTO public.profiles (id, email, full_name) VALUES ('00000000-0000-0000-0000-00000005e2ff', 'forged@example.test', 'Forged')$$, '42501', NULL, 'authenticated user cannot insert an arbitrary profile');
SELECT throws_ok($$UPDATE public.profiles SET id = '00000000-0000-0000-0000-00000005e2fe' WHERE id = '00000000-0000-0000-0000-00000005e201'$$, '42501', NULL, 'authenticated user cannot change own profile id');

SELECT is(
  (SELECT count(*)::integer
   FROM public.update_own_profile('Updated Self', '+27 10 000 0000', 'Designer', 'https://example.test/avatar.png')),
  1,
  'authenticated active user can update own safe presentation fields through the RPC'
);
RESET ROLE;

SELECT is(
  (SELECT jsonb_build_object(
     'full_name', full_name,
     'phone', phone,
     'position', position,
     'avatar_url', avatar_url
   )
   FROM public.profiles
   WHERE id = '00000000-0000-0000-0000-00000005e201'),
  jsonb_build_object(
    'full_name', 'Updated Self',
    'phone', '+27 10 000 0000',
    'position', 'Designer',
    'avatar_url', 'https://example.test/avatar.png'
  ),
  'safe RPC writes exactly the four approved presentation fields'
);

SELECT is(
  (SELECT jsonb_build_object('active', active, 'role', role, 'email', email, 'id', id)
   FROM public.profiles
   WHERE id = '00000000-0000-0000-0000-00000005e201'),
  jsonb_build_object(
    'active', true,
    'role', 'staff',
    'email', 'batch5e-b2r-self@example.test',
    'id', '00000000-0000-0000-0000-00000005e201'::uuid
  ),
  'safe RPC leaves all authority and identity fields unchanged'
);

SELECT is(
  (SELECT full_name FROM public.profiles WHERE id = '00000000-0000-0000-0000-00000005e202'),
  'Batch 5E Other',
  'self-profile RPC cannot change another profile'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000005e202', true);
SELECT throws_ok(
  $$SELECT * FROM public.update_own_profile('Reactivated', NULL, NULL, NULL)$$,
  '42501', 'Active profile access is required',
  'inactive profile cannot use the self-service RPC'
);
RESET ROLE;

SELECT ok(
  pg_get_functiondef('public.update_own_profile(text,text,text,text)'::regprocedure) !~* 'set\s+(public\.)?active\s*='
  AND pg_get_functiondef('public.update_own_profile(text,text,text,text)'::regprocedure) !~* 'set\s+(public\.)?role\s*='
  AND pg_get_functiondef('public.update_own_profile(text,text,text,text)'::regprocedure) LIKE '%profile.id = caller_id%',
  'self-profile function definition cannot mutate authority or choose a target user'
);

SELECT ok(
  (SELECT procedure.prosecdef AND pg_get_userbyid(procedure.proowner) = 'postgres'
   FROM pg_proc AS procedure
   WHERE procedure.oid = 'public.handle_new_user()'::regprocedure),
  'trusted Auth profile-creation function remains SECURITY DEFINER and postgres-owned'
);

SELECT is(
  (SELECT count(*)::integer
   FROM pg_trigger AS trigger
   JOIN pg_class AS relation ON relation.oid = trigger.tgrelid
   JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
   WHERE namespace.nspname = 'auth'
     AND relation.relname = 'users'
     AND trigger.tgname = 'on_auth_user_created'
     AND NOT trigger.tgisinternal
     AND trigger.tgenabled = 'O'
     AND trigger.tgfoid = 'public.handle_new_user()'::regprocedure),
  1,
  'Auth user creation trigger remains enabled and bound to handle_new_user'
);

INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES ('00000000-0000-0000-0000-00000005e203', 'batch5e-b2r-trigger@example.test', '{"full_name":"Trigger Profile"}'::jsonb);

SELECT is(
  (SELECT count(*)::integer
   FROM public.profiles
   WHERE id = '00000000-0000-0000-0000-00000005e203'
     AND email = 'batch5e-b2r-trigger@example.test'
     AND full_name = 'Trigger Profile'),
  1,
  'trusted Auth trigger can still create the initial profile'
);

SELECT is((SELECT count(*) FROM public.platform_admins), (SELECT platform_admins FROM batch_5e_b2r_snapshot), 'platform administrators are unchanged');

SELECT is(
  jsonb_build_object(
    'permissions', (SELECT count(*) FROM public.permissions),
    'organization_roles', (SELECT count(*) FROM public.organization_roles),
    'organization_role_permissions', (SELECT count(*) FROM public.organization_role_permissions),
    'organization_member_roles', (SELECT count(*) FROM public.organization_member_roles)
  ),
  (SELECT rbac_counts FROM batch_5e_b2r_snapshot),
  'organization RBAC tables are unchanged'
);

SELECT is(
  (SELECT count(*)::integer
   FROM pg_policies AS policy
   WHERE policy.schemaname = 'public'
     AND policy.tablename = ANY(ARRAY[
       'clients', 'client_contacts', 'client_notes', 'leads', 'quotes',
       'quote_items', 'invoices', 'invoice_items', 'payments', 'projects',
       'project_milestones', 'tasks', 'task_comments', 'meetings', 'documents',
       'tickets', 'ticket_messages', 'activities', 'notifications', 'channels',
       'messages'
     ])),
  84,
  'all 84 legacy domain policies remain unchanged in count'
);

SELECT * FROM finish();

ROLLBACK;
