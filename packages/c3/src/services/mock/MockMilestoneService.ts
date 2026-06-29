import type { MissionMilestone } from '@c3/types';
import type { IMilestoneService } from '../interfaces/IMilestoneService';

/**
 * Mock milestone data — eight milestones for TR/2026/006 (RLCS 2026).
 *
 * Designed to produce a realistic spread of statuses relative to today
 * (2026-06-29) and the mission departure (2026-07-08, 9 days away):
 *
 *   ml-006-001  Roster confirmed               Complete   (done 2026-05-14)
 *   ml-006-002  Tournament registration         Complete   (done 2026-05-19)
 *   ml-006-003  Visa applications submitted     Overdue    (due 2026-06-09, 20d past)
 *   ml-006-004  Flights booked                  DueSoon    (due 2026-07-01, 2d)
 *   ml-006-005  Pre-departure briefing          DueSoon    (due 2026-07-05, 6d)
 *   ml-006-006  Accommodation confirmed         Upcoming   (due 2026-07-07, 8d)
 *   ml-006-007  Equipment / peripherals shipped Upcoming   (due 2026-07-10, 11d)
 *   ml-006-008  Travel document pack ready      Upcoming   (due 2026-07-12, 13d)
 *
 * WorkItems generated (Overdue or DueSoon, departure in 9 days):
 *   ml-006-003 → High  (overdue, departure > 7d)
 *   ml-006-004 → High  (daysUntilDue ≤ 3 AND departure ≤ 14d)
 *   ml-006-005 → Normal (daysUntilDue > 3)
 *
 * SATR/2026/003 is FinancePending → excluded by ADR-002 gate.
 * No milestones seeded for it (they would never reach the work queue).
 */
const MOCK_MILESTONES: MissionMilestone[] = [
  {
    MilestoneID:   'ml-006-001',
    MissionID:     'TR/2026/006',
    Name:          'Roster confirmed',
    Description:   'Final player roster submitted and approved by team management.',
    Category:      'Roster',
    Owner:         'Ops Coordinator',
    PlannedDate:   '2026-05-15',
    CompletedDate: '2026-05-14',
    CreatedAt:     '2026-05-01T08:00:00Z',
  },
  {
    MilestoneID:   'ml-006-002',
    MissionID:     'TR/2026/006',
    Name:          'Tournament registration submitted',
    Description:   'Team registration submitted to Psyonix / EWC by the deadline.',
    Category:      'Compliance',
    Owner:         'Ops Coordinator',
    PlannedDate:   '2026-05-20',
    CompletedDate: '2026-05-19',
    CreatedAt:     '2026-05-01T08:00:00Z',
  },
  {
    MilestoneID: 'ml-006-003',
    MissionID:   'TR/2026/006',
    Name:        'Visa applications submitted',
    Description: 'Schengen visa applications lodged for all non-EU participants.',
    Category:    'Compliance',
    Owner:       'Compliance Officer',
    PlannedDate: '2026-06-09',
    CreatedAt:   '2026-05-01T08:00:00Z',
    Notes:       'PER-0002 application delayed — requires updated Right to Work certificate.',
  },
  {
    MilestoneID: 'ml-006-004',
    MissionID:   'TR/2026/006',
    Name:        'Flights booked',
    Description: 'All participant flights confirmed with booking references issued.',
    Category:    'Logistics',
    Owner:       'Travel Coordinator',
    PlannedDate: '2026-07-01',
    CreatedAt:   '2026-05-01T08:00:00Z',
  },
  {
    MilestoneID: 'ml-006-005',
    MissionID:   'TR/2026/006',
    Name:        'Pre-departure briefing',
    Description: 'Team briefing covering travel logistics, tournament schedule, and conduct.',
    Category:    'Event',
    Owner:       'Team Manager',
    PlannedDate: '2026-07-05',
    CreatedAt:   '2026-05-01T08:00:00Z',
  },
  {
    MilestoneID: 'ml-006-006',
    MissionID:   'TR/2026/006',
    Name:        'Accommodation confirmed',
    Description: 'Hotel blocks confirmed and room assignments communicated to participants.',
    Category:    'Logistics',
    Owner:       'Travel Coordinator',
    PlannedDate: '2026-07-07',
    CreatedAt:   '2026-05-01T08:00:00Z',
  },
  {
    MilestoneID: 'ml-006-007',
    MissionID:   'TR/2026/006',
    Name:        'Equipment / peripherals shipped',
    Description: 'Gaming peripherals and team equipment shipped via freight to Paris venue.',
    Category:    'Logistics',
    Owner:       'Ops Coordinator',
    PlannedDate: '2026-07-10',
    CreatedAt:   '2026-05-01T08:00:00Z',
    Notes:       'Coordinate with EWC venue ops for customs clearance on entry.',
  },
  {
    MilestoneID: 'ml-006-008',
    MissionID:   'TR/2026/006',
    Name:        'Travel document pack ready',
    Description: 'Individual travel packs distributed: itinerary, hotel confirmation, per diem.',
    Category:    'Documents',
    Owner:       'Ops Coordinator',
    PlannedDate: '2026-07-12',
    CreatedAt:   '2026-05-01T08:00:00Z',
  },
];

/**
 * In-memory store for mock milestone state.
 * Mutable so that completeMilestone updates persist within the session.
 */
let milestoneStore: MissionMilestone[] = MOCK_MILESTONES.map(m => ({ ...m }));

export const createMockMilestoneService = (): IMilestoneService => ({
  async listMissionMilestones(missionId: string): Promise<MissionMilestone[]> {
    return milestoneStore
      .filter(m => m.MissionID === missionId)
      .sort((a, b) => a.PlannedDate.localeCompare(b.PlannedDate));
  },

  async listAllMilestones(): Promise<MissionMilestone[]> {
    return [...milestoneStore].sort((a, b) =>
      a.PlannedDate.localeCompare(b.PlannedDate),
    );
  },

  async completeMilestone(milestoneId: string): Promise<MissionMilestone> {
    const idx = milestoneStore.findIndex(m => m.MilestoneID === milestoneId);
    if (idx === -1) {
      throw new Error(`MockMilestoneService.completeMilestone: milestone ${milestoneId} not found`);
    }
    const milestone = milestoneStore[idx];
    if (milestone.CompletedDate) {
      throw new Error(
        `MockMilestoneService.completeMilestone: milestone ${milestoneId} is already complete`,
      );
    }
    const today = new Date().toISOString().split('T')[0];
    const updated: MissionMilestone = { ...milestone, CompletedDate: today };
    milestoneStore = [
      ...milestoneStore.slice(0, idx),
      updated,
      ...milestoneStore.slice(idx + 1),
    ];
    return updated;
  },
});
