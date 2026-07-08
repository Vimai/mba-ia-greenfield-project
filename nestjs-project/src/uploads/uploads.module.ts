import { Module } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Server } from '@tus/server';
import { S3Store } from '@tus/s3-store';
import { AuthModule } from '../auth/auth.module';
import { ChannelsModule } from '../channels/channels.module';
import storageConfig from '../config/storage.config';
import { QueueModule } from '../queue/queue.module';
import { VideosModule } from '../videos/videos.module';
import {
  MAX_UPLOAD_SIZE_BYTES,
  TUS_EXPIRATION_PERIOD_MS,
  TUS_PART_SIZE_BYTES,
  TUS_SERVER,
  UPLOADS_TUS_PATH,
} from './uploads.constants';
import { UploadsService } from './uploads.service';
import { generateUploadUrl, getUploadIdFromRequest } from './uploads.util';

@Module({
  imports: [AuthModule, ChannelsModule, VideosModule, QueueModule],
  providers: [
    UploadsService,
    {
      provide: TUS_SERVER,
      inject: [storageConfig.KEY, UploadsService],
      useFactory: (
        storage: ConfigType<typeof storageConfig>,
        uploadsService: UploadsService,
      ) =>
        new Server({
          path: UPLOADS_TUS_PATH,
          datastore: new S3Store({
            partSize: TUS_PART_SIZE_BYTES,
            s3ClientConfig: {
              bucket: storage.videosBucket,
              region: 'us-east-1',
              endpoint: storage.endpointInternal,
              forcePathStyle: true,
              credentials: {
                accessKeyId: storage.accessKey,
                secretAccessKey: storage.secretKey,
              },
            },
            expirationPeriodInMilliseconds: TUS_EXPIRATION_PERIOD_MS,
            useTags: true,
          }),
          maxSize: MAX_UPLOAD_SIZE_BYTES,
          respectForwardedHeaders: true,
          generateUrl: generateUploadUrl,
          getFileIdFromRequest: getUploadIdFromRequest,
          namingFunction: () => uploadsService.generateStorageKey(),
          onIncomingRequest: (req, res, uploadId) =>
            uploadsService.onIncomingRequest(req, res, uploadId),
          onUploadCreate: (req, res, upload) =>
            uploadsService.onUploadCreate(req, res, upload),
          onUploadFinish: (req, res, upload) =>
            uploadsService.onUploadFinish(req, res, upload),
        }),
    },
  ],
  exports: [TUS_SERVER],
})
export class UploadsModule {}
