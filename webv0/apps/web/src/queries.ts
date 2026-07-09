import { useQuery } from '@tanstack/react-query';
import { api } from './apiClient';

export const usePeople = (enabled = true) =>
  useQuery({ queryKey: ['people'], queryFn: () => api.listPeople(), enabled });

export const usePerson = (id: string) =>
  useQuery({ queryKey: ['person', id], queryFn: () => api.getPerson(id) });

export const usePersonAudit = (id: string) =>
  useQuery({ queryKey: ['personAudit', id], queryFn: () => api.personAudit(id) });

export const useApprovals = (enabled = true) =>
  useQuery({ queryKey: ['approvals'], queryFn: () => api.listApprovals(), enabled });

export const useApproval = (id: string) =>
  useQuery({ queryKey: ['approval', id], queryFn: () => api.getApproval(id) });

export const useApprovalEvents = (id: string) =>
  useQuery({ queryKey: ['approvalEvents', id], queryFn: () => api.approvalEvents(id) });

export const useMembers = (enabled = true) =>
  useQuery({ queryKey: ['members'], queryFn: () => api.listMembers(), enabled });

export const useCredentials = () =>
  useQuery({ queryKey: ['credentials'], queryFn: () => api.listCredentials() });

export const usePersonCredentials = (personId: string) =>
  useQuery({ queryKey: ['personCredentials', personId], queryFn: () => api.personCredentials(personId) });

export const useJourneys = () =>
  useQuery({ queryKey: ['journeys'], queryFn: () => api.listJourneys() });

export const usePersonJourneys = (personId: string) =>
  useQuery({ queryKey: ['personJourneys', personId], queryFn: () => api.personJourneys(personId) });

export const usePersonAgreements = (personId: string, enabled = true) =>
  useQuery({ queryKey: ['personAgreements', personId], queryFn: () => api.personAgreements(personId), enabled });
export const usePersonMissionMemberships = (personId: string) =>
  useQuery({ queryKey: ['personMissions', personId], queryFn: () => api.personMissionMemberships(personId) });
export const usePersonApprovals = (personId: string, enabled = true) =>
  useQuery({ queryKey: ['personApprovals', personId], queryFn: () => api.personApprovals(personId), enabled });

export const useKit = () => useQuery({ queryKey: ['kit'], queryFn: () => api.listKit() });
export const useApparel = () => useQuery({ queryKey: ['apparel'], queryFn: () => api.listApparel() });

export const useAgreements = (enabled = true) =>
  useQuery({ queryKey: ['agreements'], queryFn: () => api.listAgreements(), enabled });
export const useAgreement = (agreementId: string, enabled = true) =>
  useQuery({ queryKey: ['agreement', agreementId], queryFn: () => api.getAgreement(agreementId), enabled });
export const useAgreementAudit = (agreementId: string, enabled = true) =>
  useQuery({ queryKey: ['agreementAudit', agreementId], queryFn: () => api.agreementAudit(agreementId), enabled });

export const useSituation = (enabled = true) =>
  useQuery({ queryKey: ['situation'], queryFn: () => api.situation(), enabled });

export const useEntities = (enabled = true) =>
  useQuery({ queryKey: ['entities'], queryFn: () => api.listEntities(), enabled });

export const useFxRates = (enabled = true) =>
  useQuery({ queryKey: ['fxRates'], queryFn: () => api.listFxRates(), enabled });

export const useMissions = () => useQuery({ queryKey: ['missions'], queryFn: () => api.listMissions() });
export const useMission = (missionId: string) =>
  useQuery({ queryKey: ['mission', missionId], queryFn: () => api.getMission(missionId) });
export const useMissionParticipants = (missionId: string) =>
  useQuery({ queryKey: ['missionParticipants', missionId], queryFn: () => api.missionParticipants(missionId) });
export const useMissionAudit = (missionId: string, enabled = true) =>
  useQuery({ queryKey: ['missionAudit', missionId], queryFn: () => api.missionAudit(missionId), enabled });
