import { DataSource, Repository } from 'typeorm';
import { Channel } from '../channels/entities/channel.entity';
import { User } from '../users/entities/user.entity';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import {
  Video,
  VideoProcessingStatus,
  VideoStatus,
} from './entities/video.entity';
import { VideosService } from './videos.service';

const ALL_ENTITIES = [User, Channel, Video];

describe('VideosService (integration)', () => {
  let dataSource: DataSource;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;
  let videosService: VideosService;

  beforeAll(async () => {
    dataSource = createTestDataSource(ALL_ENTITIES);
    await dataSource.initialize();
    userRepository = dataSource.getRepository(User);
    channelRepository = dataSource.getRepository(Channel);
    videosService = new VideosService(dataSource.getRepository(Video));
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
  });

  let counter = 0;
  async function createChannel(): Promise<Channel> {
    const user = await userRepository.save(
      userRepository.create({
        email: `videos_service_user_${++counter}@example.com`,
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

  it('createDraft persists a draft with status draft, processing_status uploading and an 11-char URL-safe public_id', async () => {
    const channel = await createChannel();

    const video = await videosService.createDraft({
      channelId: channel.id,
      title: 'my-video.mp4',
      storageKey: `videos/${channel.id}-1`,
    });

    expect(video.id).toBeDefined();
    expect(video.status).toBe(VideoStatus.DRAFT);
    expect(video.processing_status).toBe(VideoProcessingStatus.UPLOADING);
    expect(video.public_id).toHaveLength(11);
    expect(video.public_id).toMatch(/^[A-Za-z0-9_-]{11}$/);
  });

  it('createDraft generates a distinct public_id for each call', async () => {
    const channel = await createChannel();

    const first = await videosService.createDraft({
      channelId: channel.id,
      title: 'a.mp4',
      storageKey: `videos/${channel.id}-a`,
    });
    const second = await videosService.createDraft({
      channelId: channel.id,
      title: 'b.mp4',
      storageKey: `videos/${channel.id}-b`,
    });

    expect(first.public_id).not.toBe(second.public_id);
  });
});
