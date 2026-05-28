import { useEffect, useState } from 'react';
import { AdminState, DomainEvent, Show, api } from '../lib/api';
import { getSocket } from '../lib/socket';

interface Props {
  shows: Show[];
  onBack: () => void;
}

export function Admin({ shows, onBack }: Props) {
  const [showId, setShowId] = useState<string>(shows[0]?.id ?? '');
  const [state, setState] = useState<AdminState | null>(null);

  useEffect(() => {
    if (!showId) return;
    api.adminState(showId).then(setState).catch(console.error);
    const socket = getSocket();
    const evt = `admin-state:${showId}`;
    const handler = (payload: AdminState) => setState(payload);
    socket.on(evt, handler);
    return () => {
      socket.off(evt, handler);
    };
  }, [showId]);

  const reset = async () => {
    if (!confirm('Apagar fila, sessões, holds e vendidos desse show?')) return;
    await api.adminReset(showId);
    const fresh = await api.adminState(showId);
    setState(fresh);
  };

  if (!showId) return <div className="card">Sem shows.</div>;

  return (
    <div className="card admin">
      <div className="admin-header">
        <div>
          <h2>Dashboard</h2>
          <select value={showId} onChange={(e) => setShowId(e.target.value)}>
            {shows.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="admin-actions">
          <a
            className="link-btn"
            href="/admin/queues"
            target="_blank"
            rel="noreferrer"
          >
            Bull Board ↗
          </a>
          <button className="secondary" onClick={reset}>
            Reset show
          </button>
          <button className="secondary" onClick={onBack}>
            Voltar
          </button>
        </div>
      </div>

      {!state && <p>Aguardando primeiro tick…</p>}
      {state && (
        <div className="admin-grid">
          <section>
            <h3>
              Fila <span className="count">{state.waiting.length}</span>
            </h3>
            {state.waiting.length === 0 && <p className="muted">Vazia</p>}
            <ul>
              {state.waiting.map((w, i) => (
                <li key={w.ticketId}>
                  <span className="pos">#{i + 1}</span>
                  <code>{w.ticketId}</code>
                  <span className="muted">
                    {formatAge(state.now - w.joinedAt)} esperando
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h3>
              Sessões ativas <span className="count">{state.active.length}</span>
            </h3>
            {state.active.length === 0 && <p className="muted">Ninguém comprando</p>}
            <ul>
              {state.active.map((a) => {
                const ms = Math.max(0, a.expiresAt - state.now);
                return (
                  <li key={a.ticketId}>
                    <code>{a.ticketId}</code>
                    <span className={ms < 10_000 ? 'badge warn' : 'badge'}>
                      {Math.round(ms / 1000)}s
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>

          <section>
            <h3>
              Locks de assento <span className="count">{state.held.length}</span>
            </h3>
            {state.held.length === 0 && <p className="muted">Nenhum lock ativo</p>}
            <ul>
              {state.held.map((h) => {
                const ms = Math.max(0, h.expiresAt - state.now);
                return (
                  <li key={h.seatId}>
                    <span className="seat-tag">{h.seatId}</span>
                    <code>{h.ticketId}</code>
                    <span className={ms < 5_000 ? 'badge warn' : 'badge'}>
                      {Math.round(ms / 1000)}s
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>

          <section>
            <h3>
              Vendidos <span className="count">{state.sold.length}</span>
            </h3>
            {state.sold.length === 0 && <p className="muted">Nenhuma venda ainda</p>}
            <div className="sold-grid">
              {state.sold.map((s) => (
                <span className="seat-tag sold" key={s}>
                  {s}
                </span>
              ))}
            </div>
          </section>

          <section className="timeline-section">
            <h3>
              Timeline (Redis Streams){' '}
              <span className="count">{state.events.length}</span>
            </h3>
            {state.events.length === 0 && (
              <p className="muted">Nenhum evento ainda</p>
            )}
            <ul className="timeline">
              {state.events.map((e) => (
                <EventRow key={e.id} e={e} />
              ))}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}

function EventRow({ e }: { e: DomainEvent }) {
  const time = new Date(e.ts).toLocaleTimeString('pt-BR', { hour12: false });
  return (
    <li className={`event ${actionClass(e.action)}`}>
      <span className="event-time">{time}</span>
      <span className={`event-tag ${actionClass(e.action)}`}>{e.action}</span>
      {e.seatId && <span className="seat-tag small">{e.seatId}</span>}
      {e.ticketId && <code>{e.ticketId}</code>}
      {e.detail && <span className="muted">· {e.detail}</span>}
    </li>
  );
}

function actionClass(a: DomainEvent['action']) {
  if (a.startsWith('seat.sold')) return 'good';
  if (a.includes('conflict')) return 'bad';
  if (a.startsWith('queue.admit')) return 'accent';
  return '';
}

function formatAge(ms: number) {
  if (ms < 1000) return '<1s';
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return `${Math.round(ms / 60_000)}m`;
}
