import { ShowDetail } from '../lib/api';

interface Props {
  show: ShowDetail;
  seatId: string;
  onAgain: () => void;
}

export function Done({ show, seatId, onAgain }: Props) {
  return (
    <div className="card success">
      <h2>Compra confirmada</h2>
      <p>
        Você garantiu o lugar <strong>{seatId}</strong> em <em>{show.name}</em>.
      </p>
      <button onClick={onAgain}>Comprar outro</button>
    </div>
  );
}
