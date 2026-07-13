import { registerAs } from '@nestjs/config';

export default registerAs('storage', () => ({
  endpointInternal: process.env.STORAGE_ENDPOINT_INTERNAL!,
  endpointPublic: process.env.STORAGE_ENDPOINT_PUBLIC!,
  accessKey: process.env.STORAGE_ACCESS_KEY!,
  secretKey: process.env.STORAGE_SECRET_KEY!,
  videosBucket: process.env.STORAGE_VIDEOS_BUCKET!,
  thumbnailsBucket: process.env.STORAGE_THUMBNAILS_BUCKET!,
  presignExpiresInSeconds: parseInt(
    process.env.STORAGE_PRESIGN_EXPIRES_SECONDS || '3600',
    10,
  ),
}));
