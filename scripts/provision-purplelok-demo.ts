#!/usr/bin/env node

import process from 'node:process';
import { runTenantProvisioningCli } from './provisioning/tenant-provisioner.js';
import { PURPLELOK_DEMO_SPEC } from './provisioning/tenant-specs.js';

runTenantProvisioningCli(PURPLELOK_DEMO_SPEC, process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown provisioning failure';
  console.error(`Provisioning aborted: ${message}`);
  process.exitCode = 1;
});
