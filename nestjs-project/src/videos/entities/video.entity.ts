import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Channel } from '../../channels/entities/channel.entity';

export const VIDEO_PUBLIC_ID_UNIQUE_CONSTRAINT = 'UQ_video_public_id';
export const VIDEO_STORAGE_KEY_UNIQUE_CONSTRAINT = 'UQ_video_storage_key';

export enum VideoStatus {
  DRAFT = 'draft',
}

export enum VideoProcessingStatus {
  UPLOADING = 'uploading',
  PROCESSING = 'processing',
  READY = 'ready',
  FAILED = 'failed',
}

@Entity('videos')
@Unique(VIDEO_PUBLIC_ID_UNIQUE_CONSTRAINT, ['public_id'])
@Unique(VIDEO_STORAGE_KEY_UNIQUE_CONSTRAINT, ['storage_key'])
export class Video {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 21 })
  public_id: string;

  @Index()
  @Column({ type: 'uuid' })
  channel_id: string;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({
    type: 'enum',
    enum: VideoStatus,
    default: VideoStatus.DRAFT,
  })
  status: VideoStatus;

  @Column({
    type: 'enum',
    enum: VideoProcessingStatus,
    default: VideoProcessingStatus.UPLOADING,
  })
  processing_status: VideoProcessingStatus;

  @Column({ type: 'varchar', length: 512 })
  storage_key: string;

  @Column({ type: 'varchar', length: 512, nullable: true })
  thumbnail_key: string | null;

  @Column({ type: 'bigint', nullable: true })
  size_bytes: string | null;

  @Column({ type: 'numeric', precision: 10, scale: 3, nullable: true })
  duration_seconds: string | null;

  @Column({ type: 'int', nullable: true })
  width: number | null;

  @Column({ type: 'int', nullable: true })
  height: number | null;

  @Column({ type: 'text', nullable: true })
  processing_error: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @ManyToOne(() => Channel)
  @JoinColumn({ name: 'channel_id' })
  channel: Channel;
}
