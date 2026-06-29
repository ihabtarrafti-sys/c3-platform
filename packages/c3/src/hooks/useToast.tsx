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

/** Shared toaster ID — must match the toasterId on <Toaster> in App.tsx. */
export const C3_TOASTER_ID = 'c3-toaster';

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export const useToast = () => {
  const { dispatchToast } = useToastController(C3_TOASTER_ID);

  const success = (title: string, body?: string) => {
    dispatchToast(
      <Toast>
        <ToastTitle>{title}</ToastTitle>
        {body && <ToastBody>{body}</ToastBody>}
      </Toast>,
      { intent: 'success', timeout: 4000 },
    );
  };

  const error = (title: string, body?: string) => {
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
