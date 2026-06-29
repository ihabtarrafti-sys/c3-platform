# Mission Discovery Checklist

**Status:** Pre-implementation gate  
**Date:** 2026-06-28  
**Purpose:** Identify exactly what must be confirmed before any Mission entity, UI, or data model is implemented. Each item below requires a concrete answer from the real operational data, the finance team, or operations management — not an assumption.

Complete this checklist first. Then decide whether Mission enters Sprint 9 or a later sprint.

---

## How to Use This Checklist

Each item has:
- **The question** — what needs to be confirmed
- **Why it blocks implementation** — what goes wrong if we assume instead of confirm
- **Where the answer lives** — who or what holds the real data
- **Answer** — to be filled in during discovery

Mark each item: ⬜ Not started · 🔄 In progress · ✅ Confirmed · ❌ Blocked

---

## Section 1 — Mission Identity and Codes

### 1.1 Is the TR code the canonical MissionID?

**Question:** Should `TR/2026/006` be the platform's MissionID, or do we need a separate internal ID?

**Why it blocks:** If Finance, Operations, and Content already use TR codes as the shared reference key across systems, adopting them in the platform means all existing records are immediately linkable. If TR codes are only a Finance artifact, we may need our own ID and a mapping table.

**Where the answer lives:** The Sales Orders tab already links TR codes to Finance. Check whether Operations and Content also reference TR codes natively.

**Answer:** ⬜

---

### 1.2 What does the TR code structure encode, and is it stable?

**Question:** `TR/[YEAR]/[SEQ]` (UAE) and `SATR/[YEAR]/[SEQ]` (KSA). Is this structure formally defined and consistently applied? Can we parse the entity from the prefix reliably?

**Why it blocks:** If the prefix is formal and stable, we can derive the legal entity from the code. If it is informal and inconsistently applied, we need an explicit Entity field.

**Where the answer lives:** The Tournament Code master sheet — check whether SATR codes are exclusively KSA and TR codes exclusively UAE, or whether exceptions exist.

**Answer:** ⬜

---

### 1.3 Do Campaign codes (CAM) follow Mission semantics, or are they a separate entity?

**Question:** The Sales Orders tab includes CAM codes (e.g. `CAM00024` — E Sports Players Consumables). These are not tournament participations. Are Campaigns a distinct entity from Missions, or a Mission subtype?

**Why it blocks:** If Campaigns share the Mission lifecycle (participants, span, obligations) they should be the same entity type with a discriminator. If they are fundamentally different (content sponsorships, product campaigns with no operational roster), they are a separate domain and should not be conflated with Mission.

**Where the answer lives:** Finance and Management — what is the operational structure of a Campaign vs. a Tournament Mission?

**Answer:** ⬜

---

## Section 2 — Personnel Codes and C3 Person Mapping

### 2.1 What is the full structure of participant codes?

**Question:** The budget sheet uses `RL/PL/026` and `RL/CH/004`. Is the structure `[GAME_CODE]/[ROLE_CODE]/[SEQ]` consistently applied? What are all valid game codes and role codes?

**Why it blocks:** The platform needs to parse role from the code to determine per diem rates and, potentially, protocol applicability (Coach vs. Player may have different credential requirements).

**Where the answer lives:** The roster management system or HR records — wherever personnel codes are assigned.

**Answer:** ⬜

---

### 2.2 Is there a master roster that maps participant codes to real-world identities?

**Question:** `RL/PL/026` = Christian Mortensen. Where does this mapping live? Is there a canonical table that links participant codes to names, and eventually to C3 PersonIDs?

**Why it blocks:** The platform cannot link a Mission participant to their Credential obligations without knowing which C3 Person they are. The budget sheet uses names directly — names are not reliable keys (spelling variants, name changes).

**Where the answer lives:** HR or Operations — wherever player contracts and personnel records are maintained.

**Answer:** ⬜

---

### 2.3 What does the sequence number in a participant code represent?

**Question:** Is `RL/PL/026` the 26th Rocket League player ever registered, or is it reset per year? Does the sequence persist across employment status changes (e.g. a player who leaves and returns)?

**Why it blocks:** If the sequence is a permanent unique identifier, it is safe to use as an external reference key alongside PersonID. If it is reset or reused, it is not reliable as a foreign key.

**Where the answer lives:** Whoever assigns participant codes — HR or the Competitive team.

**Answer:** ⬜

---

### 2.4 Do all Mission participants have C3 PersonIDs today, or only players?

**Question:** The RLCS WC budget includes a Coach (Victor Locquet). Will coaches, managers, analysts, and support staff also be persons in C3 with credentials evaluated? Or is the Person entity currently player-only?

**Why it blocks:** The credential obligation model was designed for players — "right to work, travel authorization, competition eligibility." A Coach has different obligations (work authorization, travel) and potentially no competition eligibility requirement. If coaches enter the platform, protocols need role-aware evaluation.

**Where the answer lives:** This is a product decision — confirm with Operations management.

**Answer:** ⬜

---

## Section 3 — Mission Status and Lifecycle

### 3.1 Is "Finance Confirmation Pending → Confirmed" the only activation gate?

**Question:** The spreadsheet has three statuses: Finance Confirmation Pending, Confirmed, CANCELED. Is there always exactly one gate (Finance approval)? Or do some Missions require additional approvals (Management sign-off, legal clearance, IT access confirmation)?

**Why it blocks:** The platform models the Confirmed transition as the single activation gate. If multiple approvals are required before obligations should activate, the model needs an approval chain rather than a single status transition.

**Where the answer lives:** The Finance and Operations sign-off process — who is in the loop before a Mission is confirmed?

**Answer:** ⬜

---

### 3.2 Who has authority to move a Mission from Finance Pending to Confirmed?

**Question:** In the spreadsheet, status is changed manually. Who currently makes this decision, and what information do they need to make it? Is it a single person (Finance Director), a role, or a committee?

**Why it blocks:** The platform needs to enforce this transition correctly. If a non-Finance user could accidentally confirm a Mission, obligations would activate prematurely. The transition must be gated by the right authority.

**Where the answer lives:** Finance team — who currently owns the status field in the Tournament Code sheet?

**Answer:** ⬜

---

### 3.3 Are there statuses between Confirmed and Canceled that need modelling?

**Question:** Between Confirmed and completion, can a Mission be suspended (event postponed), partially completed (some participants withdrew), or split (team goes but with a reduced roster)?

**Why it blocks:** If Missions can be partially active, the obligation model needs to handle participant-level status within a Mission, not just Mission-level status. A player withdrawn from a Mission should have their Mission-scoped obligations deactivated without affecting the Mission itself.

**Where the answer lives:** Competitive operations — has this happened before? How was it handled?

**Answer:** ⬜

---

### 3.4 What triggers the transition from Active to Post-Mission?

**Question:** Is it automatic (EndDate passes) or manual (someone marks the Mission complete)? What if the event runs over?

**Why it blocks:** If the transition is automatic, the platform can compute it from EndDate. If it requires manual action, we need a UI affordance. If events can run over, the EndDate must be editable by someone with appropriate authority.

**Where the answer lives:** Operations — how is the end of an event currently recorded?

**Answer:** ⬜

---

### 3.5 When a Mission is canceled, what happens to in-flight obligations?

**Question:** If a Mission in Confirmed status is canceled, credentials obtained specifically for it (e.g. a France visa for RLCS WC) remain valid but the Mission obligation disappears. General employment obligations (RightToWork, Identity) should remain. How do we distinguish Mission-specific obligations from standing obligations?

**Why it blocks:** Without this distinction, canceling a Mission could incorrectly mark standing obligations as resolved — or leave Mission-specific obligations open after cancellation.

**Where the answer lives:** This is a product/architecture decision. Confirm the intended behaviour with Operations management.

**Answer:** ⬜

---

## Section 4 — Jurisdiction and Credential Requirements

### 4.1 How granular is Mission jurisdiction?

**Question:** The RLCS WC sheet records "Paris, France." Is city sufficient for credential evaluation, or does the protocol evaluator need country-level jurisdiction (France), region-level (Schengen), or something more specific?

**Why it blocks:** A UAE national traveling to Paris needs a Schengen visa. The protocol evaluator needs to know which credential type satisfies the Travel obligation for France. If jurisdiction is just a label ("Paris, France"), the mapping from jurisdiction to credential requirements must live somewhere else.

**Where the answer lives:** Operations and possibly Legal — what determines which visa type applies for a given destination?

**Answer:** ⬜

---

### 4.2 Is jurisdiction uniform across all participants in a Mission?

**Question:** Can a Mission have participants traveling from different origins to the same destination, where different visas apply? For example: a Jordanian player and a Danish player both going to Paris need different travel documents.

**Why it blocks:** If jurisdiction drives credential requirements uniformly (all participants need a Schengen visa for France), the protocol is simple. If requirements vary by participant nationality, the protocol must also consider the person's nationality or origin country — a field not currently in the Person entity.

**Where the answer lives:** The budget sheet already records "Origin" per participant (Copenhagen, Denmark). This is the data that drives the question. Confirm with Operations whether origin country is already tracked per person.

**Answer:** ⬜

---

### 4.3 Is there a mapping from destination → required credential types that already exists internally?

**Question:** When Operations plans a Mission to Paris, do they currently consult a standard list of visa requirements per nationality? Or does each Mission require fresh research?

**Why it blocks:** If a standard mapping exists (or can be built), the platform can suggest which credential types satisfy Travel for a given jurisdiction. If each Mission is researched from scratch, the platform may only be able to surface the obligation without recommending the specific credential type.

**Where the answer lives:** Whoever coordinates visas today — is there a standard reference or does it go to a travel agent / visa service each time?

**Answer:** ⬜

---

## Section 5 — Operational vs. Financial Closure

### 5.1 What events trigger the financial settlement date?

**Question:** The RLCS WC budget has Expected Receipt: 2026-12-30 — four and a half months after the event ends. What determines this date? Is it when prize payments are received, when organiser reimbursements clear, or when the internal accounting period closes?

**Why it blocks:** If SettlementDate is derived from a known payment schedule (organiser always pays within 90 days), it can be pre-populated. If it is ad hoc, it must be manually set per Mission and monitored. The platform needs to know whether this date is an estimate or a commitment.

**Where the answer lives:** Finance — what is the typical settlement process and timeline?

**Answer:** ⬜

---

### 5.2 Which Mission records need to remain editable after operational closure?

**Question:** After EndDate passes, can the budget figures still be updated (e.g. actual visa costs vs. estimates, final prize received)? Or does the Mission lock after the event ends?

**Why it blocks:** If Financial actuals are recorded after the event (which the "Actuals" label for Visa Fees suggests), the platform must allow selective editability post-operational closure — or Finance must input actuals before the Mission closes.

**Where the answer lives:** Finance — what is the typical timeline for recording actuals after a Mission ends?

**Answer:** ⬜

---

### 5.3 How are multi-stage events modelled — as one Mission or many?

**Question:** The RLCS WC budget covers both the World Championship and EWC. Christian Mortensen has three separate flight legs, suggesting qualifier rounds before the main event. Is this one Mission or a series of related Missions?

**Why it blocks:** If one Mission can have multiple operational phases (qualifier → main event → finals), the span model needs sub-spans or a phase structure. If each phase is its own Mission, they need a way to reference each other (e.g. a parent Mission or a series code).

**Where the answer lives:** The existing budget sheet structure suggests they're combined. Confirm whether Finance and Operations treat them as one record or multiple.

**Answer:** ⬜

---

## Section 6 — Budget Lines and Cost Connections

### 6.1 Should Visa Fees link to the credential record that resolved the obligation?

**Question:** Visa Fees appear as a budget line under Additional Costs. When a participant's Travel obligation is resolved by registering a Visa credential in C3, should the visa cost automatically populate the Mission budget? Or are they always recorded independently?

**Why it blocks:** This is the integration point between credential management (C3) and financial tracking (Mission budget). If they link, the platform can automatically capture costs when credentials are registered — one action updates both readiness and Finance. If they remain disconnected, Finance continues to record costs manually.

**Answer:** ⬜

---

### 6.2 Are there budget lines that do not map to individual participants?

**Question:** "Local Transportation (Trains)" and "SIM Cards" and "Other" appear as Mission-level costs with no per-person breakdown. Should these be Mission-level costs, or should they also eventually be assignable to participants?

**Why it blocks:** If Mission-level costs exist alongside per-participant costs, the budget model has two tiers. The current budget sheet structure suggests this already — participant rows for flights, accommodation, per diem; flat rows for visa fees, transport, SIM cards.

**Where the answer lives:** Finance — how are shared Mission costs currently allocated or split?

**Answer:** ⬜

---

### 6.3 How is expected income currently validated — placement projection?

**Question:** The budget sheet computes Expected Prize Winnings from a formula: `(66000 × 0.3) + (35000 × 0.3)` with "Projected Placement: 8th place." Who sets the placement projection, and how often is it revised?

**Why it blocks:** If the platform surfaces expected income alongside costs (as it should, to give a meaningful net P/L), the placement projection needs to be an editable field owned by someone. It is not a derived calculation — it is a judgement call.

**Where the answer lives:** Competitive team — who currently makes placement projections and when?

**Answer:** ⬜

---

## Section 7 — Simultaneous Missions

### 7.1 Can a person participate in multiple Missions with overlapping spans?

**Question:** A player competing in RLCS WC (July 8 – August 16) might simultaneously be listed in a Saudi eLeague Mission (overlapping dates). Do overlapping Missions create conflicting obligations, or does the platform evaluate each independently?

**Why it blocks:** If obligations are evaluated per Mission, a credential may satisfy Mission A but expire before Mission B ends. The platform must either evaluate the strictest requirement across all active Missions, or evaluate each Mission independently and surface gaps per Mission.

**Answer:** ⬜

---

### 7.2 When obligations from multiple Missions overlap, which deadline wins?

**Question:** If a player has a Travel obligation for Mission A (ending August 16) and Mission B (ending September 10), and their visa expires August 20, the obligation is Satisfied for A but Unsatisfied for B. Does C3 show one gap (for Mission B) or two (one per Mission)?

**Why it blocks:** The current Situation Room shows gaps per person. With Mission context, the Situation Room may need to show gaps per person per Mission — or per Mission across all participants. The display model changes significantly.

**Answer:** ⬜

---

## Completion Summary

| Section | Items | Confirmed | Blocked | Remaining |
|---|---|---|---|---|
| 1. Mission Identity & Codes | 3 | 0 | 0 | 3 |
| 2. Personnel Codes & Mapping | 4 | 0 | 0 | 4 |
| 3. Status & Lifecycle | 5 | 0 | 0 | 5 |
| 4. Jurisdiction & Credentials | 3 | 0 | 0 | 3 |
| 5. Operational vs. Financial Closure | 3 | 0 | 0 | 3 |
| 6. Budget Lines & Cost Connections | 3 | 0 | 0 | 3 |
| 7. Simultaneous Missions | 2 | 0 | 0 | 2 |
| **Total** | **23** | **0** | **0** | **23** |

**Implementation is gated on this checklist. Do not begin Mission implementation until all 23 items are confirmed or explicitly deferred with a documented assumption.**

---

## Sprint 9 Decision Criteria

**Mission enters Sprint 9 if:**
- Sections 1–3 are fully confirmed (identity, codes, personnel mapping, status lifecycle)
- At least one clear jurisdiction answer (Section 4.1) is available
- The activation gate (Section 3.2) is confirmed and implementable

**Mission defers to Sprint 10+ if:**
- Personnel code → C3 Person mapping is not yet resolvable
- The Finance confirmation authority is unclear or requires a governance discussion
- Simultaneous Mission questions (Section 7) require architectural decisions not yet made

**Sprint 9 defaults to operator pressure-test findings if Mission is not ready.**

---

*C3 Platform · Mission Discovery Checklist · 2026-06-28*  
*Governs: `docs/architecture/Mission Model — Architectural Analysis.md`*
