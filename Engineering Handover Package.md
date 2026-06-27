# C3 / Geekay Intelligence Platform

## Engineering Handover Package

### Version: Platform Foundation Complete (Ready for Product Development)

---

# 1. Project Overview

This project is **not simply a contract management application**.

It has evolved into a reusable internal application platform called the **Geekay Intelligence Platform**, with **C3 (Contract Control Center)** serving as the first application built on top of it.

The long-term vision is that future applications (HR, Legal, Finance, Logistics, Operations, etc.) will reuse the exact same hosting architecture, SDK, deployment model, and development standards.

The architecture is now considered largely complete. Future work should focus on infrastructure integration and product development rather than introducing additional abstractions.

---

# 2. Overall Vision

The Geekay Intelligence Platform consists of three logical layers.

```text
Applications
────────────────────────────────────

C3
HR
Legal
Finance
Operations
...

────────────────────────────────────

Platform

Platform SDK
Hosting
Authentication
Configuration
Repositories
Shared Services

────────────────────────────────────

Infrastructure

SPFx
SharePoint Online
SharePoint Lists
Microsoft 365
```

The Platform layer exists to make every future application easier to build.

---

# 3. Current Status

## Platform Foundation

Status:

✅ Complete

Completed:

* Monorepo
* Platform SDK
* Runtime architecture
* SPFx host
* Runtime package
* Build pipeline
* ADR framework
* Documentation
* Deployment model

Platform SDK is considered **Version 1.0 Frozen**.

Future breaking changes should require an ADR.

---

# 4. Architectural Philosophy

Several principles emerged during implementation and should remain guiding rules.

## Platform Before Application

Platform capabilities are built once.

Applications consume them.

Applications should not own shared contracts.

---

## Host Agnostic

Applications should never know they are running inside SharePoint.

SharePoint is merely one host.

Future hosts could include:

* Teams
* Electron
* Desktop
* Standalone Web
* Mobile

---

## Replace, Don't Rewrite

Every production implementation should replace a mock without affecting the application.

Example:

```text
MockAuthService

↓

SPFxAuthService
```

The application should not change.

Only the implementation changes.

---

## Every Architecture Change Must Unlock Product Value

No architecture exists for its own sake.

Every architectural improvement should unlock visible product functionality within one or two sprints.

---

## SDK Freeze

Platform SDK is now considered stable.

Future changes require strong justification.

---

# 5. Repository Structure

Current structure:

```text
c3-platform/

packages/

    runtime-sdk/
        (planned to become platform-sdk)

    c3/
        Main application

    c3-runtime/
        Platform application implementation

    c3-spfx-host/
        SharePoint host

docs/
```

During implementation we renamed the package identity to:

```
@geekay/platform-sdk
```

The folder may still be called:

```
runtime-sdk
```

This is acceptable for now.

Folder rename can happen later.

---

# 6. Platform SDK

The Platform SDK owns contracts only.

It contains:

* PlatformApplication
* PlatformHost
* PlatformContext
* PlatformServices
* PlatformManifest

It must NEVER contain:

* React
* SharePoint
* Business logic
* C3 logic
* Hub logic

It is intentionally host-agnostic.

---

Current SDK contracts look approximately like:

```ts
export interface PlatformServices {
    auth?: unknown;
    storage?: unknown;
    navigation?: unknown;
    telemetry?: unknown;
    configuration?: unknown;
}
```

```ts
export interface PlatformContext {

    environment:
        'dev'
      | 'staging'
      | 'production';

    dataSourceMode:
        'mock'
      | 'sharepoint';

    services?: PlatformServices;

}
```

```ts
export interface PlatformHost {

    container: HTMLElement;

    context: PlatformContext;

}
```

```ts
export interface PlatformManifest {

    id: string;

    name: string;

    version: string;

    apiVersion: number;

    entry: string;

}
```

```ts
export interface PlatformApplication {

    start(
        host: PlatformHost
    ): Promise<void>;

    stop(): Promise<void>;

}
```

This contract is considered stable.

---

# 7. C3 Runtime

C3 Runtime now implements PlatformApplication.

It no longer exposes runtime directly.

Conceptually:

```text
Platform Host

↓

Platform Application

↓

C3 Runtime

↓

React Application
```

Current implementation:

```ts
application.start(host)

↓

runtime.mount(...)
```

```ts
application.stop()

↓

runtime.unmount(...)
```

The runtime remains an internal implementation detail.

Hosts should never call runtime directly again.

---

# 8. SPFx Host

The SPFx Host is no longer aware of React.

It only knows about PlatformApplication.

Lifecycle:

```text
Load runtime

↓

Create PlatformHost

↓

application.start()

↓

application.stop()
```

It should never import React components from C3.

Only the runtime bundle.

---

# 9. Runtime Package

A dedicated runtime package exists.

```
packages/c3-runtime
```

It produces:

```
dist/

c3-runtime.js
```

Originally runtime was copied into SPFx.

This architecture was intentionally improved.

Eventually runtime should be referenced directly.

---

# 10. Runtime Manifest

An ADR established runtime manifests.

Expected future format:

```json
{
  "id": "c3",
  "name": "C3 Contract Control Center",
  "version": "0.1.0",
  "apiVersion": 1,
  "entry": "c3-runtime.js"
}
```

Host responsibility:

Load manifest.

Validate apiVersion.

Load runtime.

Never hardcode filenames.

---

# 11. Platform Documentation

Current documentation includes:

Vision

Architecture

Standards

Shared Services

Roadmap

ADR Register

Data Dictionary

Reporting

Security

Platform Integration Roadmap

---

# 12. ADRs

Existing important ADRs include:

SharePoint Lists

Configuration Service

Counter Service

Shared Services

Platform First

Runtime Hosting Architecture (ADR-011)

Recommended next ADR:

Platform SDK v1 Freeze (ADR-012)

---

# 13. Build Pipeline

Root repository now controls builds.

Commands include approximately:

```text
npm run build:c3
```

```text
npm run build:spfx
```

```text
npm run build:c3-runtime-pkg
```

Builds are currently green.

---

# 14. Current Architecture

Current runtime flow:

```text
SharePoint

↓

SPFx Host

↓

Platform SDK

↓

Platform Application

↓

C3 Runtime

↓

React

↓

C3
```

---

# 15. Phase Status

## Phase 1

Platform Architecture

Status:

DONE

---

## Phase 2

Platform Integration

Status:

Started

---

## Phase 3

Application Development

Status:

Ready

---

# 16. Product Roadmap

The architecture work intentionally stopped here.

Future effort should focus on replacing mocks.

Priority order:

Authentication

↓

Configuration

↓

Repositories

↓

Command Center

---

# 17. Immediate Sprint Plan

Sprint 4

Live Infrastructure

---

### Sprint 4.1

Authentication

Replace:

```
MockAuthService
```

with

```
SPFxAuthService
```

No UI changes.

---

### Sprint 4.2

Configuration

Replace:

```
devConfig
```

with

Configuration Repository.

---

### Sprint 4.3

Users

Replace mock users with SharePoint.

---

### Sprint 4.4

Lookup Lists

Statuses

Contract Types

Departments

Roles

Etc.

---

# 18. Product Development

Once infrastructure is live:

Begin building:

Command Center

Dashboard

Executive KPIs

Renewals

Expiring Contracts

Personnel

Navigation

Widgets

Real data only.

---

# 19. Mock Removal Strategy

Current philosophy:

Every sprint removes a mock.

Examples:

```
MockAuthService
↓

SPFxAuthService
```

```
MockUsersRepository
↓

SharePointUsersRepository
```

```
devConfig
↓

ConfigurationRepository
```

The application should remain unchanged.

---

# 20. Engineering Rules

Established during implementation.

## Rule 1

Platform before application.

---

## Rule 2

Host agnostic.

---

## Rule 3

Replace.

Don't rewrite.

---

## Rule 4

SDK changes require justification.

---

## Rule 5

Every sprint should produce something visible.

Not another abstraction.

Not another SDK.

A user-facing improvement.

---

## Rule 6

Protect architecture.

Don't continuously redesign it.

The architecture exists to enable product delivery.

---

# 21. IT Preparation

An IT deployment package has already been prepared.

Includes:

Email

Deployment Overview

Purpose:

Prepare tenant for:

SPFx

App Catalog

SharePoint permissions

C3 deployment

Authentication

---

# 22. Current Technical Debt

Minor.

Includes:

Possible rename:

```
runtime-sdk

↓

platform-sdk
```

Currently package identity is already:

```
@geekay/platform-sdk
```

Folder rename can happen later.

No urgency.

---

# 23. Things We Explicitly Decided NOT To Do

We intentionally avoided:

More SDK layers

Application SDK

Host SDK

Adapter SDK

Etc.

Reason:

Architecture should stop once it enables product work.

---

# 24. Where Development Must Resume

The very next implementation task should be:

## Live Authentication

Locate current authentication implementation.

Expected files include something similar to:

```
packages/c3/src/services/auth.ts
```

and/or

```
SPFxAuthService.ts
```

Objective:

Replace the development user with the authenticated SharePoint user.

Expected mapping:

```
context.pageContext.user.displayName

↓

C3CurrentUser.displayName
```

```
context.pageContext.user.email

↓

C3CurrentUser.email
```

```
context.pageContext.user.loginName

↓

C3CurrentUser.loginName
```

After this sprint:

Delete the development user completely.

---

# 25. Long-Term Vision

The platform should ultimately support:

```
Geekay Intelligence Platform

↓

Platform SDK

↓

Platform Applications

    C3
    HR
    Legal
    Finance
    Logistics
    Operations
    Procurement
    Marketing

↓

Hosts

    SharePoint
    Teams
    Electron
    Standalone Web
```

Every application shares:

Platform SDK

Hosting model

Authentication

Configuration

Shared Services

Deployment model

Only business logic differs.

---

# 26. Final Guidance for the Next Implementation Chat

The platform architecture is **complete enough**.

Do **not** spend additional time inventing abstractions unless a real implementation problem demands it.

The focus from this point forward should be:

1. Live authentication.
2. SharePoint adapters.
3. Configuration repository.
4. Users repository.
5. Lookup repositories.
6. Command Center.
7. Executive dashboard.
8. Live production data.

Every sprint should move the product measurably closer to production.

The next implementation chat should assume the role of a lead platform engineer guiding development against this architecture, preserving the frozen Platform SDK contract while prioritizing product delivery over further architectural expansion.
