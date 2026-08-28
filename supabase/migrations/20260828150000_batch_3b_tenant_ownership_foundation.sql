/*
# Batch 3B: Tenant ownership foundation

Adds nullable organization ownership to the 21 CRM domain tables, proves the
legacy dataset is still the repository seed manifest, and assigns those 88
rows to PURPLELOK Demo. Existing browser policies and attribution fields are
preserved. Nullable ownership intentionally remains compatible with the
current frontend until organization-aware writes are implemented.
*/

BEGIN ISOLATION LEVEL SERIALIZABLE;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '5min';

-- SHARE ROW EXCLUSIVE blocks concurrent INSERT/UPDATE/DELETE and DDL while
-- allowing ordinary SELECT queries to continue during validation/backfill.
LOCK TABLE
  public.clients,
  public.client_contacts,
  public.client_notes,
  public.leads,
  public.quotes,
  public.quote_items,
  public.invoices,
  public.invoice_items,
  public.payments,
  public.projects,
  public.project_milestones,
  public.tasks,
  public.task_comments,
  public.meetings,
  public.documents,
  public.tickets,
  public.ticket_messages,
  public.activities,
  public.notifications,
  public.channels,
  public.messages
IN SHARE ROW EXCLUSIVE MODE;

-- ============ FAIL-CLOSED TENANT / IDENTITY PREFLIGHT ============

DO $preflight$
DECLARE
  v_demo_id uuid;
  v_real_id uuid;
  v_count integer;
  v_domain_tables constant text[] := ARRAY[
    'clients', 'client_contacts', 'client_notes', 'leads', 'quotes',
    'quote_items', 'invoices', 'invoice_items', 'payments', 'projects',
    'project_milestones', 'tasks', 'task_comments', 'meetings', 'documents',
    'tickets', 'ticket_messages', 'activities', 'notifications', 'channels',
    'messages'
  ];
BEGIN
  SELECT count(*)::integer
    INTO v_count
    FROM public.organizations
   WHERE slug = 'purplelok-demo'
     AND name = 'PURPLELOK Demo'
     AND status = 'active';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Batch 3B preflight: expected exactly one active PURPLELOK Demo organization';
  END IF;
  SELECT id INTO STRICT v_demo_id
    FROM public.organizations
   WHERE slug = 'purplelok-demo'
     AND name = 'PURPLELOK Demo'
     AND status = 'active';

  SELECT count(*)::integer
    INTO v_count
    FROM public.organizations
   WHERE slug = 'purplelok'
     AND name = 'PURPLELOK'
     AND status = 'active';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Batch 3B preflight: expected exactly one active PURPLELOK organization';
  END IF;
  SELECT id INTO STRICT v_real_id
    FROM public.organizations
   WHERE slug = 'purplelok'
     AND name = 'PURPLELOK'
     AND status = 'active';

  IF v_demo_id = v_real_id THEN
    RAISE EXCEPTION 'Batch 3B preflight: real and demo organizations resolve to the same ID';
  END IF;

  IF (SELECT count(*) FROM public.organizations
       WHERE slug = 'purplelok-demo' OR name = 'PURPLELOK Demo') <> 1 THEN
    RAISE EXCEPTION 'Batch 3B preflight: PURPLELOK Demo name/slug conflict';
  END IF;
  IF (SELECT count(*) FROM public.organizations
       WHERE slug = 'purplelok' OR name = 'PURPLELOK') <> 1 THEN
    RAISE EXCEPTION 'Batch 3B preflight: PURPLELOK name/slug conflict';
  END IF;

  IF (SELECT count(*) FROM auth.users WHERE email = 'admin@purplelok.com') <> 1
     OR (SELECT count(*) FROM public.profiles WHERE email = 'admin@purplelok.com') <> 1
     OR (SELECT count(*)
           FROM auth.users u
           JOIN public.profiles p ON p.id = u.id AND p.email = u.email
          WHERE u.email = 'admin@purplelok.com' AND p.active) <> 1 THEN
    RAISE EXCEPTION 'Batch 3B preflight: bootstrap auth/profile identity is missing, ambiguous, inconsistent, or inactive';
  END IF;

  IF (SELECT count(*) FROM auth.users WHERE email = 'siyamyataza11@gmail.com') <> 1
     OR (SELECT count(*) FROM public.profiles WHERE email = 'siyamyataza11@gmail.com') <> 1
     OR (SELECT count(*)
           FROM auth.users u
           JOIN public.profiles p ON p.id = u.id AND p.email = u.email
          WHERE u.email = 'siyamyataza11@gmail.com' AND p.active) <> 1 THEN
    RAISE EXCEPTION 'Batch 3B preflight: owner auth/profile identity is missing, ambiguous, inconsistent, or inactive';
  END IF;

  IF (SELECT count(*)
        FROM public.organization_members m
        JOIN public.profiles p ON p.id = m.user_id
       WHERE p.email = 'admin@purplelok.com') <> 1
     OR (SELECT count(*)
           FROM public.organization_members m
           JOIN public.profiles p ON p.id = m.user_id
          WHERE p.email = 'admin@purplelok.com'
            AND m.organization_id = v_demo_id
            AND m.status = 'active'
            AND m.job_title = 'Demo Administrator') <> 1 THEN
    RAISE EXCEPTION 'Batch 3B preflight: bootstrap must have exactly one compatible demo membership only';
  END IF;

  IF (SELECT count(*)
        FROM public.organization_member_roles mr
        JOIN public.organization_members m
          ON m.id = mr.organization_member_id
         AND m.organization_id = mr.organization_id
        JOIN public.organization_roles r
          ON r.id = mr.organization_role_id
         AND r.organization_id = mr.organization_id
        JOIN public.profiles p ON p.id = m.user_id
       WHERE p.email = 'admin@purplelok.com'
         AND m.organization_id = v_demo_id) <> 1
     OR (SELECT count(*)
           FROM public.organization_member_roles mr
           JOIN public.organization_members m
             ON m.id = mr.organization_member_id
            AND m.organization_id = mr.organization_id
           JOIN public.organization_roles r
             ON r.id = mr.organization_role_id
            AND r.organization_id = mr.organization_id
           JOIN public.profiles p ON p.id = m.user_id
          WHERE p.email = 'admin@purplelok.com'
            AND m.organization_id = v_demo_id
            AND r.key = 'admin') <> 1 THEN
    RAISE EXCEPTION 'Batch 3B preflight: bootstrap must have the demo Admin role only';
  END IF;

  IF (SELECT count(*)
        FROM public.organization_members m
        JOIN public.profiles p ON p.id = m.user_id
       WHERE p.email = 'siyamyataza11@gmail.com') <> 1
     OR (SELECT count(*)
           FROM public.organization_members m
           JOIN public.profiles p ON p.id = m.user_id
          WHERE p.email = 'siyamyataza11@gmail.com'
            AND m.organization_id = v_real_id
            AND m.status = 'active') <> 1 THEN
    RAISE EXCEPTION 'Batch 3B preflight: owner must have exactly one active real membership only';
  END IF;

  IF (SELECT count(*)
        FROM public.organization_member_roles mr
        JOIN public.organization_members m
          ON m.id = mr.organization_member_id
         AND m.organization_id = mr.organization_id
        JOIN public.organization_roles r
          ON r.id = mr.organization_role_id
         AND r.organization_id = mr.organization_id
        JOIN public.profiles p ON p.id = m.user_id
       WHERE p.email = 'siyamyataza11@gmail.com'
         AND m.organization_id = v_real_id) <> 1
     OR (SELECT count(*)
           FROM public.organization_member_roles mr
           JOIN public.organization_members m
             ON m.id = mr.organization_member_id
            AND m.organization_id = mr.organization_id
           JOIN public.organization_roles r
             ON r.id = mr.organization_role_id
            AND r.organization_id = mr.organization_id
           JOIN public.profiles p ON p.id = m.user_id
          WHERE p.email = 'siyamyataza11@gmail.com'
            AND m.organization_id = v_real_id
            AND r.key = 'owner') <> 1 THEN
    RAISE EXCEPTION 'Batch 3B preflight: real owner must have the Owner role only';
  END IF;

  IF EXISTS (SELECT 1 FROM public.platform_admins) THEN
    RAISE EXCEPTION 'Batch 3B preflight: platform_admins must remain empty';
  END IF;

  IF (SELECT role FROM public.profiles WHERE email = 'admin@purplelok.com') <> 'super_admin'
     OR (SELECT role FROM public.profiles WHERE email = 'siyamyataza11@gmail.com') <> 'staff' THEN
    RAISE EXCEPTION 'Batch 3B preflight: protected legacy profile roles changed';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = ANY (v_domain_tables)
       AND column_name = 'organization_id'
  ) THEN
    RAISE EXCEPTION 'Batch 3B preflight: organization_id already exists on a domain table';
  END IF;

  IF to_regprocedure('public.batch_3b_assert_seed_manifest()') IS NOT NULL THEN
    RAISE EXCEPTION 'Batch 3B preflight: seed-manifest assertion function already exists';
  END IF;

  IF (SELECT count(*) FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename = ANY (ARRAY['profiles'] || v_domain_tables)) <> 88 THEN
    RAISE EXCEPTION 'Batch 3B preflight: expected exactly 88 existing CRM RLS policies';
  END IF;

  -- Fail closed unless the complete user-trigger catalogue on the seven
  -- updated_at tables matches the approved production baseline. tgtype = 19
  -- means row-level (1), BEFORE (2), UPDATE (16), and no other event bits.
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
$preflight$;

-- Capture the exact relevant trigger catalogue before any Batch 3B schema or
-- trigger change. The postcondition compares this snapshot in both directions.
CREATE TEMP TABLE batch_3b_trigger_snapshot ON COMMIT DROP AS
SELECT t.oid AS trigger_oid,
       n.nspname::text AS table_schema,
       c.relname::text AS table_name,
       t.tgname::text AS trigger_name,
       t.tgisinternal,
       t.tgenabled,
       t.tgtype,
       t.tgfoid AS trigger_function_oid,
       pn.nspname::text AS function_schema,
       p.proname::text AS function_name,
       pg_get_function_identity_arguments(p.oid) AS function_arguments,
       t.tgnargs,
       encode(t.tgargs, 'hex') AS trigger_arguments,
       pg_get_triggerdef(t.oid, false) AS trigger_definition
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_proc p ON p.oid = t.tgfoid
  JOIN pg_namespace pn ON pn.oid = p.pronamespace
 WHERE (n.nspname = 'public'
        AND NOT t.tgisinternal
        AND c.relname = ANY (ARRAY[
          'clients', 'leads', 'quotes', 'invoices', 'projects', 'tasks',
          'tickets'
        ]))
    OR t.tgname = ANY (ARRAY[
         'touch_clients', 'touch_leads', 'touch_quotes', 'touch_invoices',
         'touch_projects', 'touch_tasks', 'touch_tickets'
       ]);

-- Exact transaction-scoped snapshots prove Batch 3B changes no existing value
-- other than the newly introduced organization_id columns.
CREATE TEMP TABLE batch_3b_profile_snapshot ON COMMIT DROP AS
SELECT id, role FROM public.profiles;

CREATE TEMP TABLE batch_3b_policy_snapshot ON COMMIT DROP AS
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
  FROM pg_policies
 WHERE schemaname = 'public'
   AND tablename = ANY (ARRAY[
     'profiles', 'clients', 'client_contacts', 'client_notes', 'leads',
     'quotes', 'quote_items', 'invoices', 'invoice_items', 'payments',
     'projects', 'project_milestones', 'tasks', 'task_comments', 'meetings',
     'documents', 'tickets', 'ticket_messages', 'activities', 'notifications',
     'channels', 'messages'
   ]);

CREATE TEMP TABLE batch_3b_rls_snapshot ON COMMIT DROP AS
SELECT c.relname AS table_name, c.relrowsecurity, c.relforcerowsecurity
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND c.relname = ANY (ARRAY[
     'profiles', 'clients', 'client_contacts', 'client_notes', 'leads',
     'quotes', 'quote_items', 'invoices', 'invoice_items', 'payments',
     'projects', 'project_milestones', 'tasks', 'task_comments', 'meetings',
     'documents', 'tickets', 'ticket_messages', 'activities', 'notifications',
     'channels', 'messages'
   ]);

CREATE TEMP TABLE batch_3b_domain_snapshot (
  table_name text NOT NULL,
  row_id uuid NOT NULL,
  row_data jsonb NOT NULL,
  PRIMARY KEY (table_name, row_id)
) ON COMMIT DROP;

DO $snapshot$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'clients', 'client_contacts', 'client_notes', 'leads', 'quotes',
    'quote_items', 'invoices', 'invoice_items', 'payments', 'projects',
    'project_milestones', 'tasks', 'task_comments', 'meetings', 'documents',
    'tickets', 'ticket_messages', 'activities', 'notifications', 'channels',
    'messages'
  ]
  LOOP
    EXECUTE format(
      'INSERT INTO batch_3b_domain_snapshot SELECT %L, id, to_jsonb(t) FROM public.%I t',
      v_table,
      v_table
    );
  END LOOP;
END
$snapshot$;

-- This SECURITY INVOKER helper is retained for pgTAP and future audits. It is
-- executable only by the migration owner; browser and API roles receive no
-- grant. Expected and live normalized rows are compared in both directions.
CREATE FUNCTION public.batch_3b_assert_seed_manifest()
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $manifest$
DECLARE
  v_seeded_at timestamptz;
BEGIN
  SELECT min(created_at) INTO v_seeded_at FROM public.clients;
  IF v_seeded_at IS NULL
     OR (SELECT count(DISTINCT created_at) FROM public.clients) <> 1 THEN
    RAISE EXCEPTION 'Batch 3B seed manifest mismatch: seed timestamp is missing or ambiguous';
  END IF;

  IF EXISTS (
    WITH expected(table_name, stable_key, material) AS (VALUES
      ('activities', 'client_created', '["148803f0-322b-408e-9ffc-c9ce486172a6","client_created","client",null,"created client \"Aurora Technologies\"",{},"-2592000.000000"]'::jsonb),
      ('activities', 'invoice_created', '["148803f0-322b-408e-9ffc-c9ce486172a6","invoice_created","invoice",null,"created invoice INV-2026-0001",{},"-2332800.000000"]'::jsonb),
      ('activities', 'payment_received', '["148803f0-322b-408e-9ffc-c9ce486172a6","payment_received","payment",null,"recorded payment of R39,675 from Aurora Technologies",{},"-1382400.000000"]'::jsonb),
      ('activities', 'project_created', '["148803f0-322b-408e-9ffc-c9ce486172a6","project_created","project",null,"created project \"Aurora Tech Website Redesign\"",{},"-1728000.000000"]'::jsonb),
      ('activities', 'quote_created', '["148803f0-322b-408e-9ffc-c9ce486172a6","quote_created","quote",null,"created quote QUO-2026-0001 for Aurora Technologies",{},"-2160000.000000"]'::jsonb),
      ('channels', 'general', '["general","General team chat","148803f0-322b-408e-9ffc-c9ce486172a6"]'::jsonb),
      ('channels', 'projects', '["projects","Project discussions","148803f0-322b-408e-9ffc-c9ce486172a6"]'::jsonb),
      ('clients', 'Aurora Technologies', '["Aurora Technologies",null,"Sarah Mokoena","sarah@auroratech.co.za","+27 11 234 5678","+27 82 123 4567","123 Tech Park, Sandton, Johannesburg","PO Box 456, Sandton","2018/123456/07","4567890123","Technology","https://auroratech.co.za",{},"active","Long-term client, monthly maintenance contract.",["website","maintenance"],true,5,null]'::jsonb),
      ('clients', 'Bloom Beauty Co.', '["Bloom Beauty Co.",null,"Jessica Williams","jessica@bloombeauty.co.za","+27 31 456 7890","+27 84 567 8901","78 Beauty Lane, Durban","PO Box 321, Durban","2020/345678/07","1234567890","Beauty & Cosmetics","https://bloombeauty.co.za",{},"active","Website development and ongoing SEO.",["website","seo"],true,5,null]'::jsonb),
      ('clients', 'Green Leaf Organics', '["Green Leaf Organics",null,"Nomvula Dlamini","nomvula@greenleaf.co.za","+27 21 567 8901","+27 86 789 0123","12 Organic Way, Stellenbosch","PO Box 987, Stellenbosch","2021/901234/07","3456789012","Agriculture","https://greenleaf.co.za",{},"prospect","Interested in website redesign and branding package.",["website","branding"],false,4,null]'::jsonb),
      ('clients', 'Nexus Financial Services', '["Nexus Financial Services",null,"David Chen","david@nexusfin.co.za","+27 11 345 6789","+27 85 678 9012","90 Finance Street, Sandton","PO Box 654, Sandton","2015/567890/07","2345678901","Finance","https://nexusfin.co.za",{},"active","Corporate identity and email setup.",["branding","email"],false,4,null]'::jsonb),
      ('clients', 'Summit Construction Group', '["Summit Construction Group",null,"Thabo Nkosi","thabo@summitbuild.co.za","+27 21 789 0123","+27 83 456 7890","45 Building Road, Cape Town","PO Box 789, Cape Town","2016/789012/07","7890123456","Construction","https://summitbuild.co.za",{},"active","Branding and printing client.",["branding","printing"],false,4,null]'::jsonb),
      ('clients', 'Urban Grind Coffee', '["Urban Grind Coffee",null,"Mike Peterson","mike@urbangrind.co.za","+27 11 678 9012","+27 87 890 1234","34 Main Street, Rosebank","PO Box 111, Rosebank","2019/234567/07","4567890123","Food & Beverage","https://urbangrind.co.za",{},"active","Printing \u2014 business cards, flyers, and packaging.",["printing"],false,5,null]'::jsonb),
      ('invoice_items', 'INV-2026-0001|Backend Development (50% deposit)', '["INV-2026-0001","Backend Development (50% deposit)",1,7500,7500]'::jsonb),
      ('invoice_items', 'INV-2026-0001|Frontend Development (50% deposit)', '["INV-2026-0001","Frontend Development (50% deposit)",1,12500,12500]'::jsonb),
      ('invoice_items', 'INV-2026-0001|SEO (50% deposit)', '["INV-2026-0001","SEO (50% deposit)",1,3500,3500]'::jsonb),
      ('invoice_items', 'INV-2026-0001|UI/UX Design (50% deposit)', '["INV-2026-0001","UI/UX Design (50% deposit)",1,9000,9000]'::jsonb),
      ('invoice_items', 'INV-2026-0002|SEO Optimization', '["INV-2026-0002","SEO Optimization",1,10000,10000]'::jsonb),
      ('invoice_items', 'INV-2026-0002|Website Development', '["INV-2026-0002","Website Development",1,25000,25000]'::jsonb),
      ('invoice_items', 'INV-2026-0003|Business Cards (500x)', '["INV-2026-0003","Business Cards (500x)",1,2500,2500]'::jsonb),
      ('invoice_items', 'INV-2026-0003|Compliment Slips (500x)', '["INV-2026-0003","Compliment Slips (500x)",1,2500,2500]'::jsonb),
      ('invoice_items', 'INV-2026-0003|Flyers (2000x A5)', '["INV-2026-0003","Flyers (2000x A5)",1,4000,4000]'::jsonb),
      ('invoice_items', 'INV-2026-0003|Letterheads (1000x)', '["INV-2026-0003","Letterheads (1000x)",1,3500,3500]'::jsonb),
      ('invoice_items', 'INV-2026-0004|Brand Guidelines', '["INV-2026-0004","Brand Guidelines",1,8000,8000]'::jsonb),
      ('invoice_items', 'INV-2026-0004|Email Signatures', '["INV-2026-0004","Email Signatures",1,5000,5000]'::jsonb),
      ('invoice_items', 'INV-2026-0004|Logo Design', '["INV-2026-0004","Logo Design",1,10000,10000]'::jsonb),
      ('invoice_items', 'INV-2026-0004|Social Media Kit', '["INV-2026-0004","Social Media Kit",1,5000,5000]'::jsonb),
      ('invoices', 'INV-2026-0001', '["INV-2026-0001","Aurora Technologies",null,"Website Redesign \u2014 Deposit","paid",34500,0,5175,39675,15,39675,0,"2026-07-01","2026-07-15",false,null,null,"148803f0-322b-408e-9ffc-c9ce486172a6"]'::jsonb),
      ('invoices', 'INV-2026-0002', '["INV-2026-0002","Bloom Beauty Co.",null,"Website Development & SEO","partial",35000,0,5250,40250,15,20000,20250,"2026-07-10","2026-07-25",false,null,null,"148803f0-322b-408e-9ffc-c9ce486172a6"]'::jsonb),
      ('invoices', 'INV-2026-0003', '["INV-2026-0003","Urban Grind Coffee",null,"Printing \u2014 Business Cards & Flyers","sent",12500,0,1875,14375,15,0,14375,"2026-07-20","2026-08-03",false,null,null,"148803f0-322b-408e-9ffc-c9ce486172a6"]'::jsonb),
      ('invoices', 'INV-2026-0004', '["INV-2026-0004","Summit Construction Group",null,"Corporate Identity Package","overdue",28000,0,4200,32200,15,0,32200,"2026-06-15","2026-06-30",false,null,null,"148803f0-322b-408e-9ffc-c9ce486172a6"]'::jsonb),
      ('leads', 'Apex Mining Corp', '["Apex Mining Corp","Sipho Zulu","sipho@apexmining.co.za","+27 21 555 6666","Referral","won",90,150000,"2026-07-20","Mining company \u2014 full corporate identity and website. Won!","148803f0-322b-408e-9ffc-c9ce486172a6",null]'::jsonb),
      ('leads', 'Metro Health Clinic', '["Metro Health Clinic","Dr. Linda Mthembu","linda@metrohealth.co.za","+27 11 444 5555","Google Ads","negotiating",85,95000,"2026-08-05","Health clinic \u2014 website, SEO, and ongoing maintenance.","148803f0-322b-408e-9ffc-c9ce486172a6",null]'::jsonb),
      ('leads', 'Pinnacle Properties', '["Pinnacle Properties","John Matthews","john@pinnacleprop.co.za","+27 11 111 2222","Referral","new_lead",75,85000,"2026-08-15","Large property group \u2014 needs full website redesign and branding.","148803f0-322b-408e-9ffc-c9ce486172a6",null]'::jsonb),
      ('leads', 'QuickFix Plumbing', '["QuickFix Plumbing","Peter Brown","peter@quickfix.co.za","+27 31 666 7777","Cold call","lost",30,15000,"2026-06-30","Small plumbing business \u2014 went with competitor due to budget.","148803f0-322b-408e-9ffc-c9ce486172a6",null]'::jsonb),
      ('leads', 'Skyline Logistics', '["Skyline Logistics","Aisha Patel","aisha@skylinelog.co.za","+27 21 222 3333","Website","contacted",60,45000,"2026-08-30","Logistics company \u2014 interested in website and hosting.","148803f0-322b-408e-9ffc-c9ce486172a6",null]'::jsonb),
      ('leads', 'Vertex Architects', '["Vertex Architects","Robert Smith","robert@vertexarch.co.za","+27 31 333 4444","LinkedIn","proposal_sent",80,120000,"2026-08-10","Architecture firm \u2014 branding, website, and printing package.","148803f0-322b-408e-9ffc-c9ce486172a6",null]'::jsonb),
      ('meetings', 'call', '["Bloom Beauty \u2014 Monthly Check-in","call","Bloom Beauty Co.",null,"148803f0-322b-408e-9ffc-c9ce486172a6","Phone","432000.000000","1800.000000","Monthly performance call with Jessica.","scheduled"]'::jsonb),
      ('meetings', 'collection', '["Summit Construction \u2014 Printing Collection","collection","Summit Construction Group",null,"148803f0-322b-408e-9ffc-c9ce486172a6","PURPLELOK Office","86400.000000","1800.000000","Client collecting printed stationery.","scheduled"]'::jsonb),
      ('meetings', 'meeting', '["Aurora Tech \u2014 Design Review","meeting","Aurora Technologies",null,"148803f0-322b-408e-9ffc-c9ce486172a6","Zoom","172800.000000","3600.000000","Review final UI designs with Sarah.","scheduled"]'::jsonb),
      ('messages', 'general|78b7747cb9341862c2d70eed61f32849', '["general","148803f0-322b-408e-9ffc-c9ce486172a6","Welcome to PURPLELOK Command Center! This is the general team channel."]'::jsonb),
      ('messages', 'general|842e2f1d6523100b7d8f1709b5f7d0d0', '["general","148803f0-322b-408e-9ffc-c9ce486172a6","Don''t forget the Aurora design review meeting in 2 days."]'::jsonb),
      ('messages', 'projects|59d3a06e947770f5d7dce2863814c755', '["projects","148803f0-322b-408e-9ffc-c9ce486172a6","Aurora Tech website is 65% complete \u2014 on track for August 15 launch."]'::jsonb),
      ('notifications', 'Invoice overdue', '["148803f0-322b-408e-9ffc-c9ce486172a6","Invoice overdue","INV-2026-0004 for Summit Construction is overdue","warning",false,null]'::jsonb),
      ('notifications', 'New ticket', '["148803f0-322b-408e-9ffc-c9ce486172a6","New ticket","TKT-2026-0002: Email setup assistance needed from Nexus Financial","info",true,null]'::jsonb),
      ('notifications', 'Payment received', '["148803f0-322b-408e-9ffc-c9ce486172a6","Payment received","Aurora Technologies paid R39,675 for INV-2026-0001","success",false,null]'::jsonb),
      ('payments', 'EFT-AURORA-001', '["INV-2026-0001","Aurora Technologies",39675,"EFT","EFT-AURORA-001","2026-07-12T10:00:00"]'::jsonb),
      ('payments', 'EFT-AURORA-002', '["INV-2026-0001","Aurora Technologies",15000,"EFT","EFT-AURORA-002","-7200.000000"]'::jsonb),
      ('payments', 'PAYFAST-BLOOM-001', '["INV-2026-0002","Bloom Beauty Co.",20000,"PayFast","PAYFAST-BLOOM-001","2026-07-15T14:30:00"]'::jsonb),
      ('project_milestones', 'Aurora Tech Website Redesign|Backend & CMS', '["Aurora Tech Website Redesign","Backend & CMS",null,"2026-08-05",false,null]'::jsonb),
      ('project_milestones', 'Aurora Tech Website Redesign|Discovery & Requirements', '["Aurora Tech Website Redesign","Discovery & Requirements",null,"2026-07-05",true,null]'::jsonb),
      ('project_milestones', 'Aurora Tech Website Redesign|Frontend Development', '["Aurora Tech Website Redesign","Frontend Development",null,"2026-07-30",false,null]'::jsonb),
      ('project_milestones', 'Aurora Tech Website Redesign|Testing & Launch', '["Aurora Tech Website Redesign","Testing & Launch",null,"2026-08-14",false,null]'::jsonb),
      ('project_milestones', 'Aurora Tech Website Redesign|UI/UX Design', '["Aurora Tech Website Redesign","UI/UX Design",null,"2026-07-15",true,null]'::jsonb),
      ('project_milestones', 'Bloom Beauty SEO Campaign|Content Optimization', '["Bloom Beauty SEO Campaign","Content Optimization",null,"2026-08-15",false,null]'::jsonb),
      ('project_milestones', 'Bloom Beauty SEO Campaign|Keyword Research', '["Bloom Beauty SEO Campaign","Keyword Research",null,"2026-07-25",false,null]'::jsonb),
      ('project_milestones', 'Bloom Beauty SEO Campaign|SEO Audit', '["Bloom Beauty SEO Campaign","SEO Audit",null,"2026-07-15",true,null]'::jsonb),
      ('project_milestones', 'Summit Construction Stationery|Design Approval', '["Summit Construction Stationery","Design Approval",null,"2026-07-18",true,null]'::jsonb),
      ('project_milestones', 'Summit Construction Stationery|Printing', '["Summit Construction Stationery","Printing",null,"2026-07-25",true,null]'::jsonb),
      ('project_milestones', 'Summit Construction Stationery|Quality Check & Delivery', '["Summit Construction Stationery","Quality Check & Delivery",null,"2026-07-28",false,null]'::jsonb),
      ('projects', 'Aurora Tech Website Redesign', '["Aurora Tech Website Redesign","Aurora Technologies","website","in_progress","Complete website redesign with React frontend, CMS backend, and SEO optimization.","2026-07-01","2026-08-15",69000,65,"on_track",["148803f0-322b-408e-9ffc-c9ce486172a6"],"148803f0-322b-408e-9ffc-c9ce486172a6"]'::jsonb),
      ('projects', 'Bloom Beauty SEO Campaign', '["Bloom Beauty SEO Campaign","Bloom Beauty Co.","website","in_progress","Ongoing SEO optimization and content strategy for Bloom Beauty.","2026-07-10","2026-09-10",40250,40,"at_risk",["148803f0-322b-408e-9ffc-c9ce486172a6"],"148803f0-322b-408e-9ffc-c9ce486172a6"]'::jsonb),
      ('projects', 'Nexus Financial Corporate Identity', '["Nexus Financial Corporate Identity","Nexus Financial Services","branding","completed","Full corporate identity package including logo, brand guidelines, email signatures, and social media kit.","2026-05-01","2026-06-30",32200,100,"completed",["148803f0-322b-408e-9ffc-c9ce486172a6"],"148803f0-322b-408e-9ffc-c9ce486172a6"]'::jsonb),
      ('projects', 'Summit Construction Stationery', '["Summit Construction Stationery","Summit Construction Group","printing","review","Business cards, letterheads, flyers, and compliment slips for Summit Construction.","2026-07-15","2026-07-28",14375,85,"on_track",["148803f0-322b-408e-9ffc-c9ce486172a6"],"148803f0-322b-408e-9ffc-c9ce486172a6"]'::jsonb),
      ('quote_items', 'QUO-2026-0001|Backend Development & CMS', '["QUO-2026-0001","Backend Development & CMS",1,15000,15000]'::jsonb),
      ('quote_items', 'QUO-2026-0001|Frontend Development (React)', '["QUO-2026-0001","Frontend Development (React)",1,25000,25000]'::jsonb),
      ('quote_items', 'QUO-2026-0001|SEO Optimization', '["QUO-2026-0001","SEO Optimization",1,7000,7000]'::jsonb),
      ('quote_items', 'QUO-2026-0001|UI/UX Design (5 pages)', '["QUO-2026-0001","UI/UX Design (5 pages)",1,18000,18000]'::jsonb),
      ('quote_items', 'QUO-2026-0002|Logo Design & Brand Guidelines', '["QUO-2026-0002","Logo Design & Brand Guidelines",1,15000,15000]'::jsonb),
      ('quote_items', 'QUO-2026-0002|Social Media Kit', '["QUO-2026-0002","Social Media Kit",1,8000,8000]'::jsonb),
      ('quote_items', 'QUO-2026-0002|Website Development (5 pages)', '["QUO-2026-0002","Website Development (5 pages)",1,25000,25000]'::jsonb),
      ('quote_items', 'QUO-2026-0003|Business Cards (500x)', '["QUO-2026-0003","Business Cards (500x)",1,2500,2500]'::jsonb),
      ('quote_items', 'QUO-2026-0003|Compliment Slips (500x)', '["QUO-2026-0003","Compliment Slips (500x)",1,2500,2500]'::jsonb),
      ('quote_items', 'QUO-2026-0003|Flyers (2000x A5)', '["QUO-2026-0003","Flyers (2000x A5)",1,4000,4000]'::jsonb),
      ('quote_items', 'QUO-2026-0003|Letterheads (1000x)', '["QUO-2026-0003","Letterheads (1000x)",1,3500,3500]'::jsonb),
      ('quotes', 'QUO-2026-0001', '["QUO-2026-0001","Aurora Technologies","Website Redesign & Development","accepted",65000,5000,9000,69000,15,"50% deposit to commence. Balance on completion. Prices valid for 30 days.","2026-08-30",false,null,"148803f0-322b-408e-9ffc-c9ce486172a6"]'::jsonb),
      ('quotes', 'QUO-2026-0002', '["QUO-2026-0002","Green Leaf Organics","Branding & Website Package","sent",48000,0,7200,55200,15,"50% deposit required. Project timeline: 6-8 weeks.","2026-09-15",false,null,"148803f0-322b-408e-9ffc-c9ce486172a6"]'::jsonb),
      ('quotes', 'QUO-2026-0003', '["QUO-2026-0003","Summit Construction Group","Corporate Stationery Printing","draft",12500,0,1875,14375,15,"Payment on delivery. Prices valid for 14 days.","2026-08-14",false,null,"148803f0-322b-408e-9ffc-c9ce486172a6"]'::jsonb),
      ('tasks', 'Complete Aurora frontend development', '["Complete Aurora frontend development","Finish React components and integrate with API.","Aurora Tech Website Redesign","Aurora Technologies","148803f0-322b-408e-9ffc-c9ce486172a6","148803f0-322b-408e-9ffc-c9ce486172a6","high","in_progress","2026-07-30",false,null]'::jsonb),
      ('tasks', 'Follow up on Summit overdue invoice', '["Follow up on Summit overdue invoice","Contact Thabo about INV-2026-0004 payment.",null,"Summit Construction Group","148803f0-322b-408e-9ffc-c9ce486172a6","148803f0-322b-408e-9ffc-c9ce486172a6","urgent","todo","2026-07-28",false,null]'::jsonb),
      ('tasks', 'Prepare Green Leaf proposal', '["Prepare Green Leaf proposal","Draft quotation for website redesign and branding package.",null,"Green Leaf Organics","148803f0-322b-408e-9ffc-c9ce486172a6","148803f0-322b-408e-9ffc-c9ce486172a6","high","todo","2026-08-02",false,null]'::jsonb),
      ('tasks', 'Review Summit stationery proofs', '["Review Summit stationery proofs","Quality check printed proofs before final run.","Summit Construction Stationery","Summit Construction Group","148803f0-322b-408e-9ffc-c9ce486172a6","148803f0-322b-408e-9ffc-c9ce486172a6","urgent","review","2026-07-28",false,null]'::jsonb),
      ('tasks', 'Send Bloom Beauty SEO report', '["Send Bloom Beauty SEO report","Compile and send monthly SEO performance report.","Bloom Beauty SEO Campaign","Bloom Beauty Co.","148803f0-322b-408e-9ffc-c9ce486172a6","148803f0-322b-408e-9ffc-c9ce486172a6","medium","todo","2026-07-31",false,null]'::jsonb),
      ('ticket_messages', 'TKT-2026-0001|6bfc697b8f5c935aa8b22750a983d146', '["TKT-2026-0001","148803f0-322b-408e-9ffc-c9ce486172a6","Need to check if Cloudflare caching is properly configured.",true]'::jsonb),
      ('ticket_messages', 'TKT-2026-0001|b59797c0adf0c8f88ffa54731cfeed59', '["TKT-2026-0001","148803f0-322b-408e-9ffc-c9ce486172a6","We are investigating the mobile performance issue. Will optimize images and minify CSS/JS.",false]'::jsonb),
      ('ticket_messages', 'TKT-2026-0002|376a7954e6092b6993cea9a7677a5498', '["TKT-2026-0002","148803f0-322b-408e-9ffc-c9ce486172a6","I''ll send you the Outlook setup guide and schedule a call to walk you through it.",false]'::jsonb),
      ('tickets', 'TKT-2026-0001', '["TKT-2026-0001","Website loading slowly on mobile","Aurora Technologies","148803f0-322b-408e-9ffc-c9ce486172a6","148803f0-322b-408e-9ffc-c9ce486172a6","high","in_progress","Aurora Tech reports the website is loading slowly on mobile devices. Need to optimize images and check performance.",null]'::jsonb),
      ('tickets', 'TKT-2026-0002', '["TKT-2026-0002","Email setup assistance needed","Nexus Financial Services","148803f0-322b-408e-9ffc-c9ce486172a6","148803f0-322b-408e-9ffc-c9ce486172a6","medium","open","Nexus Financial needs help configuring Outlook with their new email accounts.",null]'::jsonb)
    ),
    live(table_name, stable_key, material) AS (
      SELECT 'clients', c.company_name,
        jsonb_build_array(c.company_name, c.logo_url, c.contact_person, c.email,
          c.phone, c.whatsapp, c.physical_address, c.postal_address,
          c.company_registration, c.vat_number, c.industry, c.website,
          c.social_media, c.status, c.notes, c.tags, c.favorite,
          c.satisfaction_score, c.created_by::text)
        FROM public.clients c
      UNION ALL
      SELECT 'client_contacts', c.id::text,
        jsonb_build_array(p.company_name, c.name, c.email, c.phone, c.position, c.is_primary)
        FROM public.client_contacts c JOIN public.clients p ON p.id = c.client_id
      UNION ALL
      SELECT 'client_notes', n.id::text,
        jsonb_build_array(c.company_name, n.author_id::text, n.body)
        FROM public.client_notes n JOIN public.clients c ON c.id = n.client_id
      UNION ALL
      SELECT 'leads', l.company_name,
        jsonb_build_array(l.company_name, l.contact_name, l.email, l.phone,
          l.source, l.stage, l.lead_score, l.estimated_value,
          l.expected_closing_date::text, l.notes, l.assigned_to::text, c.company_name)
        FROM public.leads l LEFT JOIN public.clients c ON c.id = l.client_id
      UNION ALL
      SELECT 'quotes', q.quote_number,
        jsonb_build_array(q.quote_number, c.company_name, q.title, q.status,
          q.subtotal, q.discount, q.vat, q.total, q.vat_rate, q.terms,
          q.valid_until::text, q.approved_by_client, q.approved_at::text,
          q.created_by::text)
        FROM public.quotes q JOIN public.clients c ON c.id = q.client_id
      UNION ALL
      SELECT 'quote_items', q.quote_number || '|' || i.description,
        jsonb_build_array(q.quote_number, i.description, i.quantity, i.unit_price, i.total)
        FROM public.quote_items i JOIN public.quotes q ON q.id = i.quote_id
      UNION ALL
      SELECT 'invoices', i.invoice_number,
        jsonb_build_array(i.invoice_number, c.company_name, q.quote_number,
          i.title, i.status, i.subtotal, i.discount, i.vat, i.total,
          i.vat_rate, i.amount_paid, i.balance, i.issue_date::text,
          i.due_date::text, i.recurring, i.recurring_interval, i.notes,
          i.created_by::text)
        FROM public.invoices i
        JOIN public.clients c ON c.id = i.client_id
        LEFT JOIN public.quotes q ON q.id = i.quote_id
      UNION ALL
      SELECT 'invoice_items', i.invoice_number || '|' || x.description,
        jsonb_build_array(i.invoice_number, x.description, x.quantity, x.unit_price, x.total)
        FROM public.invoice_items x JOIN public.invoices i ON i.id = x.invoice_id
      UNION ALL
      SELECT 'payments', p.reference,
        jsonb_build_array(i.invoice_number, c.company_name, p.amount, p.method,
          p.reference, CASE WHEN p.reference = 'EFT-AURORA-002'
            THEN extract(epoch FROM (p.paid_at - p.created_at))::text
            ELSE to_char(p.paid_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') END)
        FROM public.payments p
        JOIN public.invoices i ON i.id = p.invoice_id
        JOIN public.clients c ON c.id = p.client_id
      UNION ALL
      SELECT 'projects', p.name,
        jsonb_build_array(p.name, c.company_name, p.type, p.status, p.description,
          p.start_date::text, p.due_date::text, p.budget, p.progress, p.health,
          p.assigned_to::text[], p.created_by::text)
        FROM public.projects p JOIN public.clients c ON c.id = p.client_id
      UNION ALL
      SELECT 'project_milestones', p.name || '|' || m.title,
        jsonb_build_array(p.name, m.title, m.description, m.due_date::text,
          m.completed, m.completed_at::text)
        FROM public.project_milestones m JOIN public.projects p ON p.id = m.project_id
      UNION ALL
      SELECT 'tasks', t.title,
        jsonb_build_array(t.title, t.description, p.name, c.company_name,
          t.assigned_to::text, t.created_by::text, t.priority, t.status,
          t.deadline::text, t.recurring, t.recurrence_pattern)
        FROM public.tasks t
        LEFT JOIN public.projects p ON p.id = t.project_id
        LEFT JOIN public.clients c ON c.id = t.client_id
      UNION ALL
      SELECT 'task_comments', c.id::text,
        jsonb_build_array(t.title, c.author_id::text, c.body)
        FROM public.task_comments c JOIN public.tasks t ON t.id = c.task_id
      UNION ALL
      SELECT 'meetings', m.type,
        jsonb_build_array(m.title, m.type, c.company_name, p.name,
          m.assigned_to::text, m.location,
          extract(epoch FROM (m.start_at - m.created_at))::text,
          extract(epoch FROM (m.end_at - m.start_at))::text,
          m.notes, m.status)
        FROM public.meetings m
        LEFT JOIN public.clients c ON c.id = m.client_id
        LEFT JOIN public.projects p ON p.id = m.project_id
      UNION ALL
      SELECT 'documents', d.id::text,
        jsonb_build_array(d.name, d.type, parent.name, c.company_name, d.file_url,
          d.file_size, d.mime_type, d.version, d.uploaded_by::text)
        FROM public.documents d
        LEFT JOIN public.documents parent ON parent.id = d.folder_id
        LEFT JOIN public.clients c ON c.id = d.client_id
      UNION ALL
      SELECT 'tickets', t.ticket_number,
        jsonb_build_array(t.ticket_number, t.subject, c.company_name,
          t.created_by::text, t.assigned_to::text, t.priority, t.status,
          t.description, t.rating)
        FROM public.tickets t LEFT JOIN public.clients c ON c.id = t.client_id
      UNION ALL
      SELECT 'ticket_messages', t.ticket_number || '|' || md5(m.body),
        jsonb_build_array(t.ticket_number, m.author_id::text, m.body, m.internal)
        FROM public.ticket_messages m JOIN public.tickets t ON t.id = m.ticket_id
      UNION ALL
      SELECT 'activities', a.type,
        jsonb_build_array(a.user_id::text, a.type, a.entity, a.entity_id::text,
          a.description, a.metadata,
          extract(epoch FROM (a.created_at - v_seeded_at))::text)
        FROM public.activities a
      UNION ALL
      SELECT 'notifications', n.title,
        jsonb_build_array(n.user_id::text, n.title, n.body, n.type, n.read, n.link)
        FROM public.notifications n
      UNION ALL
      SELECT 'channels', c.name,
        jsonb_build_array(c.name, c.description, c.created_by::text)
        FROM public.channels c
      UNION ALL
      SELECT 'messages', c.name || '|' || md5(m.body),
        jsonb_build_array(c.name, m.author_id::text, m.body)
        FROM public.messages m JOIN public.channels c ON c.id = m.channel_id
    ),
    differences AS (
      (SELECT * FROM expected EXCEPT ALL SELECT * FROM live)
      UNION ALL
      (SELECT * FROM live EXCEPT ALL SELECT * FROM expected)
    )
    SELECT 1 FROM differences
  ) THEN
    RAISE EXCEPTION 'Batch 3B seed manifest mismatch: expected/live material rows differ';
  END IF;

  -- Every default timestamp in the seed transaction shares one transaction
  -- timestamp. Dynamic meeting/payment/activity values are normalized above.
  IF EXISTS (
    SELECT 1 FROM (
      SELECT created_at FROM public.clients
      UNION ALL SELECT created_at FROM public.leads
      UNION ALL SELECT created_at FROM public.quotes
      UNION ALL SELECT created_at FROM public.quote_items
      UNION ALL SELECT created_at FROM public.invoices
      UNION ALL SELECT created_at FROM public.invoice_items
      UNION ALL SELECT created_at FROM public.payments
      UNION ALL SELECT created_at FROM public.projects
      UNION ALL SELECT created_at FROM public.project_milestones
      UNION ALL SELECT created_at FROM public.tasks
      UNION ALL SELECT created_at FROM public.meetings
      UNION ALL SELECT created_at FROM public.tickets
      UNION ALL SELECT created_at FROM public.ticket_messages
      UNION ALL SELECT created_at FROM public.notifications
      UNION ALL SELECT created_at FROM public.channels
      UNION ALL SELECT created_at FROM public.messages
    ) seeded WHERE created_at IS DISTINCT FROM v_seeded_at
  ) THEN
    RAISE EXCEPTION 'Batch 3B seed manifest mismatch: seed creation timestamps changed';
  END IF;

  IF EXISTS (
    SELECT 1 FROM (
      SELECT created_at, updated_at FROM public.clients
      UNION ALL SELECT created_at, updated_at FROM public.leads
      UNION ALL SELECT created_at, updated_at FROM public.quotes
      UNION ALL SELECT created_at, updated_at FROM public.invoices
      UNION ALL SELECT created_at, updated_at FROM public.projects
      UNION ALL SELECT created_at, updated_at FROM public.tasks
      UNION ALL SELECT created_at, updated_at FROM public.tickets
    ) tracked
    WHERE created_at IS DISTINCT FROM v_seeded_at
       OR updated_at IS DISTINCT FROM v_seeded_at
  ) THEN
    RAISE EXCEPTION 'Batch 3B seed manifest mismatch: a tracked seed row was modified';
  END IF;
END
$manifest$;

REVOKE ALL ON FUNCTION public.batch_3b_assert_seed_manifest()
  FROM PUBLIC, anon, authenticated, service_role;

SELECT public.batch_3b_assert_seed_manifest();

-- ============ NULLABLE TENANT OWNERSHIP ============

DO $columns$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'clients', 'client_contacts', 'client_notes', 'leads', 'quotes',
    'quote_items', 'invoices', 'invoice_items', 'payments', 'projects',
    'project_milestones', 'tasks', 'task_comments', 'meetings', 'documents',
    'tickets', 'ticket_messages', 'activities', 'notifications', 'channels',
    'messages'
  ]
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%1$I ADD COLUMN organization_id uuid NULL, ADD CONSTRAINT %2$I FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE RESTRICT',
      v_table,
      v_table || '_organization_id_fkey'
    );
    EXECUTE format(
      'CREATE INDEX %1$I ON public.%2$I (organization_id)',
      'idx_' || v_table || '_organization_id',
      v_table
    );
  END LOOP;
END
$columns$;

-- ============ PARENT-DERIVED DEMO BACKFILL ============

-- Ownership backfill is metadata-only. Prevent the existing updated_at
-- triggers from rewriting material timestamps, then restore them immediately.
ALTER TABLE public.clients DISABLE TRIGGER touch_clients;
ALTER TABLE public.leads DISABLE TRIGGER touch_leads;
ALTER TABLE public.quotes DISABLE TRIGGER touch_quotes;
ALTER TABLE public.invoices DISABLE TRIGGER touch_invoices;
ALTER TABLE public.projects DISABLE TRIGGER touch_projects;
ALTER TABLE public.tasks DISABLE TRIGGER touch_tasks;
ALTER TABLE public.tickets DISABLE TRIGGER touch_tickets;

DO $backfill$
DECLARE
  v_demo_id uuid;
BEGIN
  SELECT id INTO STRICT v_demo_id
    FROM public.organizations
   WHERE slug = 'purplelok-demo'
     AND name = 'PURPLELOK Demo'
     AND status = 'active';

  -- Roots and standalone records.
  UPDATE public.clients SET organization_id = v_demo_id;
  UPDATE public.leads SET organization_id = v_demo_id WHERE client_id IS NULL;
  UPDATE public.activities SET organization_id = v_demo_id;
  UPDATE public.notifications SET organization_id = v_demo_id;
  UPDATE public.channels SET organization_id = v_demo_id;

  -- Direct client ownership.
  UPDATE public.client_contacts child
     SET organization_id = parent.organization_id
    FROM public.clients parent
   WHERE parent.id = child.client_id;
  UPDATE public.client_notes child
     SET organization_id = parent.organization_id
    FROM public.clients parent
   WHERE parent.id = child.client_id;
  UPDATE public.leads child
     SET organization_id = parent.organization_id
    FROM public.clients parent
   WHERE parent.id = child.client_id;
  UPDATE public.quotes child
     SET organization_id = parent.organization_id
    FROM public.clients parent
   WHERE parent.id = child.client_id;
  UPDATE public.projects child
     SET organization_id = parent.organization_id
    FROM public.clients parent
   WHERE parent.id = child.client_id;
  UPDATE public.tickets child
     SET organization_id = parent.organization_id
    FROM public.clients parent
   WHERE parent.id = child.client_id;

  -- Invoices may reference both client and quote. Every resolved parent must agree.
  IF EXISTS (
    SELECT 1
      FROM public.invoices child
      JOIN public.clients client_parent ON client_parent.id = child.client_id
      JOIN public.quotes quote_parent ON quote_parent.id = child.quote_id
     WHERE client_parent.organization_id IS DISTINCT FROM quote_parent.organization_id
  ) THEN
    RAISE EXCEPTION 'Batch 3B backfill: invoice client and quote tenants disagree';
  END IF;
  UPDATE public.invoices child
     SET organization_id = client_parent.organization_id
    FROM public.clients client_parent
   WHERE client_parent.id = child.client_id;

  -- Tasks and meetings can resolve through client, project, or both.
  IF EXISTS (
    SELECT 1
      FROM public.tasks child
      JOIN public.projects project_parent ON project_parent.id = child.project_id
      JOIN public.clients client_parent ON client_parent.id = child.client_id
     WHERE project_parent.organization_id IS DISTINCT FROM client_parent.organization_id
  ) THEN
    RAISE EXCEPTION 'Batch 3B backfill: task project and client tenants disagree';
  END IF;
  UPDATE public.tasks child
     SET organization_id = COALESCE(
       (SELECT p.organization_id FROM public.projects p WHERE p.id = child.project_id),
       (SELECT c.organization_id FROM public.clients c WHERE c.id = child.client_id)
     );

  IF EXISTS (
    SELECT 1
      FROM public.meetings child
      JOIN public.projects project_parent ON project_parent.id = child.project_id
      JOIN public.clients client_parent ON client_parent.id = child.client_id
     WHERE project_parent.organization_id IS DISTINCT FROM client_parent.organization_id
  ) THEN
    RAISE EXCEPTION 'Batch 3B backfill: meeting project and client tenants disagree';
  END IF;
  UPDATE public.meetings child
     SET organization_id = COALESCE(
       (SELECT p.organization_id FROM public.projects p WHERE p.id = child.project_id),
       (SELECT c.organization_id FROM public.clients c WHERE c.id = child.client_id)
     );

  -- Documents are empty in the approved seed manifest. This recursive form is
  -- retained for fail-closed compatibility if the manifest is intentionally
  -- revised before deployment.
  UPDATE public.documents child
     SET organization_id = parent.organization_id
    FROM public.clients parent
   WHERE parent.id = child.client_id
     AND child.folder_id IS NULL;
  LOOP
    UPDATE public.documents child
       SET organization_id = COALESCE(
         (SELECT c.organization_id FROM public.clients c WHERE c.id = child.client_id),
         (SELECT f.organization_id FROM public.documents f WHERE f.id = child.folder_id)
       )
     WHERE child.folder_id IS NOT NULL
       AND child.organization_id IS NULL
       AND (SELECT f.organization_id FROM public.documents f WHERE f.id = child.folder_id) IS NOT NULL
       AND (
         child.client_id IS NULL
         OR (SELECT c.organization_id FROM public.clients c WHERE c.id = child.client_id)
            = (SELECT f.organization_id FROM public.documents f WHERE f.id = child.folder_id)
       );
    EXIT WHEN NOT FOUND;
  END LOOP;

  -- Canonical nested parents.
  UPDATE public.quote_items child
     SET organization_id = parent.organization_id
    FROM public.quotes parent
   WHERE parent.id = child.quote_id;
  UPDATE public.invoice_items child
     SET organization_id = parent.organization_id
    FROM public.invoices parent
   WHERE parent.id = child.invoice_id;
  UPDATE public.project_milestones child
     SET organization_id = parent.organization_id
    FROM public.projects parent
   WHERE parent.id = child.project_id;
  UPDATE public.task_comments child
     SET organization_id = parent.organization_id
    FROM public.tasks parent
   WHERE parent.id = child.task_id;
  UPDATE public.ticket_messages child
     SET organization_id = parent.organization_id
    FROM public.tickets parent
   WHERE parent.id = child.ticket_id;
  UPDATE public.messages child
     SET organization_id = parent.organization_id
    FROM public.channels parent
   WHERE parent.id = child.channel_id;

  -- Payments resolve through both invoice and client and must agree.
  IF EXISTS (
    SELECT 1
      FROM public.payments child
      JOIN public.invoices invoice_parent ON invoice_parent.id = child.invoice_id
      JOIN public.clients client_parent ON client_parent.id = child.client_id
     WHERE invoice_parent.organization_id IS DISTINCT FROM client_parent.organization_id
  ) THEN
    RAISE EXCEPTION 'Batch 3B backfill: payment invoice and client tenants disagree';
  END IF;
  UPDATE public.payments child
     SET organization_id = invoice_parent.organization_id
    FROM public.invoices invoice_parent
   WHERE invoice_parent.id = child.invoice_id;
END
$backfill$;

ALTER TABLE public.clients ENABLE TRIGGER touch_clients;
ALTER TABLE public.leads ENABLE TRIGGER touch_leads;
ALTER TABLE public.quotes ENABLE TRIGGER touch_quotes;
ALTER TABLE public.invoices ENABLE TRIGGER touch_invoices;
ALTER TABLE public.projects ENABLE TRIGGER touch_projects;
ALTER TABLE public.tasks ENABLE TRIGGER touch_tasks;
ALTER TABLE public.tickets ENABLE TRIGGER touch_tickets;

-- ============ COMPOSITE TENANT KEYS / FOREIGN KEYS ============

ALTER TABLE public.clients
  ADD CONSTRAINT clients_id_organization_id_key UNIQUE (id, organization_id);
ALTER TABLE public.quotes
  ADD CONSTRAINT quotes_id_organization_id_key UNIQUE (id, organization_id);
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_id_organization_id_key UNIQUE (id, organization_id);
ALTER TABLE public.projects
  ADD CONSTRAINT projects_id_organization_id_key UNIQUE (id, organization_id);
ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_id_organization_id_key UNIQUE (id, organization_id);
ALTER TABLE public.documents
  ADD CONSTRAINT documents_id_organization_id_key UNIQUE (id, organization_id);
ALTER TABLE public.tickets
  ADD CONSTRAINT tickets_id_organization_id_key UNIQUE (id, organization_id);
ALTER TABLE public.channels
  ADD CONSTRAINT channels_id_organization_id_key UNIQUE (id, organization_id);

ALTER TABLE public.client_contacts
  ADD CONSTRAINT client_contacts_client_organization_fkey
  FOREIGN KEY (client_id, organization_id)
  REFERENCES public.clients(id, organization_id) MATCH SIMPLE ON DELETE CASCADE;
ALTER TABLE public.client_notes
  ADD CONSTRAINT client_notes_client_organization_fkey
  FOREIGN KEY (client_id, organization_id)
  REFERENCES public.clients(id, organization_id) MATCH SIMPLE ON DELETE CASCADE;
ALTER TABLE public.leads
  ADD CONSTRAINT leads_client_organization_fkey
  FOREIGN KEY (client_id, organization_id)
  REFERENCES public.clients(id, organization_id) MATCH SIMPLE;
ALTER TABLE public.quotes
  ADD CONSTRAINT quotes_client_organization_fkey
  FOREIGN KEY (client_id, organization_id)
  REFERENCES public.clients(id, organization_id) MATCH SIMPLE ON DELETE CASCADE;
ALTER TABLE public.quote_items
  ADD CONSTRAINT quote_items_quote_organization_fkey
  FOREIGN KEY (quote_id, organization_id)
  REFERENCES public.quotes(id, organization_id) MATCH SIMPLE ON DELETE CASCADE;
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_client_organization_fkey
  FOREIGN KEY (client_id, organization_id)
  REFERENCES public.clients(id, organization_id) MATCH SIMPLE ON DELETE CASCADE,
  ADD CONSTRAINT invoices_quote_organization_fkey
  FOREIGN KEY (quote_id, organization_id)
  REFERENCES public.quotes(id, organization_id) MATCH SIMPLE
  ON DELETE SET NULL (quote_id);
ALTER TABLE public.invoice_items
  ADD CONSTRAINT invoice_items_invoice_organization_fkey
  FOREIGN KEY (invoice_id, organization_id)
  REFERENCES public.invoices(id, organization_id) MATCH SIMPLE ON DELETE CASCADE;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_invoice_organization_fkey
  FOREIGN KEY (invoice_id, organization_id)
  REFERENCES public.invoices(id, organization_id) MATCH SIMPLE ON DELETE CASCADE,
  ADD CONSTRAINT payments_client_organization_fkey
  FOREIGN KEY (client_id, organization_id)
  REFERENCES public.clients(id, organization_id) MATCH SIMPLE ON DELETE CASCADE;
ALTER TABLE public.projects
  ADD CONSTRAINT projects_client_organization_fkey
  FOREIGN KEY (client_id, organization_id)
  REFERENCES public.clients(id, organization_id) MATCH SIMPLE ON DELETE CASCADE;
ALTER TABLE public.project_milestones
  ADD CONSTRAINT project_milestones_project_organization_fkey
  FOREIGN KEY (project_id, organization_id)
  REFERENCES public.projects(id, organization_id) MATCH SIMPLE ON DELETE CASCADE;
ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_project_organization_fkey
  FOREIGN KEY (project_id, organization_id)
  REFERENCES public.projects(id, organization_id) MATCH SIMPLE ON DELETE CASCADE,
  ADD CONSTRAINT tasks_client_organization_fkey
  FOREIGN KEY (client_id, organization_id)
  REFERENCES public.clients(id, organization_id) MATCH SIMPLE ON DELETE CASCADE;
ALTER TABLE public.task_comments
  ADD CONSTRAINT task_comments_task_organization_fkey
  FOREIGN KEY (task_id, organization_id)
  REFERENCES public.tasks(id, organization_id) MATCH SIMPLE ON DELETE CASCADE;
ALTER TABLE public.meetings
  ADD CONSTRAINT meetings_project_organization_fkey
  FOREIGN KEY (project_id, organization_id)
  REFERENCES public.projects(id, organization_id) MATCH SIMPLE ON DELETE CASCADE,
  ADD CONSTRAINT meetings_client_organization_fkey
  FOREIGN KEY (client_id, organization_id)
  REFERENCES public.clients(id, organization_id) MATCH SIMPLE ON DELETE CASCADE;
ALTER TABLE public.documents
  ADD CONSTRAINT documents_folder_organization_fkey
  FOREIGN KEY (folder_id, organization_id)
  REFERENCES public.documents(id, organization_id) MATCH SIMPLE ON DELETE CASCADE,
  ADD CONSTRAINT documents_client_organization_fkey
  FOREIGN KEY (client_id, organization_id)
  REFERENCES public.clients(id, organization_id) MATCH SIMPLE ON DELETE CASCADE;
ALTER TABLE public.tickets
  ADD CONSTRAINT tickets_client_organization_fkey
  FOREIGN KEY (client_id, organization_id)
  REFERENCES public.clients(id, organization_id) MATCH SIMPLE ON DELETE CASCADE;
ALTER TABLE public.ticket_messages
  ADD CONSTRAINT ticket_messages_ticket_organization_fkey
  FOREIGN KEY (ticket_id, organization_id)
  REFERENCES public.tickets(id, organization_id) MATCH SIMPLE ON DELETE CASCADE;
ALTER TABLE public.messages
  ADD CONSTRAINT messages_channel_organization_fkey
  FOREIGN KEY (channel_id, organization_id)
  REFERENCES public.channels(id, organization_id) MATCH SIMPLE ON DELETE CASCADE;

-- Child-side composite indexes support parent updates/deletes and tenant joins.
CREATE INDEX idx_client_contacts_client_organization_id
  ON public.client_contacts(client_id, organization_id);
CREATE INDEX idx_client_notes_client_organization_id
  ON public.client_notes(client_id, organization_id);
CREATE INDEX idx_leads_client_organization_id
  ON public.leads(client_id, organization_id);
CREATE INDEX idx_quotes_client_organization_id
  ON public.quotes(client_id, organization_id);
CREATE INDEX idx_quote_items_quote_organization_id
  ON public.quote_items(quote_id, organization_id);
CREATE INDEX idx_invoices_client_organization_id
  ON public.invoices(client_id, organization_id);
CREATE INDEX idx_invoices_quote_organization_id
  ON public.invoices(quote_id, organization_id);
CREATE INDEX idx_invoice_items_invoice_organization_id
  ON public.invoice_items(invoice_id, organization_id);
CREATE INDEX idx_payments_invoice_organization_id
  ON public.payments(invoice_id, organization_id);
CREATE INDEX idx_payments_client_organization_id
  ON public.payments(client_id, organization_id);
CREATE INDEX idx_projects_client_organization_id
  ON public.projects(client_id, organization_id);
CREATE INDEX idx_project_milestones_project_organization_id
  ON public.project_milestones(project_id, organization_id);
CREATE INDEX idx_tasks_project_organization_id
  ON public.tasks(project_id, organization_id);
CREATE INDEX idx_tasks_client_organization_id
  ON public.tasks(client_id, organization_id);
CREATE INDEX idx_task_comments_task_organization_id
  ON public.task_comments(task_id, organization_id);
CREATE INDEX idx_meetings_project_organization_id
  ON public.meetings(project_id, organization_id);
CREATE INDEX idx_meetings_client_organization_id
  ON public.meetings(client_id, organization_id);
CREATE INDEX idx_documents_folder_organization_id
  ON public.documents(folder_id, organization_id);
CREATE INDEX idx_documents_client_organization_id
  ON public.documents(client_id, organization_id);
CREATE INDEX idx_tickets_client_organization_id
  ON public.tickets(client_id, organization_id);
CREATE INDEX idx_ticket_messages_ticket_organization_id
  ON public.ticket_messages(ticket_id, organization_id);
CREATE INDEX idx_messages_channel_organization_id
  ON public.messages(channel_id, organization_id);

-- ============ POSTCONDITIONS ============

DO $postconditions$
DECLARE
  v_table text;
  v_demo_id uuid;
  v_real_id uuid;
  v_total integer := 0;
  v_demo integer := 0;
  v_real integer := 0;
  v_null integer := 0;
  v_value integer;
  v_bootstrap uuid := '148803f0-322b-408e-9ffc-c9ce486172a6';
  v_owner uuid;
BEGIN
  SELECT id INTO STRICT v_demo_id FROM public.organizations WHERE slug = 'purplelok-demo';
  SELECT id INTO STRICT v_real_id FROM public.organizations WHERE slug = 'purplelok';
  SELECT id INTO STRICT v_owner FROM public.profiles WHERE email = 'siyamyataza11@gmail.com';

  FOREACH v_table IN ARRAY ARRAY[
    'clients', 'client_contacts', 'client_notes', 'leads', 'quotes',
    'quote_items', 'invoices', 'invoice_items', 'payments', 'projects',
    'project_milestones', 'tasks', 'task_comments', 'meetings', 'documents',
    'tickets', 'ticket_messages', 'activities', 'notifications', 'channels',
    'messages'
  ]
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', v_table) INTO v_value;
    v_total := v_total + v_value;
    EXECUTE format('SELECT count(*) FROM public.%I WHERE organization_id = $1', v_table)
      INTO v_value USING v_demo_id;
    v_demo := v_demo + v_value;
    EXECUTE format('SELECT count(*) FROM public.%I WHERE organization_id = $1', v_table)
      INTO v_value USING v_real_id;
    v_real := v_real + v_value;
    EXECUTE format('SELECT count(*) FROM public.%I WHERE organization_id IS NULL', v_table)
      INTO v_value;
    v_null := v_null + v_value;
  END LOOP;

  IF v_total <> 88 OR v_demo <> 88 OR v_real <> 0 OR v_null <> 0 THEN
    RAISE EXCEPTION 'Batch 3B postcondition: ownership totals invalid (total %, demo %, real %, null %)',
      v_total, v_demo, v_real, v_null;
  END IF;

  SELECT (
    (SELECT count(*) FROM public.leads WHERE assigned_to = v_bootstrap) +
    (SELECT count(*) FROM public.quotes WHERE created_by = v_bootstrap) +
    (SELECT count(*) FROM public.invoices WHERE created_by = v_bootstrap) +
    (SELECT count(*) FROM public.projects WHERE created_by = v_bootstrap) +
    (SELECT count(*) FROM public.projects WHERE assigned_to = ARRAY[v_bootstrap]) +
    (SELECT count(*) FROM public.tasks WHERE created_by = v_bootstrap) +
    (SELECT count(*) FROM public.tasks WHERE assigned_to = v_bootstrap) +
    (SELECT count(*) FROM public.meetings WHERE assigned_to = v_bootstrap) +
    (SELECT count(*) FROM public.tickets WHERE created_by = v_bootstrap) +
    (SELECT count(*) FROM public.tickets WHERE assigned_to = v_bootstrap) +
    (SELECT count(*) FROM public.ticket_messages WHERE author_id = v_bootstrap) +
    (SELECT count(*) FROM public.activities WHERE user_id = v_bootstrap) +
    (SELECT count(*) FROM public.notifications WHERE user_id = v_bootstrap) +
    (SELECT count(*) FROM public.channels WHERE created_by = v_bootstrap) +
    (SELECT count(*) FROM public.messages WHERE author_id = v_bootstrap)
  )::integer INTO v_value;
  IF v_value <> 54 THEN
    RAISE EXCEPTION 'Batch 3B postcondition: expected 54 bootstrap attribution references, found %', v_value;
  END IF;

  IF EXISTS (SELECT 1 FROM public.clients WHERE created_by = v_owner)
     OR EXISTS (SELECT 1 FROM public.client_notes WHERE author_id = v_owner)
     OR EXISTS (SELECT 1 FROM public.leads WHERE assigned_to = v_owner)
     OR EXISTS (SELECT 1 FROM public.quotes WHERE created_by = v_owner)
     OR EXISTS (SELECT 1 FROM public.invoices WHERE created_by = v_owner)
     OR EXISTS (SELECT 1 FROM public.projects WHERE created_by = v_owner OR v_owner = ANY(assigned_to))
     OR EXISTS (SELECT 1 FROM public.tasks WHERE created_by = v_owner OR assigned_to = v_owner)
     OR EXISTS (SELECT 1 FROM public.task_comments WHERE author_id = v_owner)
     OR EXISTS (SELECT 1 FROM public.meetings WHERE assigned_to = v_owner)
     OR EXISTS (SELECT 1 FROM public.documents WHERE uploaded_by = v_owner)
     OR EXISTS (SELECT 1 FROM public.tickets WHERE created_by = v_owner OR assigned_to = v_owner)
     OR EXISTS (SELECT 1 FROM public.ticket_messages WHERE author_id = v_owner)
     OR EXISTS (SELECT 1 FROM public.activities WHERE user_id = v_owner)
     OR EXISTS (SELECT 1 FROM public.notifications WHERE user_id = v_owner)
     OR EXISTS (SELECT 1 FROM public.channels WHERE created_by = v_owner)
     OR EXISTS (SELECT 1 FROM public.messages WHERE author_id = v_owner) THEN
    RAISE EXCEPTION 'Batch 3B postcondition: a legacy attribution points to the real owner';
  END IF;

  IF EXISTS (
    (SELECT id, role FROM public.profiles EXCEPT ALL SELECT id, role FROM batch_3b_profile_snapshot)
    UNION ALL
    (SELECT id, role FROM batch_3b_profile_snapshot EXCEPT ALL SELECT id, role FROM public.profiles)
  ) THEN
    RAISE EXCEPTION 'Batch 3B postcondition: profiles.role changed';
  END IF;
END
$postconditions$;

CREATE TEMP TABLE batch_3b_domain_post_snapshot (
  table_name text NOT NULL,
  row_id uuid NOT NULL,
  row_data jsonb NOT NULL,
  PRIMARY KEY (table_name, row_id)
) ON COMMIT DROP;

DO $post_snapshot$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'clients', 'client_contacts', 'client_notes', 'leads', 'quotes',
    'quote_items', 'invoices', 'invoice_items', 'payments', 'projects',
    'project_milestones', 'tasks', 'task_comments', 'meetings', 'documents',
    'tickets', 'ticket_messages', 'activities', 'notifications', 'channels',
    'messages'
  ]
  LOOP
    EXECUTE format(
      'INSERT INTO batch_3b_domain_post_snapshot SELECT %L, id, to_jsonb(t) - ''organization_id'' FROM public.%I t',
      v_table,
      v_table
    );
  END LOOP;

  IF EXISTS (
    (SELECT * FROM batch_3b_domain_snapshot EXCEPT ALL SELECT * FROM batch_3b_domain_post_snapshot)
    UNION ALL
    (SELECT * FROM batch_3b_domain_post_snapshot EXCEPT ALL SELECT * FROM batch_3b_domain_snapshot)
  ) THEN
    RAISE EXCEPTION 'Batch 3B postcondition: a pre-existing domain value other than organization_id changed';
  END IF;

  IF EXISTS (
    (SELECT * FROM batch_3b_policy_snapshot
     EXCEPT ALL
     SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
       FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = ANY (ARRAY[
          'profiles', 'clients', 'client_contacts', 'client_notes', 'leads',
          'quotes', 'quote_items', 'invoices', 'invoice_items', 'payments',
          'projects', 'project_milestones', 'tasks', 'task_comments', 'meetings',
          'documents', 'tickets', 'ticket_messages', 'activities', 'notifications',
          'channels', 'messages'
        ]))
    UNION ALL
    (SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
       FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = ANY (ARRAY[
          'profiles', 'clients', 'client_contacts', 'client_notes', 'leads',
          'quotes', 'quote_items', 'invoices', 'invoice_items', 'payments',
          'projects', 'project_milestones', 'tasks', 'task_comments', 'meetings',
          'documents', 'tickets', 'ticket_messages', 'activities', 'notifications',
          'channels', 'messages'
        ])
     EXCEPT ALL
     SELECT * FROM batch_3b_policy_snapshot)
  ) THEN
    RAISE EXCEPTION 'Batch 3B postcondition: an existing CRM RLS policy changed';
  END IF;

  IF EXISTS (
    (SELECT * FROM batch_3b_rls_snapshot
     EXCEPT ALL
     SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = ANY (ARRAY[
          'profiles', 'clients', 'client_contacts', 'client_notes', 'leads',
          'quotes', 'quote_items', 'invoices', 'invoice_items', 'payments',
          'projects', 'project_milestones', 'tasks', 'task_comments', 'meetings',
          'documents', 'tickets', 'ticket_messages', 'activities', 'notifications',
          'channels', 'messages'
        ]))
    UNION ALL
    (SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = ANY (ARRAY[
          'profiles', 'clients', 'client_contacts', 'client_notes', 'leads',
          'quotes', 'quote_items', 'invoices', 'invoice_items', 'payments',
          'projects', 'project_milestones', 'tasks', 'task_comments', 'meetings',
          'documents', 'tickets', 'ticket_messages', 'activities', 'notifications',
          'channels', 'messages'
        ])
     EXCEPT ALL
     SELECT * FROM batch_3b_rls_snapshot)
  ) THEN
    RAISE EXCEPTION 'Batch 3B postcondition: an existing CRM RLS status changed';
  END IF;

  IF EXISTS (
    (SELECT * FROM batch_3b_trigger_snapshot
     EXCEPT ALL
     SELECT t.oid,
            n.nspname::text,
            c.relname::text,
            t.tgname::text,
            t.tgisinternal,
            t.tgenabled,
            t.tgtype,
            t.tgfoid,
            pn.nspname::text,
            p.proname::text,
            pg_get_function_identity_arguments(p.oid),
            t.tgnargs,
            encode(t.tgargs, 'hex'),
            pg_get_triggerdef(t.oid, false)
       FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_proc p ON p.oid = t.tgfoid
       JOIN pg_namespace pn ON pn.oid = p.pronamespace
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
            ]))
    UNION ALL
    (SELECT t.oid,
            n.nspname::text,
            c.relname::text,
            t.tgname::text,
            t.tgisinternal,
            t.tgenabled,
            t.tgtype,
            t.tgfoid,
            pn.nspname::text,
            p.proname::text,
            pg_get_function_identity_arguments(p.oid),
            t.tgnargs,
            encode(t.tgargs, 'hex'),
            pg_get_triggerdef(t.oid, false)
       FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_proc p ON p.oid = t.tgfoid
       JOIN pg_namespace pn ON pn.oid = p.pronamespace
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
            ])
     EXCEPT ALL
     SELECT * FROM batch_3b_trigger_snapshot)
  ) THEN
    RAISE EXCEPTION 'Batch 3B postcondition: updated_at trigger catalogue was not restored exactly';
  END IF;
END
$post_snapshot$;

COMMENT ON FUNCTION public.batch_3b_assert_seed_manifest() IS
  'Postgres-only Batch 3B guard that validates the normalized repository demo seed manifest.';

COMMIT;
