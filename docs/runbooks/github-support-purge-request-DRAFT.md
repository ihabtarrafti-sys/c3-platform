# DRAFT — GitHub Support request (owner submits; do NOT auto-send)

Submit at: https://support.github.com/contact → "Remove data from GitHub" /
sensitive-data removal category, authenticated as the repository owner
(`ihabtarrafti-sys`).

---

**Subject:** Purge unreachable commits and cached views after sensitive-data
force-push — private repository ihabtarrafti-sys/c3-platform

**Message:**

Hello,

I am the owner of the private repository `ihabtarrafti-sys/c3-platform`.

Two commits containing internal documents and session-export archives were
pushed by mistake and have since been removed from the branch history via an
authorized force-push of `master` (old tip replaced by a rewritten equivalent;
the current tip is `9dfc91c0784a521cb65aead38aab9a8178c8692b`).

Please run garbage collection on the repository and purge any cached views,
pull-request caches, and API-accessible unreachable objects associated with
these now-unreachable commits:

- `8555a1a571469c3c3ccc4b338e38254212c1745a`
- `a4586423c4f36581e17d3e1f30fda507a252447a`

The affected paths inside those commits were:

- `docs/Handoff v2/` (five .md files and two .zip session exports)
- `docs/fable/` (one .pdf, two .md files, one .zip session export)

No refs in the repository reference these commits any longer, and a fresh
clone verifies they are not fetchable via normal clone. I would like the
objects to also become unavailable by direct SHA access
(`/commit/<sha>`, archive links, and the Git wire protocol) and any residual
caches invalidated.

Please confirm when the purge is complete.

Thank you,
Ihab Tarrafti (repository owner)
