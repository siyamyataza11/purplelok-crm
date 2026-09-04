/* Batch 5F-D4: minimal protected transactional business workflows. */
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '3min';

DO $preflight$
BEGIN
  IF (SELECT count(*) FROM pg_catalog.pg_policies WHERE schemaname = 'public'
      AND tablename = ANY (ARRAY['clients','client_contacts','client_notes','leads','quotes','quote_items','invoices','invoice_items','payments','projects','project_milestones','tasks','task_comments','meetings','documents','tickets','ticket_messages','activities','notifications','channels','messages'])) <> 52
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_policies WHERE schemaname='public'
       AND tablename=ANY(ARRAY['clients','client_contacts','client_notes','leads','quotes','quote_items','invoices','invoice_items','payments','projects','project_milestones','tasks','task_comments','meetings','documents','tickets','ticket_messages','activities','notifications','channels','messages'])
       AND (policyname NOT LIKE 'domain\_%' ESCAPE '\' OR qual='true' OR with_check='true'))
     OR (SELECT count(*) FROM pg_catalog.pg_policies WHERE schemaname='public' AND tablename='activities')<>1
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_policies WHERE schemaname='public' AND tablename IN ('quotes','invoices') AND cmd='UPDATE')
     OR (SELECT count(*) FROM pg_catalog.pg_trigger AS trigger
         JOIN pg_catalog.pg_class AS relation ON relation.oid=trigger.tgrelid
         WHERE trigger.tgname='domain_'||relation.relname||'_protect_update'
           AND NOT trigger.tgisinternal AND trigger.tgenabled='O' AND trigger.tgtype=19
           AND trigger.tgfoid='private.purplelok_protect_domain_update()'::regprocedure)<>21
     OR pg_catalog.to_regprocedure('private.purplelok_has_permission(uuid,text)') IS NULL
     OR EXISTS (SELECT 1 FROM public.invoices WHERE quote_id IS NOT NULL GROUP BY quote_id HAVING count(*) > 1)
     OR EXISTS (SELECT 1 FROM public.payments WHERE reference IS NOT NULL AND pg_catalog.btrim(reference) <> '' GROUP BY invoice_id, reference HAVING count(*) > 1)
     OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'source_quote_id')
     OR pg_catalog.to_regprocedure('private.purplelok_insert_activity(uuid,text,text,uuid,text,jsonb)') IS NOT NULL
     OR pg_catalog.to_regprocedure('private.purplelok_protect_payment_insert()') IS NOT NULL
     OR pg_catalog.to_regprocedure('public.record_payment(uuid,numeric,text,text)') IS NOT NULL
     OR pg_catalog.to_regprocedure('public.send_quote(uuid)') IS NOT NULL
     OR pg_catalog.to_regprocedure('public.approve_quote(uuid)') IS NOT NULL
     OR pg_catalog.to_regprocedure('public.convert_quote_to_invoice(uuid,text,date,date)') IS NOT NULL
     OR pg_catalog.to_regprocedure('public.convert_quote_to_project(uuid)') IS NOT NULL
     OR pg_catalog.to_regprocedure('public.change_lead_stage(uuid,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'Batch 5F-D4 precondition failed';
  END IF;
END
$preflight$;

CREATE UNIQUE INDEX invoices_quote_id_unique ON public.invoices (quote_id) WHERE quote_id IS NOT NULL;
CREATE UNIQUE INDEX payments_invoice_reference_unique ON public.payments (invoice_id, reference)
  WHERE reference IS NOT NULL AND pg_catalog.btrim(reference) <> '';
ALTER TABLE public.projects ADD COLUMN source_quote_id uuid;
ALTER TABLE public.projects ADD CONSTRAINT projects_source_quote_organization_fkey
  FOREIGN KEY (source_quote_id, organization_id) REFERENCES public.quotes (id, organization_id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX projects_source_quote_id_unique ON public.projects (source_quote_id) WHERE source_quote_id IS NOT NULL;

CREATE FUNCTION private.purplelok_insert_activity(
  p_organization_id uuid, p_type text, p_entity text, p_entity_id uuid,
  p_description text, p_metadata jsonb DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' SET row_security = 'off'
AS $function$
DECLARE v_activity_id uuid;
BEGIN
  IF auth.uid() IS NULL OR p_organization_id IS NULL OR p_entity_id IS NULL
     OR p_type IS NULL OR pg_catalog.btrim(p_type) = ''
     OR p_entity IS NULL OR pg_catalog.btrim(p_entity) = ''
     OR p_description IS NULL OR pg_catalog.btrim(p_description) = '' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Activity context is invalid';
  END IF;
  INSERT INTO public.activities (organization_id,user_id,type,entity,entity_id,description,metadata)
  VALUES (p_organization_id,auth.uid(),p_type,p_entity,p_entity_id,p_description,coalesce(p_metadata,'{}'::jsonb))
  RETURNING id INTO v_activity_id;
  RETURN v_activity_id;
END
$function$;

CREATE FUNCTION private.purplelok_protect_payment_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' SET row_security='off'
AS $function$
BEGIN
  IF current_user='authenticated' THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Use the protected payment workflow';
  END IF;
  RETURN NEW;
END
$function$;

CREATE TRIGGER payments_require_protected_workflow
BEFORE INSERT ON public.payments FOR EACH ROW
EXECUTE FUNCTION private.purplelok_protect_payment_insert();

CREATE FUNCTION public.send_quote(p_quote_id uuid)
RETURNS TABLE (quote_id uuid,quote_status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET row_security='off'
AS $function$
DECLARE v_quote public.quotes%ROWTYPE;
BEGIN
  SELECT q.* INTO v_quote FROM public.quotes AS q WHERE q.id=p_quote_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL
     OR NOT private.purplelok_has_permission(v_quote.organization_id,'quotes.write') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Workflow unavailable or unauthorized';
  END IF;
  IF v_quote.status<>'draft' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Quote transition is invalid';
  END IF;
  UPDATE public.quotes AS q SET status='sent' WHERE q.id=v_quote.id;
  PERFORM private.purplelok_insert_activity(v_quote.organization_id,'quote_sent','quote',v_quote.id,
    'sent quote '||v_quote.quote_number,NULL);
  RETURN QUERY SELECT v_quote.id,'sent'::text;
END
$function$;

CREATE FUNCTION public.approve_quote(p_quote_id uuid)
RETURNS TABLE (quote_id uuid,quote_status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET row_security='off'
AS $function$
DECLARE v_quote public.quotes%ROWTYPE;
BEGIN
  SELECT q.* INTO v_quote FROM public.quotes AS q WHERE q.id=p_quote_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL
     OR NOT private.purplelok_has_permission(v_quote.organization_id,'quotes.approve') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Workflow unavailable or unauthorized';
  END IF;
  IF v_quote.status<>'sent' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Quote transition is invalid';
  END IF;
  UPDATE public.quotes AS q SET status='accepted',approved_by_client=true,
    approved_at=pg_catalog.clock_timestamp() WHERE q.id=v_quote.id;
  PERFORM private.purplelok_insert_activity(v_quote.organization_id,'quote_approved','quote',v_quote.id,
    'approved quote '||v_quote.quote_number,NULL);
  RETURN QUERY SELECT v_quote.id,'accepted'::text;
END
$function$;

CREATE FUNCTION public.convert_quote_to_invoice(
  p_quote_id uuid,p_invoice_number text,p_issue_date date,p_due_date date
) RETURNS TABLE (invoice_id uuid,invoice_status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET row_security='off'
AS $function$
DECLARE v_quote public.quotes%ROWTYPE; v_invoice_id uuid;
BEGIN
  SELECT q.* INTO v_quote FROM public.quotes AS q WHERE q.id=p_quote_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL
     OR NOT private.purplelok_has_permission(v_quote.organization_id,'quotes.approve')
     OR NOT private.purplelok_has_permission(v_quote.organization_id,'invoices.write') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Workflow unavailable or unauthorized';
  END IF;
  IF v_quote.status<>'accepted' OR p_invoice_number IS NULL
     OR pg_catalog.btrim(p_invoice_number)='' OR p_issue_date IS NULL OR p_due_date IS NULL
     OR p_due_date<p_issue_date THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Quote conversion is invalid';
  END IF;
  IF EXISTS (SELECT 1 FROM public.invoices AS i WHERE i.quote_id=v_quote.id) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Quote has already been converted to an invoice';
  END IF;
  BEGIN
    INSERT INTO public.invoices
      (organization_id,invoice_number,client_id,quote_id,title,status,subtotal,discount,vat,total,
       vat_rate,amount_paid,balance,issue_date,due_date,created_by)
    VALUES
      (v_quote.organization_id,pg_catalog.btrim(p_invoice_number),v_quote.client_id,v_quote.id,v_quote.title,
       'draft',v_quote.subtotal,v_quote.discount,v_quote.vat,v_quote.total,v_quote.vat_rate,0,v_quote.total,
       p_issue_date,p_due_date,auth.uid())
    RETURNING id INTO v_invoice_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Quote conversion conflicts with an existing invoice';
  END;
  INSERT INTO public.invoice_items (organization_id,invoice_id,description,quantity,unit_price,total)
  SELECT v_quote.organization_id,v_invoice_id,qi.description,qi.quantity,qi.unit_price,qi.total
  FROM public.quote_items AS qi WHERE qi.quote_id=v_quote.id;
  PERFORM private.purplelok_insert_activity(v_quote.organization_id,'quote_converted_to_invoice','quote',v_quote.id,
    'converted quote '||v_quote.quote_number||' to invoice '||pg_catalog.btrim(p_invoice_number),
    pg_catalog.jsonb_build_object('invoice_id',v_invoice_id));
  RETURN QUERY SELECT v_invoice_id,'draft'::text;
END
$function$;

CREATE FUNCTION public.convert_quote_to_project(p_quote_id uuid)
RETURNS TABLE (project_id uuid,project_status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET row_security='off'
AS $function$
DECLARE v_quote public.quotes%ROWTYPE; v_project_id uuid;
BEGIN
  SELECT q.* INTO v_quote FROM public.quotes AS q WHERE q.id=p_quote_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL
     OR NOT private.purplelok_has_permission(v_quote.organization_id,'quotes.approve')
     OR NOT private.purplelok_has_permission(v_quote.organization_id,'projects.write') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Workflow unavailable or unauthorized';
  END IF;
  IF v_quote.status<>'accepted' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Quote conversion is invalid';
  END IF;
  IF EXISTS (SELECT 1 FROM public.projects AS p WHERE p.source_quote_id=v_quote.id) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Quote has already been converted to a project';
  END IF;
  BEGIN
    INSERT INTO public.projects
      (organization_id,source_quote_id,name,client_id,type,status,budget,progress,health,assigned_to,created_by)
    VALUES
      (v_quote.organization_id,v_quote.id,v_quote.title,v_quote.client_id,'other','planning',v_quote.total,
       0,'on_track','{}'::uuid[],auth.uid()) RETURNING id INTO v_project_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Quote conversion conflicts with an existing project';
  END;
  PERFORM private.purplelok_insert_activity(v_quote.organization_id,'quote_converted_to_project','quote',v_quote.id,
    'converted quote '||v_quote.quote_number||' to project',pg_catalog.jsonb_build_object('project_id',v_project_id));
  RETURN QUERY SELECT v_project_id,'planning'::text;
END
$function$;

CREATE FUNCTION public.change_lead_stage(p_lead_id uuid,p_stage text)
RETURNS TABLE (lead_id uuid,lead_stage text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET row_security='off'
AS $function$
DECLARE v_lead public.leads%ROWTYPE;
BEGIN
  SELECT l.* INTO v_lead FROM public.leads AS l WHERE l.id=p_lead_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL
     OR NOT private.purplelok_has_permission(v_lead.organization_id,'leads.write') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Workflow unavailable or unauthorized';
  END IF;
  IF p_stage IS NULL OR p_stage NOT IN ('new_lead','contacted','proposal_sent','negotiating','won','lost')
     OR p_stage=v_lead.stage THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Lead transition is invalid';
  END IF;
  UPDATE public.leads AS l SET stage=p_stage WHERE l.id=v_lead.id;
  PERFORM private.purplelok_insert_activity(v_lead.organization_id,'lead_stage_change','lead',v_lead.id,
    'moved lead "'||v_lead.company_name||'" to '||pg_catalog.replace(p_stage,'_',' '),NULL);
  RETURN QUERY SELECT v_lead.id,p_stage;
END
$function$;

CREATE FUNCTION public.record_payment(p_invoice_id uuid,p_amount numeric,p_method text,p_reference text)
RETURNS TABLE (payment_id uuid,invoice_id uuid,invoice_status text,amount_paid numeric,balance numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET row_security='off'
AS $function$
DECLARE v_invoice public.invoices%ROWTYPE; v_payment_id uuid; v_amount_paid numeric; v_balance numeric; v_status text;
BEGIN
  SELECT i.* INTO v_invoice FROM public.invoices AS i WHERE i.id=p_invoice_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS NULL OR NOT private.purplelok_has_permission(v_invoice.organization_id,'payments.record') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Workflow unavailable or unauthorized';
  END IF;
  IF p_amount IS NULL OR p_amount<=0 OR p_method IS NULL OR pg_catalog.btrim(p_method)=''
     OR p_reference IS NULL OR pg_catalog.btrim(p_reference)='' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Payment details are invalid';
  END IF;
  IF v_invoice.status NOT IN ('sent','partial','overdue') THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invoice cannot accept payment';
  END IF;
  SELECT coalesce(pg_catalog.sum(p.amount),0)+p_amount INTO v_amount_paid
  FROM public.payments AS p WHERE p.invoice_id=v_invoice.id;
  IF v_amount_paid>v_invoice.total THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Payment exceeds invoice balance';
  END IF;
  BEGIN
    INSERT INTO public.payments (organization_id,invoice_id,client_id,amount,method,reference)
    VALUES (v_invoice.organization_id,v_invoice.id,v_invoice.client_id,p_amount,pg_catalog.btrim(p_method),pg_catalog.btrim(p_reference))
    RETURNING id INTO v_payment_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Payment reference has already been used for this invoice';
  END;
  v_balance:=v_invoice.total-v_amount_paid;
  v_status:=CASE WHEN v_balance=0 THEN 'paid' ELSE 'partial' END;
  UPDATE public.invoices AS i SET amount_paid=v_amount_paid,balance=v_balance,status=v_status WHERE i.id=v_invoice.id;
  PERFORM private.purplelok_insert_activity(v_invoice.organization_id,'payment_recorded','invoice',v_invoice.id,
    'recorded payment for invoice '||v_invoice.invoice_number,
    pg_catalog.jsonb_build_object('payment_id',v_payment_id,'amount',p_amount));
  RETURN QUERY SELECT v_payment_id,v_invoice.id,v_status,v_amount_paid,v_balance;
END
$function$;

ALTER FUNCTION private.purplelok_insert_activity(uuid,text,text,uuid,text,jsonb) OWNER TO postgres;
ALTER FUNCTION private.purplelok_protect_payment_insert() OWNER TO postgres;
ALTER FUNCTION public.record_payment(uuid,numeric,text,text) OWNER TO postgres;
ALTER FUNCTION public.send_quote(uuid) OWNER TO postgres;
ALTER FUNCTION public.approve_quote(uuid) OWNER TO postgres;
ALTER FUNCTION public.convert_quote_to_invoice(uuid,text,date,date) OWNER TO postgres;
ALTER FUNCTION public.convert_quote_to_project(uuid) OWNER TO postgres;
ALTER FUNCTION public.change_lead_stage(uuid,text) OWNER TO postgres;

REVOKE ALL ON FUNCTION private.purplelok_insert_activity(uuid,text,text,uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
REVOKE ALL ON FUNCTION private.purplelok_protect_payment_insert() FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
REVOKE ALL ON FUNCTION public.record_payment(uuid,numeric,text,text) FROM PUBLIC,anon,service_role,supabase_auth_admin;
REVOKE ALL ON FUNCTION public.send_quote(uuid) FROM PUBLIC,anon,service_role,supabase_auth_admin;
REVOKE ALL ON FUNCTION public.approve_quote(uuid) FROM PUBLIC,anon,service_role,supabase_auth_admin;
REVOKE ALL ON FUNCTION public.convert_quote_to_invoice(uuid,text,date,date) FROM PUBLIC,anon,service_role,supabase_auth_admin;
REVOKE ALL ON FUNCTION public.convert_quote_to_project(uuid) FROM PUBLIC,anon,service_role,supabase_auth_admin;
REVOKE ALL ON FUNCTION public.change_lead_stage(uuid,text) FROM PUBLIC,anon,service_role,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.record_payment(uuid,numeric,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_quote(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_quote(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.convert_quote_to_invoice(uuid,text,date,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.convert_quote_to_project(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.change_lead_stage(uuid,text) TO authenticated;

DO $postflight$
DECLARE v_signature text;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.record_payment(uuid,numeric,text,text)','public.send_quote(uuid)','public.approve_quote(uuid)',
    'public.convert_quote_to_invoice(uuid,text,date,date)','public.convert_quote_to_project(uuid)',
    'public.change_lead_stage(uuid,text)'
  ] LOOP
    IF NOT pg_catalog.has_function_privilege('authenticated',v_signature,'EXECUTE')
       OR pg_catalog.has_function_privilege('anon',v_signature,'EXECUTE')
       OR pg_catalog.has_function_privilege('service_role',v_signature,'EXECUTE')
       OR pg_catalog.has_function_privilege('supabase_auth_admin',v_signature,'EXECUTE')
       OR EXISTS (
         SELECT 1 FROM pg_catalog.pg_proc AS p
         CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) AS privilege
         WHERE p.oid=pg_catalog.to_regprocedure(v_signature)
           AND privilege.grantee=0 AND privilege.privilege_type='EXECUTE'
       ) THEN
      RAISE EXCEPTION 'Batch 5F-D4 RPC ACL postcondition failed: %',v_signature;
    END IF;
  END LOOP;
  IF pg_catalog.has_function_privilege('authenticated','private.purplelok_insert_activity(uuid,text,text,uuid,text,jsonb)','EXECUTE')
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_proc AS p
       CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) AS privilege
       WHERE p.oid=pg_catalog.to_regprocedure('private.purplelok_insert_activity(uuid,text,text,uuid,text,jsonb)')
         AND privilege.grantee=0 AND privilege.privilege_type='EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Batch 5F-D4 helper ACL postcondition failed';
  END IF;
  IF pg_catalog.has_function_privilege('authenticated','private.purplelok_protect_payment_insert()','EXECUTE')
     OR (SELECT count(*) FROM pg_catalog.pg_trigger AS trigger
         WHERE trigger.tgrelid='public.payments'::regclass
           AND trigger.tgname='payments_require_protected_workflow'
           AND NOT trigger.tgisinternal AND trigger.tgenabled='O' AND trigger.tgtype=7
           AND trigger.tgfoid='private.purplelok_protect_payment_insert()'::regprocedure)<>1 THEN
    RAISE EXCEPTION 'Batch 5F-D4 payment guard postcondition failed';
  END IF;
END
$postflight$;

COMMIT;
