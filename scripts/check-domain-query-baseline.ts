import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DOMAIN_TABLES = [
  'clients', 'client_contacts', 'client_notes', 'leads', 'quotes',
  'quote_items', 'invoices', 'invoice_items', 'payments', 'projects',
  'project_milestones', 'tasks', 'task_comments', 'meetings', 'documents',
  'tickets', 'ticket_messages', 'activities', 'notifications', 'channels',
  'messages',
] as const;

export interface DomainQueryOccurrence {
  file: string;
  table: string;
  line: number;
}

export interface DomainQueryBaselineResult {
  occurrences: DomainQueryOccurrence[];
  countsByFile: Record<string, number>;
  total: number;
  violations: string[];
}

export interface TenantSourceInspection {
  occurrences: DomainQueryOccurrence[];
  violations: string[];
}

// Filled with the exact Batch 5A legacy inventory. Counts may decrease as
// later batches convert a file, but any new file or per-file increase fails.
export const LEGACY_DOMAIN_QUERY_BASELINE: Readonly<Record<string, number>> = {
  'src/components/layout/Topbar.tsx': 2,
  'src/hooks/useDashboardData.ts': 9,
  'src/pages/Calendar.tsx': 3,
  'src/pages/Chat.tsx': 4,
  'src/pages/Clients.tsx': 12,
  'src/pages/Documents.tsx': 3,
  'src/pages/Invoices.tsx': 10,
  'src/pages/Leads.tsx': 5,
  'src/pages/Projects.tsx': 9,
  'src/pages/Quotes.tsx': 16,
  'src/pages/Reports.tsx': 6,
  'src/pages/Tasks.tsx': 5,
  'src/pages/Tickets.tsx': 6,
};
export const LEGACY_DOMAIN_QUERY_BASELINE_TOTAL = 90;

export function findDomainQueryBaselineViolations(
  countsByFile: Readonly<Record<string, number>>,
  total: number,
): string[] {
  const violations: string[] = [];
  for (const [file, count] of Object.entries(countsByFile)) {
    const approved = LEGACY_DOMAIN_QUERY_BASELINE[file];
    if (approved === undefined) {
      violations.push(`${file} introduces ${count} unapproved direct domain query call(s)`);
    } else if (count > approved) {
      violations.push(`${file} has ${count} direct calls; approved baseline is ${approved}`);
    }
  }

  const configuredTotal = Object.values(LEGACY_DOMAIN_QUERY_BASELINE)
    .reduce((sum, count) => sum + count, 0);
  if (configuredTotal !== LEGACY_DOMAIN_QUERY_BASELINE_TOTAL) {
    violations.push(
      `Configured baseline totals ${configuredTotal}; expected ${LEGACY_DOMAIN_QUERY_BASELINE_TOTAL}`,
    );
  }
  if (total > LEGACY_DOMAIN_QUERY_BASELINE_TOTAL) {
    violations.push(
      `Repository has ${total} direct calls; approved total is ${LEGACY_DOMAIN_QUERY_BASELINE_TOTAL}`,
    );
  }
  return violations;
}

const DOMAIN_TABLE_SET = new Set<string>(DOMAIN_TABLES);
const APPROVED_INTERNAL_IMPORTERS = new Set([
  'src/context/TenantDataContext.tsx',
  'src/lib/tenant-data.ts',
]);
const TENANT_INTERNAL_IMPORT_PATTERN = /(?:from\s*|import\s*\()\s*['"][^'"]*tenant-data-internal(?:\.ts)?['"]/g;

function escapePattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function supabaseAliases(source: string): Set<string> {
  const aliases = new Set<string>();
  const importPattern = /import\s*{([^}]*)}\s*from\s*['"]@\/lib\/supabase['"]/g;
  for (const match of source.matchAll(importPattern)) {
    for (const item of match[1].split(',')) {
      const imported = item.trim().match(/^supabase(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
      if (imported) aliases.add(imported[1] ?? 'supabase');
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    const assignmentPattern = /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*;?/g;
    for (const match of source.matchAll(assignmentPattern)) {
      if (aliases.has(match[2]) && !aliases.has(match[1])) {
        aliases.add(match[1]);
        changed = true;
      }
    }
  }
  return aliases;
}

export function inspectTenantSource(
  file: string,
  source: string,
): TenantSourceInspection {
  const occurrences: DomainQueryOccurrence[] = [];
  const violations: string[] = [];

  TENANT_INTERNAL_IMPORT_PATTERN.lastIndex = 0;
  if (!APPROVED_INTERNAL_IMPORTERS.has(file)
      && TENANT_INTERNAL_IMPORT_PATTERN.test(source)) {
    violations.push(`${file} imports forbidden tenant-authority internals`);
  }

  if (file === 'src/lib/tenant-data-internal.ts') {
    return { occurrences, violations };
  }

  for (const alias of supabaseAliases(source)) {
    const fromPattern = new RegExp(
      String.raw`\b${escapePattern(alias)}\s*\.\s*from\s*\(\s*([\s\S]*?)\s*\)`,
      'g',
    );
    for (const match of source.matchAll(fromPattern)) {
      const argument = match[1].trim();
      const literal = argument.match(/^(['"`])([^'"`]*)\1$/);
      const line = source.slice(0, match.index ?? 0).split('\n').length;
      if (!literal || (literal[1] === '`' && literal[2].includes('${'))) {
        violations.push(
          `${file}:${line} uses a dynamic Supabase table expression that cannot be tenant-classified`,
        );
        continue;
      }
      if (DOMAIN_TABLE_SET.has(literal[2])) {
        occurrences.push({ file, table: literal[2], line });
      }
    }
  }

  return { occurrences, violations };
}

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolute);
    if (entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name)) return [absolute];
    return [];
  }));
  return nested.flat();
}

export async function scanDomainQueryBaseline(
  repositoryRoot: string,
): Promise<DomainQueryBaselineResult> {
  const sourceRoot = path.join(repositoryRoot, 'src');
  const files = await sourceFiles(sourceRoot);
  const occurrences: DomainQueryOccurrence[] = [];
  const violations: string[] = [];

  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const relativeFile = path.relative(repositoryRoot, file).split(path.sep).join('/');
    const inspection = inspectTenantSource(relativeFile, source);
    occurrences.push(...inspection.occurrences);
    violations.push(...inspection.violations);
  }

  const countsByFile: Record<string, number> = {};
  for (const occurrence of occurrences) {
    countsByFile[occurrence.file] = (countsByFile[occurrence.file] ?? 0) + 1;
  }

  violations.push(...findDomainQueryBaselineViolations(countsByFile, occurrences.length));

  return { occurrences, countsByFile, total: occurrences.length, violations };
}

async function main(): Promise<void> {
  const repositoryRoot = process.cwd();
  const result = await scanDomainQueryBaseline(repositoryRoot);
  console.log(JSON.stringify({
    total: result.total,
    countsByFile: result.countsByFile,
    violations: result.violations,
  }, null, 2));
  if (!process.argv.includes('--report') && result.violations.length > 0) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}
