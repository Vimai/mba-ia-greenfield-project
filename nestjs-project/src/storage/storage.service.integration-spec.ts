import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { randomUUID } from 'crypto';
import storageConfig from '../config/storage.config';
import { StorageModule } from './storage.module';
import { StorageService } from './storage.service';

describe('StorageService (integration)', () => {
  let storageService: StorageService;
  let bucket: string;

  beforeAll(async () => {
    // STORAGE_ENDPOINT_PUBLIC (localhost:9000) targets the host machine for
    // browser access; this suite runs inside the nestjs-api container, where
    // "localhost" is the container itself. Point the public client at the
    // minio service name instead so the presigned URL is actually fetchable
    // from here — the signing/host mechanics under test are unaffected.
    process.env.STORAGE_ENDPOINT_PUBLIC = process.env.STORAGE_ENDPOINT_INTERNAL;

    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [storageConfig] }),
        StorageModule,
      ],
    }).compile();

    storageService = module.get(StorageService);
    bucket = process.env.STORAGE_VIDEOS_BUCKET as string;
  });

  it('put -> presigned GET roundtrip returns the uploaded bytes with status 200', async () => {
    const key = `test/${randomUUID()}.txt`;
    const content = 'hello storage service';
    await storageService.putObject(bucket, key, content);

    const url = await storageService.getPresignedGetUrl(bucket, key);
    const response = await fetch(url);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(content);
  });

  it('presigned GET URL rejects requests after the expiry window elapses', async () => {
    const key = `test/${randomUUID()}.txt`;
    await storageService.putObject(bucket, key, 'expires soon');

    const url = await storageService.getPresignedGetUrl(bucket, key, {
      expiresInSeconds: 1,
    });
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const response = await fetch(url);
    expect(response.status).not.toBe(200);
  });

  it('presigned download URL carries an attachment content-disposition in the signed query string', async () => {
    const key = `test/${randomUUID()}.txt`;
    await storageService.putObject(bucket, key, 'download me');

    const url = await storageService.getPresignedGetUrl(bucket, key, {
      responseContentDisposition: 'attachment; filename="video.mp4"',
    });

    expect(decodeURIComponent(url)).toContain(
      'response-content-disposition=attachment; filename="video.mp4"',
    );
  });
});
