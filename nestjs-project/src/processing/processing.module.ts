import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { VideosModule } from '../videos/videos.module';
import { FfmpegService } from './ffmpeg.service';
import { ProcessingService } from './processing.service';

@Module({
  imports: [StorageModule, VideosModule],
  providers: [FfmpegService, ProcessingService],
  exports: [ProcessingService],
})
export class ProcessingModule {}
