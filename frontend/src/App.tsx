import { useEffect, useState } from 'react';
import { api, Show, ShowDetail } from './lib/api';
import { Home } from './pages/Home';
import { Queue } from './pages/Queue';
import { Seats } from './pages/Seats';
import { Done } from './pages/Done';
import { Admin } from './pages/Admin';

type Step =
  | { kind: 'home' }
  | { kind: 'queue'; show: ShowDetail; ticketId: string }
  | { kind: 'seats'; show: ShowDetail; ticketId: string }
  | { kind: 'done'; show: ShowDetail; seatId: string }
  | { kind: 'admin' };

export function App() {
  const [shows, setShows] = useState<Show[]>([]);
  const [step, setStep] = useState<Step>(
    window.location.hash === '#admin' ? { kind: 'admin' } : { kind: 'home' },
  );

  useEffect(() => {
    api.listShows().then(setShows).catch(console.error);
  }, []);

  return (
    <div className="container">
      <header>
        <h1>Fila de Ingressos</h1>
        <small>Redis · BullMQ · Locks</small>
        <nav>
          <button
            className="link-btn"
            onClick={() => {
              window.location.hash = step.kind === 'admin' ? '' : 'admin';
              setStep(step.kind === 'admin' ? { kind: 'home' } : { kind: 'admin' });
            }}
          >
            {step.kind === 'admin' ? 'Cliente' : 'Admin'}
          </button>
        </nav>
      </header>
      {step.kind === 'home' && (
        <Home
          shows={shows}
          onJoin={async (showId) => {
            const show = await api.getShow(showId);
            const { ticketId } = await api.joinQueue(showId);
            setStep({ kind: 'queue', show, ticketId });
          }}
        />
      )}
      {step.kind === 'queue' && (
        <Queue
          show={step.show}
          ticketId={step.ticketId}
          onTurn={() =>
            setStep({ kind: 'seats', show: step.show, ticketId: step.ticketId })
          }
          onLeave={() => {
            api.leaveQueue(step.show.id, step.ticketId).catch(() => {});
            setStep({ kind: 'home' });
          }}
        />
      )}
      {step.kind === 'seats' && (
        <Seats
          show={step.show}
          ticketId={step.ticketId}
          onConfirmed={(seatId) =>
            setStep({ kind: 'done', show: step.show, seatId })
          }
          onLeave={() => setStep({ kind: 'home' })}
        />
      )}
      {step.kind === 'done' && (
        <Done
          show={step.show}
          seatId={step.seatId}
          onAgain={() => setStep({ kind: 'home' })}
        />
      )}
      {step.kind === 'admin' && (
        <Admin shows={shows} onBack={() => setStep({ kind: 'home' })} />
      )}
    </div>
  );
}
