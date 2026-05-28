import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { RedisModule } from './redis/redis.module';
import { EventsModule } from './events/events.module';
import { QueueModule } from './queue/queue.module';
import { SeatsModule } from './seats/seats.module';
import { ShowsModule } from './shows/shows.module';
import { AdminModule } from './admin/admin.module';
import { HealthModule } from './health/health.module';
import { redisUrlToBullConnection } from './redis/redis-url';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    BullModule.forRoot({
      connection: redisUrlToBullConnection(
        process.env.REDIS_URL || 'redis://localhost:6379',
      ),
    }),
    RedisModule,
    EventsModule,
    ShowsModule,
    QueueModule,
    SeatsModule,
    AdminModule,
    HealthModule,
  ],
})
export class AppModule {}
