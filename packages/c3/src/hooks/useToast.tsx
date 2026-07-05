/**
 * useToast — C3 toast notification hook
 *
 * Thin wrapper around Fluent UI's useToastController, scoped to the
 * c3-toaster Toaster instance mounted in App.tsx.
 *
 * Usage:
 *   const toast = useToast();
 *   toast.success('Amendment created');
 *   toast.error('Failed to submit', 'Please try again.');
 *
 * The Toaster must be present in the tree (App.tsx) for dispatched toasts
 * to render.
 */

import {
  Toast,
  ToastBody,
  ToastTitle,
  useToastController,
} from '@fluentui/react-components';

import { useApp } from '@c3/hooks/useApp';
import { useNotifications } from '@c3/components/NotificationRegion';

/** Shared toaster ID — must match the toasterId on <Toaster> in App.tsx. */
export const C3_TOASTER_ID = 'c3-toaster';

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Governed-write and general notifications.
 *
 * When the Fluent <Toaster> is mounted (Mock / local host, disableToasts falsy)
 * dispatches Fluent toasts — behaviour unchanged. When the host disables the
 * Toaster (SPFx-hosted, disableToasts === true) the Toaster is absent and Fluent
 * dispatches would be SILENT, so we route to the always-mounted inline
 * NotificationRegion instead (Sprint 33, RISK-1). The public { success, error }
 * surface is unchanged, so all call sites are covered without modification.
 */
export const useToast = () => {
  const { dispatchToast } = useToastController(C3_TOASTER_ID);
  const { notify } = useNotifications();
  const { config } = useApp();
  const useInline = config.disableToasts === true;

  const success = (title: string, body?: string) => {
    if (useInline) {
      notify({ intent: 'success', title, body });
      return;
    }
    dispatchToast(
      <Toast>
        <ToastTitle>{title}</ToastTitle>
        {body && <ToastBody>{body}</ToastBody>}
      </Toast>,
      { intent: 'success', timeout: 4000 },
    );
  };

  const error = (title: string, body?: string) => {
    if (useInline) {
      notify({ intent: 'error', title, body });
      return;
    }
    dispatchToast(
      <Toast>
        <ToastTitle>{title}</ToastTitle>
        {body && <ToastBody>{body}</ToastBody>}
      </Toast>,
      { intent: 'error', timeout: 6000 },
    );
  };

  return { success, error };
};
