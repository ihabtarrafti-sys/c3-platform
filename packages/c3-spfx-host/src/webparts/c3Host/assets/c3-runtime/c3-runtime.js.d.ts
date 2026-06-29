import type { PlatformApplication, PlatformContext } from '../../runtime/C3RuntimeLoader';

/** The runtime object exported by the compiled C3 bundle. */
export declare const runtime: PlatformApplication;

/** Mount C3 directly into a container element. Equivalent to runtime.mount(). */
export declare function mountC3(
  container: HTMLElement,
  options: { context: PlatformContext },
): void;

/** Unmount C3 from a container element. Equivalent to runtime.unmount(). */
export declare function unmountC3(container: HTMLElement): void;
