/*
# Batch 1: Multi-tenant identity and RBAC foundation

This migration is intentionally additive. It does not assign existing users to
organizations, seed organization-scoped roles, or change any existing CRM
table, policy, function, grant, or data.
*/

-- ============ TENANT IDENTITY ============

CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organizations_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT organizations_slug_format CHECK (
    slug IS NULL OR slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  ),
  CONSTRAINT organizations_slug_key UNIQUE (slug),
  CONSTRAINT organizations_status_check CHECK (
    status IN ('active', 'suspended', 'archived')
  )
);

CREATE TABLE organization_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  user_id uuid NOT NULL,
  job_title text,
  status text NOT NULL DEFAULT 'invited',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_members_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT organization_members_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT organization_members_job_title_not_blank CHECK (
    job_title IS NULL OR btrim(job_title) <> ''
  ),
  CONSTRAINT organization_members_status_check CHECK (
    status IN ('invited', 'active', 'suspended', 'removed')
  ),
  CONSTRAINT organization_members_organization_user_key
    UNIQUE (organization_id, user_id),
  CONSTRAINT organization_members_id_organization_key
    UNIQUE (id, organization_id)
);

-- The organization/user unique index supports organization membership lookups.
CREATE INDEX idx_organization_members_user_id
  ON organization_members(user_id);

-- ============ CAPABILITY CATALOGUE ============

CREATE TABLE permissions (
  key text PRIMARY KEY,
  description text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT permissions_key_format CHECK (
    key ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'
  ),
  CONSTRAINT permissions_description_not_blank CHECK (btrim(description) <> '')
);

INSERT INTO permissions (key, description) VALUES
  ('members.read', 'View organization members'),
  ('members.manage', 'Invite, suspend, remove, and manage organization members'),
  ('roles.read', 'View organization roles and their permissions'),
  ('roles.manage', 'Create and manage organization roles and permission mappings'),
  ('clients.read', 'View clients'),
  ('clients.write', 'Create and modify clients'),
  ('leads.read', 'View leads'),
  ('leads.write', 'Create and modify leads'),
  ('projects.read', 'View projects'),
  ('projects.write', 'Create and modify project content'),
  ('projects.manage', 'Manage project lifecycle and assignments'),
  ('tasks.read', 'View tasks'),
  ('tasks.write', 'Create and modify tasks'),
  ('quotes.read', 'View quotes'),
  ('quotes.write', 'Create and modify quotes'),
  ('quotes.approve', 'Approve or accept quotes'),
  ('invoices.read', 'View invoices'),
  ('invoices.write', 'Create and modify invoices'),
  ('invoices.approve', 'Approve and issue invoices'),
  ('payments.read', 'View payments'),
  ('payments.record', 'Record payments'),
  ('documents.read', 'View documents'),
  ('documents.write', 'Create and modify documents'),
  ('tickets.read', 'View support tickets'),
  ('tickets.write', 'Create and modify support tickets'),
  ('reports.read', 'View reports and analytics'),
  ('settings.read', 'View organization settings'),
  ('settings.manage', 'Manage organization settings');

-- ============ ORGANIZATION RBAC ============

CREATE TABLE organization_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  name text NOT NULL,
  key text NOT NULL,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_roles_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT organization_roles_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT organization_roles_key_format CHECK (
    key ~ '^[a-z][a-z0-9_]*$'
  ),
  CONSTRAINT organization_roles_organization_name_key
    UNIQUE (organization_id, name),
  CONSTRAINT organization_roles_organization_key_key
    UNIQUE (organization_id, key),
  CONSTRAINT organization_roles_id_organization_key
    UNIQUE (id, organization_id)
);

CREATE TABLE organization_role_permissions (
  organization_id uuid NOT NULL,
  organization_role_id uuid NOT NULL,
  permission_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_role_permissions_pkey
    PRIMARY KEY (organization_role_id, permission_key),
  CONSTRAINT organization_role_permissions_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT organization_role_permissions_role_organization_fkey
    FOREIGN KEY (organization_role_id, organization_id)
    REFERENCES organization_roles(id, organization_id) ON DELETE CASCADE,
  CONSTRAINT organization_role_permissions_permission_key_fkey
    FOREIGN KEY (permission_key) REFERENCES permissions(key)
    ON UPDATE RESTRICT ON DELETE RESTRICT
);

CREATE INDEX idx_organization_role_permissions_organization_id
  ON organization_role_permissions(organization_id);

CREATE INDEX idx_organization_role_permissions_permission_key
  ON organization_role_permissions(permission_key);

CREATE TABLE organization_member_roles (
  organization_id uuid NOT NULL,
  organization_member_id uuid NOT NULL,
  organization_role_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_member_roles_pkey
    PRIMARY KEY (organization_member_id, organization_role_id),
  CONSTRAINT organization_member_roles_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  CONSTRAINT organization_member_roles_member_organization_fkey
    FOREIGN KEY (organization_member_id, organization_id)
    REFERENCES organization_members(id, organization_id) ON DELETE CASCADE,
  CONSTRAINT organization_member_roles_role_organization_fkey
    FOREIGN KEY (organization_role_id, organization_id)
    REFERENCES organization_roles(id, organization_id) ON DELETE CASCADE
);

CREATE INDEX idx_organization_member_roles_organization_id
  ON organization_member_roles(organization_id);

CREATE INDEX idx_organization_member_roles_role_id
  ON organization_member_roles(organization_role_id);

-- ============ PLATFORM AUTHORITY ============

CREATE TABLE platform_admins (
  user_id uuid PRIMARY KEY,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  CONSTRAINT platform_admins_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT platform_admins_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT platform_admins_status_check CHECK (
    status IN ('active', 'suspended', 'revoked')
  )
);

-- ============ TIMESTAMP MAINTENANCE ============

CREATE TRIGGER touch_organizations
  BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER touch_organization_members
  BEFORE UPDATE ON organization_members
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER touch_organization_roles
  BEFORE UPDATE ON organization_roles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER touch_platform_admins
  BEFORE UPDATE ON platform_admins
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ DEFAULT-DENY BROWSER SECURITY ============

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_member_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_admins ENABLE ROW LEVEL SECURITY;

-- Supabase projects may grant API roles through default privileges. Remove those
-- grants explicitly rather than depending on the project's current defaults.
REVOKE ALL ON TABLE organizations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE organization_members FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE permissions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE organization_roles FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE organization_role_permissions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE organization_member_roles FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE platform_admins FROM PUBLIC, anon, authenticated;

-- Server-side code may manage tenant identity and RBAC. The capability catalogue
-- remains migration-owned and read-only even to service_role.
REVOKE ALL ON TABLE organizations FROM service_role;
REVOKE ALL ON TABLE organization_members FROM service_role;
REVOKE ALL ON TABLE permissions FROM service_role;
REVOKE ALL ON TABLE organization_roles FROM service_role;
REVOKE ALL ON TABLE organization_role_permissions FROM service_role;
REVOKE ALL ON TABLE organization_member_roles FROM service_role;
REVOKE ALL ON TABLE platform_admins FROM service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE organizations TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE organization_members TO service_role;
GRANT SELECT ON TABLE permissions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE organization_roles TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE organization_role_permissions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE organization_member_roles TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE platform_admins TO service_role;

COMMENT ON COLUMN organization_members.job_title IS
  'Organization-specific display title only; it has no authorization semantics.';

COMMENT ON TABLE platform_admins IS
  'Platform authority managed separately from organization membership and roles.';
