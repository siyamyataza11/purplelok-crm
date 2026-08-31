#!/usr/bin/env node

import { existsSync } from 'node:fs';
import process from 'node:process';
import { runDomainDriftRepairCli } from './repairs/batch5a-domain-drift-repair-runner.js';

if (!process.env.SUPABASE_DB_URL && existsSync('.env.provisioning.local')) {
  process.loadEnvFile('.env.provisioning.local');
}

runDomainDriftRepairCli(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown Batch 5A-R failure';
  console.error(`Batch 5A-R aborted: ${message}`);
  process.exitCode = 1;
});
