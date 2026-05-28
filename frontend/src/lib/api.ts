const base = '/api';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(base + path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) throw new Error((await res.text()) || res.statusText);
  return res.json();
}

export interface Show {
  id: string;
  name: string;
  rows: number;
  cols: number;
}

export interface ShowDetail extends Show {
  seats: string[];
}

export const api = {
  listShows: () => req<Show[]>('/shows'),
  getShow: (id: string) => req<ShowDetail>(`/shows/${id}`),
  joinQueue: (showId: string) =>
    req<{ ticketId: string }>(`/queue/${showId}/join`, { method: 'POST' }),
  queueStatus: (showId: string, ticketId: string) =>
    req<{
      state: 'waiting' | 'active' | 'unknown';
      position?: number;
      total?: number;
      expiresAt?: number;
    }>(`/queue/${showId}/${ticketId}`),
  leaveQueue: (showId: string, ticketId: string) =>
    req<{ ok: boolean }>(`/queue/${showId}/${ticketId}`, { method: 'DELETE' }),
  seatsState: (showId: string) =>
    req<{ sold: string[] }>(`/seats/${showId}`),
  holdSeat: (showId: string, ticketId: string, seatId: string) =>
    req<{ ok: boolean; expiresInMs: number }>(`/seats/${showId}/hold`, {
      method: 'POST',
      body: JSON.stringify({ ticketId, seatId }),
    }),
  releaseSeat: (showId: string, ticketId: string, seatId: string) =>
    req<{ ok: boolean }>(`/seats/${showId}/release`, {
      method: 'POST',
      body: JSON.stringify({ ticketId, seatId }),
    }),
  confirmSeat: (showId: string, ticketId: string, seatId: string) =>
    req<{ ok: boolean; seatId: string }>(`/seats/${showId}/confirm`, {
      method: 'POST',
      body: JSON.stringify({ ticketId, seatId }),
    }),
  adminState: (showId: string) =>
    req<AdminState>(`/admin/state/${showId}`),
  adminReset: (showId: string) =>
    req<{ ok: boolean }>(`/admin/reset/${showId}`, { method: 'POST' }),
};

export interface DomainEvent {
  id: string;
  ts: number;
  action:
    | 'queue.join'
    | 'queue.leave'
    | 'queue.admit'
    | 'queue.release'
    | 'seat.hold'
    | 'seat.hold-conflict'
    | 'seat.release'
    | 'seat.sold';
  showId: string;
  ticketId?: string;
  seatId?: string;
  detail?: string;
}

export interface AdminState {
  showId: string;
  now: number;
  waiting: { ticketId: string; joinedAt: number }[];
  active: { ticketId: string; expiresAt: number }[];
  held: { seatId: string; ticketId: string; expiresAt: number }[];
  sold: string[];
  events: DomainEvent[];
}
