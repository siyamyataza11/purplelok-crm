export const TENANT_LOAD_ERROR_MESSAGE = 'Tenant data could not be loaded. Please retry.';

export function isTenantScopeCancellation(error: unknown): boolean {
  return (typeof DOMException !== 'undefined'
      && error instanceof DOMException
      && error.name === 'AbortError')
    || (error instanceof Error
      && (error.name === 'TenantScopeChangedError' || error.name === 'AbortError'));
}

/**
 * Terminates fire-and-forget tenant reads safely. Stale-scope rejection remains
 * mandatory inside TenantScope.assertCurrent(); this helper only prevents that
 * expected rejection from escaping as an unhandled promise.
 */
export async function runTenantLoader(
  loader: () => Promise<unknown>,
  onUnexpectedError?: (message: string) => void,
): Promise<void> {
  try {
    await loader();
  } catch (error) {
    if (isTenantScopeCancellation(error)) return;
    if (onUnexpectedError) {
      onUnexpectedError(TENANT_LOAD_ERROR_MESSAGE);
      return;
    }
    console.error(TENANT_LOAD_ERROR_MESSAGE);
  }
}
