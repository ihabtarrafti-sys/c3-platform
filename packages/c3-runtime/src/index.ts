import type {
  PlatformApplication,
  PlatformHost,
} from '@geekay/platform-sdk';

import { runtime } from '@geekay/c3';

let currentContainer: HTMLElement | undefined;

export const application: PlatformApplication = {
  async start(host: PlatformHost): Promise<void> {
    currentContainer = host.container;

    runtime.mount(host.container, {
      context: host.context,
    });
  },

  async stop(): Promise<void> {
    if (!currentContainer) return;

    runtime.unmount(currentContainer);
    currentContainer = undefined;
  },
};

export { application as default };