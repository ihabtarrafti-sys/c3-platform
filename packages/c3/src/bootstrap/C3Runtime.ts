import type { HostRuntime } from './HostRuntime';

export interface C3Runtime {
  mount(container: HTMLElement, runtime: HostRuntime): void;
  unmount(container: HTMLElement): void;
}