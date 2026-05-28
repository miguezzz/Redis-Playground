import { useEffect, useMemo, useState } from 'react';
import { api, ShowDetail } from '../lib/api';
import { getSocket } from '../lib/socket';

interface Props {
  show: ShowDetail;
  ticketId: string;
  onConfirmed: (seatId: string) => void;
  onLeave: () => void;
}

type SeatState = 'free' | 'held' | 'sold';

export function Seats({ show, ticketId, onConfirmed, onLeave }: Props) {
  const [seatState, setSeatState] = useState<Record<string, SeatState>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState(60);
  const [error, setError] = useState<string | null>(null);

  const grid = useMemo(() => {
    const rows: string[][] = [];
    for (let r = 0; r < show.rows; r++) {
      const letter = String.fromCharCode(65 + r);
      const row: string[] = [];
      for (let c = 1; c <= show.cols; c++) row.push(`${letter}${c}`);
      rows.push(row);
    }
    return rows;
  }, [show]);

  useEffect(() => {
    api.seatsState(show.id).then((s) => {
      const next: Record<string, SeatState> = {};
      s.sold.forEach((id) => (next[id] = 'sold'));
      setSeatState((prev) => ({ ...prev, ...next }));
    });

    const socket = getSocket();
    const evt = `seats:${show.id}`;
    const onUpdate = (payload: { seatId: string; state: SeatState }) => {
      setSeatState((prev) => ({ ...prev, [payload.seatId]: payload.state }));
    };
    socket.on(evt, onUpdate);
    return () => {
      socket.off(evt, onUpdate);
    };
  }, [show.id]);

  useEffect(() => {
    const t = setInterval(() => setTimeLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (timeLeft === 0) onLeave();
  }, [timeLeft, onLeave]);

  const pick = async (seatId: string) => {
    setError(null);
    if (seatState[seatId] === 'sold') return;
    if (selected && selected !== seatId) {
      api.releaseSeat(show.id, ticketId, selected).catch(() => {});
    }
    try {
      await api.holdSeat(show.id, ticketId, seatId);
      setSelected(seatId);
    } catch (e: any) {
      setError(e.message || 'Falhou');
    }
  };

  const confirm = async () => {
    if (!selected) return;
    try {
      const res = await api.confirmSeat(show.id, ticketId, selected);
      onConfirmed(res.seatId);
    } catch (e: any) {
      setError(e.message || 'Falhou');
    }
  };

  return (
    <div className="card">
      <div className="seats-header">
        <h2>{show.name}</h2>
        <div className={`timer ${timeLeft < 10 ? 'warn' : ''}`}>
          {timeLeft}s pra escolher
        </div>
      </div>
      <div className="screen">TELA</div>
      <div className="grid">
        {grid.map((row, ri) => (
          <div className="row" key={ri}>
            {row.map((id) => {
              const state =
                id === selected ? 'mine' : seatState[id] || 'free';
              return (
                <button
                  key={id}
                  className={`seat ${state}`}
                  onClick={() => pick(id)}
                  disabled={state === 'sold'}
                >
                  {id}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <div className="legend">
        <span className="seat free">livre</span>
        <span className="seat held">em uso</span>
        <span className="seat mine">você</span>
        <span className="seat sold">vendido</span>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button className="secondary" onClick={onLeave}>
          Cancelar
        </button>
        <button onClick={confirm} disabled={!selected}>
          Confirmar {selected && `(${selected})`}
        </button>
      </div>
    </div>
  );
}
