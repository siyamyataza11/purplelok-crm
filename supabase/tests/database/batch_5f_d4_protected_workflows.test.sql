BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(134);

-- Catalogue and ACL contract (1-20).
SELECT set_eq(
  $$SELECT p.oid::regprocedure::text FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE (n.nspname,p.proname) IN (VALUES
      ('public','record_payment'),('public','send_quote'),('public','approve_quote'),
      ('public','convert_quote_to_invoice'),('public','convert_quote_to_project'),('public','change_lead_stage'),
      ('private','purplelok_insert_activity'),('private','purplelok_protect_payment_insert'))$$,
  $$VALUES ('record_payment(uuid,numeric,text,text)'),('send_quote(uuid)'),('approve_quote(uuid)'),
    ('convert_quote_to_invoice(uuid,text,date,date)'),('convert_quote_to_project(uuid)'),('change_lead_stage(uuid,text)'),
    ('private.purplelok_insert_activity(uuid,text,text,uuid,text,jsonb)'),
    ('private.purplelok_protect_payment_insert()')$$,
  'exact D4 function signatures exist');
SELECT is((SELECT count(*)::integer FROM pg_catalog.pg_proc WHERE oid IN (
  'public.record_payment(uuid,numeric,text,text)'::regprocedure,'public.send_quote(uuid)'::regprocedure,
  'public.approve_quote(uuid)'::regprocedure,'public.convert_quote_to_invoice(uuid,text,date,date)'::regprocedure,
  'public.convert_quote_to_project(uuid)'::regprocedure,'public.change_lead_stage(uuid,text)'::regprocedure) AND prosecdef),6,'public RPCs are SECURITY DEFINER');
SELECT ok(NOT (SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid='private.purplelok_insert_activity(uuid,text,text,uuid,text,jsonb)'::regprocedure),'activity helper is SECURITY INVOKER');
SELECT is((SELECT count(*)::integer FROM pg_catalog.pg_proc WHERE oid IN (
  'public.record_payment(uuid,numeric,text,text)'::regprocedure,'public.send_quote(uuid)'::regprocedure,
  'public.approve_quote(uuid)'::regprocedure,'public.convert_quote_to_invoice(uuid,text,date,date)'::regprocedure,
  'public.convert_quote_to_project(uuid)'::regprocedure,'public.change_lead_stage(uuid,text)'::regprocedure,
  'private.purplelok_insert_activity(uuid,text,text,uuid,text,jsonb)'::regprocedure,
  'private.purplelok_protect_payment_insert()'::regprocedure)
  AND pg_catalog.pg_get_userbyid(proowner)='postgres'),8,'all D4 functions are postgres-owned');
SELECT is((SELECT count(*)::integer FROM pg_catalog.pg_proc WHERE oid IN (
  'public.record_payment(uuid,numeric,text,text)'::regprocedure,'public.send_quote(uuid)'::regprocedure,
  'public.approve_quote(uuid)'::regprocedure,'public.convert_quote_to_invoice(uuid,text,date,date)'::regprocedure,
  'public.convert_quote_to_project(uuid)'::regprocedure,'public.change_lead_stage(uuid,text)'::regprocedure,
  'private.purplelok_insert_activity(uuid,text,text,uuid,text,jsonb)'::regprocedure,
  'private.purplelok_protect_payment_insert()'::regprocedure)
  AND proconfig @> ARRAY['search_path=""','row_security=off']::text[]),8,'all D4 functions have hardened settings');
SELECT is((SELECT count(*)::integer FROM pg_catalog.pg_proc WHERE oid IN (
  'public.record_payment(uuid,numeric,text,text)'::regprocedure,'public.send_quote(uuid)'::regprocedure,
  'public.approve_quote(uuid)'::regprocedure,'public.convert_quote_to_invoice(uuid,text,date,date)'::regprocedure,
  'public.convert_quote_to_project(uuid)'::regprocedure,'public.change_lead_stage(uuid,text)'::regprocedure)
  AND pg_catalog.has_function_privilege('authenticated',oid,'EXECUTE')),6,'authenticated can execute exactly the public RPCs');
SELECT ok(NOT pg_catalog.has_function_privilege('authenticated','private.purplelok_insert_activity(uuid,text,text,uuid,text,jsonb)','EXECUTE'),'authenticated cannot execute activity helper');
SELECT ok(NOT (SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid='private.purplelok_protect_payment_insert()'::regprocedure),'payment guard is SECURITY INVOKER and observes the real SQL caller');
SELECT is((SELECT count(*)::integer FROM pg_catalog.pg_proc WHERE oid IN (
  'public.record_payment(uuid,numeric,text,text)'::regprocedure,'public.send_quote(uuid)'::regprocedure,
  'public.approve_quote(uuid)'::regprocedure,'public.convert_quote_to_invoice(uuid,text,date,date)'::regprocedure,
  'public.convert_quote_to_project(uuid)'::regprocedure,'public.change_lead_stage(uuid,text)'::regprocedure)
  AND pg_catalog.has_function_privilege('anon',oid,'EXECUTE')),0,'anon cannot execute any D4 RPC');
SELECT is((SELECT count(*)::integer FROM pg_catalog.pg_proc WHERE oid IN (
  'public.record_payment(uuid,numeric,text,text)'::regprocedure,'public.send_quote(uuid)'::regprocedure,
  'public.approve_quote(uuid)'::regprocedure,'public.convert_quote_to_invoice(uuid,text,date,date)'::regprocedure,
  'public.convert_quote_to_project(uuid)'::regprocedure,'public.change_lead_stage(uuid,text)'::regprocedure)
  AND pg_catalog.has_function_privilege('service_role',oid,'EXECUTE')),0,'service role cannot execute any D4 RPC');
SELECT is((SELECT count(*)::integer FROM pg_catalog.pg_proc WHERE oid IN (
  'public.record_payment(uuid,numeric,text,text)'::regprocedure,'public.send_quote(uuid)'::regprocedure,
  'public.approve_quote(uuid)'::regprocedure,'public.convert_quote_to_invoice(uuid,text,date,date)'::regprocedure,
  'public.convert_quote_to_project(uuid)'::regprocedure,'public.change_lead_stage(uuid,text)'::regprocedure)
  AND pg_catalog.has_function_privilege('supabase_auth_admin',oid,'EXECUTE')),0,'Auth service cannot execute any D4 RPC');
SELECT ok(NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a
  WHERE p.oid IN ('private.purplelok_insert_activity(uuid,text,text,uuid,text,jsonb)'::regprocedure,
    'private.purplelok_protect_payment_insert()'::regprocedure)
  AND a.privilege_type='EXECUTE' AND a.grantee IN (0::oid,'anon'::regrole::oid,'authenticated'::regrole::oid,
    'service_role'::regrole::oid,'supabase_auth_admin'::regrole::oid)),'private D4 helpers have no browser or service execution ACL');
SELECT is((SELECT count(*)::integer FROM information_schema.columns WHERE table_schema='public' AND table_name='projects'
  AND column_name='source_quote_id' AND data_type='uuid' AND is_nullable='YES' AND column_default IS NULL),1,'project source quote column is nullable uuid without default');
SELECT is((SELECT count(*)::integer FROM pg_catalog.pg_constraint WHERE conname='projects_source_quote_organization_fkey'
  AND conrelid='public.projects'::regclass AND confrelid='public.quotes'::regclass AND contype='f' AND convalidated AND confdeltype='r'),1,'project source quote has validated tenant FK with RESTRICT');
SELECT has_index('public','invoices','invoices_quote_id_unique','invoice source uniqueness exists');
SELECT has_index('public','payments','payments_invoice_reference_unique','payment replay index exists');
SELECT has_index('public','projects','projects_source_quote_id_unique','project source uniqueness exists');
SELECT is((SELECT count(*)::integer FROM pg_catalog.pg_policies WHERE schemaname='public' AND tablename IN
  ('clients','client_contacts','client_notes','leads','quotes','quote_items','invoices','invoice_items','payments','projects','project_milestones','tasks','task_comments','meetings','documents','tickets','ticket_messages','activities','notifications','channels','messages')),52,'D3 policy count remains 52');
SELECT is((SELECT count(*)::integer FROM pg_catalog.pg_policies WHERE schemaname='public' AND tablename='activities'),1,'activity browser policy remains read-only');
SELECT is((SELECT count(*)::integer FROM pg_catalog.pg_policies WHERE schemaname='public' AND tablename IN ('quotes','invoices') AND cmd='UPDATE'),0,'generic quote and invoice updates remain denied');
SELECT is((SELECT count(*)::integer FROM pg_catalog.pg_proc WHERE oid IN (
  'public.record_payment(uuid,numeric,text,text)'::regprocedure,'public.send_quote(uuid)'::regprocedure,
  'public.approve_quote(uuid)'::regprocedure,'public.convert_quote_to_invoice(uuid,text,date,date)'::regprocedure,
  'public.convert_quote_to_project(uuid)'::regprocedure,'public.change_lead_stage(uuid,text)'::regprocedure) AND provolatile='v'),6,'write RPCs are VOLATILE');
SELECT ok(NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a
  WHERE p.oid IN ('public.record_payment(uuid,numeric,text,text)'::regprocedure,'public.send_quote(uuid)'::regprocedure,
  'public.approve_quote(uuid)'::regprocedure,'public.convert_quote_to_invoice(uuid,text,date,date)'::regprocedure,
  'public.convert_quote_to_project(uuid)'::regprocedure,'public.change_lead_stage(uuid,text)'::regprocedure)
  AND a.grantee=0 AND a.privilege_type='EXECUTE'),'PUBLIC has no D4 RPC execution');
SELECT is((SELECT count(*)::integer FROM pg_catalog.pg_trigger WHERE tgrelid='public.payments'::regclass
  AND tgname='payments_require_protected_workflow' AND NOT tgisinternal AND tgenabled='O' AND tgtype=7
  AND tgfoid='private.purplelok_protect_payment_insert()'::regprocedure),1,'payment insert guard has exact enabled row-before-insert binding');

CREATE FUNCTION pg_temp.d4_actor(p_user uuid,p_session uuid,p_state text DEFAULT 'normal_v1') RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM pg_catalog.set_config('request.jwt.claim.sub',p_user::text,true);
  PERFORM pg_catalog.set_config('request.jwt.claims',pg_catalog.jsonb_build_object('sub',p_user::text,'session_id',p_session::text,
    'role','authenticated','purplelok_session_state',p_state)::text,true);
END $f$;
SELECT pg_catalog.set_config('d4.owner',(SELECT id::text FROM auth.users WHERE email='siyamyataza11@gmail.com'),true);
SELECT pg_catalog.set_config('d4.demo_admin',(SELECT id::text FROM auth.users WHERE email='admin@purplelok.com'),true);
SELECT pg_catalog.set_config('d4.real_org',(SELECT id::text FROM public.organizations WHERE slug='purplelok'),true);
SELECT pg_catalog.set_config('d4.demo_org',(SELECT id::text FROM public.organizations WHERE slug='purplelok-demo'),true);
INSERT INTO auth.sessions(id,user_id) VALUES
 ('00000000-0000-0000-0000-0000000d4401',current_setting('d4.owner')::uuid),
 ('00000000-0000-0000-0000-0000000d4402',current_setting('d4.demo_admin')::uuid);
INSERT INTO public.clients(id,organization_id,company_name,created_by) VALUES
 ('00000000-0000-0000-0000-0000000d4501',current_setting('d4.real_org')::uuid,'D4 Real',current_setting('d4.owner')::uuid),
 ('00000000-0000-0000-0000-0000000d4502',current_setting('d4.demo_org')::uuid,'D4 Demo',current_setting('d4.demo_admin')::uuid);
INSERT INTO public.invoices(id,organization_id,invoice_number,client_id,title,status,total,amount_paid,balance,created_by) VALUES
 ('00000000-0000-0000-0000-0000000d4601',current_setting('d4.real_org')::uuid,'D4-INV-1','00000000-0000-0000-0000-0000000d4501','Payment test','sent',100,0,100,current_setting('d4.owner')::uuid),
 ('00000000-0000-0000-0000-0000000d4602',current_setting('d4.real_org')::uuid,'D4-INV-2','00000000-0000-0000-0000-0000000d4501','Rollback test','sent',100,0,100,current_setting('d4.owner')::uuid),
 ('00000000-0000-0000-0000-0000000d4603',current_setting('d4.demo_org')::uuid,'D4-INV-3','00000000-0000-0000-0000-0000000d4502','Foreign test','sent',100,0,100,current_setting('d4.demo_admin')::uuid),
 ('00000000-0000-0000-0000-0000000d4604',current_setting('d4.real_org')::uuid,'D4-INV-4','00000000-0000-0000-0000-0000000d4501','Activity rollback','sent',100,0,100,current_setting('d4.owner')::uuid),
 ('00000000-0000-0000-0000-0000000d4605',current_setting('d4.real_org')::uuid,'D4-INV-5','00000000-0000-0000-0000-0000000d4501','Reference model','sent',100,0,100,current_setting('d4.owner')::uuid),
 ('00000000-0000-0000-0000-0000000d4606',current_setting('d4.real_org')::uuid,'D4-INV-6','00000000-0000-0000-0000-0000000d4501','Draft invoice','draft',100,0,100,current_setting('d4.owner')::uuid),
 ('00000000-0000-0000-0000-0000000d4607',current_setting('d4.demo_org')::uuid,'D4-GLOBAL','00000000-0000-0000-0000-0000000d4502','Global number collision','sent',100,0,100,current_setting('d4.demo_admin')::uuid);
SELECT pg_temp.d4_actor(current_setting('d4.owner')::uuid,'00000000-0000-0000-0000-0000000d4401');

-- Payment atomicity and replay (21-35).
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT * FROM public.record_payment('00000000-0000-0000-0000-0000000d4601',40,'eft','D4-PAY-1')$$,'authorized partial payment succeeds');
SELECT throws_ok($$INSERT INTO public.payments(organization_id,invoice_id,client_id,amount,method,reference)
  VALUES(current_setting('d4.real_org')::uuid,'00000000-0000-0000-0000-0000000d4601','00000000-0000-0000-0000-0000000d4501',1,'eft','D4-DIRECT')$$,
  '42501','Use the protected payment workflow','authenticated direct payment insert cannot bypass atomic workflow');
RESET ROLE;
SELECT is((SELECT count(*)::integer FROM public.payments WHERE invoice_id='00000000-0000-0000-0000-0000000d4601'),1,'payment insert commits with invoice update');
SELECT is((SELECT amount_paid FROM public.invoices WHERE id='00000000-0000-0000-0000-0000000d4601'),40::numeric,'authoritative paid amount is recomputed');
SELECT is((SELECT balance FROM public.invoices WHERE id='00000000-0000-0000-0000-0000000d4601'),60::numeric,'partial balance is correct');
SELECT is((SELECT status FROM public.invoices WHERE id='00000000-0000-0000-0000-0000000d4601'),'partial','partial status is applied');
SELECT is((SELECT count(*)::integer FROM public.activities WHERE entity_id='00000000-0000-0000-0000-0000000d4601' AND type='payment_recorded'),1,'payment activity is atomic');
SELECT throws_ok($$SELECT * FROM public.record_payment('00000000-0000-0000-0000-0000000d4601',1,'eft','D4-PAY-1')$$,'22023','Payment reference has already been used for this invoice','duplicate reference is rejected safely by uniqueness');
SELECT throws_ok($$SELECT * FROM public.record_payment('00000000-0000-0000-0000-0000000d4601',61,'eft','D4-PAY-3')$$,'22023','Payment exceeds invoice balance','overpayment is rejected');
SELECT is((SELECT count(*)::integer FROM public.payments WHERE invoice_id='00000000-0000-0000-0000-0000000d4601'),1,'overpayment leaves no payment');
SELECT lives_ok($$SELECT * FROM public.record_payment('00000000-0000-0000-0000-0000000d4601',60,'eft','D4-PAY-2')$$,'authorized final payment succeeds');
SELECT is((SELECT status FROM public.invoices WHERE id='00000000-0000-0000-0000-0000000d4601'),'paid','full payment marks invoice paid');
SELECT is((SELECT balance FROM public.invoices WHERE id='00000000-0000-0000-0000-0000000d4601'),0::numeric,'full payment clears balance');
SELECT throws_ok($$SELECT * FROM public.record_payment('00000000-0000-0000-0000-0000000d4601',1,'eft','D4-AFTER-PAID')$$,'22023','Invoice cannot accept payment','already-paid invoice rejects another payment');
SELECT throws_ok($$SELECT * FROM public.record_payment('00000000-0000-0000-0000-0000000d4603',1,'eft','D4-X')$$,'42501','Workflow unavailable or unauthorized','cross-tenant invoice is denied without disclosure');
SELECT throws_ok($$SELECT * FROM public.record_payment('ffffffff-ffff-ffff-ffff-ffffffffffff',1,'eft','D4-X')$$,'42501','Workflow unavailable or unauthorized','missing invoice uses same denial contract');
SELECT throws_ok($$SELECT * FROM public.record_payment('00000000-0000-0000-0000-0000000d4602',0,'eft','D4-Z')$$,'22023','Payment details are invalid','nonpositive payment is rejected');
SELECT throws_ok($$SELECT * FROM public.record_payment('00000000-0000-0000-0000-0000000d4602',-1,'eft','D4-NEGATIVE')$$,'22023','Payment details are invalid','negative payment is rejected');
SELECT throws_ok($$SELECT * FROM public.record_payment('00000000-0000-0000-0000-0000000d4606',1,'eft','D4-DRAFT')$$,'22023','Invoice cannot accept payment','invalid invoice status rejects payment');
CREATE FUNCTION pg_temp.d4_reject_invoice_update() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'forced invoice update failure'; END $f$;
CREATE TRIGGER d4_force_invoice_failure BEFORE UPDATE ON public.invoices FOR EACH ROW
  WHEN (OLD.id='00000000-0000-0000-0000-0000000d4602'::uuid) EXECUTE FUNCTION pg_temp.d4_reject_invoice_update();
SELECT throws_ok($$SELECT * FROM public.record_payment('00000000-0000-0000-0000-0000000d4602',10,'eft','D4-ROLLBACK')$$,'P0001','forced invoice update failure','forced invoice failure aborts payment workflow');
SELECT is((SELECT count(*)::integer FROM public.payments WHERE invoice_id='00000000-0000-0000-0000-0000000d4602'),0,'failed invoice update rolls back payment insert');
DROP TRIGGER d4_force_invoice_failure ON public.invoices;
SELECT throws_ok($$SELECT * FROM public.record_payment('00000000-0000-0000-0000-0000000d4605',1,'eft','')$$,'22023','Payment details are invalid','blank reference is rejected');
SELECT throws_ok($$SELECT * FROM public.record_payment('00000000-0000-0000-0000-0000000d4605',1,'eft','   ')$$,'22023','Payment details are invalid','whitespace reference is rejected');
SELECT lives_ok($$SELECT * FROM public.record_payment('00000000-0000-0000-0000-0000000d4605',10,'eft','  D4-PAY-1  ')$$,'same reference is valid on a different invoice');
SELECT is((SELECT reference FROM public.payments WHERE invoice_id='00000000-0000-0000-0000-0000000d4605' AND amount=10),'D4-PAY-1','reference whitespace is normalized before storage');
SELECT lives_ok($$SELECT * FROM public.record_payment('00000000-0000-0000-0000-0000000d4605',10,'eft','case')$$,'lowercase reference is accepted');
SELECT lives_ok($$SELECT * FROM public.record_payment('00000000-0000-0000-0000-0000000d4605',10,'eft','CASE')$$,'reference uniqueness is intentionally case-sensitive');
SELECT lives_ok($$SELECT * FROM public.record_payment('00000000-0000-0000-0000-0000000d4605',0.01,'eft','D4-CENT')$$,'decimal-cent payment is accepted exactly');
SELECT throws_ok($$SELECT * FROM public.record_payment('00000000-0000-0000-0000-0000000d4605',70,'eft','D4-CENT-OVER')$$,'22023','Payment exceeds invoice balance','payment 0.01 above remaining balance is rejected');
SELECT lives_ok($$SELECT * FROM public.record_payment('00000000-0000-0000-0000-0000000d4605',69.99,'eft','D4-CENT-FULL')$$,'payment exactly equal to decimal remaining balance succeeds');
SELECT is((SELECT amount_paid=100 AND balance=0 AND status='paid' FROM public.invoices WHERE id='00000000-0000-0000-0000-0000000d4605'),true,'multiple decimal payments reach exact paid state');
CREATE FUNCTION pg_temp.d4_reject_payment_activity() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'forced payment activity failure'; END $f$;
CREATE TRIGGER d4_force_payment_activity_failure BEFORE INSERT ON public.activities FOR EACH ROW
  WHEN (NEW.entity_id='00000000-0000-0000-0000-0000000d4604'::uuid) EXECUTE FUNCTION pg_temp.d4_reject_payment_activity();
SELECT throws_ok($$SELECT * FROM public.record_payment('00000000-0000-0000-0000-0000000d4604',10,'eft','D4-ACTIVITY-FAIL')$$,'P0001','forced payment activity failure','payment activity failure aborts workflow');
SELECT is((SELECT count(*)::integer FROM public.payments WHERE invoice_id='00000000-0000-0000-0000-0000000d4604'),0,'payment activity failure rolls back payment');
SELECT ok((SELECT amount_paid=0 AND balance=100 AND status='sent' FROM public.invoices WHERE id='00000000-0000-0000-0000-0000000d4604'),'payment activity failure restores invoice exactly');
SELECT is((SELECT count(*)::integer FROM public.activities WHERE entity_id='00000000-0000-0000-0000-0000000d4604'),0,'failed payment creates no activity');
DROP TRIGGER d4_force_payment_activity_failure ON public.activities;
DELETE FROM public.organization_role_permissions rp USING public.organization_roles r
WHERE rp.organization_role_id=r.id AND r.organization_id=current_setting('d4.real_org')::uuid
  AND r.key='owner' AND rp.permission_key='payments.record';
SELECT throws_ok($$SELECT * FROM public.record_payment('00000000-0000-0000-0000-0000000d4602',10,'eft','D4-NOPERM')$$,'42501','Workflow unavailable or unauthorized','missing payments.record is denied');
INSERT INTO public.organization_role_permissions(organization_id,organization_role_id,permission_key)
SELECT r.organization_id,r.id,'payments.record' FROM public.organization_roles r
WHERE r.organization_id=current_setting('d4.real_org')::uuid AND r.key='owner';

-- Quote transitions and conversion (36-56).
INSERT INTO public.quotes(id,organization_id,quote_number,client_id,title,status,subtotal,vat,total,created_by) VALUES
 ('00000000-0000-0000-0000-0000000d4701',current_setting('d4.real_org')::uuid,'D4-Q-1','00000000-0000-0000-0000-0000000d4501','Quote workflow','draft',100,15,115,current_setting('d4.owner')::uuid),
 ('00000000-0000-0000-0000-0000000d4702',current_setting('d4.real_org')::uuid,'D4-Q-2','00000000-0000-0000-0000-0000000d4501','Invoice conversion','accepted',200,30,230,current_setting('d4.owner')::uuid),
 ('00000000-0000-0000-0000-0000000d4703',current_setting('d4.real_org')::uuid,'D4-Q-3','00000000-0000-0000-0000-0000000d4501','Project conversion','accepted',300,45,345,current_setting('d4.owner')::uuid),
 ('00000000-0000-0000-0000-0000000d4704',current_setting('d4.demo_org')::uuid,'D4-Q-4','00000000-0000-0000-0000-0000000d4502','Foreign quote','draft',10,1.5,11.5,current_setting('d4.demo_admin')::uuid),
 ('00000000-0000-0000-0000-0000000d4706',current_setting('d4.real_org')::uuid,'D4-Q-6','00000000-0000-0000-0000-0000000d4501','Forced invoice rollback','accepted',20,3,23,current_setting('d4.owner')::uuid),
 ('00000000-0000-0000-0000-0000000d4707',current_setting('d4.real_org')::uuid,'D4-Q-7','00000000-0000-0000-0000-0000000d4501','Forced project rollback','accepted',30,4.5,34.5,current_setting('d4.owner')::uuid),
 ('00000000-0000-0000-0000-0000000d4708',current_setting('d4.real_org')::uuid,'D4-Q-8','00000000-0000-0000-0000-0000000d4501','No send permission','draft',10,1.5,11.5,current_setting('d4.owner')::uuid),
 ('00000000-0000-0000-0000-0000000d4709',current_setting('d4.real_org')::uuid,'D4-Q-9','00000000-0000-0000-0000-0000000d4501','Approval activity rollback','sent',10,1.5,11.5,current_setting('d4.owner')::uuid),
 ('00000000-0000-0000-0000-0000000d4710',current_setting('d4.real_org')::uuid,'D4-Q-10','00000000-0000-0000-0000-0000000d4501','Conversion activity rollback','accepted',10,1.5,11.5,current_setting('d4.owner')::uuid),
 ('00000000-0000-0000-0000-0000000d4711',current_setting('d4.real_org')::uuid,'D4-Q-11','00000000-0000-0000-0000-0000000d4501','Rejected state','rejected',10,1.5,11.5,current_setting('d4.owner')::uuid),
 ('00000000-0000-0000-0000-0000000d4712',current_setting('d4.real_org')::uuid,'D4-Q-12','00000000-0000-0000-0000-0000000d4501','Expired state','expired',10,1.5,11.5,current_setting('d4.owner')::uuid),
 ('00000000-0000-0000-0000-0000000d4713',current_setting('d4.real_org')::uuid,'D4-Q-13','00000000-0000-0000-0000-0000000d4501','Global number test','accepted',10,1.5,11.5,current_setting('d4.owner')::uuid);
INSERT INTO public.quote_items(id,organization_id,quote_id,description,quantity,unit_price,total) VALUES
 ('00000000-0000-0000-0000-0000000d4801',current_setting('d4.real_org')::uuid,'00000000-0000-0000-0000-0000000d4702','Line one',2,100,200),
 ('00000000-0000-0000-0000-0000000d4802',current_setting('d4.real_org')::uuid,'00000000-0000-0000-0000-0000000d4706','D4 FORCE CHILD',1,20,20);
SELECT lives_ok($$SELECT * FROM public.send_quote('00000000-0000-0000-0000-0000000d4701')$$,'authorized quote send succeeds');
SELECT is((SELECT status FROM public.quotes WHERE id='00000000-0000-0000-0000-0000000d4701'),'sent','send performs draft-to-sent transition');
SELECT is((SELECT count(*)::integer FROM public.activities WHERE entity_id='00000000-0000-0000-0000-0000000d4701' AND type='quote_sent'),1,'send activity is atomic');
SELECT throws_ok($$SELECT * FROM public.send_quote('00000000-0000-0000-0000-0000000d4701')$$,'22023','Quote transition is invalid','repeated send is rejected');
SELECT throws_ok($$SELECT * FROM public.send_quote('00000000-0000-0000-0000-0000000d4702')$$,'22023','Quote transition is invalid','accepted quote cannot be sent');
SELECT throws_ok($$SELECT * FROM public.send_quote('00000000-0000-0000-0000-0000000d4711')$$,'22023','Quote transition is invalid','rejected quote cannot be sent');
SELECT throws_ok($$SELECT * FROM public.send_quote('00000000-0000-0000-0000-0000000d4712')$$,'22023','Quote transition is invalid','expired quote cannot be sent');
SELECT throws_ok($$SELECT * FROM public.send_quote('00000000-0000-0000-0000-0000000d4704')$$,'42501','Workflow unavailable or unauthorized','cross-tenant send is denied');
DELETE FROM public.organization_role_permissions rp USING public.organization_roles r
WHERE rp.organization_role_id=r.id AND r.organization_id=current_setting('d4.real_org')::uuid
  AND r.key='owner' AND rp.permission_key='quotes.write';
SELECT throws_ok($$SELECT * FROM public.send_quote('00000000-0000-0000-0000-0000000d4708')$$,'42501','Workflow unavailable or unauthorized','missing quotes.write denies send');
INSERT INTO public.organization_role_permissions(organization_id,organization_role_id,permission_key)
SELECT r.organization_id,r.id,'quotes.write' FROM public.organization_roles r
WHERE r.organization_id=current_setting('d4.real_org')::uuid AND r.key='owner';
SELECT lives_ok($$SELECT * FROM public.approve_quote('00000000-0000-0000-0000-0000000d4701')$$,'authorized approval succeeds');
SELECT is((SELECT status FROM public.quotes WHERE id='00000000-0000-0000-0000-0000000d4701'),'accepted','approval changes exact state');
SELECT ok((SELECT approved_by_client AND approved_at IS NOT NULL FROM public.quotes WHERE id='00000000-0000-0000-0000-0000000d4701'),'approval metadata is server-generated');
SELECT is((SELECT count(*)::integer FROM public.activities WHERE entity_id='00000000-0000-0000-0000-0000000d4701' AND type='quote_approved'),1,'approval activity is atomic');
SELECT throws_ok($$SELECT * FROM public.approve_quote('00000000-0000-0000-0000-0000000d4701')$$,'22023','Quote transition is invalid','repeated approval is rejected');
SELECT throws_ok($$SELECT * FROM public.approve_quote('00000000-0000-0000-0000-0000000d4708')$$,'22023','Quote transition is invalid','draft quote cannot be approved');
SELECT throws_ok($$SELECT * FROM public.approve_quote('00000000-0000-0000-0000-0000000d4702')$$,'22023','Quote transition is invalid','accepted quote cannot be approved twice');
SELECT throws_ok($$SELECT * FROM public.approve_quote('00000000-0000-0000-0000-0000000d4711')$$,'22023','Quote transition is invalid','rejected quote cannot be approved');
SELECT throws_ok($$SELECT * FROM public.approve_quote('00000000-0000-0000-0000-0000000d4712')$$,'22023','Quote transition is invalid','expired quote cannot be approved');
SELECT throws_ok($$SELECT * FROM public.approve_quote('00000000-0000-0000-0000-0000000d4704')$$,'42501','Workflow unavailable or unauthorized','cross-tenant approval is denied');
SELECT throws_ok($$SELECT * FROM public.convert_quote_to_invoice('00000000-0000-0000-0000-0000000d4704','D4-FOREIGN','2026-09-04','2026-09-18')$$,'42501','Workflow unavailable or unauthorized','cross-tenant invoice conversion is denied');
SELECT throws_ok($$SELECT * FROM public.convert_quote_to_project('00000000-0000-0000-0000-0000000d4704')$$,'42501','Workflow unavailable or unauthorized','cross-tenant project conversion is denied');
CREATE FUNCTION pg_temp.d4_reject_approval_activity() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'forced approval activity failure'; END $f$;
CREATE TRIGGER d4_force_approval_activity_failure BEFORE INSERT ON public.activities FOR EACH ROW
  WHEN (NEW.entity_id='00000000-0000-0000-0000-0000000d4709'::uuid) EXECUTE FUNCTION pg_temp.d4_reject_approval_activity();
SELECT throws_ok($$SELECT * FROM public.approve_quote('00000000-0000-0000-0000-0000000d4709')$$,'P0001','forced approval activity failure','approval activity failure aborts workflow');
SELECT ok((SELECT status='sent' AND NOT approved_by_client AND approved_at IS NULL FROM public.quotes WHERE id='00000000-0000-0000-0000-0000000d4709'),'approval activity failure restores quote exactly');
SELECT is((SELECT count(*)::integer FROM public.activities WHERE entity_id='00000000-0000-0000-0000-0000000d4709'),0,'failed approval creates no activity');
DROP TRIGGER d4_force_approval_activity_failure ON public.activities;
INSERT INTO public.quotes(id,organization_id,quote_number,client_id,title,status,total,created_by)
VALUES ('00000000-0000-0000-0000-0000000d4705',current_setting('d4.real_org')::uuid,'D4-Q-5',
  '00000000-0000-0000-0000-0000000d4501','No approve','sent',10,current_setting('d4.owner')::uuid);
DELETE FROM public.organization_role_permissions rp USING public.organization_roles r
WHERE rp.organization_role_id=r.id AND r.organization_id=current_setting('d4.real_org')::uuid
  AND r.key='owner' AND rp.permission_key='quotes.approve';
SELECT throws_ok($$SELECT * FROM public.approve_quote('00000000-0000-0000-0000-0000000d4705')$$,'42501','Workflow unavailable or unauthorized','quotes.write without quotes.approve cannot approve');
SELECT throws_ok($$SELECT * FROM public.convert_quote_to_invoice('00000000-0000-0000-0000-0000000d4702','D4-NO-APPROVE','2026-09-04','2026-09-18')$$,'42501','Workflow unavailable or unauthorized','invoice conversion requires quote approval authority');
INSERT INTO public.organization_role_permissions(organization_id,organization_role_id,permission_key)
SELECT r.organization_id,r.id,'quotes.approve' FROM public.organization_roles r
WHERE r.organization_id=current_setting('d4.real_org')::uuid AND r.key='owner';
SELECT throws_ok($$SELECT * FROM public.convert_quote_to_invoice('00000000-0000-0000-0000-0000000d4705','D4-SENT-INV','2026-09-04','2026-09-18')$$,'22023','Quote conversion is invalid','sent quote cannot convert to invoice before approval');
SELECT throws_ok($$SELECT * FROM public.convert_quote_to_project('00000000-0000-0000-0000-0000000d4705')$$,'22023','Quote conversion is invalid','sent quote cannot convert to project before approval');
SELECT throws_ok($$SELECT * FROM public.convert_quote_to_invoice('00000000-0000-0000-0000-0000000d4713','  D4-GLOBAL  ','2026-09-04','2026-09-18')$$,'22023','Quote conversion conflicts with an existing invoice','global invoice-number collision is rejected safely');
SELECT is((SELECT count(*)::integer FROM public.invoices WHERE quote_id='00000000-0000-0000-0000-0000000d4713'),0,'invoice-number collision leaves no partial invoice');
SELECT is((SELECT count(*)::integer FROM public.activities WHERE entity_id='00000000-0000-0000-0000-0000000d4713'),0,'invoice-number collision leaves no activity');
DELETE FROM public.organization_role_permissions rp USING public.organization_roles r
WHERE rp.organization_role_id=r.id AND r.organization_id=current_setting('d4.real_org')::uuid
  AND r.key='owner' AND rp.permission_key='invoices.write';
SELECT throws_ok($$SELECT * FROM public.convert_quote_to_invoice('00000000-0000-0000-0000-0000000d4706','D4-NO-INVOICE','2026-09-04','2026-09-18')$$,'42501','Workflow unavailable or unauthorized','missing invoices.write denies conversion');
INSERT INTO public.organization_role_permissions(organization_id,organization_role_id,permission_key)
SELECT r.organization_id,r.id,'invoices.write' FROM public.organization_roles r
WHERE r.organization_id=current_setting('d4.real_org')::uuid AND r.key='owner';
CREATE FUNCTION pg_temp.d4_reject_invoice_item() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'forced invoice item failure'; END $f$;
CREATE TRIGGER d4_force_invoice_item_failure BEFORE INSERT ON public.invoice_items FOR EACH ROW
  WHEN (NEW.description='D4 FORCE CHILD') EXECUTE FUNCTION pg_temp.d4_reject_invoice_item();
SELECT throws_ok($$SELECT * FROM public.convert_quote_to_invoice('00000000-0000-0000-0000-0000000d4706','D4-ROLLBACK-INV','2026-09-04','2026-09-18')$$,'P0001','forced invoice item failure','child failure aborts invoice conversion');
SELECT is((SELECT count(*)::integer FROM public.invoices WHERE quote_id='00000000-0000-0000-0000-0000000d4706'),0,'child failure rolls back invoice');
SELECT is((SELECT status FROM public.quotes WHERE id='00000000-0000-0000-0000-0000000d4706'),'accepted','child failure preserves quote state');
SELECT is((SELECT count(*)::integer FROM public.activities WHERE entity_id='00000000-0000-0000-0000-0000000d4706'),0,'child failure leaves no conversion activity');
DROP TRIGGER d4_force_invoice_item_failure ON public.invoice_items;
CREATE FUNCTION pg_temp.d4_reject_invoice_activity() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'forced invoice activity failure'; END $f$;
CREATE TRIGGER d4_force_invoice_activity_failure BEFORE INSERT ON public.activities FOR EACH ROW
  WHEN (NEW.entity_id='00000000-0000-0000-0000-0000000d4710'::uuid) EXECUTE FUNCTION pg_temp.d4_reject_invoice_activity();
SELECT throws_ok($$SELECT * FROM public.convert_quote_to_invoice('00000000-0000-0000-0000-0000000d4710','D4-ACTIVITY-INV','2026-09-04','2026-09-18')$$,'P0001','forced invoice activity failure','conversion activity failure aborts invoice workflow');
SELECT is((SELECT count(*)::integer FROM public.invoices WHERE quote_id='00000000-0000-0000-0000-0000000d4710'),0,'conversion activity failure rolls back invoice');
SELECT is((SELECT status FROM public.quotes WHERE id='00000000-0000-0000-0000-0000000d4710'),'accepted','conversion activity failure preserves accepted quote');
SELECT is((SELECT count(*)::integer FROM public.activities WHERE entity_id='00000000-0000-0000-0000-0000000d4710'),0,'failed invoice conversion creates no activity');
DROP TRIGGER d4_force_invoice_activity_failure ON public.activities;
SELECT lives_ok($$SELECT * FROM public.convert_quote_to_invoice('00000000-0000-0000-0000-0000000d4702','D4-CONV-INV','2026-09-04','2026-09-18')$$,'quote converts to invoice atomically');
SELECT is((SELECT organization_id FROM public.invoices WHERE quote_id='00000000-0000-0000-0000-0000000d4702'),current_setting('d4.real_org')::uuid,'invoice inherits tenant');
SELECT is((SELECT created_by FROM public.invoices WHERE quote_id='00000000-0000-0000-0000-0000000d4702'),current_setting('d4.owner')::uuid,'invoice creator is auth uid');
SELECT is((SELECT count(*)::integer FROM public.invoice_items ii JOIN public.invoices i ON i.id=ii.invoice_id WHERE i.quote_id='00000000-0000-0000-0000-0000000d4702'),1,'invoice items are copied');
SELECT is((SELECT total FROM public.invoices WHERE quote_id='00000000-0000-0000-0000-0000000d4702'),230::numeric,'invoice total is copied from quote');
SELECT throws_ok($$SELECT * FROM public.convert_quote_to_invoice('00000000-0000-0000-0000-0000000d4702','D4-CONV-INV-2','2026-09-04','2026-09-18')$$,'22023','Quote has already been converted to an invoice','duplicate invoice conversion is denied');
SELECT is((SELECT count(*)::integer FROM public.activities WHERE entity_id='00000000-0000-0000-0000-0000000d4702' AND type='quote_converted_to_invoice'),1,'invoice conversion activity is atomic');
SELECT lives_ok($$SELECT * FROM public.convert_quote_to_project('00000000-0000-0000-0000-0000000d4703')$$,'quote converts to project atomically');
SELECT ok((SELECT organization_id=current_setting('d4.real_org')::uuid AND created_by=current_setting('d4.owner')::uuid AND source_quote_id='00000000-0000-0000-0000-0000000d4703' FROM public.projects WHERE source_quote_id='00000000-0000-0000-0000-0000000d4703'),'project tenant creator and source are derived');
SELECT throws_ok($$SELECT * FROM public.convert_quote_to_project('00000000-0000-0000-0000-0000000d4703')$$,'22023','Quote has already been converted to a project','duplicate project conversion is denied');
DELETE FROM public.organization_role_permissions rp USING public.organization_roles r
WHERE rp.organization_role_id=r.id AND r.organization_id=current_setting('d4.real_org')::uuid
  AND r.key='owner' AND rp.permission_key='projects.write';
SELECT throws_ok($$SELECT * FROM public.convert_quote_to_project('00000000-0000-0000-0000-0000000d4707')$$,'42501','Workflow unavailable or unauthorized','missing projects.write denies conversion');
INSERT INTO public.organization_role_permissions(organization_id,organization_role_id,permission_key)
SELECT r.organization_id,r.id,'projects.write' FROM public.organization_roles r
WHERE r.organization_id=current_setting('d4.real_org')::uuid AND r.key='owner';
CREATE FUNCTION pg_temp.d4_reject_project_activity() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'forced project activity failure'; END $f$;
CREATE TRIGGER d4_force_project_activity_failure BEFORE INSERT ON public.activities FOR EACH ROW
  WHEN (NEW.entity_id='00000000-0000-0000-0000-0000000d4707'::uuid) EXECUTE FUNCTION pg_temp.d4_reject_project_activity();
SELECT throws_ok($$SELECT * FROM public.convert_quote_to_project('00000000-0000-0000-0000-0000000d4707')$$,'P0001','forced project activity failure','activity failure aborts project conversion');
SELECT is((SELECT count(*)::integer FROM public.projects WHERE source_quote_id='00000000-0000-0000-0000-0000000d4707'),0,'activity failure rolls back project');
SELECT is((SELECT status FROM public.quotes WHERE id='00000000-0000-0000-0000-0000000d4707'),'accepted','project failure preserves quote state');
DROP TRIGGER d4_force_project_activity_failure ON public.activities;

-- Lead and session denial (57-68).
INSERT INTO public.leads(id,organization_id,company_name,stage) VALUES
 ('00000000-0000-0000-0000-0000000d4901',current_setting('d4.real_org')::uuid,'D4 Lead','new_lead'),
 ('00000000-0000-0000-0000-0000000d4902',current_setting('d4.demo_org')::uuid,'D4 Foreign Lead','new_lead');
SELECT lives_ok($$SELECT * FROM public.change_lead_stage('00000000-0000-0000-0000-0000000d4901','contacted')$$,'authorized lead stage change succeeds');
SELECT is((SELECT stage FROM public.leads WHERE id='00000000-0000-0000-0000-0000000d4901'),'contacted','lead stage is changed');
SELECT is((SELECT count(*)::integer FROM public.activities WHERE entity_id='00000000-0000-0000-0000-0000000d4901' AND type='lead_stage_change'),1,'lead activity is atomic');
SELECT throws_ok($$SELECT * FROM public.change_lead_stage('00000000-0000-0000-0000-0000000d4901','contacted')$$,'22023','Lead transition is invalid','repeated lead stage is rejected');
SELECT throws_ok($$SELECT * FROM public.change_lead_stage('00000000-0000-0000-0000-0000000d4901','invalid')$$,'22023','Lead transition is invalid','invalid lead stage is rejected');
SELECT throws_ok($$SELECT * FROM public.change_lead_stage('00000000-0000-0000-0000-0000000d4902','contacted')$$,'42501','Workflow unavailable or unauthorized','cross-tenant lead is denied');
SELECT pg_temp.d4_actor(current_setting('d4.owner')::uuid,'00000000-0000-0000-0000-0000000d4401','recovery_pending_v1');
SELECT throws_ok($$SELECT * FROM public.change_lead_stage('00000000-0000-0000-0000-0000000d4901','negotiating')$$,'42501','Workflow unavailable or unauthorized','recovery session is denied');
SELECT pg_temp.d4_actor(current_setting('d4.owner')::uuid,'00000000-0000-0000-0000-0000000d4401');
DELETE FROM auth.sessions WHERE id='00000000-0000-0000-0000-0000000d4401';
SELECT throws_ok($$SELECT * FROM public.change_lead_stage('00000000-0000-0000-0000-0000000d4901','negotiating')$$,'42501','Workflow unavailable or unauthorized','stale session is denied');
SELECT is((SELECT stage FROM public.leads WHERE id='00000000-0000-0000-0000-0000000d4901'),'contacted','denied sessions do not mutate lead');
SELECT is((SELECT count(*)::integer FROM public.activities WHERE entity_id='00000000-0000-0000-0000-0000000d4703' AND type='quote_converted_to_project'),1,'project conversion activity is atomic');
SELECT is((SELECT assigned_to FROM public.projects WHERE source_quote_id='00000000-0000-0000-0000-0000000d4703'),'{}'::uuid[],'project conversion accepts no forged assignee input');
SELECT is((SELECT count(*)::integer FROM public.invoices WHERE quote_id='00000000-0000-0000-0000-0000000d4702'),1,'invoice conversion uniqueness is effective');
SELECT is((SELECT count(*)::integer FROM public.projects WHERE source_quote_id='00000000-0000-0000-0000-0000000d4703'),1,'project conversion uniqueness is effective');
INSERT INTO auth.sessions(id,user_id) VALUES ('00000000-0000-0000-0000-0000000d4401',current_setting('d4.owner')::uuid);
UPDATE public.organization_members SET status='suspended'
WHERE organization_id=current_setting('d4.real_org')::uuid AND user_id=current_setting('d4.owner')::uuid;
SELECT throws_ok($$SELECT * FROM public.change_lead_stage('00000000-0000-0000-0000-0000000d4901','negotiating')$$,'42501','Workflow unavailable or unauthorized','suspended membership is denied');
UPDATE public.organization_members SET status='active'
WHERE organization_id=current_setting('d4.real_org')::uuid AND user_id=current_setting('d4.owner')::uuid;
CREATE TEMP TABLE d4_owner_assignment AS
SELECT mr.* FROM public.organization_member_roles mr JOIN public.organization_members m ON m.id=mr.organization_member_id
WHERE m.organization_id=current_setting('d4.real_org')::uuid AND m.user_id=current_setting('d4.owner')::uuid;
DELETE FROM public.organization_member_roles mr USING public.organization_members m
WHERE mr.organization_member_id=m.id AND m.organization_id=current_setting('d4.real_org')::uuid
  AND m.user_id=current_setting('d4.owner')::uuid;
ALTER TABLE public.organization_member_roles DISABLE TRIGGER organization_member_roles_reject_client;
INSERT INTO public.organization_member_roles(organization_id,organization_member_id,organization_role_id)
SELECT m.organization_id,m.id,r.id FROM public.organization_members m JOIN public.organization_roles r
  ON r.organization_id=m.organization_id AND r.key='client'
WHERE m.organization_id=current_setting('d4.real_org')::uuid AND m.user_id=current_setting('d4.owner')::uuid;
ALTER TABLE public.organization_member_roles ENABLE TRIGGER organization_member_roles_reject_client;
ALTER TABLE public.organization_role_permissions DISABLE TRIGGER organization_role_permissions_restrict_client;
INSERT INTO public.organization_role_permissions(organization_id,organization_role_id,permission_key)
SELECT r.organization_id,r.id,'leads.write' FROM public.organization_roles r
WHERE r.organization_id=current_setting('d4.real_org')::uuid AND r.key='client';
ALTER TABLE public.organization_role_permissions ENABLE TRIGGER organization_role_permissions_restrict_client;
SELECT throws_ok($$SELECT * FROM public.change_lead_stage('00000000-0000-0000-0000-0000000d4901','negotiating')$$,'42501','Workflow unavailable or unauthorized','Client-only actor remains denied despite historical permission drift');
DELETE FROM public.organization_role_permissions rp USING public.organization_roles r
WHERE rp.organization_role_id=r.id AND r.organization_id=current_setting('d4.real_org')::uuid
  AND r.key='client' AND rp.permission_key='leads.write';
DELETE FROM public.organization_member_roles mr USING public.organization_roles r
WHERE mr.organization_role_id=r.id AND r.organization_id=current_setting('d4.real_org')::uuid AND r.key='client';
INSERT INTO public.organization_member_roles SELECT * FROM d4_owner_assignment;
SELECT ok(NOT pg_catalog.has_function_privilege('authenticated','private.purplelok_insert_activity(uuid,text,text,uuid,text,jsonb)','EXECUTE'),'activity helper remains inaccessible after functional tests');
SELECT is((SELECT count(*)::integer FROM public.platform_admins),0,'platform administration is not used by workflows');
SELECT is((SELECT count(*)::integer FROM public.organization_role_permissions rp JOIN public.organization_roles r ON r.id=rp.organization_role_id
  WHERE r.organization_id=current_setting('d4.real_org')::uuid AND r.key='owner' AND rp.permission_key IN ('payments.record','quotes.approve')),2,'temporary permission-denial fixtures restore exact Owner mappings');
SELECT is((SELECT count(*)::integer FROM public.activities WHERE organization_id=current_setting('d4.demo_org')::uuid
  AND entity_id IN ('00000000-0000-0000-0000-0000000d4603','00000000-0000-0000-0000-0000000d4704','00000000-0000-0000-0000-0000000d4902')),0,'cross-tenant denials create no activities');
SELECT is((SELECT count(*)::integer FROM public.payments WHERE reference IN ('D4-X','D4-NOPERM','D4-ROLLBACK')),0,'denied and failed payment attempts leave no writes');
DELETE FROM public.organization_role_permissions rp USING public.organization_roles r
WHERE rp.organization_role_id=r.id AND r.organization_id=current_setting('d4.real_org')::uuid
  AND r.key='owner' AND rp.permission_key='leads.write';
SELECT throws_ok($$SELECT * FROM public.change_lead_stage('00000000-0000-0000-0000-0000000d4901','negotiating')$$,'42501','Workflow unavailable or unauthorized','missing leads.write denies stage workflow');
INSERT INTO public.organization_role_permissions(organization_id,organization_role_id,permission_key)
SELECT r.organization_id,r.id,'leads.write' FROM public.organization_roles r
WHERE r.organization_id=current_setting('d4.real_org')::uuid AND r.key='owner';

SELECT * FROM finish();
ROLLBACK;
