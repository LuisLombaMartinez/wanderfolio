import { useRef } from 'react'
import { Link } from 'react-router'
import { CalendarHeart, MapPin, Plane } from 'lucide-react'
import { InvitationSeal, InvitationSealNote } from '@/components/InvitationSeal'
import { TripCover } from '@/components/TripCover'
import { daysUntil, formatDateRange } from '@/lib/dates'
import type { TripListItem } from '@/lib/api'
import { gsap, useGSAP } from '@/lib/gsap'

/** One Trip in the Album: the whole card is a single link to the Trip page. */
export function TripCard({ trip, lazy }: { trip: TripListItem; lazy?: boolean }) {
  const link = useRef<HTMLAnchorElement>(null)
  const days = daysUntil(trip.startDate)
  const upcoming = days > 0
  const status = trip.invitation?.status

  // Hover lift on pointer devices only; reduced motion keeps the shadow change (CSS) and skips the movement.
  useGSAP(
    (_ctx, contextSafe) => {
      if (!contextSafe) return
      const mm = gsap.matchMedia()
      mm.add('(hover: hover) and (prefers-reduced-motion: no-preference)', () => {
        const el = link.current
        const icon = el?.querySelector('[data-cover-icon]')
        const image = el?.querySelector('[data-cover-img]')
        const gift = el?.querySelector('[data-seal-gift]')
        if (!el) return
        const over = contextSafe(() => {
          gsap.to(el, { y: -4, duration: 0.2, ease: 'power2.out' })
          if (icon) gsap.to(icon, { y: -3, duration: 0.2, ease: 'power2.out' })
          if (image) gsap.to(image, { scale: 1.03, duration: 0.3, ease: 'power2.out' })
          if (gift) gsap.fromTo(gift, { rotation: 0 }, { rotation: -10, duration: 0.15, yoyo: true, repeat: 1, ease: 'back.out(1.7)', overwrite: true })
        })
        const out = contextSafe(() => {
          gsap.to(el, { y: 0, duration: 0.2, ease: 'power2.out' })
          if (icon) gsap.to(icon, { y: 0, duration: 0.2, ease: 'power2.out' })
          if (image) gsap.to(image, { scale: 1, duration: 0.3, ease: 'power2.out' })
        })
        el.addEventListener('pointerenter', over)
        el.addEventListener('pointerleave', out)
        return () => {
          el.removeEventListener('pointerenter', over)
          el.removeEventListener('pointerleave', out)
        }
      })
      return () => mm.revert()
    },
    { scope: link },
  )

  return (
    <Link
      ref={link}
      to={`/trips/${trip.id}`}
      data-card
      className={`group relative block overflow-hidden rounded-photo bg-card shadow-pink transition-[box-shadow,scale] duration-200 ease-out hover:shadow-pink-lift active:scale-[0.985] focus-visible:outline-offset-4 motion-reduce:transition-none motion-reduce:active:scale-100${status ? ' invitation-ring' : ''}`}
    >
      <div className="@container relative">
        <TripCover tripId={trip.id} upcoming={upcoming} cover={trip.coverPhoto} photoCount={trip.photoCount} lazy={lazy} />
        {upcoming && (
          <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-card/90 px-3 py-1 text-[13px] font-bold text-secondary-foreground backdrop-blur-sm">
            <Plane aria-hidden="true" className="size-4" />
            {days === 1 ? 'Mañana' : `En ${days} días`}
          </span>
        )}
        {status && <InvitationSeal status={status} />}
      </div>
      <div className="p-5">
        <h2 className="line-clamp-2 font-serif text-2xl font-bold leading-[1.15]">{trip.title}</h2>
        <p className="mt-3 flex items-center gap-2">
          <MapPin aria-hidden="true" className="size-[18px] shrink-0 text-ocean" />
          <span className="truncate">{trip.destination}</span>
        </p>
        <p className="mt-1 flex items-center gap-2 text-[15px] text-muted-foreground">
          <CalendarHeart aria-hidden="true" className="size-[18px] shrink-0 text-ocean" />
          {formatDateRange(trip.startDate, trip.endDate)}
        </p>
        {status && <InvitationSealNote status={status} />}
      </div>
    </Link>
  )
}
