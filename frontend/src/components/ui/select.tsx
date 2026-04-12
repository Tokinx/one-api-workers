import * as React from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

type NativeSelectProps = Omit<React.ComponentProps<'select'>, 'children' | 'onChange' | 'size'>

interface SelectProps extends NativeSelectProps {
  children: React.ReactNode
  onChange?: (event: React.ChangeEvent<HTMLSelectElement>) => void
  placeholder?: string
  contentClassName?: string
}

interface SelectOption {
  value: string
  label: React.ReactNode
  disabled?: boolean
}

const TRIGGER_BASE_CLASS =
  'group relative flex h-10 w-full items-center rounded-md border border-input bg-transparent px-3 py-2 pr-10 text-sm text-foreground transition-all duration-200 hover:border-muted-foreground/30 focus-visible:border-primary/50 disabled:cursor-not-allowed disabled:opacity-50'

const CONTENT_BASE_CLASS =
  'absolute z-50 mt-1 w-full overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-lg'

const ITEM_BASE_CLASS =
  'relative flex w-full select-none items-center px-3 py-2 pr-9 text-left text-sm text-foreground outline-none transition-colors duration-150 hover:bg-muted/80 disabled:cursor-not-allowed disabled:opacity-45'

const isElementOfType = (
  child: React.ReactNode,
  type: 'option' | 'optgroup'
): child is React.ReactElement<React.HTMLAttributes<HTMLElement>> => React.isValidElement(child) && child.type === type

const extractOptions = (children: React.ReactNode): SelectOption[] => {
  const options: SelectOption[] = []

  React.Children.forEach(children, (child) => {
    if (!child) return

    if (React.isValidElement(child) && child.type === React.Fragment) {
      options.push(...extractOptions(child.props.children))
      return
    }

    if (isElementOfType(child, 'optgroup')) {
      options.push(...extractOptions(child.props.children))
      return
    }

    if (!isElementOfType(child, 'option')) {
      return
    }

    const rawValue = child.props.value
    if (rawValue == null) {
      return
    }

    options.push({
      value: String(rawValue),
      label: child.props.children,
      disabled: Boolean(child.props.disabled),
    })
  })

  return options
}

const Select = React.forwardRef<HTMLButtonElement, SelectProps>(
  (
    {
      children,
      className,
      contentClassName,
      disabled,
      form,
      id,
      name,
      required,
      autoComplete,
      dir,
      value,
      defaultValue,
      onChange,
      onBlur,
      onFocus,
      onKeyDown,
      placeholder = '请选择',
      'aria-label': ariaLabel,
      'aria-describedby': ariaDescribedBy,
      'aria-labelledby': ariaLabelledBy,
    },
    ref
  ) => {
    const containerRef = React.useRef<HTMLDivElement | null>(null)
    const selectedOptionRef = React.useRef<HTMLButtonElement | null>(null)
    const listboxId = React.useId()
    const options = React.useMemo(() => extractOptions(children), [children])

    const normalizedValue = typeof value === 'string' || typeof value === 'number' ? String(value) : undefined
    const normalizedDefaultValue =
      typeof defaultValue === 'string' || typeof defaultValue === 'number' ? String(defaultValue) : undefined

    const isControlled = normalizedValue !== undefined
    const [internalValue, setInternalValue] = React.useState(normalizedDefaultValue)
    const selectedValue = isControlled ? normalizedValue : internalValue
    const selectedOption = options.find((option) => option.value === selectedValue)
    const hasValue = typeof selectedValue === 'string' && selectedValue.length > 0
    const [isOpen, setIsOpen] = React.useState(false)

    React.useEffect(() => {
      const handlePointerDown = (event: MouseEvent) => {
        if (!containerRef.current?.contains(event.target as Node)) {
          setIsOpen(false)
        }
      }

      document.addEventListener('mousedown', handlePointerDown)
      return () => document.removeEventListener('mousedown', handlePointerDown)
    }, [])

    React.useEffect(() => {
      if (disabled) {
        setIsOpen(false)
      }
    }, [disabled])

    React.useEffect(() => {
      if (isOpen) {
        selectedOptionRef.current?.scrollIntoView({ block: 'nearest' })
      }
    }, [isOpen, selectedValue])

    const handleValueChange = React.useCallback(
      (nextValue: string) => {
        if (!isControlled) {
          setInternalValue(nextValue)
        }

        if (onChange) {
          const syntheticEvent = {
            target: { value: nextValue, name },
            currentTarget: { value: nextValue, name },
          } as React.ChangeEvent<HTMLSelectElement>

          onChange(syntheticEvent)
        }

        setIsOpen(false)
      },
      [isControlled, name, onChange]
    )

    return (
      <div ref={containerRef} dir={dir} className="relative w-full">
        {name && (
          <input
            type="hidden"
            name={name}
            value={selectedValue ?? ''}
            form={form}
            autoComplete={autoComplete}
            disabled={disabled}
            aria-hidden="true"
            data-required={required ? 'true' : undefined}
          />
        )}

        <button
          ref={ref}
          id={id}
          type="button"
          disabled={disabled}
          className={cn(TRIGGER_BASE_CLASS, !hasValue && 'text-muted-foreground', className)}
          aria-label={ariaLabel}
          aria-describedby={ariaDescribedBy}
          aria-labelledby={ariaLabelledBy}
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          aria-controls={listboxId}
          onClick={() => setIsOpen((open) => !open)}
          onBlur={onBlur}
          onFocus={onFocus}
          onKeyDown={onKeyDown}
        >
          <span className="truncate">{selectedOption ? selectedOption.label : placeholder}</span>
          <span className="pointer-events-none absolute right-3 top-1/2 flex -translate-y-1/2 items-center justify-center text-muted-foreground transition-all duration-200">
            <ChevronDown className={cn('h-4 w-4 transition-transform duration-200', isOpen && 'rotate-180')} />
          </span>
        </button>

        {isOpen && !disabled && (
          <div id={listboxId} role="listbox" className={cn(CONTENT_BASE_CLASS, contentClassName)}>
            <div className="max-h-72 overflow-y-auto py-1">
              {options.map((option) => {
                const isSelected = option.value === selectedValue

                return (
                  <button
                    key={option.value}
                    ref={isSelected ? selectedOptionRef : undefined}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    disabled={option.disabled}
                    className={cn(ITEM_BASE_CLASS, isSelected && 'bg-muted/80')}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => handleValueChange(option.value)}
                  >
                    <span className="truncate">{option.label}</span>
                    {isSelected && (
                      <span className="absolute right-3 inline-flex items-center justify-center text-primary">
                        <Check className="h-4 w-4" />
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>
    )
  }
)

Select.displayName = 'Select'

export { Select }
