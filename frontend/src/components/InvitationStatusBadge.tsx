import { HeartHandshake, Hourglass } from 'lucide-react'
import type { Invitation } from '@/lib/api'
import { formatLocalDay } from '@/lib/dates'

/** "pendiente" or "aceptada el {fecha}" (design/MASTER.md section 55). The status never rests on colour alone. */
export function InvitationStatusBadge({ invitation }: { invitation: Invitation }) {
  const accepted = invitation.status === 'accepted'
  const Icon = accepted ? HeartHandshake : Hourglass
  return (
    <span
      className={`inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-sm font-bold ${
        accepted
          ? 'bg-primary text-primary-foreground shadow-pink'
          : 'border border-dashed border-primary/40 bg-secondary text-secondary-foreground'
      }`}
    >
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      <span className="sr-only">Estado de la invitación: </span>
      <span>{accepted ? `aceptada el ${formatLocalDay(invitation.acceptedAt ?? '')}`.trim() : 'pendiente'}</span>
    </span>
  )
}
