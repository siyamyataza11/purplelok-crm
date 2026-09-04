import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path: string) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

test('D4 client integration uses each protected workflow RPC', async () => {
  const source = await read('src/lib/protected-workflows.ts');
  for (const rpc of [
    'record_payment', 'send_quote', 'approve_quote', 'convert_quote_to_invoice',
    'convert_quote_to_project', 'change_lead_stage',
  ]) assert.match(source, new RegExp(`['"]${rpc}['"]`));
  assert.match(source, /throw new Error\(['"]Workflow could not be completed['"]\)/);
});

test('payment submission no longer performs the split browser transaction', async () => {
  const source = await read('src/pages/Invoices.tsx');
  assert.match(source, /protectedWorkflows\.recordPayment/);
  assert.match(source, /!reference\.trim\(\)/);
  assert.doesNotMatch(source, /table\(['"]payments['"]\)\.insert/);
});

test('quote transitions and conversions use protected workflows', async () => {
  const source = await read('src/pages/Quotes.tsx');
  for (const call of ['sendQuote', 'approveQuote', 'convertQuoteToInvoice', 'convertQuoteToProject']) {
    assert.match(source, new RegExp(`protectedWorkflows\\.${call}`));
  }
  assert.doesNotMatch(source, /table\(['"]quotes['"]\)\.updateById/);
  assert.doesNotMatch(source, /table\(['"]invoices['"]\)\.insert/);
  assert.doesNotMatch(source, /table\(['"]projects['"]\)\.insert/);
  assert.match(source, /quote\.status === ['"]accepted['"].*invoicesWrite/);
  assert.match(source, /quote\.status === ['"]accepted['"].*projectsWrite/);
});

test('lead stage change delegates to the atomic RPC', async () => {
  const source = await read('src/lib/tenant-domain-workflows.ts');
  const page = await read('src/pages/Leads.tsx');
  assert.match(source, /input\.changeStage\(input\.leadId, input\.stage\)/);
  assert.match(page, /changeStage: protectedWorkflows\.changeLeadStage/);
  assert.doesNotMatch(source, /table\(['"]leads['"]\)\.updateById/);
  assert.doesNotMatch(source, /table\(['"]activities['"]\)\.insert/);
});

test('ordinary creates omit browser activity writes', async () => {
  for (const path of ['src/pages/Clients.tsx', 'src/pages/Leads.tsx', 'src/pages/Quotes.tsx', 'src/pages/Projects.tsx']) {
    assert.doesNotMatch(await read(path), /table\(['"]activities['"]\)\.insert/, path);
  }
});
