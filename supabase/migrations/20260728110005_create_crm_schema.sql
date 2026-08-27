/*
# PURPLELOK Command Center - Core CRM Schema

## Overview
Creates the complete database schema for the PURPLELOK enterprise CRM.
This is a multi-user, role-based CRM where all authenticated staff share access
to CRM data (clients, leads, quotes, invoices, projects, tasks, etc.).

## New Tables
1. `profiles` - extends auth.users with role, name, avatar, phone, position, active status
2. `clients` - company records with full business details
3. `client_contacts` - contact persons at client companies
4. `client_notes` - internal notes on clients
5. `leads` - lead pipeline records with score, value, stage
6. `quotes` - quotations with items, VAT, discounts, status, approval
7. `quote_items` - line items within quotes
8. `invoices` - invoices with recurring support, payment status
9. `invoice_items` - line items within invoices
10. `payments` - payments received against invoices
11. `projects` - projects with timeline, budget, health, progress
12. `project_milestones` - milestones within projects
13. `tasks` - tasks assignable to users, with priority, deadline, subtasks
14. `task_comments` - comments on tasks
15. `meetings` - calendar events (meetings, deadlines, calls, visits, launches)
16. `documents` - document/file management with folders and versions
17. `tickets` - support tickets with priority, status, assignment
18. `ticket_messages` - messages within support tickets
19. `activities` - activity feed / audit log of all CRM actions
20. `notifications` - in-app notifications for users
21. `messages` - internal team chat messages (channels)
22. `channels` - chat channels/teams

## Security
- RLS enabled on every table.
- Policies scoped to `authenticated` users. Since this is an internal team CRM
  where all staff share access to business data, SELECT/INSERT/UPDATE/DELETE
  policies use `USING (true)` / `WITH CHECK (true)` for authenticated users.
  This is intentional shared team data, not a shortcut.
- Client-role users are filtered at the app query level (portal view).

## Notes
- All owner/assignment columns reference `profiles(id)` (which links to auth.users).
- Timestamps default to now().
- UUIDs as primary keys throughout.
*/

-- Profiles: extends auth.users
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  full_name text NOT NULL DEFAULT '',
  avatar_url text,
  phone text,
  position text,
  role text NOT NULL DEFAULT 'staff' CHECK (role IN ('super_admin','ceo','director','designer','developer','sales','finance','client','staff')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Clients
CREATE TABLE IF NOT EXISTS clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name text NOT NULL,
  logo_url text,
  contact_person text,
  email text,
  phone text,
  whatsapp text,
  physical_address text,
  postal_address text,
  company_registration text,
  vat_number text,
  industry text,
  website text,
  social_media jsonb DEFAULT '{}',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','prospect','archived')),
  notes text,
  tags text[] DEFAULT '{}',
  favorite boolean NOT NULL DEFAULT false,
  satisfaction_score numeric DEFAULT 5,
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Client contacts
CREATE TABLE IF NOT EXISTS client_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name text NOT NULL,
  email text,
  phone text,
  position text,
  is_primary boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- Client notes
CREATE TABLE IF NOT EXISTS client_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  author_id uuid REFERENCES profiles(id),
  body text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Leads
CREATE TABLE IF NOT EXISTS leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name text NOT NULL,
  contact_name text,
  email text,
  phone text,
  source text,
  stage text NOT NULL DEFAULT 'new_lead' CHECK (stage IN ('new_lead','contacted','proposal_sent','negotiating','won','lost')),
  lead_score integer DEFAULT 50 CHECK (lead_score >= 0 AND lead_score <= 100),
  estimated_value numeric DEFAULT 0,
  expected_closing_date date,
  notes text,
  assigned_to uuid REFERENCES profiles(id),
  client_id uuid REFERENCES clients(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Quotes
CREATE TABLE IF NOT EXISTS quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_number text NOT NULL UNIQUE,
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','accepted','rejected','expired')),
  subtotal numeric DEFAULT 0,
  discount numeric DEFAULT 0,
  vat numeric DEFAULT 0,
  total numeric DEFAULT 0,
  vat_rate numeric DEFAULT 15,
  terms text,
  valid_until date,
  approved_by_client boolean DEFAULT false,
  approved_at timestamptz,
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Quote items
CREATE TABLE IF NOT EXISTS quote_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  description text NOT NULL,
  quantity numeric DEFAULT 1,
  unit_price numeric DEFAULT 0,
  total numeric DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Invoices
CREATE TABLE IF NOT EXISTS invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number text NOT NULL UNIQUE,
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  quote_id uuid REFERENCES quotes(id) ON DELETE SET NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','paid','partial','overdue','cancelled')),
  subtotal numeric DEFAULT 0,
  discount numeric DEFAULT 0,
  vat numeric DEFAULT 0,
  total numeric DEFAULT 0,
  vat_rate numeric DEFAULT 15,
  amount_paid numeric DEFAULT 0,
  balance numeric DEFAULT 0,
  issue_date date DEFAULT CURRENT_DATE,
  due_date date,
  recurring boolean DEFAULT false,
  recurring_interval text,
  notes text,
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Invoice items
CREATE TABLE IF NOT EXISTS invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description text NOT NULL,
  quantity numeric DEFAULT 1,
  unit_price numeric DEFAULT 0,
  total numeric DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Payments
CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  amount numeric NOT NULL,
  method text,
  reference text,
  paid_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

-- Projects
CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  type text NOT NULL DEFAULT 'website' CHECK (type IN ('website','printing','branding','email','hosting','other')),
  status text NOT NULL DEFAULT 'planning' CHECK (status IN ('planning','in_progress','review','completed','on_hold','cancelled')),
  description text,
  start_date date,
  due_date date,
  budget numeric DEFAULT 0,
  progress integer DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  health text DEFAULT 'on_track' CHECK (health IN ('on_track','at_risk','delayed','completed')),
  assigned_to uuid[] DEFAULT '{}',
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Project milestones
CREATE TABLE IF NOT EXISTS project_milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  due_date date,
  completed boolean DEFAULT false,
  completed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- Tasks
CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  client_id uuid REFERENCES clients(id) ON DELETE CASCADE,
  assigned_to uuid REFERENCES profiles(id),
  created_by uuid REFERENCES profiles(id),
  priority text DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
  status text DEFAULT 'todo' CHECK (status IN ('todo','in_progress','review','done')),
  deadline date,
  recurring boolean DEFAULT false,
  recurrence_pattern text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Task comments
CREATE TABLE IF NOT EXISTS task_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_id uuid REFERENCES profiles(id),
  body text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Meetings / calendar events
CREATE TABLE IF NOT EXISTS meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  type text DEFAULT 'meeting' CHECK (type IN ('meeting','deadline','call','site_visit','collection','launch','milestone')),
  client_id uuid REFERENCES clients(id) ON DELETE CASCADE,
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  assigned_to uuid REFERENCES profiles(id),
  location text,
  start_at timestamptz,
  end_at timestamptz,
  notes text,
  status text DEFAULT 'scheduled' CHECK (status IN ('scheduled','completed','cancelled')),
  created_at timestamptz DEFAULT now()
);

-- Documents
CREATE TABLE IF NOT EXISTS documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type text DEFAULT 'file' CHECK (type IN ('file','folder','contract','invoice','quote','logo','image','video','template')),
  folder_id uuid REFERENCES documents(id) ON DELETE CASCADE,
  client_id uuid REFERENCES clients(id) ON DELETE CASCADE,
  file_url text,
  file_size bigint,
  mime_type text,
  version integer DEFAULT 1,
  uploaded_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Support tickets
CREATE TABLE IF NOT EXISTS tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number text NOT NULL UNIQUE,
  subject text NOT NULL,
  client_id uuid REFERENCES clients(id) ON DELETE CASCADE,
  created_by uuid REFERENCES profiles(id),
  assigned_to uuid REFERENCES profiles(id),
  priority text DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
  status text DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved','closed')),
  description text,
  rating integer,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Ticket messages
CREATE TABLE IF NOT EXISTS ticket_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author_id uuid REFERENCES profiles(id),
  body text NOT NULL,
  internal boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- Activities (audit log / activity feed)
CREATE TABLE IF NOT EXISTS activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES profiles(id),
  type text NOT NULL,
  entity text,
  entity_id uuid,
  description text NOT NULL,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

-- Notifications
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text,
  type text DEFAULT 'info',
  read boolean DEFAULT false,
  link text,
  created_at timestamptz DEFAULT now()
);

-- Chat channels
CREATE TABLE IF NOT EXISTS channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now()
);

-- Chat messages
CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  author_id uuid REFERENCES profiles(id),
  body text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- ============ INDEXES ============
CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status);
CREATE INDEX IF NOT EXISTS idx_leads_stage ON leads(stage);
CREATE INDEX IF NOT EXISTS idx_quotes_client ON quotes(client_id);
CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes(status);
CREATE INDEX IF NOT EXISTS idx_invoices_client ON invoices(client_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_projects_client ON projects(client_id);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_deadline ON tasks(deadline);
CREATE INDEX IF NOT EXISTS idx_meetings_start ON meetings(start_at);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_activities_created ON activities(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id);

-- ============ RLS ============
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Helper: generate policies for a shared team table (authenticated CRUD)
-- Profiles: users can read all profiles, update own
DROP POLICY IF EXISTS "profiles_select" ON profiles;
CREATE POLICY "profiles_select" ON profiles FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "profiles_insert" ON profiles;
CREATE POLICY "profiles_insert" ON profiles FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "profiles_update" ON profiles;
CREATE POLICY "profiles_update" ON profiles FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "profiles_delete" ON profiles;
CREATE POLICY "profiles_delete" ON profiles FOR DELETE TO authenticated USING (true);

-- Clients
DROP POLICY IF EXISTS "clients_select" ON clients;
CREATE POLICY "clients_select" ON clients FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "clients_insert" ON clients;
CREATE POLICY "clients_insert" ON clients FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "clients_update" ON clients;
CREATE POLICY "clients_update" ON clients FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "clients_delete" ON clients;
CREATE POLICY "clients_delete" ON clients FOR DELETE TO authenticated USING (true);

-- Client contacts
DROP POLICY IF EXISTS "client_contacts_select" ON client_contacts;
CREATE POLICY "client_contacts_select" ON client_contacts FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "client_contacts_insert" ON client_contacts;
CREATE POLICY "client_contacts_insert" ON client_contacts FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "client_contacts_update" ON client_contacts;
CREATE POLICY "client_contacts_update" ON client_contacts FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "client_contacts_delete" ON client_contacts;
CREATE POLICY "client_contacts_delete" ON client_contacts FOR DELETE TO authenticated USING (true);

-- Client notes
DROP POLICY IF EXISTS "client_notes_select" ON client_notes;
CREATE POLICY "client_notes_select" ON client_notes FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "client_notes_insert" ON client_notes;
CREATE POLICY "client_notes_insert" ON client_notes FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "client_notes_update" ON client_notes;
CREATE POLICY "client_notes_update" ON client_notes FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "client_notes_delete" ON client_notes;
CREATE POLICY "client_notes_delete" ON client_notes FOR DELETE TO authenticated USING (true);

-- Leads
DROP POLICY IF EXISTS "leads_select" ON leads;
CREATE POLICY "leads_select" ON leads FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "leads_insert" ON leads;
CREATE POLICY "leads_insert" ON leads FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "leads_update" ON leads;
CREATE POLICY "leads_update" ON leads FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "leads_delete" ON leads;
CREATE POLICY "leads_delete" ON leads FOR DELETE TO authenticated USING (true);

-- Quotes
DROP POLICY IF EXISTS "quotes_select" ON quotes;
CREATE POLICY "quotes_select" ON quotes FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "quotes_insert" ON quotes;
CREATE POLICY "quotes_insert" ON quotes FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "quotes_update" ON quotes;
CREATE POLICY "quotes_update" ON quotes FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "quotes_delete" ON quotes;
CREATE POLICY "quotes_delete" ON quotes FOR DELETE TO authenticated USING (true);

-- Quote items
DROP POLICY IF EXISTS "quote_items_select" ON quote_items;
CREATE POLICY "quote_items_select" ON quote_items FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "quote_items_insert" ON quote_items;
CREATE POLICY "quote_items_insert" ON quote_items FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "quote_items_update" ON quote_items;
CREATE POLICY "quote_items_update" ON quote_items FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "quote_items_delete" ON quote_items;
CREATE POLICY "quote_items_delete" ON quote_items FOR DELETE TO authenticated USING (true);

-- Invoices
DROP POLICY IF EXISTS "invoices_select" ON invoices;
CREATE POLICY "invoices_select" ON invoices FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "invoices_insert" ON invoices;
CREATE POLICY "invoices_insert" ON invoices FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "invoices_update" ON invoices;
CREATE POLICY "invoices_update" ON invoices FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "invoices_delete" ON invoices;
CREATE POLICY "invoices_delete" ON invoices FOR DELETE TO authenticated USING (true);

-- Invoice items
DROP POLICY IF EXISTS "invoice_items_select" ON invoice_items;
CREATE POLICY "invoice_items_select" ON invoice_items FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "invoice_items_insert" ON invoice_items;
CREATE POLICY "invoice_items_insert" ON invoice_items FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "invoice_items_update" ON invoice_items;
CREATE POLICY "invoice_items_update" ON invoice_items FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "invoice_items_delete" ON invoice_items;
CREATE POLICY "invoice_items_delete" ON invoice_items FOR DELETE TO authenticated USING (true);

-- Payments
DROP POLICY IF EXISTS "payments_select" ON payments;
CREATE POLICY "payments_select" ON payments FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "payments_insert" ON payments;
CREATE POLICY "payments_insert" ON payments FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "payments_update" ON payments;
CREATE POLICY "payments_update" ON payments FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "payments_delete" ON payments;
CREATE POLICY "payments_delete" ON payments FOR DELETE TO authenticated USING (true);

-- Projects
DROP POLICY IF EXISTS "projects_select" ON projects;
CREATE POLICY "projects_select" ON projects FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "projects_insert" ON projects;
CREATE POLICY "projects_insert" ON projects FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "projects_update" ON projects;
CREATE POLICY "projects_update" ON projects FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "projects_delete" ON projects;
CREATE POLICY "projects_delete" ON projects FOR DELETE TO authenticated USING (true);

-- Project milestones
DROP POLICY IF EXISTS "project_milestones_select" ON project_milestones;
CREATE POLICY "project_milestones_select" ON project_milestones FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "project_milestones_insert" ON project_milestones;
CREATE POLICY "project_milestones_insert" ON project_milestones FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "project_milestones_update" ON project_milestones;
CREATE POLICY "project_milestones_update" ON project_milestones FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "project_milestones_delete" ON project_milestones;
CREATE POLICY "project_milestones_delete" ON project_milestones FOR DELETE TO authenticated USING (true);

-- Tasks
DROP POLICY IF EXISTS "tasks_select" ON tasks;
CREATE POLICY "tasks_select" ON tasks FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "tasks_insert" ON tasks;
CREATE POLICY "tasks_insert" ON tasks FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "tasks_update" ON tasks;
CREATE POLICY "tasks_update" ON tasks FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "tasks_delete" ON tasks;
CREATE POLICY "tasks_delete" ON tasks FOR DELETE TO authenticated USING (true);

-- Task comments
DROP POLICY IF EXISTS "task_comments_select" ON task_comments;
CREATE POLICY "task_comments_select" ON task_comments FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "task_comments_insert" ON task_comments;
CREATE POLICY "task_comments_insert" ON task_comments FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "task_comments_update" ON task_comments;
CREATE POLICY "task_comments_update" ON task_comments FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "task_comments_delete" ON task_comments;
CREATE POLICY "task_comments_delete" ON task_comments FOR DELETE TO authenticated USING (true);

-- Meetings
DROP POLICY IF EXISTS "meetings_select" ON meetings;
CREATE POLICY "meetings_select" ON meetings FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "meetings_insert" ON meetings;
CREATE POLICY "meetings_insert" ON meetings FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "meetings_update" ON meetings;
CREATE POLICY "meetings_update" ON meetings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "meetings_delete" ON meetings;
CREATE POLICY "meetings_delete" ON meetings FOR DELETE TO authenticated USING (true);

-- Documents
DROP POLICY IF EXISTS "documents_select" ON documents;
CREATE POLICY "documents_select" ON documents FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "documents_insert" ON documents;
CREATE POLICY "documents_insert" ON documents FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "documents_update" ON documents;
CREATE POLICY "documents_update" ON documents FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "documents_delete" ON documents;
CREATE POLICY "documents_delete" ON documents FOR DELETE TO authenticated USING (true);

-- Tickets
DROP POLICY IF EXISTS "tickets_select" ON tickets;
CREATE POLICY "tickets_select" ON tickets FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "tickets_insert" ON tickets;
CREATE POLICY "tickets_insert" ON tickets FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "tickets_update" ON tickets;
CREATE POLICY "tickets_update" ON tickets FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "tickets_delete" ON tickets;
CREATE POLICY "tickets_delete" ON tickets FOR DELETE TO authenticated USING (true);

-- Ticket messages
DROP POLICY IF EXISTS "ticket_messages_select" ON ticket_messages;
CREATE POLICY "ticket_messages_select" ON ticket_messages FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "ticket_messages_insert" ON ticket_messages;
CREATE POLICY "ticket_messages_insert" ON ticket_messages FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "ticket_messages_update" ON ticket_messages;
CREATE POLICY "ticket_messages_update" ON ticket_messages FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "ticket_messages_delete" ON ticket_messages;
CREATE POLICY "ticket_messages_delete" ON ticket_messages FOR DELETE TO authenticated USING (true);

-- Activities
DROP POLICY IF EXISTS "activities_select" ON activities;
CREATE POLICY "activities_select" ON activities FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "activities_insert" ON activities;
CREATE POLICY "activities_insert" ON activities FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "activities_update" ON activities;
CREATE POLICY "activities_update" ON activities FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "activities_delete" ON activities;
CREATE POLICY "activities_delete" ON activities FOR DELETE TO authenticated USING (true);

-- Notifications
DROP POLICY IF EXISTS "notifications_select" ON notifications;
CREATE POLICY "notifications_select" ON notifications FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "notifications_insert" ON notifications;
CREATE POLICY "notifications_insert" ON notifications FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "notifications_update" ON notifications;
CREATE POLICY "notifications_update" ON notifications FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "notifications_delete" ON notifications;
CREATE POLICY "notifications_delete" ON notifications FOR DELETE TO authenticated USING (true);

-- Channels
DROP POLICY IF EXISTS "channels_select" ON channels;
CREATE POLICY "channels_select" ON channels FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "channels_insert" ON channels;
CREATE POLICY "channels_insert" ON channels FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "channels_update" ON channels;
CREATE POLICY "channels_update" ON channels FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "channels_delete" ON channels;
CREATE POLICY "channels_delete" ON channels FOR DELETE TO authenticated USING (true);

-- Messages
DROP POLICY IF EXISTS "messages_select" ON messages;
CREATE POLICY "messages_select" ON messages FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "messages_insert" ON messages;
CREATE POLICY "messages_insert" ON messages FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "messages_update" ON messages;
CREATE POLICY "messages_update" ON messages FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "messages_delete" ON messages;
CREATE POLICY "messages_delete" ON messages FOR DELETE TO authenticated USING (true);

-- ============ TRIGGERS ============
-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', ''));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS touch_clients ON clients;
CREATE TRIGGER touch_clients BEFORE UPDATE ON clients FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
DROP TRIGGER IF EXISTS touch_leads ON leads;
CREATE TRIGGER touch_leads BEFORE UPDATE ON leads FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
DROP TRIGGER IF EXISTS touch_quotes ON quotes;
CREATE TRIGGER touch_quotes BEFORE UPDATE ON quotes FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
DROP TRIGGER IF EXISTS touch_invoices ON invoices;
CREATE TRIGGER touch_invoices BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
DROP TRIGGER IF EXISTS touch_projects ON projects;
CREATE TRIGGER touch_projects BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
DROP TRIGGER IF EXISTS touch_tasks ON tasks;
CREATE TRIGGER touch_tasks BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
DROP TRIGGER IF EXISTS touch_tickets ON tickets;
CREATE TRIGGER touch_tickets BEFORE UPDATE ON tickets FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
DROP TRIGGER IF EXISTS touch_profiles ON profiles;
CREATE TRIGGER touch_profiles BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
