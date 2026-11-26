import type { Ref } from 'react'
import { Eye, X } from 'lucide-react'

interface PreviewRibbonProps {
  id: string
  onExit: () => void
  ref?: Ref<HTMLDivElement>
  exitRef?: Ref<HTMLButtonElement>
}

/** The only mark of a preview on the Invitation itself: "Vista previa" and a way out (design/MASTER.md section 57). */
export function PreviewRibbon({ id, onExit, ref, exitRef }: PreviewRibbonProps) {
  return (
    <div
      ref={ref}
      className="fixed left-1/2 z-30 flex min-h-12 w-[calc(100%-2rem)] max-w-[560px] -translate-x-1/2 items-center gap-3 rounded-full bg-foreground/92 py-1 pl-4 pr-1 text-primary-foreground backdrop-blur"
      style={{ top: 'calc(env(safe-area-inset-top) + 12px)' }}
    >
      <Eye aria-hidden="true" className="size-[18px] shrink-0" />
      <p id={id} className="min-w-0 flex-1 text-left text-[15px] leading-tight">
        <span className="font-bold">Vista previa</span>
        {' '}
        <span>· Tu sí aquí no cuenta</span>
      </p>
      <button
        ref={exitRef}
        type="button"
        onClick={onExit}
        className="inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-full bg-white px-4 text-[15px] font-semibold text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      >
        <X aria-hidden="true" className="size-4" />
        Salir
      </button>
    </div>
  )
}
