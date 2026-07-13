import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import databaseConfig from '../config/database.config';
import { QueueModule } from './queue.module';

describe('QueueModule', () => {
  it('should compile successfully', async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [databaseConfig] }),
        QueueModule,
      ],
    }).compile();

    expect(module).toBeDefined();
  }, 15000);
});
