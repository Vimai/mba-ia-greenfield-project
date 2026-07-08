import { Module } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { S3Client } from '@aws-sdk/client-s3';
import storageConfig from '../config/storage.config';
import { StorageService } from './storage.service';
import { STORAGE_CLIENTS } from './storage.constants';

@Module({
  providers: [
    {
      provide: STORAGE_CLIENTS.INTERNAL,
      inject: [storageConfig.KEY],
      useFactory: (config: ConfigType<typeof storageConfig>) =>
        new S3Client({
          region: 'us-east-1',
          endpoint: config.endpointInternal,
          forcePathStyle: true,
          credentials: {
            accessKeyId: config.accessKey,
            secretAccessKey: config.secretKey,
          },
        }),
    },
    {
      provide: STORAGE_CLIENTS.PUBLIC,
      inject: [storageConfig.KEY],
      useFactory: (config: ConfigType<typeof storageConfig>) =>
        new S3Client({
          region: 'us-east-1',
          endpoint: config.endpointPublic,
          forcePathStyle: true,
          credentials: {
            accessKeyId: config.accessKey,
            secretAccessKey: config.secretKey,
          },
        }),
    },
    StorageService,
  ],
  exports: [StorageService],
})
export class StorageModule {}
