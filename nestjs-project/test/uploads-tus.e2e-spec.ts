import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { json, urlencoded } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { DataSource, Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { Video } from '../src/videos/entities/video.entity';
import { TUS_SERVER, UPLOADS_TUS_PATH } from '../src/uploads/uploads.constants';

describe('Uploads tus (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let videoRepository: Repository<Video>;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication({ bodyParser: false });
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.originalUrl.startsWith(UPLOADS_TUS_PATH)) return next();
      json()(req, res, () => urlencoded({ extended: true })(req, res, next));
    });
    const tusServer = app.get<{
      handle: (req: Request, res: Response) => unknown;
    }>(TUS_SERVER);
    app.use(UPLOADS_TUS_PATH, (req: Request, res: Response) =>
      tusServer.handle(req, res),
    );

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
    videoRepository = dataSource.getRepository(Video);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
  });

  let userCounter = 0;
  async function registerConfirmAndLogin(): Promise<string> {
    const email = `tus_user_${++userCounter}@example.com`;
    const password = 'password123';

    let capturedToken = '';
    const authService = app.get(AuthService);
    const mailServiceInstance = (authService as any).mailService;
    jest
      .spyOn(mailServiceInstance, 'sendConfirmationEmail')
      .mockImplementationOnce(async (_e: string, _n: string, t: string) => {
        capturedToken = t;
      });

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password });
    await request(app.getHttpServer())
      .get('/auth/confirm-email')
      .query({ token: capturedToken });
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password });

    return res.body.access_token;
  }

  function uploadMetadata(pairs: Record<string, string>): string {
    return Object.entries(pairs)
      .map(([key, value]) => `${key} ${Buffer.from(value).toString('base64')}`)
      .join(',');
  }

  function locationPath(location: string): string {
    return new URL(location, 'http://127.0.0.1').pathname;
  }

  describe('1. Upload creation', () => {
    it('1.1 create-upload-authenticated: POST with a valid token returns 201 and pre-registers the draft video', async () => {
      const token = await registerConfirmAndLogin();

      const res = await request(app.getHttpServer())
        .post(UPLOADS_TUS_PATH)
        .set('Authorization', `Bearer ${token}`)
        .set('Tus-Resumable', '1.0.0')
        .set('Upload-Length', '1024')
        .set('Upload-Metadata', uploadMetadata({ filename: 'my-video.mp4' }))
        .expect(201);

      expect(res.headers.location).toBeDefined();

      const videos = await videoRepository.find();
      expect(videos).toHaveLength(1);
      expect(videos[0].status).toBe('draft');
      expect(videos[0].processing_status).toBe('uploading');
      expect(videos[0].public_id).toHaveLength(11);
      expect(videos[0].public_id).toMatch(/^[A-Za-z0-9_-]{11}$/);
      expect(videos[0].storage_key).toMatch(/^videos\//);
    });

    it('1.2 create-upload-unauthenticated: POST without Authorization returns 401 and creates no video', async () => {
      await request(app.getHttpServer())
        .post(UPLOADS_TUS_PATH)
        .set('Tus-Resumable', '1.0.0')
        .set('Upload-Length', '1024')
        .expect(401);

      const videos = await videoRepository.find();
      expect(videos).toHaveLength(0);
    });

    it('1.3 create-upload-too-large: POST above 10 GiB returns 413 and creates no video', async () => {
      const token = await registerConfirmAndLogin();

      await request(app.getHttpServer())
        .post(UPLOADS_TUS_PATH)
        .set('Authorization', `Bearer ${token}`)
        .set('Tus-Resumable', '1.0.0')
        .set('Upload-Length', '10737418241')
        .expect(413);

      const videos = await videoRepository.find();
      expect(videos).toHaveLength(0);
    });
  });

  describe('2. Upload data transfer', () => {
    const fixture = Buffer.alloc(2048, 'a');

    async function createUpload(token: string): Promise<string> {
      const res = await request(app.getHttpServer())
        .post(UPLOADS_TUS_PATH)
        .set('Authorization', `Bearer ${token}`)
        .set('Tus-Resumable', '1.0.0')
        .set('Upload-Length', String(fixture.length))
        .set('Upload-Metadata', uploadMetadata({ filename: 'clip.mp4' }))
        .expect(201);

      return locationPath(res.headers.location);
    }

    it('2.1 finalize-upload-enqueues-processing: final PATCH transitions the video and enqueues exactly one job', async () => {
      const token = await registerConfirmAndLogin();
      const path = await createUpload(token);

      const res = await request(app.getHttpServer())
        .patch(path)
        .set('Authorization', `Bearer ${token}`)
        .set('Tus-Resumable', '1.0.0')
        .set('Upload-Offset', '0')
        .set('Content-Type', 'application/offset+octet-stream')
        .send(fixture)
        .expect(204);

      expect(res.headers['upload-offset']).toBe(String(fixture.length));

      const videos = await videoRepository.find();
      expect(videos).toHaveLength(1);
      expect(videos[0].processing_status).toBe('processing');
      expect(videos[0].size_bytes).toBe(String(fixture.length));

      const jobs = await dataSource.query(
        `SELECT * FROM pgboss.job WHERE name = 'video-processing' AND data->>'videoId' = $1`,
        [videos[0].id],
      );
      expect(jobs).toHaveLength(1);
    });

    it('2.2 resume-interrupted-upload: a HEAD reflects partial offset and a follow-up PATCH completes the upload', async () => {
      const token = await registerConfirmAndLogin();
      const path = await createUpload(token);
      const half = fixture.length / 2;

      const partial = await request(app.getHttpServer())
        .patch(path)
        .set('Authorization', `Bearer ${token}`)
        .set('Tus-Resumable', '1.0.0')
        .set('Upload-Offset', '0')
        .set('Content-Type', 'application/offset+octet-stream')
        .send(fixture.subarray(0, half))
        .expect(204);
      expect(partial.headers['upload-offset']).toBe(String(half));

      const head = await request(app.getHttpServer())
        .head(path)
        .set('Authorization', `Bearer ${token}`)
        .set('Tus-Resumable', '1.0.0')
        .expect(200);
      expect(head.headers['upload-offset']).toBe(String(half));

      const final = await request(app.getHttpServer())
        .patch(path)
        .set('Authorization', `Bearer ${token}`)
        .set('Tus-Resumable', '1.0.0')
        .set('Upload-Offset', String(half))
        .set('Content-Type', 'application/offset+octet-stream')
        .send(fixture.subarray(half))
        .expect(204);
      expect(final.headers['upload-offset']).toBe(String(fixture.length));

      const videos = await videoRepository.find();
      expect(videos[0].processing_status).toBe('processing');
    });
  });
});
