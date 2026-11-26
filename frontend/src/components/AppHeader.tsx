import { useEffect, useState } from 'react'
import { LogOut } from 'lucide-react'
import { useAuth } from '@/auth/auth-context'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** Sticky header for every logged-in screen: wordmark, greeting and logout. */
export function AppHeader() {
  const { state, logOut } = useAuth()
  const [scrolled, setScrolled] = useState(false)
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  async function leave() {
    setLeaving(true)
    try {
      await logOut()
    } finally {
      setLeaving(false)
    }
  }

  return (
    <header
      className={cn(
        'sticky top-0 z-20 border-b bg-background/80 pt-[env(safe-area-inset-top)] backdrop-blur-md transition-colors duration-200',
        scrolled ? 'border-border' : 'border-transparent',
      )}
    >
      <div className="mx-auto flex h-(--app-header-content) w-full max-w-[1100px] items-center justify-between gap-3 px-5">
        <p className="font-script text-[30px] leading-none text-primary">Viajecito</p>
        <div className="flex items-center gap-3">
          {state.status === 'signed-in' && (
            <p className="hidden text-[15px] font-semibold text-foreground min-[360px]:block">
              Hola, {state.member.displayName}
            </p>
          )}
          <Button type="button" variant="ghost" className="min-h-11 px-4 text-base" onClick={leave} disabled={leaving}>
            <LogOut aria-hidden="true" className="size-5" />
            Salir
          </Button>
        </div>
      </div>
    </header>
  )
}
