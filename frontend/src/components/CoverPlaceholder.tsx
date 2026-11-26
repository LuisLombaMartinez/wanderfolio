import { Camera, Plane } from 'lucide-react'
import { coverGradient } from '@/lib/cover'
import { cn } from '@/lib/utils'

interface CoverPlaceholderProps {
  tripId: string
  upcoming: boolean
  /** `card` for the Album, `page` for the Trip page (bigger icon circle). */
  size?: 'card' | 'page'
  /** Replaces the default status label (e.g. when the Cover photo could not be loaded). */
  label?: string
  /** The label for cards narrower than 300px; defaults to "Sin fotos". */
  shortLabel?: string
  className?: string
}

/** Stands in for the Cover photo while a Trip has no Photos. Decorative: the card text carries the status. */
export function CoverPlaceholder({ tripId, upcoming, size = 'card', label, shortLabel, className }: CoverPlaceholderProps) {
  const Icon = upcoming ? Plane : Camera
  return (
    <div
      aria-hidden="true"
      data-testid="cover-placeholder"
      className={cn(
        '@container relative aspect-[4/3] w-full overflow-hidden',
        coverGradient(tripId),
        className,
      )}
    >
      <div className="absolute -right-10 -top-10 size-48 rounded-full bg-white/35 blur-2xl" />
      <svg viewBox="0 0 200 150" preserveAspectRatio="none" className="absolute inset-0 size-full text-primary/25" fill="none">
        <path d="M-5 120 C 50 30, 140 20, 205 95" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 6" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <span
          data-cover-icon
          className={cn('grid place-items-center rounded-full bg-white/60 text-primary', size === 'page' ? 'size-[104px]' : 'size-[72px]')}
        >
          <Icon className={size === 'page' ? 'size-12' : 'size-8'} strokeWidth={1.75} />
        </span>
      </div>
      <span className="absolute bottom-3 left-3 rounded-full bg-card/85 px-3 py-1 text-[13px] font-semibold text-secondary-foreground">
        <span className="@max-[300px]:hidden">{label ?? (upcoming ? 'Las fotos vendrán con el viaje' : 'Aún sin fotos')}</span>
        <span className="hidden @max-[300px]:inline">{shortLabel ?? 'Sin fotos'}</span>
      </span>
    </div>
  )
}
