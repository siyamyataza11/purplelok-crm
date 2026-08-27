/*
# Seed Demo Data for PURPLELOK CRM

## Overview
Populates the CRM with realistic demo data: clients, leads, quotes, invoices,
projects, tasks, meetings, tickets, activities, notifications, and chat channels.
Uses a DO block with individual inserts to capture UUIDs.
*/

DO $$
DECLARE
  v_admin uuid := '148803f0-322b-408e-9ffc-c9ce486172a6';
  v_c1 uuid; v_c2 uuid; v_c3 uuid; v_c4 uuid; v_c5 uuid; v_c6 uuid;
  v_q1 uuid; v_q2 uuid; v_q3 uuid;
  v_i1 uuid; v_i2 uuid; v_i3 uuid; v_i4 uuid;
  v_p1 uuid; v_p2 uuid; v_p3 uuid; v_p4 uuid;
  v_t1 uuid; v_t2 uuid;
  v_ch1 uuid; v_ch2 uuid;
BEGIN
  UPDATE profiles SET role = 'super_admin', position = 'CEO & Founder' WHERE email = 'admin@purplelok.com';

  -- CLIENTS (one at a time to capture UUIDs)
  INSERT INTO clients (company_name, contact_person, email, phone, whatsapp, physical_address, postal_address, industry, website, status, notes, tags, favorite, satisfaction_score, company_registration, vat_number)
  VALUES ('Aurora Technologies', 'Sarah Mokoena', 'sarah@auroratech.co.za', '+27 11 234 5678', '+27 82 123 4567', '123 Tech Park, Sandton, Johannesburg', 'PO Box 456, Sandton', 'Technology', 'https://auroratech.co.za', 'active', 'Long-term client, monthly maintenance contract.', ARRAY['website', 'maintenance'], true, 5, '2018/123456/07', '4567890123') RETURNING id INTO v_c1;

  INSERT INTO clients (company_name, contact_person, email, phone, whatsapp, physical_address, postal_address, industry, website, status, notes, tags, favorite, satisfaction_score, company_registration, vat_number)
  VALUES ('Summit Construction Group', 'Thabo Nkosi', 'thabo@summitbuild.co.za', '+27 21 789 0123', '+27 83 456 7890', '45 Building Road, Cape Town', 'PO Box 789, Cape Town', 'Construction', 'https://summitbuild.co.za', 'active', 'Branding and printing client.', ARRAY['branding', 'printing'], false, 4, '2016/789012/07', '7890123456') RETURNING id INTO v_c2;

  INSERT INTO clients (company_name, contact_person, email, phone, whatsapp, physical_address, postal_address, industry, website, status, notes, tags, favorite, satisfaction_score, company_registration, vat_number)
  VALUES ('Bloom Beauty Co.', 'Jessica Williams', 'jessica@bloombeauty.co.za', '+27 31 456 7890', '+27 84 567 8901', '78 Beauty Lane, Durban', 'PO Box 321, Durban', 'Beauty & Cosmetics', 'https://bloombeauty.co.za', 'active', 'Website development and ongoing SEO.', ARRAY['website', 'seo'], true, 5, '2020/345678/07', '1234567890') RETURNING id INTO v_c3;

  INSERT INTO clients (company_name, contact_person, email, phone, whatsapp, physical_address, postal_address, industry, website, status, notes, tags, favorite, satisfaction_score, company_registration, vat_number)
  VALUES ('Nexus Financial Services', 'David Chen', 'david@nexusfin.co.za', '+27 11 345 6789', '+27 85 678 9012', '90 Finance Street, Sandton', 'PO Box 654, Sandton', 'Finance', 'https://nexusfin.co.za', 'active', 'Corporate identity and email setup.', ARRAY['branding', 'email'], false, 4, '2015/567890/07', '2345678901') RETURNING id INTO v_c4;

  INSERT INTO clients (company_name, contact_person, email, phone, whatsapp, physical_address, postal_address, industry, website, status, notes, tags, favorite, satisfaction_score, company_registration, vat_number)
  VALUES ('Green Leaf Organics', 'Nomvula Dlamini', 'nomvula@greenleaf.co.za', '+27 21 567 8901', '+27 86 789 0123', '12 Organic Way, Stellenbosch', 'PO Box 987, Stellenbosch', 'Agriculture', 'https://greenleaf.co.za', 'prospect', 'Interested in website redesign and branding package.', ARRAY['website', 'branding'], false, 4, '2021/901234/07', '3456789012') RETURNING id INTO v_c5;

  INSERT INTO clients (company_name, contact_person, email, phone, whatsapp, physical_address, postal_address, industry, website, status, notes, tags, favorite, satisfaction_score, company_registration, vat_number)
  VALUES ('Urban Grind Coffee', 'Mike Peterson', 'mike@urbangrind.co.za', '+27 11 678 9012', '+27 87 890 1234', '34 Main Street, Rosebank', 'PO Box 111, Rosebank', 'Food & Beverage', 'https://urbangrind.co.za', 'active', 'Printing — business cards, flyers, and packaging.', ARRAY['printing'], false, 5, '2019/234567/07', '4567890123') RETURNING id INTO v_c6;

  -- LEADS
  INSERT INTO leads (company_name, contact_name, email, phone, source, stage, lead_score, estimated_value, expected_closing_date, notes, assigned_to) VALUES
  ('Pinnacle Properties', 'John Matthews', 'john@pinnacleprop.co.za', '+27 11 111 2222', 'Referral', 'new_lead', 75, 85000, '2026-08-15', 'Large property group — needs full website redesign and branding.', v_admin),
  ('Skyline Logistics', 'Aisha Patel', 'aisha@skylinelog.co.za', '+27 21 222 3333', 'Website', 'contacted', 60, 45000, '2026-08-30', 'Logistics company — interested in website and hosting.', v_admin),
  ('Vertex Architects', 'Robert Smith', 'robert@vertexarch.co.za', '+27 31 333 4444', 'LinkedIn', 'proposal_sent', 80, 120000, '2026-08-10', 'Architecture firm — branding, website, and printing package.', v_admin),
  ('Metro Health Clinic', 'Dr. Linda Mthembu', 'linda@metrohealth.co.za', '+27 11 444 5555', 'Google Ads', 'negotiating', 85, 95000, '2026-08-05', 'Health clinic — website, SEO, and ongoing maintenance.', v_admin),
  ('Apex Mining Corp', 'Sipho Zulu', 'sipho@apexmining.co.za', '+27 21 555 6666', 'Referral', 'won', 90, 150000, '2026-07-20', 'Mining company — full corporate identity and website. Won!', v_admin),
  ('QuickFix Plumbing', 'Peter Brown', 'peter@quickfix.co.za', '+27 31 666 7777', 'Cold call', 'lost', 30, 15000, '2026-06-30', 'Small plumbing business — went with competitor due to budget.', v_admin);

  -- QUOTES
  INSERT INTO quotes (quote_number, client_id, title, status, subtotal, discount, vat, total, vat_rate, terms, valid_until, created_by) VALUES
  ('QUO-2026-0001', v_c1, 'Website Redesign & Development', 'accepted', 65000, 5000, 9000, 69000, 15, '50% deposit to commence. Balance on completion. Prices valid for 30 days.', '2026-08-30', v_admin) RETURNING id INTO v_q1;

  INSERT INTO quotes (quote_number, client_id, title, status, subtotal, discount, vat, total, vat_rate, terms, valid_until, created_by) VALUES
  ('QUO-2026-0002', v_c5, 'Branding & Website Package', 'sent', 48000, 0, 7200, 55200, 15, '50% deposit required. Project timeline: 6-8 weeks.', '2026-09-15', v_admin) RETURNING id INTO v_q2;

  INSERT INTO quotes (quote_number, client_id, title, status, subtotal, discount, vat, total, vat_rate, terms, valid_until, created_by) VALUES
  ('QUO-2026-0003', v_c2, 'Corporate Stationery Printing', 'draft', 12500, 0, 1875, 14375, 15, 'Payment on delivery. Prices valid for 14 days.', '2026-08-14', v_admin) RETURNING id INTO v_q3;

  INSERT INTO quote_items (quote_id, description, quantity, unit_price, total) VALUES
  (v_q1, 'UI/UX Design (5 pages)', 1, 18000, 18000),
  (v_q1, 'Frontend Development (React)', 1, 25000, 25000),
  (v_q1, 'Backend Development & CMS', 1, 15000, 15000),
  (v_q1, 'SEO Optimization', 1, 7000, 7000),
  (v_q2, 'Logo Design & Brand Guidelines', 1, 15000, 15000),
  (v_q2, 'Website Development (5 pages)', 1, 25000, 25000),
  (v_q2, 'Social Media Kit', 1, 8000, 8000),
  (v_q3, 'Business Cards (500x)', 1, 2500, 2500),
  (v_q3, 'Letterheads (1000x)', 1, 3500, 3500),
  (v_q3, 'Flyers (2000x A5)', 1, 4000, 4000),
  (v_q3, 'Compliment Slips (500x)', 1, 2500, 2500);

  -- INVOICES
  INSERT INTO invoices (invoice_number, client_id, title, status, subtotal, discount, vat, total, vat_rate, amount_paid, balance, issue_date, due_date, created_by) VALUES
  ('INV-2026-0001', v_c1, 'Website Redesign — Deposit', 'paid', 34500, 0, 5175, 39675, 15, 39675, 0, '2026-07-01', '2026-07-15', v_admin) RETURNING id INTO v_i1;

  INSERT INTO invoices (invoice_number, client_id, title, status, subtotal, discount, vat, total, vat_rate, amount_paid, balance, issue_date, due_date, created_by) VALUES
  ('INV-2026-0002', v_c3, 'Website Development & SEO', 'partial', 35000, 0, 5250, 40250, 15, 20000, 20250, '2026-07-10', '2026-07-25', v_admin) RETURNING id INTO v_i2;

  INSERT INTO invoices (invoice_number, client_id, title, status, subtotal, discount, vat, total, vat_rate, amount_paid, balance, issue_date, due_date, created_by) VALUES
  ('INV-2026-0003', v_c6, 'Printing — Business Cards & Flyers', 'sent', 12500, 0, 1875, 14375, 15, 0, 14375, '2026-07-20', '2026-08-03', v_admin) RETURNING id INTO v_i3;

  INSERT INTO invoices (invoice_number, client_id, title, status, subtotal, discount, vat, total, vat_rate, amount_paid, balance, issue_date, due_date, created_by) VALUES
  ('INV-2026-0004', v_c2, 'Corporate Identity Package', 'overdue', 28000, 0, 4200, 32200, 15, 0, 32200, '2026-06-15', '2026-06-30', v_admin) RETURNING id INTO v_i4;

  INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, total) VALUES
  (v_i1, 'UI/UX Design (50% deposit)', 1, 9000, 9000),
  (v_i1, 'Frontend Development (50% deposit)', 1, 12500, 12500),
  (v_i1, 'Backend Development (50% deposit)', 1, 7500, 7500),
  (v_i1, 'SEO (50% deposit)', 1, 3500, 3500),
  (v_i2, 'Website Development', 1, 25000, 25000),
  (v_i2, 'SEO Optimization', 1, 10000, 10000),
  (v_i3, 'Business Cards (500x)', 1, 2500, 2500),
  (v_i3, 'Flyers (2000x A5)', 1, 4000, 4000),
  (v_i3, 'Compliment Slips (500x)', 1, 2500, 2500),
  (v_i3, 'Letterheads (1000x)', 1, 3500, 3500),
  (v_i4, 'Logo Design', 1, 10000, 10000),
  (v_i4, 'Brand Guidelines', 1, 8000, 8000),
  (v_i4, 'Email Signatures', 1, 5000, 5000),
  (v_i4, 'Social Media Kit', 1, 5000, 5000);

  -- PAYMENTS
  INSERT INTO payments (invoice_id, client_id, amount, method, reference, paid_at) VALUES
  (v_i1, v_c1, 39675, 'EFT', 'EFT-AURORA-001', '2026-07-12T10:00:00Z'),
  (v_i2, v_c3, 20000, 'PayFast', 'PAYFAST-BLOOM-001', '2026-07-15T14:30:00Z'),
  (v_i1, v_c1, 15000, 'EFT', 'EFT-AURORA-002', now() - interval '2 hours');

  -- PROJECTS
  INSERT INTO projects (name, client_id, type, status, description, start_date, due_date, budget, progress, health, assigned_to, created_by) VALUES
  ('Aurora Tech Website Redesign', v_c1, 'website', 'in_progress', 'Complete website redesign with React frontend, CMS backend, and SEO optimization.', '2026-07-01', '2026-08-15', 69000, 65, 'on_track', ARRAY[v_admin], v_admin) RETURNING id INTO v_p1;

  INSERT INTO projects (name, client_id, type, status, description, start_date, due_date, budget, progress, health, assigned_to, created_by) VALUES
  ('Bloom Beauty SEO Campaign', v_c3, 'website', 'in_progress', 'Ongoing SEO optimization and content strategy for Bloom Beauty.', '2026-07-10', '2026-09-10', 40250, 40, 'at_risk', ARRAY[v_admin], v_admin) RETURNING id INTO v_p2;

  INSERT INTO projects (name, client_id, type, status, description, start_date, due_date, budget, progress, health, assigned_to, created_by) VALUES
  ('Summit Construction Stationery', v_c2, 'printing', 'review', 'Business cards, letterheads, flyers, and compliment slips for Summit Construction.', '2026-07-15', '2026-07-28', 14375, 85, 'on_track', ARRAY[v_admin], v_admin) RETURNING id INTO v_p3;

  INSERT INTO projects (name, client_id, type, status, description, start_date, due_date, budget, progress, health, assigned_to, created_by) VALUES
  ('Nexus Financial Corporate Identity', v_c4, 'branding', 'completed', 'Full corporate identity package including logo, brand guidelines, email signatures, and social media kit.', '2026-05-01', '2026-06-30', 32200, 100, 'completed', ARRAY[v_admin], v_admin) RETURNING id INTO v_p4;

  INSERT INTO project_milestones (project_id, title, due_date, completed) VALUES
  (v_p1, 'Discovery & Requirements', '2026-07-05', true),
  (v_p1, 'UI/UX Design', '2026-07-15', true),
  (v_p1, 'Frontend Development', '2026-07-30', false),
  (v_p1, 'Backend & CMS', '2026-08-05', false),
  (v_p1, 'Testing & Launch', '2026-08-14', false),
  (v_p2, 'SEO Audit', '2026-07-15', true),
  (v_p2, 'Keyword Research', '2026-07-25', false),
  (v_p2, 'Content Optimization', '2026-08-15', false),
  (v_p3, 'Design Approval', '2026-07-18', true),
  (v_p3, 'Printing', '2026-07-25', true),
  (v_p3, 'Quality Check & Delivery', '2026-07-28', false);

  -- TASKS
  INSERT INTO tasks (title, description, project_id, client_id, assigned_to, created_by, priority, status, deadline) VALUES
  ('Complete Aurora frontend development', 'Finish React components and integrate with API.', v_p1, v_c1, v_admin, v_admin, 'high', 'in_progress', '2026-07-30'),
  ('Review Summit stationery proofs', 'Quality check printed proofs before final run.', v_p3, v_c2, v_admin, v_admin, 'urgent', 'review', '2026-07-28'),
  ('Send Bloom Beauty SEO report', 'Compile and send monthly SEO performance report.', v_p2, v_c3, v_admin, v_admin, 'medium', 'todo', '2026-07-31'),
  ('Follow up on Summit overdue invoice', 'Contact Thabo about INV-2026-0004 payment.', NULL, v_c2, v_admin, v_admin, 'urgent', 'todo', '2026-07-28'),
  ('Prepare Green Leaf proposal', 'Draft quotation for website redesign and branding package.', NULL, v_c5, v_admin, v_admin, 'high', 'todo', '2026-08-02');

  -- MEETINGS
  INSERT INTO meetings (title, type, client_id, assigned_to, location, start_at, end_at, notes, status) VALUES
  ('Aurora Tech — Design Review', 'meeting', v_c1, v_admin, 'Zoom', now() + interval '2 days', now() + interval '2 days' + interval '1 hour', 'Review final UI designs with Sarah.', 'scheduled'),
  ('Summit Construction — Printing Collection', 'collection', v_c2, v_admin, 'PURPLELOK Office', now() + interval '1 day', now() + interval '1 day' + interval '30 minutes', 'Client collecting printed stationery.', 'scheduled'),
  ('Bloom Beauty — Monthly Check-in', 'call', v_c3, v_admin, 'Phone', now() + interval '5 days', now() + interval '5 days' + interval '30 minutes', 'Monthly performance call with Jessica.', 'scheduled');

  -- TICKETS
  INSERT INTO tickets (ticket_number, subject, client_id, created_by, assigned_to, priority, status, description) VALUES
  ('TKT-2026-0001', 'Website loading slowly on mobile', v_c1, v_admin, v_admin, 'high', 'in_progress', 'Aurora Tech reports the website is loading slowly on mobile devices. Need to optimize images and check performance.') RETURNING id INTO v_t1;

  INSERT INTO tickets (ticket_number, subject, client_id, created_by, assigned_to, priority, status, description) VALUES
  ('TKT-2026-0002', 'Email setup assistance needed', v_c4, v_admin, v_admin, 'medium', 'open', 'Nexus Financial needs help configuring Outlook with their new email accounts.') RETURNING id INTO v_t2;

  INSERT INTO ticket_messages (ticket_id, author_id, body, internal) VALUES
  (v_t1, v_admin, 'We are investigating the mobile performance issue. Will optimize images and minify CSS/JS.', false),
  (v_t1, v_admin, 'Need to check if Cloudflare caching is properly configured.', true),
  (v_t2, v_admin, 'I''ll send you the Outlook setup guide and schedule a call to walk you through it.', false);

  -- ACTIVITIES
  INSERT INTO activities (user_id, type, entity, description, created_at) VALUES
  (v_admin, 'client_created', 'client', 'created client "Aurora Technologies"', now() - interval '30 days'),
  (v_admin, 'quote_created', 'quote', 'created quote QUO-2026-0001 for Aurora Technologies', now() - interval '25 days'),
  (v_admin, 'project_created', 'project', 'created project "Aurora Tech Website Redesign"', now() - interval '20 days'),
  (v_admin, 'invoice_created', 'invoice', 'created invoice INV-2026-0001', now() - interval '27 days'),
  (v_admin, 'payment_received', 'payment', 'recorded payment of R39,675 from Aurora Technologies', now() - interval '16 days');

  -- NOTIFICATIONS
  INSERT INTO notifications (user_id, title, body, type, read) VALUES
  (v_admin, 'Payment received', 'Aurora Technologies paid R39,675 for INV-2026-0001', 'success', false),
  (v_admin, 'Invoice overdue', 'INV-2026-0004 for Summit Construction is overdue', 'warning', false),
  (v_admin, 'New ticket', 'TKT-2026-0002: Email setup assistance needed from Nexus Financial', 'info', true);

  -- CHANNELS & MESSAGES
  INSERT INTO channels (name, description, created_by) VALUES
  ('general', 'General team chat', v_admin) RETURNING id INTO v_ch1;

  INSERT INTO channels (name, description, created_by) VALUES
  ('projects', 'Project discussions', v_admin) RETURNING id INTO v_ch2;

  INSERT INTO messages (channel_id, author_id, body) VALUES
  (v_ch1, v_admin, 'Welcome to PURPLELOK Command Center! This is the general team channel.'),
  (v_ch1, v_admin, 'Don''t forget the Aurora design review meeting in 2 days.'),
  (v_ch2, v_admin, 'Aurora Tech website is 65% complete — on track for August 15 launch.');

END $$;
