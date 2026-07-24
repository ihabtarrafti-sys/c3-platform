import { createHash } from 'node:crypto';
import { types as utilTypes } from 'node:util';

export type CanonicalJsonPrimitive = boolean | null | number | string;
export type CanonicalJsonValue =
  | CanonicalJsonPrimitive
  | readonly CanonicalJsonValue[]
  | { readonly [key: string]: CanonicalJsonValue };

export class CanonicalJsonError extends TypeError {
  readonly path: string;

  constructor(path: string, message: string) {
    super(`Cannot canonicalize JSON at ${path}: ${message}`);
    this.name = 'CanonicalJsonError';
    this.path = path;
  }
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function canonicalize(
  value: unknown,
  path: string,
  ancestors: Set<object>,
): string {
  if (value === null) {
    return 'null';
  }

  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'string':
      return quote(value);
    case 'number':
      if (!Number.isFinite(value)) {
        throw new CanonicalJsonError(path, 'numbers must be finite');
      }
      return Object.is(value, -0) ? '0' : JSON.stringify(value);
    case 'undefined':
    case 'function':
    case 'symbol':
    case 'bigint':
      throw new CanonicalJsonError(path, `unsupported ${typeof value} value`);
    case 'object':
      break;
    default:
      throw new CanonicalJsonError(path, 'unsupported value');
  }

  if (ancestors.has(value)) {
    throw new CanonicalJsonError(path, 'cyclic references are forbidden');
  }
  if (utilTypes.isProxy(value)) {
    throw new CanonicalJsonError(
      path,
      'Proxy-wrapped values are forbidden',
    );
  }
  if ('toJSON' in value) {
    throw new CanonicalJsonError(
      path,
      'custom or inherited JSON serializers are forbidden',
    );
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) {
        throw new CanonicalJsonError(
          path,
          'array subclasses and custom prototypes are forbidden',
        );
      }
      if (Object.getOwnPropertySymbols(value).length > 0) {
        throw new CanonicalJsonError(path, 'symbol keys are forbidden');
      }
      const descriptors = Object.getOwnPropertyDescriptors(
        value,
      ) as Record<string, PropertyDescriptor>;
      const lengthDescriptor = descriptors['length'];
      if (
        lengthDescriptor === undefined ||
        'get' in lengthDescriptor ||
        'set' in lengthDescriptor ||
        lengthDescriptor.value !== value.length ||
        Object.keys(descriptors).length !== value.length + 1
      ) {
        throw new CanonicalJsonError(
          path,
          'arrays must be dense data properties with no extra keys',
        );
      }
      const items: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (
          descriptor === undefined ||
          'get' in descriptor ||
          'set' in descriptor
        ) {
          throw new CanonicalJsonError(
            `${path}[${index}]`,
            'array entries must be dense data properties',
          );
        }
        items.push(
          canonicalize(
            descriptor.value,
            `${path}[${index}]`,
            ancestors,
          ),
        );
      }
      return `[${items.join(',')}]`;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new CanonicalJsonError(
        path,
        'only plain objects and arrays are supported',
      );
    }

    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new CanonicalJsonError(path, 'symbol keys are forbidden');
    }

    const descriptors = Object.getOwnPropertyDescriptors(value);
    const entries = Object.keys(descriptors)
      .sort()
      .map((key) => {
        const descriptor = descriptors[key];
        if (
          descriptor === undefined ||
          'get' in descriptor ||
          'set' in descriptor
        ) {
          throw new CanonicalJsonError(
            `${path}.${key}`,
            'accessor properties are forbidden',
          );
        }
        if (!descriptor.enumerable) {
          throw new CanonicalJsonError(
            `${path}.${key}`,
            'non-enumerable properties are forbidden',
          );
        }
        return `${quote(key)}:${canonicalize(
          descriptor.value,
          `${path}.${key}`,
          ancestors,
        )}`;
      });

    return `{${entries.join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
}

/**
 * Deterministic, whitespace-free JSON with recursively sorted object keys.
 *
 * Ambiguous JavaScript values are rejected instead of being silently omitted or
 * coerced as they are by JSON.stringify.
 */
export function canonicalJson(value: unknown): string {
  return canonicalize(value, '$', new Set<object>());
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function canonicalSha256(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}
