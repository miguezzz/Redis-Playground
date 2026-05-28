import { Show } from '../lib/api';

interface Props {
  shows: Show[];
  onJoin: (showId: string) => void;
}

export function Home({ shows, onJoin }: Props) {
  return (
    <div className="card">
      <h2>Escolha um evento</h2>
      <div className="show-grid">
        {shows.map((s) => (
          <button key={s.id} className="show-card" onClick={() => onJoin(s.id)}>
            <strong>{s.name}</strong>
            <span>{s.rows * s.cols} lugares</span>
            <em>Entrar na fila →</em>
          </button>
        ))}
        {shows.length === 0 && <p>Carregando shows…</p>}
      </div>
    </div>
  );
}
