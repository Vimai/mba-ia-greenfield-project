import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { randomUUID } from 'crypto';
import PgBoss from 'pg-boss';
import { DataSource } from 'typeorm';
import databaseConfig from '../config/database.config';
import { createTestDataSource } from '../test/create-test-data-source';
import { PG_BOSS, QUEUE_NAMES } from './queue.constants';
import { QueueModule } from './queue.module';
import { QueueService } from './queue.service';

describe('QueueService (integration)', () => {
  let testingModule: TestingModule;
  let queueService: QueueService;
  let boss: PgBoss;
  let dataSource: DataSource;

  beforeAll(async () => {
    testingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [databaseConfig] }),
        QueueModule,
      ],
    }).compile();
    await testingModule.init();

    queueService = testingModule.get(QueueService);
    boss = testingModule.get(PG_BOSS);

    dataSource = createTestDataSource([]);
    await dataSource.initialize();
  }, 30000);

  afterAll(async () => {
    await dataSource.destroy();
    await testingModule.close();
  });

  async function fetchJobFor(videoId: string) {
    const jobs = await boss.fetch<{ videoId: string }>(
      QUEUE_NAMES.VIDEO_PROCESSING,
      { batchSize: 50 },
    );
    return jobs.find((job) => job.data?.videoId === videoId);
  }

  it('a job enqueued within a committed transaction is consumable', async () => {
    const videoId = randomUUID();

    await dataSource.transaction(async (manager) => {
      await queueService.enqueueVideoProcessing(videoId, { manager });
    });

    const job = await fetchJobFor(videoId);
    expect(job).toBeDefined();
    expect(job?.data.videoId).toBe(videoId);
  });

  it('a job enqueued within a rolled-back transaction does not exist', async () => {
    const videoId = randomUUID();

    await expect(
      dataSource.transaction(async (manager) => {
        await queueService.enqueueVideoProcessing(videoId, { manager });
        throw new Error('force rollback');
      }),
    ).rejects.toThrow('force rollback');

    const job = await fetchJobFor(videoId);
    expect(job).toBeUndefined();
  });
});
