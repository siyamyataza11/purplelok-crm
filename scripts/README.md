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
