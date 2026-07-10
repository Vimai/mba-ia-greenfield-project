import { Controller, Get, Inject, Param } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import type { ConfigType } from '@nestjs/config';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import type { JwtPayload } from '../auth/auth.types';
import { ApiErrorEnvelope } from '../common/openapi/api-error-envelope.dto';
import {
  VideoNotFoundException,
  VideoNotOwnedException,
  VideoNotReadyException,
} from '../common/exceptions/domain.exception';
import { ChannelsService } from '../channels/channels.service';
import storageConfig from '../config/storage.config';
import { StorageService } from '../storage/storage.service';
import { PresignedUrlResponseDto } from './dto/presigned-url-response.dto';
import { VideoStatusResponseDto } from './dto/video-status-response.dto';
import { VideoProcessingStatus } from './entities/video.entity';
import { VideosService } from './videos.service';

@ApiTags('videos')
@Controller('videos')
export class VideosController {
  constructor(
    private readonly videosService: VideosService,
    private readonly channelsService: ChannelsService,
    private readonly storageService: StorageService,
    @Inject(storageConfig.KEY)
    private readonly storage: ConfigType<typeof storageConfig>,
  ) {}

  @Get(':publicId/status')
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Get video processing status',
    description:
      "Returns the video's processing status and metadata. Only the owning channel's user may query it.",
  })
  @ApiParam({ name: 'publicId', example: 'Uakgb_J5m9j' })
  @ApiResponse({
    status: 200,
    description: 'Video status',
    type: VideoStatusResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 403,
    description: 'Video does not belong to the authenticated user',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async getStatus(
    @Param('publicId') publicId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<VideoStatusResponseDto> {
    const video = await this.videosService.findByPublicId(publicId);
    if (!video) {
      throw new VideoNotFoundException();
    }

    const channel = await this.channelsService.findByUserId(user.sub);
    if (!channel || channel.id !== video.channel_id) {
      throw new VideoNotOwnedException();
    }

    const thumbnailUrl = video.thumbnail_key
      ? await this.storageService.getPresignedGetUrl(
          this.storage.thumbnailsBucket,
          video.thumbnail_key,
        )
      : null;

    return {
      publicId: video.public_id,
      title: video.title,
      processingStatus: video.processing_status,
      durationSeconds: video.duration_seconds
        ? Number(video.duration_seconds)
        : null,
      width: video.width,
      height: video.height,
      thumbnailUrl,
    };
  }

  @Public()
  @Get(':publicId/stream-url')
  @ApiOperation({
    summary: 'Get a presigned streaming URL',
    description:
      'Issues a time-limited presigned GET URL direct from object storage, supporting HTTP Range requests. Requires the video to be ready.',
  })
  @ApiParam({ name: 'publicId', example: 'Uakgb_J5m9j' })
  @ApiResponse({
    status: 200,
    description: 'Presigned streaming URL',
    type: PresignedUrlResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Video is not ready yet',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async getStreamUrl(
    @Param('publicId') publicId: string,
  ): Promise<PresignedUrlResponseDto> {
    const video = await this.getReadyVideoOrThrow(publicId);
    const expiresInSeconds = this.storage.presignExpiresInSeconds;

    const url = await this.storageService.getPresignedGetUrl(
      this.storage.videosBucket,
      video.storage_key,
      { expiresInSeconds },
    );

    return { url, expiresInSeconds };
  }

  @Public()
  @Get(':publicId/download-url')
  @ApiOperation({
    summary: 'Get a presigned download URL',
    description:
      'Issues a time-limited presigned GET URL with an attachment content-disposition, direct from object storage. Requires the video to be ready.',
  })
  @ApiParam({ name: 'publicId', example: 'Uakgb_J5m9j' })
  @ApiResponse({
    status: 200,
    description: 'Presigned download URL',
    type: PresignedUrlResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Video is not ready yet',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async getDownloadUrl(
    @Param('publicId') publicId: string,
  ): Promise<PresignedUrlResponseDto> {
    const video = await this.getReadyVideoOrThrow(publicId);
    const expiresInSeconds = this.storage.presignExpiresInSeconds;

    const url = await this.storageService.getPresignedGetUrl(
      this.storage.videosBucket,
      video.storage_key,
      {
        expiresInSeconds,
        responseContentDisposition: `attachment; filename="${video.title}"`,
      },
    );

    return { url, expiresInSeconds };
  }

  private async getReadyVideoOrThrow(publicId: string) {
    const video = await this.videosService.findByPublicId(publicId);
    if (!video) {
      throw new VideoNotFoundException();
    }
    if (video.processing_status !== VideoProcessingStatus.READY) {
      throw new VideoNotReadyException();
    }
    return video;
  }
}
