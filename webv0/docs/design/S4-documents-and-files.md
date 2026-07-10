# S4 — Documents & files (the paper moves in)

Track A S4 per `C:\Projects\C3-CONSOLIDATED-PLAN.md`: real files on the records
they belong to — the signed contract PDF on the agreement, receipts and
organizer statements on the mission, scans on the person. C3 stops being
metadata *about* paper.

## Design

- **Metadata in Postgres, bytes in PRIVATE R2.** `document` table (DOC-XXXX,
  migration 0024, RLS ENABLE+FORCE, no DELETE) holds owner, filename, type,
  size, server-computed **SHA-256** (integrity verifiable forever), label,
  uploader — and an opaque **tenant-scoped storage key that is server-generated,
  never user input**, and never leaves the server.
- **Everything through the API — no presigned URLs, nothing public.** Upload is
  multipart (25 MB cap, content-type allowlist: pdf/images/xlsx/docx/csv/txt),
  hashed server-side, stored, then registered; a failed registration
  **compensates** by deleting the blob (asserted in tests — no orphans).
  Download streams back with the original filename and honest headers.
- **Authz is the OWNING record's**: an agreement's paper needs
  `canReadAgreements` (legal reads contracts AND their PDFs; a visitor gets
  403); mission/person paper rides the baseline read. Attach/remove are
  owner/operations, direct-audited **on the owner's trail** — an agreement's
  history shows "Document attached". Removal is a soft flip: bytes retained,
  unreachable via the API.
- **Two storage drivers, one port**: `r2` (S3 API, the backup app's client
  pattern) and `fs` (dev/test). **Production fails closed without the R2
  config** (env guard, tested). Partial R2 config refuses to boot anywhere.
- **Web**: a reusable `DocumentsSection` (attach / download / remove) mounted
  on Agreement, Mission, and Person pages. Credential/Entity attachments are
  schema-legal already; their UI mounts when those grow detail pages.

## Caught during certification

1. The new **production-requires-R2 guard** correctly failed the existing
   "valid production env" test fixture — fixture updated, plus a dedicated
   fail-closed test (partial config refuses everywhere).
2. **Cross-origin download filenames**: `content-disposition` is not readable
   by browser JS unless CORS exposes it — E2E caught the fallback name; fixed
   with `exposedHeaders` on the CORS registration.

## Evidence

Typecheck 9/9. Gate PASSED — **469 tests** (the api documents suite walks
upload → SHA-256 metadata → list → byte-identical download with honest headers
→ soft remove; 415 type refusal; empty-file 400; legal-reads/visitor-403 on
agreement paper; owner/ops-only writes; missing-owner compensation leaves no
orphan blob; tenant isolation). E2E **12/12 full-suite** — agreements.spec
attaches a PDF to AGR-0001, downloads it with the original filename
byte-for-byte, and removes it.

## Deploy

Owner one-time R2 setup (bucket + token + Railway vars) → migration 0024 →
API → web (me). Pastes: `C:\Projects\C3-S4-DEPLOY-PASTES.md`.
