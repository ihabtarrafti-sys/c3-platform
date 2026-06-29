import * as React from 'react';

import type { IC3HostProps } from './IC3HostProps';
import type { PlatformApplication } from '../runtime/C3RuntimeLoader';

export default class C3Host extends React.Component<IC3HostProps> {
  private readonly containerRef = React.createRef<HTMLDivElement>();
  private application?: PlatformApplication;

  public async componentDidMount(): Promise<void> {
    if (!this.containerRef.current) return;

    const runtimeModule = await import(
      /* webpackChunkName: 'c3-runtime' */
      /* webpackIgnore: true */
      '../assets/c3-runtime/c3-runtime.js'
    );

    this.application = runtimeModule.application as PlatformApplication;

    await this.application.start({
      container: this.containerRef.current,
      context: {
        environment: 'dev',
        dataSourceMode: 'mock',
        services: {},
      },
    });
  }

  public async componentWillUnmount(): Promise<void> {
    if (!this.application) return;

    await this.application.stop();
  }

  public render(): React.ReactElement<IC3HostProps> {
    return <div ref={this.containerRef} />;
  }
}