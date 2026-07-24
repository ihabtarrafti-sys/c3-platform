/**
 * dates.ts — the Tablework date DISPLAY capability (F3 / UX2).
 *
 * Stored dates are ISO (YYYY-MM-DD); date INPUTS stay ISO too (an
 * `<input type="date">`'s `.value` is always ISO regardless of locale). This
 * formats a stored ISO date for HUMAN DISPLAY as DD/MM/YYYY.
 *
 * It is an AVAILABLE capability, adopted per-screen as Wave-2 conversions land
 * — it re-wires no existing display on its own, so it is a no-op on the frozen
 * e2e oracle (which pins several dates as raw ISO). A screen adopting it edits
 * the assertions that pin that field, through the freeze law.
 *
 * ⚠️ NOT for PII / legal dates (DOB, credential/agreement dates) without the
 * owner's format ruling — those may stay ISO for unambiguous precision.
 */
export function formatDisplayDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  // A non-ISO string passes through untouched — the formatter never invents a
  // reading it cannot justify from the shape.
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}
