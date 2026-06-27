ADR-009
Monorepo Architecture

Status

Approved

Decision

The Geekay Intelligence Platform shall be developed as a workspace-based monorepo. Applications, hosts, shared libraries, and future Intelligence Hubs will reside under a common repository using a package-per-component structure.

Rationale

Shared dependency management
Clear package boundaries
Easier CI/CD
Simplified versioning
Scalable foundation for future hubs

Consequences

C3 and SPFx evolve independently.
Shared packages become first-class citizens.
Future hubs follow the same structure.