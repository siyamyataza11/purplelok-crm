# purplelok-crm

[![Open in Bolt](https://bolt.new/static/open-in-bolt.svg)](https://bolt.new/~/sb1-tnmphwtb)

## Frontend environment

Copy `.env.example` to the ignored `.env.local` file for local development and
set `VITE_SUPABASE_URL` plus `VITE_SUPABASE_ANON_KEY` to the URL and browser-safe
publishable/anon key from the same Supabase project. Configure those same names
in the production host before running `npm run build`. Never place a
`service_role` or secret key in a `VITE_` variable because Vite embeds these
values in browser assets.

Node 22 LTS is the repository default (`.nvmrc`); supported Node releases are
declared in `package.json`.

## Internal authentication containment

PURPLELOK is an internal business management system. The frontend exposes only
sign-in and password-reset flows; it does not offer public account creation.
Production deployment also requires public email signup to be disabled in the
hosted Supabase Auth settings (`disable_signup = true`). Removing the frontend
control is defense in depth and does not replace that server-side setting.

Before releasing authentication changes, an operator must verify the hosted
setting against the intended Supabase project without printing credentials.
Changing the hosted setting is an explicit production operation and is not
performed by application builds, tests, or migrations in this repository.

Persisted sessions are treated only as bootstrap candidates. The application
requires a successful live `getUser()` check and exactly one active profile
before organization authorization begins. Profile and organization authority
are revalidated on token refresh, user updates, window focus, and explicit
organization-context refresh. Any failed or stale verification clears usable
authority; password-recovery sessions remain outside the CRM until the separate
recovery flow is implemented.

Initial bootstrap may restore a valid persisted session without a local login
transition. Once initialized, however, an unauthenticated provider cannot trust
an unsolicited SDK `SIGNED_IN` event: only `signInWithPassword()` creates the
single-use login nonce that may establish fresh identity authority. Bootstrap,
refresh, and revalidation all re-read persisted session identity and token after
profile verification and reject intervening storage mutations.

Supabase Auth persistence uses the application-owned storage adapter in
`src/lib/supabase-auth-storage.ts`. Logout immediately tombstones the provider
lifecycle and purges every storage key observed from the SDK before attempting
remote sign-out. Refresh and revalidation are identity-continuity operations;
only a user-initiated password sign-in may establish a different identity. If
physical credential removal cannot be proven, a credential-free durable marker
keeps the observed SDK key unreadable across full reloads; only an explicit
fresh login transition may replace that tombstoned credential.

Browser users have no direct profile mutation authority. The constrained
`update_own_profile` RPC accepts only the caller's `full_name`, `phone`,
`position`, and `avatar_url`; profile identity, `active`, legacy `role`, email,
and timestamps remain server-managed.

## Batch 5A tenant data foundation

New domain work must use `useTenantData()` rather than direct Supabase domain
queries. The tenant layer derives ownership only from the resolved
`OrganizationContext`, scopes every operation, and rejects mismatched returned
rows. Page and workflow capability checks remain required; later tenant RLS is
the authoritative database boundary. The checked-in direct-query guard requires
zero raw application domain calls.

Temporary authorization semantics are deliberately narrow: Calendar uses
`projects.read`/`projects.write`; Chat requires active organization membership;
Activities are side effects of already-authorized workflows. Reports and PURPLE
AI require `reports.read` plus each source capability (for example,
`invoices.read` for invoice data). Chat and Calendar need dedicated capabilities
before Client access can be enabled, and Client provisioning remains disabled.
