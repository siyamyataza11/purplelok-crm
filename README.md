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

## Batch 5A tenant data foundation

New domain work must use `useTenantData()` rather than direct Supabase domain
queries. The tenant layer derives ownership only from the resolved
`OrganizationContext`, scopes every operation, and rejects mismatched returned
rows. Page and workflow capability checks remain required; later tenant RLS is
the authoritative database boundary. The checked-in legacy-query guard records
the existing 90 calls until later Batch 5 conversions reduce that number.

Temporary authorization semantics are deliberately narrow: Calendar uses
`projects.read`/`projects.write`; Chat requires active organization membership;
Activities are side effects of already-authorized workflows. Reports and PURPLE
AI require `reports.read` plus each source capability (for example,
`invoices.read` for invoice data). Chat and Calendar need dedicated capabilities
before Client access can be enabled, and Client provisioning remains disabled.
