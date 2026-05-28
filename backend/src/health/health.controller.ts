import { Controller, Get, Inject } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS } from '../redis/redis.module';

@Controller('health')
export class HealthController {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  @Get()
  async check() {
    const start = Date.now();
    const pong = await this.redis.ping();
    return {
      ok: pong === 'PONG',
      redisLatencyMs: Date.now() - start,
      uptimeSec: Math.round(process.uptime()),
    };
  }
}
