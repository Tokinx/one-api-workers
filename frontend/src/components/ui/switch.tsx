import * as React from 'react'
import { cn } from '@/lib/utils'

export interface SwitchProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  onCheckedChange?: (checked: boolean) => void
}

const Switch = React.forwardRef<HTMLInputElement, SwitchProps>(
  ({ className, onCheckedChange, disabled, onChange, ...props }, ref) => {
    return (
      <label
        className={cn(
          'inline-flex items-center',
          disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
        )}
      >
        <input
          type="checkbox"
          className="peer sr-only"
          ref={ref}
          {...props}
          disabled={disabled}
          onChange={(event) => {
            onChange?.(event)
            onCheckedChange?.(event.target.checked)
          }}
        />
        <span
          className={cn(
            'relative inline-flex h-6 w-11 shrink-0 rounded-full border border-transparent bg-muted transition-colors duration-200',
            'after:absolute after:left-0.5 after:top-0.5 after:h-4.5 after:w-4.5 after:rounded-full after:bg-background after:shadow-md after:transition-transform after:duration-200',
            'peer-checked:bg-emerald-500 peer-checked:after:translate-x-5',
            'peer-focus-visible:ring-2 peer-focus-visible:ring-primary/30 peer-focus-visible:ring-offset-2',
            className,
          )}
        />
      </label>
    )
  }
)

Switch.displayName = 'Switch'

export { Switch }
