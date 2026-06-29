import type { Person } from '@c3/types';

interface SPLookupValue {
  Title?: string;
  LookupValue?: string;
}

export interface SPPersonItem {
  Id: number;
  ID?: number;

  Title: string;

  PersonID: string;
  DisplayName?: string;
  IGN?: string;
  PlayerCode?: string;

  Nationality?: string;
  PrimaryRole?: string;

  CurrentTeam?: SPLookupValue | string | null;
  CurrentGameTitle?: SPLookupValue | string | null;
  PrimaryDepartment?: SPLookupValue | string | null;

  isActive?: boolean;

  FirstContractDate?: string;
  LatestContractDate?: string;
  TotalContracts?: number;

  Notes?: string;
}

export const mapPerson = (item: SPPersonItem): Person => {
  return {
    Id: item.Id ?? item.ID ?? 0,

    FullName: item.Title,
    IGN: item.IGN,

    PersonnelCode: item.PlayerCode ?? item.PersonID,
    PersonID: item.PersonID,

    Nationality: item.Nationality,
    PrimaryRole: item.PrimaryRole,

    CurrentTeam: normalizeLookup(item.CurrentTeam),
    CurrentGameTitle: normalizeLookup(item.CurrentGameTitle),
    PrimaryDepartment: normalizeLookup(item.PrimaryDepartment),

    IsActive: item.isActive ?? false,

    FirstContractDate: item.FirstContractDate,
    LatestContractDate: item.LatestContractDate,
    TotalContracts: item.TotalContracts,

    Notes: item.Notes,
  };
};

const normalizeLookup = (
  value?: SPLookupValue | string | null,
): string | undefined => {
  if (!value) return undefined;

  if (typeof value === 'string') {
    return value;
  }

  return value.Title ?? value.LookupValue;
};