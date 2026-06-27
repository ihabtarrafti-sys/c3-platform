ADR-008

Runtime Entry Point

Decision:

Every Intelligence Platform application shall expose a runtime interface rather than exposing React components directly.

Rationale:

Host independence
Deployment independence
Stable public API
Infrastructure isolation
Easier future packaging

I think that's an architectural decision worth preserving.