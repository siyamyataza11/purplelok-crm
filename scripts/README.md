# Server-side provisioning

The provisioning commands use one tenant-specification engine for both the
real PURPLELOK organization and PURPLELOK Demo. The engine validates identities,
creates only missing compatible organization/RBAC records, and refuses to
silently repair conflicting authority.

The scripts do not modify CRM domain data, `profiles.role`, RLS policies,
Storage, or platform administrators. PURPLELOK provisions its verified owner;
PURPLELOK Demo provisions only the verified bootstrap identity as Demo
Administrator with the Admin organization role.

## Credential

Provide a privileged PostgreSQL connection string through the server-only
`SUPABASE_DB_URL` environment variable. The script does not accept a `VITE_`
credential and never prints the connection string.

For local operator use, the credential can be placed in
`.env.provisioning.local`:

```dotenv
SUPABASE_DB_URL=postgresql://...
```

The repository's `*.local` ignore rule excludes that filename from Git. Never
commit or share the file.

## Commands

Dry run is the default and starts a PostgreSQL read-only transaction:

```sh
npm run provision:purplelok
npm run provision:purplelok -- --dry-run
npm run provision:purplelok-demo
npm run provision:purplelok-demo -- --dry-run
```

With Node's environment-file support:

```sh
node --env-file=.env.provisioning.local --import tsx scripts/provision-purplelok.ts --dry-run
node --env-file=.env.provisioning.local --import tsx scripts/provision-purplelok-demo.ts --dry-run
```

Writes require the explicit flag:

```sh
node --env-file=.env.provisioning.local --import tsx scripts/provision-purplelok.ts --apply
node --env-file=.env.provisioning.local --import tsx scripts/provision-purplelok-demo.ts --apply
```

`--apply` runs in a serializable transaction, takes a tenant-scoped advisory
lock, repeats validation after acquiring the lock, and verifies a zero-change
final plan before commit. Any conflict or failed verification rolls back the
transaction. Review the dry-run plan before applying.

The two specifications enforce mutual membership isolation: the bootstrap
identity may not belong to real PURPLELOK, and the real owner may not belong to
PURPLELOK Demo. Both also require `platform_admins` to remain empty.

The Client role is created but deliberately left unassigned. Its permissions
are not production-safe until client-specific row-level scope is implemented.

## Existing-user member provisioning

`provision:member` is the narrow Batch 4D command for explicitly adding an
existing, active Auth/profile identity to an existing organization. It resolves
the organization by slug and resolves the requested role from that
organization's database roles. It never creates Auth users, organizations,
roles, permissions, platform administrators, or browser mutation grants.

Dry run is the default:

```sh
npm run provision:member -- \
  --email employee@example.com \
  --organization purplelok \
  --role Staff \
  --job-title "Web Developer"
```

Apply requires the explicit flag:

```sh
npm run provision:member -- \
  --email employee@example.com \
  --organization purplelok \
  --role Staff \
  --job-title "Web Developer" \
  --apply
```

The entry point reads `SUPABASE_DB_URL` from the process environment. For local
operator use only, it also loads the ignored `.env.provisioning.local` when the
variable is not already set.

Dry runs use `REPEATABLE READ READ ONLY` and cannot write. Apply uses a
`SERIALIZABLE` transaction, an organization/user advisory lock, and plain
inserts for compatible missing records only. It re-plans after the inserts and
commits only when zero changes remain and `platform_admins` plus `profiles.role`
are unchanged. Existing incompatible membership or authority is never repaired
silently.

The Client role is rejected entirely in Batch 4D. The real owner and bootstrap
admin are protected from cross-tenant membership and cannot be changed by this
command; their approved existing mappings can only produce a verified no-op.

## Batch 5A-R exact production-domain repair

`repair:batch5a-domain-drift` is an incident-specific operational command, not
a migration or a general cleanup tool. It recognizes only the fingerprinted
2026-08-30 state: eight exact NULL-tenant lead-stage activities and three exact
Demo lead stage/`updated_at` differences. Any additional, missing, or changed
row fails closed.

The incident was possible because the 90 legacy domain calls remain direct and
unscoped, insert paths omit `organization_id`, and the legacy domain RLS is
still permissive. Batch 5A added a tenant-aware application foundation but did
not convert those legacy calls or introduce authoritative domain isolation;
this is not a Batch 5A migration defect.

Dry run is the default and uses `REPEATABLE READ READ ONLY`:

```sh
npm run repair:batch5a-domain-drift
npm run repair:batch5a-domain-drift -- --dry-run
```

An approved repair requires the explicit flag:

```sh
npm run repair:batch5a-domain-drift -- --apply
```

Apply uses one `SERIALIZABLE` transaction, a transaction advisory lock, domain
table locks, exact row predicates, and exactly-one-row checks. It snapshots the
full `public.leads.touch_leads` catalog entry, disables only that trigger inside
the transaction, restores it, and requires byte-for-byte-equivalent catalog
state before commit. It then requires canonical 88/88/0/0 tenant totals, no
independent manifest differences, all 22 tenant FKs, unchanged authority state,
and `public.batch_3b_assert_seed_manifest()` to pass. Any failure rolls back the
data and trigger DDL together.

Normal production CRM domain interaction should remain suspended after repair
until Batch 5B tenant-scoped reads and Batch 5C tenant-scoped writes/deletes are
complete.
