# ADR-011: Runtime Hosting Architecture

## Status

Accepted

## Context

The Geekay Intelligence Platform is evolving from a single application into a hostable platform architecture.

C3 has already proven the runtime model through a mount/unmount API and an SPFx host proof of concept. However, the runtime contract should not be owned by C3. It should be owned by the platform so future Intelligence Hubs can follow the same hosting model.

## Decision

The Geekay Intelligence Platform shall define a shared Runtime SDK.

All hostable applications shall expose a runtime module that implements the platform runtime contract.

Hosts shall load runtime packages through a runtime manifest and interact with them only through the runtime lifecycle API.

## Runtime SDK Responsibilities

The Runtime SDK owns:

- Runtime contracts
- Runtime manifest shape
- Host context shape
- Runtime lifecycle interface
- API version compatibility model

The Runtime SDK must not contain:

- React components
- SharePoint implementation logic
- Business logic
- Application-specific services
- Hub-specific domain models

## Runtime Manifest

Each runtime package shall ship a `runtime.json` manifest.

Required fields:

```json
{
  "id": "c3",
  "name": "C3 Contract Control Center",
  "version": "0.1.0",
  "apiVersion": 1,
  "entry": "c3-runtime.js"
}