import { useApp } from '@c3/hooks/useApp';
import type { C3Screen } from '@c3/types';

export const useNavigate = () => {
  const { navigate } = useApp();

  return {
    navigate: (screen: C3Screen) => navigate(screen),
    goBack: () => navigate({ id: 'command-center' }),
  };
};