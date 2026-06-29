import React from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { LocalHost } from '../hosts/LocalHost';
import {
  defaultHostContext,
  HostContextProvider,
} from '../hosts/HostContext';

import type { HostRuntime } from './HostRuntime';

import type { C3Runtime } from './C3Runtime';

const roots = new WeakMap<HTMLElement, Root>();

export const mountC3 = (
  container: HTMLElement,
  runtime?: HostRuntime,
): void => {
  const hostContext = {
  ...defaultHostContext,
  ...(runtime?.context ?? {}),
};

  const existingRoot = roots.get(container);

  if (existingRoot) {
    existingRoot.unmount();
  }

  const root = createRoot(container);
  roots.set(container, root);

  root.render(
    <React.StrictMode>
      <HostContextProvider value={hostContext}>
        <LocalHost />
      </HostContextProvider>
    </React.StrictMode>,
  );
};

export const unmountC3 = (container: HTMLElement): void => {
  const root = roots.get(container);

  if (!root) return;

  root.unmount();
  roots.delete(container);
};

export const runtime: C3Runtime = {
  mount: mountC3,
  unmount: unmountC3,
};