import * as React from 'react';

import type { IC3HostProps } from './IC3HostProps';
import type { PlatformApplication } from '../runtime/C3RuntimeLoader';

export default class C3Host extends React.Component<IC3HostProps> {
  private readonly containerRef = React.createRef<HTMLDivElement>();
  private application?: PlatformApplication;

  public async componentDidMount(): Promise<void> {
    if (!this.containerRef.current) return;

    // webpackIgnore was removed intentionally.
    //
    // With webpackIgnore: true the relative specifier
    // '../assets/c3-runtime/c3-runtime.js' was emitted verbatim into the
    // output bundle. When that bundle is loaded cross-origin (localhost:4321
    // inside a SharePoint page), the browser cannot resolve a relative
    // specifier — the base URL is about:blank for cross-origin scripts.
    //
    // Without webpackIgnore, webpack owns the dynamic import, assigns the
    // chunk an absolute URL via __webpack_public_path__, and loads it
    // correctly regardless of cross-origin context.
    const runtimeModule = await import(
      /* webpackChunkName: 'c3-runtime' */
      '../assets/c3-runtime/c3-runtime.js'
    );

    // The compiled runtime exports { mountC3, runtime, unmountC3 }.
    // 'runtime' is the { mount, unmount } object — the host API surface.
    this.application = runtimeModule.runtime as PlatformApplication;

    this.application.mount(this.containerRef.current, {
      context: {
        environment: 'dev',
        dataSourceMode: this.props.dataSourceMode,
        spSiteUrl: this.props.spSiteUrl,
        userLoginName: this.props.userLoginName,
        // Fluent UI v9 Toaster registration fails in the SPFx-hosted workbench.
        // Disable Toaster mounting until root cause is resolved (Sprint 16).
        disableToasts: true,
        services: {},
      },
    });
  }

  public componentWillUnmount(): void {
    if (!this.application || !this.containerRef.current) return;

    this.application.unmount(this.containerRef.current);
  }

  public render(): React.ReactElement<IC3HostProps> {
     return <div ref={this.containerRef} />;
  }
}
