---
libs:
  "@aws-sdk/client-s3":
    version: "latest (not yet installed — pin at implement time)"
    context7_id: "/aws/aws-sdk-js-v3"
    fetched_at: "2026-07-07T17:07:31-03:00"
  "@aws-sdk/s3-request-presigner":
    version: "latest (not yet installed — pin at implement time)"
    context7_id: "/aws/aws-sdk-js-v3"
    fetched_at: "2026-07-07T17:07:31-03:00"
  "@tus/server":
    version: "latest (not yet installed — pin at implement time)"
    context7_id: "/tus/tus-node-server"
    fetched_at: "2026-07-07T17:07:31-03:00"
  "@tus/s3-store":
    version: "latest (not yet installed — pin at implement time)"
    context7_id: "/tus/tus-node-server"
    fetched_at: "2026-07-07T17:07:31-03:00"
  "pg-boss":
    version: "latest (not yet installed — pin at implement time)"
    context7_id: "/timgit/pg-boss"
    fetched_at: "2026-07-07T17:07:31-03:00"
  "nanoid":
    version: "^5.x"
    context7_id: "/ai/nanoid"
    fetched_at: "2026-07-07T17:07:31-03:00"
  "tus-js-client":
    version: "latest (not yet installed — pin at implement time)"
    context7_id: "/tus/tus-js-client"
    fetched_at: "2026-07-07T17:07:31-03:00"
sources_mtime:
  docs/decisions/technical-decisions-upload-processing.md: "2026-07-07 09:38:39.772214200 -0300"
---

# phase-03-upload-processing — Library References

Distilled Context7 excerpts scoped to how each library is used by this phase's TDs. Not exhaustive docs — only the surfaces the plan touches.

### @aws-sdk/client-s3

_Used by upload-processing/TD-01 (storage service module) and TD-08 (dual-endpoint topology — internal ops client + public signing client)._

**S3Client for MinIO (custom endpoint):** pass `endpoint` in the constructor to override AWS endpoint resolution; MinIO also requires path-style addressing (`forcePathStyle: true`) and static credentials:

```typescript
import { S3Client } from "@aws-sdk/client-s3";

const client = new S3Client({
  region: "us-east-1",              // required even for MinIO (any value)
  endpoint: "http://minio:9000",    // Docker Compose service name (internal client)
  forcePathStyle: true,             // path-style: http://host/bucket/key — required by MinIO
  credentials: {
    accessKeyId: process.env.STORAGE_ACCESS_KEY!,
    secretAccessKey: process.env.STORAGE_SECRET_KEY!,
  },
});
```

TD-08's dual topology = two `S3Client` instances from the same config shape: one with the internal endpoint (`http://minio:9000`, for server-side ops and `@tus/s3-store`) and one with the browser-reachable endpoint (e.g., `http://localhost:9000` in dev), used exclusively to sign presigned URLs.

**Object operations** (command pattern — `client.send(new XCommand(input))`):

```typescript
import { PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

// Put: Body accepts string | Buffer | Readable stream (StreamingBlobPayloadInputTypes)
await client.send(new PutObjectCommand({ Bucket: "thumbnails", Key: "abc.jpg", Body: buffer }));

// Get: response.Body is a stream — consume or destroy it to free the socket
const res = await client.send(new GetObjectCommand({ Bucket: "videos", Key: "abc" }));
const bytes = await res.Body.transformToByteArray(); // or .transformToString(); or pipe the Readable
// res.Body.destroy() — Node.js Readable only, when abandoning the stream

// Head (existence/metadata) and Delete follow the same pattern.
// GetObject throws NoSuchKey when the object is absent.
```

### @aws-sdk/s3-request-presigner

_Used by upload-processing/TD-07 (streaming + download via presigned GET) and TD-08 (signing with the public-endpoint client)._

```typescript
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

const publicClient = new S3Client({ /* browser-reachable endpoint, forcePathStyle: true */ });

// Streaming URL (default expiry 900s = 15 min if expiresIn omitted)
const streamUrl = await getSignedUrl(publicClient, new GetObjectCommand({ Bucket, Key }), { expiresIn: 3600 });

// Download URL — force attachment disposition via response-* params (they become signed query params)
const downloadUrl = await getSignedUrl(
  publicClient,
  new GetObjectCommand({
    Bucket, Key,
    ResponseContentDisposition: `attachment; filename="video.mp4"`,
    ResponseContentType: "video/mp4",
  }),
  { expiresIn: 3600 },
);
```

Key facts: the URL is host-bound to the client's `endpoint` — sign with the public client (TD-08), never the internal one, or the browser gets an unreachable host. `ResponseContentDisposition` / `ResponseContentType` map to `response-content-disposition` / `response-content-type` query params embedded in the signature. Presigned GET URLs support HTTP Range requests, which is what `<video>` streaming playback uses.

### @tus/server

_Used by upload-processing/TD-02 (tus endpoint inside Nest for the 10GB resumable upload path)._

```typescript
import { Server, EVENTS } from "@tus/server";
import { S3Store } from "@tus/s3-store";

const tusServer = new Server({
  path: "/uploads/tus",                    // URL prefix the server owns
  datastore: s3Store,                      // from @tus/s3-store (see below)
  maxSize: 10 * 1024 * 1024 * 1024,        // 10 GiB cap (number or async fn)
  respectForwardedHeaders: true,           // honor X-Forwarded-* — needed behind the BFF proxy so Location points at the proxy
  // relativeLocation: true,               // alternative: return relative Location header

  // Auth / access control — runs on every request
  async onIncomingRequest(req, uploadId) {
    // verify session/JWT here; throw { status_code: 401, body: "Unauthorized" } to reject
  },

  // Validate metadata + enrich before the upload record is created (draft pre-registration hook)
  async onUploadCreate(req, upload) {
    if (!upload.metadata?.filename) throw { status_code: 400, body: "filename metadata is required" };
    return { metadata: { ...upload.metadata } };
  },

  // Post-processing after the last byte (enqueue processing job)
  async onUploadFinish(req, upload) {
    return { status_code: 200, body: JSON.stringify({ id: upload.id }) };
  },

  // Control storage key — default is crypto.randomBytes(16).toString('hex');
  // upload ID in the URL == file name in storage
  namingFunction(req, metadata) { return `videos/${myId()}`; },
  // If namingFunction returns slashes, pair generateUrl + getFileIdFromRequest
  // (base64url-encode the id into the URL and decode it back).
});

// Lifecycle events (EventEmitter)
tusServer.on(EVENTS.POST_CREATE, (req, upload, url) => { /* upload created */ });
tusServer.on(EVENTS.POST_FINISH, (req, res, upload) => { /* fully received */ });
tusServer.on(EVENTS.POST_TERMINATE, (req, res, id) => { /* client aborted */ });
```

Integration in an existing framework: mount `tusServer.handle(req, res)` on the owned route prefix (in Nest, an `@All('uploads/tus*')` controller route or middleware that delegates to the tus server and bypasses body parsing — tus needs the raw stream; disable `bodyParser` / global interceptors for that prefix). Hooks may throw `{ status_code, body }` to reject; `onUploadCreate` may merge server-side metadata; `onUploadFinish` may return a custom response.

### @tus/s3-store

_Used by upload-processing/TD-02 (datastore for the tus server, sharing TD-01's S3 config against MinIO)._

```typescript
import { S3Store } from "@tus/s3-store";

const s3Store = new S3Store({
  partSize: 8 * 1024 * 1024,               // preferred multipart part size (~8 MiB; S3 minimum 5 MiB)
  s3ClientConfig: {
    bucket: process.env.STORAGE_VIDEOS_BUCKET!,
    region: "us-east-1",
    endpoint: "http://minio:9000",         // internal endpoint (Compose service name)
    forcePathStyle: true,                  // MinIO
    credentials: {
      accessKeyId: process.env.STORAGE_ACCESS_KEY!,
      secretAccessKey: process.env.STORAGE_SECRET_KEY!,
    },
  },
  expirationPeriodInMilliseconds: 7 * 24 * 60 * 60 * 1000, // expire incomplete uploads (7 days)
  useTags: true,                           // tags incomplete uploads Tus-Completed=false (MinIO supports tagging)
  maxConcurrentPartUploads: 20,            // default 60
  // maxMultipartParts: 10000,             // lower only for providers with smaller limits
});
```

Streams chunks to S3 multipart uploads — memory-flat, which is TD-02's 10GB guarantee. Supports Creation, Creation-With-Upload, Expiration, Termination. Note: 10 GiB / 10,000 parts max → `partSize` must be ≥ ~1.1 MiB; the 8 MiB preferred size is safe. Cleanup of expired partial uploads: bucket lifecycle rule filtering on tag `Tus-Completed=false`, or a periodic `server.cleanUpExpiredUploads()` job.

### pg-boss

_Used by upload-processing/TD-03 (job queue on the existing PostgreSQL) and TD-04 (worker consumes from it)._

```javascript
import { PgBoss } from "pg-boss";

const boss = new PgBoss("postgres://user:pass@db:5432/database"); // or { connectionString } / individual keys; supports schema option
boss.on("error", console.error);      // pg-boss maintenance errors — always subscribe
await boss.start();                    // creates its schema/tables on first run

// Queues must be created before use
await boss.createQueue("video-processing");

// Producer (API side)
const jobId = await boss.send("video-processing", { videoId }, {
  retryLimit: 2,        // retries on failure
  // retryDelay, retryBackoff, startAfter, expireInSeconds, singletonKey also available
});

// Worker (TD-04 separate entry point) — handler receives an ARRAY of jobs
await boss.work("video-processing", async ([job]) => {
  await processVideo(job.data);       // throw to fail → retry per retryLimit
  // job.signal is an AbortSignal usable for cancellation-aware calls
});
```

**Transactional enqueue (the TD-03 rationale):** `send()` / `insert()` accept a `db` option — a wrapper exposing `executeSql(sql, params)` — so the job INSERT runs on the caller's transaction client instead of pg-boss's pool. With TypeORM, wrap the `QueryRunner` of the active transaction:

```typescript
await dataSource.transaction(async (manager) => {
  await manager.save(videoDraft);                              // domain write
  const trxDb = {
    executeSql: (sql: string, params: unknown[]) =>
      manager.query(sql, params).then((rows) => ({ rows })),   // adapt to pg-boss Db interface
  };
  await boss.send("video-processing", { videoId: videoDraft.id }, { db: trxDb });
}); // rollback ⇒ no job; commit ⇒ job exists — closes the job-loss race structurally
```

(pg-boss ships ready adapters `fromKnex` / `fromKysely` / `fromPrisma`; for TypeORM the ~4-line manual wrapper above is the equivalent.)

### nanoid

_Used by upload-processing/TD-06 (unique public video ID, ~11 chars, URL-safe, non-enumerable)._

```typescript
import { nanoid, customAlphabet, urlAlphabet } from "nanoid"; // ESM-only since v4 (v5.x current) — nestjs-project must import via dynamic import or stay on nanoid@3 for CJS

const id = nanoid(11);                 // 11-char ID from default A-Za-z0-9_- alphabet
// or a dedicated generator with fixed size:
const videoId = customAlphabet(urlAlphabet, 11);
videoId(); //=> e.g. "Uakgb_J5m9j"
```

Key facts: default alphabet is 64 URL-safe chars (`A-Za-z0-9_-`); cryptographically secure randomness (non-enumerable). At 11 chars/64-symbol alphabet, collision probability is negligible at this project's scale but non-zero — which is exactly why TD-06 pairs it with a DB unique constraint + insert-retry. **Packaging caveat:** nanoid ≥4 is pure ESM; in a CommonJS-compiled NestJS project either use `nanoid@3.x` (CJS, same API) or a dynamic `await import("nanoid")`. Flag this choice at implement time.

### tus-js-client

_Used by upload-processing/TD-09 (FE-runtime upload foundation — `Renders in: frontend-runtime`; consumed by future upload UI, pointed at TD-02's BFF streaming proxy)._

```javascript
import * as tus from "tus-js-client";

const upload = new tus.Upload(file, {
  endpoint: "/api/uploads/tus",                  // BFF proxy route (strict-BFF path)
  retryDelays: [0, 3000, 5000, 10000, 20000],    // automatic retry on transient errors
  metadata: { filename: file.name, filetype: file.type },
  onProgress: (bytesUploaded, bytesTotal) => { /* percentage = bytesUploaded / bytesTotal */ },
  onError: (error) => { /* terminal failure after retries */ },
  onSuccess: () => { /* upload.url = final upload URL */ },
});

// Resume-after-failure: fingerprint-based lookup in URL storage (localStorage in browsers)
const previousUploads = await upload.findPreviousUploads();
if (previousUploads.length) upload.resumeFromPreviousUpload(previousUploads[0]);
upload.start();
```

Key facts: `chunkSize` defaults to `Infinity` (whole file in one PATCH) and the docs warn **do not set it** unless the server/proxy limits request body size — if the BFF proxy imposes a body limit, set `chunkSize` to a multiple of the S3 part size and never below S3's 5 MiB minimum; small chunks degrade throughput. `uploadDataDuringCreation: true` uses the creation-with-upload extension (server must support it). `findPreviousUploads()` / `resumeFromPreviousUpload()` implement resume across page reloads via file fingerprint. Custom `headers` can carry auth, though in the BFF model the session cookie travels automatically.