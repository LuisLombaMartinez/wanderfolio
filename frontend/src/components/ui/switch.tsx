import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

type SwitchProps = Omit<ComponentProps<'button'>, 'role' | 'onChange'> & {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}

/**
 * An on/off switch (MASTER section 51): a 52x32 pill track, a white 24px thumb. A native button
 * with `role="switch"`; the label and description are wired by the caller.
 */
export function Switch({ checked, onCheckedChange, className, ...props }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex h-8 w-[52px] shrink-0 items-center rounded-full border transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none',
        checked ? 'border-primary bg-primary' : 'border-border bg-muted',
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          'block size-6 rounded-full bg-white shadow-pink transition-transform duration-150 ease-out motion-reduce:transition-none',
          checked ? 'translate-x-[23px]' : 'translate-x-[3px]',
        )}
      />
    </button>
  )
}
