/**
 * dataQualityOps — S5 riders: the data-quality report over the actor's own
 * RLS'd reads. Owner/operations only (the same standing as import/export —
 * this is org-stewardship tooling, and agreement rows ride in it). Pure
 * read: nothing here mutates, ever.
 */
import { buildDataQualityReport, type Actor, type DataQualityReport } from '@c3web/domain';
import { assertSubmitApproval } from '@c3web/authz';
import type { Persistence } from '../ports';

export async function getDataQualityReport(p: Persistence, actor: Actor): Promise<DataQualityReport> {
  assertSubmitApproval(actor);
  const reads = p.reads.forActor(actor);
  const [people, credentials, agreements] = await Promise.all([reads.listPeople(), reads.listCredentials(), reads.listAgreements()]);
  const today = new Date().toISOString().slice(0, 10);
  return buildDataQualityReport({ people, credentials, agreements }, today);
}
