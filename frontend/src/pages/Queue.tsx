import { useEffect, useState } from 'react';
import { api, ShowDetail } from '../lib/api';
import { getSocket } from '../lib/socket';

interface Props {
  show: ShowDetail;
  ticketId: string;
  onTurn: () => void;
  onLeave: () => void;
}

export function Queue({ show, ticketId, onTurn, onLeave }: Props) {
  const [position, setPosition] = useState<number | null>(null);
  const [total, setTotal] = useState<number | null>(null);

  useEffect(() => {
    const socket = getSocket();
    socket.emit('subscribe', { showId: show.id, ticketId });
    const onPos = (p: { position: number; total: number }) => {
      setPosition(p.position);
      setTotal(p.total);
    };
    const onTurnEvt = () => onTurn();
    socket.on('position', onPos);
    socket.on('your-turn', onTurnEvt);

    api.queueStatus(show.id, ticketId).then((s) => {
      if (s.state === 'active') onTurn();
      else if (s.state === 'waiting') {
        setPosition(s.position ?? null);
        setTotal(s.total ?? null);
      }
    });

    return () => {
      socket.off('position', onPos);
      socket.off('your-turn', onTurnEvt);
    };
  }, [show.id, ticketId, onTurn]);

  return (
    <div className="card">
      <h2>{show.name}</h2>
      <div className="queue-display">
        <div className="big-number">{position ?? '…'}</div>
        <div className="caption">
          {position == null
            ? 'Conectando…'
            : position === 1
              ? 'Você é o próximo!'
              : `Sua posição (de ${total} na fila)`}
        </div>
        <div className="ticket-id">ticket: {ticketId}</div>
      </div>
      <button className="secondary" onClick={onLeave}>
        Sair da fila
      </button>
    </div>
  );
}
