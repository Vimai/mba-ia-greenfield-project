---
scope_type: phase
related_phases: [3]
status: pending
date: 2026-07-06
scope_description: "Fase 03 — Upload e Processamento de Vídeos: object storage service and SDK, 10GB resumable upload protocol and transport path, background job queue, FFmpeg worker topology and integration, unique video URL generation, streaming/download delivery path, storage endpoint topology for browser-reachable URLs, frontend upload client, and processing-status propagation."
---

# Technical Decisions — Phase 03: Upload e Processamento de Vídeos

_Subprojects in scope:_

- `nestjs-project/` — primary subproject. Receives the storage module (S3 client), the video module (draft pre-registration, unique URL, status lifecycle), the queue producer/consumer, the FFmpeg worker entry point, and the streaming/download URL issuance.
- `next-frontend/` — secondary. Receives the upload UI client (resumable upload from the browser), the BFF routes that bridge upload/status/playback to the backend, and the `<video>` playback URL consumption. Cross-layer TDs (TD-02, TD-07, TD-08, TD-10) bind both sides.

> Cross-doc anchors (already decided — do NOT reopen):
> - **Strict BFF — single server-only `API_URL`** (`next-frontend-config-base/TD-03`): the browser talks only to same-origin `/api/...`; no browser → NestJS direct pattern. That TD's own notes anticipated that Phase 03 media traffic would need "a separate mechanism (presigned URLs from object storage, NOT the backend URL)" — TD-07/TD-08 below resolve exactly that carve-out.
> - **Architecture diagram** (`docs/diagrams/software-arch.mermaid`): Frontend *streams from Object Storage* directly; API *uploads to storage* and *publishes jobs to queue*; Video Worker (FFmpeg) is a separate container. The Message Queue container is explicitly **TBD** — decided here (TD-03).
> - **Auth model** (`phase-02-auth/TD-02..TD-03`, `phase-02-auth-frontend/TD-01..TD-03`): access JWT lives in an iron-session cookie readable only by the Next BFF; the browser holds no bearer token. Any upload path that bypasses the BFF must solve authentication explicitly.
> - **Error envelope** `{ statusCode, error, message }` (`phase-02-auth/TD-07`) applies to all new endpoints.
> - **OpenAPI contract chain** (`openapi-docs-nestjs`, `next-frontend-openapi-typing`): new Nest endpoints flow through `openapi.json` → sync script → `types.gen.ts` → `lib/api/contracts.ts`. Not reopened; Phase 03 endpoints simply join the chain.
> - **Config conventions**: backend uses `@nestjs/config` + `registerAs` namespaced factories + Joi env validation (`phase-01-configuracao-base/TD-01..TD-03`) — Phase 03 adds `storage.config.ts` and `queue.config.ts` under the same pattern (implementation-level, not re-decided).

> **Documentation lookup note:** the context7 MCP tool was not available in this session. Research fell back to official primary sources (GitHub repos, npm, tus.io, MinIO docs, NestJS docs) via web search — see "Sources consulted" at the end. Versions cited were cross-checked against the installed manifests (`nestjs-project/package.json`: NestJS 11 + Express, TypeORM 0.3.28, pg 8; `next-frontend/package.json`: Next 16.2.6, React 19.2.4, Zod 4, iron-session, react-hook-form).

---

## TD-01: Object Storage Service & Client SDK

**Scope:** Backend

**Capability:** Serviço de armazenamento de arquivos (vídeos e thumbnails)

**Context:** The architecture diagram fixes the storage *category* (S3-compatible object storage — "S3/MinIO"), but not the concrete dev service nor the client SDK the backend uses to read/write objects and sign URLs. The SDK choice interacts with TD-02: `@tus/s3-store` (the tus S3 backend) depends on `@aws-sdk/client-s3` internally, so picking a different SDK would mean carrying two S3 clients.

**Options:**

### Option A: MinIO container (backend Compose stack) + `@aws-sdk/client-s3` (AWS SDK v3)
- MinIO joins `nestjs-project/compose.yaml` as a service; the backend talks to it with the official AWS SDK v3 (`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`), pointed at the MinIO endpoint with `forcePathStyle: true`.
- **Pros:** Production-portable — swapping MinIO for real S3 (or R2, etc.) is a config change, zero code change. Same SDK that `@tus/s3-store` uses (one S3 client in the tree if TD-02 picks tus). Modular v3 packages, first-class presigner. MinIO is the de facto S3-compatible dev server and is what the architecture diagram names.
- **Cons:** AWS SDK v3 is verbose (command objects per operation). MinIO needs its own healthcheck/bucket-bootstrap step in Compose (e.g., an `mc` init container or startup script).

### Option B: MinIO container + `minio` JS SDK
- Same MinIO service, but accessed via MinIO's own JavaScript SDK (`minio` npm package), which has a simpler promise-based API (`putObject`, `presignedGetObject`).
- **Pros:** Friendlier API than AWS SDK v3 for simple operations. Maintained by MinIO themselves.
- **Cons:** Locks code to MinIO's client even though the service is S3-generic — migrating to real S3 later means the SDK still works but is an odd dependency choice. If TD-02 picks tus, `@aws-sdk/client-s3` enters the tree anyway via `@tus/s3-store` — two S3 clients for one storage service.

### Option C: Local filesystem storage behind a `StorageService` abstraction
- Videos land on a Docker volume; a NestJS provider abstracts `save/read/delete/getUrl`, with S3 "later".
- **Pros:** Zero new infrastructure; trivially debuggable (files on disk).
- **Cons:** Contradicts the architecture diagram (Object Storage container is a first-class element and "Frontend streams from Object Storage"). No presigned-URL primitive — streaming and download would be forced through the API (forecloses TD-07 Option A). Range handling, garbage collection, and multi-container file sharing (API + worker need the same files) all become hand-rolled. The abstraction cost is paid now and the S3 migration cost is still paid later.

**Recommendation:** **Option A (MinIO + `@aws-sdk/client-s3`)** — matches the architecture diagram, keeps one S3 client shared with `@tus/s3-store` if TD-02 picks tus, and makes the storage service swappable by config. Option C is listed to be ruled out explicitly: it forecloses the diagram's "Frontend streams from Object Storage" edge and both TD-07 delivery options that depend on presigned URLs.

**Decision:** _[pending]_

---

## TD-02: Upload Protocol & Transport Path (10GB, resumable)

**Scope:** Cross-layer

**Capability:** Transversal — covers: "Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance", "Pré-cadastro automático do vídeo como rascunho ao iniciar o upload"

**Context:** The hardest constraint of the phase: 10GB files, no system impact, and resume-after-connection-loss (`docs/project-plan.md` § Pontos de Atenção). A plain single-shot `multipart/form-data` POST fails the resumability requirement outright and is excluded. The viable designs entangle **protocol** (tus vs S3 multipart) with **byte path** (through the BFF, direct to Nest, or direct to storage) and with **auth** (the browser holds no bearer token — only the same-origin session cookie), so the options below are coherent packages, not orthogonal picks. Whichever option wins, the **upload handshake creates the video draft** (pré-cadastro): the first request of an upload results in a `videos` row with status `draft`/`uploading` — the options differ only in *which component* triggers that creation. Both subprojects are affected: the backend owns the upload endpoint/orchestration and the frontend owns the resumable client (TD-09).

**Options:**

### Option A: tus in NestJS (`@tus/server` + `@tus/s3-store`), browser reaches it through a Next BFF streaming proxy
- `@tus/server` (v2.4.x, active, framework-agnostic) mounts on an Express path in Nest; `@tus/s3-store` streams chunks to MinIO via S3 multipart under the hood. The browser speaks tus to a same-origin BFF catch-all route (`/api/uploads/[...]`) that streams each PATCH body through to Nest (Node runtime `fetch` with `duplex: "half"`), attaching the Bearer token from the session. `onUploadCreate` hook creates the draft video.
- **Pros:** Spec-compliant resumability (offset negotiation, retries) for free; strict BFF preserved with zero new auth mechanism (session cookie → Bearer, exactly like every other route); all storage credentials and domain logic stay in the backend; tus chunking means each HTTP request is a bounded chunk (e.g., 50MB), so proxying is memory-flat streaming, not buffering.
- **Cons:** Every byte traverses two Node processes (Next + Nest) before storage — the heaviest byte path of the four (CPU copies; fine single-instance, a scaling cost later). The BFF proxy route needs care: disable body parsing, forward tus headers verbatim, configure no route timeout.

### Option B: tus in NestJS, browser uploads **direct to Nest** with a one-time upload ticket (CORS exception)
- Same tus server in Nest, but the BFF only issues a short-lived signed upload ticket; the browser then talks tus directly to the Nest host with the ticket as auth. CORS is enabled on the upload path only.
- **Pros:** Single Node hop for bytes (browser → Nest → MinIO). Resumability identical to Option A.
- **Cons:** Breaks the strict-BFF invariant (`next-frontend-config-base/TD-03` explicitly forecloses browser → NestJS patterns) — requires CORS config, a new ticket-auth mechanism alongside the JWT guards, and exposes the backend URL to the browser (the exact thing the BFF hides). Two auth systems to test and maintain for one route family.

### Option C: tus hosted in the Next BFF (`@tus/server` + `@tus/s3-store` in a Route Handler), control-plane hooks call Nest
- The tus endpoint lives in `next-frontend` (officially documented Next.js integration); bytes go browser → Next → MinIO. `onUploadCreate`/`onUploadFinish` hooks call Nest REST endpoints (create draft / mark uploaded, enqueue processing).
- **Pros:** Single Node hop; same-origin, session-cookie auth, no CORS; Nest still owns the domain via explicit API calls.
- **Cons:** Contradicts the architecture diagram ("API uploads to storage") — upload plumbing and **storage credentials move into the frontend subproject**, spreading S3 secrets across two containers and two Compose stacks (which today don't even share a network with MinIO). Splits Phase 03's core capability across subprojects; violates the project's single-responsibility working principle for module ownership.

### Option D: S3 multipart upload with presigned part URLs, browser uploads **direct to MinIO**
- Nest orchestrates: `CreateMultipartUpload`, issues presigned URLs per part via the BFF, browser PUTs parts straight to MinIO, Nest completes the upload. Resume = re-listing uploaded parts (`ListParts`) and continuing.
- **Pros:** Cleanest byte path — zero application servers touch the bytes; storage does what it's built for. No protocol dependency beyond the S3 API already in the stack (TD-01).
- **Cons:** Resumability is hand-rolled (part bookkeeping, ETag collection, ListParts recovery) — re-implementing what tus specifies. Requires MinIO to be browser-reachable with a signature-valid public hostname (hard dependency on TD-08, and the presigned-host problem applies to *writes*, not just reads). Client complexity concentrates in custom FE code (TD-09 loses the battle-tested tus client).

**Recommendation:** **Option A (tus in Nest behind a BFF streaming proxy)** — it is the only option that simultaneously honors the strict-BFF decision, the architecture diagram's "API uploads to storage" edge, and the resume-after-failure requirement with a battle-tested protocol instead of hand-rolled part bookkeeping. The double-hop byte path is the honest price; it is memory-flat (streamed, chunked) and acceptable at this project's scale — and if it ever becomes the bottleneck, the migration path is Option D for the byte plane while keeping the same draft/finalize domain endpoints. Depends on TD-01 Option A (shared `@aws-sdk/client-s3`). TD-09 (FE upload client) depends on this choice.

**Decision:** _[pending]_

---

## TD-03: Background Job Queue

**Scope:** Backend

**Capability:** Serviço de processamento em segundo plano (filas)

**Context:** The architecture diagram lists the Message Queue container as **TBD** — this TD decides it. Workload shape: one processing job per uploaded video (metadata extraction + thumbnail), minutes-long jobs, low throughput, but correctness-critical (a lost job = a video stuck in `processing` forever). Needs retry with backoff, and ideally the enqueue should be atomic with the video-status DB update. Depends on TD-04 (the consumer must be able to run in a separate worker process/container).

**Options:**

### Option A: pg-boss (PostgreSQL-based queue — no new broker)
- Job queue implemented on the existing PostgreSQL using `SKIP LOCKED`; jobs are rows. Producer and consumer are plain Node; works in any process that can reach the DB.
- **Pros:** Zero new infrastructure — PostgreSQL is already in the stack (strong precedent: `phase-02-auth/TD-03` chose Postgres over Redis for exactly this reason). **Transactional enqueue**: inserting the job in the same DB transaction that flips the video status eliminates the "status says processing but no job exists" race — an outbox pattern for free. Retry, backoff, archiving built in. Ample headroom for one-job-per-upload throughput.
- **Cons:** No official NestJS module (a thin custom provider or the community `@wavezync/nestjs-pgboss` wrapper is needed — small, but not the documented NestJS path). Queue load shares the database (irrelevant at this scale, real at high scale). No mature dashboard UI equivalent to Bull Board.

### Option B: BullMQ + Redis (`@nestjs/bullmq`)
- The NestJS-documented queue (official `@nestjs/bullmq` package, `@Processor` decorators). Requires adding a Redis service to Compose.
- **Pros:** First-class NestJS integration and documentation; the largest Node queue ecosystem (rate limiting, flows, priorities, Bull Board dashboard); worker processes are a documented pattern (sandboxed processors).
- **Cons:** Adds Redis as a new infrastructure dependency used by nothing else in the stack — against the project's repeated minimal-infra precedent. Enqueue is not transactional with the Postgres write (needs an outbox or accepts the race). Most of BullMQ's advanced features (flows, rate limiting, priorities) are unused by a one-job-per-upload pipeline.

### Option C: RabbitMQ (`amqplib` / `@nestjs/microservices` RMQ transport)
- A dedicated message broker, matching the "Message Queue" container most literally.
- **Pros:** Purpose-built broker semantics (acknowledgements, dead-letter exchanges); language-agnostic if a non-Node worker ever appears; NestJS has an RMQ microservice transport.
- **Cons:** The heaviest option: a new stateful service plus AMQP concepts (exchanges, bindings, prefetch) for a single queue with one consumer. `@nestjs/microservices` RMQ is oriented to message-pattern RPC, not job queues — retries/backoff/scheduling are DIY. Clearly oversized for this workload.

**Recommendation:** **Option A (pg-boss)** — the workload is low-throughput and correctness-critical, which is exactly pg-boss's sweet spot: transactional enqueue closes the job-loss race structurally, and no new broker enters the stack. This follows the project's established bias (Postgres over Redis in `phase-02-auth/TD-03`, custom guards over Passport). BullMQ is the right call if the team weighs official NestJS documentation and dashboard tooling above infra minimalism — flag it as the runner-up, not a wrong answer.

**Decision:** _[pending]_

---

## TD-04: Video Worker Topology

**Scope:** Backend

**Capability:** Processamento automático do vídeo após upload (extração de duração e metadados)

**Context:** FFmpeg jobs are CPU-heavy and minutes-long on 10GB files. If they run inside the `nestjs-api` container they compete with HTTP request serving — directly against the phase's "sem impacto na performance" requirement. The architecture diagram draws the Video Worker as a separate container. The question is how "separate" is realized in the codebase and Compose. Depends on TD-03 (the queue must be consumable from the chosen topology).

**Options:**

### Option A: Separate worker entry point, same codebase, own Compose service
- A second bootstrap file (e.g., `src/worker/main.ts`) using `NestFactory.createApplicationContext` (no HTTP server) that registers only the queue-consumer + processing modules. A new Compose service (`video-worker`) runs it from the same image, with FFmpeg installed in the Dockerfile.
- **Pros:** Matches the C4 diagram (separate container) with zero code duplication — entities, config factories, and the storage module are shared imports. CPU isolation from the API. Scales independently (`docker compose up --scale video-worker=2`). Standard NestJS standalone-application pattern.
- **Cons:** Two entry points in one project — module boundaries must stay clean so the worker doesn't drag in HTTP-only providers (mitigated by the existing module-per-domain structure). FFmpeg fattens the shared dev image (or requires a second Dockerfile target).

### Option B: In-process consumer inside the API container
- The queue consumer runs as a module inside the existing `nestjs-api` process.
- **Pros:** Simplest possible setup — no new service, no second entry point; one process to log and debug.
- **Cons:** FFmpeg saturates the API container's CPU during processing — a 10GB job degrades every concurrent request, violating the phase's headline requirement. Contradicts the architecture diagram. A worker crash (OOM on a huge file) takes the API down with it.

### Option C: Fully separate subproject (own package.json, own repo directory)
- A third top-level directory (`video-worker/`) with its own manifest and Docker stack.
- **Pros:** Hard isolation; independent dependency tree (API doesn't carry FFmpeg-adjacent deps).
- **Cons:** Duplicates entities, config, and DB access code across subprojects (or forces a shared-package monorepo tooling decision the repo hasn't made). Massive ceremony for a worker that shares 90% of its code with the API. Out of proportion for this project.

**Recommendation:** **Option A (separate entry point, same codebase, own Compose service)** — delivers the diagram's container isolation and the performance guarantee at the cost of one bootstrap file, without the code duplication of Option C. Option B is disqualified by the phase requirement itself.

**Decision:** _[pending]_

---

## TD-05: FFmpeg Integration Approach

**Scope:** Backend

**Capability:** Transversal — covers: "Processamento automático do vídeo após upload (extração de duração e metadados)", "Geração automática de thumbnail a partir de um frame do vídeo"

**Context:** The worker needs exactly two FFmpeg operations: probe metadata (duration, resolution, codec — `ffprobe`) and extract one frame as a thumbnail (`ffmpeg -ss ... -frames:v 1`). The long-standing wrapper `fluent-ffmpeg` was **archived on 2025-05-22 and deprecated on npm** — it can no longer be the default answer. Binary provisioning (how ffmpeg gets into the container) is part of this decision.

**Options:**

### Option A: Direct `child_process` spawn of system `ffmpeg`/`ffprobe` (installed in the Docker image)
- `apt-get install ffmpeg` in the worker's Dockerfile; a small typed `FfmpegService` wraps `execFile("ffprobe", ["-print_format", "json", ...])` and parses the JSON, plus one thumbnail command. No wrapper library.
- **Pros:** Zero deprecated/abandoned dependencies — the ffmpeg CLI is the stable interface. `ffprobe -print_format json` gives structured output natively; only two commands need wrapping (~60 LOC). Full control over flags; distro package receives security updates with image rebuilds. This is what the fluent-ffmpeg maintainers themselves recommended when phasing the wrapper out ("a fancy command-line generator" that most users bypass).
- **Cons:** Argument arrays are hand-built (typo risk mitigated by integration tests with a small fixture video). Stderr/exit-code handling written by us — bounded, since only two operations exist.

### Option B: `fluent-ffmpeg` wrapper
- The historical de facto Node wrapper (`.input().screenshots()`, `ffprobe()` helper).
- **Pros:** Familiar API; vast body of existing examples; the two operations are one-liners.
- **Cons:** **Archived (read-only) since 2025-05-22 and deprecated on npm**; documented as no longer working properly with recent ffmpeg versions. Adopting a dead dependency in a greenfield 2026 project fails the project's own maintenance bar. Listed to be ruled out explicitly, since it is still the top search result.

### Option C: `ffmpeg-static` / `@ffprobe-installer` npm binaries + direct spawn
- Same direct-spawn code as Option A, but the binaries come from npm packages that bundle platform-specific builds instead of the distro package manager.
- **Pros:** No Dockerfile change; version pinned via package.json; works on hosts without ffmpeg (irrelevant here — all commands run in-container by project rule).
- **Cons:** ~70MB+ binaries inside `node_modules`; npm-side binary provenance and slower installs; the project already controls its runtime via Docker, making distro installation the more natural provisioning channel. Solves a problem (host portability) this project explicitly does not have.

**Recommendation:** **Option A (system ffmpeg in the image + direct spawn)** — with fluent-ffmpeg dead, a thin in-house wrapper over two well-defined CLI invocations is smaller than any wrapper dependency, and Docker-based provisioning matches the project's container-only execution rule. ffmpeg.wasm was considered and excluded as an option: WASM-side processing of 10GB files is orders of magnitude slower and memory-bound.

**Decision:** _[pending]_

---

## TD-06: Unique Public Video ID (URL) Generation

**Scope:** Backend

**Capability:** URL única por vídeo, sem conflito com outros vídeos

**Context:** Every video needs a short, URL-safe, non-guessable public identifier (YouTube-style `watch?v=dQw4w9WgXcQ`), distinct from the DB primary key. Requirements from Pontos de Atenção: short, unique, never conflicts. Unlisted videos (Fase 04/05) make non-enumerability a real property, not cosmetics: the ID must not be guessable or sequential.

**Options:**

### Option A: `nanoid` with custom alphabet/length (~11 chars) + DB unique constraint with insert-retry
- `nanoid(11)` over a URL-safe alphabet at draft creation; the column is `UNIQUE`; on the (astronomically rare) collision, regenerate and retry once.
- **Pros:** YouTube-scale ID in 11 chars (~65 bits with the default 64-symbol alphabet — collision-free in practice at this project's volume, and the unique constraint makes "never conflicts" a hard DB guarantee, not a probability). Cryptographically random (non-enumerable — safe for unlisted). Tiny, zero-dependency, ubiquitous library.
- **Cons:** One small new dependency. Retry-on-conflict logic is ~5 LOC that must exist (even if it never fires).

### Option B: UUID v7 (or v4) as the public ID
- Standard UUID in the URL; v7 is DB-index-friendly if also used as the PK.
- **Pros:** No new dependency (`crypto.randomUUID()` for v4); standard, well-understood; can double as the primary key.
- **Cons:** 36 characters — hostile URLs for a consumer video platform (`/watch/018f4c9e-3b7a-...`). UUID v7 leaks creation time in its upper 48 bits — an information leak for unlisted videos. Conflates the public identifier with the persistence identifier, foreclosing independent evolution.

### Option C: Base62-encoded `crypto.randomBytes` (hand-rolled nanoid)
- ~8 random bytes, base62-encode, unique constraint + retry.
- **Pros:** Zero dependencies; full control of alphabet/length.
- **Cons:** Re-implements exactly what nanoid does (including the modulo-bias pitfall nanoid's algorithm explicitly avoids) to save a ~130-byte package. No upside over Option A beyond dependency-count vanity.

**Recommendation:** **Option A (nanoid, 11 chars, unique column + retry)** — the standard tool for exactly this job: short, URL-safe, non-enumerable, with the DB constraint converting probabilistic uniqueness into the plan's "nunca conflite" guarantee. Generated at draft creation (TD-02 handshake) so the URL exists from the first moment of the video's life.

**Decision:** _[pending]_

---

## TD-07: Streaming & Download Delivery Path

**Scope:** Cross-layer

**Capability:** Transversal — covers: "Reprodução via streaming (sem necessidade de download completo)", "Download do vídeo pelo usuário"

**Context:** The `<video>` element needs a URL that supports HTTP Range requests (seek/progressive playback); download needs the same bytes with `Content-Disposition: attachment`. The architecture diagram explicitly draws **Frontend → streams from Object Storage** — a direct edge that bypasses both API and BFF for media bytes. `next-frontend-config-base/TD-03` pre-authorized this carve-out ("presigned URLs from object storage, NOT the backend URL"). The decision is who serves video bytes to the browser. Both layers are affected: the backend issues URLs; the frontend consumes them in the player and download button. Depends on TD-01 (presigning requires the S3 SDK) and, for Option A, on TD-08 (browser-resolvable storage host).

**Options:**

### Option A: Presigned GET URLs direct from object storage
- The API (via BFF) returns a time-limited presigned URL for the video object; the browser's `<video src>` hits MinIO directly. S3 GETs support Range natively, so seeking works out of the box. Download = second presigned URL with `response-content-disposition=attachment`.
- **Pros:** Matches the architecture diagram edge exactly. Media bytes never touch Node — the API and BFF stay free for application traffic (the streaming counterpart of the phase's performance requirement). Range/seek semantics come from storage, not hand-written code. Expiring signatures give unlisted videos link-scoped access control for free.
- **Cons:** Hard dependency on TD-08 (the presigned host must be browser-resolvable AND signature-valid). URLs expire — the player/page must fetch a fresh URL when stale (a BFF endpoint + simple retry). MinIO's dev port becomes a browser-facing surface.

### Option B: Backend streaming proxy endpoint (`GET /videos/:id/stream` with Range handling in Nest)
- Nest reads Range headers, issues ranged S3 GETs, and pipes bytes to the client with `206 Partial Content`.
- **Pros:** No storage exposure — MinIO stays internal; no TD-08 needed. Fine-grained access control per request (guards run on every byte-range request). Single origin for all traffic.
- **Cons:** Every video byte flows through the API container — double bandwidth (S3→Nest→client) and event-loop/CPU load exactly where the phase forbids impact; a few concurrent viewers of 10GB files contend with API traffic. Hand-written Range parsing is a classic source of subtle bugs. Contradicts the architecture diagram's direct edge.

### Option C: Full strict-BFF proxy (browser → Next → Nest → MinIO)
- Media follows the same path as JSON: BFF route proxies the stream from Nest, which proxies from storage.
- **Pros:** No exceptions to the BFF model at all; zero new topology.
- **Cons:** Triple-hop for every video byte — all of Option B's costs, twice. Next Route Handlers add their own streaming/timeout considerations on top. For media delivery this is architecturally indefensible; included to make the BFF carve-out explicit and deliberate rather than silent.

**Recommendation:** **Option A (presigned GET direct from storage)** — it is what the architecture diagram already commits to, and it is the only option consistent with the phase's performance stance for a 10GB-file platform. The BFF exception is principled and narrow: *media bytes* go direct with expiring signed URLs; *all application data* stays behind the BFF. Requires TD-08 to be decided with it.

**Decision:** _[pending]_

---

## TD-08: Storage Endpoint Topology (browser-reachable presigned URLs)

**Scope:** Cross-layer

**Capability:** Serviço de armazenamento de arquivos (vídeos e thumbnails)

**Context:** S3v4 signatures include the host: a URL signed against `http://minio:9000` (Compose-internal DNS) is invalid if the browser fetches it via `http://localhost:9000` — the signature breaks on host rewrite. So if TD-07 (and/or TD-02 Option D) exposes storage to the browser, the backend must sign against a host the browser can resolve, while containers may reach MinIO by another name. This is a contract between Compose config, backend storage config (two logical endpoints), and every frontend surface that consumes storage URLs. Only material if TD-07 Option A is chosen (moot under B/C).

**Options:**

### Option A: Dual-endpoint S3 clients — internal for object ops, public for signing
- Backend config carries `STORAGE_ENDPOINT=http://minio:9000` (uploads, reads, worker ops) and `STORAGE_PUBLIC_ENDPOINT=http://localhost:9000` (dev value; a CDN/domain in prod). Two `S3Client` instances; presigning always uses the public one. MinIO's port 9000 is published to the host in Compose.
- **Pros:** No extra infrastructure; explicit config contract (two Joi-validated keys — the split is visible in `.env.example`). Works unchanged in prod by swapping the public value for the real storage/CDN domain. The standard answer to this problem in the MinIO ecosystem.
- **Cons:** Two client instances to keep configured consistently. Dev URLs bake in `localhost:9000` — anyone accessing the app from another device on the LAN gets broken media URLs (acceptable for this project's localhost-only dev loop).

### Option B: Single endpoint via `host.docker.internal` + published port
- One endpoint value used for everything: containers resolve `host.docker.internal:9000` out to the host and back into the published port; the browser uses the same name via an OS hosts entry (or `localhost` on platforms where it happens to resolve).
- **Pros:** One endpoint key, one client instance.
- **Cons:** `host.docker.internal` is not browser-resolvable without editing the OS hosts file — a per-developer manual setup step. Container→host→container network round-trip for every object operation, including the worker's 10GB reads. Platform-dependent behavior (Docker Desktop vs Linux). Fragile in exchange for saving one env key.

### Option C: Reverse proxy in front of MinIO on a shared hostname
- An nginx (or Traefik) service publishes one hostname (e.g., `localhost:9000` or a dev domain) and forwards to MinIO, letting a single signing host serve both browser and containers (containers point at the proxy service name with a Host-header rewrite).
- **Pros:** Production-shaped topology (in prod a CDN/proxy fronts storage anyway); one canonical public hostname.
- **Cons:** A new infrastructure service plus Host-header rewrite configuration, purely to avoid a second env key in dev. The prod-shaped benefit can be adopted later by changing Option A's public-endpoint *value* — no code change. Premature for this phase.

**Recommendation:** **Option A (dual endpoint: internal ops + public signing)** — two env keys and one extra `S3Client` solve the signature-host problem with zero new infrastructure, and the prod migration is a config value change. Follows the same config conventions already in place (`registerAs('storage', ...)` + Joi). Option C becomes attractive only when a real deployment fronts storage with a CDN — note it for Fase 07 (production environment).

**Decision:** _[pending]_

---

## TD-09: Frontend Upload Client

**Scope:** Frontend

**Capability:** Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance

**Context:** The browser side of TD-02: file picking, chunked/resumable transmission, progress display, pause/retry after connection loss. The upload page/modal itself is composed from the existing shadcn design-system primitives (FC Tube design system) — this TD decides only the *upload engine*. Written assuming TD-02 lands on a tus option (A/B/C); if TD-02 picks Option D, this TD must be revisited (the tus clients below don't speak S3 multipart).

**Options:**

### Option A: `tus-js-client` (bare protocol client) + custom UI from existing design-system components
- The official low-level tus client (`new tus.Upload(file, { endpoint, onProgress, ... })`) drives the transfer; progress bar, drop zone, and status chrome are built with the project's shadcn components.
- **Pros:** Smallest dependency for exactly the needed capability — resumability, chunking, retry backoff, `localStorage` fingerprinting for resume-after-reload all come from the reference client. Full visual control: the upload UI is FC Tube-styled like every other screen, not a themed third-party widget. Integrates naturally with the established form pattern (react-hook-form handles the metadata fields; tus handles the file).
- **Cons:** Progress/pause/resume UI state wiring is written by us (~1 hook + a component; bounded). No built-in multi-file dashboard (not a Phase 03 requirement — one video per upload).

### Option B: Uppy (`@uppy/core` + `@uppy/tus` + React components)
- Full-featured upload framework wrapping tus-js-client, with prebuilt Dashboard/Dropzone React UI.
- **Pros:** Most complete upload UX out of the box (previews, multi-file, pause/resume UI, ~500K weekly downloads). Official React bindings and Next.js guide.
- **Cons:** Heavy for one single-file upload flow — a plugin architecture, its own state store, and CSS that must be rethemed to match the FC Tube design system (fighting the styling instead of reusing `components/ui`). The valuable part for this project (the tus engine) is precisely the part Option A uses directly.

### Option C: Hand-rolled chunked XHR/fetch uploader
- Custom slicing of the `File` into ranges with bespoke offset tracking against a custom endpoint.
- **Pros:** Zero dependencies; total control.
- **Cons:** Re-implements the tus protocol badly — offset negotiation, retry semantics, and resume fingerprinting are exactly the edge-case minefield the protocol standardized. Incompatible with the `@tus/server` endpoint chosen in TD-02 unless it speaks tus, at which point it is a worse Option A.

**Recommendation:** **Option A (`tus-js-client` + design-system UI)** — the project already owns a design system and a form pattern; it needs a transfer engine, not a UI framework. Uppy's weight buys features (multi-file, remote sources, editors) outside Phase 03's scope. Depends on TD-02 (tus variants).

**Decision:** _[pending]_

---

## TD-10: Processing Status Propagation to the Client

**Scope:** Cross-layer

**Capability:** Processamento automático do vídeo após upload (extração de duração e metadados)

**Context:** After the upload completes, the video sits in `processing` until the worker finishes (seconds to minutes for large files). The upload screen must reflect the transition to `ready` (or `failed`) without the user refreshing. The backend exposes video status; the question is the transport by which the client learns of changes — a contract touching a Nest endpoint shape, a BFF route, and client polling/subscription code.

**Options:**

### Option A: Client polling of a status endpoint through the BFF
- The upload page polls `GET /api/videos/:id` (BFF → Nest) every few seconds while status is `processing`, stopping on `ready`/`failed`.
- **Pros:** Zero new transport machinery — one ordinary REST endpoint that Fase 04's management panel needs anyway; fits the strict-BFF model, the OpenAPI chain, and the existing MSW test pattern unchanged. Stateless; trivially testable. Minutes-scale processing latency makes a ~5s polling delay invisible.
- **Cons:** Wasted requests while processing runs (bounded: one user, one active upload page). Status is late by up to one polling interval.

### Option B: Server-Sent Events (Nest SSE endpoint, streamed through a BFF passthrough)
- Nest exposes an SSE stream of status events (`@Sse()` is first-class in NestJS); a BFF route pipes it to the browser's `EventSource`.
- **Pros:** Push semantics — instant status updates, no polling chatter. One-directional, simpler than WebSocket.
- **Cons:** Long-lived connections through two Node processes; the worker must now publish events to the API process (a pub/sub channel — e.g., Postgres LISTEN/NOTIFY — that otherwise doesn't need to exist). New testing surface (streamed responses through the BFF, untested pattern in the repo). Infrastructure for a latency win the use case doesn't feel.

### Option C: WebSocket (Socket.IO / `@nestjs/websockets`)
- Bidirectional gateway pushing status changes.
- **Pros:** Real-time and reusable if the platform later grows live features (watch parties, live chat).
- **Cons:** Heaviest option — a gateway, connection auth (the BFF cookie model doesn't extend to WS without explicit work), and the same worker→API pub/sub need as SSE, for a one-way, low-frequency signal. Nothing else in Fases 04–07 needs a socket. Clearly oversized today.

**Recommendation:** **Option A (polling through the BFF)** — the status transition is minutes-scale and page-scoped; polling one REST endpoint that must exist anyway is the proportionate answer and keeps every established pattern (BFF, OpenAPI, MSW) untouched. If a later phase adds genuinely real-time features, revisit with SSE as the natural upgrade; nothing chosen here forecloses it.

**Decision:** _[pending]_

---

## Decisions Summary

| ID | Scope | Decision | Recommendation | Choice      |
|----|-------|----------|---------------|-------------|
| TD-01 | Backend | Object storage service & client SDK | **A** (MinIO + `@aws-sdk/client-s3`) | A           |
| TD-02 | Cross-layer | Upload protocol & transport path (10GB, resumable) | **A** (tus in Nest + BFF streaming proxy) | _[pending]_ |
| TD-03 | Backend | Background job queue | **A** (pg-boss on existing PostgreSQL) | _[pending]_ |
| TD-04 | Backend | Video worker topology | **A** (separate entry point, same codebase, own Compose service) | _[pending]_ |
| TD-05 | Backend | FFmpeg integration approach | **A** (system ffmpeg in image + direct spawn) | _[pending]_ |
| TD-06 | Backend | Unique public video ID generation | **A** (nanoid ~11 chars + unique constraint) | _[pending]_ |
| TD-07 | Cross-layer | Streaming & download delivery path | **A** (presigned GET direct from storage) | _[pending]_ |
| TD-08 | Cross-layer | Storage endpoint topology for presigned URLs | **A** (dual endpoint: internal ops + public signing) | _[pending]_ |
| TD-09 | Frontend | Frontend upload client | **A** (`tus-js-client` + design-system UI) | _[pending]_ |
| TD-10 | Cross-layer | Processing status propagation | **A** (polling through the BFF) | _[pending]_ |

---

## Dependency map

- **TD-02 depends on TD-01** (shares the S3 SDK via `@tus/s3-store`).
- **TD-04 depends on TD-03** (the queue must be consumable from a standalone worker process — both pg-boss and BullMQ qualify).
- **TD-07 depends on TD-01 and TD-08** (presigning needs the SDK and a browser-valid signing host). **TD-08 is moot if TD-07 picks B/C** and TD-02 does not pick D.
- **TD-09 depends on TD-02** (written for the tus variants; revisit if TD-02 = D).
- **TD-05 executes inside the topology of TD-04** (FFmpeg is installed in whichever container runs the worker).

## Sources consulted

- [tus-node-server (`@tus/server`, `@tus/s3-store`)](https://github.com/tus/tus-node-server) — active project, v2.4.x (May 2026); framework-agnostic; S3-compatible store built on `@aws-sdk/client-s3`.
- [tus protocol](https://tus.io/) and [Uppy tus plugin](https://uppy.io/docs/tus/) — resumable upload protocol and client ecosystem.
- [Phasing out fluent-ffmpeg — fluent-ffmpeg/node-fluent-ffmpeg#1324](https://github.com/fluent-ffmpeg/node-fluent-ffmpeg/issues/1324) and [repo](https://github.com/fluent-ffmpeg/node-fluent-ffmpeg) — archived 2025-05-22, deprecated on npm; maintainers recommend direct CLI usage.
- [NestJS Queues documentation](https://docs.nestjs.com/techniques/queues) — official BullMQ integration.
- [pg-boss](https://github.com/timgit/pg-boss) — PostgreSQL job queue via SKIP LOCKED; transactional enqueue.
- [MinIO presigned URL host/signature discussions — minio/minio#10222](https://github.com/minio/minio/issues/10222) and [Dockerized-dev presigned URL patterns](https://medium.com/@codyalexanderraymond/solving-presigned-url-issues-in-dockerized-development-with-minio-internal-dns-61a8b7c7c0ce) — S3v4 signatures bind the host; dual-endpoint or proxy strategies.
- [nanoid](https://github.com/ai/nanoid) — URL-safe, cryptographically random short IDs; comparison with UUID v7 timestamp leakage.
- Installed manifests: `nestjs-project/package.json`, `next-frontend/package.json`; project constraints from `docs/decisions/*` and both subprojects' `CLAUDE.md`.

> context7 MCP was unavailable in this session; the above primary sources were used instead. Before implementation, `/plan-build`-stage work should confirm exact API shapes (e.g., `@tus/server` Express mounting, pg-boss v10 API) against version-matched docs.