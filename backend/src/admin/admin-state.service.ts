import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS } from '../redis/redis.module';
import { QueueService } from '../queue/queue.service';
import { SeatsService, HeldSeat } from '../seats/seats.service';
import { DomainEvent, EventsService } from '../events/events.service';

export interface AdminState {
  showId: string;
  now: number;
  waiting: { ticketId: string; joinedAt: number }[];
  active: { ticketId: string; expiresAt: number }[];
  held: HeldSeat[];
  sold: string[];
  events: DomainEvent[];
}

@Injectable()
export class AdminStateService {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly queue: QueueService,
    private readonly seats: SeatsService,
    private readonly events: EventsService,
  ) {}

  async snapshot(showId: string): Promise<AdminState> {
    const [waiting, active, held, soldState, events] = await Promise.all([
      this.queue.listWaiting(showId),
      this.queue.listActive(showId),
      this.seats.listHeld(showId),
      this.seats.state(showId),
      this.events.recent(showId, 50),
    ]);
    return {
      showId,
      now: Date.now(),
      waiting,
      active,
      held,
      sold: soldState.sold,
      events,
    };
  }

  async resetShow(showId: string) {
    const keys = [
      `waiting:show:${showId}`,
      `active:show:${showId}`,
      `held:show:${showId}`,
      `sold:show:${showId}`,
      `events:show:${showId}`,
    ];
    await this.redis.del(...keys);
    const lockKeys = await this.redis.keys(`lock:seat:${showId}:*`);
    const ownerKeys = await this.redis.keys(`held-by:${showId}:*`);
    const allEphemeral = [...lockKeys, ...ownerKeys];
    if (allEphemeral.length) await this.redis.del(...allEphemeral);
  }
}
