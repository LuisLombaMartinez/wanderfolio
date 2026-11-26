import { useState } from 'react'
import { AlertCircle, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { refusalMessage } from '@/lib/messages'
import type { Refusal } from '@/lib/upload-store'

const VISIBLE = 5

/** What the latest pick could not upload, one friendly line per file (MASTER section 29). */
export function UploadRefusals({ refusals, onDismiss }: { refusals: Refusal[]; onDismiss: () => void }) {
  const [expanded, setExpanded] = useState(false)
  if (refusals.length === 0) return null
  const shown = expanded ? refusals : refusals.slice(0, VISIBLE)
  const hidden = refusals.length - shown.length
  return (
    <section role="alert" data-refusals className="field-error mb-6 rounded-[20px] bg-card p-5 shadow-pink">
      <div className="flex items-start justify-between gap-3">
        <p className="flex items-center gap-2 text-base font-bold">
          <AlertCircle aria-hidden="true" className="size-5 shrink-0 text-primary" />
          {refusals.length === 1 ? 'No hemos podido subir 1 foto' : `No hemos podido subir ${refusals.length} fotos`}
        </p>
        <Button type="button" variant="ghost" size="icon" aria-label="Entendido" className="-mr-2 -mt-2 shrink-0" onClick={onDismiss}>
          <X aria-hidden="true" className="size-5" />
        </Button>
      </div>
      <ul className="mt-2 flex list-none flex-col gap-2 p-0 text-[15px]">
        {shown.map((r, i) => (
          <li key={`${i}-${r.filename}`}>{refusalMessage(r.code, r.filename)}</li>
        ))}
      </ul>
      {hidden > 0 && (
        <Button type="button" variant="soft" className="mt-3 min-h-11 px-5 text-[15px]" onClick={() => setExpanded(true)}>
          Ver las {hidden} restantes
        </Button>
      )}
    </section>
  )
}
