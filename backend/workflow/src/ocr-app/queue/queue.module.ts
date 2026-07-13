import { BullModule } from '@nestjs/bullmq';
import { Global, Logger, Module, OnModuleInit } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import IORedis from 'ioredis';
import { QUEUES } from '../common/constants';

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('redis.host'),
          port: config.get<number>('redis.port'),
          password: config.get<string>('redis.password'),
          // Required by BullMQ blocking commands
          maxRetriesPerRequest: null,
          enableReadyCheck: true,
        },
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5_000 },
          removeOnComplete: { age: 24 * 3600, count: 1000 },
          removeOnFail: { age: 7 * 24 * 3600 },
        },
      }),
    }),
    BullModule.registerQueue({ name: QUEUES.UPLOAD }, { name: QUEUES.OCR }),
  ],
  exports: [BullModule],
})
export class QueueModule implements OnModuleInit {
  private readonly logger = new Logger(QueueModule.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * Ping Redis on boot and log a clear success / failure so misconfigurations
   * don't silently leave the workers idle.
   */
  async onModuleInit(): Promise<void> {
    const host = this.config.get<string>('redis.host') ?? 'localhost';
    const port = this.config.get<number>('redis.port') ?? 6379;
    const password = this.config.get<string>('redis.password');

    const probe = new IORedis({
      host,
      port,
      password,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });

    try {
      await probe.connect();
      const pong = await probe.ping();
      this.logger.log(`Redis connection OK at ${host}:${port} (PING -> ${pong})`);
    } catch (err) {
      this.logger.error(
        `Redis connection FAILED at ${host}:${port}: ${(err as Error).message}`,
      );
      this.logger.error(
        'BullMQ workers will not consume jobs until Redis is reachable. ' +
          'Run `docker compose up -d redis` (or start your local Redis) and restart the API.',
      );
    } finally {
      probe.disconnect();
    }
  }
}
