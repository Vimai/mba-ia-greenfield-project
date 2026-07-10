import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { createWriteStream, promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pipeline } from 'stream/promises';
import storageConfig from '../config/storage.config';
import { StorageService } from '../storage/storage.service';
import { VideosService } from '../videos/videos.service';
import { FfmpegService } from './ffmpeg.service';

@Injectable()
export class ProcessingService {
  constructor(
    private readonly storageService: StorageService,
    private readonly videosService: VideosService,
    private readonly ffmpegService: FfmpegService,
    @Inject(storageConfig.KEY)
    private readonly config: ConfigType<typeof storageConfig>,
  ) {}

  async processVideo(videoId: string): Promise<void> {
    const video = await this.videosService.findById(videoId);
    if (!video) {
      throw new Error(`Video ${videoId} not found`);
    }

    const workDir = await fs.mkdtemp(join(tmpdir(), 'video-processing-'));
    const inputPath = join(workDir, 'input');
    const thumbnailPath = join(workDir, 'thumbnail.jpg');

    try {
      const objectStream = await this.storageService.getObjectStream(
        this.config.videosBucket,
        video.storage_key,
      );
      await pipeline(objectStream, createWriteStream(inputPath));

      const metadata = await this.ffmpegService.probeMetadata(inputPath);
      const atSecond = Math.min(1, metadata.durationSeconds / 2);
      await this.ffmpegService.extractThumbnail(
        inputPath,
        thumbnailPath,
        atSecond,
      );

      const thumbnailBuffer = await fs.readFile(thumbnailPath);
      const thumbnailKey = `thumbnails/${video.public_id}.jpg`;
      await this.storageService.putObject(
        this.config.thumbnailsBucket,
        thumbnailKey,
        thumbnailBuffer,
      );

      await this.videosService.markReady(video.id, {
        durationSeconds: metadata.durationSeconds,
        width: metadata.width,
        height: metadata.height,
        thumbnailKey,
      });
    } finally {
      await fs.rm(workDir, { recursive: true, force: true });
    }
  }
}
