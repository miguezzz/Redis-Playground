import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { nanoid } from 'nanoid';
import { REDIS } from '../redis/redis.module';
import { EventsService } from '../events/events.service';

const ADMIT_LUA = `
-- KEYS[1] = waiting zset (score=join timestamp)
-- KEYS[2] = active zset (score=session expiry timestamp ms)
-- ARGV[1] = max capacity
-- ARGV[2] = now ms
-- ARGV[3] = session ttl ms

redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', ARGV[2])

local maxCap = tonumber(ARGV[1])
local now = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])
local admitted = {}
local active = tonumber(redis.call('ZCARD', KEYS[2]))

while active < maxCap do
  local popped = redis.call('ZPOPMIN', KEYS[1], 1)
  if #popped == 0 then break end
  local ticketId = popped[1]
  redis.call('ZADD', KEYS[2], now + ttl, ticketId)
  table.insert(admitted, ticketId)
  active = active + 1
end

return admitted
`;

export interface QueueStatus {
  state: 'waiting' | 'active' | 'unknown';
  position?: number;
  total?: number;
  expiresAt?: number;
}

@Injectable()
export class QueueService implements OnModuleInit {
  private readonly logger = new Logger('Queue');
  private readonly capacity = Number(process.env.QUEUE_CAPACITY) || 3;
  private readonly sessionTtlMs = Number(process.env.SESSION_TTL_MS) || 60000;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly events: EventsService,
  ) {}

  async onModuleInit() {
    this.redis.defineCommand('admitFromQueue', {
      numberOfKeys: 2,
      lua: ADMIT_LUA,
    });
  }

  private waitingKey(showId: string) {
    return `waiting:show:${showId}`;
  }

  private activeKey(showId: string) {
    return `active:show:${showId}`;
  }

  async join(showId: string): Promise<{ ticketId: string }> {
    const ticketId = nanoid(10);
    await this.redis.zadd(this.waitingKey(showId), Date.now(), ticketId);
    this.logger.log(`JOIN  ${ticketId} → show:${showId}`);
    await this.events.emit(showId, 'queue.join', { ticketId });
    return { ticketId };
  }

  async status(showId: string, ticketId: string): Promise<QueueStatus> {
    const [activeScore, waitRank, waitTotal] = await Promise.all([
      this.redis.zscore(this.activeKey(showId), ticketId),
      this.redis.zrank(this.waitingKey(showId), ticketId),
      this.redis.zcard(this.waitingKey(showId)),
    ]);
    if (activeScore !== null) {
      return { state: 'active', expiresAt: Number(activeScore) };
    }
    if (waitRank !== null) {
      return { state: 'waiting', position: waitRank + 1, total: waitTotal };
    }
    return { state: 'unknown' };
  }

  async leave(showId: string, ticketId: string) {
    await Promise.all([
      this.redis.zrem(this.waitingKey(showId), ticketId),
      this.redis.zrem(this.activeKey(showId), ticketId),
    ]);
    this.logger.log(`LEAVE ${ticketId} ← show:${showId}`);
    await this.events.emit(showId, 'queue.leave', { ticketId });
  }

  async release(showId: string, ticketId: string) {
    await this.redis.zrem(this.activeKey(showId), ticketId);
    this.logger.log(`DONE  ${ticketId} ← show:${showId}`);
    await this.events.emit(showId, 'queue.release', { ticketId });
  }

  async admit(showId: string): Promise<string[]> {
    const now = Date.now();
    const res = await (this.redis as any).admitFromQueue(
      this.waitingKey(showId),
      this.activeKey(showId),
      this.capacity,
      now,
      this.sessionTtlMs,
    );
    const admitted = res as string[];
    for (const t of admitted) {
      this.logger.log(`ADMIT ${t} → session ${this.sessionTtlMs}ms`);
      await this.events.emit(showId, 'queue.admit', {
        ticketId: t,
        detail: `${this.sessionTtlMs}ms`,
      });
    }
    return admitted;
  }

  async listWaitingTicketIds(showId: string): Promise<string[]> {
    return this.redis.zrange(this.waitingKey(showId), 0, -1);
  }

  async listWaiting(
    showId: string,
  ): Promise<{ ticketId: string; joinedAt: number }[]> {
    const raw = await this.redis.zrange(
      this.waitingKey(showId),
      0,
      -1,
      'WITHSCORES',
    );
    const out: { ticketId: string; joinedAt: number }[] = [];
    for (let i = 0; i < raw.length; i += 2) {
      out.push({ ticketId: raw[i], joinedAt: Number(raw[i + 1]) });
    }
    return out;
  }

  async listActive(
    showId: string,
  ): Promise<{ ticketId: string; expiresAt: number }[]> {
    const raw = await this.redis.zrange(
      this.activeKey(showId),
      0,
      -1,
      'WITHSCORES',
    );
    const out: { ticketId: string; expiresAt: number }[] = [];
    for (let i = 0; i < raw.length; i += 2) {
      out.push({ ticketId: raw[i], expiresAt: Number(raw[i + 1]) });
    }
    return out;
  }

  async isActive(showId: string, ticketId: string): Promise<boolean> {
    return (await this.redis.zscore(this.activeKey(showId), ticketId)) !== null;
  }
}
