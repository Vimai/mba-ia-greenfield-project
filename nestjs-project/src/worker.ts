import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';
import { QueueService } from './queue/queue.service';
import { ProcessingService } from './processing/processing.service';
import { VideosService } from './videos/videos.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  const queueService = app.get(QueueService);
  const processingService = app.get(ProcessingService);
  const videosService = app.get(VideosService);
  const logger = new Logger('Worker');

  await queueService.workVideoProcessing(async (job) => {
    try {
      await processingService.processVideo(job.data.videoId);
    } catch (error) {
      const isLastAttempt = job.retryCount >= job.retryLimit;
      const message = error instanceof Error ? error.message : String(error);
      logger.error(
        `Job ${job.id} failed (attempt ${job.retryCount}/${job.retryLimit}): ${message}`,
      );

      if (isLastAttempt) {
        await videosService.markFailed(job.data.videoId, message);
        return;
      }
      throw error;
    }
  });

  logger.log('Video worker ready — waiting for jobs');
}
void bootstrap();
