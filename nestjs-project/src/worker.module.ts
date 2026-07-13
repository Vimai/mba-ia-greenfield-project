import { Module } from '@nestjs/common';
import { ConfigModule, ConfigType } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import appConfig from './config/app.config';
import databaseConfig from './config/database.config';
import storageConfig from './config/storage.config';
import { envValidationSchema } from './config/env.validation';
import { ChannelsModule } from './channels/channels.module';
import { ProcessingModule } from './processing/processing.module';
import { StorageModule } from './storage/storage.module';
import { UsersModule } from './users/users.module';
import { VideosModule } from './videos/videos.module';
import { QueueModule } from './queue/queue.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, databaseConfig, storageConfig],
      validationSchema: envValidationSchema,
      validationOptions: { allowUnknown: true, abortEarly: false },
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [databaseConfig.KEY],
      useFactory: (dbConfig: ConfigType<typeof databaseConfig>) => ({
        type: 'postgres',
        host: dbConfig.host,
        port: dbConfig.port,
        username: dbConfig.username,
        password: dbConfig.password,
        database: dbConfig.name,
        autoLoadEntities: true,
        synchronize: false,
      }),
    }),
    ChannelsModule,
    StorageModule,
    UsersModule,
    VideosModule,
    QueueModule,
    ProcessingModule,
  ],
})
export class WorkerModule {}
