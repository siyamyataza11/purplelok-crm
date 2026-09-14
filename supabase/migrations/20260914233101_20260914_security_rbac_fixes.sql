-- 1. Fix security warnings
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', ''));
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM authenticated;

-- 2. RBAC helper functions
CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role != 'client' AND active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.has_role(p_role text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = p_role AND active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.is_management()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('super_admin', 'ceo', 'director') AND active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.can_access_finance()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('super_admin', 'ceo', 'director', 'finance') AND active = true
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_staff() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_management() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_finance() TO authenticated;

-- 3. Drop ALL existing policies on CRM tables, then recreate with RBAC
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename IN (
    'profiles','clients','client_contacts','client_notes','leads',
    'quotes','quote_items','invoices','invoice_items','payments',
    'projects','project_milestones','tasks','task_comments',
    'meetings','documents','tickets','ticket_messages',
    'activities','notifications','channels','messages'
  )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'profiles_select', t);
  END LOOP;
END $$;

-- Drop all policies by iterating
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN SELECT schemaname, tablename, policyname FROM pg_policies WHERE schemaname = 'public'
    AND tablename IN (
      'profiles','clients','client_contacts','client_notes','leads',
      'quotes','quote_items','invoices','invoice_items','payments',
      'projects','project_milestones','tasks','task_comments',
      'meetings','documents','tickets','ticket_messages',
      'activities','notifications','channels','messages'
    )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', pol.policyname, pol.schemaname, pol.tablename);
  END LOOP;
END $$;

-- PROFILES
CREATE POLICY "profiles_select" ON profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.is_staff());
CREATE POLICY "profiles_update" ON profiles FOR UPDATE TO authenticated
  USING (id = auth.uid() OR public.is_management())
  WITH CHECK (id = auth.uid() OR public.is_management());

-- CLIENTS
CREATE POLICY "clients_select" ON clients FOR SELECT TO authenticated
  USING (public.is_staff() OR created_by = auth.uid());
CREATE POLICY "clients_insert" ON clients FOR INSERT TO authenticated
  WITH CHECK (public.is_staff());
CREATE POLICY "clients_update" ON clients FOR UPDATE TO authenticated
  USING (public.is_staff()) WITH CHECK (public.is_staff());
CREATE POLICY "clients_delete" ON clients FOR DELETE TO authenticated
  USING (public.is_management());

-- CLIENT_CONTACTS
CREATE POLICY "client_contacts_select" ON client_contacts FOR SELECT TO authenticated
  USING (public.is_staff());
CREATE POLICY "client_contacts_insert" ON client_contacts FOR INSERT TO authenticated
  WITH CHECK (public.is_staff());
CREATE POLICY "client_contacts_update" ON client_contacts FOR UPDATE TO authenticated
  USING (public.is_staff()) WITH CHECK (public.is_staff());
CREATE POLICY "client_contacts_delete" ON client_contacts FOR DELETE TO authenticated
  USING (public.is_management());

-- CLIENT_NOTES
CREATE POLICY "client_notes_select" ON client_notes FOR SELECT TO authenticated
  USING (public.is_staff());
CREATE POLICY "client_notes_insert" ON client_notes FOR INSERT TO authenticated
  WITH CHECK (public.is_staff());
CREATE POLICY "client_notes_update" ON client_notes FOR UPDATE TO authenticated
  USING (author_id = auth.uid()) WITH CHECK (author_id = auth.uid());
CREATE POLICY "client_notes_delete" ON client_notes FOR DELETE TO authenticated
  USING (public.is_management());

-- LEADS
CREATE POLICY "leads_select" ON leads FOR SELECT TO authenticated
  USING (public.is_staff());
CREATE POLICY "leads_insert" ON leads FOR INSERT TO authenticated
  WITH CHECK (public.is_staff());
CREATE POLICY "leads_update" ON leads FOR UPDATE TO authenticated
  USING (public.is_staff()) WITH CHECK (public.is_staff());
CREATE POLICY "leads_delete" ON leads FOR DELETE TO authenticated
  USING (public.is_management());

-- QUOTES
CREATE POLICY "quotes_select" ON quotes FOR SELECT TO authenticated
  USING (public.is_staff());
CREATE POLICY "quotes_insert" ON quotes FOR INSERT TO authenticated
  WITH CHECK (public.is_staff());
CREATE POLICY "quotes_update" ON quotes FOR UPDATE TO authenticated
  USING (public.is_staff()) WITH CHECK (public.is_staff());
CREATE POLICY "quotes_delete" ON quotes FOR DELETE TO authenticated
  USING (public.is_management());

-- QUOTE_ITEMS
CREATE POLICY "quote_items_select" ON quote_items FOR SELECT TO authenticated
  USING (public.is_staff());
CREATE POLICY "quote_items_insert" ON quote_items FOR INSERT TO authenticated
  WITH CHECK (public.is_staff());
CREATE POLICY "quote_items_update" ON quote_items FOR UPDATE TO authenticated
  USING (public.is_staff()) WITH CHECK (public.is_staff());
CREATE POLICY "quote_items_delete" ON quote_items FOR DELETE TO authenticated
  USING (public.is_management());

-- INVOICES
CREATE POLICY "invoices_select" ON invoices FOR SELECT TO authenticated
  USING (public.is_staff());
CREATE POLICY "invoices_insert" ON invoices FOR INSERT TO authenticated
  WITH CHECK (public.is_staff());
CREATE POLICY "invoices_update" ON invoices FOR UPDATE TO authenticated
  USING (public.is_staff()) WITH CHECK (public.is_staff());
CREATE POLICY "invoices_delete" ON invoices FOR DELETE TO authenticated
  USING (public.is_management());

-- INVOICE_ITEMS
CREATE POLICY "invoice_items_select" ON invoice_items FOR SELECT TO authenticated
  USING (public.is_staff());
CREATE POLICY "invoice_items_insert" ON invoice_items FOR INSERT TO authenticated
  WITH CHECK (public.is_staff());
CREATE POLICY "invoice_items_update" ON invoice_items FOR UPDATE TO authenticated
  USING (public.is_staff()) WITH CHECK (public.is_staff());
CREATE POLICY "invoice_items_delete" ON invoice_items FOR DELETE TO authenticated
  USING (public.is_management());

-- PAYMENTS
CREATE POLICY "payments_select" ON payments FOR SELECT TO authenticated
  USING (public.is_staff());
CREATE POLICY "payments_insert" ON payments FOR INSERT TO authenticated
  WITH CHECK (public.is_staff());
CREATE POLICY "payments_update" ON payments FOR UPDATE TO authenticated
  USING (public.can_access_finance()) WITH CHECK (public.can_access_finance());
CREATE POLICY "payments_delete" ON payments FOR DELETE TO authenticated
  USING (public.is_management());

-- PROJECTS
CREATE POLICY "projects_select" ON projects FOR SELECT TO authenticated
  USING (public.is_staff());
CREATE POLICY "projects_insert" ON projects FOR INSERT TO authenticated
  WITH CHECK (public.is_staff());
CREATE POLICY "projects_update" ON projects FOR UPDATE TO authenticated
  USING (public.is_staff()) WITH CHECK (public.is_staff());
CREATE POLICY "projects_delete" ON projects FOR DELETE TO authenticated
  USING (public.is_management());

-- PROJECT_MILESTONES
CREATE POLICY "project_milestones_select" ON project_milestones FOR SELECT TO authenticated
  USING (public.is_staff());
CREATE POLICY "project_milestones_insert" ON project_milestones FOR INSERT TO authenticated
  WITH CHECK (public.is_staff());
CREATE POLICY "project_milestones_update" ON project_milestones FOR UPDATE TO authenticated
  USING (public.is_staff()) WITH CHECK (public.is_staff());
CREATE POLICY "project_milestones_delete" ON project_milestones FOR DELETE TO authenticated
  USING (public.is_management());

-- TASKS
CREATE POLICY "tasks_select" ON tasks FOR SELECT TO authenticated
  USING (public.is_staff());
CREATE POLICY "tasks_insert" ON tasks FOR INSERT TO authenticated
  WITH CHECK (public.is_staff());
CREATE POLICY "tasks_update" ON tasks FOR UPDATE TO authenticated
  USING (public.is_staff()) WITH CHECK (public.is_staff());
CREATE POLICY "tasks_delete" ON tasks FOR DELETE TO authenticated
  USING (public.is_staff());

-- TASK_COMMENTS
CREATE POLICY "task_comments_select" ON task_comments FOR SELECT TO authenticated
  USING (public.is_staff());
CREATE POLICY "task_comments_insert" ON task_comments FOR INSERT TO authenticated
  WITH CHECK (public.is_staff());
CREATE POLICY "task_comments_update" ON task_comments FOR UPDATE TO authenticated
  USING (author_id = auth.uid()) WITH CHECK (author_id = auth.uid());
CREATE POLICY "task_comments_delete" ON task_comments FOR DELETE TO authenticated
  USING (author_id = auth.uid());

-- MEETINGS
CREATE POLICY "meetings_select" ON meetings FOR SELECT TO authenticated
  USING (public.is_staff());
CREATE POLICY "meetings_insert" ON meetings FOR INSERT TO authenticated
  WITH CHECK (public.is_staff());
CREATE POLICY "meetings_update" ON meetings FOR UPDATE TO authenticated
  USING (public.is_staff()) WITH CHECK (public.is_staff());
CREATE POLICY "meetings_delete" ON meetings FOR DELETE TO authenticated
  USING (public.is_staff());

-- DOCUMENTS
CREATE POLICY "documents_select" ON documents FOR SELECT TO authenticated
  USING (public.is_staff());
CREATE POLICY "documents_insert" ON documents FOR INSERT TO authenticated
  WITH CHECK (public.is_staff());
CREATE POLICY "documents_update" ON documents FOR UPDATE TO authenticated
  USING (public.is_staff()) WITH CHECK (public.is_staff());
CREATE POLICY "documents_delete" ON documents FOR DELETE TO authenticated
  USING (public.is_management());

-- TICKETS
CREATE POLICY "tickets_select" ON tickets FOR SELECT TO authenticated
  USING (public.is_staff());
CREATE POLICY "tickets_insert" ON tickets FOR INSERT TO authenticated
  WITH CHECK (public.is_staff());
CREATE POLICY "tickets_update" ON tickets FOR UPDATE TO authenticated
  USING (public.is_staff()) WITH CHECK (public.is_staff());
CREATE POLICY "tickets_delete" ON tickets FOR DELETE TO authenticated
  USING (public.is_management());

-- TICKET_MESSAGES
CREATE POLICY "ticket_messages_select" ON ticket_messages FOR SELECT TO authenticated
  USING (public.is_staff());
CREATE POLICY "ticket_messages_insert" ON ticket_messages FOR INSERT TO authenticated
  WITH CHECK (public.is_staff());
CREATE POLICY "ticket_messages_update" ON ticket_messages FOR UPDATE TO authenticated
  USING (author_id = auth.uid()) WITH CHECK (author_id = auth.uid());
CREATE POLICY "ticket_messages_delete" ON ticket_messages FOR DELETE TO authenticated
  USING (author_id = auth.uid());

-- ACTIVITIES (append-only audit log)
CREATE POLICY "activities_select" ON activities FOR SELECT TO authenticated
  USING (public.is_staff());
CREATE POLICY "activities_insert" ON activities FOR INSERT TO authenticated
  WITH CHECK (public.is_staff());

-- NOTIFICATIONS (user-scoped)
CREATE POLICY "notifications_select" ON notifications FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "notifications_insert" ON notifications FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "notifications_update" ON notifications FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "notifications_delete" ON notifications FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- CHANNELS
CREATE POLICY "channels_select" ON channels FOR SELECT TO authenticated
  USING (public.is_staff());
CREATE POLICY "channels_insert" ON channels FOR INSERT TO authenticated
  WITH CHECK (public.is_staff());
CREATE POLICY "channels_update" ON channels FOR UPDATE TO authenticated
  USING (public.is_management()) WITH CHECK (public.is_management());
CREATE POLICY "channels_delete" ON channels FOR DELETE TO authenticated
  USING (public.is_management());

-- MESSAGES (chat)
CREATE POLICY "messages_select" ON messages FOR SELECT TO authenticated
  USING (public.is_staff());
CREATE POLICY "messages_insert" ON messages FOR INSERT TO authenticated
  WITH CHECK (public.is_staff());
CREATE POLICY "messages_update" ON messages FOR UPDATE TO authenticated
  USING (author_id = auth.uid()) WITH CHECK (author_id = auth.uid());
CREATE POLICY "messages_delete" ON messages FOR DELETE TO authenticated
  USING (author_id = auth.uid());
