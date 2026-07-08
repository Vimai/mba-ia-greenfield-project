import { Inject, Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import PgBoss from 'pg-boss';
import { PG_BOSS, QUEUE_NAMES, VIDEO_PROCESSING_RETRY_LIMIT } from './queue.constants';

export interface EnqueueVideoProcessingOptions {
  manager?: EntityManager;
}

@Injectable()
export class QueueService {
  constructor(@Inject(PG_BOSS) private readonly boss: PgBoss) {}

  async enqueueVideoProcessing(
    videoId: string,
    options: EnqueueVideoProcessingOptions = {},
  ): Promise<string | null> {
    const db = options.manager
      ? {
          executeSql: (text: string, values?: unknown[]) =>
            options
              .manager!.query(text, values)
              .then((rows: unknown[]) => ({ rows })),
        }
      : undefined;

    return this.boss.send(
      QUEUE_NAMES.VIDEO_PROCESSING,
      { videoId },
      { retryLimit: VIDEO_PROCESSING_RETRY_LIMIT, db },
    );
  }
}
