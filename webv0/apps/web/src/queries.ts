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
