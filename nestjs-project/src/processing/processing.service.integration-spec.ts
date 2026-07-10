import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import type { ConfigType } from '@nestjs/config';
import { DataSource, Repository } from 'typeorm';
import { WorkerModule } from '../worker.module';
import { Channel } from '../channels/entities/channel.entity';
import { User } from '../users/entities/user.entity';
import { cleanAllTables } from '../test/create-test-data-source';
import { Video } from '../videos/entities/video.entity';
import { VideosService } from '../videos/videos.service';
import { StorageService } from '../storage/storage.service';
import storageConfig from '../config/storage.config';
import { ProcessingService } from './processing.service';

const execFileAsync = promisify(execFile);

async function generateFixtureVideo(path: string): Promise<void> {
  await execFileAsync('ffmpeg', [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc=duration=1:size=64x64:rate=5',
    '-pix_fmt',
    'yuv420p',
    path,
  ]);
}

describe('ProcessingService (integration)', () => {
  let moduleFixture: TestingModule;
  let dataSource: DataSource;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;
  let videoRepository: Repository<Video>;
  let videosService: VideosService;
  let storageService: StorageService;
  let processingService: ProcessingService;
  let videosBucket: string;
  let thumbnailsBucket: string;

  beforeAll(async () => {
    moduleFixture = await Test.createTestingModule({
      imports: [WorkerModule],
    }).compile();
    await moduleFixture.init();

    dataSource = moduleFixture.get(DataSource);
    userRepository = dataSource.getRepository(User);
    channelRepository = dataSource.getRepository(Channel);
    videoRepository = dataSource.getRepository(Video);
    videosService = moduleFixture.get(VideosService);
    storageService = moduleFixture.get(StorageService);
    processingService = moduleFixture.get(ProcessingService);

    const config = moduleFixture.get<ConfigType<typeof storageConfig>>(
      storageConfig.KEY,
    );
    videosBucket = config.videosBucket;
    thumbnailsBucket = config.thumbnailsBucket;
  }, 30000);

  afterAll(async () => {
    await moduleFixture.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
  });

  let counter = 0;
  async function createChannel(): Promise<Channel> {
    const user = await userRepository.save(
      userRepository.create({
        email: `processing_user_${++counter}@example.com`,
        password: 'hashed',
      }),
    );
    return channelRepository.save(
      channelRepository.create({
        name: `channel_${counter}`,
        nickname: `channel_${counter}`,
        user_id: user.id,
      }),
    );
  }

  async function createVideoWithObject(objectBytes: Buffer): Promise<Video> {
    const channel = await createChannel();
    const storageKey = `videos/${randomUUID()}`;
    await storageService.putObject(videosBucket, storageKey, objectBytes);
    return videosService.createDraft({
      channelId: channel.id,
      title: 'fixture.mp4',
      storageKey,
    });
  }

  it(
    'processes a valid fixture: video becomes ready with metadata and a thumbnail in the bucket',
    async () => {
      const workDir = await fs.mkdtemp(join(tmpdir(), 'fixture-'));
      const fixturePath = join(workDir, 'fixture.mp4');
      await generateFixtureVideo(fixturePath);
      const fixtureBytes = await fs.readFile(fixturePath);

      const video = await createVideoWithObject(fixtureBytes);
      await processingService.processVideo(video.id);

      const updated = await videoRepository.findOneByOrFail({ id: video.id });
      expect(updated.processing_status).toBe('ready');
      expect(Number(updated.duration_seconds)).toBeGreaterThan(0);
      expect(updated.width).toBe(64);
      expect(updated.height).toBe(64);
      expect(updated.thumbnail_key).toBe(`thumbnails/${video.public_id}.jpg`);

      const thumbnail = await storageService.headObject(
        thumbnailsBucket,
        updated.thumbnail_key!,
      );
      expect(thumbnail).toBeDefined();

      await fs.rm(workDir, { recursive: true, force: true });
    },
    30000,
  );

  it(
    'reprocessing an already-ready video keeps data consistent (no orphaned duplicate thumbnail)',
    async () => {
      const workDir = await fs.mkdtemp(join(tmpdir(), 'fixture-'));
      const fixturePath = join(workDir, 'fixture.mp4');
      await generateFixtureVideo(fixturePath);
      const fixtureBytes = await fs.readFile(fixturePath);

      const video = await createVideoWithObject(fixtureBytes);
      await processingService.processVideo(video.id);
      const firstPass = await videoRepository.findOneByOrFail({
        id: video.id,
      });

      await processingService.processVideo(video.id);
      const secondPass = await videoRepository.findOneByOrFail({
        id: video.id,
      });

      expect(secondPass.thumbnail_key).toBe(firstPass.thumbnail_key);
      expect(secondPass.processing_status).toBe('ready');

      const thumbnail = await storageService.headObject(
        thumbnailsBucket,
        secondPass.thumbnail_key!,
      );
      expect(thumbnail).toBeDefined();

      await fs.rm(workDir, { recursive: true, force: true });
    },
    30000,
  );

  it(
    'a corrupted object fails processing, and the worker failure path marks the video failed',
    async () => {
      const video = await createVideoWithObject(
        Buffer.from('this is not a video file'),
      );

      let caught: unknown;
      try {
        await processingService.processVideo(video.id);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeDefined();

      const message = caught instanceof Error ? caught.message : String(caught);
      await videosService.markFailed(video.id, message);

      const updated = await videoRepository.findOneByOrFail({ id: video.id });
      expect(updated.processing_status).toBe('failed');
      expect(updated.processing_error).toBeTruthy();
    },
    30000,
  );
});
