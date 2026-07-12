import { randomUUID } from 'crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { MailService } from '../src/mail/mail.service';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { Channel } from '../src/channels/entities/channel.entity';
import {
  Video,
  VideoProcessingStatus,
  VideoStatus,
} from '../src/videos/entities/video.entity';
import { StorageService } from '../src/storage/storage.service';
import storageConfig from '../src/config/storage.config';

interface LoginResponseBody {
  access_token: string;
}

interface MeResponseBody {
  sub: string;
}

interface StatusResponseBody {
  publicId: string;
  title: string;
  processingStatus: string;
  durationSeconds: number;
  width: number;
  height: number;
  thumbnailUrl: string;
}

interface PresignedUrlResponseBody {
  url: string;
  expiresInSeconds: number;
}

interface ErrorResponseBody {
  error: string;
}

describe('Videos delivery (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let channelRepository: Repository<Channel>;
  let videoRepository: Repository<Video>;
  let storageService: StorageService;
  let videosBucket: string;
  let thumbnailsBucket: string;

  beforeAll(async () => {
    // STORAGE_ENDPOINT_PUBLIC (localhost:9000) targets the host machine for
    // browser access; this suite runs inside the nestjs-api container, where
    // "localhost" is the container itself. Point the public client at the
    // minio service name instead so presigned URLs are actually fetchable
    // from here — the signing/host mechanics under test are unaffected.
    process.env.STORAGE_ENDPOINT_PUBLIC = process.env.STORAGE_ENDPOINT_INTERNAL;

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(
      new DomainExceptionFilter(),
      new ValidationExceptionFilter(),
    );
    await app.init();

    dataSource = moduleFixture.get(DataSource);
    channelRepository = dataSource.getRepository(Channel);
    videoRepository = dataSource.getRepository(Video);
    storageService = moduleFixture.get(StorageService);
    const config = moduleFixture.get<ConfigType<typeof storageConfig>>(
      storageConfig.KEY,
    );
    videosBucket = config.videosBucket;
    thumbnailsBucket = config.thumbnailsBucket;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
  });

  let userCounter = 0;
  async function registerConfirmAndLoginWithChannel(): Promise<{
    token: string;
    channel: Channel;
  }> {
    const email = `videos_delivery_${++userCounter}@example.com`;
    const password = 'password123';

    let capturedToken = '';
    const authService = app.get(AuthService);
    const mailServiceInstance = (
      authService as unknown as { mailService: MailService }
    ).mailService;
    jest
      .spyOn(mailServiceInstance, 'sendConfirmationEmail')
      .mockImplementationOnce((_e: string, _n: string, t: string) => {
        capturedToken = t;
        return Promise.resolve();
      });

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password });
    await request(app.getHttpServer())
      .get('/auth/confirm-email')
      .query({ token: capturedToken });
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password });
    const loginBody = loginRes.body as LoginResponseBody;

    const meRes = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${loginBody.access_token}`);
    const meBody = meRes.body as MeResponseBody;

    const channel = await channelRepository.findOneByOrFail({
      user_id: meBody.sub,
    });

    return { token: loginBody.access_token, channel };
  }

  let videoCounter = 0;
  async function seedVideo(
    channelId: string,
    overrides: Partial<Video> = {},
  ): Promise<Video> {
    return videoRepository.save(
      videoRepository.create({
        public_id: `pubid${++videoCounter}`.padEnd(11, '0').slice(0, 11),
        channel_id: channelId,
        title: 'my-video.mp4',
        storage_key: `videos/${randomUUID()}`,
        status: VideoStatus.DRAFT,
        processing_status: VideoProcessingStatus.UPLOADING,
        ...overrides,
      }),
    );
  }

  describe('1. Processing status', () => {
    it('1.1 status-owner-success: the owner gets 200 with the full status shape', async () => {
      const { token, channel } = await registerConfirmAndLoginWithChannel();
      const video = await seedVideo(channel.id, {
        processing_status: VideoProcessingStatus.READY,
        duration_seconds: '12.5',
        width: 1920,
        height: 1080,
        thumbnail_key: `thumbnails/${randomUUID()}.jpg`,
      });
      await storageService.putObject(
        thumbnailsBucket,
        video.thumbnail_key!,
        Buffer.from('fake-thumbnail'),
      );

      const res = await request(app.getHttpServer())
        .get(`/videos/${video.public_id}/status`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const body = res.body as StatusResponseBody;

      expect(body.publicId).toBe(video.public_id);
      expect(body.title).toBe(video.title);
      expect(body.processingStatus).toBe('ready');
      expect(typeof body.durationSeconds).toBe('number');
      expect(typeof body.width).toBe('number');
      expect(typeof body.height).toBe('number');
      expect(typeof body.thumbnailUrl).toBe('string');
      expect(body.thumbnailUrl.length).toBeGreaterThan(0);
    });

    it('1.2 status-not-owner-forbidden: a different authenticated user gets 403 VIDEO_NOT_OWNED', async () => {
      const { channel } = await registerConfirmAndLoginWithChannel();
      const { token: otherToken } = await registerConfirmAndLoginWithChannel();
      const video = await seedVideo(channel.id);

      const res = await request(app.getHttpServer())
        .get(`/videos/${video.public_id}/status`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(403);

      expect((res.body as ErrorResponseBody).error).toBe('VIDEO_NOT_OWNED');
    });

    it('1.3 status-unauthenticated: no Authorization header returns 401', async () => {
      const { channel } = await registerConfirmAndLoginWithChannel();
      const video = await seedVideo(channel.id);

      await request(app.getHttpServer())
        .get(`/videos/${video.public_id}/status`)
        .expect(401);
    });
  });

  describe('2. Streaming and download delivery', () => {
    const fixtureBytes = Buffer.from('fake video bytes for streaming test');

    async function seedReadyVideoWithObject(channelId: string): Promise<Video> {
      const video = await seedVideo(channelId, {
        processing_status: VideoProcessingStatus.READY,
        duration_seconds: '5',
        width: 640,
        height: 480,
      });
      await storageService.putObject(
        videosBucket,
        video.storage_key,
        fixtureBytes,
      );
      return video;
    }

    it('2.1 stream-url-ready-anonymous: anonymous GET returns a working presigned URL', async () => {
      const { channel } = await registerConfirmAndLoginWithChannel();
      const video = await seedReadyVideoWithObject(channel.id);

      const res = await request(app.getHttpServer())
        .get(`/videos/${video.public_id}/stream-url`)
        .expect(200);
      const body = res.body as PresignedUrlResponseBody;

      expect(typeof body.url).toBe('string');
      expect(typeof body.expiresInSeconds).toBe('number');

      const fetched = await fetch(body.url);
      expect([200, 206]).toContain(fetched.status);
      expect(Buffer.from(await fetched.arrayBuffer())).toEqual(fixtureBytes);
    });

    it('2.2 stream-url-not-ready-conflict: a processing video returns 409 VIDEO_NOT_READY', async () => {
      const { channel } = await registerConfirmAndLoginWithChannel();
      const video = await seedVideo(channel.id, {
        processing_status: VideoProcessingStatus.PROCESSING,
      });

      const res = await request(app.getHttpServer())
        .get(`/videos/${video.public_id}/stream-url`)
        .expect(409);

      expect((res.body as ErrorResponseBody).error).toBe('VIDEO_NOT_READY');
    });

    it('2.3 download-url-attachment-disposition: the presigned URL carries an attachment disposition', async () => {
      const { channel } = await registerConfirmAndLoginWithChannel();
      const video = await seedReadyVideoWithObject(channel.id);

      const res = await request(app.getHttpServer())
        .get(`/videos/${video.public_id}/download-url`)
        .expect(200);
      const body = res.body as PresignedUrlResponseBody;

      expect(decodeURIComponent(body.url)).toContain(
        'response-content-disposition=attachment',
      );

      const fetched = await fetch(body.url);
      expect(fetched.status).toBe(200);
      expect(fetched.headers.get('content-disposition')).toMatch(/^attachment/);
    });
  });

  describe('3. Not found', () => {
    it('3.1 unknown-public-id-not-found: all three endpoints return 404 VIDEO_NOT_FOUND', async () => {
      const { token } = await registerConfirmAndLoginWithChannel();
      const unknownId = 'doesnotexist';

      const statusRes = await request(app.getHttpServer())
        .get(`/videos/${unknownId}/status`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
      expect((statusRes.body as ErrorResponseBody).error).toBe(
        'VIDEO_NOT_FOUND',
      );

      const streamRes = await request(app.getHttpServer())
        .get(`/videos/${unknownId}/stream-url`)
        .expect(404);
      expect((streamRes.body as ErrorResponseBody).error).toBe(
        'VIDEO_NOT_FOUND',
      );

      const downloadRes = await request(app.getHttpServer())
        .get(`/videos/${unknownId}/download-url`)
        .expect(404);
      expect((downloadRes.body as ErrorResponseBody).error).toBe(
        'VIDEO_NOT_FOUND',
      );
    });
  });
});
