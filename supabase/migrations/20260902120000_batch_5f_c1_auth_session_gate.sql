BEGIN;

-- Batch 5F-C1 installs only the durable recovery-session quarantine and the
-- Custom Access Token Hook that signs its state into newly issued JWTs. It
-- deliberately does not activate the hosted Auth hook or change application,
-- profile, RBAC, or domain authorization.

DO $preflight$
DECLARE
  private_owner name;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'supabase_auth_admin') THEN
    RAISE EXCEPTION 'Batch 5F-C1 precondition: supabase_auth_admin role is missing';
  END IF;

  IF to_regnamespace('private') IS NOT NULL THEN
    SELECT pg_catalog.pg_get_userbyid(namespace.nspowner)
      INTO private_owner
      FROM pg_catalog.pg_namespace AS namespace
     WHERE namespace.nspname = 'private';

    IF private_owner IS DISTINCT FROM 'postgres' THEN
      RAISE EXCEPTION
        'Batch 5F-C1 precondition: private schema owner is %, expected postgres',
        private_owner;
    END IF;
  END IF;

  IF to_regclass('auth.users') IS NULL
     OR to_regclass('auth.sessions') IS NULL THEN
    RAISE EXCEPTION 'Batch 5F-C1 precondition: required Auth tables are missing';
  END IF;

  IF NOT EXISTS (
      SELECT 1
        FROM pg_catalog.pg_attribute AS attribute
       WHERE attribute.attrelid = 'auth.users'::regclass
         AND attribute.attname = 'id'
         AND attribute.atttypid = 'uuid'::regtype
         AND attribute.attnotnull
         AND NOT attribute.attisdropped
    )
    OR NOT EXISTS (
      SELECT 1
        FROM pg_catalog.pg_attribute AS attribute
       WHERE attribute.attrelid = 'auth.users'::regclass
         AND attribute.attname = 'deleted_at'
         AND attribute.atttypid = 'timestamp with time zone'::regtype
         AND NOT attribute.attisdropped
    )
    OR NOT EXISTS (
      SELECT 1
        FROM pg_catalog.pg_attribute AS attribute
       WHERE attribute.attrelid = 'auth.sessions'::regclass
         AND attribute.attname = 'id'
         AND attribute.atttypid = 'uuid'::regtype
         AND attribute.attnotnull
         AND NOT attribute.attisdropped
    )
    OR NOT EXISTS (
      SELECT 1
        FROM pg_catalog.pg_attribute AS attribute
       WHERE attribute.attrelid = 'auth.sessions'::regclass
         AND attribute.attname = 'user_id'
         AND attribute.atttypid = 'uuid'::regtype
         AND attribute.attnotnull
         AND NOT attribute.attisdropped
    ) THEN
    RAISE EXCEPTION 'Batch 5F-C1 precondition: Auth identity/session columns differ from the approved contract';
  END IF;

  IF NOT EXISTS (
      SELECT 1
        FROM pg_catalog.pg_constraint AS constraint_row
       WHERE constraint_row.conrelid = 'auth.sessions'::regclass
         AND constraint_row.contype IN ('p', 'u')
         AND constraint_row.conkey = ARRAY[
           (SELECT attribute.attnum
              FROM pg_catalog.pg_attribute AS attribute
             WHERE attribute.attrelid = 'auth.sessions'::regclass
               AND attribute.attname = 'id')
         ]::smallint[]
    ) THEN
    RAISE EXCEPTION 'Batch 5F-C1 precondition: auth.sessions(id) is not a unique key';
  END IF;

  IF to_regclass('private.auth_session_gates') IS NOT NULL
     OR to_regprocedure('private.purplelok_assert_auth_session_identity(uuid,uuid)') IS NOT NULL
     OR to_regprocedure('private.purplelok_auth_session_gate_consistency()') IS NOT NULL
     OR to_regprocedure('private.purplelok_custom_access_token_hook(jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'Batch 5F-C1 precondition: a permanent session-gate object already exists';
  END IF;
END
$preflight$;

CREATE SCHEMA IF NOT EXISTS private AUTHORIZATION postgres;
ALTER SCHEMA private OWNER TO postgres;

-- Do not revoke authenticated USAGE: Batch 4 private RLS helpers depend on it.
REVOKE CREATE ON SCHEMA private FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT USAGE ON SCHEMA private TO supabase_auth_admin;

CREATE FUNCTION private.purplelok_assert_auth_session_identity(
  p_user_id uuid,
  p_session_id uuid
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET row_security = 'off'
AS $function$
BEGIN
  IF p_user_id IS NULL OR p_session_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'A live matching Auth user and session are required';
  END IF;

  PERFORM 1
    FROM auth.sessions AS auth_session
    JOIN auth.users AS auth_user
      ON auth_user.id = auth_session.user_id
   WHERE auth_session.id = p_session_id
     AND auth_session.user_id = p_user_id
     AND auth_user.id = p_user_id
     AND auth_user.deleted_at IS NULL
     FOR KEY SHARE OF auth_session, auth_user;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'A live matching Auth user and session are required';
  END IF;
END
$function$;

ALTER FUNCTION private.purplelok_assert_auth_session_identity(uuid, uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION private.purplelok_assert_auth_session_identity(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION private.purplelok_assert_auth_session_identity(uuid, uuid)
  TO supabase_auth_admin;

CREATE TABLE private.auth_session_gates (
  session_id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  gate_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  observed_refresh boolean NOT NULL DEFAULT false,
  CONSTRAINT auth_session_gates_session_id_fkey
    FOREIGN KEY (session_id) REFERENCES auth.sessions(id)
    ON UPDATE RESTRICT ON DELETE CASCADE,
  CONSTRAINT auth_session_gates_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id)
    ON UPDATE RESTRICT ON DELETE CASCADE,
  CONSTRAINT auth_session_gates_gate_type_check
    CHECK (gate_type = 'RECOVERY_PENDING')
);

ALTER TABLE private.auth_session_gates OWNER TO postgres;

CREATE INDEX auth_session_gates_user_id_idx
  ON private.auth_session_gates(user_id);

CREATE FUNCTION private.purplelok_auth_session_gate_consistency()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
SET row_security = 'off'
AS $function$
BEGIN
  PERFORM private.purplelok_assert_auth_session_identity(NEW.user_id, NEW.session_id);
  RETURN NEW;
END
$function$;

ALTER FUNCTION private.purplelok_auth_session_gate_consistency()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION private.purplelok_auth_session_gate_consistency()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

CREATE TRIGGER purplelok_auth_session_gate_consistency
  BEFORE INSERT OR UPDATE OF session_id, user_id
  ON private.auth_session_gates
  FOR EACH ROW
  EXECUTE FUNCTION private.purplelok_auth_session_gate_consistency();

ALTER TABLE private.auth_session_gates ENABLE ROW LEVEL SECURITY;

CREATE POLICY auth_session_gates_select_auth_hook
  ON private.auth_session_gates
  FOR SELECT TO supabase_auth_admin
  USING (true);

CREATE POLICY auth_session_gates_insert_auth_hook
  ON private.auth_session_gates
  FOR INSERT TO supabase_auth_admin
  WITH CHECK (gate_type = 'RECOVERY_PENDING');

CREATE POLICY auth_session_gates_update_auth_hook
  ON private.auth_session_gates
  FOR UPDATE TO supabase_auth_admin
  USING (gate_type = 'RECOVERY_PENDING')
  WITH CHECK (gate_type = 'RECOVERY_PENDING');

REVOKE ALL ON TABLE private.auth_session_gates
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT SELECT ON TABLE private.auth_session_gates TO supabase_auth_admin;
GRANT INSERT (session_id, user_id, gate_type)
  ON TABLE private.auth_session_gates TO supabase_auth_admin;
GRANT UPDATE (observed_refresh, last_observed_at)
  ON TABLE private.auth_session_gates TO supabase_auth_admin;

CREATE FUNCTION private.purplelok_custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
SET row_security = 'on'
AS $function$
DECLARE
  event_user_id uuid;
  event_session_id uuid;
  event_subject_id uuid;
  event_authentication_method text;
  updated_claims jsonb;
  session_state text;
  gate_exists boolean;
  affected_rows integer;
BEGIN
  IF pg_catalog.jsonb_typeof(event) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Batch 5F-C1 hook: event must be an object';
  END IF;

  IF pg_catalog.jsonb_typeof(event->'claims') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Batch 5F-C1 hook: claims must be an object';
  END IF;

  IF NOT event ? 'user_id'
     OR pg_catalog.jsonb_typeof(event->'user_id') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'Batch 5F-C1 hook: user_id is missing or malformed';
  END IF;

  BEGIN
    event_user_id := (event->>'user_id')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Batch 5F-C1 hook: user_id is missing or malformed';
  END;

  IF NOT (event->'claims') ? 'session_id'
     OR pg_catalog.jsonb_typeof(event->'claims'->'session_id') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'Batch 5F-C1 hook: session_id is missing or malformed';
  END IF;

  BEGIN
    event_session_id := (event->'claims'->>'session_id')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Batch 5F-C1 hook: session_id is missing or malformed';
  END;

  IF NOT (event->'claims') ? 'sub'
     OR pg_catalog.jsonb_typeof(event->'claims'->'sub') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'Batch 5F-C1 hook: subject is missing or malformed';
  END IF;

  BEGIN
    event_subject_id := (event->'claims'->>'sub')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'Batch 5F-C1 hook: subject is missing or malformed';
  END;

  IF event_subject_id IS DISTINCT FROM event_user_id THEN
    RAISE EXCEPTION 'Batch 5F-C1 hook: subject does not match user_id';
  END IF;

  IF NOT event ? 'authentication_method'
     OR pg_catalog.jsonb_typeof(event->'authentication_method') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'Batch 5F-C1 hook: authentication_method is missing or malformed';
  END IF;

  event_authentication_method := event->>'authentication_method';
  IF event_authentication_method IS NULL
     OR pg_catalog.btrim(event_authentication_method) = '' THEN
    RAISE EXCEPTION 'Batch 5F-C1 hook: authentication_method is missing or malformed';
  END IF;

  IF event_authentication_method <> ALL (ARRAY[
    'oauth',
    'password',
    'otp',
    'totp',
    'recovery',
    'invite',
    'sso/saml',
    'magiclink',
    'email/signup',
    'email_change',
    'token_refresh',
    'oauth_provider/authorization_code',
    'anonymous'
  ]::text[]) THEN
    RAISE EXCEPTION 'Batch 5F-C1 hook: unsupported authentication_method';
  END IF;

  PERFORM private.purplelok_assert_auth_session_identity(
    event_user_id,
    event_session_id
  );

  IF event_authentication_method = 'recovery' THEN
    INSERT INTO private.auth_session_gates (session_id, user_id, gate_type)
    VALUES (event_session_id, event_user_id, 'RECOVERY_PENDING')
    ON CONFLICT (session_id) DO NOTHING;

    IF NOT EXISTS (
      SELECT 1
        FROM private.auth_session_gates AS gate
       WHERE gate.session_id = event_session_id
         AND gate.user_id = event_user_id
         AND gate.gate_type = 'RECOVERY_PENDING'
    ) THEN
      RAISE EXCEPTION 'Batch 5F-C1 hook: recovery gate conflict';
    END IF;
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM private.auth_session_gates AS gate
     WHERE gate.session_id = event_session_id
       AND gate.user_id = event_user_id
       AND gate.gate_type = 'RECOVERY_PENDING'
  ) INTO gate_exists;

  IF event_authentication_method = 'token_refresh' AND gate_exists THEN
    UPDATE private.auth_session_gates AS gate
       SET observed_refresh = true,
           last_observed_at = pg_catalog.clock_timestamp()
     WHERE gate.session_id = event_session_id
       AND gate.user_id = event_user_id
       AND gate.gate_type = 'RECOVERY_PENDING';

    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    IF affected_rows <> 1 THEN
      RAISE EXCEPTION 'Batch 5F-C1 hook: recovery gate refresh conflict';
    END IF;
  END IF;

  session_state := CASE
    WHEN gate_exists THEN 'recovery_pending_v1'
    ELSE 'normal_v1'
  END;

  updated_claims := pg_catalog.jsonb_set(
    event->'claims',
    '{purplelok_session_state}',
    pg_catalog.to_jsonb(session_state),
    true
  );

  RETURN pg_catalog.jsonb_build_object('claims', updated_claims);
END
$function$;

ALTER FUNCTION private.purplelok_custom_access_token_hook(jsonb)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION private.purplelok_custom_access_token_hook(jsonb)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION private.purplelok_custom_access_token_hook(jsonb)
  TO supabase_auth_admin;

COMMENT ON TABLE private.auth_session_gates IS
  'Durable, private quarantine for recovery Auth sessions. A row denies normal CRM authority for the complete auth.sessions lifetime.';
COMMENT ON FUNCTION private.purplelok_assert_auth_session_identity(uuid, uuid) IS
  'Fails unless a live Auth user owns the exact live Auth session; used by the token hook and gate trigger.';
COMMENT ON FUNCTION private.purplelok_auth_session_gate_consistency() IS
  'Trigger-only enforcement that prevents a recovery gate from being bound to a different or deleted Auth identity.';
COMMENT ON FUNCTION private.purplelok_custom_access_token_hook(jsonb) IS
  'Custom Access Token Hook: signs normal_v1 or recovery_pending_v1 from durable exact-session recovery provenance.';

DO $postconditions$
DECLARE
  hook_oid oid := to_regprocedure('private.purplelok_custom_access_token_hook(jsonb)');
  assertion_oid oid := to_regprocedure('private.purplelok_assert_auth_session_identity(uuid,uuid)');
  trigger_oid oid := to_regprocedure('private.purplelok_auth_session_gate_consistency()');
BEGIN
  IF to_regclass('private.auth_session_gates') IS NULL
     OR hook_oid IS NULL
     OR assertion_oid IS NULL
     OR trigger_oid IS NULL THEN
    RAISE EXCEPTION 'Batch 5F-C1 postcondition: required object is missing';
  END IF;

  IF (SELECT count(*) FROM pg_catalog.pg_attribute AS attribute
       WHERE attribute.attrelid = 'private.auth_session_gates'::regclass
         AND attribute.attnum > 0
         AND NOT attribute.attisdropped) <> 6 THEN
    RAISE EXCEPTION 'Batch 5F-C1 postcondition: gate column set is invalid';
  END IF;

  IF NOT (SELECT class.relrowsecurity AND NOT class.relforcerowsecurity
            FROM pg_catalog.pg_class AS class
           WHERE class.oid = 'private.auth_session_gates'::regclass) THEN
    RAISE EXCEPTION 'Batch 5F-C1 postcondition: gate RLS state is invalid';
  END IF;

  IF (SELECT count(*) FROM pg_catalog.pg_policy AS policy
       WHERE policy.polrelid = 'private.auth_session_gates'::regclass) <> 3 THEN
    RAISE EXCEPTION 'Batch 5F-C1 postcondition: expected exactly three gate policies';
  END IF;

  IF NOT EXISTS (
      SELECT 1
        FROM pg_catalog.pg_trigger AS trigger_row
       WHERE trigger_row.tgrelid = 'private.auth_session_gates'::regclass
         AND trigger_row.tgname = 'purplelok_auth_session_gate_consistency'
         AND NOT trigger_row.tgisinternal
         AND trigger_row.tgenabled = 'O'
         AND trigger_row.tgtype = 23
         AND trigger_row.tgfoid = trigger_oid
    ) THEN
    RAISE EXCEPTION 'Batch 5F-C1 postcondition: consistency trigger is invalid';
  END IF;

  IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc AS procedure
       WHERE procedure.oid = hook_oid
         AND pg_catalog.pg_get_userbyid(procedure.proowner) = 'postgres'
         AND NOT procedure.prosecdef
         AND procedure.provolatile = 'v'
         AND procedure.proconfig @> ARRAY['row_security=on']::text[]
         AND EXISTS (
           SELECT 1 FROM unnest(procedure.proconfig) AS setting
            WHERE setting ~ '^search_path=(""|)$'
         )
    ) THEN
    RAISE EXCEPTION 'Batch 5F-C1 postcondition: hook security metadata is invalid';
  END IF;

  IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc AS procedure
       WHERE procedure.oid = assertion_oid
         AND pg_catalog.pg_get_userbyid(procedure.proowner) = 'postgres'
         AND procedure.prosecdef
         AND procedure.provolatile = 'v'
         AND procedure.proconfig @> ARRAY['row_security=off']::text[]
         AND EXISTS (
           SELECT 1 FROM unnest(procedure.proconfig) AS setting
            WHERE setting ~ '^search_path=(""|)$'
         )
    ) THEN
    RAISE EXCEPTION 'Batch 5F-C1 postcondition: identity assertion metadata is invalid';
  END IF;

  IF NOT has_schema_privilege('supabase_auth_admin', 'private', 'USAGE')
     OR NOT has_function_privilege(
       'supabase_auth_admin',
       'private.purplelok_custom_access_token_hook(jsonb)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'supabase_auth_admin',
       'private.purplelok_assert_auth_session_identity(uuid,uuid)',
       'EXECUTE'
     )
     OR NOT has_table_privilege(
       'supabase_auth_admin', 'private.auth_session_gates', 'SELECT'
     )
     OR NOT has_column_privilege(
       'supabase_auth_admin', 'private.auth_session_gates', 'session_id', 'INSERT'
     )
     OR NOT has_column_privilege(
       'supabase_auth_admin', 'private.auth_session_gates', 'user_id', 'INSERT'
     )
     OR NOT has_column_privilege(
       'supabase_auth_admin', 'private.auth_session_gates', 'gate_type', 'INSERT'
     )
     OR NOT has_column_privilege(
       'supabase_auth_admin', 'private.auth_session_gates', 'observed_refresh', 'UPDATE'
     )
     OR NOT has_column_privilege(
       'supabase_auth_admin', 'private.auth_session_gates', 'last_observed_at', 'UPDATE'
     ) THEN
    RAISE EXCEPTION 'Batch 5F-C1 postcondition: hook role lacks required minimum privileges';
  END IF;

  IF has_table_privilege('supabase_auth_admin', 'private.auth_session_gates', 'DELETE')
     OR has_table_privilege('supabase_auth_admin', 'private.auth_session_gates', 'INSERT')
     OR has_table_privilege('supabase_auth_admin', 'private.auth_session_gates', 'UPDATE')
     OR has_table_privilege('supabase_auth_admin', 'private.auth_session_gates', 'TRUNCATE')
     OR has_table_privilege('supabase_auth_admin', 'private.auth_session_gates', 'REFERENCES')
     OR has_table_privilege('supabase_auth_admin', 'private.auth_session_gates', 'TRIGGER')
     OR has_column_privilege('supabase_auth_admin', 'private.auth_session_gates', 'created_at', 'INSERT')
     OR has_column_privilege('supabase_auth_admin', 'private.auth_session_gates', 'last_observed_at', 'INSERT')
     OR has_column_privilege('supabase_auth_admin', 'private.auth_session_gates', 'observed_refresh', 'INSERT')
     OR has_column_privilege('supabase_auth_admin', 'private.auth_session_gates', 'session_id', 'UPDATE')
     OR has_column_privilege('supabase_auth_admin', 'private.auth_session_gates', 'user_id', 'UPDATE')
     OR has_column_privilege('supabase_auth_admin', 'private.auth_session_gates', 'gate_type', 'UPDATE')
     OR has_column_privilege('supabase_auth_admin', 'private.auth_session_gates', 'created_at', 'UPDATE') THEN
    RAISE EXCEPTION 'Batch 5F-C1 postcondition: hook role has excess gate privileges';
  END IF;

  IF EXISTS (
      SELECT 1
        FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) AS role_name
       WHERE has_table_privilege(role_name, 'private.auth_session_gates', 'SELECT')
          OR has_column_privilege(role_name, 'private.auth_session_gates', 'session_id', 'INSERT')
          OR has_column_privilege(role_name, 'private.auth_session_gates', 'observed_refresh', 'UPDATE')
          OR has_function_privilege(role_name, 'private.purplelok_custom_access_token_hook(jsonb)', 'EXECUTE')
          OR has_function_privilege(role_name, 'private.purplelok_assert_auth_session_identity(uuid,uuid)', 'EXECUTE')
    )
    OR EXISTS (
      SELECT 1
        FROM pg_catalog.pg_proc AS procedure
        CROSS JOIN LATERAL pg_catalog.aclexplode(
          COALESCE(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
        ) AS privilege
       WHERE procedure.oid IN (hook_oid, assertion_oid, trigger_oid)
         AND privilege.grantee = 0
         AND privilege.privilege_type = 'EXECUTE'
    ) THEN
    RAISE EXCEPTION 'Batch 5F-C1 postcondition: an API role can access a protected gate object';
  END IF;

  IF EXISTS (SELECT 1 FROM private.auth_session_gates) THEN
    RAISE EXCEPTION 'Batch 5F-C1 postcondition: migration unexpectedly created gate rows';
  END IF;
END
$postconditions$;

COMMIT;
