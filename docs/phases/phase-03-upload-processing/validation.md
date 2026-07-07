---
kind: phase
name: phase-03-upload-processing
status: dirty
issue_count: 1
sources_mtime:
  docs/phases/phase-03-upload-processing/context.md: "2026-07-07 06:35:53.332791000 -0300"
  docs/decisions/technical-decisions-upload-processing.md: "2026-07-06 23:03:12.197660800 -0300"
issues:
  - id: IC-1
    status: open
    summary: "TD-09 has Scope: Frontend but phase has no active UI scope (no UI Inventory)"
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

- **IC-1** — TD upload-processing/TD-09 has Scope: Frontend but phase/task has no active UI scope (UI Inventory absent or deferred). The TD would be orphaned in the final artifact (filtered out of backend subsections per Decisão #17; UI Contracts subsection not emitted). Explicit choice: (a) change TD Scope to 'Cross-layer' if the decision informs backend contracts as well; (b) add active UI scope (ensure /screen-inventory runs and user doesn't pick 'defer' option); (c) remove the TD if it's out of scope for this phase/task; (d) mark TD as Renders in: frontend-runtime + flip UI Inventory to logic-only via /plan-resolve (use when the TD is FE-runtime architectural-transversal and the phase has no UI surface). Note: the decisions doc's scope_description explicitly includes "frontend upload client" and lists `next-frontend/` as a secondary subproject, so option (b) — running `/screen-inventory upload-processing` then rerunning `/plan-context 03` — is the path consistent with the declared scope. **User chose option (b) in the 2026-07-07 /plan-resolve run** — resolution requires the external `/screen-inventory upload-processing` run, then `/plan-context 03` + `/plan-validate 03`; the issue stays open until that cycle completes.

### Ambiguities

_None._

### Missing Decisions

_None._ (All 9 capability bullets in `## Capability Coverage` map to ≥1 TD; the HTTP error response format for nestjs-project is inherited via phase-02-auth/TD-07; FE↔BE contract-sync strategy is covered by inherited next-frontend-openapi-typing TDs and the Decisão #29 check does not fire without active UI scope.)

### Dependency Gaps

_None._ (Auth and user/channel prerequisites are delivered by phases 01–02 per `## Inherited Conventions` and inherited TDs; object storage and job queue are deliverables of this phase itself, not missing prerequisites.)

### Inherited Constraint Conflicts

_None._ (No conflicts detected at validation time; TDs were decided after that run — re-check on next /plan-validate rerun.)

### Unresolved Open Questions

_None._ (OQ-1 through OQ-10 resolved in the 2026-07-07 /plan-resolve run — all 10 TDs decided as Option A.)

### UI Coverage Gaps

_None._ (`## UI Inventory` is absent — UIG-N does not apply. IC-1's resolution adds UI scope; rerun will re-evaluate this check.)

## Resolved Issues

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