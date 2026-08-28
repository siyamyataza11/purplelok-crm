# Server-side provisioning

`provision-purplelok.ts` provisions the first PURPLELOK organization, its six
system roles, role-permission mappings, and the approved owner membership. It
does not modify CRM domain data, `profiles.role`, RLS policies, Storage, the
bootstrap admin, or platform administrators.

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
```

With Node's environment-file support:

```sh
node --env-file=.env.provisioning.local --import tsx scripts/provision-purplelok.ts --dry-run
```

Writes require the explicit flag:

```sh
node --env-file=.env.provisioning.local --import tsx scripts/provision-purplelok.ts --apply
```

`--apply` runs in a serializable transaction and verifies the final state before
commit. Any conflict or failed verification rolls back the transaction. Review
the dry-run plan before applying.

The Client role is created but deliberately left unassigned. Its permissions
are not production-safe until client-specific row-level scope is implemented.
