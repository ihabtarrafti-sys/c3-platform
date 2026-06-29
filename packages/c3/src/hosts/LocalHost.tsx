import type { AppConfig } from '@c3/config/AppConfig';
import type { C3CurrentUser } from '@c3/services/auth';
import { C3App } from '@c3/App';
import { useHostContext } from './HostContext';

const devUser: C3CurrentUser = {
  displayName: 'Ihab Tarrafti',
  email: 'ihab@geekaygroupmea.com',
  loginName: 'i:0#.f|membership|ihab@geekaygroupmea.com',
  c3Role: 'owner',
};

export const LocalHost = () => {
  const host = useHostContext();

  const config: AppConfig = {
    environment: host.environment,
    dataSourceMode: host.dataSourceMode,
    spSiteUrl:
      host.spSiteUrl ?? 'https://geekaygames.sharepoint.com/sites/C3',

    authService: {
      getCurrentUser: async () => devUser,
      getAccessToken: async () => '',
    },
  };

  return <C3App config={config} />;
};