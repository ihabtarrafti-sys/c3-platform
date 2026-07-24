import { describe, expect, it } from 'vitest';

import {
  CanonicalJsonError,
  canonicalJson,
  canonicalSha256,
  sha256Hex,
} from '../src/canonical.js';

describe('canonical JSON and SHA-256', () => {
  it('sorts keys recursively without mutating the input', () => {
    const input = {
      z: [{ beta: 2, alpha: 1 }],
      a: 'value',
    };

    expect(canonicalJson(input)).toBe(
      '{"a":"value","z":[{"alpha":1,"beta":2}]}',
    );
    expect(Object.keys(input)).toEqual(['z', 'a']);
  });

  it('normalizes negative zero and preserves JSON string escaping', () => {
    expect(canonicalJson({ text: 'line\n"quoted"', value: -0 })).toBe(
      '{"text":"line\\n\\"quoted\\"","value":0}',
    );
  });

  it('produces the fixed SHA-256 for a canonical object', () => {
    expect(canonicalSha256({ b: 2, a: 1 })).toBe(
      '43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777',
    );
    expect(sha256Hex('{"a":1,"b":2}')).toBe(
      '43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777',
    );
  });

  it.each([
    ['undefined', { value: undefined }],
    ['non-finite number', { value: Number.POSITIVE_INFINITY }],
    ['bigint', { value: BigInt(1) }],
    ['function', { value: () => undefined }],
    ['non-plain object', { value: new Date('2026-07-24T00:00:00.000Z') }],
    ['sparse array', new Array(1)],
  ])('fails closed for %s', (_label, value) => {
    expect(() => canonicalJson(value)).toThrow(CanonicalJsonError);
  });

  it('fails closed for cycles', () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;

    expect(() => canonicalJson(cyclic)).toThrow(/cyclic references/u);
  });

  it('fails closed rather than invoking accessors', () => {
    const withAccessor = {};
    Object.defineProperty(withAccessor, 'secret', {
      enumerable: true,
      get: () => 'must-not-run',
    });

    expect(() => canonicalJson(withAccessor)).toThrow(/accessor properties/u);
  });

  it('RED: refuses array accessors without invoking them', () => {
    let invoked = false;
    const array: unknown[] = [];
    Object.defineProperty(array, '0', {
      configurable: true,
      enumerable: true,
      get: () => {
        invoked = true;
        return 'time-varying-secret';
      },
    });
    array.length = 1;

    expect(() => canonicalJson(array)).toThrow(/array entries/u);
    expect(invoked).toBe(false);
  });

  it('RED: refuses extra array data, symbols, and custom prototypes', () => {
    const withExtra = ['safe'];
    Object.defineProperty(withExtra, 'hidden', {
      enumerable: false,
      value: 'unhashed-secret',
    });
    const withSymbol = ['safe'];
    Object.defineProperty(withSymbol, Symbol('secret'), {
      value: 'unhashed-secret',
    });
    class CustomArray extends Array<string> {}

    for (const value of [
      withExtra,
      withSymbol,
      new CustomArray('safe'),
    ]) {
      expect(() => canonicalJson(value)).toThrow(CanonicalJsonError);
    }
  });

  it('RED: refuses hidden object data and serializers without invoking them', () => {
    let invoked = false;
    const withHiddenSerializer = {};
    Object.defineProperty(withHiddenSerializer, 'toJSON', {
      enumerable: false,
      value: () => {
        invoked = true;
        return { secret: 'HEARTH-HIDDEN-123' };
      },
    });
    const withHiddenData = {};
    Object.defineProperty(withHiddenData, 'secret', {
      enumerable: false,
      value: 'HEARTH-HIDDEN-123',
    });

    expect(() => canonicalJson(withHiddenSerializer)).toThrow(
      /JSON serializers/u,
    );
    expect(() => canonicalJson(withHiddenData)).toThrow(
      /non-enumerable properties/u,
    );
    expect(invoked).toBe(false);
  });

  it('RED: refuses Proxy-wrapped values without invoking reflection traps', () => {
    let trapInvoked = false;
    const target = ['safe'];
    Object.defineProperty(target, 'hiddenSecret', {
      configurable: true,
      value: 'HEARTH-PROXY-SECRET',
    });
    const proxy = new Proxy(target, {
      ownKeys: () => {
        trapInvoked = true;
        return ['0', 'length'];
      },
    });

    expect(() => canonicalJson(proxy)).toThrow(/Proxy-wrapped/u);
    expect(trapInvoked).toBe(false);
  });

  it('RED: refuses Object.prototype JSON serializer pollution', () => {
    const prior = Object.getOwnPropertyDescriptor(
      Object.prototype,
      'toJSON',
    );
    Object.defineProperty(Object.prototype, 'toJSON', {
      configurable: true,
      value: () => ({ secret: 'HEARTH-PROTOTYPE-TOJSON-123' }),
    });
    try {
      expect(() => canonicalJson({ safe: true })).toThrow(
        /JSON serializers/u,
      );
    } finally {
      if (prior === undefined) {
        Reflect.deleteProperty(Object.prototype, 'toJSON');
      } else {
        Object.defineProperty(Object.prototype, 'toJSON', prior);
      }
    }
  });
});
