# phase-03-upload-processing — Progress

**Status:** in_progress
**SIs:** 2/10 completed

### SI-03.1 — Infra: MinIO no Compose + variáveis de storage
- **Status:** completed
- **Tests:** no tests (infra); ACs verified manually (minio healthy, buckets created via mc ls, Joi rejects boot without STORAGE_* keys); regression suite `env.validation.integration-spec.ts` — 4 passing
- **Observations:**
  - Fixed pre-existing `.env.example` bug (MAIL_FROM only partially quoted — `"StreamTube" <noreply@streamtube.com>`), which broke Docker Compose env-file parsing entirely (`unexpected character "<"`). Requoted the whole value per the pattern already documented in nestjs-project/CLAUDE.md § Environment File Conventions. Out of this SI's technical scope (Mail, not Storage) but was blocking `docker compose up` for every service, so fixed inline.
  - Created local `.env` (gitignored, was missing) by copying `.env.example`, since no `.env` existed on this machine yet.
  - Had to stop an unrelated container `postgres_rag` (different project) that was holding host port 5432, with user's confirmation, to bring up this project's `db` service.

### SI-03.2 — StorageModule com dual S3 clients
- **Status:** completed
- **Tests:** 4 passing
- **Observations:**
  - Integration test overrides `STORAGE_ENDPOINT_PUBLIC` to the `minio` service name (instead of `.env`'s `localhost:9000`) before compiling the test module — the suite runs inside the `nestjs-api` container, where `localhost` is the container itself and cannot reach the `minio` service. Real dev/browser config in `.env`/`.env.example` is untouched; this is a test-only override to make the roundtrip network-reachable.

### SI-03.3 — VideosModule: entidade Video + public_id único
- **Status:** pending
- **Tests:** -
- **Observations:** none

### SI-03.4 — QueueModule: pg-boss sobre o PostgreSQL existente
- **Status:** pending
- **Tests:** -
- **Observations:** none

### SI-03.5 — Endpoint tus de upload resumável
- **Status:** pending
- **Tests:** -
- **Observations:** none

### SI-03.6 — Worker: entry point dedicado + serviço Compose com ffmpeg
- **Status:** pending
- **Tests:** -
- **Observations:** none

### SI-03.7 — Job de processamento: metadados + thumbnail + transições de status
- **Status:** pending
- **Tests:** -
- **Observations:** none

### SI-03.8 — Endpoints de status, streaming e download
- **Status:** pending
- **Tests:** -
- **Observations:** none

### SI-03.9 — BFF streaming proxy do tus (next-frontend)
- **Status:** pending
- **Tests:** -
- **Observations:** none

### SI-03.10 — Frontend Upload Client (Setup)
- **Status:** pending
- **Tests:** -
- **Observations:** none