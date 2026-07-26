/**
 * HEARTH-003 projection-authority parser
 *
 * This module parses exact, already-pinned searchSql.ts source text. It never
 * imports or executes C3 search code. The caller supplies the TypeScript
 * compiler API object so dependency resolution remains under the caller's
 * pinned workspace.
 *
 * The accepted source shape is intentionally narrow. A refactor of
 * DOMAIN_SPECS or domainBlock must fail until this parser is reviewed and
 * extended; unfamiliar syntax may never be interpreted optimistically.
 */

import { createHash } from 'node:crypto';

export const PROJECTION_AUTHORITY_PARSER_VERSION =
  'HEARTH-003-PROJECTION-AUTHORITY-PARSER-v2' as const;

const EXPECTED_DOMAIN_COUNT = 17;
const SIMPLE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/u;
const SIMPLE_JS_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const UNSAFE_SQL_FRAGMENT = /(?:\0|\r|\n|;|--|\/\*|\*\/)/u;
const REQUIRED_SPEC_FIELDS = Object.freeze([
  'kind',
  'table',
  'match',
  'id',
  'title',
  'subtitle',
  'parent',
] as const);
const OPTIONAL_SPEC_FIELDS = Object.freeze(['extraWhere'] as const);
const ALL_SPEC_FIELDS = new Set<string>([
  ...REQUIRED_SPEC_FIELDS,
  ...OPTIONAL_SPEC_FIELDS,
]);

export interface ProjectionAuthoritySpec {
  readonly kind: string;
  readonly table: string;
  readonly match: readonly string[];
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly parent: string;
  readonly extraWhere: string | null;
}

export interface GuardAuthorityProgram {
  readonly baseHit: {
    readonly matchSource: string;
    readonly columnTransform: 'lower';
    readonly operator: 'LIKE';
    readonly queryParameter: string;
    readonly queryTransform: 'postgres_like_escape_contains';
    readonly join: 'OR';
  };
  readonly extraWhere: {
    readonly presenceSource: 'd.extraWhere';
    readonly rendering: 'parenthesized_sql_raw';
  };
  readonly scalarNullableGate: {
    readonly register: string;
    readonly parameter: string;
    readonly activeWhen: 'not_null';
    readonly column: string;
    readonly operator: '=';
  };
  readonly listGate: {
    readonly register: string;
    readonly parameter: string;
    readonly column: string;
    readonly operator: 'IN';
    readonly emptyBehavior: 'false';
    readonly elementBinding: 'all';
    readonly separator: ', ';
  };
  readonly constructionSiteCount: 5;
  readonly pushSiteCount: 4;
  readonly consumerCount: 1;
}

export interface ProjectionAuthorityParseResult {
  readonly parserVersion: typeof PROJECTION_AUTHORITY_PARSER_VERSION;
  readonly typescriptVersion: string;
  /** Canonical ASCII-by-kind ordering. */
  readonly specs: readonly ProjectionAuthoritySpec[];
  /** Canonical ASCII ordering, derived only from non-null extraWhere values. */
  readonly staticGuardRegisters: readonly string[];
  /** Complete fail-closed runtime guard program derived from domainBlock. */
  readonly guardProgram: GuardAuthorityProgram;
  /** SHA-256 of canonical JSON for projection specs only. */
  readonly projectionSemanticHash: string;
  /** SHA-256 of canonical JSON for the runtime guard program only. */
  readonly guardSemanticHash: string;
  /** SHA-256 of canonical JSON for specs plus the guard program. */
  readonly semanticHash: string;
}

export interface ProjectionAuthoritySelfTestResult {
  readonly parserVersion: typeof PROJECTION_AUTHORITY_PARSER_VERSION;
  readonly baselineSemanticHash: string;
  readonly projectionExpressionTamperChangesSemanticHash: true;
  readonly claimColumnTamperChangesGuardSemanticHash: true;
  readonly deadBaseHitTamperRejected: true;
  readonly deadExtraWhereTamperRejected: true;
  readonly deadClaimGateTamperRejected: true;
  readonly documentFalseToTrueTamperRejected: true;
  readonly deadDocumentListGateTamperRejected: true;
  readonly unknownGuardPushTamperRejected: true;
}

export class ProjectionAuthorityParseError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ProjectionAuthorityParseError';
  }
}

interface AstNode {
  readonly kind: number;
  readonly flags?: unknown;
  readonly statements?: unknown;
  readonly declarationList?: unknown;
  readonly declarations?: unknown;
  readonly name?: unknown;
  readonly initializer?: unknown;
  readonly properties?: unknown;
  readonly expression?: unknown;
  readonly arguments?: unknown;
  readonly typeArguments?: unknown;
  readonly elements?: unknown;
  readonly text?: unknown;
  readonly body?: unknown;
  readonly parameters?: unknown;
  readonly condition?: unknown;
  readonly thenStatement?: unknown;
  readonly elseStatement?: unknown;
  readonly tag?: unknown;
  readonly template?: unknown;
  readonly head?: unknown;
  readonly templateSpans?: unknown;
  readonly literal?: unknown;
  readonly parseDiagnostics?: unknown;
  readonly getStart?: unknown;
  readonly getEnd?: unknown;
}

type NodePredicate = (node: AstNode) => boolean;

interface CompilerApi {
  readonly version: string;
  readonly ScriptTarget: {
    readonly Latest: number;
  };
  readonly ScriptKind: {
    readonly TS: number;
  };
  readonly NodeFlags: {
    readonly Const: number;
  };
  readonly createSourceFile: (
    fileName: string,
    sourceText: string,
    languageVersion: number,
    setParentNodes: boolean,
    scriptKind: number,
  ) => AstNode;
  readonly forEachChild: (
    node: AstNode,
    callback: (child: AstNode) => void,
  ) => unknown;
  readonly isVariableStatement: NodePredicate;
  readonly isVariableDeclaration: NodePredicate;
  readonly isIdentifier: NodePredicate;
  readonly isObjectLiteralExpression: NodePredicate;
  readonly isPropertyAssignment: NodePredicate;
  readonly isCallExpression: NodePredicate;
  readonly isStringLiteral: NodePredicate;
  readonly isNoSubstitutionTemplateLiteral: NodePredicate;
  readonly isArrayLiteralExpression: NodePredicate;
  readonly isFunctionDeclaration: NodePredicate;
  readonly isIfStatement: NodePredicate;
  readonly isExpressionStatement: NodePredicate;
  readonly isPropertyAccessExpression: NodePredicate;
  readonly isTaggedTemplateExpression: NodePredicate;
  readonly isReturnStatement: NodePredicate;
  readonly isTemplateExpression: NodePredicate;
  readonly isBlock: NodePredicate;
}

interface TextRange {
  readonly start: number;
  readonly end: number;
}

interface TitleRange extends TextRange {
  readonly expression: string;
}

interface InternalParseResult {
  readonly publicResult: ProjectionAuthorityParseResult;
  readonly titleRanges: readonly TitleRange[];
  readonly extraWhereConsumerRange: TextRange;
  readonly baseHitRange: TextRange;
  readonly claimGateRange: TextRange;
  readonly claimColumnRange: TextRange;
  readonly documentFalseRange: TextRange;
  readonly documentListGateRange: TextRange;
  readonly returnRange: TextRange;
}

function fail(message: string): never {
  throw new ProjectionAuthorityParseError(message);
}

function assert(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) fail(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireCompilerApi(value: unknown): CompilerApi {
  assert(isRecord(value), 'TypeScript compiler API must be an object');
  assert(
    typeof value.version === 'string' && value.version.length > 0,
    'TypeScript compiler API version is unavailable',
  );

  const functions = [
    'createSourceFile',
    'forEachChild',
    'isVariableStatement',
    'isVariableDeclaration',
    'isIdentifier',
    'isObjectLiteralExpression',
    'isPropertyAssignment',
    'isCallExpression',
    'isStringLiteral',
    'isNoSubstitutionTemplateLiteral',
    'isArrayLiteralExpression',
    'isFunctionDeclaration',
    'isIfStatement',
    'isExpressionStatement',
    'isPropertyAccessExpression',
    'isTaggedTemplateExpression',
    'isReturnStatement',
    'isTemplateExpression',
    'isBlock',
  ] as const;
  for (const name of functions) {
    assert(
      typeof value[name] === 'function',
      `TypeScript compiler API is missing ${name}()`,
    );
  }

  assert(
    isRecord(value.ScriptTarget) &&
      typeof value.ScriptTarget.Latest === 'number',
    'TypeScript compiler API is missing ScriptTarget.Latest',
  );
  assert(
    isRecord(value.ScriptKind) && typeof value.ScriptKind.TS === 'number',
    'TypeScript compiler API is missing ScriptKind.TS',
  );
  assert(
    isRecord(value.NodeFlags) && typeof value.NodeFlags.Const === 'number',
    'TypeScript compiler API is missing NodeFlags.Const',
  );

  return value as unknown as CompilerApi;
}

function requireNode(value: unknown, label: string): AstNode {
  assert(
    isRecord(value) && typeof value.kind === 'number',
    `${label} must be a TypeScript AST node`,
  );
  return value as unknown as AstNode;
}

function requireNodeArray(
  value: unknown,
  label: string,
): readonly AstNode[] {
  assert(Array.isArray(value), `${label} must be a TypeScript NodeArray`);
  return value.map((entry, index) =>
    requireNode(entry, `${label}[${index}]`),
  );
}

function optionalNodeArray(
  value: unknown,
  label: string,
): readonly AstNode[] {
  if (value === undefined) return [];
  return requireNodeArray(value, label);
}

function requireNodeText(node: AstNode, label: string): string {
  assert(typeof node.text === 'string', `${label} must carry literal text`);
  return node.text;
}

function requireRange(
  node: AstNode,
  sourceFile: AstNode,
  label: string,
): TextRange {
  assert(
    typeof node.getStart === 'function' && typeof node.getEnd === 'function',
    `${label} does not expose a stable source range`,
  );
  const start = (node.getStart as (source?: AstNode) => unknown).call(
    node,
    sourceFile,
  );
  const end = (node.getEnd as () => unknown).call(node);
  assert(
    Number.isSafeInteger(start) &&
      Number.isSafeInteger(end) &&
      Number(start) >= 0 &&
      Number(end) > Number(start),
    `${label} has an invalid source range`,
  );
  return { start: Number(start), end: Number(end) };
}

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort(compareAscii)) {
      output[key] = canonicalize(value[key]);
    }
    return output;
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function sha256Utf8(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function assertSimpleIdentifier(value: string, label: string): void {
  assert(
    SIMPLE_IDENTIFIER.test(value),
    `${label} is not a safe simple SQL identifier`,
  );
}

function assertSimpleJsIdentifier(value: string, label: string): void {
  assert(
    SIMPLE_JS_IDENTIFIER.test(value),
    `${label} is not a simple JavaScript identifier`,
  );
}

function assertSafeSqlFragment(value: string, label: string): void {
  assert(value.length > 0, `${label} must be non-empty`);
  assert(
    !UNSAFE_SQL_FRAGMENT.test(value),
    `${label} contains a forbidden SQL delimiter`,
  );
}

function identifierText(
  ts: CompilerApi,
  nodeValue: unknown,
  label: string,
): string {
  const node = requireNode(nodeValue, label);
  assert(ts.isIdentifier(node), `${label} must be an identifier`);
  return requireNodeText(node, label);
}

function literalText(
  ts: CompilerApi,
  nodeValue: unknown,
  label: string,
): string {
  const node = requireNode(nodeValue, label);
  assert(
    ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node),
    `${label} must be a string literal or a template literal without substitutions`,
  );
  return requireNodeText(node, label);
}

function isIdentifierNamed(
  ts: CompilerApi,
  nodeValue: unknown,
  expected: string,
): boolean {
  if (!isRecord(nodeValue) || typeof nodeValue.kind !== 'number') return false;
  const node = nodeValue as unknown as AstNode;
  return ts.isIdentifier(node) && node.text === expected;
}

function isPropertyAccessNamed(
  ts: CompilerApi,
  nodeValue: unknown,
  receiver: string,
  property: string,
): boolean {
  if (!isRecord(nodeValue) || typeof nodeValue.kind !== 'number') return false;
  const node = nodeValue as unknown as AstNode;
  if (!ts.isPropertyAccessExpression(node)) return false;
  return (
    isIdentifierNamed(ts, node.expression, receiver) &&
    isIdentifierNamed(ts, node.name, property)
  );
}

function collectNodes(
  ts: CompilerApi,
  root: AstNode,
  predicate: NodePredicate,
): readonly AstNode[] {
  const result: AstNode[] = [];
  const visit = (node: AstNode): void => {
    if (predicate(node)) result.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return result;
}

function parseSourceFile(
  ts: CompilerApi,
  sourceText: string,
): AstNode {
  assert(typeof sourceText === 'string', 'searchSql.ts source must be text');
  assert(sourceText.length > 0, 'searchSql.ts source must be non-empty');
  const sourceFile = ts.createSourceFile(
    'searchSql.ts',
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const diagnostics = sourceFile.parseDiagnostics;
  assert(
    Array.isArray(diagnostics),
    'TypeScript source file did not expose parse diagnostics',
  );
  assert(
    diagnostics.length === 0,
    `searchSql.ts has ${diagnostics.length} parse diagnostic(s)`,
  );
  return sourceFile;
}

function findDomainSpecsDeclaration(
  ts: CompilerApi,
  sourceFile: AstNode,
): AstNode {
  const matches: Array<{
    readonly declaration: AstNode;
    readonly declarationList: AstNode;
  }> = [];

  const statements = requireNodeArray(
    sourceFile.statements,
    'searchSql.ts statements',
  );
  for (const statement of statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const declarationList = requireNode(
      statement.declarationList,
      'variable declaration list',
    );
    const declarations = requireNodeArray(
      declarationList.declarations,
      'variable declarations',
    );
    for (const declaration of declarations) {
      assert(
        ts.isVariableDeclaration(declaration),
        'variable declaration list contains unfamiliar syntax',
      );
      if (
        isIdentifierNamed(
          ts,
          declaration.name,
          'DOMAIN_SPECS',
        )
      ) {
        matches.push({ declaration, declarationList });
      }
    }
  }

  assert(
    matches.length === 1,
    `searchSql.ts must declare DOMAIN_SPECS exactly once; found ${matches.length}`,
  );
  const match = matches[0]!;
  assert(
    typeof match.declarationList.flags === 'number' &&
      (match.declarationList.flags & ts.NodeFlags.Const) !== 0,
    'DOMAIN_SPECS must be declared const',
  );
  assert(
    requireNodeArray(
      match.declarationList.declarations,
      'DOMAIN_SPECS declaration list',
    ).length === 1,
    'DOMAIN_SPECS must be the only declaration in its const statement',
  );
  return match.declaration;
}

function parseDomainSpecs(
  ts: CompilerApi,
  sourceFile: AstNode,
): {
  readonly specs: readonly ProjectionAuthoritySpec[];
  readonly titleRanges: readonly TitleRange[];
} {
  const declaration = findDomainSpecsDeclaration(ts, sourceFile);
  const initializer = requireNode(
    declaration.initializer,
    'DOMAIN_SPECS initializer',
  );
  assert(
    ts.isObjectLiteralExpression(initializer),
    'DOMAIN_SPECS initializer must be a direct object literal',
  );

  const outerProperties = requireNodeArray(
    initializer.properties,
    'DOMAIN_SPECS properties',
  );
  assert(
    outerProperties.length === EXPECTED_DOMAIN_COUNT,
    `DOMAIN_SPECS must contain exactly ${EXPECTED_DOMAIN_COUNT} domains; found ${outerProperties.length}`,
  );

  const specs: ProjectionAuthoritySpec[] = [];
  const titleRanges: TitleRange[] = [];
  const domainNames = new Set<string>();

  for (const [domainIndex, outerProperty] of outerProperties.entries()) {
    const domainLabel = `DOMAIN_SPECS property ${domainIndex}`;
    assert(
      ts.isPropertyAssignment(outerProperty),
      `${domainLabel} must be a direct property assignment; spreads, methods, and shorthand are forbidden`,
    );
    const domainName = identifierText(
      ts,
      outerProperty.name,
      `${domainLabel} name`,
    );
    assertSimpleIdentifier(domainName, `${domainLabel} name`);
    assert(
      !domainNames.has(domainName),
      `DOMAIN_SPECS contains duplicate domain ${domainName}`,
    );
    domainNames.add(domainName);

    const wrapperCall = requireNode(
      outerProperty.initializer,
      `DOMAIN_SPECS.${domainName} initializer`,
    );
    assert(
      ts.isCallExpression(wrapperCall),
      `DOMAIN_SPECS.${domainName} must be initialized by D({...})`,
    );
    assert(
      isIdentifierNamed(ts, wrapperCall.expression, 'D'),
      `DOMAIN_SPECS.${domainName} must call D exactly`,
    );
    assert(
      optionalNodeArray(
        wrapperCall.typeArguments,
        `DOMAIN_SPECS.${domainName} type arguments`,
      ).length === 0,
      `DOMAIN_SPECS.${domainName} D() call may not have type arguments`,
    );
    const wrapperArguments = requireNodeArray(
      wrapperCall.arguments,
      `DOMAIN_SPECS.${domainName} D() arguments`,
    );
    assert(
      wrapperArguments.length === 1,
      `DOMAIN_SPECS.${domainName} D() must receive exactly one argument`,
    );
    const specObject = wrapperArguments[0]!;
    assert(
      ts.isObjectLiteralExpression(specObject),
      `DOMAIN_SPECS.${domainName} D() argument must be a direct object literal`,
    );

    const fieldInitializers = new Map<string, AstNode>();
    const fields = requireNodeArray(
      specObject.properties,
      `DOMAIN_SPECS.${domainName} fields`,
    );
    for (const [fieldIndex, field] of fields.entries()) {
      assert(
        ts.isPropertyAssignment(field),
        `DOMAIN_SPECS.${domainName} field ${fieldIndex} must be a direct property assignment; spreads, methods, and shorthand are forbidden`,
      );
      const fieldName = identifierText(
        ts,
        field.name,
        `DOMAIN_SPECS.${domainName} field ${fieldIndex} name`,
      );
      assert(
        ALL_SPEC_FIELDS.has(fieldName),
        `DOMAIN_SPECS.${domainName} contains unknown field ${fieldName}`,
      );
      assert(
        !fieldInitializers.has(fieldName),
        `DOMAIN_SPECS.${domainName} contains duplicate field ${fieldName}`,
      );
      fieldInitializers.set(
        fieldName,
        requireNode(
          field.initializer,
          `DOMAIN_SPECS.${domainName}.${fieldName}`,
        ),
      );
    }
    for (const field of REQUIRED_SPEC_FIELDS) {
      assert(
        fieldInitializers.has(field),
        `DOMAIN_SPECS.${domainName} is missing required field ${field}`,
      );
    }

    const kind = literalText(
      ts,
      fieldInitializers.get('kind'),
      `DOMAIN_SPECS.${domainName}.kind`,
    );
    assertSimpleIdentifier(kind, `DOMAIN_SPECS.${domainName}.kind`);
    assert(
      kind === domainName,
      `DOMAIN_SPECS.${domainName}.kind must equal its outer domain key`,
    );

    const table = literalText(
      ts,
      fieldInitializers.get('table'),
      `DOMAIN_SPECS.${domainName}.table`,
    );
    assertSimpleIdentifier(table, `DOMAIN_SPECS.${domainName}.table`);

    const matchNode = requireNode(
      fieldInitializers.get('match'),
      `DOMAIN_SPECS.${domainName}.match`,
    );
    assert(
      ts.isArrayLiteralExpression(matchNode),
      `DOMAIN_SPECS.${domainName}.match must be a direct array literal`,
    );
    const match = requireNodeArray(
      matchNode.elements,
      `DOMAIN_SPECS.${domainName}.match elements`,
    ).map((element, matchIndex) => {
      const value = literalText(
        ts,
        element,
        `DOMAIN_SPECS.${domainName}.match[${matchIndex}]`,
      );
      assertSimpleIdentifier(
        value,
        `DOMAIN_SPECS.${domainName}.match[${matchIndex}]`,
      );
      return value;
    });
    assert(
      match.length > 0,
      `DOMAIN_SPECS.${domainName}.match must be non-empty`,
    );
    assert(
      new Set(match).size === match.length,
      `DOMAIN_SPECS.${domainName}.match contains duplicate columns`,
    );

    const id = literalText(
      ts,
      fieldInitializers.get('id'),
      `DOMAIN_SPECS.${domainName}.id`,
    );
    assertSimpleIdentifier(id, `DOMAIN_SPECS.${domainName}.id`);
    assert(
      match[0] === id,
      `DOMAIN_SPECS.${domainName}.match[0] must equal id`,
    );

    const titleNode = fieldInitializers.get('title')!;
    const title = literalText(
      ts,
      titleNode,
      `DOMAIN_SPECS.${domainName}.title`,
    );
    const subtitle = literalText(
      ts,
      fieldInitializers.get('subtitle'),
      `DOMAIN_SPECS.${domainName}.subtitle`,
    );
    const parent = literalText(
      ts,
      fieldInitializers.get('parent'),
      `DOMAIN_SPECS.${domainName}.parent`,
    );
    assertSafeSqlFragment(title, `DOMAIN_SPECS.${domainName}.title`);
    assertSafeSqlFragment(
      subtitle,
      `DOMAIN_SPECS.${domainName}.subtitle`,
    );
    assertSafeSqlFragment(parent, `DOMAIN_SPECS.${domainName}.parent`);

    const extraWhereNode = fieldInitializers.get('extraWhere');
    const extraWhere =
      extraWhereNode === undefined
        ? null
        : literalText(
            ts,
            extraWhereNode,
            `DOMAIN_SPECS.${domainName}.extraWhere`,
          );
    if (extraWhere !== null) {
      assertSafeSqlFragment(
        extraWhere,
        `DOMAIN_SPECS.${domainName}.extraWhere`,
      );
    }

    const titleRange = requireRange(
      titleNode,
      sourceFile,
      `DOMAIN_SPECS.${domainName}.title`,
    );
    titleRanges.push({ ...titleRange, expression: title });
    specs.push({
      kind,
      table,
      match: Object.freeze([...match]),
      id,
      title,
      subtitle,
      parent,
      extraWhere,
    });
  }

  specs.sort((left, right) => compareAscii(left.kind, right.kind));
  titleRanges.sort((left, right) => left.start - right.start);
  return {
    specs: Object.freeze(
      specs.map((spec) => Object.freeze({ ...spec })),
    ),
    titleRanges: Object.freeze(
      titleRanges.map((range) => Object.freeze({ ...range })),
    ),
  };
}

function findDomainBlock(
  ts: CompilerApi,
  sourceFile: AstNode,
): AstNode {
  const matches = requireNodeArray(
    sourceFile.statements,
    'searchSql.ts statements',
  ).filter(
    (statement) =>
      ts.isFunctionDeclaration(statement) &&
      isIdentifierNamed(ts, statement.name, 'domainBlock'),
  );
  assert(
    matches.length === 1,
    `searchSql.ts must declare domainBlock exactly once; found ${matches.length}`,
  );
  const domainBlock = matches[0]!;
  const parameters = requireNodeArray(
    domainBlock.parameters,
    'domainBlock parameters',
  );
  assert(
    parameters.length === 2 &&
      isIdentifierNamed(ts, parameters[0]?.name, 'spec') &&
      isIdentifierNamed(ts, parameters[1]?.name, 'd'),
    'domainBlock parameters must remain exactly (spec, d)',
  );
  const body = requireNode(domainBlock.body, 'domainBlock body');
  assert(ts.isBlock(body), 'domainBlock must have a direct block body');
  return body;
}

function requireCall(
  ts: CompilerApi,
  nodeValue: unknown,
  receiver: string,
  method: string,
  label: string,
): AstNode {
  const node = requireNode(nodeValue, label);
  assert(ts.isCallExpression(node), `${label} must be a call expression`);
  assert(
    isPropertyAccessNamed(ts, node.expression, receiver, method),
    `${label} must call ${receiver}.${method}()`,
  );
  return node;
}

function validateExtraWhereConsumer(
  ts: CompilerApi,
  sourceFile: AstNode,
  domainBlockBody: AstNode,
): TextRange {
  const extraWhereIfs = collectNodes(
    ts,
    domainBlockBody,
    (node) =>
      ts.isIfStatement(node) &&
      isPropertyAccessNamed(ts, node.expression, 'd', 'extraWhere'),
  );
  assert(
    extraWhereIfs.length === 1,
    `domainBlock must contain exactly one d.extraWhere conditional; found ${extraWhereIfs.length}`,
  );
  const extraWhereIf = extraWhereIfs[0]!;
  assert(
    extraWhereIf.elseStatement === undefined,
    'domainBlock d.extraWhere conditional may not have an else branch',
  );

  const thenStatement = requireNode(
    extraWhereIf.thenStatement,
    'domainBlock d.extraWhere then statement',
  );
  assert(
    ts.isExpressionStatement(thenStatement),
    'domainBlock d.extraWhere must directly execute guards.push(...)',
  );
  const pushCall = requireCall(
    ts,
    thenStatement.expression,
    'guards',
    'push',
    'domainBlock d.extraWhere consumer',
  );
  const pushArguments = requireNodeArray(
    pushCall.arguments,
    'domainBlock guards.push arguments',
  );
  assert(
    pushArguments.length === 1,
    'domainBlock guards.push must receive exactly one argument',
  );

  const rawCall = requireCall(
    ts,
    pushArguments[0],
    'sql',
    'raw',
    'domainBlock d.extraWhere raw guard',
  );
  const rawArguments = requireNodeArray(
    rawCall.arguments,
    'domainBlock sql.raw arguments',
  );
  assert(
    rawArguments.length === 1,
    'domainBlock extraWhere sql.raw must receive exactly one argument',
  );
  const template = rawArguments[0]!;
  assert(
    ts.isTemplateExpression(template),
    'domainBlock extraWhere sql.raw argument must be the exact parenthesized template',
  );
  const head = requireNode(
    template.head,
    'domainBlock extraWhere template head',
  );
  const spans = requireNodeArray(
    template.templateSpans,
    'domainBlock extraWhere template spans',
  );
  assert(
    requireNodeText(head, 'domainBlock extraWhere template head') === '(' &&
      spans.length === 1,
    'domainBlock extraWhere template must contain exactly (${d.extraWhere})',
  );
  const span = spans[0]!;
  assert(
    isPropertyAccessNamed(
      ts,
      span.expression,
      'd',
      'extraWhere',
    ),
    'domainBlock extraWhere template must interpolate d.extraWhere',
  );
  const tail = requireNode(
    span.literal,
    'domainBlock extraWhere template tail',
  );
  assert(
    requireNodeText(tail, 'domainBlock extraWhere template tail') === ')',
    'domainBlock extraWhere template must close with one parenthesis',
  );

  const allExtraWhereAccesses = collectNodes(
    ts,
    domainBlockBody,
    (node) =>
      ts.isPropertyAccessExpression(node) &&
      isPropertyAccessNamed(ts, node, 'd', 'extraWhere'),
  );
  assert(
    allExtraWhereAccesses.length === 2,
    `domainBlock must reference d.extraWhere exactly twice; found ${allExtraWhereAccesses.length}`,
  );
  return requireRange(
    extraWhereIf,
    sourceFile,
    'domainBlock d.extraWhere conditional',
  );
}

interface SourcePatternMatch {
  readonly match: RegExpMatchArray;
  readonly range: TextRange;
  readonly fullText: string;
}

function requireUniqueSourcePattern(
  sourceText: string,
  bodyText: string,
  bodyStart: number,
  pattern: RegExp,
  label: string,
): SourcePatternMatch {
  assert(
    pattern.global,
    `${label} source pattern must be global`,
  );
  pattern.lastIndex = 0;
  const matches = [...bodyText.matchAll(pattern)];
  assert(
    matches.length === 1,
    `${label} must occur exactly once in domainBlock; found ${matches.length}`,
  );
  const match = matches[0]!;
  assert(
    typeof match.index === 'number' && match[0].length > 0,
    `${label} did not expose a stable source range`,
  );
  const start = bodyStart + match.index;
  const end = start + match[0].length;
  assert(
    sourceText.slice(start, end) === match[0],
    `${label} source range does not round-trip`,
  );
  return {
    match,
    range: { start, end },
    fullText: match[0],
  };
}

function captureText(
  result: SourcePatternMatch,
  captureIndex: number,
  label: string,
): string {
  const value = result.match[captureIndex];
  assert(
    typeof value === 'string' && value.length > 0,
    `${label} capture is unavailable`,
  );
  return value;
}

function captureRange(
  result: SourcePatternMatch,
  captureIndex: number,
  label: string,
): TextRange {
  const value = captureText(result, captureIndex, label);
  const relative = result.fullText.indexOf(value);
  assert(relative >= 0, `${label} capture is outside its source match`);
  return {
    start: result.range.start + relative,
    end: result.range.start + relative + value.length,
  };
}

interface GuardProgramDerivation {
  readonly program: GuardAuthorityProgram;
  readonly baseHitRange: TextRange;
  readonly claimGateRange: TextRange;
  readonly claimColumnRange: TextRange;
  readonly documentFalseRange: TextRange;
  readonly documentListGateRange: TextRange;
  readonly returnRange: TextRange;
}

function deriveGuardAuthorityProgram(
  sourceText: string,
  sourceFile: AstNode,
  domainBlockBody: AstNode,
  extraWhereRange: TextRange,
): GuardProgramDerivation {
  const bodyRange = requireRange(
    domainBlockBody,
    sourceFile,
    'domainBlock body',
  );
  const bodyText = sourceText.slice(bodyRange.start, bodyRange.end);

  const like = requireUniqueSourcePattern(
    sourceText,
    bodyText,
    bodyRange.start,
    /const\s+like\s*=\s*`%\$\{escapeLike\(spec\.([A-Za-z_][A-Za-z0-9_]*)\)\}%`;/gu,
    'domainBlock contains-query binding',
  );
  const matchExprs = requireUniqueSourcePattern(
    sourceText,
    bodyText,
    bodyRange.start,
    /const\s+matchExprs\s*=\s*d\.([a-z_][a-z0-9_]*)\.map\(\(([a-z_][a-z0-9_]*)\)\s*=>\s*sql\.raw\(`lower\(\$\{\2\}\)`\)\);/gu,
    'domainBlock match-column lowering',
  );
  const hit = requireUniqueSourcePattern(
    sourceText,
    bodyText,
    bodyRange.start,
    /const\s+hit\s*=\s*sql\.join\(\s*matchExprs\.map\(\(([a-z_][a-z0-9_]*)\)\s*=>\s*sql`\$\{\1\}\s+LIKE\s+\$\{like\}`\),\s*sql`\s+OR\s+`,\s*\);/gu,
    'domainBlock hit OR program',
  );
  const guardInitializer = requireUniqueSourcePattern(
    sourceText,
    bodyText,
    bodyRange.start,
    /const\s+guards\s*:\s*SQL\[\]\s*=\s*\[sql`\(\$\{hit\}\)`\];/gu,
    'domainBlock base guard initializer',
  );
  const claimGate = requireUniqueSourcePattern(
    sourceText,
    bodyText,
    bodyRange.start,
    /if\s*\(\s*d\.kind\s*===\s*'([a-z_][a-z0-9_]*)'\s*&&\s*spec\.([A-Za-z_][A-Za-z0-9_]*)\s*!==\s*null\s*\)\s*guards\.push\(sql`([a-z_][a-z0-9_]*)\s*=\s*\$\{spec\.\2\}`\);/gu,
    'domainBlock nullable scalar guard',
  );
  const documentOuter = requireUniqueSourcePattern(
    sourceText,
    bodyText,
    bodyRange.start,
    /if\s*\(\s*d\.kind\s*===\s*'([a-z_][a-z0-9_]*)'\s*\)\s*\{/gu,
    'domainBlock list-guard register branch',
  );
  const documentEmpty = requireUniqueSourcePattern(
    sourceText,
    bodyText,
    bodyRange.start,
    /if\s*\(\s*spec\.([A-Za-z_][A-Za-z0-9_]*)\.length\s*===\s*0\s*\)\s*guards\.push\(sql\.raw\('(false)'\)\);/gu,
    'domainBlock empty-list false branch',
  );
  const documentList = requireUniqueSourcePattern(
    sourceText,
    bodyText,
    bodyRange.start,
    /else\s+guards\.push\(\s*sql`([a-z_][a-z0-9_]*)\s+IN\s+\(\$\{sql\.join\(\s*spec\.([A-Za-z_][A-Za-z0-9_]*)\.map\(\(([A-Za-z_][A-Za-z0-9_]*)\)\s*=>\s*sql`\$\{\3\}`\),\s*sql`,\s*`,\s*\)\}\)`\s*,\s*\);\s*\}/gu,
    'domainBlock nonempty list guard',
  );
  const returnToken = requireUniqueSourcePattern(
    sourceText,
    bodyText,
    bodyRange.start,
    /\b(return)\s+sql`/gu,
    'domainBlock return',
  );

  const queryParameter = captureText(
    like,
    1,
    'contains-query parameter',
  );
  const matchSource = captureText(
    matchExprs,
    1,
    'match source',
  );
  const matchBinding = captureText(
    matchExprs,
    2,
    'match map binding',
  );
  const hitBinding = captureText(hit, 1, 'hit map binding');
  const scalarRegister = captureText(
    claimGate,
    1,
    'scalar-gate register',
  );
  const scalarParameter = captureText(
    claimGate,
    2,
    'scalar-gate parameter',
  );
  const scalarColumn = captureText(
    claimGate,
    3,
    'scalar-gate column',
  );
  const listRegister = captureText(
    documentOuter,
    1,
    'list-gate register',
  );
  const emptyParameter = captureText(
    documentEmpty,
    1,
    'empty-list parameter',
  );
  const listColumn = captureText(
    documentList,
    1,
    'list-gate column',
  );
  const listParameter = captureText(
    documentList,
    2,
    'list-gate parameter',
  );
  const listBinding = captureText(
    documentList,
    3,
    'list map binding',
  );

  for (const [value, label] of [
    [matchSource, 'match source'],
    [matchBinding, 'match binding'],
    [hitBinding, 'hit binding'],
    [scalarRegister, 'scalar register'],
    [scalarColumn, 'scalar column'],
    [listRegister, 'list register'],
    [listColumn, 'list column'],
  ] as const) {
    assertSimpleIdentifier(value, label);
  }
  for (const [value, label] of [
    [queryParameter, 'contains-query parameter'],
    [scalarParameter, 'scalar parameter'],
    [emptyParameter, 'empty-list parameter'],
    [listParameter, 'list parameter'],
    [listBinding, 'list binding'],
  ] as const) {
    assertSimpleJsIdentifier(value, label);
  }
  assert(
    emptyParameter === listParameter,
    'domainBlock empty and nonempty list branches must use one parameter',
  );
  assert(
    scalarRegister !== listRegister,
    'scalar and list guards must remain distinct register branches',
  );

  const pushes = bodyText.match(/\bguards\.push\s*\(/gu) ?? [];
  assert(
    pushes.length === 4,
    `domainBlock must contain exactly four guards.push sites; found ${pushes.length}`,
  );
  const guardIdentifiers = bodyText.match(/\bguards\b/gu) ?? [];
  assert(
    guardIdentifiers.length === 6,
    `domainBlock must contain exactly six guards references; found ${guardIdentifiers.length}`,
  );
  const consumers =
    bodyText.match(
      /sql\.join\(\s*guards\s*,\s*sql`\s+AND\s+`\s*\)/gu,
    ) ?? [];
  assert(
    consumers.length === 1,
    `domainBlock must consume guards exactly once; found ${consumers.length}`,
  );

  const orderedStarts = [
    like.range.start,
    matchExprs.range.start,
    hit.range.start,
    guardInitializer.range.start,
    extraWhereRange.start,
    claimGate.range.start,
    documentOuter.range.start,
    documentEmpty.range.start,
    documentList.range.start,
    returnToken.range.start,
  ];
  assert(
    orderedStarts.every(
      (value, index) =>
        index === 0 || value > orderedStarts[index - 1]!,
    ),
    'domainBlock guard construction order diverges from the reviewed program',
  );

  return {
    program: Object.freeze({
      baseHit: Object.freeze({
        matchSource: `d.${matchSource}`,
        columnTransform: 'lower',
        operator: 'LIKE',
        queryParameter,
        queryTransform: 'postgres_like_escape_contains',
        join: 'OR',
      }),
      extraWhere: Object.freeze({
        presenceSource: 'd.extraWhere',
        rendering: 'parenthesized_sql_raw',
      }),
      scalarNullableGate: Object.freeze({
        register: scalarRegister,
        parameter: scalarParameter,
        activeWhen: 'not_null',
        column: scalarColumn,
        operator: '=',
      }),
      listGate: Object.freeze({
        register: listRegister,
        parameter: listParameter,
        column: listColumn,
        operator: 'IN',
        emptyBehavior: 'false',
        elementBinding: 'all',
        separator: ', ',
      }),
      constructionSiteCount: 5,
      pushSiteCount: 4,
      consumerCount: 1,
    }),
    baseHitRange: {
      start: like.range.start,
      end: guardInitializer.range.end,
    },
    claimGateRange: claimGate.range,
    claimColumnRange: captureRange(
      claimGate,
      3,
      'scalar-gate column',
    ),
    documentFalseRange: captureRange(
      documentEmpty,
      2,
      'empty-list false literal',
    ),
    documentListGateRange: {
      start: documentOuter.range.start,
      end: documentList.range.end,
    },
    returnRange: captureRange(
      returnToken,
      1,
      'domainBlock return token',
    ),
  };
}

function rawDomainField(
  ts: CompilerApi,
  nodeValue: unknown,
): string | null {
  if (!isRecord(nodeValue) || typeof nodeValue.kind !== 'number') return null;
  const node = nodeValue as unknown as AstNode;
  if (!ts.isCallExpression(node)) return null;
  if (!isPropertyAccessNamed(ts, node.expression, 'sql', 'raw')) return null;
  const args = optionalNodeArray(node.arguments, 'sql.raw arguments');
  if (args.length !== 1) return null;
  const argument = args[0]!;
  if (!ts.isPropertyAccessExpression(argument)) return null;
  if (!isIdentifierNamed(ts, argument.expression, 'd')) return null;
  if (
    !isRecord(argument.name) ||
    typeof argument.name.kind !== 'number' ||
    !ts.isIdentifier(argument.name as unknown as AstNode)
  ) {
    return null;
  }
  return requireNodeText(
    argument.name as unknown as AstNode,
    'sql.raw d field',
  );
}

function isKindProjection(
  ts: CompilerApi,
  nodeValue: unknown,
): boolean {
  if (!isRecord(nodeValue) || typeof nodeValue.kind !== 'number') return false;
  const node = nodeValue as unknown as AstNode;
  if (!ts.isCallExpression(node)) return false;
  if (!isPropertyAccessNamed(ts, node.expression, 'sql', 'raw')) return false;
  const args = optionalNodeArray(node.arguments, 'kind sql.raw arguments');
  if (args.length !== 1) return false;
  const template = args[0]!;
  if (!ts.isTemplateExpression(template)) return false;
  const head = requireNode(template.head, 'kind template head');
  const spans = requireNodeArray(
    template.templateSpans,
    'kind template spans',
  );
  if (
    requireNodeText(head, 'kind template head') !== "'" ||
    spans.length !== 1
  ) {
    return false;
  }
  const span = spans[0]!;
  if (!isPropertyAccessNamed(ts, span.expression, 'd', 'kind')) return false;
  const tail = requireNode(span.literal, 'kind template tail');
  return requireNodeText(tail, 'kind template tail') === "'";
}

function isGuardJoin(
  ts: CompilerApi,
  nodeValue: unknown,
): boolean {
  if (!isRecord(nodeValue) || typeof nodeValue.kind !== 'number') return false;
  const node = nodeValue as unknown as AstNode;
  if (!ts.isCallExpression(node)) return false;
  if (!isPropertyAccessNamed(ts, node.expression, 'sql', 'join')) return false;
  const args = optionalNodeArray(node.arguments, 'sql.join arguments');
  if (
    args.length !== 2 ||
    !isIdentifierNamed(ts, args[0], 'guards')
  ) {
    return false;
  }
  const separator = args[1]!;
  if (!ts.isTaggedTemplateExpression(separator)) return false;
  if (!isIdentifierNamed(ts, separator.tag, 'sql')) return false;
  const template = requireNode(
    separator.template,
    'guards separator template',
  );
  return (
    ts.isNoSubstitutionTemplateLiteral(template) &&
    requireNodeText(template, 'guards separator template') === ' AND '
  );
}

function templateChunkAfter(span: AstNode, label: string): string {
  const literal = requireNode(span.literal, `${label} literal`);
  return requireNodeText(literal, `${label} literal`);
}

function templateChunkBefore(
  head: AstNode,
  spans: readonly AstNode[],
  index: number,
  label: string,
): string {
  if (index === 0) return requireNodeText(head, `${label} head`);
  return templateChunkAfter(spans[index - 1]!, `${label} prior span`);
}

function validateProjectionReturn(
  ts: CompilerApi,
  domainBlockBody: AstNode,
): void {
  const returns = collectNodes(
    ts,
    domainBlockBody,
    (node) => ts.isReturnStatement(node),
  );
  assert(
    returns.length === 1,
    `domainBlock must contain exactly one return statement; found ${returns.length}`,
  );
  const expression = requireNode(
    returns[0]!.expression,
    'domainBlock return expression',
  );
  assert(
    ts.isTaggedTemplateExpression(expression) &&
      isIdentifierNamed(ts, expression.tag, 'sql'),
    'domainBlock must return one sql-tagged template',
  );
  const template = requireNode(
    expression.template,
    'domainBlock return template',
  );
  assert(
    ts.isTemplateExpression(template),
    'domainBlock return template must contain the reviewed substitutions',
  );
  const head = requireNode(
    template.head,
    'domainBlock return template head',
  );
  const spans = requireNodeArray(
    template.templateSpans,
    'domainBlock return template spans',
  );

  const projectionIndexes = new Map<string, number[]>();
  const kindIndexes: number[] = [];
  const guardJoinIndexes: number[] = [];
  for (const [index, span] of spans.entries()) {
    const field = rawDomainField(ts, span.expression);
    if (field !== null) {
      const indexes = projectionIndexes.get(field) ?? [];
      indexes.push(index);
      projectionIndexes.set(field, indexes);
    }
    if (isKindProjection(ts, span.expression)) kindIndexes.push(index);
    if (isGuardJoin(ts, span.expression)) guardJoinIndexes.push(index);
  }

  const requiredRawFields = [
    'id',
    'title',
    'subtitle',
    'parent',
    'table',
  ] as const;
  for (const field of requiredRawFields) {
    const indexes = projectionIndexes.get(field) ?? [];
    assert(
      indexes.length === 1,
      `domainBlock return must consume d.${field} through sql.raw exactly once; found ${indexes.length}`,
    );
  }
  for (const field of projectionIndexes.keys()) {
    assert(
      requiredRawFields.includes(
        field as (typeof requiredRawFields)[number],
      ),
      `domainBlock return consumes unsupported sql.raw(d.${field})`,
    );
  }
  assert(
    kindIndexes.length === 1,
    `domainBlock return must project quoted d.kind exactly once; found ${kindIndexes.length}`,
  );
  assert(
    guardJoinIndexes.length === 1,
    `domainBlock return must consume guards through sql.join(..., sql\` AND \`) exactly once; found ${guardJoinIndexes.length}`,
  );

  const indexOf = (field: string): number =>
    projectionIndexes.get(field)![0]!;
  const kindIndex = kindIndexes[0]!;
  const idIndex = indexOf('id');
  const titleIndex = indexOf('title');
  const subtitleIndex = indexOf('subtitle');
  const parentIndex = indexOf('parent');
  const tableIndex = indexOf('table');
  const guardIndex = guardJoinIndexes[0]!;
  assert(
    kindIndex < idIndex &&
      idIndex < titleIndex &&
      titleIndex < subtitleIndex &&
      subtitleIndex < parentIndex &&
      parentIndex < tableIndex &&
      tableIndex < guardIndex,
    'domainBlock projection fields, table, and guards are not in the reviewed order',
  );

  const aliasExpectations = [
    [kindIndex, /^\s+AS kind,/u, 'kind'],
    [idIndex, /^\s+AS id,/u, 'id'],
    [titleIndex, /^\s+AS title,/u, 'title'],
    [subtitleIndex, /^\s+AS subtitle,/u, 'subtitle'],
    [parentIndex, /^\s+AS parent_id,/u, 'parent'],
  ] as const;
  for (const [index, pattern, field] of aliasExpectations) {
    assert(
      pattern.test(
        templateChunkAfter(
          spans[index]!,
          `domainBlock ${field} projection`,
        ),
      ),
      `domainBlock d.${field} is not bound to its reviewed output alias`,
    );
  }

  assert(
    /FROM\s*$/u.test(
      templateChunkBefore(
        head,
        spans,
        tableIndex,
        'domainBlock table projection',
      ),
    ),
    'domainBlock d.table is not consumed by FROM',
  );
  assert(
    /^\s+WHERE\s*$/u.test(
      templateChunkAfter(
        spans[tableIndex]!,
        'domainBlock table projection',
      ),
    ),
    'domainBlock d.table is not followed by WHERE',
  );
  assert(
    /WHERE\s*$/u.test(
      templateChunkBefore(
        head,
        spans,
        guardIndex,
        'domainBlock guard join',
      ),
    ),
    'domainBlock guard join is not consumed by WHERE',
  );
}

function parseProjectionAuthorityInternal(
  sourceText: string,
  compilerApi: unknown,
): InternalParseResult {
  const ts = requireCompilerApi(compilerApi);
  const sourceFile = parseSourceFile(ts, sourceText);
  const parsedSpecs = parseDomainSpecs(ts, sourceFile);
  const domainBlockBody = findDomainBlock(ts, sourceFile);
  const extraWhereConsumerRange = validateExtraWhereConsumer(
    ts,
    sourceFile,
    domainBlockBody,
  );
  const guardDerivation = deriveGuardAuthorityProgram(
    sourceText,
    sourceFile,
    domainBlockBody,
    extraWhereConsumerRange,
  );
  validateProjectionReturn(ts, domainBlockBody);

  const specs = parsedSpecs.specs;
  assert(
    specs.length === EXPECTED_DOMAIN_COUNT,
    `projection parser must return exactly ${EXPECTED_DOMAIN_COUNT} specs`,
  );
  const staticGuardRegisters = Object.freeze(
    specs
      .filter((spec) => spec.extraWhere !== null)
      .map((spec) => spec.kind)
      .sort(compareAscii),
  );
  const registerKinds = new Set(specs.map(({ kind }) => kind));
  assert(
    registerKinds.has(
      guardDerivation.program.scalarNullableGate.register,
    ),
    'scalar runtime guard register is absent from DOMAIN_SPECS',
  );
  assert(
    registerKinds.has(guardDerivation.program.listGate.register),
    'list runtime guard register is absent from DOMAIN_SPECS',
  );
  const projectionSemanticHash = sha256Utf8(canonicalJson(specs));
  const guardSemanticHash = sha256Utf8(
    canonicalJson(guardDerivation.program),
  );
  const semanticHash = sha256Utf8(
    canonicalJson({
      specs,
      guardProgram: guardDerivation.program,
    }),
  );
  const publicResult: ProjectionAuthorityParseResult = Object.freeze({
    parserVersion: PROJECTION_AUTHORITY_PARSER_VERSION,
    typescriptVersion: ts.version,
    specs,
    staticGuardRegisters,
    guardProgram: guardDerivation.program,
    projectionSemanticHash,
    guardSemanticHash,
    semanticHash,
  });
  return {
    publicResult,
    titleRanges: parsedSpecs.titleRanges,
    extraWhereConsumerRange,
    baseHitRange: guardDerivation.baseHitRange,
    claimGateRange: guardDerivation.claimGateRange,
    claimColumnRange: guardDerivation.claimColumnRange,
    documentFalseRange: guardDerivation.documentFalseRange,
    documentListGateRange: guardDerivation.documentListGateRange,
    returnRange: guardDerivation.returnRange,
  };
}

/**
 * Derive the complete projection authority from exact searchSql.ts source.
 *
 * The caller should first prove those bytes equal its reviewed Git blob. This
 * parser deliberately does not accept a pre-authored projection map.
 */
export function parseProjectionAuthoritySource(
  searchSqlText: string,
  compilerApi: unknown,
): ProjectionAuthorityParseResult {
  return parseProjectionAuthorityInternal(
    searchSqlText,
    compilerApi,
  ).publicResult;
}

function replaceRange(
  sourceText: string,
  range: TextRange,
  replacement: string,
): string {
  assert(
    range.start >= 0 &&
      range.end <= sourceText.length &&
      range.end > range.start,
    'self-test mutation range is outside searchSql.ts',
  );
  return `${sourceText.slice(0, range.start)}${replacement}${sourceText.slice(range.end)}`;
}

function assertParserRejects(
  sourceText: string,
  compilerApi: unknown,
  label: string,
): void {
  let rejected = false;
  try {
    parseProjectionAuthoritySource(sourceText, compilerApi);
  } catch (error) {
    rejected = error instanceof ProjectionAuthorityParseError;
    if (!rejected) throw error;
  }
  assert(rejected, `${label} was not rejected by the projection parser`);
}

/**
 * Executable RED controls for every load-bearing projection/guard path.
 */
export function runProjectionAuthorityParserSelfTests(
  searchSqlText: string,
  compilerApi: unknown,
): ProjectionAuthoritySelfTestResult {
  const baseline = parseProjectionAuthorityInternal(
    searchSqlText,
    compilerApi,
  );
  assert(
    baseline.titleRanges.length === EXPECTED_DOMAIN_COUNT,
    'self-test requires one title source range per projection spec',
  );

  const titleRange = baseline.titleRanges[0]!;
  const tamperedTitle = `coalesce(${titleRange.expression}, '')`;
  assertSafeSqlFragment(tamperedTitle, 'self-test tampered title');
  const projectionTamperSource = replaceRange(
    searchSqlText,
    titleRange,
    JSON.stringify(tamperedTitle),
  );
  const projectionTamper = parseProjectionAuthoritySource(
    projectionTamperSource,
    compilerApi,
  );
  assert(
    projectionTamper.semanticHash !==
      baseline.publicResult.semanticHash,
    'projection-expression tamper did not change the semantic hash',
  );

  const claimColumn = searchSqlText.slice(
    baseline.claimColumnRange.start,
    baseline.claimColumnRange.end,
  );
  assertSimpleIdentifier(claimColumn, 'self-test scalar-gate column');
  const claimColumnTamper = parseProjectionAuthoritySource(
    replaceRange(
      searchSqlText,
      baseline.claimColumnRange,
      `${claimColumn}_tampered`,
    ),
    compilerApi,
  );
  assert(
    claimColumnTamper.guardSemanticHash !==
      baseline.publicResult.guardSemanticHash,
    'scalar-gate column tamper did not change the guard semantic hash',
  );

  assertParserRejects(
    replaceRange(searchSqlText, baseline.baseHitRange, ''),
    compilerApi,
    'removing the base hit program',
  );

  const deadExtraWhereSource = replaceRange(
    searchSqlText,
    baseline.extraWhereConsumerRange,
    '',
  );
  let deadExtraWhereRejected = false;
  try {
    parseProjectionAuthoritySource(
      deadExtraWhereSource,
      compilerApi,
    );
  } catch (error) {
    deadExtraWhereRejected =
      error instanceof ProjectionAuthorityParseError &&
      /extraWhere/u.test(error.message);
    if (!deadExtraWhereRejected) throw error;
  }
  assert(
    deadExtraWhereRejected,
    'removing the runtime extraWhere consumer was not rejected',
  );

  assertParserRejects(
    replaceRange(searchSqlText, baseline.claimGateRange, ''),
    compilerApi,
    'removing the nullable scalar guard',
  );
  assertParserRejects(
    replaceRange(
      searchSqlText,
      baseline.documentFalseRange,
      'true',
    ),
    compilerApi,
    'changing the document empty-list branch from false to true',
  );
  assertParserRejects(
    replaceRange(
      searchSqlText,
      baseline.documentListGateRange,
      '',
    ),
    compilerApi,
    'removing the document list guard',
  );
  assertParserRejects(
    replaceRange(
      searchSqlText,
      baseline.returnRange,
      "guards.push(sql.raw('true'));\n  return",
    ),
    compilerApi,
    'adding an unclassified guard push',
  );

  return Object.freeze({
    parserVersion: PROJECTION_AUTHORITY_PARSER_VERSION,
    baselineSemanticHash: baseline.publicResult.semanticHash,
    projectionExpressionTamperChangesSemanticHash: true,
    claimColumnTamperChangesGuardSemanticHash: true,
    deadBaseHitTamperRejected: true,
    deadExtraWhereTamperRejected: true,
    deadClaimGateTamperRejected: true,
    documentFalseToTrueTamperRejected: true,
    deadDocumentListGateTamperRejected: true,
    unknownGuardPushTamperRejected: true,
  });
}
