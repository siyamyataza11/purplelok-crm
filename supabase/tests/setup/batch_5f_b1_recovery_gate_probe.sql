-- Batch 5F-B1 disposable Auth-hook proof objects.
--
-- This file is test infrastructure only. It must never be copied into
-- supabase/migrations or applied to a linked/production project.

CREATE SCHEMA IF NOT EXISTS private AUTHORIZATION postgres;

REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA private TO supabase_auth_admin;

CREATE TABLE private.auth_hook_probe_control (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  force_recovery_failure boolean NOT NULL DEFAULT false
);

INSERT INTO private.auth_hook_probe_control (singleton, force_recovery_failure)
VALUES (true, false);

CREATE TABLE private.auth_hook_event_probe (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL,
  authentication_method text NOT NULL,
  session_state text NOT NULL CHECK (
    session_state IN ('normal_v1', 'recovery_pending_v1')
  ),
  execution_current_user name NOT NULL,
  execution_session_user name NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE private.auth_session_gate_probe (
  session_id uuid PRIMARY KEY
    REFERENCES auth.sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  gate_type text NOT NULL CHECK (gate_type = 'RECOVERY_PENDING'),
  first_authentication_method text NOT NULL CHECK (
    first_authentication_method = 'recovery'
  ),
  observed_refresh boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_observed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX auth_session_gate_probe_user_id_idx
  ON private.auth_session_gate_probe(user_id);

ALTER TABLE private.auth_hook_probe_control ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.auth_hook_event_probe ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.auth_session_gate_probe ENABLE ROW LEVEL SECURITY;

CREATE POLICY auth_hook_probe_control_read
  ON private.auth_hook_probe_control
  FOR SELECT TO supabase_auth_admin
  USING (true);

CREATE POLICY auth_hook_event_probe_insert
  ON private.auth_hook_event_probe
  FOR INSERT TO supabase_auth_admin
  WITH CHECK (true);

CREATE POLICY auth_session_gate_probe_read
  ON private.auth_session_gate_probe
  FOR SELECT TO supabase_auth_admin
  USING (true);

CREATE POLICY auth_session_gate_probe_insert
  ON private.auth_session_gate_probe
  FOR INSERT TO supabase_auth_admin
  WITH CHECK (true);

CREATE POLICY auth_session_gate_probe_update
  ON private.auth_session_gate_probe
  FOR UPDATE TO supabase_auth_admin
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE private.auth_hook_probe_control
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON TABLE private.auth_hook_event_probe
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON TABLE private.auth_session_gate_probe
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

GRANT SELECT ON TABLE private.auth_hook_probe_control TO supabase_auth_admin;
GRANT INSERT ON TABLE private.auth_hook_event_probe TO supabase_auth_admin;
GRANT SELECT, INSERT, UPDATE
  ON TABLE private.auth_session_gate_probe
  TO supabase_auth_admin;

CREATE FUNCTION private.batch_5f_b1_custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  event_user_id uuid;
  event_session_id uuid;
  event_authentication_method text;
  event_claims jsonb;
  event_session_state text;
  gate_exists boolean;
BEGIN
  IF jsonb_typeof(event) IS DISTINCT FROM 'object'
     OR jsonb_typeof(event->'claims') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Batch 5F-B1 hook: malformed event';
  END IF;

  BEGIN
    event_user_id := (event->>'user_id')::uuid;
    event_session_id := (event->'claims'->>'session_id')::uuid;
  EXCEPTION WHEN invalid_text_representation OR null_value_not_allowed THEN
    RAISE EXCEPTION 'Batch 5F-B1 hook: invalid user/session identity';
  END;

  event_authentication_method := event->>'authentication_method';
  IF event_user_id IS NULL
     OR event_session_id IS NULL
     OR event_authentication_method IS NULL
     OR btrim(event_authentication_method) = '' THEN
    RAISE EXCEPTION 'Batch 5F-B1 hook: required event field is missing';
  END IF;

  IF event_authentication_method = 'recovery' THEN
    INSERT INTO private.auth_session_gate_probe (
      session_id,
      user_id,
      gate_type,
      first_authentication_method
    ) VALUES (
      event_session_id,
      event_user_id,
      CASE
        WHEN (
          SELECT control.force_recovery_failure
          FROM private.auth_hook_probe_control AS control
          WHERE control.singleton
        ) THEN 'FORCED_INSERT_FAILURE'
        ELSE 'RECOVERY_PENDING'
      END,
      'recovery'
    )
    ON CONFLICT (session_id) DO NOTHING;

    IF NOT EXISTS (
      SELECT 1
      FROM private.auth_session_gate_probe AS gate
      WHERE gate.session_id = event_session_id
        AND gate.user_id = event_user_id
        AND gate.gate_type = 'RECOVERY_PENDING'
    ) THEN
      RAISE EXCEPTION 'Batch 5F-B1 hook: conflicting recovery gate';
    END IF;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM private.auth_session_gate_probe AS gate
    WHERE gate.session_id = event_session_id
      AND gate.user_id = event_user_id
      AND gate.gate_type = 'RECOVERY_PENDING'
  ) INTO gate_exists;

  IF event_authentication_method = 'token_refresh' AND gate_exists THEN
    UPDATE private.auth_session_gate_probe AS gate
    SET
      observed_refresh = true,
      last_observed_at = clock_timestamp()
    WHERE gate.session_id = event_session_id
      AND gate.user_id = event_user_id;
  END IF;

  event_session_state := CASE
    WHEN gate_exists THEN 'recovery_pending_v1'
    ELSE 'normal_v1'
  END;

  INSERT INTO private.auth_hook_event_probe (
    user_id,
    session_id,
    authentication_method,
    session_state,
    execution_current_user,
    execution_session_user
  ) VALUES (
    event_user_id,
    event_session_id,
    event_authentication_method,
    event_session_state,
    current_user,
    session_user
  );

  event_claims := jsonb_set(
    event->'claims',
    '{purplelok_session_state}',
    to_jsonb(event_session_state),
    true
  );

  RETURN jsonb_build_object('claims', event_claims);
END
$function$;

ALTER FUNCTION private.batch_5f_b1_custom_access_token_hook(jsonb)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION private.batch_5f_b1_custom_access_token_hook(jsonb)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE
  ON FUNCTION private.batch_5f_b1_custom_access_token_hook(jsonb)
  TO supabase_auth_admin;

DO $security_contract$
BEGIN
  IF NOT has_function_privilege(
      'supabase_auth_admin',
      'private.batch_5f_b1_custom_access_token_hook(jsonb)',
      'EXECUTE'
    )
    OR has_function_privilege(
      'anon',
      'private.batch_5f_b1_custom_access_token_hook(jsonb)',
      'EXECUTE'
    )
    OR has_function_privilege(
      'authenticated',
      'private.batch_5f_b1_custom_access_token_hook(jsonb)',
      'EXECUTE'
    )
    OR has_function_privilege(
      'service_role',
      'private.batch_5f_b1_custom_access_token_hook(jsonb)',
      'EXECUTE'
    ) THEN
    RAISE EXCEPTION 'Batch 5F-B1 hook ACL is invalid';
  END IF;

  IF has_schema_privilege('anon', 'private', 'USAGE')
     OR has_schema_privilege('authenticated', 'private', 'USAGE')
     OR has_schema_privilege('service_role', 'private', 'USAGE') THEN
    RAISE EXCEPTION 'Batch 5F-B1 private schema is browser/server-key accessible';
  END IF;
END
$security_contract$;
