import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import ts from 'typescript';

const root = resolve('src');
const admin = join(root, 'lib/supabase-admin.ts');
const modules = new Map<string, { client: boolean; action: boolean; imports: string[] }>();

function inspect(file: string) {
  const cached = modules.get(file);
  if (cached) return cached;
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const directives = new Set<string>();
  for (const statement of source.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) break;
    directives.add(statement.expression.text);
  }
  const imports: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      const onlyTypes = clause?.isTypeOnly || (clause && !clause.name && bindings &&
        ts.isNamedImports(bindings) && bindings.elements.every(item => item.isTypeOnly));
      if (!onlyTypes) imports.push(node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.exportClause;
      if (!clause || !ts.isNamedExports(clause) || clause.elements.some(item => !item.isTypeOnly)) {
        imports.push(node.moduleSpecifier.text);
      }
    } else if (ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require')) &&
      node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) {
      imports.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  const result = { client: directives.has('use client'), action: directives.has('use server'), imports };
  modules.set(file, result);
  return result;
}

function resolveImport(from: string, specifier: string) {
  const base = specifier.startsWith('@/') ? join(root, specifier.slice(2)) :
    specifier.startsWith('.') ? resolve(dirname(from), specifier) : null;
  if (!base) return null;
  return [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.mjs`,
    join(base, 'index.ts'), join(base, 'index.tsx')]
    .find(file => existsSync(file) && statSync(file).isFile() && /\.[cm]?[jt]sx?$/.test(file)) ?? null;
}

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (entry.name === '__tests__') return [];
    const file = join(dir, entry.name);
    return entry.isDirectory() ? files(file) : /\.[jt]sx?$/.test(file) ? [file] : [];
  });
}

test('client runtime imports cannot reach the service-role database client', () => {
  const clients = files(root).filter(file => inspect(file).client);
  assert.ok(clients.length > 0, 'Must inspect actual Client Components');
  for (const client of clients) {
    const visited = new Set<string>();
    const queue = [[client]];
    while (queue.length) {
      const path = queue.shift()!;
      const file = path[path.length - 1];
      assert.notEqual(file, admin, `Browser import chain: ${path.join(' -> ')}`);
      if (visited.has(file)) continue;
      visited.add(file);
      const entry = inspect(file);
      // Next transforms action-module imports into server references.
      if (entry.action) continue;
      for (const specifier of entry.imports) {
        const target = resolveImport(file, specifier);
        if (target) queue.push([...path, target]);
      }
    }
  }
});
