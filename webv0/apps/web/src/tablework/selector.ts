/**
 * selector.ts — the Selector's TRIGGER-TEXT resolution (gap A1).
 *
 * Pure, so the contract is pinned by a test rather than by inspection. The
 * component owns the popup, focus and keyboard; this owns the single question
 * "what does the closed trigger read, and is that a placeholder?".
 *
 * ⚖️ THE RULE THE GAP BROKE: an empty value means UNSET. A register may carry a
 * real ''-valued option ("Not assigned", "— none —", "No person — entity-level")
 * because the user must be able to CHOOSE blank from the list — but choosing
 * blank and having chosen nothing are the same state, so the trigger must read
 * the placeholder either way. The old expression resolved
 * `display ?? options.find(o => o.value === value)?.label ?? placeholder`,
 * which FINDS the blank option at value === '' and therefore could never reach
 * `placeholder` on exactly the six registers that ship one. Six call sites had
 * independently worked around it with a parallel `display` prop.
 *
 * ⚖️ AND THE STYLING, which is the half that was easy to miss: the trigger's
 * quiet `selector-placeholder` class was keyed off "did an option match", not
 * off "are we showing the placeholder". Those come apart in BOTH directions —
 * the blank option made real placeholder text render as if chosen, and a
 * `display` string with no matching option (a mission whose team sits outside
 * the active-division list) made real chosen text render as if it were a
 * placeholder. One decision now produces both, so they cannot drift again.
 */

/** The two facts the trigger needs. `isPlaceholder` drives the quiet styling. */
export interface SelectorTriggerText {
  label: string;
  isPlaceholder: boolean;
}

export function selectorTriggerText({
  value,
  display,
  placeholder,
  options,
}: {
  value: string;
  display?: string;
  placeholder?: string;
  /** Structural, so this module never has to import the component's types. */
  options: readonly { value: string; label: string }[];
}): SelectorTriggerText {
  // An explicit `display` is the caller stating the trigger text outright — it
  // is never a placeholder, even when no option matches it.
  if (display !== undefined) return { label: display, isPlaceholder: false };

  // A1: '' is UNSET. Skip the lookup entirely rather than let a ''-valued
  // option answer it — the blank option's label belongs in the LIST, where the
  // user picks it, not on a trigger that is meant to read as empty.
  const chosen = value === '' ? undefined : options.find((o) => o.value === value);
  if (chosen) return { label: chosen.label, isPlaceholder: false };

  // Either unset, or set to a value this register does not offer. Neither has
  // an honest label, so both show the placeholder.
  return { label: placeholder ?? '', isPlaceholder: true };
}
