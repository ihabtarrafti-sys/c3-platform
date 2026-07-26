/**
 * The Selector trigger-text contract (gap A1).
 *
 * The gap was invisible to every existing test because it only appears on
 * registers that ship a real ''-valued option, and all six such call sites had
 * already papered over it with a parallel `display` prop. These guards pin the
 * behaviour at the KIT so the workarounds can come out and stay out.
 */
import { describe, expect, it } from 'vitest';
import { selectorTriggerText } from '../src/tablework/selector';

/** The shape every one of the six real registers has: a blank option first. */
const WITH_BLANK = [
  { value: '', label: 'Not assigned' },
  { value: 'ent_1', label: 'Geekay FZ-LLC (UAE)' },
];

const NO_BLANK = [{ value: 'ent_1', label: 'Geekay FZ-LLC (UAE)' }];

describe('selectorTriggerText', () => {
  describe('A1 — an empty value is UNSET, not a choice of the blank option', () => {
    it('shows the placeholder at value === "" even when a ""-valued option exists', () => {
      // THE REGRESSION. The old resolution found the blank option here and
      // rendered "Not assigned" where the placeholder belonged.
      expect(selectorTriggerText({ value: '', placeholder: 'Select an entity', options: WITH_BLANK })).toEqual({
        label: 'Select an entity',
        isPlaceholder: true,
      });
    });

    it('marks it AS a placeholder, so the quiet styling applies', () => {
      // The styling half: the old code keyed the quiet class off "did an option
      // match", which the blank option satisfied.
      const { isPlaceholder } = selectorTriggerText({ value: '', placeholder: 'x', options: WITH_BLANK });
      expect(isPlaceholder).toBe(true);
    });

    it('still resolves a real chosen option normally', () => {
      expect(selectorTriggerText({ value: 'ent_1', placeholder: 'Select an entity', options: WITH_BLANK })).toEqual({
        label: 'Geekay FZ-LLC (UAE)',
        isPlaceholder: false,
      });
    });

    it('is unchanged on registers with no blank option', () => {
      expect(selectorTriggerText({ value: '', placeholder: 'Select an entity', options: NO_BLANK })).toEqual({
        label: 'Select an entity',
        isPlaceholder: true,
      });
    });

    // Every real ''-valued register in the app, by its own strings — these are
    // the six sites whose `display` workaround this fix retires.
    it.each([
      ['Not assigned', 'Select an entity'],
      ['— none —', '— none —'],
      ['No person — entity-level', 'Select a person'],
      ['Not linked', 'Not linked'],
    ])('blank option %j never beats placeholder %j', (blankLabel, placeholder) => {
      const { label } = selectorTriggerText({
        value: '',
        placeholder,
        options: [{ value: '', label: blankLabel }, { value: 'x', label: 'X' }],
      });
      expect(label).toBe(placeholder);
    });
  });

  describe('an explicit display is the caller stating the trigger text', () => {
    it('wins over a matching option', () => {
      expect(selectorTriggerText({ value: 'ent_1', display: 'GK · UAE', placeholder: 'p', options: WITH_BLANK })).toEqual({
        label: 'GK · UAE',
        isPlaceholder: false,
      });
    });

    it('is NOT placeholder-styled when no option matches it', () => {
      // The second live defect this fix closes: a mission whose team sits
      // outside the active-division options passes a real name as `display`,
      // and the old code rendered it in quiet placeholder styling because the
      // lookup missed.
      expect(selectorTriggerText({ value: 'team_archived', display: 'ACE · Valorant', placeholder: '— none —', options: WITH_BLANK })).toEqual({
        label: 'ACE · Valorant',
        isPlaceholder: false,
      });
    });

    it('an undefined display defers to the value (how the call sites disable it)', () => {
      expect(selectorTriggerText({ value: '', display: undefined, placeholder: 'p', options: WITH_BLANK })).toEqual({
        label: 'p',
        isPlaceholder: true,
      });
    });
  });

  describe('nothing honest to show', () => {
    it('falls back to the placeholder when the value is not in the register', () => {
      expect(selectorTriggerText({ value: 'gone', placeholder: 'Select an entity', options: NO_BLANK })).toEqual({
        label: 'Select an entity',
        isPlaceholder: true,
      });
    });

    it('renders empty rather than "undefined" when there is no placeholder either', () => {
      expect(selectorTriggerText({ value: '', options: NO_BLANK })).toEqual({ label: '', isPlaceholder: true });
    });
  });
});
