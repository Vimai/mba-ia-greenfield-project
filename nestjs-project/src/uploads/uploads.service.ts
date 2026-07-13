import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import type { ServerResponse } from 'http';
import { DataSource } from 'typeorm';
import type { Upload } from '@tus/utils';
import { BEARER_PREFIX } from '../auth/auth.constants';
import type { JwtPayload } from '../auth/auth.types';
import { ChannelsService } from '../channels/channels.service';
import { Video } from '../videos/entities/video.entity';
import { VideosService } from '../videos/videos.service';
import { QueueService } from '../queue/queue.service';
import type { TusRequest } from './uploads.types';

@Injectable()
export class UploadsService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly channelsService: ChannelsService,
    private readonly videosService: VideosService,
    private readonly queueService: QueueService,
    private readonly dataSource: DataSource,
  ) {}

  generateStorageKey(): string {
    return `videos/${randomUUID()}`;
  }

  private async authenticate(req: TusRequest): Promise<string> {
    const authHeader = req.headers.authorization ?? '';
    if (!authHeader.startsWith(BEARER_PREFIX)) {
      throw { status_code: 401, body: 'Unauthorized' };
    }
    const token = authHeader.slice(BEARER_PREFIX.length);

    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token);
    } catch {
      throw { status_code: 401, body: 'Unauthorized' };
    }

    const channel = await this.channelsService.findByUserId(payload.sub);
    if (!channel) {
      throw { status_code: 401, body: 'Unauthorized' };
    }

    req.channelId = channel.id;
    return channel.id;
  }

  private async authorizeExistingUpload(
    storageKey: string,
    channelId: string,
  ): Promise<void> {
    const video = await this.videosService.findByStorageKey(storageKey);
    if (!video || video.channel_id !== channelId) {
      throw { status_code: 403, body: 'Forbidden' };
    }
  }

  async onIncomingRequest(
    req: TusRequest,
    _res: ServerResponse,
    uploadId: string,
  ): Promise<void> {
    const channelId = await this.authenticate(req);
    if (req.method !== 'POST') {
      await this.authorizeExistingUpload(uploadId, channelId);
    }
  }

  async onUploadCreate(
    req: TusRequest,
    res: ServerResponse,
    upload: Upload,
  ): Promise<{ res: ServerResponse }> {
    const filename = upload.metadata?.filename;
    if (!filename) {
      throw { status_code: 400, body: 'filename metadata is required' };
    }
    if (!req.channelId) {
      throw { status_code: 401, body: 'Unauthorized' };
    }

    await this.videosService.createDraft({
      channelId: req.channelId,
      title: filename,
      storageKey: upload.id,
    });

    return { res };
  }

  async onUploadFinish(
    _req: TusRequest,
    res: ServerResponse,
    upload: Upload,
  ): Promise<{ res: ServerResponse }> {
    await this.dataSource.transaction(async (manager) => {
      const video = await manager.findOne(Video, {
        where: { storage_key: upload.id },
      });
      if (!video) return;

      await this.videosService.markProcessing(
        video.id,
        upload.size ?? 0,
        manager,
      );
      await this.queueService.enqueueVideoProcessing(video.id, { manager });
    });

    return { res };
  }
}
