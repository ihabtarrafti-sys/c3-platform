import type { Activity, Contract, Person } from '@c3/types';
import type { CreatePersonInput } from '@c3/types/people';
import type { IPersonService } from '../interfaces/IPersonService';
import { mockContracts, mockPeople } from '../mockData';

// ---------------------------------------------------------------------------
// Mutable extra-people store
//
// Keeps the mockData.ts const arrays immutable while still supporting
// AddPerson execution in Mock DSM. Created people live only for the current
// module lifetime (reset on hot-reload / page refresh — same as mock approvals).
//
// The store lives outside the factory so it persists across multiple service
// instance creations within the same module session (e.g. React re-renders
// that call createMockPersonService again).
//
// PER-XXXX generation: reads the highest existing Id across both the static
// set and the extra store, then increments by 1. Gaps are acceptable.
// ---------------------------------------------------------------------------

let extraPeople: Person[] = [];
let nextPersonIndex: number | null = null;

function getNextPersonIndex(): number {
  if (nextPersonIndex !== null) {
    return nextPersonIndex;
  }
  // Seed from static mockPeople: derive highest numeric suffix from PersonID strings.
  const ids = mockPeople
    .map(p => {
      const m = p.PersonID.match(/PER-(\d+)$/);
      return m ? parseInt(m[1], 10) : 0;
    })
    .filter(n => Number.isFinite(n));
  nextPersonIndex = (ids.length > 0 ? Math.max(...ids) : 0) + 1;
  return nextPersonIndex;
}

export const createMockPersonService = (): IPersonService => ({
  listPeople(): Promise<Person[]> {
    // Combine static people with any created during this session.
    return Promise.resolve([...mockPeople, ...extraPeople]);
  },

  getPerson(personId: string): Promise<Person> {
    const all = [...mockPeople, ...extraPeople];
    const person = all.find(
      item => String(item.Id) === personId || item.PersonID === personId,
    );
    if (!person) {
      return Promise.reject(new Error(`Person not found: ${personId}`));
    }
    return Promise.resolve(person);
  },

  // Sprint 24 Phase 1: Filter by PersonID (PER-XXXX canonical FK).
  listPersonContracts(personId: string): Promise<Contract[]> {
    if (!personId || personId.trim().length === 0) {
      return Promise.resolve([]);
    }
    return Promise.resolve(
      mockContracts.filter(c => c.PersonID === personId),
    );
  },

  listPersonActivities(personId: string, limit?: number): Promise<Activity[]> {
    void personId;
    void limit;
    return Promise.resolve([]);
  },

  // -- createPerson ----------------------------------------------------------
  // Sprint 25 -- AddPerson mock execution.
  //
  // Generates a canonical PER-XXXX using the next available index (derived
  // from the highest existing static PersonID suffix, then incremented per call).
  // IsActive defaults to true.
  //
  // The created person is appended to the module-scoped extraPeople store so it
  // is visible in subsequent listPeople() and getPerson() calls within the same
  // session. The store is reset on page reload (acceptable for mock DSM).
  //
  // Must only be called from the AddPerson execution branch in useExecuteApproval.
  // Not a direct-write UI action.
  createPerson(input: CreatePersonInput): Promise<Person> {
    if (!input.FullName || !input.FullName.trim()) {
      return Promise.reject(new Error('[C3/People/Mock] createPerson: FullName is required.'));
    }

    const idx   = getNextPersonIndex();
    nextPersonIndex = idx + 1;

    const personId = `PER-${String(idx).padStart(4, '0')}`;

    const created: Person = {
      Id:                idx,
      PersonID:          personId,
      FullName:          input.FullName.trim(),
      IGN:               input.IGN?.trim()               || undefined,
      Nationality:       input.Nationality?.trim()        || undefined,
      PrimaryRole:       input.PrimaryRole?.trim()        || undefined,
      PersonnelCode:     input.PersonnelCode?.trim()      || undefined,
      CurrentTeam:       input.CurrentTeam?.trim()        || undefined,
      CurrentGameTitle:  input.CurrentGameTitle?.trim()   || undefined,
      PrimaryDepartment: input.PrimaryDepartment?.trim()  || undefined,
      IsActive:          true,
      Notes:             input.Notes?.trim()              || undefined,
    };

    extraPeople = [...extraPeople, created];
    console.info(`[C3/People/Mock] createPerson: created ${personId} for "${created.FullName}"`);
    return Promise.resolve(created);
  },
});
