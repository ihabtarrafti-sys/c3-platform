/**
 * composeNote — the sole sanctioned writer into note/reason free-text fields
 * (N-1, the disclosure chapter's ruling, 2026-07-28).
 *
 * THE LAW: the free-text channel is ID-AND-ENUM-ONLY, BY CONSTRUCTION. Notes
 * are unprojected — they reach every reader the surface reaches, including
 * delegates whose role holds no PII/financial/member standing — so restricted
 * VALUES (a bank label, an email, a name) must never enter them at the
 * producer. Records are referenced by ID and kind token only; readers render
 * IDs as links where they resolve, and the human-readable label comes through
 * the PROJECTED record fetch — for exactly the callers entitled to it.
 *
 * Why a tagged template with branded slots, not a lint rule or a regex gate:
 * a shape check cannot distinguish a name from a phrase, and reviewer
 * vigilance decays; a type cannot. `composeNote` accepts ONLY `NoteSlot`
 * values in its holes — a raw string interpolation is a compile error — and
 * the two slot constructors are the whole vocabulary:
 *
 *   id(x)    — a canonical business id (PER-0001, BEN-0012, APR-0007…) or a
 *              member user uuid. VALIDATED at runtime against the id grammar;
 *              a non-id string throws at the producer, where the bug is.
 *   token(x) — a value from a closed enum union (a role, an op type, a field
 *              KEY list). Typed so only literal-union types are accepted —
 *              passing a plain `string` is a compile error.
 *
 * Ruled at N-1: "Either the note channel carries no restricted data at the
 * producer, or the channel inherits the payload's disclosure decision. I rule
 * producer-side: restricted values must not enter free text in the first
 * place. Fixing it at the reader is unbounded."
 */

/** The canonical business-id grammar (comms.ts pins the same shape) + uuids. */
const CANONICAL_ID = /^[A-Z]{2,4}-\d{4,}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

declare const NOTE_SLOT: unique symbol;
export interface NoteSlot {
  readonly [NOTE_SLOT]: true;
  readonly text: string;
}

const slot = (text: string): NoteSlot => ({ text }) as NoteSlot;

/** A record reference: canonical business id or member user uuid. Throws at
 *  the PRODUCER on anything else — the bug surfaces where it lives. */
export function id(value: string): NoteSlot {
  if (!CANONICAL_ID.test(value) && !UUID.test(value)) {
    throw new Error(`composeNote.id: not an id-shaped value: "${value.slice(0, 40)}"`);
  }
  return slot(value);
}

/**
 * A closed-vocabulary token (role, op type, mode, field key). The conditional
 * type rejects plain `string`: only literal/union string types pass — the
 * compiler proves the value came from an enum, not from user input.
 */
export function token<T extends string>(value: string extends T ? never : T): NoteSlot {
  return slot(value);
}

/** A list of tokens (e.g. patched field KEYS — schema words, never values). */
export function tokens<T extends string>(values: readonly (string extends T ? never : T)[]): NoteSlot {
  return slot(values.join(', '));
}

/** The tagged template. Only NoteSlot holes compile. */
export function composeNote(strings: TemplateStringsArray, ...slots: NoteSlot[]): string {
  let out = strings[0] ?? '';
  for (let i = 0; i < slots.length; i++) out += slots[i]!.text + (strings[i + 1] ?? '');
  return out;
}
