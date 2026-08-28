BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(45);

-- This test-only helper mirrors the migration's fail-closed trigger baseline
-- assertion. Every mutation case runs in a failing statement, so PostgreSQL
-- restores the original trigger catalogue before the next assertion.
CREATE FUNCTION public.batch_3b_test_assert_touch_trigger_baseline()
RETURNS void
LANGUAGE plpgsql
AS $helper$
BEGIN
  IF (SELECT count(*)
        FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE (n.nspname = 'public'
              AND NOT t.tgisinternal
              AND c.relname = ANY (ARRAY[
                'clients', 'leads', 'quotes', 'invoices', 'projects', 'tasks',
                'tickets'
              ]))
          OR t.tgname = ANY (ARRAY[
               'touch_clients', 'touch_leads', 'touch_quotes',
               'touch_invoices', 'touch_projects', 'touch_tasks',
               'touch_tickets'
             ])) <> 7
     OR (WITH expected(table_name, trigger_name) AS (VALUES
           ('clients', 'touch_clients'),
           ('leads', 'touch_leads'),
           ('quotes', 'touch_quotes'),
           ('invoices', 'touch_invoices'),
           ('projects', 'touch_projects'),
           ('tasks', 'touch_tasks'),
           ('tickets', 'touch_tickets')
         )
         SELECT count(*)
           FROM expected e
           JOIN pg_class c ON c.relname = e.table_name
           JOIN pg_namespace n
             ON n.oid = c.relnamespace
            AND n.nspname = 'public'
           JOIN pg_trigger t
             ON t.tgrelid = c.oid
            AND t.tgname = e.trigger_name
          WHERE NOT t.tgisinternal
            AND t.tgenabled = 'O'
            AND t.tgtype = 19
            AND t.tgfoid = to_regprocedure('public.touch_updated_at()')) <> 7 THEN
    RAISE EXCEPTION 'Batch 3B preflight: updated_at trigger catalogue differs from the approved baseline';
  END IF;
END
$helper$;

CREATE FUNCTION public.batch_3b_test_unexpected_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $helper$
BEGIN
  RETURN NEW;
END
$helper$;

-- ============ TRIGGER BASELINE / RESTORATION ============

WITH expected_tables(table_name) AS (VALUES
  ('clients'), ('leads'), ('quotes'), ('invoices'), ('projects'), ('tasks'),
  ('tickets')
), expected_names(trigger_name) AS (VALUES
  ('touch_clients'), ('touch_leads'), ('touch_quotes'), ('touch_invoices'),
  ('touch_projects'), ('touch_tasks'), ('touch_tickets')
)
SELECT is(
  (SELECT count(*)::integer
     FROM pg_trigger t
     JOIN pg_class c ON c.oid = t.tgrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE (n.nspname = 'public'
           AND NOT t.tgisinternal
           AND c.relname IN (SELECT table_name FROM expected_tables))
       OR t.tgname IN (SELECT trigger_name FROM expected_names)),
  7,
  'exactly seven expected Batch 3B touch triggers exist'
);

WITH expected(table_name, trigger_name) AS (VALUES
  ('clients', 'touch_clients'),
  ('leads', 'touch_leads'),
  ('quotes', 'touch_quotes'),
  ('invoices', 'touch_invoices'),
  ('projects', 'touch_projects'),
  ('tasks', 'touch_tasks'),
  ('tickets', 'touch_tickets')
), actual AS (
  SELECT c.relname::text, t.tgname::text
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND NOT t.tgisinternal
     AND c.relname IN (
       'clients', 'leads', 'quotes', 'invoices', 'projects', 'tasks', 'tickets'
     )
     AND t.tgname IN (
       'touch_clients', 'touch_leads', 'touch_quotes', 'touch_invoices',
       'touch_projects', 'touch_tasks', 'touch_tickets'
     )
)
SELECT is(
  (SELECT count(*)::integer FROM (
    (SELECT * FROM expected EXCEPT ALL SELECT * FROM actual)
    UNION ALL
    (SELECT * FROM actual EXCEPT ALL SELECT * FROM expected)
  ) differences),
  0,
  'each Batch 3B touch trigger is bound to the approved table'
);

SELECT is(
  (SELECT count(*)::integer
     FROM pg_trigger t
    WHERE t.tgrelid IN (
      'public.clients'::regclass, 'public.leads'::regclass,
      'public.quotes'::regclass, 'public.invoices'::regclass,
      'public.projects'::regclass, 'public.tasks'::regclass,
      'public.tickets'::regclass
    )
      AND t.tgname IN (
        'touch_clients', 'touch_leads', 'touch_quotes', 'touch_invoices',
        'touch_projects', 'touch_tasks', 'touch_tickets'
      )
      AND NOT t.tgisinternal
      AND t.tgfoid = 'public.touch_updated_at()'::regprocedure),
  7,
  'each Batch 3B touch trigger calls public.touch_updated_at()'
);

SELECT is(
  (SELECT count(*)::integer
     FROM pg_trigger t
    WHERE t.tgname IN (
      'touch_clients', 'touch_leads', 'touch_quotes', 'touch_invoices',
      'touch_projects', 'touch_tasks', 'touch_tickets'
    )
      AND NOT t.tgisinternal
      AND (t.tgtype & 1) = 1),
  7,
  'each Batch 3B touch trigger is row-level'
);

SELECT is(
  (SELECT count(*)::integer
     FROM pg_trigger t
    WHERE t.tgname IN (
      'touch_clients', 'touch_leads', 'touch_quotes', 'touch_invoices',
      'touch_projects', 'touch_tasks', 'touch_tickets'
    )
      AND NOT t.tgisinternal
      AND (t.tgtype & 2) = 2
      AND (t.tgtype & 16) = 16
      AND (t.tgtype & (4 | 8 | 32 | 64)) = 0),
  7,
  'each Batch 3B touch trigger is BEFORE UPDATE only'
);

SELECT is(
  (SELECT count(*)::integer
     FROM pg_trigger t
    WHERE t.tgname IN (
      'touch_clients', 'touch_leads', 'touch_quotes', 'touch_invoices',
      'touch_projects', 'touch_tasks', 'touch_tickets'
    )
      AND NOT t.tgisinternal
      AND t.tgenabled = 'O'),
  7,
  'each Batch 3B touch trigger is ordinary enabled'
);

SELECT throws_ok(
  $sql$
    DO $case$
    BEGIN
      EXECUTE 'ALTER TABLE public.clients DISABLE TRIGGER touch_clients';
      PERFORM public.batch_3b_test_assert_touch_trigger_baseline();
    END
    $case$
  $sql$,
  'P0001',
  'Batch 3B preflight: updated_at trigger catalogue differs from the approved baseline',
  'trigger preflight rejects a disabled expected trigger'
);

SELECT throws_ok(
  $sql$
    DO $case$
    BEGIN
      EXECUTE 'ALTER TABLE public.clients ENABLE ALWAYS TRIGGER touch_clients';
      PERFORM public.batch_3b_test_assert_touch_trigger_baseline();
    END
    $case$
  $sql$,
  'P0001',
  'Batch 3B preflight: updated_at trigger catalogue differs from the approved baseline',
  'trigger preflight rejects ENABLE ALWAYS'
);

SELECT throws_ok(
  $sql$
    DO $case$
    BEGIN
      EXECUTE 'ALTER TABLE public.clients ENABLE REPLICA TRIGGER touch_clients';
      PERFORM public.batch_3b_test_assert_touch_trigger_baseline();
    END
    $case$
  $sql$,
  'P0001',
  'Batch 3B preflight: updated_at trigger catalogue differs from the approved baseline',
  'trigger preflight rejects ENABLE REPLICA'
);

SELECT throws_ok(
  $sql$
    DO $case$
    BEGIN
      EXECUTE 'DROP TRIGGER touch_clients ON public.clients';
      EXECUTE 'CREATE TRIGGER touch_clients BEFORE UPDATE ON public.clients '
           || 'FOR EACH ROW EXECUTE FUNCTION public.batch_3b_test_unexpected_touch_updated_at()';
      PERFORM public.batch_3b_test_assert_touch_trigger_baseline();
    END
    $case$
  $sql$,
  'P0001',
  'Batch 3B preflight: updated_at trigger catalogue differs from the approved baseline',
  'trigger preflight rejects an unexpected trigger function'
);

WITH expected(table_name, trigger_name, tgenabled, tgtype, function_oid) AS (VALUES
  ('clients', 'touch_clients', 'O', 19, 'public.touch_updated_at()'::regprocedure::oid),
  ('leads', 'touch_leads', 'O', 19, 'public.touch_updated_at()'::regprocedure::oid),
  ('quotes', 'touch_quotes', 'O', 19, 'public.touch_updated_at()'::regprocedure::oid),
  ('invoices', 'touch_invoices', 'O', 19, 'public.touch_updated_at()'::regprocedure::oid),
  ('projects', 'touch_projects', 'O', 19, 'public.touch_updated_at()'::regprocedure::oid),
  ('tasks', 'touch_tasks', 'O', 19, 'public.touch_updated_at()'::regprocedure::oid),
  ('tickets', 'touch_tickets', 'O', 19, 'public.touch_updated_at()'::regprocedure::oid)
), actual AS (
  SELECT c.relname::text, t.tgname::text, t.tgenabled::text,
         t.tgtype::integer, t.tgfoid
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND NOT t.tgisinternal
     AND c.relname IN (
       'clients', 'leads', 'quotes', 'invoices', 'projects', 'tasks', 'tickets'
     )
)
SELECT is(
  (SELECT count(*)::integer FROM (
    (SELECT * FROM expected EXCEPT ALL SELECT * FROM actual)
    UNION ALL
    (SELECT * FROM actual EXCEPT ALL SELECT * FROM expected)
  ) differences),
  0,
  'final touch trigger catalogue matches the approved pre-migration snapshot exactly'
);

-- ============ SCHEMA SHAPE ============

WITH domain_tables(name) AS (VALUES
  ('clients'), ('client_contacts'), ('client_notes'), ('leads'), ('quotes'),
  ('quote_items'), ('invoices'), ('invoice_items'), ('payments'), ('projects'),
  ('project_milestones'), ('tasks'), ('task_comments'), ('meetings'), ('documents'),
  ('tickets'), ('ticket_messages'), ('activities'), ('notifications'), ('channels'),
  ('messages')
)
SELECT is(
  (SELECT count(*)::integer
     FROM information_schema.columns c
     JOIN domain_tables t ON t.name = c.table_name
    WHERE c.table_schema = 'public' AND c.column_name = 'organization_id'),
  21,
  'all 21 CRM domain tables have organization_id'
);

SELECT hasnt_column('public', 'profiles', 'organization_id', 'profiles remains global identity');

WITH domain_tables(name) AS (VALUES
  ('clients'), ('client_contacts'), ('client_notes'), ('leads'), ('quotes'),
  ('quote_items'), ('invoices'), ('invoice_items'), ('payments'), ('projects'),
  ('project_milestones'), ('tasks'), ('task_comments'), ('meetings'), ('documents'),
  ('tickets'), ('ticket_messages'), ('activities'), ('notifications'), ('channels'),
  ('messages')
)
SELECT is(
  (SELECT count(*)::integer
     FROM information_schema.columns c
     JOIN domain_tables t ON t.name = c.table_name
    WHERE c.table_schema = 'public'
      AND c.column_name = 'organization_id'
      AND c.is_nullable = 'YES'),
  21,
  'every organization_id remains nullable'
);

WITH domain_tables(name) AS (VALUES
  ('clients'), ('client_contacts'), ('client_notes'), ('leads'), ('quotes'),
  ('quote_items'), ('invoices'), ('invoice_items'), ('payments'), ('projects'),
  ('project_milestones'), ('tasks'), ('task_comments'), ('meetings'), ('documents'),
  ('tickets'), ('ticket_messages'), ('activities'), ('notifications'), ('channels'),
  ('messages')
)
SELECT is(
  (SELECT count(*)::integer
     FROM information_schema.columns c
     JOIN domain_tables t ON t.name = c.table_name
    WHERE c.table_schema = 'public'
      AND c.column_name = 'organization_id'
      AND c.column_default IS NULL),
  21,
  'no organization_id has a default'
);

WITH domain_tables(name) AS (VALUES
  ('clients'), ('client_contacts'), ('client_notes'), ('leads'), ('quotes'),
  ('quote_items'), ('invoices'), ('invoice_items'), ('payments'), ('projects'),
  ('project_milestones'), ('tasks'), ('task_comments'), ('meetings'), ('documents'),
  ('tickets'), ('ticket_messages'), ('activities'), ('notifications'), ('channels'),
  ('messages')
)
SELECT is(
  (SELECT count(*)::integer
     FROM pg_constraint c
     JOIN pg_class r ON r.oid = c.conrelid
     JOIN pg_namespace n ON n.oid = r.relnamespace
     JOIN domain_tables t ON t.name = r.relname
    WHERE n.nspname = 'public'
      AND c.contype = 'f'
      AND c.conname = r.relname || '_organization_id_fkey'
      AND c.confdeltype = 'r'),
  21,
  'all direct organization foreign keys use ON DELETE RESTRICT'
);

WITH domain_tables(name) AS (VALUES
  ('clients'), ('client_contacts'), ('client_notes'), ('leads'), ('quotes'),
  ('quote_items'), ('invoices'), ('invoice_items'), ('payments'), ('projects'),
  ('project_milestones'), ('tasks'), ('task_comments'), ('meetings'), ('documents'),
  ('tickets'), ('ticket_messages'), ('activities'), ('notifications'), ('channels'),
  ('messages')
)
SELECT is(
  (SELECT count(*)::integer
     FROM pg_indexes i
     JOIN domain_tables t
       ON i.tablename = t.name
      AND i.indexname = 'idx_' || t.name || '_organization_id'
    WHERE i.schemaname = 'public'),
  21,
  'all 21 direct organization indexes exist'
);

-- ============ EXECUTABLE SEED MANIFEST ============

SELECT lives_ok(
  'SELECT public.batch_3b_assert_seed_manifest()',
  'verified repository seed manifest succeeds'
);

SELECT throws_ok(
  $sql$
    DO $case$
    BEGIN
      UPDATE public.clients
         SET notes = 'Batch 3B modified-seed sentinel'
       WHERE company_name = 'Aurora Technologies';
      PERFORM public.batch_3b_assert_seed_manifest();
    END
    $case$
  $sql$,
  'P0001',
  'Batch 3B seed manifest mismatch: expected/live material rows differ',
  'modified seed data fails the migration manifest guard'
);

SELECT throws_ok(
  $sql$
    DO $case$
    BEGIN
      INSERT INTO public.clients (company_name)
      VALUES ('Batch 3B unexpected extra client');
      PERFORM public.batch_3b_assert_seed_manifest();
    END
    $case$
  $sql$,
  'P0001',
  'Batch 3B seed manifest mismatch: expected/live material rows differ',
  'extra seed data fails the migration manifest guard'
);

SELECT throws_ok(
  $sql$
    DO $case$
    BEGIN
      DELETE FROM public.clients WHERE company_name = 'Aurora Technologies';
      PERFORM public.batch_3b_assert_seed_manifest();
    END
    $case$
  $sql$,
  'P0001',
  'Batch 3B seed manifest mismatch: expected/live material rows differ',
  'missing seed data fails the migration manifest guard'
);

-- ============ BACKFILL / ATTRIBUTION REGRESSION ============

WITH counts(n) AS (
  SELECT count(*) FROM public.clients UNION ALL
  SELECT count(*) FROM public.client_contacts UNION ALL
  SELECT count(*) FROM public.client_notes UNION ALL
  SELECT count(*) FROM public.leads UNION ALL
  SELECT count(*) FROM public.quotes UNION ALL
  SELECT count(*) FROM public.quote_items UNION ALL
  SELECT count(*) FROM public.invoices UNION ALL
  SELECT count(*) FROM public.invoice_items UNION ALL
  SELECT count(*) FROM public.payments UNION ALL
  SELECT count(*) FROM public.projects UNION ALL
  SELECT count(*) FROM public.project_milestones UNION ALL
  SELECT count(*) FROM public.tasks UNION ALL
  SELECT count(*) FROM public.task_comments UNION ALL
  SELECT count(*) FROM public.meetings UNION ALL
  SELECT count(*) FROM public.documents UNION ALL
  SELECT count(*) FROM public.tickets UNION ALL
  SELECT count(*) FROM public.ticket_messages UNION ALL
  SELECT count(*) FROM public.activities UNION ALL
  SELECT count(*) FROM public.notifications UNION ALL
  SELECT count(*) FROM public.channels UNION ALL
  SELECT count(*) FROM public.messages
)
SELECT is((SELECT sum(n)::integer FROM counts), 88, 'exactly 88 legacy domain rows remain');

WITH demo AS (SELECT id FROM public.organizations WHERE slug = 'purplelok-demo'),
counts(n) AS (
  SELECT count(*) FROM public.clients, demo WHERE organization_id = demo.id UNION ALL
  SELECT count(*) FROM public.client_contacts, demo WHERE organization_id = demo.id UNION ALL
  SELECT count(*) FROM public.client_notes, demo WHERE organization_id = demo.id UNION ALL
  SELECT count(*) FROM public.leads, demo WHERE organization_id = demo.id UNION ALL
  SELECT count(*) FROM public.quotes, demo WHERE organization_id = demo.id UNION ALL
  SELECT count(*) FROM public.quote_items, demo WHERE organization_id = demo.id UNION ALL
  SELECT count(*) FROM public.invoices, demo WHERE organization_id = demo.id UNION ALL
  SELECT count(*) FROM public.invoice_items, demo WHERE organization_id = demo.id UNION ALL
  SELECT count(*) FROM public.payments, demo WHERE organization_id = demo.id UNION ALL
  SELECT count(*) FROM public.projects, demo WHERE organization_id = demo.id UNION ALL
  SELECT count(*) FROM public.project_milestones, demo WHERE organization_id = demo.id UNION ALL
  SELECT count(*) FROM public.tasks, demo WHERE organization_id = demo.id UNION ALL
  SELECT count(*) FROM public.task_comments, demo WHERE organization_id = demo.id UNION ALL
  SELECT count(*) FROM public.meetings, demo WHERE organization_id = demo.id UNION ALL
  SELECT count(*) FROM public.documents, demo WHERE organization_id = demo.id UNION ALL
  SELECT count(*) FROM public.tickets, demo WHERE organization_id = demo.id UNION ALL
  SELECT count(*) FROM public.ticket_messages, demo WHERE organization_id = demo.id UNION ALL
  SELECT count(*) FROM public.activities, demo WHERE organization_id = demo.id UNION ALL
  SELECT count(*) FROM public.notifications, demo WHERE organization_id = demo.id UNION ALL
  SELECT count(*) FROM public.channels, demo WHERE organization_id = demo.id UNION ALL
  SELECT count(*) FROM public.messages, demo WHERE organization_id = demo.id
)
SELECT is((SELECT sum(n)::integer FROM counts), 88, 'all 88 rows belong to PURPLELOK Demo');

WITH real_org AS (SELECT id FROM public.organizations WHERE slug = 'purplelok'),
counts(n) AS (
  SELECT count(*) FROM public.clients, real_org WHERE organization_id = real_org.id UNION ALL
  SELECT count(*) FROM public.client_contacts, real_org WHERE organization_id = real_org.id UNION ALL
  SELECT count(*) FROM public.client_notes, real_org WHERE organization_id = real_org.id UNION ALL
  SELECT count(*) FROM public.leads, real_org WHERE organization_id = real_org.id UNION ALL
  SELECT count(*) FROM public.quotes, real_org WHERE organization_id = real_org.id UNION ALL
  SELECT count(*) FROM public.quote_items, real_org WHERE organization_id = real_org.id UNION ALL
  SELECT count(*) FROM public.invoices, real_org WHERE organization_id = real_org.id UNION ALL
  SELECT count(*) FROM public.invoice_items, real_org WHERE organization_id = real_org.id UNION ALL
  SELECT count(*) FROM public.payments, real_org WHERE organization_id = real_org.id UNION ALL
  SELECT count(*) FROM public.projects, real_org WHERE organization_id = real_org.id UNION ALL
  SELECT count(*) FROM public.project_milestones, real_org WHERE organization_id = real_org.id UNION ALL
  SELECT count(*) FROM public.tasks, real_org WHERE organization_id = real_org.id UNION ALL
  SELECT count(*) FROM public.task_comments, real_org WHERE organization_id = real_org.id UNION ALL
  SELECT count(*) FROM public.meetings, real_org WHERE organization_id = real_org.id UNION ALL
  SELECT count(*) FROM public.documents, real_org WHERE organization_id = real_org.id UNION ALL
  SELECT count(*) FROM public.tickets, real_org WHERE organization_id = real_org.id UNION ALL
  SELECT count(*) FROM public.ticket_messages, real_org WHERE organization_id = real_org.id UNION ALL
  SELECT count(*) FROM public.activities, real_org WHERE organization_id = real_org.id UNION ALL
  SELECT count(*) FROM public.notifications, real_org WHERE organization_id = real_org.id UNION ALL
  SELECT count(*) FROM public.channels, real_org WHERE organization_id = real_org.id UNION ALL
  SELECT count(*) FROM public.messages, real_org WHERE organization_id = real_org.id
)
SELECT is((SELECT sum(n)::integer FROM counts), 0, 'zero legacy rows belong to real PURPLELOK');

WITH counts(n) AS (
  SELECT count(*) FROM public.clients WHERE organization_id IS NULL UNION ALL
  SELECT count(*) FROM public.client_contacts WHERE organization_id IS NULL UNION ALL
  SELECT count(*) FROM public.client_notes WHERE organization_id IS NULL UNION ALL
  SELECT count(*) FROM public.leads WHERE organization_id IS NULL UNION ALL
  SELECT count(*) FROM public.quotes WHERE organization_id IS NULL UNION ALL
  SELECT count(*) FROM public.quote_items WHERE organization_id IS NULL UNION ALL
  SELECT count(*) FROM public.invoices WHERE organization_id IS NULL UNION ALL
  SELECT count(*) FROM public.invoice_items WHERE organization_id IS NULL UNION ALL
  SELECT count(*) FROM public.payments WHERE organization_id IS NULL UNION ALL
  SELECT count(*) FROM public.projects WHERE organization_id IS NULL UNION ALL
  SELECT count(*) FROM public.project_milestones WHERE organization_id IS NULL UNION ALL
  SELECT count(*) FROM public.tasks WHERE organization_id IS NULL UNION ALL
  SELECT count(*) FROM public.task_comments WHERE organization_id IS NULL UNION ALL
  SELECT count(*) FROM public.meetings WHERE organization_id IS NULL UNION ALL
  SELECT count(*) FROM public.documents WHERE organization_id IS NULL UNION ALL
  SELECT count(*) FROM public.tickets WHERE organization_id IS NULL UNION ALL
  SELECT count(*) FROM public.ticket_messages WHERE organization_id IS NULL UNION ALL
  SELECT count(*) FROM public.activities WHERE organization_id IS NULL UNION ALL
  SELECT count(*) FROM public.notifications WHERE organization_id IS NULL UNION ALL
  SELECT count(*) FROM public.channels WHERE organization_id IS NULL UNION ALL
  SELECT count(*) FROM public.messages WHERE organization_id IS NULL
)
SELECT is((SELECT sum(n)::integer FROM counts), 0, 'no legacy row remains unclassified');

WITH expected(id) AS (VALUES ('148803f0-322b-408e-9ffc-c9ce486172a6'::uuid)),
counts(n) AS (
  SELECT count(*) FROM public.leads, expected WHERE assigned_to = expected.id UNION ALL
  SELECT count(*) FROM public.quotes, expected WHERE created_by = expected.id UNION ALL
  SELECT count(*) FROM public.invoices, expected WHERE created_by = expected.id UNION ALL
  SELECT count(*) FROM public.projects, expected WHERE created_by = expected.id UNION ALL
  SELECT count(*) FROM public.projects, expected WHERE assigned_to = ARRAY[expected.id] UNION ALL
  SELECT count(*) FROM public.tasks, expected WHERE created_by = expected.id UNION ALL
  SELECT count(*) FROM public.tasks, expected WHERE assigned_to = expected.id UNION ALL
  SELECT count(*) FROM public.meetings, expected WHERE assigned_to = expected.id UNION ALL
  SELECT count(*) FROM public.tickets, expected WHERE created_by = expected.id UNION ALL
  SELECT count(*) FROM public.tickets, expected WHERE assigned_to = expected.id UNION ALL
  SELECT count(*) FROM public.ticket_messages, expected WHERE author_id = expected.id UNION ALL
  SELECT count(*) FROM public.activities, expected WHERE user_id = expected.id UNION ALL
  SELECT count(*) FROM public.notifications, expected WHERE user_id = expected.id UNION ALL
  SELECT count(*) FROM public.channels, expected WHERE created_by = expected.id UNION ALL
  SELECT count(*) FROM public.messages, expected WHERE author_id = expected.id
)
SELECT is((SELECT sum(n)::integer FROM counts), 54, 'all 54 bootstrap attributions remain unchanged');

SELECT lives_ok(
  $sql$
    DO $case$
    DECLARE v_id uuid;
    BEGIN
      INSERT INTO public.clients (company_name)
      VALUES ('Batch 3B nullable frontend insert')
      RETURNING id INTO v_id;
      IF (SELECT organization_id FROM public.clients WHERE id = v_id) IS NOT NULL THEN
        RAISE EXCEPTION 'organization_id unexpectedly populated';
      END IF;
      DELETE FROM public.clients WHERE id = v_id;
    END
    $case$
  $sql$,
  'frontend-style writes may temporarily omit organization_id'
);

-- ============ CROSS-TENANT FIXTURES ============

INSERT INTO public.clients (id, company_name, organization_id)
VALUES
  ('00000000-0000-0000-0000-00000003b101', 'Batch 3B Real Client',
    (SELECT id FROM public.organizations WHERE slug = 'purplelok')),
  ('00000000-0000-0000-0000-00000003b102', 'Batch 3B Demo Client',
    (SELECT id FROM public.organizations WHERE slug = 'purplelok-demo'));

INSERT INTO public.projects (id, name, client_id, organization_id)
VALUES (
  '00000000-0000-0000-0000-00000003b201',
  'Batch 3B Real Project',
  '00000000-0000-0000-0000-00000003b101',
  (SELECT id FROM public.organizations WHERE slug = 'purplelok')
);

INSERT INTO public.invoices (id, invoice_number, client_id, title, organization_id)
VALUES (
  '00000000-0000-0000-0000-00000003b301',
  'B3B-REAL-INV',
  '00000000-0000-0000-0000-00000003b101',
  'Batch 3B Real Invoice',
  (SELECT id FROM public.organizations WHERE slug = 'purplelok')
);

INSERT INTO public.documents (id, name, type, organization_id)
VALUES (
  '00000000-0000-0000-0000-00000003b401',
  'Batch 3B Real Folder',
  'folder',
  (SELECT id FROM public.organizations WHERE slug = 'purplelok')
);

SELECT throws_ok(
  $$
    INSERT INTO public.client_contacts (client_id, name, organization_id)
    VALUES (
      '00000000-0000-0000-0000-00000003b101',
      'Cross Tenant Contact',
      (SELECT id FROM public.organizations WHERE slug = 'purplelok-demo')
    )
  $$,
  '23503',
  'insert or update on table "client_contacts" violates foreign key constraint "client_contacts_client_organization_fkey"',
  'a populated child tenant cannot disagree with its client parent'
);

SELECT throws_ok(
  $$
    INSERT INTO public.documents (name, type, folder_id, organization_id)
    VALUES (
      'Cross Tenant Child Folder',
      'folder',
      '00000000-0000-0000-0000-00000003b401',
      (SELECT id FROM public.organizations WHERE slug = 'purplelok-demo')
    )
  $$,
  '23503',
  'insert or update on table "documents" violates foreign key constraint "documents_folder_organization_fkey"',
  'document folders cannot cross tenant boundaries'
);

SELECT throws_ok(
  $$
    INSERT INTO public.payments (invoice_id, client_id, amount, organization_id)
    VALUES (
      '00000000-0000-0000-0000-00000003b301',
      '00000000-0000-0000-0000-00000003b102',
      1,
      (SELECT id FROM public.organizations WHERE slug = 'purplelok')
    )
  $$,
  '23503',
  'insert or update on table "payments" violates foreign key constraint "payments_client_organization_fkey"',
  'payment invoice/client tenants cannot disagree'
);

SELECT throws_ok(
  $$
    INSERT INTO public.tasks (title, project_id, client_id, organization_id)
    VALUES (
      'Cross Tenant Task',
      '00000000-0000-0000-0000-00000003b201',
      '00000000-0000-0000-0000-00000003b102',
      (SELECT id FROM public.organizations WHERE slug = 'purplelok')
    )
  $$,
  '23503',
  'insert or update on table "tasks" violates foreign key constraint "tasks_client_organization_fkey"',
  'task project/client tenants cannot disagree'
);

SELECT throws_ok(
  $$
    INSERT INTO public.meetings (title, project_id, client_id, organization_id)
    VALUES (
      'Cross Tenant Meeting',
      '00000000-0000-0000-0000-00000003b201',
      '00000000-0000-0000-0000-00000003b102',
      (SELECT id FROM public.organizations WHERE slug = 'purplelok')
    )
  $$,
  '23503',
  'insert or update on table "meetings" violates foreign key constraint "meetings_client_organization_fkey"',
  'meeting project/client tenants cannot disagree'
);

-- ============ PRESERVED AUTHORITY / RLS / NUMBERING ============

SELECT is(
  (SELECT role FROM public.profiles WHERE email = 'admin@purplelok.com'),
  'super_admin',
  'bootstrap profiles.role remains unchanged'
);

SELECT is(
  (SELECT role FROM public.profiles WHERE email = 'siyamyataza11@gmail.com'),
  'staff',
  'real owner profiles.role remains unchanged'
);

SELECT is((SELECT count(*)::integer FROM public.platform_admins), 0, 'platform_admins remains empty');

SELECT is(
  (SELECT count(*)::integer
     FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = ANY (ARRAY[
        'profiles', 'clients', 'client_contacts', 'client_notes', 'leads',
        'quotes', 'quote_items', 'invoices', 'invoice_items', 'payments',
        'projects', 'project_milestones', 'tasks', 'task_comments', 'meetings',
        'documents', 'tickets', 'ticket_messages', 'activities', 'notifications',
        'channels', 'messages'
      ])),
  88,
  'the existing 88 CRM RLS policies remain present'
);

SELECT is(
  (SELECT count(*)::integer
     FROM pg_constraint
    WHERE contype = 'u'
      AND conname IN ('quotes_quote_number_key', 'invoices_invoice_number_key', 'tickets_ticket_number_key')),
  3,
  'global quote, invoice, and ticket numbering constraints remain unchanged'
);

SELECT throws_ok(
  $$
    INSERT INTO public.quotes (quote_number, client_id, title, organization_id)
    VALUES (
      'QUO-2026-0001',
      '00000000-0000-0000-0000-00000003b101',
      'Duplicate tenant quote number',
      (SELECT id FROM public.organizations WHERE slug = 'purplelok')
    )
  $$,
  '23505',
  'duplicate key value violates unique constraint "quotes_quote_number_key"',
  'a second tenant cannot yet reuse a quote number'
);

SELECT throws_ok(
  $$
    INSERT INTO public.invoices (invoice_number, client_id, title, organization_id)
    VALUES (
      'INV-2026-0001',
      '00000000-0000-0000-0000-00000003b101',
      'Duplicate tenant invoice number',
      (SELECT id FROM public.organizations WHERE slug = 'purplelok')
    )
  $$,
  '23505',
  'duplicate key value violates unique constraint "invoices_invoice_number_key"',
  'a second tenant cannot yet reuse an invoice number'
);

SELECT throws_ok(
  $$
    INSERT INTO public.tickets (ticket_number, subject, client_id, organization_id)
    VALUES (
      'TKT-2026-0001',
      'Duplicate tenant ticket number',
      '00000000-0000-0000-0000-00000003b101',
      (SELECT id FROM public.organizations WHERE slug = 'purplelok')
    )
  $$,
  '23505',
  'duplicate key value violates unique constraint "tickets_ticket_number_key"',
  'a second tenant cannot yet reuse a ticket number'
);

SELECT is(
  (SELECT count(*)::integer
     FROM pg_constraint c
     JOIN pg_class r ON r.oid = c.conrelid
     JOIN pg_namespace n ON n.oid = r.relnamespace
    WHERE n.nspname = 'public'
      AND c.contype = 'f'
      AND cardinality(c.conkey) = 2
      AND c.conname LIKE '%_organization_fkey'),
  22,
  'all 22 composite tenant foreign keys exist'
);

SELECT is(
  (SELECT count(*)::integer
     FROM pg_constraint
    WHERE contype = 'u'
      AND conname IN (
        'clients_id_organization_id_key', 'quotes_id_organization_id_key',
        'invoices_id_organization_id_key', 'projects_id_organization_id_key',
        'tasks_id_organization_id_key', 'documents_id_organization_id_key',
        'tickets_id_organization_id_key', 'channels_id_organization_id_key'
      )),
  8,
  'all eight composite parent keys exist'
);

SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.batch_3b_assert_seed_manifest()',
    'EXECUTE'
  ),
  'browser roles cannot execute the seed-manifest assertion'
);

-- A failure late in one migration statement rolls its prior mutation back.
SELECT throws_ok(
  $sql$
    DO $late$
    BEGIN
      UPDATE public.clients
         SET company_name = 'Batch 3B late-failure sentinel'
       WHERE company_name = 'Aurora Technologies';
      RAISE EXCEPTION 'Batch 3B forced late assertion failure';
    END
    $late$
  $sql$,
  'P0001',
  'Batch 3B forced late assertion failure',
  'a late migration assertion aborts the enclosing statement'
);

SELECT is(
  (SELECT count(*)::integer FROM public.clients WHERE company_name = 'Aurora Technologies'),
  1,
  'the mutation before a late assertion failure was rolled back'
);

SELECT * FROM finish();

ROLLBACK;
