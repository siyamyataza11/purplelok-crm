BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(54);

-- ============ TABLE / COLUMN CATALOGUE ============

SELECT has_table('private', 'auth_session_gates', 'permanent Auth session gate table exists');

SELECT is(
  (SELECT array_agg(
      attribute.attname || ':' || pg_catalog.format_type(attribute.atttypid, attribute.atttypmod)
      || ':' || attribute.attnotnull::text
      ORDER BY attribute.attnum
    )::text
     FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = 'private.auth_session_gates'::regclass
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped),
  ARRAY[
    'session_id:uuid:true',
    'user_id:uuid:true',
    'gate_type:text:true',
    'created_at:timestamp with time zone:true',
    'last_observed_at:timestamp with time zone:true',
    'observed_refresh:boolean:true'
  ]::text[]::text,
  'gate table has exactly the six approved columns, types, order, and nullability'
);

SELECT extensions.alike(
  (SELECT pg_catalog.pg_get_expr(default_row.adbin, default_row.adrelid)
     FROM pg_catalog.pg_attrdef AS default_row
     JOIN pg_catalog.pg_attribute AS attribute
       ON attribute.attrelid = default_row.adrelid
      AND attribute.attnum = default_row.adnum
    WHERE default_row.adrelid = 'private.auth_session_gates'::regclass
      AND attribute.attname = 'created_at'),
  '%clock_timestamp()%'::text,
  'created_at defaults to clock_timestamp()'::text
);

SELECT extensions.alike(
  (SELECT pg_catalog.pg_get_expr(default_row.adbin, default_row.adrelid)
     FROM pg_catalog.pg_attrdef AS default_row
     JOIN pg_catalog.pg_attribute AS attribute
       ON attribute.attrelid = default_row.adrelid
      AND attribute.attnum = default_row.adnum
    WHERE default_row.adrelid = 'private.auth_session_gates'::regclass
      AND attribute.attname = 'last_observed_at'),
  '%clock_timestamp()%'::text,
  'last_observed_at defaults to clock_timestamp()'::text
);

SELECT is(
  (SELECT pg_catalog.pg_get_expr(default_row.adbin, default_row.adrelid)
     FROM pg_catalog.pg_attrdef AS default_row
     JOIN pg_catalog.pg_attribute AS attribute
       ON attribute.attrelid = default_row.adrelid
      AND attribute.attnum = default_row.adnum
    WHERE default_row.adrelid = 'private.auth_session_gates'::regclass
      AND attribute.attname = 'observed_refresh'),
  'false',
  'observed_refresh defaults to false'
);

SELECT is(
  (SELECT count(*)::integer
     FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'private.auth_session_gates'::regclass
      AND constraint_row.contype = 'p'),
  1,
  'gate table has one primary key'
);

SELECT extensions.alike(
  (SELECT pg_catalog.pg_get_constraintdef(constraint_row.oid)
     FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'private.auth_session_gates'::regclass
      AND constraint_row.conname = 'auth_session_gates_gate_type_check'),
  '%gate_type%RECOVERY_PENDING%'::text,
  'gate type is restricted to RECOVERY_PENDING'::text
);

SELECT is(
  (SELECT constraint_row.confrelid::regclass::text
     FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'private.auth_session_gates'::regclass
      AND constraint_row.conname = 'auth_session_gates_session_id_fkey'),
  'auth.sessions',
  'session foreign key targets auth.sessions'
);

SELECT is(
  (SELECT constraint_row.confdeltype::text || constraint_row.confupdtype::text
     FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'private.auth_session_gates'::regclass
      AND constraint_row.conname = 'auth_session_gates_session_id_fkey'),
  'cr',
  'session foreign key uses ON DELETE CASCADE and ON UPDATE RESTRICT'
);

SELECT is(
  (SELECT constraint_row.confrelid::regclass::text
     FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'private.auth_session_gates'::regclass
      AND constraint_row.conname = 'auth_session_gates_user_id_fkey'),
  'auth.users',
  'user foreign key targets auth.users'
);

SELECT is(
  (SELECT constraint_row.confdeltype::text || constraint_row.confupdtype::text
     FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'private.auth_session_gates'::regclass
      AND constraint_row.conname = 'auth_session_gates_user_id_fkey'),
  'cr',
  'user foreign key uses ON DELETE CASCADE and ON UPDATE RESTRICT'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_index AS index_row
     WHERE index_row.indexrelid = 'private.auth_session_gates_user_id_idx'::regclass
       AND index_row.indrelid = 'private.auth_session_gates'::regclass
       AND index_row.indisvalid
       AND index_row.indisready
  ),
  'user_id supporting index exists and is valid'
);

SELECT ok(
  (SELECT class.relrowsecurity AND NOT class.relforcerowsecurity
     FROM pg_catalog.pg_class AS class
    WHERE class.oid = 'private.auth_session_gates'::regclass),
  'gate table has ordinary RLS enabled'
);

-- ============ RLS POLICIES ============

SELECT is(
  (SELECT count(*)::integer FROM pg_catalog.pg_policy AS policy
    WHERE policy.polrelid = 'private.auth_session_gates'::regclass),
  3,
  'gate table has exactly three policies'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy AS policy
     WHERE policy.polrelid = 'private.auth_session_gates'::regclass
       AND policy.polname = 'auth_session_gates_select_auth_hook'
       AND policy.polcmd = 'r'
       AND policy.polpermissive
       AND policy.polroles = ARRAY['supabase_auth_admin'::regrole::oid]
       AND pg_catalog.pg_get_expr(policy.polqual, policy.polrelid) = 'true'
       AND policy.polwithcheck IS NULL
  ),
  'SELECT policy is permissive and restricted to supabase_auth_admin'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy AS policy
     WHERE policy.polrelid = 'private.auth_session_gates'::regclass
       AND policy.polname = 'auth_session_gates_insert_auth_hook'
       AND policy.polcmd = 'a'
       AND policy.polpermissive
       AND policy.polroles = ARRAY['supabase_auth_admin'::regrole::oid]
       AND policy.polqual IS NULL
       AND pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid)
         LIKE '%RECOVERY_PENDING%'
  ),
  'INSERT policy accepts only recovery gates from supabase_auth_admin'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy AS policy
     WHERE policy.polrelid = 'private.auth_session_gates'::regclass
       AND policy.polname = 'auth_session_gates_update_auth_hook'
       AND policy.polcmd = 'w'
       AND policy.polpermissive
       AND policy.polroles = ARRAY['supabase_auth_admin'::regrole::oid]
       AND pg_catalog.pg_get_expr(policy.polqual, policy.polrelid)
         LIKE '%RECOVERY_PENDING%'
       AND pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid)
         LIKE '%RECOVERY_PENDING%'
  ),
  'UPDATE policy preserves recovery-gate type for supabase_auth_admin'
);

SELECT is(
  (SELECT count(*)::integer FROM pg_catalog.pg_policy AS policy
    WHERE policy.polrelid = 'private.auth_session_gates'::regclass
      AND policy.polcmd = 'd'),
  0,
  'gate table has no DELETE policy'
);

-- ============ FUNCTION / TRIGGER METADATA ============

SELECT has_function(
  'private', 'purplelok_custom_access_token_hook', ARRAY['jsonb'],
  'permanent Custom Access Token Hook exists'
);

SELECT ok(
  (SELECT NOT procedure.prosecdef
       AND procedure.provolatile = 'v'
       AND pg_catalog.pg_get_userbyid(procedure.proowner) = 'postgres'
     FROM pg_catalog.pg_proc AS procedure
    WHERE procedure.oid = 'private.purplelok_custom_access_token_hook(jsonb)'::regprocedure),
  'hook is volatile SECURITY INVOKER owned by postgres'
);

SELECT ok(
  (SELECT procedure.proconfig @> ARRAY['row_security=on']::text[]
       AND EXISTS (
         SELECT 1 FROM unnest(procedure.proconfig) AS setting
          WHERE setting ~ '^search_path=(""|)$'
       )
     FROM pg_catalog.pg_proc AS procedure
    WHERE procedure.oid = 'private.purplelok_custom_access_token_hook(jsonb)'::regprocedure),
  'hook has empty search_path and row_security on'
);

SELECT has_function(
  'private', 'purplelok_assert_auth_session_identity', ARRAY['uuid', 'uuid'],
  'Auth session identity assertion exists'
);

SELECT ok(
  (SELECT procedure.prosecdef
       AND procedure.provolatile = 'v'
       AND procedure.proconfig @> ARRAY['row_security=off']::text[]
       AND pg_catalog.pg_get_userbyid(procedure.proowner) = 'postgres'
       AND EXISTS (
         SELECT 1 FROM unnest(procedure.proconfig) AS setting
          WHERE setting ~ '^search_path=(""|)$'
       )
     FROM pg_catalog.pg_proc AS procedure
    WHERE procedure.oid = 'private.purplelok_assert_auth_session_identity(uuid,uuid)'::regprocedure),
  'identity assertion is hardened volatile SECURITY DEFINER owned by postgres'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger AS trigger_row
     WHERE trigger_row.tgrelid = 'private.auth_session_gates'::regclass
       AND trigger_row.tgname = 'purplelok_auth_session_gate_consistency'
       AND NOT trigger_row.tgisinternal
       AND trigger_row.tgenabled = 'O'
       AND trigger_row.tgtype = 23
       AND trigger_row.tgfoid = 'private.purplelok_auth_session_gate_consistency()'::regprocedure
  ),
  'identity consistency trigger is enabled for row-level BEFORE INSERT/identity UPDATE'
);

-- ============ EXECUTE / TABLE / COLUMN ACLS ============

SELECT ok(
  has_function_privilege(
    'supabase_auth_admin', 'private.purplelok_custom_access_token_hook(jsonb)', 'EXECUTE'
  ),
  'supabase_auth_admin can execute the hook'
);
SELECT ok(NOT has_function_privilege('anon', 'private.purplelok_custom_access_token_hook(jsonb)', 'EXECUTE'), 'anon cannot execute the hook');
SELECT ok(NOT has_function_privilege('authenticated', 'private.purplelok_custom_access_token_hook(jsonb)', 'EXECUTE'), 'authenticated cannot execute the hook');
SELECT ok(NOT has_function_privilege('service_role', 'private.purplelok_custom_access_token_hook(jsonb)', 'EXECUTE'), 'service_role cannot execute the hook');
SELECT is(
  (SELECT count(*)::integer
     FROM pg_catalog.pg_proc AS procedure
     CROSS JOIN LATERAL pg_catalog.aclexplode(
       COALESCE(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
     ) AS privilege
    WHERE procedure.oid = 'private.purplelok_custom_access_token_hook(jsonb)'::regprocedure
      AND privilege.grantee = 0
      AND privilege.privilege_type = 'EXECUTE'),
  0,
  'PUBLIC cannot execute the hook'
);

SELECT ok(
  has_function_privilege(
    'supabase_auth_admin',
    'private.purplelok_assert_auth_session_identity(uuid,uuid)',
    'EXECUTE'
  ),
  'supabase_auth_admin can execute the identity assertion'
);
SELECT ok(NOT has_function_privilege('anon', 'private.purplelok_assert_auth_session_identity(uuid,uuid)', 'EXECUTE'), 'anon cannot execute the identity assertion');
SELECT ok(NOT has_function_privilege('authenticated', 'private.purplelok_assert_auth_session_identity(uuid,uuid)', 'EXECUTE'), 'authenticated cannot execute the identity assertion');
SELECT ok(NOT has_function_privilege('service_role', 'private.purplelok_assert_auth_session_identity(uuid,uuid)', 'EXECUTE'), 'service_role cannot execute the identity assertion');

SELECT ok(
  NOT has_function_privilege('supabase_auth_admin', 'private.purplelok_auth_session_gate_consistency()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'private.purplelok_auth_session_gate_consistency()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'private.purplelok_auth_session_gate_consistency()', 'EXECUTE')
  AND NOT has_function_privilege('service_role', 'private.purplelok_auth_session_gate_consistency()', 'EXECUTE')
  AND NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS procedure
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
      ) AS privilege
     WHERE procedure.oid = 'private.purplelok_auth_session_gate_consistency()'::regprocedure
       AND privilege.grantee = 0
       AND privilege.privilege_type = 'EXECUTE'
  ),
  'trigger helper is not directly executable by the Auth hook or API roles'
);

SELECT ok(has_table_privilege('supabase_auth_admin', 'private.auth_session_gates', 'SELECT'), 'hook role can SELECT gates');
SELECT ok(has_column_privilege('supabase_auth_admin', 'private.auth_session_gates', 'session_id', 'INSERT'), 'hook role can INSERT session_id');
SELECT ok(has_column_privilege('supabase_auth_admin', 'private.auth_session_gates', 'user_id', 'INSERT'), 'hook role can INSERT user_id');
SELECT ok(has_column_privilege('supabase_auth_admin', 'private.auth_session_gates', 'gate_type', 'INSERT'), 'hook role can INSERT gate_type');
SELECT ok(has_column_privilege('supabase_auth_admin', 'private.auth_session_gates', 'observed_refresh', 'UPDATE'), 'hook role can UPDATE observed_refresh');
SELECT ok(has_column_privilege('supabase_auth_admin', 'private.auth_session_gates', 'last_observed_at', 'UPDATE'), 'hook role can UPDATE last_observed_at');

SELECT ok(
  NOT has_table_privilege('supabase_auth_admin', 'private.auth_session_gates', 'DELETE')
  AND NOT has_table_privilege('supabase_auth_admin', 'private.auth_session_gates', 'TRUNCATE')
  AND NOT has_table_privilege('supabase_auth_admin', 'private.auth_session_gates', 'REFERENCES')
  AND NOT has_table_privilege('supabase_auth_admin', 'private.auth_session_gates', 'TRIGGER'),
  'hook role has no destructive or structural gate privileges'
);

SELECT ok(
  NOT has_table_privilege('supabase_auth_admin', 'private.auth_session_gates', 'INSERT')
  AND NOT has_table_privilege('supabase_auth_admin', 'private.auth_session_gates', 'UPDATE')
  AND NOT has_column_privilege('supabase_auth_admin', 'private.auth_session_gates', 'created_at', 'INSERT')
  AND NOT has_column_privilege('supabase_auth_admin', 'private.auth_session_gates', 'last_observed_at', 'INSERT')
  AND NOT has_column_privilege('supabase_auth_admin', 'private.auth_session_gates', 'observed_refresh', 'INSERT')
  AND NOT has_column_privilege('supabase_auth_admin', 'private.auth_session_gates', 'session_id', 'UPDATE')
  AND NOT has_column_privilege('supabase_auth_admin', 'private.auth_session_gates', 'user_id', 'UPDATE')
  AND NOT has_column_privilege('supabase_auth_admin', 'private.auth_session_gates', 'gate_type', 'UPDATE')
  AND NOT has_column_privilege('supabase_auth_admin', 'private.auth_session_gates', 'created_at', 'UPDATE'),
  'hook role has only the approved column-scoped INSERT and UPDATE privileges'
);

SELECT ok(
  NOT has_table_privilege('anon', 'private.auth_session_gates', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'private.auth_session_gates', 'SELECT')
  AND NOT has_table_privilege('service_role', 'private.auth_session_gates', 'SELECT'),
  'browser and service roles cannot read gates'
);

SELECT ok(
  NOT has_column_privilege('anon', 'private.auth_session_gates', 'session_id', 'INSERT')
  AND NOT has_column_privilege('authenticated', 'private.auth_session_gates', 'session_id', 'INSERT')
  AND NOT has_column_privilege('service_role', 'private.auth_session_gates', 'session_id', 'INSERT')
  AND NOT has_column_privilege('anon', 'private.auth_session_gates', 'observed_refresh', 'UPDATE')
  AND NOT has_column_privilege('authenticated', 'private.auth_session_gates', 'observed_refresh', 'UPDATE')
  AND NOT has_column_privilege('service_role', 'private.auth_session_gates', 'observed_refresh', 'UPDATE'),
  'browser and service roles cannot insert or update gates'
);

SELECT is((SELECT count(*)::integer FROM private.auth_session_gates), 0, 'migration creates zero gate rows');

-- ============ DETERMINISTIC BEHAVIOR FIXTURES ============

INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES
  ('00000000-0000-0000-0000-00000005f101', 'batch5f-c1-a@example.test', '{}'::jsonb),
  ('00000000-0000-0000-0000-00000005f102', 'batch5f-c1-b@example.test', '{}'::jsonb);

INSERT INTO auth.sessions (id, user_id)
VALUES
  ('00000000-0000-0000-0000-00000005f111', '00000000-0000-0000-0000-00000005f101'),
  ('00000000-0000-0000-0000-00000005f112', '00000000-0000-0000-0000-00000005f102');

SELECT throws_ok(
  $$INSERT INTO private.auth_session_gates (session_id, user_id, gate_type)
    VALUES (
      '00000000-0000-0000-0000-00000005f111',
      '00000000-0000-0000-0000-00000005f102',
      'RECOVERY_PENDING'
    )$$,
  '42501',
  'A live matching Auth user and session are required',
  'a gate cannot bind a session to a different user'
);

SELECT throws_ok(
  $$INSERT INTO private.auth_session_gates (session_id, user_id, gate_type)
    VALUES (
      '00000000-0000-0000-0000-00000005f111',
      '00000000-0000-0000-0000-00000005f101',
      'NORMAL'
    )$$,
  '23514',
  NULL,
  'unsupported gate type is rejected'
);

-- Exercise deterministic function semantics as the postgres test connection.
-- Catalogue assertions above prove the production ACL; the genuine Auth
-- lifecycle job separately proves invocation by supabase_auth_admin.

SELECT is(
  private.purplelok_custom_access_token_hook(
    jsonb_build_object(
      'user_id', '00000000-0000-0000-0000-00000005f101',
      'authentication_method', 'password',
      'claims', jsonb_build_object(
        'sub', '00000000-0000-0000-0000-00000005f101',
        'session_id', '00000000-0000-0000-0000-00000005f111',
        'purplelok_session_state', 'forged'
      )
    )
    #>> '{claims,purplelok_session_state}',
  'normal_v1',
  'normal password session receives normal_v1 and forged input state is overwritten'
);

SELECT is(
  private.purplelok_custom_access_token_hook(
    jsonb_build_object(
      'user_id', '00000000-0000-0000-0000-00000005f102',
      'authentication_method', 'recovery',
      'claims', jsonb_build_object(
        'sub', '00000000-0000-0000-0000-00000005f102',
        'session_id', '00000000-0000-0000-0000-00000005f112'
      )
    )
    #>> '{claims,purplelok_session_state}',
  'recovery_pending_v1',
  'recovery session creates a gate and receives recovery_pending_v1'
);

SELECT is(
  (SELECT count(*)::integer FROM private.auth_session_gates
    WHERE session_id = '00000000-0000-0000-0000-00000005f112'
      AND user_id = '00000000-0000-0000-0000-00000005f102'
      AND gate_type = 'RECOVERY_PENDING'),
  1,
  'recovery creates exactly one exact gate'
);

SELECT is(
  private.purplelok_custom_access_token_hook(
    jsonb_build_object(
      'user_id', '00000000-0000-0000-0000-00000005f102',
      'authentication_method', 'recovery',
      'claims', jsonb_build_object(
        'sub', '00000000-0000-0000-0000-00000005f102',
        'session_id', '00000000-0000-0000-0000-00000005f112'
      )
    )
    #>> '{claims,purplelok_session_state}',
  'recovery_pending_v1',
  'exact recovery repeat is idempotent'
);

SELECT is(
  (SELECT count(*)::integer FROM private.auth_session_gates
    WHERE session_id = '00000000-0000-0000-0000-00000005f112'),
  1,
  'idempotent recovery repeat does not duplicate gates'
);

SELECT is(
  private.purplelok_custom_access_token_hook(
    jsonb_build_object(
      'user_id', '00000000-0000-0000-0000-00000005f102',
      'authentication_method', 'token_refresh',
      'claims', jsonb_build_object(
        'sub', '00000000-0000-0000-0000-00000005f102',
        'session_id', '00000000-0000-0000-0000-00000005f112'
      )
    )
    #>> '{claims,purplelok_session_state}',
  'recovery_pending_v1',
  'recovery refresh preserves recovery_pending_v1'
);

SELECT ok(
  (SELECT observed_refresh FROM private.auth_session_gates
    WHERE session_id = '00000000-0000-0000-0000-00000005f112'),
  'recovery refresh marks the gate as observed'
);

SELECT * FROM finish();

ROLLBACK;
