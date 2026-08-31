import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

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

// Batch 5D removes the final collaboration calls. Any direct domain call is
// now a regression; only the tenant data layer may access domain tables.
export const LEGACY_DOMAIN_QUERY_BASELINE: Readonly<Record<string, number>> = {};
export const LEGACY_DOMAIN_QUERY_BASELINE_TOTAL = 0;

const DEFERRED_TABLE_COUNTS: Readonly<Record<string, Readonly<Record<string, number>>>> = {};

export function findDomainQueryBaselineViolations(
  countsByFile: Readonly<Record<string, number>>,
  total: number,
): string[] {
  const violations: string[] = [];
  for (const [file, count] of Object.entries(countsByFile)) {
    const approved = LEGACY_DOMAIN_QUERY_BASELINE[file];
    if (approved === undefined) {
      violations.push(`${file} introduces ${count} unapproved direct domain query call(s)`);
    } else if (count !== approved) {
      violations.push(`${file} has ${count} direct calls; exact deferred baseline is ${approved}`);
    }
  }

  const configuredTotal = Object.values(LEGACY_DOMAIN_QUERY_BASELINE)
    .reduce((sum, count) => sum + count, 0);
  if (configuredTotal !== LEGACY_DOMAIN_QUERY_BASELINE_TOTAL) {
    violations.push(
      `Configured baseline totals ${configuredTotal}; expected ${LEGACY_DOMAIN_QUERY_BASELINE_TOTAL}`,
    );
  }
  if (total !== LEGACY_DOMAIN_QUERY_BASELINE_TOTAL) {
    violations.push(
      `Repository has ${total} direct calls; exact deferred total is ${LEGACY_DOMAIN_QUERY_BASELINE_TOTAL}`,
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

function memberName(node: ts.Node): string | null {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node)) {
    const argument = node.argumentExpression;
    if (argument && (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))) {
      return argument.text;
    }
  }
  return null;
}

function memberReceiver(node: ts.Node): ts.Expression | null {
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    return node.expression;
  }
  return null;
}

function returnedExpression(
  node: ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration,
): ts.Expression | null {
  if (!node.body) return null;
  if (!ts.isBlock(node.body)) return node.body;
  const returns = node.body.statements.filter(ts.isReturnStatement);
  if (returns.length !== 1 || !returns[0].expression) return null;
  return returns[0].expression;
}

interface SourceBindings {
  clientValues: Set<string>;
  clientFactories: Set<string>;
  fromValues: Set<string>;
  fromFactories: Set<string>;
  stringConstants: Map<string, string>;
}

function staticValueKey(node: ts.Node, sourceFile: ts.SourceFile): string | null {
  if (ts.isParenthesizedExpression(node)) return staticValueKey(node.expression, sourceFile);
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    const receiver = staticValueKey(node.expression, sourceFile);
    const name = memberName(node);
    return receiver && name ? `${receiver}.${name}` : null;
  }
  return null;
}

function sourceBindings(sourceFile: ts.SourceFile): SourceBindings {
  const bindings: SourceBindings = {
    clientValues: new Set<string>(),
    clientFactories: new Set<string>(),
    fromValues: new Set<string>(),
    fromFactories: new Set<string>(),
    stringConstants: new Map<string, string>(),
  };

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)
        || !ts.isStringLiteral(statement.moduleSpecifier)
        || statement.moduleSpecifier.text !== '@/lib/supabase') continue;
    const imported = statement.importClause?.namedBindings;
    if (imported && ts.isNamespaceImport(imported)) {
      bindings.clientValues.add(`${imported.name.text}.supabase`);
    } else if (imported && ts.isNamedImports(imported)) {
      for (const element of imported.elements) {
        if ((element.propertyName?.text ?? element.name.text) === 'supabase') {
          bindings.clientValues.add(element.name.text);
        }
      }
    }
  }

  const resolvesString = (expression: ts.Expression): string | null => {
    if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
      return expression.text;
    }
    if (ts.isIdentifier(expression)) return bindings.stringConstants.get(expression.text) ?? null;
    if (ts.isParenthesizedExpression(expression)) return resolvesString(expression.expression);
    return null;
  };
  const resolvesClient = (expression: ts.Expression): boolean => {
    if (ts.isParenthesizedExpression(expression)) return resolvesClient(expression.expression);
    const key = staticValueKey(expression, sourceFile);
    if (key && bindings.clientValues.has(key)) return true;
    if (!ts.isCallExpression(expression)) return false;
    const calleeKey = staticValueKey(expression.expression, sourceFile);
    return calleeKey !== null && bindings.clientFactories.has(calleeKey);
  };
  const resolvesFrom = (expression: ts.Expression): boolean => {
    if (ts.isParenthesizedExpression(expression)) return resolvesFrom(expression.expression);
    const key = staticValueKey(expression, sourceFile);
    if (key && bindings.fromValues.has(key)) return true;
    if (ts.isCallExpression(expression)) {
      const calleeKey = staticValueKey(expression.expression, sourceFile);
      if (calleeKey && bindings.fromFactories.has(calleeKey)) return true;
      if (memberName(expression.expression) === 'bind') {
        const bound = memberReceiver(expression.expression);
        return bound !== null && resolvesFrom(bound);
      }
      return false;
    }
    const receiver = memberReceiver(expression);
    return memberName(expression) === 'from'
      && receiver !== null
      && resolvesClient(receiver);
  };

  const declarations: Array<ts.VariableDeclaration | ts.FunctionDeclaration> = [];
  const assignments: ts.BinaryExpression[] = [];
  const calls: ts.CallExpression[] = [];
  const functions = new Map<string, ts.FunctionLikeDeclaration>();
  const collect = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node)) {
      declarations.push(node);
      if (node.initializer
          && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
        const key = staticValueKey(node.name, sourceFile);
        if (key) functions.set(key, node.initializer);
      }
    } else if (ts.isFunctionDeclaration(node)) {
      declarations.push(node);
      if (node.name) functions.set(node.name.text, node);
    } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      assignments.push(node);
      if (ts.isArrowFunction(node.right) || ts.isFunctionExpression(node.right)) {
        const key = staticValueKey(node.left, sourceFile);
        if (key) functions.set(key, node.right);
      }
    } else if (ts.isCallExpression(node)) {
      calls.push(node);
    }
    ts.forEachChild(node, collect);
  };
  collect(sourceFile);

  const add = (values: Set<string>, key: string | null): boolean => {
    if (!key || values.has(key)) return false;
    values.add(key);
    return true;
  };
  const staticObjectPropertyName = (name: ts.PropertyName): string | null => {
    if (ts.isIdentifier(name)
        || ts.isStringLiteral(name)
        || ts.isNoSubstitutionTemplateLiteral(name)
        || ts.isNumericLiteral(name)) {
      return name.text;
    }
    if (ts.isComputedPropertyName(name)) return resolvesString(name.expression);
    return null;
  };
  const taintObjectLiteral = (
    baseKey: string,
    object: ts.ObjectLiteralExpression,
  ): boolean => {
    let objectChanged = false;
    for (const property of object.properties) {
      let propertyName: string | null = null;
      let initializer: ts.Expression | null = null;
      if (ts.isPropertyAssignment(property)) {
        propertyName = staticObjectPropertyName(property.name);
        initializer = property.initializer;
      } else if (ts.isShorthandPropertyAssignment(property)) {
        propertyName = property.name.text;
        initializer = property.name;
      }
      if (!propertyName || !initializer) continue;

      const propertyKey = `${baseKey}.${propertyName}`;
      if (resolvesClient(initializer)) {
        objectChanged = add(bindings.clientValues, propertyKey) || objectChanged;
      }
      if (resolvesFrom(initializer)) {
        objectChanged = add(bindings.fromValues, propertyKey) || objectChanged;
      }
      if (ts.isObjectLiteralExpression(initializer)) {
        objectChanged = taintObjectLiteral(propertyKey, initializer) || objectChanged;
      }
    }
    return objectChanged;
  };
  const taintBinding = (
    name: ts.BindingName,
    kind: 'client' | 'from',
  ): boolean => {
    if (ts.isIdentifier(name)) {
      return add(kind === 'client' ? bindings.clientValues : bindings.fromValues, name.text);
    }
    let bindingChanged = false;
    if (kind === 'client' && ts.isObjectBindingPattern(name)) {
      for (const element of name.elements) {
        const sourceName = element.propertyName?.getText(sourceFile) ?? element.name.getText(sourceFile);
        if (sourceName === 'from') bindingChanged = taintBinding(element.name, 'from') || bindingChanged;
      }
    }
    return bindingChanged;
  };
  const taintDestructuredAssignment = (left: ts.ObjectLiteralExpression): boolean => {
    let assignmentChanged = false;
    for (const property of left.properties) {
      if (ts.isShorthandPropertyAssignment(property) && property.name.text === 'from') {
        assignmentChanged = add(bindings.fromValues, property.name.text) || assignmentChanged;
      } else if (ts.isPropertyAssignment(property)
          && property.name.getText(sourceFile).replace(/['"]/g, '') === 'from') {
        assignmentChanged = add(
          bindings.fromValues,
          staticValueKey(property.initializer, sourceFile),
        ) || assignmentChanged;
      }
    }
    return assignmentChanged;
  };

  let changed = true;
  while (changed) {
    changed = false;
    for (const declaration of declarations) {
      if (ts.isFunctionDeclaration(declaration)) {
        if (!declaration.name) continue;
        const returned = returnedExpression(declaration);
        if (returned && resolvesClient(returned)) {
          changed = add(bindings.clientFactories, declaration.name.text) || changed;
        }
        if (returned && resolvesFrom(returned)) {
          changed = add(bindings.fromFactories, declaration.name.text) || changed;
        }
        continue;
      }

      const { name, initializer } = declaration;
      if (!initializer) continue;
      if (ts.isIdentifier(name)) {
        if (ts.isObjectLiteralExpression(initializer)) {
          changed = taintObjectLiteral(name.text, initializer) || changed;
        }
        const constant = resolvesString(initializer);
        if (constant !== null && !bindings.stringConstants.has(name.text)) {
          bindings.stringConstants.set(name.text, constant);
          changed = true;
        }
        if (resolvesClient(initializer)) changed = add(bindings.clientValues, name.text) || changed;
        if (resolvesFrom(initializer)) changed = add(bindings.fromValues, name.text) || changed;
        if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
          const returned = returnedExpression(initializer);
          if (returned && resolvesClient(returned)) {
            changed = add(bindings.clientFactories, name.text) || changed;
          }
          if (returned && resolvesFrom(returned)) {
            changed = add(bindings.fromFactories, name.text) || changed;
          }
        }
      } else if (ts.isObjectBindingPattern(name) && resolvesClient(initializer)) {
        for (const element of name.elements) {
          const sourceName = element.propertyName?.getText(sourceFile) ?? element.name.getText(sourceFile);
          if (sourceName === 'from') changed = taintBinding(element.name, 'from') || changed;
        }
      }
    }

    for (const assignment of assignments) {
      const target = staticValueKey(assignment.left, sourceFile);
      if (target && ts.isObjectLiteralExpression(assignment.right)) {
        changed = taintObjectLiteral(target, assignment.right) || changed;
      }
      if (resolvesClient(assignment.right)) {
        if (ts.isObjectLiteralExpression(assignment.left)) {
          changed = taintDestructuredAssignment(assignment.left) || changed;
        } else {
          changed = add(bindings.clientValues, target) || changed;
        }
      }
      if (resolvesFrom(assignment.right)) {
        changed = add(bindings.fromValues, target) || changed;
      }
      if (target && ts.isIdentifier(assignment.left)) {
        const constant = resolvesString(assignment.right);
        if (constant !== null && !bindings.stringConstants.has(target)) {
          bindings.stringConstants.set(target, constant);
          changed = true;
        }
      }
    }

    for (const [key, fn] of functions) {
      const returned = returnedExpression(fn as ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration);
      if (returned && resolvesClient(returned)) {
        changed = add(bindings.clientFactories, key) || changed;
      }
      if (returned && resolvesFrom(returned)) {
        changed = add(bindings.fromFactories, key) || changed;
      }
    }

    for (const call of calls) {
      const callee = staticValueKey(call.expression, sourceFile);
      const fn = callee ? functions.get(callee) : undefined;
      if (!fn) continue;
      for (let index = 0; index < fn.parameters.length && index < call.arguments.length; index += 1) {
        const argument = call.arguments[index];
        const parameter = fn.parameters[index].name;
        if (resolvesClient(argument)) changed = taintBinding(parameter, 'client') || changed;
        if (resolvesFrom(argument)) changed = taintBinding(parameter, 'from') || changed;
      }
    }
  }
  return bindings;
}

function tableArgument(
  expression: ts.Expression | undefined,
  constants: ReadonlyMap<string, string>,
): { table: string | null; dynamic: boolean } {
  if (!expression) return { table: null, dynamic: true };
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return { table: expression.text, dynamic: false };
  }
  if (ts.isIdentifier(expression)) {
    const table = constants.get(expression.text);
    return table === undefined ? { table: null, dynamic: true } : { table, dynamic: false };
  }
  if (ts.isParenthesizedExpression(expression)) return tableArgument(expression.expression, constants);
  return { table: null, dynamic: true };
}

function isRawFromValue(
  expression: ts.Expression,
  bindings: SourceBindings,
  sourceFile: ts.SourceFile,
): boolean {
  if (ts.isParenthesizedExpression(expression)) {
    return isRawFromValue(expression.expression, bindings, sourceFile);
  }
  const key = staticValueKey(expression, sourceFile);
  if (key && bindings.fromValues.has(key)) return true;
  if (ts.isCallExpression(expression)) {
    const callee = staticValueKey(expression.expression, sourceFile);
    if (callee && bindings.fromFactories.has(callee)) return true;
    if (memberName(expression.expression) === 'bind') {
      const bound = memberReceiver(expression.expression);
      return bound !== null && isRawFromValue(bound, bindings, sourceFile);
    }
  }
  return false;
}

function isRawFromCall(
  node: ts.CallExpression,
  bindings: SourceBindings,
  sourceFile: ts.SourceFile,
): boolean {
  const callee = node.expression;
  if (isRawFromValue(callee, bindings, sourceFile)) return true;
  if (memberName(callee) !== 'from') return false;
  const receiver = memberReceiver(callee);
  return !(receiver && ts.isIdentifier(receiver) && receiver.text === 'Array');
}

function inspectRawDomainCalls(
  file: string,
  sourceFile: ts.SourceFile,
): TenantSourceInspection {
  const occurrences: DomainQueryOccurrence[] = [];
  const violations: string[] = [];
  const bindings = sourceBindings(sourceFile);
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && isRawFromCall(node, bindings, sourceFile)) {
      const argument = tableArgument(node.arguments[0], bindings.stringConstants);
      const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
      if (argument.dynamic) {
        violations.push(
          `${file}:${line} uses a dynamic raw table expression that cannot be tenant-classified`,
        );
      } else if (argument.table && DOMAIN_TABLE_SET.has(argument.table)) {
        occurrences.push({ file, table: argument.table, line });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { occurrences, violations };
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

  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const rawCalls = inspectRawDomainCalls(file, sourceFile);
  occurrences.push(...rawCalls.occurrences);
  violations.push(...rawCalls.violations);
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

  for (const [file, expectedTables] of Object.entries(DEFERRED_TABLE_COUNTS)) {
    for (const [table, expectedCount] of Object.entries(expectedTables)) {
      const actualCount = occurrences.filter((occurrence) =>
        occurrence.file === file && occurrence.table === table).length;
      if (actualCount !== expectedCount) {
        violations.push(`${file} has ${actualCount} direct ${table} call(s); exact deferred count is ${expectedCount}`);
      }
    }
  }
  for (const occurrence of occurrences) {
    if (DEFERRED_TABLE_COUNTS[occurrence.file]?.[occurrence.table] === undefined) {
      violations.push(`${occurrence.file}:${occurrence.line} directly queries migrated table ${occurrence.table}`);
    }
  }

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
