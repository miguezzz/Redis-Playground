import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS } from '../redis/redis.module';

export type EventAction =
  | 'queue.join'
  | 'queue.leave'
  | 'queue.admit'
  | 'queue.release'
  | 'seat.hold'
  | 'seat.hold-conflict'
  | 'seat.release'
  | 'seat.sold';

export interface DomainEvent {
  id: string;
  ts: number;
  action: EventAction;
  showId: string;
  ticketId?: string;
  seatId?: string;
  detail?: string;
}

const STREAM_MAXLEN = 5000;

@Injectable()
export class EventsService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  private streamKey(showId: string) {
    return `events:show:${showId}`;
  }

  async emit(
    showId: string,
    action: EventAction,
    fields: { ticketId?: string; seatId?: string; detail?: string } = {},
  ) {
    const args: string[] = ['action', action];
    if (fields.ticketId) args.push('ticketId', fields.ticketId);
    if (fields.seatId) args.push('seatId', fields.seatId);
    if (fields.detail) args.push('detail', fields.detail);
    await this.redis.xadd(
      this.streamKey(showId),
      'MAXLEN',
      '~',
      String(STREAM_MAXLEN),
      '*',
      ...args,
    );
  }

  async recent(showId: string, limit = 100): Promise<DomainEvent[]> {
    const raw = await this.redis.xrevrange(
      this.streamKey(showId),
      '+',
      '-',
      'COUNT',
      limit,
    );
    return raw.map((entry) => {
      const [id, fields] = entry as [string, string[]];
      const map: Record<string, string> = {};
      for (let i = 0; i < fields.length; i += 2) {
        map[fields[i]] = fields[i + 1];
      }
      const tsPart = id.split('-')[0];
      return {
        id,
        ts: Number(tsPart),
        action: map.action as EventAction,
        showId,
        ticketId: map.ticketId,
        seatId: map.seatId,
        detail: map.detail,
      };
    });
  }

  async clear(showId: string) {
    await this.redis.del(this.streamKey(showId));
  }
}
