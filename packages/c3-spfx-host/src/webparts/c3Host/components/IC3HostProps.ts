export interface IC3HostProps {
  description: string;
  isDarkTheme: boolean;
  environmentMessage: string;
  hasTeamsContext: boolean;
  userDisplayName: string;
  /** SPFx claims login name, e.g. "i:0#.f|membership|user@tenant.onmicrosoft.com". */
  userLoginName: string;
  /** Absolute URL of the SharePoint web, from pageContext.web.absoluteUrl. */
  spSiteUrl: string;
  /** Data source mode -- passed from the web part property pane. Default: mock. */
  dataSourceMode: 'mock' | 'sharepoint';
}
