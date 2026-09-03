-- Disposable-CI fixture for proving both Batch 5F-D2 reconciliation branches.
-- This file is never applied as a migration.
BEGIN;

LOCK TABLE
  public.organizations,
  public.organization_roles,
  public.organization_role_permissions
IN SHARE ROW EXCLUSIVE MODE;

DO $fixture$
DECLARE
  target_organization_id uuid;
  target_finance_role_id uuid;
  target_staff_role_id uuid;
  affected_rows integer;
BEGIN
  SELECT organization.id
  INTO STRICT target_organization_id
  FROM public.organizations AS organization
  WHERE organization.slug = 'purplelok';

  SELECT role.id
  INTO STRICT target_finance_role_id
  FROM public.organization_roles AS role
  WHERE role.organization_id = target_organization_id
    AND role.key = 'finance'
    AND role.is_system;

  SELECT role.id
  INTO STRICT target_staff_role_id
  FROM public.organization_roles AS role
  WHERE role.organization_id = target_organization_id
    AND role.key = 'staff'
    AND role.is_system;

  INSERT INTO public.organization_role_permissions (
    organization_id,
    organization_role_id,
    permission_key
  ) VALUES (
    target_organization_id,
    target_finance_role_id,
    'members.manage'
  );

  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows <> 1 THEN
    RAISE EXCEPTION
      'Batch 5F-D2 fixture: expected one unauthorized Finance mapping insertion, got %',
      affected_rows;
  END IF;

  DELETE FROM public.organization_role_permissions AS role_permission
  WHERE role_permission.organization_id = target_organization_id
    AND role_permission.organization_role_id = target_staff_role_id
    AND role_permission.permission_key = 'tasks.read';

  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows <> 1 THEN
    RAISE EXCEPTION
      'Batch 5F-D2 fixture: expected one required Staff mapping deletion, got %',
      affected_rows;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.organization_role_permissions AS role_permission
    WHERE role_permission.organization_id = target_organization_id
      AND role_permission.organization_role_id = target_finance_role_id
      AND role_permission.permission_key = 'members.manage'
  ) OR EXISTS (
    SELECT 1
    FROM public.organization_role_permissions AS role_permission
    WHERE role_permission.organization_id = target_organization_id
      AND role_permission.organization_role_id = target_staff_role_id
      AND role_permission.permission_key = 'tasks.read'
  ) THEN
    RAISE EXCEPTION
      'Batch 5F-D2 fixture: reconciliation drift was not established exactly';
  END IF;
END
$fixture$;

COMMIT;
