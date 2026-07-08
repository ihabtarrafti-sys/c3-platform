import { useQuery } from '@tanstack/react-query';
import { api } from '../apiClient';
import { EquipmentPage, type EquipmentPageConfig, type EquipmentRow } from './EquipmentPage';

/** Kit register (Sprint 38) — the shared EquipmentPage in its kit configuration. */
const config: EquipmentPageConfig = {
  title: 'Kit',
  itemNoun: 'kit item',
  testPrefix: 'kit',
  capability: 'canManageKit',
  queryKey: 'kit',
  useList: () =>
    useQuery({
      queryKey: ['kit'],
      queryFn: async () => {
        const res = await api.listKit();
        return { rows: res.kit.map((k): EquipmentRow => ({ id: k.kitId, ...k })) };
      },
    }),
  create: (body) => api.createKit(body),
  update: (id, body) => api.updateKit(id, body),
  deactivate: (id, v) => api.deactivateKit(id, v),
};

export function KitPage() {
  return <EquipmentPage config={config} />;
}
