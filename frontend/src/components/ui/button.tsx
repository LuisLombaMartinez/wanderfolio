import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-full text-lg font-semibold transition-[transform,opacity,background-color,color] duration-200 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none',
  {
    variants: {
      variant: {
        yes: 'min-h-12 min-w-[120px] bg-primary px-8 text-primary-foreground shadow-pink hover:-translate-y-0.5 active:translate-y-0',
        no: 'min-h-12 min-w-[120px] select-none border border-border bg-no-bg px-8 text-no-fg hover:bg-muted',
        ghost: 'text-secondary-foreground hover:bg-secondary',
        destructive: 'min-h-12 bg-foreground px-8 text-primary-foreground hover:bg-foreground/90',
        keepsake: 'min-h-12 border border-border bg-[image:var(--gradient-keepsake)] px-6 text-secondary-foreground shadow-pink hover:-translate-y-0.5 hover:shadow-pink-lift active:scale-[0.98] motion-reduce:hover:translate-y-0',
        soft: 'bg-secondary text-secondary-foreground hover:bg-secondary/70',
      },
      size: {
        default: '',
        icon: 'size-11 min-h-11 min-w-11 p-0',
      },
    },
    defaultVariants: { variant: 'yes', size: 'default' },
  },
)

type ButtonProps = React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }

function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : 'button'
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />
}

export { Button }
