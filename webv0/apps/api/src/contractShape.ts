/**
 * contractShape.ts — S-03: the frozen /api/v1 compatibility contract.
 *
 * The /api/v1 prefix claims a version boundary; this module makes it REAL: a
 * canonical, committed JSON description of every route (method, url, and the
 * zod-declared body/querystring/params/response shapes). The gate test
 * regenerates it from the live route table and fails on ANY drift — an
 * intentional change is a deliberate artifact regeneration reviewed in the
 * diff, and the classifier names what kind of change it is:
 *
 *   THE STANDING LAW: fields already served by v1 are never removed or
 *   retyped, and routes never disappear — incompatible semantics take an
 *   explicit /api/v2 route. Additive growth (new routes, new response
 *   fields) is legal after review.
 */

interface ZodDefLike {
  typeName?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyZod = { _def: ZodDefLike };

export type Shape =
  | { t: 'string' | 'number' | 'boolean' | 'null' | 'date' | 'unknown' | 'any' | 'opaque' | 'void' }
  | { t: 'literal'; value: unknown }
  | { t: 'enum'; values: string[] }
  | { t: 'array'; item: Shape }
  | { t: 'record'; value: Shape }
  | { t: 'nullable'; inner: Shape }
  | { t: 'union'; options: Shape[] }
  | { t: 'tuple'; items: Shape[] }
  | { t: 'object'; keys: Record<string, Shape & { optional?: true }> };

function isZod(v: unknown): v is AnyZod {
  return typeof v === 'object' && v !== null && '_def' in (v as Record<string, unknown>);
}

/** Canonical, deterministic shape of a zod schema (input-side for effects). */
export function shapeOf(schema: unknown): Shape {
  if (!isZod(schema)) return { t: 'opaque' };
  const def = schema._def;
  switch (def.typeName) {
    case 'ZodString':
      return { t: 'string' };
    case 'ZodNumber':
      return { t: 'number' };
    case 'ZodBoolean':
      return { t: 'boolean' };
    case 'ZodNull':
      return { t: 'null' };
    case 'ZodDate':
      return { t: 'date' };
    case 'ZodUnknown':
      return { t: 'unknown' };
    case 'ZodAny':
      return { t: 'any' };
    case 'ZodVoid':
    case 'ZodUndefined':
      return { t: 'void' };
    case 'ZodLiteral':
      return { t: 'literal', value: def.value };
    case 'ZodEnum':
      return { t: 'enum', values: [...(def.values as string[])].sort() };
    case 'ZodNativeEnum':
      return { t: 'enum', values: Object.values(def.values as Record<string, string>).map(String).sort() };
    case 'ZodArray':
      return { t: 'array', item: shapeOf(def.type) };
    case 'ZodRecord':
      return { t: 'record', value: shapeOf(def.valueType) };
    case 'ZodNullable': {
      const inner = shapeOf(def.innerType);
      return inner && typeof inner === 'object' && inner.t === 'nullable' ? inner : { t: 'nullable', inner };
    }
    case 'ZodOptional':
    case 'ZodDefault':
    case 'ZodCatch':
    case 'ZodReadonly':
    case 'ZodBranded':
      return shapeOf(def.innerType);
    case 'ZodEffects':
      // refinements/transforms: the WIRE contract is what the caller sends.
      return shapeOf(def.schema);
    case 'ZodPipeline':
      return shapeOf(def.in);
    case 'ZodLazy':
      return shapeOf(def.getter());
    case 'ZodTuple':
      return { t: 'tuple', items: (def.items as unknown[]).map(shapeOf) };
    case 'ZodUnion':
    case 'ZodDiscriminatedUnion': {
      const options = (def.options as unknown[]).map(shapeOf);
      options.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
      return { t: 'union', options };
    }
    case 'ZodIntersection': {
      // serve intersections as a union-of-two for visibility (rare here)
      const options = [shapeOf(def.left), shapeOf(def.right)];
      return { t: 'union', options };
    }
    case 'ZodObject': {
      const entries = Object.entries(def.shape() as Record<string, AnyZod>);
      entries.sort(([a], [b]) => a.localeCompare(b));
      const keys: Record<string, Shape & { optional?: true }> = {};
      for (const [k, v] of entries) {
        const optional = isZod(v) && v._def.typeName === 'ZodOptional';
        const s = shapeOf(v) as Shape & { optional?: true };
        keys[k] = optional ? { ...s, optional: true } : s;
      }
      return { t: 'object', keys };
    }
    default:
      return { t: 'opaque' };
  }
}

export interface RouteContract {
  readonly method: string;
  readonly url: string;
  readonly body?: Shape;
  readonly querystring?: Shape;
  readonly params?: Shape;
  readonly response?: Record<string, Shape>;
}

export interface ApiContract {
  readonly schema: 'c3-api-contract/1';
  readonly law: string;
  readonly routes: RouteContract[];
}

export interface CollectedRoute {
  readonly method: string | string[];
  readonly url: string;
  readonly schema?: unknown;
}

const LAW =
  'v1 is FROZEN for compatibility: routes and served fields are never removed or retyped; incompatible semantics take /api/v2. Additive growth is legal after review — regenerate this artifact deliberately (npm run contract -w @c3web/api) and review the diff.';

/** Build the canonical contract from collected routes (deterministic order). */
export function buildContract(collected: readonly CollectedRoute[]): ApiContract {
  const routes: RouteContract[] = [];
  for (const r of collected) {
    const methods = Array.isArray(r.method) ? r.method : [r.method];
    const s = (r.schema ?? {}) as Record<string, unknown>;
    for (const method of methods) {
      if (method === 'HEAD' || method === 'OPTIONS') continue; // fastify auto-routes
      const response: Record<string, Shape> = {};
      const resp = (s.response ?? {}) as Record<string, unknown>;
      for (const code of Object.keys(resp).sort()) response[code] = shapeOf(resp[code]);
      routes.push({
        method,
        url: r.url,
        ...(s.body ? { body: shapeOf(s.body) } : {}),
        ...(s.querystring ? { querystring: shapeOf(s.querystring) } : {}),
        ...(s.params ? { params: shapeOf(s.params) } : {}),
        ...(Object.keys(response).length ? { response } : {}),
      });
    }
  }
  routes.sort((a, b) => a.url.localeCompare(b.url) || a.method.localeCompare(b.method));
  return { schema: 'c3-api-contract/1', law: LAW, routes };
}

/** Is `committed` structurally contained in `generated`? (responses: additive-safe) */
function subsumes(committed: Shape, generated: Shape): boolean {
  if (committed.t === 'nullable' && generated.t === 'nullable') return subsumes(committed.inner, generated.inner);
  if (committed.t !== generated.t) return false;
  switch (committed.t) {
    case 'object': {
      const g = (generated as Extract<Shape, { t: 'object' }>).keys;
      return Object.entries(committed.keys).every(([k, v]) => k in g && subsumes(v, g[k]!));
    }
    case 'array':
      return subsumes(committed.item, (generated as Extract<Shape, { t: 'array' }>).item);
    case 'record':
      return subsumes(committed.value, (generated as Extract<Shape, { t: 'record' }>).value);
    case 'enum': {
      const g = new Set((generated as Extract<Shape, { t: 'enum' }>).values);
      return committed.values.every((v) => g.has(v));
    }
    case 'union': {
      const g = (generated as Extract<Shape, { t: 'union' }>).options;
      return committed.options.every((c) => g.some((o) => subsumes(c, o)));
    }
    case 'tuple': {
      const g = (generated as Extract<Shape, { t: 'tuple' }>).items;
      return committed.items.length === g.length && committed.items.every((c, i) => subsumes(c, g[i]!));
    }
    case 'literal':
      return JSON.stringify(committed.value) === JSON.stringify((generated as Extract<Shape, { t: 'literal' }>).value);
    default:
      return true; // same primitive tag
  }
}

export interface ContractDiff {
  readonly breaking: string[];
  readonly additive: string[];
  readonly changed: string[];
}

/** Classify generated-vs-committed drift. Route responses use the subsumption rule. */
export function diffContracts(committed: ApiContract, generated: ApiContract): ContractDiff {
  const breaking: string[] = [];
  const additive: string[] = [];
  const changed: string[] = [];
  const key = (r: RouteContract) => `${r.method} ${r.url}`;
  const cMap = new Map(committed.routes.map((r) => [key(r), r]));
  const gMap = new Map(generated.routes.map((r) => [key(r), r]));

  for (const [k] of cMap) if (!gMap.has(k)) breaking.push(`${k} — route REMOVED (v1 routes never disappear; use /api/v2)`);
  for (const [k] of gMap) if (!cMap.has(k)) additive.push(`${k} — new route`);

  for (const [k, c] of cMap) {
    const g = gMap.get(k);
    if (!g) continue;
    if (JSON.stringify(c) === JSON.stringify(g)) continue;
    const cResp = c.response ?? {};
    const gResp = g.response ?? {};
    let respBreaking = false;
    let respGrew = false;
    for (const code of Object.keys(cResp)) {
      if (!(code in gResp)) respBreaking = true;
      else if (!subsumes(cResp[code]!, gResp[code]!)) respBreaking = true;
      else if (JSON.stringify(cResp[code]) !== JSON.stringify(gResp[code])) respGrew = true;
    }
    for (const code of Object.keys(gResp)) if (!(code in cResp)) respGrew = true;
    if (respBreaking) breaking.push(`${k} — response REMOVED/RETYPED served fields (v1-frozen; use /api/v2)`);
    else if (respGrew) additive.push(`${k} — response grew (additive)`);
    const inputChanged = ['body', 'querystring', 'params'].some(
      (part) => JSON.stringify(c[part as keyof RouteContract] ?? null) !== JSON.stringify(g[part as keyof RouteContract] ?? null),
    );
    if (inputChanged) changed.push(`${k} — input schema changed (review compatibility for existing callers)`);
  }
  return { breaking, additive, changed };
}
