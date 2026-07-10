import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { customAlphabet, urlAlphabet } from 'nanoid';
import { EntityManager, QueryFailedError, Repository } from 'typeorm';
import {
  Video,
  VideoProcessingStatus,
  VideoStatus,
} from './entities/video.entity';
import { MAX_PUBLIC_ID_ATTEMPTS, PUBLIC_ID_LENGTH } from './videos.constants';

const PG_UNIQUE_VIOLATION = '23505';
const PUBLIC_ID_COLUMN = 'public_id';

function isPgUniqueViolationOnColumn(err: unknown, column: string): boolean {
  if (!(err instanceof QueryFailedError)) return false;
  const e = err as QueryFailedError & { code?: string; detail?: string };
  return (
    e.code === PG_UNIQUE_VIOLATION &&
    typeof e.detail === 'string' &&
    e.detail.includes(column)
  );
}

// nanoid@3 (CJS) is used deliberately — nanoid >=4 is pure ESM and cannot be
// `require()`d from this CommonJS-compiled project without Jest's
// --experimental-vm-modules, which this project's test harness does not enable.
const generatePublicId = customAlphabet(urlAlphabet, PUBLIC_ID_LENGTH);

export interface CreateDraftInput {
  channelId: string;
  title: string;
  storageKey: string;
}

@Injectable()
export class VideosService {
  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
  ) {}

  async createDraft(input: CreateDraftInput): Promise<Video> {
    for (let attempt = 0; attempt <= MAX_PUBLIC_ID_ATTEMPTS; attempt++) {
      const video = this.videoRepository.create({
        public_id: generatePublicId(),
        channel_id: input.channelId,
        title: input.title,
        storage_key: input.storageKey,
        status: VideoStatus.DRAFT,
        processing_status: VideoProcessingStatus.UPLOADING,
      });

      try {
        return await this.videoRepository.save(video);
      } catch (err) {
        if (!isPgUniqueViolationOnColumn(err, PUBLIC_ID_COLUMN)) {
          throw err;
        }
      }
    }

    throw new Error(
      `Failed to generate a unique public_id after ${MAX_PUBLIC_ID_ATTEMPTS} attempts`,
    );
  }

  async findByStorageKey(storageKey: string): Promise<Video | null> {
    return this.videoRepository.findOne({
      where: { storage_key: storageKey },
    });
  }

  async findByPublicId(publicId: string): Promise<Video | null> {
    return this.videoRepository.findOne({
      where: { public_id: publicId },
    });
  }

  async markProcessing(
    videoId: string,
    sizeBytes: number,
    manager: EntityManager,
  ): Promise<void> {
    await manager.update(Video, videoId, {
      processing_status: VideoProcessingStatus.PROCESSING,
      size_bytes: String(sizeBytes),
    });
  }

  async findById(id: string): Promise<Video | null> {
    return this.videoRepository.findOne({ where: { id } });
  }

  async markReady(
    videoId: string,
    data: {
      durationSeconds: number;
      width: number;
      height: number;
      thumbnailKey: string;
    },
  ): Promise<void> {
    await this.videoRepository.update(videoId, {
      processing_status: VideoProcessingStatus.READY,
      duration_seconds: String(data.durationSeconds),
      width: data.width,
      height: data.height,
      thumbnail_key: data.thumbnailKey,
      processing_error: null,
    });
  }

  async markFailed(videoId: string, error: string): Promise<void> {
    await this.videoRepository.update(videoId, {
      processing_status: VideoProcessingStatus.FAILED,
      processing_error: error,
    });
  }
}
