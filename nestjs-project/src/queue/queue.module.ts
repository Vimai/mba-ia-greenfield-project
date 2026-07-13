import { Inject, Logger, Module } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import PgBoss from 'pg-boss';
import databaseConfig from '../config/database.config';
import { PG_BOSS, QUEUE_NAMES } from './queue.constants';
import { QueueService } from './queue.service';

@Module({
  providers: [
    {
      provide: PG_BOSS,
      inject: [databaseConfig.KEY],
      useFactory: (config: ConfigType<typeof databaseConfig>) => {
        const boss = new PgBoss({
          host: config.host,
          port: config.port,
          user: config.username,
          password: config.password,
          database: config.name,
        });
        boss.on('error', (error) => Logger.error(error, undefined, 'PgBoss'));
        return boss;
      },
    },
    QueueService,
  ],
  exports: [QueueService],
})
export class QueueModule implements OnModuleInit, OnModuleDestroy {
  constructor(@Inject(PG_BOSS) private readonly boss: PgBoss) {}

  async onModuleInit(): Promise<void> {
    await this.boss.start();
    await this.boss.createQueue(QUEUE_NAMES.VIDEO_PROCESSING);
  }

  async onModuleDestroy(): Promise<void> {
    await this.boss.stop();
  }
}
