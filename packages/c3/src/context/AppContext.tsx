import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Spinner } from '@fluentui/react-components';

import type { AppConfig } from '@c3/config/AppConfig';
import type { C3CurrentUser } from '@c3/services/auth';
import type { C3Screen } from '@c3/types';

interface AppContextValue {
  config: AppConfig;
  currentUser: C3CurrentUser;
  screen: C3Screen;
  navigate: (screen: C3Screen) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

interface AppProviderProps {
  config: AppConfig;
  children: ReactNode;
}

const AppLoadingScreen = () => {
  return (
    <div style={{ display: 'grid', placeItems: 'center', height: '100vh' }}>
      <Spinner label="Loading C3" />
    </div>
  );
};

export const AppProvider = ({ config, children }: AppProviderProps) => {
  const [currentUser, setCurrentUser] = useState<C3CurrentUser | null>(null);
  const [screen, setScreen] = useState<C3Screen>({ id: 'command-center' });

  useEffect(() => {
    config.authService.getCurrentUser().then(setCurrentUser);
  }, [config.authService]);

  if (!currentUser) return <AppLoadingScreen />;

  return (
    <AppContext.Provider
      value={{
        config,
        currentUser,
        screen,
        navigate: setScreen,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = (): AppContextValue => {
  const ctx = useContext(AppContext);

  if (!ctx) {
    throw new Error('useApp must be used inside AppProvider');
  }

  return ctx;
};