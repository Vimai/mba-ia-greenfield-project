---
kind: phase
name: phase-03-upload-processing
status: dirty
issue_count: 11
sources_mtime:
  docs/phases/phase-03-upload-processing/context.md: "2026-07-07 06:35:53.332791000 -0300"
  docs/decisions/technical-decisions-upload-processing.md: "2026-07-06 23:03:12.197660800 -0300"
issues:
  - id: IC-1
    status: open
    summary: "TD-09 has Scope: Frontend but phase has no active UI scope (no UI Inventory)"
  - id: OQ-1
    status: open
    summary: "TD-01 pending — Object Storage Service & Client SDK"
  - id: OQ-2
    status: open
    summary: "TD-02 pending — Upload Protocol & Transport Path (10GB, resumable)"
  - id: OQ-3
    status: open
    summary: "TD-03 pending — Background Job Queue"
  - id: OQ-4
    status: open
    summary: "TD-04 pending — Video Worker Topology"
  - id: OQ-5
    status: open
    summary: "TD-05 pending — FFmpeg Integration Approach"
  - id: OQ-6
    status: open
    summary: "TD-06 pending — Unique Public Video ID (URL) Generation"
  - id: OQ-7
    status: open
    summary: "TD-07 pending — Streaming & Download Delivery Path"
  - id: OQ-8
    status: open
    summary: "TD-08 pending — Storage Endpoint Topology (browser-reachable presigned URLs)"
  - id: OQ-9
    status: open
    summary: "TD-09 pending — Frontend Upload Client"
  - id: OQ-10
    status: open
    summary: "TD-10 pending — Processing Status Propagation to the Client"
---

# phase-03-upload-processing — Validation

## Findings

### Inconsistencies

- **IC-1** — TD upload-processing/TD-09 has Scope: Frontend but phase/task has no active UI scope (UI Inventory absent or deferred). The TD would be orphaned in the final artifact (filtered out of backend subsections per Decisão #17; UI Contracts subsection not emitted). Explicit choice: (a) change TD Scope to 'Cross-layer' if the decision informs backend contracts as well; (b) add active UI scope (ensure /screen-inventory runs and user doesn't pick 'defer' option); (c) remove the TD if it's out of scope for this phase/task; (d) mark TD as Renders in: frontend-runtime + flip UI Inventory to logic-only via /plan-resolve (use when the TD is FE-runtime architectural-transversal and the phase has no UI surface). Note: the decisions doc's scope_description explicitly includes "frontend upload client" and lists `next-frontend/` as a secondary subproject, so option (b) — running `/screen-inventory upload-processing` then rerunning `/plan-context 03` — is the path consistent with the declared scope.

### Ambiguities

_None._

### Missing Decisions

_None._ (All 9 capability bullets in `## Capability Coverage` map to ≥1 TD; the HTTP error response format for nestjs-project is inherited via phase-02-auth/TD-07; FE↔BE contract-sync strategy is covered by inherited next-frontend-openapi-typing TDs and the Decisão #29 check does not fire without active UI scope.)

### Dependency Gaps

_None._ (Auth and user/channel prerequisites are delivered by phases 01–02 per `## Inherited Conventions` and inherited TDs; object storage and job queue are deliverables of this phase itself, not missing prerequisites.)

### Inherited Constraint Conflicts

_None._ (No current-phase TD is decided yet, so no conflict with inherited TDs can exist. Re-check on rerun after TDs are decided.)

### Unresolved Open Questions

- **OQ-1** — upload-processing/TD-01 pending — Object Storage Service & Client SDK. Resolution: fill the **Decision:** field of TD-01 in `docs/decisions/technical-decisions-upload-processing.md` (via /plan-resolve 03 or /research upload-processing), then re-run /plan-validate 03.
- **OQ-2** — upload-processing/TD-02 pending — Upload Protocol & Transport Path (10GB, resumable). Resolution: fill the **Decision:** field of TD-02 in `docs/decisions/technical-decisions-upload-processing.md`, then re-run /plan-validate 03.
- **OQ-3** — upload-processing/TD-03 pending — Background Job Queue. Resolution: fill the **Decision:** field of TD-03 in `docs/decisions/technical-decisions-upload-processing.md`, then re-run /plan-validate 03.
- **OQ-4** — upload-processing/TD-04 pending — Video Worker Topology. Resolution: fill the **Decision:** field of TD-04 in `docs/decisions/technical-decisions-upload-processing.md`, then re-run /plan-validate 03.
- **OQ-5** — upload-processing/TD-05 pending — FFmpeg Integration Approach. Resolution: fill the **Decision:** field of TD-05 in `docs/decisions/technical-decisions-upload-processing.md`, then re-run /plan-validate 03.
- **OQ-6** — upload-processing/TD-06 pending — Unique Public Video ID (URL) Generation. Resolution: fill the **Decision:** field of TD-06 in `docs/decisions/technical-decisions-upload-processing.md`, then re-run /plan-validate 03.
- **OQ-7** — upload-processing/TD-07 pending — Streaming & Download Delivery Path. Resolution: fill the **Decision:** field of TD-07 in `docs/decisions/technical-decisions-upload-processing.md`, then re-run /plan-validate 03.
- **OQ-8** — upload-processing/TD-08 pending — Storage Endpoint Topology (browser-reachable presigned URLs). Resolution: fill the **Decision:** field of TD-08 in `docs/decisions/technical-decisions-upload-processing.md`, then re-run /plan-validate 03.
- **OQ-9** — upload-processing/TD-09 pending — Frontend Upload Client. Resolution: fill the **Decision:** field of TD-09 in `docs/decisions/technical-decisions-upload-processing.md`, then re-run /plan-validate 03. (Coupled with IC-1 — resolving IC-1 option (b) or (a) determines where this TD renders.)
- **OQ-10** — upload-processing/TD-10 pending — Processing Status Propagation to the Client. Resolution: fill the **Decision:** field of TD-10 in `docs/decisions/technical-decisions-upload-processing.md`, then re-run /plan-validate 03.

### UI Coverage Gaps

_None._ (`## UI Inventory` is absent — UIG-N does not apply. If IC-1 is resolved by adding UI scope, rerun will re-evaluate this check.)

## Resolved Issues

_No issues resolved yet._