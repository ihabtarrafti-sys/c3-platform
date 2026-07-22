/**
 * shellInbox.ts — one inbox drawer per frame. The ContextHeader's bell and the
 * narrow bar's Inbox tab drive the SAME FloatSurface (duplicate drawers would
 * duplicate load-bearing testids in the DOM).
 */
import { createContext, useContext } from 'react';

export const InboxContext = createContext<{ open: boolean; setOpen: (o: boolean) => void } | null>(null);

export function useShellInbox() {
  const ctx = useContext(InboxContext);
  if (!ctx) throw new Error('useShellInbox must be used within AppFrame');
  return ctx;
}
