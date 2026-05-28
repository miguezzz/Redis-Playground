import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS } from '../redis/redis.module';
import { QueueService } from '../queue/queue.service';
import { EventsService } from '../events/events.service';

const SEAT_LOCK_TTL_MS = 30_000;

export interface HeldSeat {
  seatId: string;
  ticketId: string;
  expiresAt: number;
}

@Injectable()
export class SeatsService {
  private readonly logger = new Logger('Seats');

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly queue: QueueService,
    private readonly events: EventsService,
  ) {}

  private soldKey(showId: string) {
    return `sold:show:${showId}`;
  }
  private lockKey(showId: string, seatId: string) {
    return `lock:seat:${showId}:${seatId}`;
  }
  private heldIndexKey(showId: string) {
    return `held:show:${showId}`;
  }
  private heldOwnerKey(showId: string, seatId: string) {
    return `held-by:${showId}:${seatId}`;
  }

  async state(showId: string) {
    const sold = await this.redis.smembers(this.soldKey(showId));
    return { sold };
  }

  async hold(showId: string, ticketId: string, seatId: string) {
    if (!(await this.queue.isActive(showId, ticketId))) {
      this.logger.warn(`hold rejected — ticket ${ticketId} not in session`);
      throw new ForbiddenException('not in purchase session');
    }
    if (await this.redis.sismember(this.soldKey(showId), seatId)) {
      throw new ConflictException('seat already sold');
    }
    const ok = await this.redis.set(
      this.lockKey(showId, seatId),
      ticketId,
      'PX',
      SEAT_LOCK_TTL_MS,
      'NX',
    );
    if (!ok) {
      const owner = await this.redis.get(this.lockKey(showId, seatId));
      if (owner !== ticketId) {
        this.logger.warn(`hold conflict on ${seatId} — owned by ${owner}`);
        await this.events.emit(showId, 'seat.hold-conflict', {
          ticketId,
          seatId,
          detail: `owner=${owner}`,
        });
        throw new ConflictException('seat held by another');
      }
    }
    const expiresAt = Date.now() + SEAT_LOCK_TTL_MS;
    await Promise.all([
      this.redis.zadd(this.heldIndexKey(showId), expiresAt, seatId),
      this.redis.set(
        this.heldOwnerKey(showId, seatId),
        ticketId,
        'PX',
        SEAT_LOCK_TTL_MS,
      ),
    ]);
    this.logger.log(`HOLD  ${seatId} ← ${ticketId} (ttl ${SEAT_LOCK_TTL_MS}ms)`);
    await this.events.emit(showId, 'seat.hold', { ticketId, seatId });
    return { ok: true, expiresInMs: SEAT_LOCK_TTL_MS };
  }

  async release(showId: string, ticketId: string, seatId: string) {
    const owner = await this.redis.get(this.lockKey(showId, seatId));
    if (owner === ticketId) {
      await Promise.all([
        this.redis.del(this.lockKey(showId, seatId)),
        this.redis.zrem(this.heldIndexKey(showId), seatId),
        this.redis.del(this.heldOwnerKey(showId, seatId)),
      ]);
      this.logger.log(`FREE  ${seatId} ← ${ticketId}`);
      await this.events.emit(showId, 'seat.release', { ticketId, seatId });
    }
    return { ok: true };
  }

  async confirm(showId: string, ticketId: string, seatId: string) {
    if (!(await this.queue.isActive(showId, ticketId))) {
      throw new ForbiddenException('not in purchase session');
    }
    const owner = await this.redis.get(this.lockKey(showId, seatId));
    if (owner !== ticketId) {
      this.logger.warn(`confirm failed — lock for ${seatId} lost`);
      throw new ConflictException('lock lost');
    }
    if (await this.redis.sismember(this.soldKey(showId), seatId)) {
      throw new ConflictException('seat already sold');
    }
    const tx = this.redis.multi();
    tx.sadd(this.soldKey(showId), seatId);
    tx.del(this.lockKey(showId, seatId));
    tx.zrem(this.heldIndexKey(showId), seatId);
    tx.del(this.heldOwnerKey(showId, seatId));
    await tx.exec();
    await this.queue.release(showId, ticketId);
    this.logger.log(`SOLD  ${seatId} → ${ticketId}`);
    await this.events.emit(showId, 'seat.sold', { ticketId, seatId });
    return { ok: true, seatId };
  }

  async listHeld(showId: string): Promise<HeldSeat[]> {
    const now = Date.now();
    await this.redis.zremrangebyscore(this.heldIndexKey(showId), '-inf', now);
    const entries = await this.redis.zrange(
      this.heldIndexKey(showId),
      0,
      -1,
      'WITHSCORES',
    );
    if (entries.length === 0) return [];
    const result: HeldSeat[] = [];
    const pipeline = this.redis.pipeline();
    const seatIds: string[] = [];
    const expiries: number[] = [];
    for (let i = 0; i < entries.length; i += 2) {
      seatIds.push(entries[i]);
      expiries.push(Number(entries[i + 1]));
      pipeline.get(this.heldOwnerKey(showId, entries[i]));
    }
    const owners = await pipeline.exec();
    for (let i = 0; i < seatIds.length; i++) {
      const owner = (owners?.[i]?.[1] as string | null) || 'expired';
      result.push({
        seatId: seatIds[i],
        ticketId: owner,
        expiresAt: expiries[i],
      });
    }
    return result;
  }
}
