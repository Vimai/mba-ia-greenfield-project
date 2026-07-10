import { ApiProperty } from '@nestjs/swagger';
import { VideoProcessingStatus } from '../entities/video.entity';

export class VideoStatusResponseDto {
  @ApiProperty({ example: 'Uakgb_J5m9j' })
  publicId: string;

  @ApiProperty({ example: 'my-video.mp4' })
  title: string;

  @ApiProperty({ enum: VideoProcessingStatus, example: VideoProcessingStatus.READY })
  processingStatus: VideoProcessingStatus;

  @ApiProperty({ nullable: true, example: 12.5 })
  durationSeconds: number | null;

  @ApiProperty({ nullable: true, example: 1920 })
  width: number | null;

  @ApiProperty({ nullable: true, example: 1080 })
  height: number | null;

  @ApiProperty({ nullable: true, example: 'https://minio.example/thumbnails/...' })
  thumbnailUrl: string | null;
}
