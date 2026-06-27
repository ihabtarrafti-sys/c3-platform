# ADR-007: Host Independence

## Status

Accepted

## Context

C3 is designed as a deployment-agnostic React application.

The application must be able to run in multiple hosting environments, including:

- Local Vite development
- SharePoint Framework (SPFx)
- Future standalone hosting
- Future alternative enterprise hosts

SPFx is the preferred production hosting path because it can provide authenticated SharePoint context, but the C3 application itself must not become dependent on SPFx APIs.

## Decision

C3 shall remain independent of its hosting environment.

The host may provide runtime configuration, authentication context, and adapter dependencies, but application screens, business logic, hooks, DTOs, mappers, and intelligence logic must not import or depend on SPFx directly.

## Allowed

```txt
SPFx Host
  ↓
Runtime Configuration
  ↓
Service Adapter
  ↓
C3 React Application

## Forbidden

React Component
  ↓
SPFx API
Business Logic
  ↓
SPFx Context

## Consequences

C3 can continue to run locally in Vite.
SPFx remains a thin hosting shell.
The React application remains portable.
Future hosting strategies can be introduced without rewriting business logic.
SharePoint-specific logic remains isolated inside infrastructure adapters.