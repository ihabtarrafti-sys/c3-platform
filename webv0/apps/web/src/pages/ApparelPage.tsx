import { useQuery } from '@tanstack/react-query';
import { api } from '../apiClient';
import { EquipmentPage, type EquipmentPageConfig, type EquipmentRow } from './EquipmentPage';

/** Apparel register (Sprint 38) — the shared EquipmentPage; HR may manage (CP parity). */
const config: EquipmentPageConfig = {
  title: 'Apparel',
  itemNoun: 'apparel item',
  testPrefix: 'apparel',
  capability: 'canManageApparel',
  queryKey: 'apparel',
  useList: () =>
    useQuery({
      queryKey: ['apparel'],
      queryFn: async () => {
        const res = await api.listApparel();
        return { rows: res.apparel.map((a): EquipmentRow => ({ id: a.apparelId, ...a })) };
      },
    }),
  create: (body) => api.createApparel(body),
  update: (id, body) => api.updateApparel(id, body),
  deactivate: (id, v) => api.deactivateApparel(id, v),
};

export function ApparelPage() {
  return <EquipmentPage config={config} />;
}
