import { DataSource, Repository } from 'typeorm';
import { Channel } from '../../channels/entities/channel.entity';
import { User } from '../../users/entities/user.entity';
import {
  cleanAllTables,
  createTestDataSource,
} from '../../test/create-test-data-source';
import {
  Video,
  VideoProcessingStatus,
  VideoStatus,
} from './video.entity';

const ALL_ENTITIES = [User, Channel, Video];

describe('Video entity (integration)', () => {
  let dataSource: DataSource;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;
  let videoRepository: Repository<Video>;

  beforeAll(async () => {
    dataSource = createTestDataSource(ALL_ENTITIES);
    await dataSource.initialize();
    userRepository = dataSource.getRepository(User);
    channelRepository = dataSource.getRepository(Channel);
    videoRepository = dataSource.getRepository(Video);
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
        email: `video_user_${++counter}@example.com`,
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

  function buildVideo(
    channelId: string,
    overrides: Partial<Video> = {},
  ): Partial<Video> {
    return {
      public_id: `pubid_${++counter}`,
      channel_id: channelId,
      title: 'My video',
      storage_key: `videos/key_${counter}`,
      ...overrides,
    };
  }

  it('persists a video with default status and processing_status', async () => {
    const channel = await createChannel();
    const video = await videoRepository.save(
      videoRepository.create(buildVideo(channel.id)),
    );

    expect(video.id).toBeDefined();
    expect(video.status).toBe(VideoStatus.DRAFT);
    expect(video.processing_status).toBe(VideoProcessingStatus.UPLOADING);
    expect(video.created_at).toBeInstanceOf(Date);
  });

  it('rejects a duplicate public_id', async () => {
    const channel = await createChannel();
    await videoRepository.save(
      videoRepository.create(buildVideo(channel.id, { public_id: 'dup_id' })),
    );

    const duplicate = videoRepository.create(
      buildVideo(channel.id, { public_id: 'dup_id' }),
    );

    await expect(videoRepository.save(duplicate)).rejects.toThrow();
  });

  it('rejects a duplicate storage_key', async () => {
    const channel = await createChannel();
    await videoRepository.save(
      videoRepository.create(
        buildVideo(channel.id, { storage_key: 'videos/dup-key' }),
      ),
    );

    const duplicate = videoRepository.create(
      buildVideo(channel.id, { storage_key: 'videos/dup-key' }),
    );

    await expect(videoRepository.save(duplicate)).rejects.toThrow();
  });

  it('loads the related channel via ManyToOne relation', async () => {
    const channel = await createChannel();
    await videoRepository.save(
      videoRepository.create(buildVideo(channel.id)),
    );

    const found = await videoRepository.findOne({
      where: { channel_id: channel.id },
      relations: ['channel'],
    });

    expect(found?.channel.id).toBe(channel.id);
  });
});
