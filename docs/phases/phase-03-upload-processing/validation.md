---
kind: phase
name: phase-03-upload-processing
status: dirty
issue_count: 0
sources_mtime:
  docs/phases/phase-03-upload-processing/context.md: "2026-07-07 07:00:52.362380200 -0300"
  docs/decisions/technical-decisions-upload-processing.md: "2026-07-07 06:56:17.797051600 -0300"
issues:
  - id: IC-1
    status: resolved
    summary: "TD-09 has Scope: Frontend but phase has no active UI scope (no UI Inventory)"
    resolved_by: marker_frontend_runtime
  - id: OQ-1
    status: resolved
    summary: "TD-01 pending — Object Storage Service & Client SDK"
    resolved_by: upload-processing/TD-01
  - id: OQ-2
    status: resolved
    summary: "TD-02 pending — Upload Protocol & Transport Path (10GB, resumable)"
    resolved_by: upload-processing/TD-02
  - id: OQ-3
    status: resolved
    summary: "TD-03 pending — Background Job Queue"
    resolved_by: upload-processing/TD-03
  - id: OQ-4
    status: resolved
    summary: "TD-04 pending — Video Worker Topology"
    resolved_by: upload-processing/TD-04
  - id: OQ-5
    status: resolved
    summary: "TD-05 pending — FFmpeg Integration Approach"
    resolved_by: upload-processing/TD-05
  - id: OQ-6
    status: resolved
    summary: "TD-06 pending — Unique Public Video ID (URL) Generation"
    resolved_by: upload-processing/TD-06
  - id: OQ-7
    status: resolved
    summary: "TD-07 pending — Streaming & Download Delivery Path"
    resolved_by: upload-processing/TD-07
  - id: OQ-8
    status: resolved
    summary: "TD-08 pending — Storage Endpoint Topology (browser-reachable presigned URLs)"
    resolved_by: upload-processing/TD-08
  - id: OQ-9
    status: resolved
    summary: "TD-09 pending — Frontend Upload Client"
    resolved_by: upload-processing/TD-09
  - id: OQ-10
    status: resolved
    summary: "TD-10 pending — Processing Status Propagation to the Client"
    resolved_by: upload-processing/TD-10
---

# phase-03-upload-processing — Validation

## Findings

### Inconsistencies

_None._

### Ambiguities

_None._

### Missing Decisions

_None._ (All 9 capability bullets in `## Capability Coverage` map to ≥1 decided TD; the HTTP error response format for nestjs-project is inherited via phase-02-auth/TD-07; the Decisão #29 contract-sync check does not fire while `## UI Inventory` is absent — note it will also stay satisfied after the logic-only flip because inherited next-frontend-openapi-typing TDs (Scope: Cross-layer, OpenAPI codegen) cover contract sync.)

### Dependency Gaps

_None._ (Auth/session and BFF infrastructure required by TD-02's proxy route are delivered by phase 02; within-phase orderings — TD-02→TD-01, TD-04→TD-03, TD-07→TD-01+TD-08, TD-09→TD-02 — are documented in the decisions doc's dependency map.)

### Inherited Constraint Conflicts

_None._ (Checked against all decided TDs: TD-02 keeps upload bytes on the strict-BFF path per next-frontend-config-base/TD-03; TD-07's presigned-direct delivery is the carve-out that TD-03 explicitly pre-authorizes ("presigned URLs from object storage, NOT the backend URL"); TD-08 follows the inherited `registerAs` + Joi config conventions from phase 01; TD-03/pg-boss follows the Postgres-over-Redis precedent of phase-02-auth/TD-03.)

### Unresolved Open Questions

_None._ (All 10 TDs are decided; no pending TDs remain.)

### UI Coverage Gaps

_None._ (`## UI Inventory` is absent — UIG-N does not apply. After the pending (d) resolution flips it to the logic-only placeholder, UIG-N remains skipped by design.)

## Resolved Issues

- **IC-1** _(resolved_by marker_frontend_runtime)_ — TD upload-processing/TD-09 re-classified as `Renders in: frontend-runtime`; `## UI Inventory` body set to the logic-only placeholder in context.md (no screen inventory — Fase 03 is backend-only; upload/playback/download/status UI intentionally deferred to later phases, especially Fase 05). Decisions Detail + Decisions Index row patched in context.md. User confirmed option (d) on 2026-07-07: TD-09 stays as the FE-runtime foundation (tus-js-client) the future upload UI will consume; Phase 03 delivers only backend APIs, contracts, and infrastructure (plus TD-02's BFF streaming proxy in next-frontend).
- **OQ-1** _(resolved_by upload-processing/TD-01)_ — TD-01 decided: A (MinIO + `@aws-sdk/client-s3` / `@aws-sdk/s3-request-presigner`).
- **OQ-2** _(resolved_by upload-processing/TD-02)_ — TD-02 decided: A (tus in Nest — `@tus/server` + `@tus/s3-store` — behind a BFF streaming proxy).
- **OQ-3** _(resolved_by upload-processing/TD-03)_ — TD-03 decided: A (pg-boss on existing PostgreSQL).
- **OQ-4** _(resolved_by upload-processing/TD-04)_ — TD-04 decided: A (separate worker entry point, same codebase, own Compose service).
- **OQ-5** _(resolved_by upload-processing/TD-05)_ — TD-05 decided: A (system ffmpeg in the image + direct spawn).
- **OQ-6** _(resolved_by upload-processing/TD-06)_ — TD-06 decided: A (nanoid ~11 chars + unique constraint with insert-retry).
- **OQ-7** _(resolved_by upload-processing/TD-07)_ — TD-07 decided: A (presigned GET direct from object storage).
- **OQ-8** _(resolved_by upload-processing/TD-08)_ — TD-08 decided: A (dual endpoint — internal ops + public signing).
- **OQ-9** _(resolved_by upload-processing/TD-09)_ — TD-09 decided: A (`tus-js-client` + design-system UI).
- **OQ-10** _(resolved_by upload-processing/TD-10)_ — TD-10 decided: A (polling through the BFF).