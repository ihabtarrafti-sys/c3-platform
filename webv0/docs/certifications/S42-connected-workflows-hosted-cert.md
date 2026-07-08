# Sprint 42 — Connected Workflows + Withdraw-My-Request: Hosted Certification

**Author:** Architect-of-record · **Date:** 2026-07-09.
**Result: ✅ HOSTED-CERTIFIED** — the person page as the operational hub, and the S41 single-owner-wedge finding closed by its product fix, live.

## Deployment evidence

Migration 0014 (owner-run): 14/14, status CHECK carries `Withdrawn`. API owner-deployed (person-hub routes 401 anonymous; health 200). Web Architect-deployed: Pages `8e5a4325`, bundle `index-Crd5g-Q-.js`, marker scan CLEAN, safe-order verified.

## Hosted smoke (Architect-verified in the audit stream)

- **THE WEDGE, CLOSED**: the owner deliberately repeated the S41 wedge move — self-submitted an agreement request (**APR-0030**, sub=ihab) — and then **withdrew it himself**: status `Withdrawn` (terminal), `ApprovalWithdrawn` audit under his own name, no side effects, no second owner needed. The finding recorded in the S41 cert is remediated and hosted-proven end to end.
- **The hub's write side**: from PER-0001's page, in-context governed submits landed pre-filled — **APR-0031 AddCredential** and **APR-0032 AddMissionParticipant**, both sub=m.khalailah / rev=ihab (requester ≠ approver held).
- **The hub's read side**: owner-confirmed the connected picture on one page — credentials, journeys, agreements (values visible to financial roles), missions with mission names, and the approvals history **listing the Withdrawn row honestly**.
- **Bonus (S41 UI item)**: the agreement Edit… dialog's new parent-link field used live — `AgreementUpdated` on AGR-0001 imaging `linkedAgreementId: null → "AGR-0003"`.

E2E coverage additionally certifies: the withdraw affordance is invisible to reviewers on others' requests; terminal Withdrawn removes it; the duplicate-pending guard treats Withdrawn as closed (the DB-level wedge-unblock proof).

## Engineering note of record

The recurring "credentials E2E flake" (previously written off as machine load) was root-caused this sprint: the Playwright suite is a single client IP and had outgrown the API's own 300 req/min rate limit — intermittent 429s surfaced as arbitrary mid-suite failures. Fixed at the source (`fdeaa4c`, E2E server rate ceiling raised; the limiter keeps its own certification). The same commit corrects one prior commit message that claimed a 7/7 run that was 6/7. Standard reaffirmed: no "flake" verdict without a root cause; no test counts claimed unread.

**Durable fixtures:** APR-0030 (Withdrawn, sub=ihab — the wedge-remedy evidence) + APR-0031/0032 and their created records.

## Claims note

No public claim; wording routes through the truthfulness pass separately.
