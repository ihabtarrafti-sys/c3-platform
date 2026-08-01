import { useEffect, useState } from 'react';
import type { MissionCommandModuleId } from './missionCommandModel';

export function mayRecordWorkspaceRead(
  foregroundModule: MissionCommandModuleId | null,
  visibilityState: DocumentVisibilityState,
  hasFocus: boolean,
  dialogOpen: boolean,
): boolean {
  return foregroundModule === 'mission-current' && visibilityState === 'visible' && hasFocus && !dialogOpen;
}

interface DocumentAttention {
  readonly visibilityState: DocumentVisibilityState;
  readonly hasFocus: boolean;
  readonly dialogOpen: boolean;
}

export function documentHasOpenDialog(
  target: { querySelector(selector: string): Element | null } = document,
): boolean {
  return target.querySelector('dialog[open]') !== null;
}

function attentionSnapshot(): DocumentAttention {
  return {
    visibilityState: document.visibilityState,
    hasFocus: document.hasFocus(),
    dialogOpen: documentHasOpenDialog(),
  };
}

/** A workspace receipt or re-witness is earned only while the browser itself
 * is attentive. The module z-order is composed separately by its owner. */
export function useDocumentAttention(): DocumentAttention {
  const [attention, setAttention] = useState(attentionSnapshot);
  useEffect(() => {
    const update = () => setAttention(attentionSnapshot());
    document.addEventListener('visibilitychange', update);
    window.addEventListener('focus', update);
    window.addEventListener('blur', update);
    const dialogObserver = new MutationObserver(update);
    dialogObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['open'],
      childList: true,
      subtree: true,
    });
    return () => {
      document.removeEventListener('visibilitychange', update);
      window.removeEventListener('focus', update);
      window.removeEventListener('blur', update);
      dialogObserver.disconnect();
    };
  }, []);
  return attention;
}
