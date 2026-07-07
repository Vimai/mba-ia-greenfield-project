---
kind: phase
name: phase-03-upload-processing
test_specs_aware: true
sources_mtime:
  docs/phases/phase-03-upload-processing/context.md: "2026-07-07 17:09:17.243912300 -0300"
  docs/phases/phase-03-upload-processing/library-refs.md: "2026-07-07 17:08:42.179379100 -0300"
  docs/decisions/technical-decisions-upload-processing.md: "2026-07-07 09:38:39.772214200 -0300"
  docs/decisions/technical-decisions-next-frontend-config-base.md: "2026-07-06 21:47:59.990464600 -0300"
  docs/decisions/technical-decisions-next-frontend-openapi-typing.md: "2026-07-06 21:47:59.991454800 -0300"
  docs/decisions/technical-decisions-openapi-docs-nestjs.md: "2026-07-06 21:47:59.991708800 -0300"
---

# Fase 03 — Upload e Processamento de Vídeos

## Objective

Entregar o pipeline completo de upload e processamento de vídeos: serviço de armazenamento de arquivos (MinIO via `@aws-sdk/client-s3`), upload resumável de até 10GB sem impacto na performance (tus atrás de proxy BFF), pré-cadastro automático do vídeo como rascunho ao iniciar o upload, processamento automático em segundo plano (fila pg-boss + worker FFmpeg extraindo duração/metadados e gerando thumbnail), URL única por vídeo sem conflito, e entrega por streaming e download via presigned URLs — com a fundação FE-runtime (`tus-js-client`) preparada para a UI de upload de fases futuras.

---

## Step Implementations

### SI-03.1 — Infra: MinIO no Compose + variáveis de storage

**Description:** Sobe o object storage (MinIO) na stack Docker de `nestjs-project` com buckets e chaves de ambiente da topologia dual-endpoint, fundação de todos os SIs de storage.

**Technical actions:**

1. Adicionar serviço `minio` ao `docker-compose.yaml` de `nestjs-project` — imagem oficial, portas `9000` (API) e `9001` (console), volume nomeado, healthcheck (per `upload-processing/TD-01`; host via service name `minio`, nunca `localhost`)
2. Adicionar serviço one-shot `createbuckets` (imagem `minio/mc`) criando os buckets `videos` e `thumbnails` de forma idempotente após o healthcheck do `minio`
3. Adicionar chaves ao `.env`/`.env.example`: `STORAGE_ENDPOINT_INTERNAL=http://minio:9000`, `STORAGE_ENDPOINT_PUBLIC=http://localhost:9000`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`, `STORAGE_VIDEOS_BUCKET`, `STORAGE_THUMBNAILS_BUCKET`, `STORAGE_PRESIGN_EXPIRES_SECONDS` (per `upload-processing/TD-08` — dois endpoints, migração prod é troca de config)
4. Estender o schema Joi em `src/config/env.validation.ts` com as novas chaves (convenção herdada da Fase 01)

**Tests:** _(empty — Infra)_

**Dependencies:** none

**Acceptance criteria:**

- `docker compose ps` mostra `minio` com status `running` (healthy)
- Buckets `videos` e `thumbnails` existem após `docker compose up` (verificável via `mc ls` no container)
- Boot da aplicação falha rápido com mensagem de validação quando qualquer chave `STORAGE_*` obrigatória está ausente

---

### SI-03.2 — StorageModule com dual S3 clients

**Description:** Módulo de storage em `nestjs-project` com os dois `S3Client` da topologia dual-endpoint (ops interno + assinatura pública) e a emissão de presigned GET URLs.

**Technical actions:**

1. Criar `src/config/storage.config.ts` — `registerAs('storage', ...)` com endpoints internal/public, credenciais, buckets e expiração de presign (per `upload-processing/TD-08`; convenção `registerAs` + `ConfigType` da Fase 01)
2. Criar `src/storage/storage.module.ts` + `src/storage/storage.service.ts` — dois `S3Client` (`@aws-sdk/client-s3`) com `forcePathStyle: true`: interno (`STORAGE_ENDPOINT_INTERNAL`) para operações de objeto, público (`STORAGE_ENDPOINT_PUBLIC`) exclusivo para assinar URLs (per `upload-processing/TD-01`, `upload-processing/TD-08`; APIs em `library-refs.md`)
3. Implementar operações internas — `putObject`, `getObjectStream`, `headObject`, `deleteObject` (command pattern `client.send(...)`)
4. Implementar `getPresignedGetUrl(bucket, key, { expiresInSeconds, responseContentDisposition?, responseContentType? })` via `@aws-sdk/s3-request-presigner` `getSignedUrl` assinado com o client público (per `upload-processing/TD-07`, `upload-processing/TD-08`)
5. Registrar `StorageModule` no `AppModule`

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `StorageService` | Integration: roundtrip real contra MinIO — put → presign → GET pela URL pública retorna os bytes; disposition attachment presente quando pedida | `storage.service.integration-spec.ts` |
| `StorageModule` | Unit: compilation test (módulo com imports configurados) | `storage.module.spec.ts` |

**Dependencies:** SI-03.1 — MinIO e chaves de ambiente precisam existir

**Acceptance criteria:**

- Objeto gravado via `putObject` é recuperável por presigned GET URL emitida com o endpoint público, com status `200`
- Presigned URL emitida com `expiresInSeconds` curto retorna erro de assinatura expirada após o prazo
- URL de download emitida com disposition carrega `response-content-disposition=attachment...` na query string assinada

---

### SI-03.3 — VideosModule: entidade Video + public_id único

**Description:** Entidade `Video` com migration e o serviço de pré-cadastro como rascunho, incluindo a geração do `public_id` via nanoid com insert-retry.

**Technical actions:**

1. Criar `src/videos/entities/video.entity.ts` com os campos do `### Data Model → Video` (nomes de coluna verbatim: `public_id`, `channel_id`, `status`, `processing_status`, `storage_key`, `thumbnail_key`, `size_bytes`, `duration_seconds`, `width`, `height`, `processing_error`)
2. Criar migration TypeORM da tabela `videos` — unique em `public_id` e `storage_key`, index em `channel_id`, FK para `channels`
3. Criar `src/videos/videos.module.ts` + `src/videos/videos.service.ts` — `createDraft({ channelId, title, storageKey })` persiste `status: draft` + `processing_status: uploading` gerando `public_id` com `nanoid` ~11 chars e insert-retry na violação de unique (per `upload-processing/TD-06`; caveat ESM do nanoid ≥4 em `library-refs.md` — usar `nanoid@3` ou dynamic import)
4. Registrar `VideosModule` no `AppModule`

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `Video` | Integration: constraints (unique `public_id`/`storage_key`), defaults (`status`, `processing_status`) | `video.entity.integration-spec.ts` |
| `VideosService` | Unit: branch do insert-retry (mock repo simulando unique violation → novo id → sucesso; esgotamento → erro) | `videos.service.spec.ts` |
| `VideosService` | Integration: `createDraft` persiste rascunho com `public_id` de ~11 chars URL-safe | `videos.service.integration-spec.ts` |

**Dependencies:** none

**Acceptance criteria:**

- Inserir dois vídeos com o mesmo `public_id` viola a constraint — o serviço gera novo id e persiste com sucesso em até N tentativas
- `createDraft` retorna vídeo com `status: draft`, `processing_status: uploading` e `public_id` com ~11 caracteres URL-safe
- Migration aplica limpa em banco vazio e é revertível (`migration:revert`)

---

### SI-03.4 — QueueModule: pg-boss sobre o PostgreSQL existente

**Description:** Fila de jobs pg-boss no Postgres já presente na stack, com producer que suporta enqueue transacional — fecha estruturalmente a corrida de perda de job.

**Technical actions:**

1. Criar `src/queue/queue.module.ts` com provider `PgBoss` — connection a partir do `databaseConfig` da Fase 01, lifecycle `onModuleInit` (`boss.start()`) / `onModuleDestroy` (`boss.stop()`), subscribe obrigatório em `boss.on('error')` (per `upload-processing/TD-03`; APIs em `library-refs.md`)
2. Garantir `createQueue('video-processing')` idempotente no bootstrap do módulo
3. Criar `src/queue/queue.service.ts` — `enqueueVideoProcessing(videoId, { db? })` com `retryLimit` configurado; a opção `db` recebe o adapter `executeSql` sobre o `EntityManager` da transação TypeORM ativa (wrapper ~4 linhas per `library-refs.md` § pg-boss)
4. Registrar `QueueModule` no `AppModule`

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `QueueService` | Integration: enqueue commitado produz job consumível; enqueue dentro de transação revertida NÃO deixa job (garantia transacional do `upload-processing/TD-03`) | `queue.service.integration-spec.ts` |
| `QueueModule` | Unit: compilation test | `queue.module.spec.ts` |

**Dependencies:** none

**Acceptance criteria:**

- Job enfileirado dentro de transação que sofre rollback não existe na fila após o rollback
- Job enfileirado em transação commitada é entregue a um worker `boss.work('video-processing', ...)`
- Aplicação inicia criando o schema do pg-boss no mesmo PostgreSQL, sem broker novo na stack

---

### SI-03.5 — Endpoint tus de upload resumável

**Route:** POST|HEAD|PATCH|DELETE|OPTIONS /uploads/tus[/:uploadId]
**Test Specs:** _pending /plan-test-specs_

**Description:** Endpoint tus 1.0 dentro do Nest (`@tus/server` + `@tus/s3-store`) com pré-cadastro do rascunho no handshake e enqueue transacional do processamento ao fim do upload.

**Technical actions:**

1. Criar `src/uploads/uploads.module.ts` instanciando `Server` do `@tus/server` com datastore `S3Store` (`s3ClientConfig` reutilizando as credenciais/endpoint interno do `storage.config`; `partSize` 8 MiB; `expirationPeriodInMilliseconds` para uploads incompletos) (per `upload-processing/TD-02`, `upload-processing/TD-08`; opções em `library-refs.md`)
2. Montar o handler no path `/uploads/tus` com body parsing desabilitado no prefixo (o tus consome o stream bruto — caminho de bytes memory-flat do `upload-processing/TD-02`), `maxSize` 10 GiB e `respectForwardedHeaders: true` (Location correto atrás do proxy BFF)
3. `onIncomingRequest`: validar o access token JWT (custom guards da Fase 02) — rejeitar com `{ status_code: 401 }` sem sessão válida
4. `onUploadCreate`: exigir metadata `filename`; `namingFunction` gera a storage key `videos/{public_id}`; criar o rascunho via `videosService.createDraft` (SI-03.3) conforme side-effect do `### API Contracts`
5. `onUploadFinish`: em transação — `processing_status: processing` + `size_bytes` + `queueService.enqueueVideoProcessing(videoId, { db: tx })` (per `upload-processing/TD-03`)

**Tests:** _(empty — controller wiring: cenários E2E do fluxo tus vivem no spec de /plan-test-specs; a lógica dos hooks é coberta pelos testes de SI-03.3/SI-03.4)_

**Dependencies:** SI-03.2, SI-03.3, SI-03.4 — storage, entidade e fila precisam existir

**Acceptance criteria:**

- `POST /uploads/tus` autenticado com `Upload-Metadata: filename ...` retorna `201` com `Location` e cria `Video` com `status: draft`, `processing_status: uploading` e `public_id` preenchido
- `POST /uploads/tus` sem sessão válida retorna `401`
- `POST /uploads/tus` com `Upload-Length` acima de 10 GiB retorna `413`
- `PATCH` final (offset == length) deixa o vídeo em `processing_status: processing` e cria exatamente 1 job `video-processing` com `{ videoId }`
- Upload interrompido é retomável: `HEAD` retorna `Upload-Offset` corrente e um novo `PATCH` completa o arquivo

---

### SI-03.6 — Worker: entry point dedicado + serviço Compose com ffmpeg

**Description:** Topologia do Video Worker — entry point separado no mesmo codebase, container próprio com ffmpeg de sistema na imagem.

**Technical actions:**

1. Criar `src/worker.ts` — bootstrap de NestJS application context (sem servidor HTTP) importando `QueueModule`, `StorageModule` e `VideosModule` (per `upload-processing/TD-04` — isolamento de container sem duplicação de código)
2. Adicionar npm scripts `worker:dev` / `worker:prod` e garantir o entry no build (`dist/worker.js`)
3. Instalar `ffmpeg` (pacote de sistema, que inclui `ffprobe`) na imagem Docker usada pelo worker (per `upload-processing/TD-05` — provisionamento via Docker, sem wrapper de dependência)
4. Adicionar serviço `video-worker` ao `docker-compose.yaml` — mesmo codebase/imagem, comando do worker, env compartilhado, dependências `db` e `minio`

**Tests:** _(empty — Infra)_

**Dependencies:** SI-03.1 — stack Compose; SI-03.4 — módulo de fila que o worker consome

**Acceptance criteria:**

- `docker compose up -d video-worker` sobe o container e os logs registram o worker aguardando jobs, sem porta HTTP exposta
- `docker compose exec video-worker ffmpeg -version` e `ffprobe -version` retornam exit code 0
- API (`nestjs-api`) continua subindo de forma independente — os dois processos compartilham o codebase mas têm ciclos de vida separados

---

### SI-03.7 — Job de processamento: metadados + thumbnail + transições de status

**Description:** Handler do job `video-processing` no worker — extrai duração/metadados com ffprobe, gera thumbnail de um frame com ffmpeg e materializa as transições `processing → ready | failed`.

**Technical actions:**

1. Criar `src/processing/ffmpeg.service.ts` — wrapper fino sobre duas invocações CLI bem definidas (per `upload-processing/TD-05`): `probeMetadata(inputPath)` via `ffprobe` (JSON com duração, width, height) e `extractThumbnail(inputPath, outputPath, atSecond)` via spawn direto do `ffmpeg`
2. Criar `src/processing/processing.service.ts` — orquestra o job: baixa o objeto do bucket `videos` (stream interno do `StorageService`), roda probe + thumbnail, sobe a imagem no bucket `thumbnails` e atualiza o `Video` (`duration_seconds`, `width`, `height`, `thumbnail_key`, `processing_status: ready`)
3. Registrar `boss.work('video-processing', handler)` no contexto do worker — throw no handler aciona o retry do pg-boss; esgotadas as tentativas, marcar `processing_status: failed` + `processing_error` (per `upload-processing/TD-03`, `upload-processing/TD-10`)
4. Garantir idempotência: reprocessar um vídeo já `ready` sobrescreve os mesmos campos sem efeito colateral (semântica at-least-once do `### Events/Messages`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `FfmpegService` | Unit: montagem dos argumentos das duas invocações + parse do JSON do ffprobe (spawn mockado) | `ffmpeg.service.spec.ts` |
| `ProcessingService` | Integration: fixture de vídeo pequena real + MinIO + ffmpeg reais no container — campos preenchidos, thumbnail no bucket, transição para `ready` | `processing.service.integration-spec.ts` |
| `ProcessingService` | Integration: input corrompido → `processing_status: failed` + `processing_error` preenchido | (mesmo arquivo) |

**Dependencies:** SI-03.6 — worker e ffmpeg na imagem; SI-03.2 — StorageService; SI-03.3 — entidade Video

**Acceptance criteria:**

- Processado o job de uma fixture válida, o vídeo fica `ready` com `duration_seconds`, `width`, `height` preenchidos e `thumbnail_key` apontando para objeto existente no bucket `thumbnails`
- Job com objeto corrompido/ilegível termina, após os retries, com `processing_status: failed` e `processing_error` descrevendo a causa
- Reprocessar um vídeo já `ready` mantém os dados consistentes (nenhuma duplicação de thumbnail órfã no bucket)

---

### SI-03.8 — Endpoints de status, streaming e download

**Route:** GET /videos/:publicId/status · GET /videos/:publicId/stream-url · GET /videos/:publicId/download-url
**Test Specs:** _pending /plan-test-specs_

**Description:** Endpoints REST de consulta de status (polling) e de emissão de presigned URLs para reprodução via streaming e download direto do object storage.

**Technical actions:**

1. Criar `src/videos/videos.controller.ts` — `GET /videos/:publicId/status` com guard de autenticação + checagem de ownership (canal do usuário), respondendo o shape do `### API Contracts` (`processingStatus`, `durationSeconds`, `width`, `height`, `thumbnailUrl` presigned quando existir) (per `upload-processing/TD-10`)
2. `GET /videos/:publicId/stream-url` — público; exige `processing_status: ready` (senão `409 VIDEO_NOT_READY`); emite presigned GET com expiração via `StorageService` público (per `upload-processing/TD-07`, `upload-processing/TD-08`)
3. `GET /videos/:publicId/download-url` — idem com `ResponseContentDisposition: attachment; filename="{title}.{ext}"` embutido na assinatura (per `upload-processing/TD-07`)
4. Registrar as exceções de domínio `VIDEO_NOT_FOUND`, `VIDEO_NOT_OWNED`, `VIDEO_NOT_READY` no Custom Domain Exception Filter herdado (envelope `{ statusCode, error, message }` — `phase-02-auth/TD-07`)
5. Anotar os endpoints com decoradores OpenAPI explícitos (`@ApiOperation`, `@ApiResponse`, `@ApiParam` — `openapi-docs-nestjs/TD-01`, revisão 2026-05-12) e rodar o sync `openapi.json` → `types.gen.ts` (`next-frontend-openapi-typing/TD-02`/`TD-03`)

**Tests:** _(empty — controller wiring: cenários E2E vivem no spec de /plan-test-specs; regras de negócio dos serviços cobertas em SI-03.2/SI-03.3)_

**Dependencies:** SI-03.2 — presigner; SI-03.3 — entidade Video

**Acceptance criteria:**

- `GET /videos/:publicId/status` do dono retorna `200` com o shape do contrato; de outro usuário autenticado retorna `403` com `errorCode: "VIDEO_NOT_OWNED"`; sem token retorna `401`
- `GET /videos/:publicId/stream-url` anônimo de vídeo `ready` retorna `200` com `url` presigned funcional (GET na URL retorna `200`/`206`)
- `GET /videos/:publicId/stream-url` de vídeo não-`ready` retorna `409` com `errorCode: "VIDEO_NOT_READY"`
- `GET /videos/:publicId/download-url` retorna URL cuja resposta carrega `Content-Disposition: attachment`
- `publicId` inexistente retorna `404` com `errorCode: "VIDEO_NOT_FOUND"` em qualquer dos três endpoints
- `openapi.json` commitado contém os 3 paths e o CI freshness check passa

---

### SI-03.9 — BFF streaming proxy do tus (next-frontend)

**Description:** Route Handler catch-all em `next-frontend` que repassa o protocolo tus em stream para o upstream Nest, mantendo o caminho strict-BFF e injetando a autenticação da sessão.

**Technical actions:**

1. Criar `app/api/uploads/tus/[[...path]]/route.ts` exportando `POST`/`HEAD`/`PATCH`/`DELETE`/`OPTIONS` que repassam método, headers tus e body **em stream** (request duplex, sem buffering — caminho memory-flat do `upload-processing/TD-02`) para `{env.API_URL}/uploads/tus[/...]` (per `next-frontend-config-base/TD-03` — o browser nunca fala com o Nest)
2. Injetar `Authorization: Bearer {access token}` lido da sessão iron-session, com refresh single-flight quando expirado (per `phase-02-auth-frontend/TD-02`, `phase-02-auth-frontend/TD-03`); sem sessão → `401` sem tocar o upstream
3. Reescrever o header `Location` da resposta de criação para o host do proxy (o client tus continua same-origin)
4. Garantir runtime Node.js na rota (streaming de request body) e nenhum parsing implícito de body

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `app/api/uploads/tus/[[...path]]/route.ts` | Integration (MSW): repassa método/headers tus e body ao upstream, injeta o bearer da sessão, reescreve `Location`; sem sessão → `401` sem request upstream | `app/api/uploads/tus/__tests__/route.integration.test.ts` |

**Dependencies:** SI-03.5 — endpoint tus upstream

**Acceptance criteria:**

- Requisição tus a `/api/uploads/tus` com sessão válida chega ao upstream com `Authorization: Bearer ...` e os headers tus intactos
- `Location` retornado ao browser aponta para `/api/uploads/tus/...` (host do app), nunca para o host do Nest
- Sem cookie de sessão, a rota responde `401` e nenhuma chamada upstream é feita

---

### SI-03.10 — Frontend Upload Client (Setup)

**Frontend Runtime spec:** see `## Technical Specifications` → `### Frontend Runtime` → `#### upload-processing/TD-09 — Frontend Upload Client`

**Technical actions:**

1. Instalar `tus-js-client` (per `**Libraries:**` de `upload-processing/TD-09`) — registrar o version pin no `package.json` de `next-frontend`
2. Implementar o snippet **Setup** byte-verbatim do `### Frontend Runtime → #### upload-processing/TD-09` em `next-frontend/lib/upload/tus-upload.ts`, estendendo com o boilerplate derivável (imports, tipagem do wrapper, exposição de callbacks `onProgress`/`onSuccess`/`onError`) sem violar F2

**Dependencies:** —

**Tests:** _(empty — Setup SI greenfield; smoke-gated pelos ACs; o consumo é testado pela fase que entregar a UI de upload)_

**Acceptance criteria:**

- `tus-js-client` instalado com version pin registrado no `package.json` de `next-frontend`
- Conteúdo F2-load-bearing do snippet Setup (endpoint `/api/uploads/tus`, `retryDelays`, `metadata`, fluxo `findPreviousUploads`/`resumeFromPreviousUpload`) presente byte-verbatim em `lib/upload/tus-upload.ts`
- `npx tsc --noEmit` e o build de `next-frontend` passam sem erro relacionado ao novo módulo

---

## Technical Specifications

### Data Model

#### Video

Entidade nova no módulo `videos` de `nestjs-project`. Criada como rascunho no handshake de criação do upload tus (`upload-processing/TD-02`); o `public_id` nasce nesse momento (`upload-processing/TD-06`).

| Field | Type | Constraints |
|-------|------|-------------|
| id | uuid | PK, generated |
| public_id | varchar(21) | unique, not null — nanoid ~11 chars, URL-safe (`upload-processing/TD-06`) |
| channel_id | uuid | FK → channels.id, not null — canal dono do vídeo |
| title | varchar(255) | not null — default derivado do `filename` do metadata tus no pré-cadastro |
| status | enum('draft') | not null, default 'draft' — estado de publicação; transições (publish etc.) pertencem à Fase 04 |
| processing_status | enum('uploading','processing','ready','failed') | not null, default 'uploading' — ciclo do pipeline (`upload-processing/TD-10`) |
| storage_key | varchar(512) | unique, not null — object key do vídeo no bucket de vídeos (`upload-processing/TD-01`) |
| thumbnail_key | varchar(512) | nullable — object key da thumbnail gerada pelo worker (`upload-processing/TD-05`) |
| size_bytes | bigint | nullable — preenchido ao fim do upload tus |
| duration_seconds | numeric(10,3) | nullable — extraída pelo worker (`upload-processing/TD-05`) |
| width | int | nullable — metadado extraído pelo worker |
| height | int | nullable — metadado extraído pelo worker |
| processing_error | text | nullable — última causa de falha quando `processing_status = 'failed'` |
| created_at | timestamptz | not null, default now() |
| updated_at | timestamptz | not null, default now() |

**Relations:** `Channel` has many `Video` (one-to-many; `channel_id`).
**Indexes:** unique on `public_id` (constraint que converte a unicidade probabilística do nanoid na garantia "nunca conflite" via insert-retry — `upload-processing/TD-06`); unique on `storage_key`; index on `channel_id`.

_Observação:_ a fila pg-boss cria suas próprias tabelas em schema próprio (`pgboss`) na mesma instância PostgreSQL — gerenciadas pela lib, fora do TypeORM (`upload-processing/TD-03`).

### API Contracts

Todos os endpoints de `nestjs-project` seguem o envelope de erro herdado `{ statusCode, error, message }` (`phase-02-auth/TD-07`). Contratos expostos no OpenAPI (`openapi-docs-nestjs/TD-01`/`TD-02`) e sincronizados com o frontend via `openapi.json` → `types.gen.ts` (`next-frontend-openapi-typing/TD-01`–`TD-03`).

#### POST|HEAD|PATCH|DELETE|OPTIONS /uploads/tus[/:uploadId] (SI-03.5)

Grupo de endpoints do protocolo tus 1.0 (`upload-processing/TD-02`), servido por `@tus/server` + `@tus/s3-store` montado no Nest com body parsing desabilitado no prefixo (o tus consome o stream bruto). Não são endpoints REST convencionais — o contrato é o protocolo tus (headers `Tus-Resumable`, `Upload-Offset`, `Upload-Length`, `Upload-Metadata`).

**Request headers:**
- Tus-Resumable: 1.0.0 — obrigatório em todas as chamadas exceto OPTIONS
- Upload-Length: tamanho total em bytes (POST de criação) — máximo 10 GiB (`maxSize`)
- Upload-Metadata: `filename` obrigatório (base64 por par, padrão tus) — valida no hook `onUploadCreate`

**Response 201 (POST de criação):**
- Location: URL do upload (via proxy BFF — `respectForwardedHeaders`/`generateUrl` apontam para o host do proxy)
- Side-effect: pré-cadastro do `Video` como rascunho (`status: draft`, `processing_status: uploading`) com `public_id` gerado (`upload-processing/TD-06`) no hook `onUploadCreate`

**Response 204 (PATCH final, `Upload-Offset` == `Upload-Length`):**
- Side-effect: `onUploadFinish` marca `processing_status: processing`, grava `size_bytes` e enfileira o job `video-processing` transacionalmente (`upload-processing/TD-03`)

**Error responses:**
- 401 UNAUTHORIZED: sem sessão válida (verificação em `onIncomingRequest`)
- 400 validation error: metadata `filename` ausente no POST de criação
- 413 UPLOAD_TOO_LARGE: `Upload-Length` acima de 10 GiB

---

#### ALL /api/uploads/tus[/*] — BFF streaming proxy (next-frontend) (SI-03.9)

Proxy de streaming no BFF (`upload-processing/TD-02`): repassa método, headers tus e body **em stream** (sem buffering — memory-flat) para `{env.API_URL}/uploads/tus[/*]`, injetando o access token da sessão iron-session (`phase-02-auth-frontend/TD-02`/`TD-03`). Mantém o caminho strict-BFF (`next-frontend-config-base/TD-03`): o browser nunca fala com o Nest diretamente. Contrato FE-facing = protocolo tus, byte-idêntico ao upstream (pass-through; reescreve apenas `Location` para o host do proxy).

---

#### GET /videos/:publicId/status (SI-03.8)

Endpoint REST de consulta do status de processamento (`upload-processing/TD-10` — polling proporcional, page-scoped).

**Request headers:**
- Authorization: Bearer {access token} — requerido

**Response 200:**
- publicId: string
- title: string
- processingStatus: "uploading" | "processing" | "ready" | "failed"
- durationSeconds: number | null
- width: number | null
- height: number | null
- thumbnailUrl: string | null — presigned GET da thumbnail quando disponível (`upload-processing/TD-07`)

**Error responses:**
- 401 UNAUTHORIZED: sem token válido
- 403 VIDEO_NOT_OWNED: vídeo não pertence ao canal do usuário autenticado
- 404 VIDEO_NOT_FOUND: `publicId` inexistente

---

#### GET /videos/:publicId/stream-url (SI-03.8)

Emite presigned GET direto do object storage para reprodução via streaming (`upload-processing/TD-07`), assinado com o client de endpoint público (`upload-processing/TD-08`). Presigned GET suporta HTTP Range — requisito do `<video>`.

**Response 200:**
- url: string — presigned GET com expiração
- expiresInSeconds: number

**Error responses:**
- 404 VIDEO_NOT_FOUND: `publicId` inexistente
- 409 VIDEO_NOT_READY: `processing_status` ≠ "ready"

---

#### GET /videos/:publicId/download-url (SI-03.8)

Mesmo mecanismo do stream-url com `ResponseContentDisposition: attachment; filename="{title}.{ext}"` embutido na assinatura (`upload-processing/TD-07`).

**Response 200:**
- url: string — presigned GET com expiração e disposição de download
- expiresInSeconds: number

**Error responses:**
- 404 VIDEO_NOT_FOUND: `publicId` inexistente
- 409 VIDEO_NOT_READY: `processing_status` ≠ "ready"

### Authorization Matrix

Guards herdados da Fase 02 (custom guards + `@nestjs/jwt` — `phase-02-auth/TD-02`). "Owner" = usuário autenticado cujo canal é dono do vídeo. Reprodução e download são livres para anônimos (princípio do projeto: "Anonymous users can watch freely"), condicionados apenas a `processing_status: ready`.

| Endpoint | Anonymous | Authenticated | Owner |
|----------|-----------|---------------|-------|
| POST /uploads/tus (criação) | ✗ | ✓ | ✓ |
| HEAD/PATCH/DELETE /uploads/tus/:uploadId | ✗ | ✗ | ✓ |
| ALL /api/uploads/tus[/*] (BFF proxy) | ✗ (sem sessão → 401 antes do upstream) | ✓ (repassa ao upstream, que aplica a regra da linha correspondente) | ✓ |
| GET /videos/:publicId/status | ✗ | ✗ | ✓ |
| GET /videos/:publicId/stream-url | ✓ | ✓ | ✓ |
| GET /videos/:publicId/download-url | ✓ | ✓ | ✓ |

### Error Catalog

Formato de resposta de erro herdado de `phase-02-auth/TD-07`: envelope `{ statusCode, error, message }` com códigos de domínio machine-readable via Custom Domain Exception Filter. Esta fase adiciona apenas códigos novos — o filter e o envelope não mudam.

| errorCode | HTTP | Trigger |
|-----------|------|---------|
| VIDEO_NOT_FOUND | 404 | `publicId` não corresponde a nenhum vídeo |
| VIDEO_NOT_OWNED | 403 | Consulta de status de vídeo que não pertence ao canal do usuário autenticado |
| VIDEO_NOT_READY | 409 | stream-url/download-url solicitado antes de `processing_status: ready` |
| UPLOAD_TOO_LARGE | 413 | `Upload-Length` do POST tus acima de 10 GiB (`maxSize`) |

_Notas:_ erros do protocolo tus (offset mismatch, upload inexistente, checksum) seguem o formato do próprio protocolo emitido por `@tus/server` — não passam pelo exception filter do Nest (o handler tus possui `onResponseError` próprio). Falha de processamento no worker não é um erro HTTP: materializa-se como `processing_status: failed` + `processing_error`, consultável via GET status. Esgotamento do insert-retry do `public_id` (`upload-processing/TD-06`) é falha interna → 500 genérico do envelope herdado, sem código de domínio novo.

### Events/Messages

Fila de jobs sobre o PostgreSQL existente via pg-boss (`upload-processing/TD-03`) — nenhum broker novo entra na stack. O worker é um entry point separado no mesmo codebase, com serviço Compose próprio (`upload-processing/TD-04`).

#### video-processing

**Payload:**

```json
{ "videoId": "uuid" }
```

**Producer:** hook `onUploadFinish` do tus endpoint em `nestjs-project` — enqueue **transacional** na mesma transação que atualiza o `Video` para `processing_status: processing` (opção `db` do `boss.send()`, fechando estruturalmente a corrida de perda de job) (per `upload-processing/TD-02`, `upload-processing/TD-03`)
**Consumer:** Video Worker — `boss.work('video-processing', ...)` no entry point dedicado; executa ffprobe (duração/metadados) e ffmpeg (thumbnail de um frame) via spawn direto do binário do sistema na imagem (per `upload-processing/TD-04`, `upload-processing/TD-05`)
**Trigger:** último byte do upload tus recebido (`Upload-Offset == Upload-Length`)
**Delivery semantics:** at-least-once — `retryLimit` configurado; handler idempotente (reprocessar um vídeo já processado sobrescreve os mesmos campos); esgotadas as tentativas, o job falha e o worker marca `processing_status: failed` + `processing_error` (per `upload-processing/TD-03`, `upload-processing/TD-10`)

### Frontend Runtime

#### upload-processing/TD-09 — Frontend Upload Client

**Pattern:** o projeto já possui um design system e um padrão de formulários; precisa de um motor de transferência, não de um framework de UI. `tus-js-client` é o transfer engine resumável que a futura UI de upload consumirá; o peso do Uppy compraria features (multi-file, remote sources, editors) fora do escopo da Fase 03. Depende de `upload-processing/TD-02` (variantes tus — o client aponta para o proxy BFF de streaming).

**Setup:**

```ts
// next-frontend/lib/upload/tus-upload.ts — fundação FE-runtime; consumida pela UI de upload de fase futura
const upload = new tus.Upload(file, {
  endpoint: "/api/uploads/tus",                 // rota BFF proxy (upload-processing/TD-02) — nunca o Nest direto
  retryDelays: [0, 3000, 5000, 10000, 20000],   // retry automático em erros transitórios
  metadata: { filename: file.name, filetype: file.type },
});
const previousUploads = await upload.findPreviousUploads();
if (previousUploads.length) upload.resumeFromPreviousUpload(previousUploads[0]);
upload.start();
```

Não definir `chunkSize` (default `Infinity` — a doc da lib desaconselha fixá-lo salvo limite de body no proxy; se necessário, nunca abaixo de 5 MiB, o mínimo de parte do S3). A sessão viaja no cookie same-origin — nenhum header de auth manual.

**Aplicação:** fase logic-only — nenhuma superfície de UI nesta fase. Aplica-se a toda futura UI de upload que materialize a capability "Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance" (prevista para a Fase 05), que herdará esta fundação via `## Inherited Decisions Detail`. Callbacks (`onProgress`, `onSuccess`, `onError`) são wiring derivável da tela que adotar o engine.

**Migração:**

_No existing files require refactor — Setup SI is the only application of this pattern in the current phase._

**Verificação:**

- **Unit:** o wrapper em `lib/upload/` monta `tus.Upload` com `endpoint: "/api/uploads/tus"`, `retryDelays` e `metadata` corretos (asserção sobre as opções passadas, `tus-js-client` mockado).
- **Integration:** rota BFF proxy testada como função (`*.integration.test.ts` com MSW interceptando o upstream) — repassa método/headers tus e injeta o access token da sessão.
- **E2E:** não aplicável nesta fase (sem superfície de UI); coberto pela fase que entregar a tela de upload.
- **Regression guards:** suíte Vitest existente de `next-frontend` permanece verde — a fundação não altera comportamento de nenhuma rota ou componente existente.

---

## Dependency Map

```
SI-03.1 (root — Infra MinIO + env)
├── SI-03.2 — depends on SI-03.1 (MinIO e chaves de ambiente antes do StorageModule)
│   ├── SI-03.5 — depends on SI-03.2, SI-03.3, SI-03.4 (storage, entidade e fila antes do endpoint tus)
│   │   └── SI-03.9 — depends on SI-03.5 (endpoint tus upstream antes do proxy BFF)
│   ├── SI-03.7 — depends on SI-03.6, SI-03.2, SI-03.3 (worker + storage + entidade antes do job de processamento)
│   └── SI-03.8 — depends on SI-03.2, SI-03.3 (presigner e entidade antes dos endpoints de entrega)
└── SI-03.6 — depends on SI-03.1, SI-03.4 (stack Compose e módulo de fila antes do worker)
SI-03.3 (root, independent — entidade Video + public_id)
SI-03.4 (root, independent — fila pg-boss)
SI-03.10 (root, independent — fundação FE-runtime tus-js-client)
```

---

## Deliverables

- [ ] SI-03.1 — Infra: MinIO no Compose + variáveis de storage
- [ ] SI-03.2 — StorageModule com dual S3 clients
- [ ] SI-03.3 — VideosModule: entidade Video + public_id único
- [ ] SI-03.4 — QueueModule: pg-boss sobre o PostgreSQL existente
- [ ] SI-03.5 — Endpoint tus de upload resumável
- [ ] SI-03.6 — Worker: entry point dedicado + serviço Compose com ffmpeg
- [ ] SI-03.7 — Job de processamento: metadados + thumbnail + transições de status
- [ ] SI-03.8 — Endpoints de status, streaming e download
- [ ] SI-03.9 — BFF streaming proxy do tus (next-frontend)
- [ ] SI-03.10 — Frontend Upload Client (Setup)

**Full test suites:**

- [ ] Backend tests pass (`cd nestjs-project && docker compose exec nestjs-api npm test -- --runInBand`)
- [ ] E2E tests pass (`cd nestjs-project && docker compose exec nestjs-api npm run test:e2e`)
- [ ] Type/compilation checks pass — backend (`cd nestjs-project && docker compose exec nestjs-api npx tsc --noEmit`)
- [ ] Lint passes — backend (`cd nestjs-project && docker compose exec nestjs-api npm run lint`)
- [ ] Frontend tests pass (`cd next-frontend && docker compose exec next-frontend npm test`)
- [ ] Type/compilation checks pass — frontend (`cd next-frontend && docker compose exec next-frontend npx tsc --noEmit`)
- [ ] Lint passes — frontend (`cd next-frontend && docker compose exec next-frontend npm run lint`)