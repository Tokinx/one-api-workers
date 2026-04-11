import * as React from 'react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export type AutoCompleteOption = {
  value: string
  label?: string
  description?: string
  keywords?: string[]
}

type AutoCompleteProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  value: string
  onChange: (value: string) => void
  options: AutoCompleteOption[]
  maxOptions?: number
  emptyText?: string
  dropdownClassName?: string
  inputClassName?: string
}

const normalizeText = (value: string): string => value.trim().toLowerCase()

const matchesOption = (option: AutoCompleteOption, query: string): boolean => {
  if (!query) return true

  const haystack = [
    option.value,
    option.label || '',
    option.description || '',
    ...(option.keywords || []),
  ]
    .join(' ')
    .toLowerCase()

  return haystack.includes(query)
}

export const AutoCompleteInput = React.forwardRef<HTMLInputElement, AutoCompleteProps>(
  (
    {
      value,
      onChange,
      options,
      maxOptions,
      emptyText = '无匹配结果',
      className,
      dropdownClassName,
      inputClassName,
      onClick,
      onFocus,
      onBlur,
      disabled,
      ...props
    },
    ref
  ) => {
    const containerRef = React.useRef<HTMLDivElement | null>(null)
    const [isOpen, setIsOpen] = React.useState(false)
    const [searchQuery, setSearchQuery] = React.useState('')

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
      if (!isOpen) {
        setSearchQuery('')
      }
    }, [isOpen])

    const query = normalizeText(searchQuery)
    const dedupedOptions = options.filter((option, index) => {
      return options.findIndex((candidate) => candidate.value === option.value) === index
    })
    const matchedOptions = dedupedOptions.filter((option) => matchesOption(option, query))
    const filteredOptions = typeof maxOptions === 'number' ? matchedOptions.slice(0, maxOptions) : matchedOptions

    const handleSelect = (selectedValue: string) => {
      onChange(selectedValue)
      setIsOpen(false)
    }

    return (
      <div ref={containerRef} className={cn('relative', className)}>
        <Input
          {...props}
          ref={ref}
          disabled={disabled}
          value={value}
          onClick={(event) => {
            setSearchQuery('')
            setIsOpen(true)
            onClick?.(event)
          }}
          onFocus={(event) => {
            setSearchQuery('')
            setIsOpen(true)
            onFocus?.(event)
          }}
          onBlur={(event) => {
            onBlur?.(event)
          }}
          onChange={(event) => {
            onChange(event.target.value)
            setSearchQuery(event.target.value)
            setIsOpen(true)
          }}
          className={inputClassName}
        />

        {isOpen && !disabled && (
          <div
            className={cn(
              'absolute z-20 mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-lg',
              dropdownClassName
            )}
          >
            {filteredOptions.length > 0 ? (
              <div className="max-h-72 overflow-y-auto py-1">
                {filteredOptions.map((option) => {
                  const label = option.label || option.value
                  const showDescription = option.description && option.description !== label

                  return (
                    <button
                      key={option.value}
                      type="button"
                      className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-muted/80 transition-colors"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => handleSelect(option.value)}
                    >
                      <span className="text-sm font-medium">{label}</span>
                      {showDescription && (
                        <span className="text-xs text-muted-foreground">{option.description}</span>
                      )}
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="px-3 py-2 text-sm text-muted-foreground">{emptyText}</div>
            )}
          </div>
        )}
      </div>
    )
  }
)

AutoCompleteInput.displayName = 'AutoCompleteInput'
