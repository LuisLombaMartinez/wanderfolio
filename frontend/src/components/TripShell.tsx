import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { ChevronLeft } from 'lucide-react'
import { AppHeader } from '@/components/AppHeader'
import { Button } from '@/components/ui/button'

interface TripShellProps {
  backTo: string
  backLabel: string
  children: ReactNode
  /** The form uses a narrow centred column; the Trip page the full container. */
  narrow?: boolean
}

/** Header, back link and the page container shared by the Trip page and the Trip form. */
export function TripShell({ backTo, backLabel, children, narrow }: TripShellProps) {
  return (
    <>
      <AppHeader />
      <main className="mx-auto w-full max-w-[1100px] px-5 pb-16 pt-4 md:pt-6">
        <Button asChild variant="ghost" className="min-h-11 px-4 text-base">
          <Link to={backTo}>
            <ChevronLeft aria-hidden="true" className="size-5" />
            {backLabel}
          </Link>
        </Button>
        <div className={narrow ? 'mx-auto mt-6 max-w-[600px]' : 'mt-4'}>{children}</div>
      </main>
    </>
  )
}
