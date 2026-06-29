import { useApp } from '@c3/context/AppContext';

/**
 * Returns true when the platform is running in SharePoint read-only mode.
 *
 * Use this to hide write/action controls that are not yet implemented for
 * the SharePoint data source. Sprint 18 will introduce governed write paths
 * and approval behaviour — at that point, call sites will replace this guard
 * with proper write-path logic rather than removing it.
 */
export const useSpReadOnly = (): boolean => {
  const { config } = useApp();
  return config.dataSourceMode === 'sharepoint';
};
