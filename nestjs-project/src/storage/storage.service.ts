import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  type HeadObjectCommandOutput,
} from '@aws-sdk/client-s3';
import type { StreamingBlobPayloadInputTypes } from '@smithy/types';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Readable } from 'stream';
import storageConfig from '../config/storage.config';
import { STORAGE_CLIENTS } from './storage.constants';

export interface GetPresignedGetUrlOptions {
  expiresInSeconds?: number;
  responseContentDisposition?: string;
  responseContentType?: string;
}

@Injectable()
export class StorageService {
  constructor(
    @Inject(STORAGE_CLIENTS.INTERNAL)
    private readonly internalClient: S3Client,
    @Inject(STORAGE_CLIENTS.PUBLIC)
    private readonly publicClient: S3Client,
    @Inject(storageConfig.KEY)
    private readonly config: ConfigType<typeof storageConfig>,
  ) {}

  async putObject(
    bucket: string,
    key: string,
    body: StreamingBlobPayloadInputTypes,
  ): Promise<void> {
    await this.internalClient.send(
      new PutObjectCommand({ Bucket: bucket, Key: key, Body: body }),
    );
  }

  async getObjectStream(bucket: string, key: string): Promise<Readable> {
    const result = await this.internalClient.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    return result.Body as Readable;
  }

  async headObject(
    bucket: string,
    key: string,
  ): Promise<HeadObjectCommandOutput> {
    return this.internalClient.send(
      new HeadObjectCommand({ Bucket: bucket, Key: key }),
    );
  }

  async deleteObject(bucket: string, key: string): Promise<void> {
    await this.internalClient.send(
      new DeleteObjectCommand({ Bucket: bucket, Key: key }),
    );
  }

  async getPresignedGetUrl(
    bucket: string,
    key: string,
    options: GetPresignedGetUrlOptions = {},
  ): Promise<string> {
    const expiresIn =
      options.expiresInSeconds ?? this.config.presignExpiresInSeconds;

    return getSignedUrl(
      this.publicClient,
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        ResponseContentDisposition: options.responseContentDisposition,
        ResponseContentType: options.responseContentType,
      }),
      { expiresIn },
    );
  }
}
