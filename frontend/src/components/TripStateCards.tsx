import { CloudOff, Heart, MapPinOff } from 'lucide-react'
import { Link } from 'react-router'
import { LostCompass } from '@/components/LostCompass'
import { StateCard } from '@/components/StateCard'
import { Button } from '@/components/ui/button'

/** The Trip is not in the Album (deleted, or a lost link). Shared by the Trip page and the Trip form. */
export function TripNotFoundCard() {
  return (
    <StateCard
      icon={<LostCompass size="card" icon={MapPinOff} />}
      title="Este viaje no está en nuestro álbum"
      action={
        <Button asChild>
          <Link to="/">
            <Heart aria-hidden="true" className="size-5" />
            Volver al álbum
          </Link>
        </Button>
      }
    >
      Puede que lo hayamos borrado, o que el enlace se haya perdido por el camino.
    </StateCard>
  )
}

/** The Trip could not be loaded; Reintentar calls `onRetry`. */
export function TripLoadErrorCard({ onRetry }: { onRetry: () => void }) {
  return (
    <StateCard
      alert
      icon={<CloudOff aria-hidden="true" className="size-10 text-muted-foreground" strokeWidth={1.75} />}
      title="No hemos podido abrir este viaje"
      action={
        <Button type="button" variant="soft" className="min-h-12 px-8" onClick={onRetry}>
          Reintentar
        </Button>
      }
    >
      Algo ha fallado por el camino. ¿Probamos otra vez?
    </StateCard>
  )
}
