import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  C3_ROLES,
  DOCUMENT_OWNER_TYPES,
  capabilitiesFor,
} from '@c3web/domain';
import {
  SEARCH_DOMAINS,
  SEARCH_RESULT_KINDS as APPLICATION_SEARCH_RESULT_KINDS,
} from '@c3web/application';
import { SEARCH_RESULT_KINDS as CONTRACT_SEARCH_RESULT_KINDS } from '@c3web/api-contracts';
import ts from 'typescript';
import {
  parseCanonicalFrozenJson,
  SUNSET_FROZEN_DATA_FILES,
} from './frozenData.js';
import type {
  SearchProjectionRegistryEntry,
  SearchResponseFieldRegistry,
  SunsetRegistrySnapshot,
} from './types';

const WEBV0_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

const ENTITLEMENT_SNAPSHOTS = [
  'no-row',
  'active-current',
  'lapsed',
  'active-future',
  'active-expired',
] as const;

export const SUNSET_POLICY_ROOTS = [
  'apps/api/src',
  'packages/authz/src',
  'packages/domain/src',
  'packages/application/src',
  'packages/persistence/src',
  'packages/persistence/migrations',
  'packages/api-contracts/src',
] as const;

export const SUNSET_WIRING_FILES = [
  '../.github/workflows/webv0-ci.yml',
  'apps/api/contract/v1.json',
  'apps/api/package.json',
  'apps/api/src/logger.ts',
  'apps/api/openapi.json',
  'apps/api/openapi.yaml',
  'apps/api/scripts/generate-contract.ts',
  'apps/api/scripts/generate-openapi.ts',
  'apps/api/test/contract.test.ts',
  'apps/api/test/logger.test.ts',
  'apps/api/tsconfig.json',
  'package-lock.json',
  'package.json',
  'packages/api-contracts/package.json',
  'packages/api-contracts/tsconfig.json',
  'packages/application/package.json',
  'packages/application/tsconfig.json',
  'packages/authz/package.json',
  'packages/authz/tsconfig.json',
  'packages/domain/package.json',
  'packages/domain/tsconfig.json',
  'packages/persistence/package.json',
  'packages/persistence/tsconfig.json',
  'packages/search-harness/package.json',
  'packages/search-harness/tsconfig.json',
  'packages/search-harness/src/cli/conformance.ts',
  'packages/search-harness/src/cli/selfTestRunner.ts',
  'packages/search-harness/src/cli/sunsetPreflight.ts',
  'packages/search-harness/src/cli/verify.ts',
  'packages/search-harness/src/cli/verifyWorkflow.ts',
  'packages/search-harness/src/registry/preflight.ts',
  'packages/search-harness/test/loggerRedactionContract.test.ts',
  'packages/search-harness/test/registry/sunsetRegistry.test.ts',
  'packages/search-harness/test/verifyWorkflow.test.ts',
  'packages/search-harness/vitest.config.ts',
  'scripts/gate.mts',
  'scripts/test.mts',
  'scripts/typecheck.mts',
  'scripts/vitestProjects.ts',
  'tsconfig.base.json',
  'vitest.config.ts',
  'vitest.workspace.ts',
] as const;

export const SUNSET_ENFORCEMENT_TREE_KEY =
  'packages/search-harness#enforcement-tree' as const;

const SUNSET_ENFORCEMENT_TREE_EXCLUSIONS = new Set<string>([
  ...SUNSET_FROZEN_DATA_FILES,
]);

const SUNSET_ENFORCEMENT_GENERATED_DIRECTORIES = new Set<string>([
  '.cache',
  '.turbo',
  '.vite',
  '.vitest',
  'coverage',
  'dist',
  'dist-runtime',
  'lib',
  'lib-commonjs',
  'lib-dts',
  'lib-esm',
  'node_modules',
  'playwright-report',
  'test-results',
]);

const SUNSET_ENFORCEMENT_GENERATED_FILES = new Set<string>([
  '.ds_store',
  'thumbs.db',
]);

const CRITICAL_SOURCE_MARKERS = [
  'C3_ROLES',
  'DOCUMENT_OWNER_TYPES',
  'COMMS_MODULE_KEY',
  'SEARCH_DOMAINS',
  'SEARCH_RESULT_KINDS',
  'searchResultsSchema',
  'DOMAIN_SPECS',
  'claimsOwnIdentity',
  'documentOwnerTypes',
  'hasActiveDelegation',
  'claimReadGuard',
  'commsDocReadGuard',
  'getModuleEntitlement',
  'isEntitlementWritable',
  'assertViewCommsThread',
  'tenant_module_entitlement',
  'current_user_id()',
  'record_kind',
] as const;

const CRITICAL_DECLARATIONS: Readonly<Record<string, readonly string[]>> = {
  'packages/application/src/usecases/search.ts': ['globalSearch'],
  'packages/application/src/usecases/queries.ts': ['assertViewApprovalsEffective'],
  'packages/application/src/usecases/claimOps.ts': ['getClaim', 'claimReadGuard'],
  'packages/application/src/usecases/documentOps.ts': [
    'assertReadOwner',
    'listDocuments',
    'getDocumentForDownload',
  ],
  'packages/application/src/usecases/commsOps.ts': [
    'isEntitlementWritable',
    'assertViewCommsThread',
    'commsDocReadGuard',
  ],
  'packages/persistence/src/searchSql.ts': ['DOMAIN_SPECS', 'domainBlock'],
  'packages/api-contracts/src/index.ts': ['searchResultsSchema'],
};

function repoPath(relativePath: string): string {
  return resolve(WEBV0_ROOT, ...relativePath.split('/'));
}

function readRepoFile(relativePath: string): string {
  const absolutePath = repoPath(relativePath);
  if (!lstatSync(absolutePath).isFile()) {
    throw new Error(
      `Sunset registry refuses a non-regular or symbolic wiring file: ${relativePath}`,
    );
  }
  return readFileSync(absolutePath, 'utf8');
}

function parseTypeScript(relativePath: string): ts.SourceFile {
  const text = readRepoFile(relativePath);
  return ts.createSourceFile(relativePath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function walk(node: ts.Node, visit: (candidate: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

function findVariable(source: ts.SourceFile, name: string): ts.VariableDeclaration | undefined {
  let result: ts.VariableDeclaration | undefined;
  walk(source, (node) => {
    if (
      result === undefined &&
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name
    ) {
      result = node;
    }
  });
  return result;
}

function findFunction(source: ts.SourceFile, name: string): ts.FunctionDeclaration | undefined {
  let result: ts.FunctionDeclaration | undefined;
  walk(source, (node) => {
    if (
      result === undefined &&
      ts.isFunctionDeclaration(node) &&
      node.name?.text === name
    ) {
      result = node;
    }
  });
  return result;
}

function findInterface(source: ts.SourceFile, name: string): ts.InterfaceDeclaration | undefined {
  let result: ts.InterfaceDeclaration | undefined;
  walk(source, (node) => {
    if (result === undefined && ts.isInterfaceDeclaration(node) && node.name.text === name) {
      result = node;
    }
  });
  return result;
}

function requireInitializer(
  source: ts.SourceFile,
  name: string,
): ts.Expression {
  const declaration = findVariable(source, name);
  if (!declaration?.initializer) {
    throw new Error(`Sunset registry extraction failed: ${source.fileName} has no ${name} initializer.`);
  }
  return declaration.initializer;
}

function propertyNameText(name: ts.PropertyName, source: ts.SourceFile): string {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return name.getText(source);
}

function objectProperties(
  object: ts.ObjectLiteralExpression,
  source: ts.SourceFile,
): Readonly<Record<string, ts.Expression>> {
  const entries: Array<readonly [string, ts.Expression]> = [];
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    entries.push([propertyNameText(property.name, source), property.initializer]);
  }
  return Object.fromEntries(entries);
}

function staticString(expression: ts.Expression, source: ts.SourceFile): string {
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return expression.text;
  }
  throw new Error(
    `Sunset registry extraction failed: expected a static string in ${source.fileName}, got ${expression.getText(source)}.`,
  );
}

function staticStringArray(expression: ts.Expression, source: ts.SourceFile): string[] {
  if (!ts.isArrayLiteralExpression(expression)) {
    throw new Error(
      `Sunset registry extraction failed: expected an array in ${source.fileName}, got ${expression.getText(source)}.`,
    );
  }
  return expression.elements.map((element) => staticString(element, source));
}

function tokenSignature(node: ts.Node, source: ts.SourceFile): string {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    true,
    ts.LanguageVariant.Standard,
    node.getText(source),
  );
  const tokens: string[] = [];
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    tokens.push(scanner.getTokenText());
  }
  return tokens.join('');
}

function tokenFingerprint(node: ts.Node, source: ts.SourceFile): string {
  return createHash('sha256').update(tokenSignature(node, source)).digest('hex');
}

function extractDomainSpecs(): Record<string, SearchProjectionRegistryEntry> {
  const source = parseTypeScript('packages/persistence/src/searchSql.ts');
  const initializer = requireInitializer(source, 'DOMAIN_SPECS');
  if (!ts.isObjectLiteralExpression(initializer)) {
    throw new Error('Sunset registry extraction failed: DOMAIN_SPECS is not an object literal.');
  }

  const result: Record<string, SearchProjectionRegistryEntry> = {};
  for (const property of initializer.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const kind = propertyNameText(property.name, source);
    const wrapped = property.initializer;
    const value =
      ts.isCallExpression(wrapped) && wrapped.arguments.length === 1
        ? wrapped.arguments[0]
        : wrapped;
    if (!value || !ts.isObjectLiteralExpression(value)) {
      throw new Error(`Sunset registry extraction failed: DOMAIN_SPECS.${kind} is not a static object.`);
    }
    const fields = objectProperties(value, source);
    const match = fields.match;
    const table = fields.table;
    const id = fields.id;
    const title = fields.title;
    const subtitle = fields.subtitle;
    const parent = fields.parent;
    if (!match || !table || !id || !title || !subtitle || !parent) {
      throw new Error(`Sunset registry extraction failed: DOMAIN_SPECS.${kind} is incomplete.`);
    }
    result[kind] = {
      table: staticString(table, source),
      match: staticStringArray(match, source),
      id: staticString(id, source),
      title: staticString(title, source),
      subtitle: staticString(subtitle, source),
      parent: staticString(parent, source),
      extraWhere: fields.extraWhere ? staticString(fields.extraWhere, source) : null,
    };
  }
  return result;
}

interface ConditionalPush {
  readonly condition: string;
  readonly values: readonly string[];
}

function collectConditionalPushes(
  source: ts.SourceFile,
  root: ts.Node,
  target: string,
): ConditionalPush[] {
  const result: ConditionalPush[] = [];

  const visit = (node: ts.Node, conditions: readonly string[]): void => {
    if (ts.isIfStatement(node)) {
      const condition = tokenSignature(node.expression, source);
      visit(node.thenStatement, [...conditions, condition]);
      if (node.elseStatement) visit(node.elseStatement, [...conditions, `else(${condition})`]);
      return;
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'push' &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === target
    ) {
      result.push({
        condition: conditions.length === 0 ? 'always' : conditions.join('&&'),
        values: node.arguments.map((argument) => staticString(argument, source)),
      });
    }
    ts.forEachChild(node, (child) => visit(child, conditions));
  };

  visit(root, []);
  return result;
}

function mergePushGates(
  prefix: string,
  pushes: readonly ConditionalPush[],
): Record<string, readonly string[]> {
  const merged: Record<string, string[]> = {};
  for (const push of pushes) {
    const key = `${prefix}:${push.condition}`;
    (merged[key] ??= []).push(...push.values);
  }
  return merged;
}

function extractSearchGateClasses(): Record<string, readonly string[]> {
  const source = parseTypeScript('packages/application/src/usecases/search.ts');
  const globalSearch = findFunction(source, 'globalSearch');
  if (!globalSearch?.body) {
    throw new Error('Sunset registry extraction failed: globalSearch is absent.');
  }

  const finance = requireInitializer(source, 'finance');
  const domains = requireInitializer(source, 'domains');
  const ownerTypes = requireInitializer(source, 'documentOwnerTypes');
  let claimsOwnIdentity: ts.Expression | undefined;
  let actorReadPath: string | undefined;
  let baselineAssertion: string | undefined;

  walk(globalSearch.body, (node) => {
    if (
      ts.isPropertyAssignment(node) &&
      propertyNameText(node.name, source) === 'claimsOwnIdentity'
    ) {
      claimsOwnIdentity = node.initializer;
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'searchTenant'
    ) {
      actorReadPath = tokenSignature(node.expression, source);
    }
    if (
      ts.isExpressionStatement(node) &&
      ts.isCallExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text.startsWith('assert')
    ) {
      baselineAssertion = tokenSignature(node.expression, source);
    }
  });

  if (!claimsOwnIdentity || !actorReadPath || !baselineAssertion) {
    throw new Error('Sunset registry extraction failed: globalSearch gate facts are incomplete.');
  }

  return {
    'assert:baseline': [baselineAssertion],
    'standing:finance': [tokenSignature(finance, source)],
    'domain:baseline': staticStringArray(domains, source),
    ...mergePushGates('domain', collectConditionalPushes(source, globalSearch.body, 'domains')),
    'document-owner:baseline': staticStringArray(ownerTypes, source),
    ...mergePushGates(
      'document-owner',
      collectConditionalPushes(source, globalSearch.body, 'documentOwnerTypes'),
    ),
    'claims-own-identity': [tokenSignature(claimsOwnIdentity, source)],
    'actor-read-path': [actorReadPath],
  };
}

function extractInterfaceFields(relativePath: string, name: string): string[] {
  const source = parseTypeScript(relativePath);
  const declaration = findInterface(source, name);
  if (!declaration) {
    throw new Error(`Sunset registry extraction failed: ${relativePath} has no ${name} interface.`);
  }
  return declaration.members.flatMap((member) => {
    if (!ts.isPropertySignature(member) || !member.name) return [];
    return [propertyNameText(member.name, source)];
  });
}

function callObjectArgument(
  expression: ts.Expression,
  label: string,
): ts.ObjectLiteralExpression {
  if (!ts.isCallExpression(expression) || expression.arguments.length === 0) {
    throw new Error(`Sunset registry extraction failed: ${label} is not a call.`);
  }
  const argument = expression.arguments[0];
  if (!argument || !ts.isObjectLiteralExpression(argument)) {
    throw new Error(`Sunset registry extraction failed: ${label} has no object argument.`);
  }
  return argument;
}

function extractApiResponseFields(): Pick<SearchResponseFieldRegistry, 'envelope' | 'item'> {
  const source = parseTypeScript('packages/api-contracts/src/index.ts');
  const schema = callObjectArgument(
    requireInitializer(source, 'searchResultsSchema'),
    'searchResultsSchema',
  );
  const envelope = Object.keys(objectProperties(schema, source));
  const results = objectProperties(schema, source).results;
  if (!results || !ts.isCallExpression(results) || results.arguments.length === 0) {
    throw new Error('Sunset registry extraction failed: search results envelope has no results array.');
  }
  const itemCall = results.arguments[0];
  if (!itemCall) {
    throw new Error('Sunset registry extraction failed: search results array has no item schema.');
  }
  const item = callObjectArgument(itemCall, 'search result item schema');
  return { envelope, item: Object.keys(objectProperties(item, source)) };
}

function extractSqlCheckValues(relativePath: string, column: string): string[] {
  const source = readRepoFile(relativePath);
  const escapedColumn = column.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escapedColumn}\\s+IN\\s*\\(([^)]*)\\)`, 'i').exec(source);
  if (!match?.[1]) {
    throw new Error(`Sunset registry extraction failed: ${relativePath} has no ${column} IN constraint.`);
  }
  return [...match[1].matchAll(/'([^']+)'/g)].map((candidate) => candidate[1] as string);
}

function extractPredicateRegisters(
  projections: Readonly<Record<string, SearchProjectionRegistryEntry>>,
): Record<string, readonly string[]> {
  const source = parseTypeScript('packages/persistence/src/searchSql.ts');
  const domainBlock = findFunction(source, 'domainBlock');
  const domainBlockTokens = domainBlock ? tokenSignature(domainBlock, source) : '';
  const domainBlockText = domainBlock?.getText(source) ?? '';
  const result: Record<string, string[]> = {};

  for (const [kind, projection] of Object.entries(projections)) {
    if (projection.extraWhere) result[kind] = [`static:${projection.extraWhere}`];
  }
  if (/d\.kind\s*===\s*'claim'/.test(domainBlockText) && domainBlockText.includes('submitted_by')) {
    (result.claim ??= []).push('submitted_by:claimsOwnIdentity:when-non-null');
  }
  if (
    /d\.kind\s*===\s*'document'/.test(domainBlockText) &&
    domainBlockText.includes('documentOwnerTypes') &&
    domainBlockText.includes('owner_type')
  ) {
    (result.document ??= []).push('owner_type:documentOwnerTypes:empty-denies');
  }
  (result.document ??= []).push(
    domainBlockTokens.includes('record_kind')
      ? 'record_kind:search-predicate-present'
      : 'record_kind:search-predicate-absent',
  );

  const authoritativeFunctions: ReadonlyArray<
    readonly [string, string, string, string]
  > = [
    [
      'approval',
      'packages/application/src/usecases/queries.ts',
      'assertViewApprovalsEffective',
      'effective-delegation',
    ],
    [
      'claim-document',
      'packages/application/src/usecases/claimOps.ts',
      'claimReadGuard',
      'submitter-or-finance',
    ],
    [
      'comms-thread',
      'packages/application/src/usecases/commsOps.ts',
      'assertViewCommsThread',
      'anchored-Mission',
    ],
    [
      'comms-document',
      'packages/application/src/usecases/commsOps.ts',
      'commsDocReadGuard',
      'module+owner+thread+anchor',
    ],
    [
      'comms-module',
      'packages/application/src/usecases/commsOps.ts',
      'isEntitlementWritable',
      'active+effective-window',
    ],
  ];
  for (const [register, relativePath, functionName, fact] of authoritativeFunctions) {
    const criticalSource = parseTypeScript(relativePath);
    if (findFunction(criticalSource, functionName)) result[register] = [fact];
  }

  return result;
}

function recursiveRegularFiles(
  relativeRoot: string,
  skipDirectory: (relativePath: string) => boolean = () => false,
): string[] {
  const absoluteRoot = repoPath(relativeRoot);
  const result: string[] = [];
  for (const entry of readdirSync(absoluteRoot, { withFileTypes: true })) {
    const relativeEntry = `${relativeRoot}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!skipDirectory(relativeEntry)) {
        result.push(...recursiveRegularFiles(relativeEntry, skipDirectory));
      }
    } else if (entry.isFile()) {
      result.push(relativeEntry);
    } else {
      throw new Error(
        `Sunset registry refuses an unsupported or symbolic filesystem entry: ${relativeEntry}`,
      );
    }
  }
  return result;
}

function recursiveSourceFiles(relativeRoot: string): string[] {
  return recursiveRegularFiles(relativeRoot).filter((relativePath) =>
    ['.cts', '.mts', '.sql', '.ts', '.tsx'].includes(
      extname(relativePath).toLowerCase(),
    ),
  );
}

function hashableFileContent(relativePath: string): string | Buffer {
  const bytes = readFileSync(repoPath(relativePath));
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (text.includes('\u0000')) return bytes;
    return text.replace(/\r\n/gu, '\n');
  } catch {
    return bytes;
  }
}

export interface SunsetTreeHashEntry {
  readonly relativePath: string;
  readonly content: string | Uint8Array;
}

function uint32(value: number): Buffer {
  const encoded = Buffer.allocUnsafe(4);
  encoded.writeUInt32BE(value);
  return encoded;
}

/**
 * Hashes a tree with unambiguous framing. Each path is length-prefixed and
 * each content body is first reduced to a fixed 32-byte digest, so embedded
 * NULs or path-looking binary bytes cannot merge/split file boundaries.
 */
export function hashSunsetTreeEntries(
  entries: readonly SunsetTreeHashEntry[],
): string {
  const ordered = [...entries].sort((left, right) =>
    left.relativePath < right.relativePath
      ? -1
      : left.relativePath > right.relativePath
        ? 1
        : 0,
  );
  const paths = new Set<string>();
  const hash = createHash('sha256');
  hash.update('HEARTH-SUNSET-TREE-V1\0');
  hash.update(uint32(ordered.length));
  for (const entry of ordered) {
    if (
      entry.relativePath.length === 0 ||
      entry.relativePath.includes('\u0000') ||
      paths.has(entry.relativePath)
    ) {
      throw new Error(
        'Sunset tree entries require unique non-empty NUL-free paths',
      );
    }
    paths.add(entry.relativePath);
    const pathBytes = Buffer.from(entry.relativePath, 'utf8');
    const contentDigest = createHash('sha256')
      .update(entry.content)
      .digest();
    hash.update(uint32(pathBytes.length));
    hash.update(pathBytes);
    hash.update(contentDigest);
  }
  return hash.digest('hex');
}

function hashSunsetTreeFiles(relativePaths: readonly string[]): string {
  return hashSunsetTreeEntries(
    relativePaths.map((relativePath) => ({
      relativePath,
      content: hashableFileContent(relativePath),
    })),
  );
}

function isSunsetEnforcementGeneratedDirectory(
  relativePath: string,
): boolean {
  const root = 'packages/search-harness/';
  if (!relativePath.startsWith(root)) {
    return false;
  }
  const relativeDirectory = relativePath.slice(root.length);
  return (
    !relativeDirectory.includes('/') &&
    SUNSET_ENFORCEMENT_GENERATED_DIRECTORIES.has(
      relativeDirectory.toLowerCase(),
    )
  );
}

export function isSunsetEnforcementTreePath(
  relativePath: string,
): boolean {
  const normalized = relativePath.replaceAll('\\', '/');
  const root = 'packages/search-harness/';
  if (!normalized.startsWith(root)) {
    return false;
  }
  if (SUNSET_ENFORCEMENT_TREE_EXCLUSIONS.has(normalized)) {
    return false;
  }
  const segments = normalized.slice(root.length).split('/');
  if (
    segments.length > 1 &&
    SUNSET_ENFORCEMENT_GENERATED_DIRECTORIES.has(
      segments[0]!.toLowerCase(),
    )
  ) {
    return false;
  }
  const fileName = segments.at(-1);
  const normalizedFileName = fileName?.toLowerCase();
  return (
    normalizedFileName !== undefined &&
    !SUNSET_ENFORCEMENT_GENERATED_FILES.has(normalizedFileName) &&
    !normalizedFileName.endsWith('.log') &&
    !normalizedFileName.endsWith('.tsbuildinfo')
  );
}

export function listSunsetEnforcementTreeFiles(): readonly string[] {
  return recursiveRegularFiles(
    'packages/search-harness',
    isSunsetEnforcementGeneratedDirectory,
  )
    .filter(isSunsetEnforcementTreePath)
    .sort();
}

function extractModuleKeys(): string[] {
  const keys = new Set<string>();
  for (const relativePath of recursiveSourceFiles('packages/domain/src').sort()) {
    const source = parseTypeScript(relativePath);
    walk(source, (node) => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text.endsWith('_MODULE_KEY') &&
        node.initializer &&
        (ts.isStringLiteral(node.initializer) ||
          ts.isNoSubstitutionTemplateLiteral(node.initializer))
      ) {
        keys.add(node.initializer.text);
      }
    });
  }
  if (keys.size === 0) {
    throw new Error(
      'Sunset registry extraction failed: no exported module-key constants were found.',
    );
  }
  return [...keys].sort();
}

function discoverCriticalSources(): string[] {
  const semanticSources = SUNSET_POLICY_ROOTS.flatMap((root) =>
    recursiveSourceFiles(root),
  )
    .filter((relativePath) => {
      const source = readRepoFile(relativePath);
      return CRITICAL_SOURCE_MARKERS.some((marker) => source.includes(marker));
    });
  return [...new Set([...semanticSources, ...SUNSET_WIRING_FILES])].sort();
}

function criticalSourceFingerprints(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [relativePath, names] of Object.entries(CRITICAL_DECLARATIONS)) {
    const source = parseTypeScript(relativePath);
    for (const name of names) {
      const node = findFunction(source, name) ?? findVariable(source, name);
      if (node) result[`${relativePath}#${name}`] = tokenFingerprint(node, source);
    }
  }
  /*
   * The semantic extractors above produce useful, targeted failure paths, but
   * they cannot anticipate a new gate spelling or a forward migration that
   * replaces an old CHECK. Freeze a canonical tree hash for every policy root
   * as the conservative backstop: any source addition, removal, or edit fails
   * the sunset gate until the reviewed coverage manifest is updated.
  */
  for (const root of SUNSET_POLICY_ROOTS) {
    result[`${root}#tree`] = hashSunsetTreeFiles(
      recursiveRegularFiles(root),
    );
  }
  for (const relativePath of SUNSET_FROZEN_DATA_FILES) {
    parseCanonicalFrozenJson(readRepoFile(relativePath), relativePath);
  }
  result[SUNSET_ENFORCEMENT_TREE_KEY] = hashSunsetTreeFiles(
    listSunsetEnforcementTreeFiles(),
  );
  for (const relativePath of SUNSET_WIRING_FILES) {
    result[`${relativePath}#wiring`] = createHash('sha256')
      .update(readRepoFile(relativePath).replace(/\r\n/gu, '\n'))
      .digest('hex');
  }
  return result;
}

export function buildLiveSunsetRegistrySnapshot(): SunsetRegistrySnapshot {
  const projections = extractDomainSpecs();
  const apiResponseFields = extractApiResponseFields();
  const capabilityKeys = Object.keys(capabilitiesFor(C3_ROLES[0]));
  const roleCapabilities = Object.fromEntries(
    C3_ROLES.map((role) => [role, { ...capabilitiesFor(role) }]),
  );

  return {
    roles: [...C3_ROLES],
    capabilityKeys,
    roleCapabilities,
    moduleKeys: extractModuleKeys(),
    entitlementStates: extractSqlCheckValues(
      'packages/persistence/migrations/0088_module_entitlements.sql',
      'state',
    ),
    entitlementSnapshots: [...ENTITLEMENT_SNAPSHOTS],
    searchDomains: [...SEARCH_DOMAINS],
    applicationResultKinds: [...APPLICATION_SEARCH_RESULT_KINDS],
    contractResultKinds: [...CONTRACT_SEARCH_RESULT_KINDS],
    gateClasses: extractSearchGateClasses(),
    predicateRegisters: extractPredicateRegisters(projections),
    documentOwnerTypes: [...DOCUMENT_OWNER_TYPES],
    recordKinds: extractSqlCheckValues(
      'packages/persistence/migrations/0089_document_comms_owner_types.sql',
      'record_kind',
    ),
    matchFields: Object.fromEntries(
      Object.entries(projections).map(([kind, projection]) => [kind, [...projection.match]]),
    ),
    responseFields: {
      ...apiResponseFields,
      application: extractInterfaceFields(
        'packages/application/src/usecases/search.ts',
        'SearchResult',
      ),
      persistence: extractInterfaceFields(
        'packages/application/src/ports.ts',
        'TenantSearchRow',
      ),
    },
    projections,
    criticalSources: discoverCriticalSources(),
    criticalSourceFingerprints: criticalSourceFingerprints(),
  };
}

export function searchHarnessWebv0Root(): string {
  return dirname(repoPath('package.json'));
}
