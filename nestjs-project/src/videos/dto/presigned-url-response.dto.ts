import { ApiProperty } from '@nestjs/swagger';

export class PresignedUrlResponseDto {
  @ApiProperty({ example: 'https://minio.example/videos/...' })
  url: string;

  @ApiProperty({ example: 3600 })
  expiresInSeconds: number;
}
