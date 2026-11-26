import { Gift } from 'lucide-react'
import type { InvitationSummary } from '@/lib/api'
import { invitationSealCopy } from '@/lib/invitation'

type Status = InvitationSummary['status']

/**
 * The pill at the top right of an Album card's cover. Decorative (the card link carries the
 * meaning in `InvitationSealNote`); under 300px of card width it shrinks to the icon alone.
 * Its container is the cover area, which must be `@container`.
 */
export function InvitationSeal({ status }: { status: Status }) {
  return (
    <span
      data-seal
      aria-hidden="true"
      className="absolute right-3 top-3 inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full bg-card/90 px-2.5 text-[13px] font-bold text-secondary-foreground ring-1 ring-primary/25 backdrop-blur-sm @max-[300px]:w-7 @max-[300px]:justify-center @max-[300px]:px-0"
    >
      <Gift data-seal-gift className="size-3.5 text-primary" />
      <span className="@max-[300px]:hidden">{invitationSealCopy(status).label}</span>
    </span>
  )
}

/** The seal's meaning for screen readers, to sit inside the card link. */
export function InvitationSealNote({ status }: { status: Status }) {
  return <span className="sr-only">{invitationSealCopy(status).note}</span>
}
