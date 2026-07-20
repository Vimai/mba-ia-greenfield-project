import type { Repository } from 'typeorm';
import { QueryFailedError } from 'typeorm';
import { VideosService } from './videos.service';
import {
  Video,
  VideoProcessingStatus,
  VideoStatus,
} from './entities/video.entity';

function makeRepository(
  overrides: Partial<Repository<Video>> = {},
): Partial<Repository<Video>> {
  return {
    create: jest.fn(),
    save: jest.fn(),
    ...overrides,
  };
}

function makeVideo(overrides: Partial<Video> = {}): Video {
  const video = new Video();
  video.id = 'uuid';
  video.public_id = 'publicid123';
  video.channel_id = 'channel-id';
  video.title = 'title';
  video.storage_key = 'videos/key';
  video.status = VideoStatus.DRAFT;
  video.processing_status = VideoProcessingStatus.UPLOADING;
  video.created_at = new Date();
  video.updated_at = new Date();
  return Object.assign(video, overrides);
}

function makeUniqueError(): QueryFailedError {
  const err = new QueryFailedError(
    'INSERT',
    [],
    new Error(),
  ) as unknown as QueryFailedError & {
    code: string;
    detail: string;
  };
  err.code = '23505';
  err.detail = 'Key (public_id)=(abc) already exists.';
  return err;
}

describe('VideosService', () => {
  describe('createDraft', () => {
    it('persists the draft on the first attempt when there is no collision', async () => {
      const video = makeVideo();
      const repository = makeRepository({
        create: jest.fn().mockReturnValue(video),
        save: jest.fn().mockResolvedValue(video),
      });
      const service = new VideosService(repository as Repository<Video>);

      const result = await service.createDraft({
        channelId: 'channel-id',
        title: 'title',
        storageKey: 'videos/key',
      });

      expect(repository.save).toHaveBeenCalledTimes(1);
      expect(result.status).toBe(VideoStatus.DRAFT);
      expect(result.processing_status).toBe(VideoProcessingStatus.UPLOADING);
    });

    it('retries with a new public_id on a unique constraint violation', async () => {
      const video = makeVideo();
      const repository = makeRepository({
        create: jest.fn().mockReturnValue(video),
        save: jest
          .fn()
          .mockRejectedValueOnce(makeUniqueError())
          .mockResolvedValueOnce(video),
      });
      const service = new VideosService(repository as Repository<Video>);

      const result = await service.createDraft({
        channelId: 'channel-id',
        title: 'title',
        storageKey: 'videos/key',
      });

      expect(repository.save).toHaveBeenCalledTimes(2);
      expect(result).toBe(video);
    });

    it('throws after exhausting max retries', async () => {
      const video = makeVideo();
      const repository = makeRepository({
        create: jest.fn().mockReturnValue(video),
        save: jest.fn().mockRejectedValue(makeUniqueError()),
      });
      const service = new VideosService(repository as Repository<Video>);

      await expect(
        service.createDraft({
          channelId: 'channel-id',
          title: 'title',
          storageKey: 'videos/key',
        }),
      ).rejects.toThrow('Failed to generate a unique public_id');
    });

    it('re-throws non-unique-constraint errors immediately', async () => {
      const unexpectedError = new Error('Connection lost');
      const repository = makeRepository({
        create: jest.fn().mockReturnValue(makeVideo()),
        save: jest.fn().mockRejectedValue(unexpectedError),
      });
      const service = new VideosService(repository as Repository<Video>);

      await expect(
        service.createDraft({
          channelId: 'channel-id',
          title: 'title',
          storageKey: 'videos/key',
        }),
      ).rejects.toThrow('Connection lost');
      expect(repository.save).toHaveBeenCalledTimes(1);
    });
  });
});
