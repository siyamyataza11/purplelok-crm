export type UserRole =
  | 'super_admin'
  | 'ceo'
  | 'director'
  | 'designer'
  | 'developer'
  | 'sales'
  | 'finance'
  | 'client'
  | 'staff';

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  avatar_url: string | null;
  phone: string | null;
  position: string | null;
  role: UserRole;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface TenantOwnedRecord {
  organization_id: string;
}

export type TenantMutationInput<T extends TenantOwnedRecord> =
  Omit<T, 'organization_id'> & { organization_id?: never };

export interface Client extends TenantOwnedRecord {
  id: string;
  company_name: string;
  logo_url: string | null;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  physical_address: string | null;
  postal_address: string | null;
  company_registration: string | null;
  vat_number: string | null;
  industry: string | null;
  website: string | null;
  social_media: Record<string, string> | null;
  status: 'active' | 'inactive' | 'prospect' | 'archived';
  notes: string | null;
  tags: string[];
  favorite: boolean;
  satisfaction_score: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClientContact extends TenantOwnedRecord {
  id: string;
  client_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  position: string | null;
  is_primary: boolean;
  created_at: string;
}

export interface ClientNote extends TenantOwnedRecord {
  id: string;
  client_id: string;
  author_id: string | null;
  body: string;
  created_at: string;
  author?: Profile | null;
}

export type LeadStage = 'new_lead' | 'contacted' | 'proposal_sent' | 'negotiating' | 'won' | 'lost';

export interface Lead extends TenantOwnedRecord {
  id: string;
  company_name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  source: string | null;
  stage: LeadStage;
  lead_score: number;
  estimated_value: number;
  expected_closing_date: string | null;
  notes: string | null;
  assigned_to: string | null;
  client_id: string | null;
  created_at: string;
  updated_at: string;
  assigned_to_profile?: Profile | null;
}

export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired';

export interface Quote extends TenantOwnedRecord {
  id: string;
  quote_number: string;
  client_id: string;
  title: string;
  status: QuoteStatus;
  subtotal: number;
  discount: number;
  vat: number;
  total: number;
  vat_rate: number;
  terms: string | null;
  valid_until: string | null;
  approved_by_client: boolean;
  approved_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  client?: Client | null;
  items?: QuoteItem[];
}

export interface QuoteItem extends TenantOwnedRecord {
  id: string;
  quote_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  total: number;
  created_at: string;
}

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'partial' | 'overdue' | 'cancelled';

export interface Invoice extends TenantOwnedRecord {
  id: string;
  invoice_number: string;
  client_id: string;
  quote_id: string | null;
  title: string;
  status: InvoiceStatus;
  subtotal: number;
  discount: number;
  vat: number;
  total: number;
  vat_rate: number;
  amount_paid: number;
  balance: number;
  issue_date: string;
  due_date: string | null;
  recurring: boolean;
  recurring_interval: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  client?: Client | null;
  items?: InvoiceItem[];
}

export interface InvoiceItem extends TenantOwnedRecord {
  id: string;
  invoice_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  total: number;
  created_at: string;
}

export interface Payment extends TenantOwnedRecord {
  id: string;
  invoice_id: string;
  client_id: string;
  amount: number;
  method: string | null;
  reference: string | null;
  paid_at: string;
  created_at: string;
}

export type ProjectType = 'website' | 'printing' | 'branding' | 'email' | 'hosting' | 'other';
export type ProjectStatus = 'planning' | 'in_progress' | 'review' | 'completed' | 'on_hold' | 'cancelled';
export type ProjectHealth = 'on_track' | 'at_risk' | 'delayed' | 'completed';

export interface Project extends TenantOwnedRecord {
  id: string;
  name: string;
  client_id: string;
  type: ProjectType;
  status: ProjectStatus;
  description: string | null;
  start_date: string | null;
  due_date: string | null;
  budget: number;
  progress: number;
  health: ProjectHealth;
  assigned_to: string[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
  client?: Client | null;
  milestones?: ProjectMilestone[];
  assigned_profiles?: Profile[];
}

export interface ProjectMilestone extends TenantOwnedRecord {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  completed: boolean;
  completed_at: string | null;
  created_at: string;
}

export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';
export type TaskStatus = 'todo' | 'in_progress' | 'review' | 'done';

export interface Task extends TenantOwnedRecord {
  id: string;
  title: string;
  description: string | null;
  project_id: string | null;
  client_id: string | null;
  assigned_to: string | null;
  created_by: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  deadline: string | null;
  recurring: boolean;
  recurrence_pattern: string | null;
  created_at: string;
  updated_at: string;
  assigned_to_profile?: Profile | null;
  project?: Project | null;
  client?: Client | null;
}

export interface TaskComment extends TenantOwnedRecord {
  id: string;
  task_id: string;
  author_id: string | null;
  body: string;
  created_at: string;
  author?: Profile | null;
}

export type MeetingType = 'meeting' | 'deadline' | 'call' | 'site_visit' | 'collection' | 'launch' | 'milestone';

export interface Meeting extends TenantOwnedRecord {
  id: string;
  title: string;
  type: MeetingType;
  client_id: string | null;
  project_id: string | null;
  assigned_to: string | null;
  location: string | null;
  start_at: string | null;
  end_at: string | null;
  notes: string | null;
  status: 'scheduled' | 'completed' | 'cancelled';
  created_at: string;
  client?: Client | null;
}

export interface DocumentItem extends TenantOwnedRecord {
  id: string;
  name: string;
  type: 'file' | 'folder' | 'contract' | 'invoice' | 'quote' | 'logo' | 'image' | 'video' | 'template';
  folder_id: string | null;
  client_id: string | null;
  file_url: string | null;
  file_size: number | null;
  mime_type: string | null;
  version: number;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
  client?: Client | null;
}

export type TicketPriority = 'low' | 'medium' | 'high' | 'urgent';
export type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed';

export interface Ticket extends TenantOwnedRecord {
  id: string;
  ticket_number: string;
  subject: string;
  client_id: string | null;
  created_by: string | null;
  assigned_to: string | null;
  priority: TicketPriority;
  status: TicketStatus;
  description: string | null;
  rating: number | null;
  created_at: string;
  updated_at: string;
  client?: Client | null;
  assigned_to_profile?: Profile | null;
}

export interface TicketMessage extends TenantOwnedRecord {
  id: string;
  ticket_id: string;
  author_id: string | null;
  body: string;
  internal: boolean;
  created_at: string;
  author?: Profile | null;
}

export interface Activity extends TenantOwnedRecord {
  id: string;
  user_id: string | null;
  type: string;
  entity: string | null;
  entity_id: string | null;
  description: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
  user?: Profile | null;
}

export interface Notification extends TenantOwnedRecord {
  id: string;
  user_id: string | null;
  title: string;
  body: string | null;
  type: string;
  read: boolean;
  link: string | null;
  created_at: string;
}

export interface Channel extends TenantOwnedRecord {
  id: string;
  name: string;
  description: string | null;
  created_by: string | null;
  created_at: string;
}

export interface ChatMessage extends TenantOwnedRecord {
  id: string;
  channel_id: string;
  author_id: string | null;
  body: string;
  created_at: string;
  author?: Profile | null;
}
