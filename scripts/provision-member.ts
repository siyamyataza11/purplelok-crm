#!/usr/bin/env node

import { existsSync } from 'node:fs';
import process from 'node:process';
import { runMemberProvisioningCli } from './provisioning/member-provisioner.js';

if (!process.env.SUPABASE_DB_URL && existsSync('.env.provisioning.local')) {
  process.loadEnvFile('.env.provisioning.local');
}

runMemberProvisioningCli(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown member provisioning failure';
  console.error(`Member provisioning aborted: ${message}`);
  process.exitCode = 1;
});
