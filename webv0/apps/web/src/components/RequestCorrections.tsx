/**
 * RequestCorrections (Track B1) — the edit / revise dialog, ONE component for
 * every governed operation: the form is DERIVED from the op's own zod input
 * schema (the same schema the server validates), prefilled from the actor's
 * own payload. Target-identifying keys render read-only — an edit or a
 * revision prefill never quietly retargets a request. On save, the merged
 * input is parsed through approvalPayloadSchema CLIENT-side first (instant
 * schema/refinement feedback), then the server revalidates authoritatively.
 *
 * "Polish freely until review starts — every change on the record; after
 * that, frozen; corrections are new requests."
 */
import { useMemo, useState } from 'react';
import { Checkbox, Dropdown, Field, Input, Option, Textarea, makeStyles } from '@fluentui/react-components';
import {
  CORRECTIONS_EXCLUDED_OPS,
  EDIT_TARGET_KEYS,
  approvalPayloadSchema,
  parseDecimalToMinor,
  type OperationType,
} from '@c3web/domain';
import { GovernedAction } from './GovernedAction';

// ── zod introspection (one level of nesting; effects unwrapped) ──────────────

interface FieldSpec {
  readonly key: string;
  readonly label: string;
  readonly kind: 'text' | 'textarea' | 'number' | 'money' | 'date' | 'boolean' | 'select' | 'strings' | 'object';
  readonly options?: readonly string[];
  readonly nested?: readonly FieldSpec[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyZod = { _def: any };

function unwrap(schema: AnyZod): AnyZod {
  const d = schema._def;
  switch (d?.typeName) {
    case 'ZodEffects':
      return unwrap(d.schema);
    case 'ZodOptional':
    case 'ZodNullable':
    case 'ZodDefault':
      return unwrap(d.innerType);
    default:
      return schema;
  }
}

function labelOf(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function specOf(key: string, schema: AnyZod, depth: number): FieldSpec {
  const inner = unwrap(schema);
  const t = inner._def?.typeName;
  const label = labelOf(key);
  if (t === 'ZodEnum') return { key, label, kind: 'select', options: inner._def.values as string[] };
  if (t === 'ZodNumber') return { key, label, kind: /minor$/i.test(key) ? 'money' : 'number' };
  if (t === 'ZodBoolean') return { key, label, kind: 'boolean' };
  if (t === 'ZodArray') return { key, label, kind: 'strings' };
  if (t === 'ZodObject' && depth === 0) {
    const entries = Object.entries(inner._def.shape() as Record<string, AnyZod>);
    return { key, label, kind: 'object', nested: entries.map(([k, v]) => specOf(k, v, 1)) };
  }
  if (/(^|[a-z])(on|date)$/i.test(key) || /^(startsOn|endsOn|expiresOn|issuedOn|expenseOn|dateOfBirth|dateOfJoining|newEndsOn|startedOn)$/.test(key)) {
    return { key, label, kind: 'date' };
  }
  if (/notes|description|reason|details/i.test(key)) return { key, label, kind: 'textarea' };
  return { key, label, kind: 'text' };
}

/** operationType → its INPUT ZodObject (from the payload union itself). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const INPUT_SCHEMAS: Record<string, AnyZod> = Object.fromEntries(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (approvalPayloadSchema.options as any[]).map((o) => [o.shape.operationType.value as string, o.shape.input as AnyZod]),
);

export function correctionFieldSpecs(operationType: OperationType): FieldSpec[] {
  const schema = INPUT_SCHEMAS[operationType];
  if (!schema) return [];
  const inner = unwrap(schema);
  if (inner._def?.typeName !== 'ZodObject') return [];
  return Object.entries(inner._def.shape() as Record<string, AnyZod>).map(([k, v]) => specOf(k, v, 0));
}

export const isCorrectable = (op: OperationType): boolean => !(CORRECTIONS_EXCLUDED_OPS as readonly string[]).includes(op);

// ── value plumbing: original input → editable strings → merged input ─────────

type Draft = Record<string, string | boolean | Record<string, string | boolean>>;

function toDraftValue(spec: FieldSpec, v: unknown): string | boolean {
  if (spec.kind === 'boolean') return v === true;
  if (v === null || v === undefined) return '';
  if (spec.kind === 'money') return typeof v === 'number' ? (v % 100 === 0 ? String(v / 100) : (v / 100).toFixed(2)) : '';
  if (spec.kind === 'strings') return Array.isArray(v) ? (v as string[]).join(', ') : '';
  return String(v);
}

function draftFrom(specs: readonly FieldSpec[], input: Record<string, unknown>): Draft {
  const d: Draft = {};
  for (const s of specs) {
    if (s.kind === 'object') {
      const sub = (input[s.key] ?? {}) as Record<string, unknown>;
      d[s.key] = Object.fromEntries((s.nested ?? []).map((n) => [n.key, toDraftValue(n, sub[n.key])])) as Record<string, string | boolean>;
    } else {
      d[s.key] = toDraftValue(s, input[s.key]);
    }
  }
  return d;
}

/** Overlay the edited fields onto the ORIGINAL input (unknown keys survive). */
function mergeDraft(specs: readonly FieldSpec[], original: Record<string, unknown>, draft: Draft): Record<string, unknown> {
  const out: Record<string, unknown> = { ...original };
  const apply = (spec: FieldSpec, value: string | boolean, target: Record<string, unknown>) => {
    if (spec.kind === 'boolean') {
      target[spec.key] = value === true;
      return;
    }
    const raw = String(value).trim();
    if (raw === '') {
      // empty means "no value": null when the original held one, absent when it never did
      if (spec.key in target) target[spec.key] = null;
      return;
    }
    if (spec.kind === 'money') {
      const minor = parseDecimalToMinor(raw);
      target[spec.key] = minor ?? raw; // unparseable → let zod refuse loudly
    } else if (spec.kind === 'number') {
      const n = Number(raw);
      target[spec.key] = Number.isFinite(n) ? n : raw;
    } else if (spec.kind === 'strings') {
      target[spec.key] = raw.split(',').map((x) => x.trim()).filter((x) => x !== '');
    } else {
      target[spec.key] = raw;
    }
  };
  for (const s of specs) {
    if (s.kind === 'object') {
      const sub = { ...((original[s.key] ?? {}) as Record<string, unknown>) };
      const subDraft = (draft[s.key] ?? {}) as Record<string, string | boolean>;
      for (const n of s.nested ?? []) apply(n, subDraft[n.key] ?? '', sub);
      out[s.key] = sub;
    } else {
      apply(s, (draft[s.key] ?? '') as string | boolean, out);
    }
  }
  return out;
}

// ── the dialog ───────────────────────────────────────────────────────────────

const useStyles = makeStyles({
  fields: { display: 'flex', flexDirection: 'column', rowGap: '10px', maxHeight: '46vh', overflowY: 'auto', paddingRight: '4px' },
  nested: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: '8px',
    padding: '8px 10px',
    border: '1px solid var(--c3-border-subtle)',
    borderRadius: 'var(--c3-radius)',
  },
  nestedTitle: { fontSize: '12px', fontWeight: 600, color: 'var(--c3-ink-muted)' },
  zodError: { fontSize: '12.5px', color: 'var(--c3-state-danger)', whiteSpace: 'pre-wrap' },
});

export function CorrectionDialog({
  mode,
  operationType,
  originalInput,
  triggerTestId,
  onSubmit,
}: {
  mode: 'edit' | 'revise';
  operationType: OperationType;
  originalInput: Record<string, unknown>;
  triggerTestId: string;
  onSubmit: (input: Record<string, unknown>) => Promise<void>;
}) {
  const s = useStyles();
  const specs = useMemo(() => correctionFieldSpecs(operationType), [operationType]);
  const targetKeys = (EDIT_TARGET_KEYS as Record<string, readonly string[]>)[operationType] ?? [];
  const [draft, setDraft] = useState<Draft>(() => draftFrom(specs, originalInput));
  const [zodError, setZodError] = useState<string | null>(null);

  const set = (key: string, value: string | boolean) => setDraft((d) => ({ ...d, [key]: value }));
  const setNested = (key: string, sub: string, value: string | boolean) =>
    setDraft((d) => ({ ...d, [key]: { ...((d[key] ?? {}) as Record<string, string | boolean>), [sub]: value } }));

  function renderField(spec: FieldSpec, value: string | boolean, onChange: (v: string | boolean) => void, readonly: boolean) {
    const testid = `correction-${spec.key}`;
    if (spec.kind === 'boolean') {
      return <Checkbox key={spec.key} label={spec.label} checked={value === true} disabled={readonly} onChange={(_, d) => onChange(d.checked === true)} data-testid={testid} />;
    }
    if (spec.kind === 'select') {
      const v = String(value);
      return (
        <Field key={spec.key} label={spec.label}>
          <Dropdown value={v} selectedOptions={[v]} disabled={readonly} onOptionSelect={(_, d) => d.optionValue && onChange(d.optionValue)} data-testid={testid}>
            {(spec.options ?? []).map((o) => (
              <Option key={o} value={o} text={o}>
                {o}
              </Option>
            ))}
          </Dropdown>
        </Field>
      );
    }
    if (spec.kind === 'textarea') {
      return (
        <Field key={spec.key} label={spec.label}>
          <Textarea value={String(value)} disabled={readonly} onChange={(_, d) => onChange(d.value)} data-testid={testid} />
        </Field>
      );
    }
    return (
      <Field key={spec.key} label={spec.kind === 'money' ? `${spec.label} (major units)` : spec.label} hint={readonly ? 'Target — a correction may not retarget a request' : undefined}>
        <Input
          type={spec.kind === 'date' ? 'date' : spec.kind === 'number' ? 'number' : 'text'}
          value={String(value)}
          disabled={readonly}
          onChange={(_, d) => onChange(d.value)}
          data-testid={testid}
        />
      </Field>
    );
  }

  const body = (
    <div className={s.fields}>
      {specs.map((spec) =>
        spec.kind === 'object' ? (
          <div key={spec.key} className={s.nested} data-testid={`correction-group-${spec.key}`}>
            <span className={s.nestedTitle}>{spec.label}</span>
            {(spec.nested ?? []).map((n) =>
              renderField(
                n,
                ((draft[spec.key] ?? {}) as Record<string, string | boolean>)[n.key] ?? '',
                (v) => setNested(spec.key, n.key, v),
                targetKeys.includes(n.key),
              ),
            )}
          </div>
        ) : (
          renderField(spec, (draft[spec.key] ?? '') as string | boolean, (v) => set(spec.key, v), targetKeys.includes(spec.key))
        ),
      )}
      {zodError && (
        <span className={s.zodError} data-testid="correction-zod-error">
          {zodError}
        </span>
      )}
    </div>
  );

  return (
    <GovernedAction
      triggerLabel={mode === 'edit' ? 'Edit request…' : 'Revise & resubmit…'}
      triggerTestId={triggerTestId}
      triggerAppearance="secondary"
      title={mode === 'edit' ? 'Edit this request?' : 'Revise & resubmit this request?'}
      description={
        mode === 'edit'
          ? 'You may polish your own request freely until review starts — every change is recorded and shown to the reviewer. From review onward the request is frozen.'
          : 'This creates a FRESH linked request with your corrections (the old one is closed and marked superseded). All submission checks apply again.'
      }
      extra={body}
      confirmLabel={mode === 'edit' ? 'Save changes' : 'Resubmit corrected request'}
      onConfirm={async () => {
        const merged = mergeDraft(specs, originalInput, draft);
        const parsed = approvalPayloadSchema.safeParse({ operationType, input: merged });
        if (!parsed.success) {
          const msg = parsed.error.issues.map((i) => `${i.path.filter((p) => p !== 'input').join('.') || 'input'}: ${i.message}`).join('\n');
          setZodError(msg);
          throw new Error(msg);
        }
        setZodError(null);
        await onSubmit(merged);
      }}
    />
  );
}
