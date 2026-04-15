import * as React from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

export type AutoCompleteOption = {
  value: string;
  label?: string;
  description?: string;
  keywords?: string[];
};

type AutoCompleteProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
  value: string;
  onChange: (value: string) => void;
  options: AutoCompleteOption[];
  maxOptions?: number;
  emptyText?: string;
  dropdownClassName?: string;
  inputClassName?: string;
};

type MultiSelectAutoCompleteProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
  values: string[];
  onChange: (values: string[]) => void;
  options: AutoCompleteOption[];
  maxOptions?: number;
  emptyText?: string;
  dropdownClassName?: string;
  inputClassName?: string;
};

const normalizeText = (value: string): string => value.trim().toLowerCase();

const matchesOption = (option: AutoCompleteOption, query: string): boolean => {
  if (!query) return true;

  const haystack = [option.value, option.label || "", option.description || "", ...(option.keywords || [])]
    .join(" ")
    .toLowerCase();

  return haystack.includes(query);
};

export const AutoCompleteInput = React.forwardRef<HTMLInputElement, AutoCompleteProps>(
  (
    {
      value,
      onChange,
      options,
      maxOptions,
      emptyText = "No match",
      className,
      dropdownClassName,
      inputClassName,
      onClick,
      onFocus,
      onBlur,
      disabled,
      ...props
    },
    ref,
  ) => {
    const containerRef = React.useRef<HTMLDivElement | null>(null);
    const [isOpen, setIsOpen] = React.useState(false);
    const [searchQuery, setSearchQuery] = React.useState("");

    React.useEffect(() => {
      const handlePointerDown = (event: MouseEvent) => {
        if (!containerRef.current?.contains(event.target as Node)) {
          setIsOpen(false);
        }
      };

      document.addEventListener("mousedown", handlePointerDown);
      return () => document.removeEventListener("mousedown", handlePointerDown);
    }, []);

    React.useEffect(() => {
      if (!isOpen) {
        setSearchQuery("");
      }
    }, [isOpen]);

    const query = normalizeText(searchQuery);
    const dedupedOptions = options.filter((option, index) => {
      return options.findIndex((candidate) => candidate.value === option.value) === index;
    });
    const matchedOptions = dedupedOptions.filter((option) => matchesOption(option, query));
    const filteredOptions = typeof maxOptions === "number" ? matchedOptions.slice(0, maxOptions) : matchedOptions;

    const handleSelect = (selectedValue: string) => {
      onChange(selectedValue);
      setIsOpen(false);
    };

    return (
      <div ref={containerRef} className={cn("relative", className)}>
        <Input
          {...props}
          ref={ref}
          disabled={disabled}
          value={value}
          onClick={(event) => {
            setSearchQuery("");
            setIsOpen(true);
            onClick?.(event);
          }}
          onFocus={(event) => {
            setSearchQuery("");
            setIsOpen(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            onBlur?.(event);
          }}
          onChange={(event) => {
            onChange(event.target.value);
            setSearchQuery(event.target.value);
            setIsOpen(true);
          }}
          className={inputClassName}
        />

        {isOpen && !disabled && (
          <div
            className={cn(
              "absolute z-20 mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-lg",
              dropdownClassName,
            )}
          >
            {filteredOptions.length > 0 ? (
              <div className="max-h-72 overflow-y-auto py-1">
                {filteredOptions.map((option) => {
                  const label = option.label || option.value;
                  const showDescription = option.description && option.description !== label;

                  return (
                    <button
                      key={option.value}
                      type="button"
                      className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-muted/80 transition-colors"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => handleSelect(option.value)}
                    >
                      <span className="text-sm font-medium">{label}</span>
                      {showDescription && <span className="text-xs text-muted-foreground">{option.description}</span>}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="px-3 py-2 text-sm text-muted-foreground">{emptyText}</div>
            )}
          </div>
        )}
      </div>
    );
  },
);

AutoCompleteInput.displayName = "AutoCompleteInput";

export const MultiSelectAutoCompleteInput = React.forwardRef<HTMLInputElement, MultiSelectAutoCompleteProps>(
  (
    {
      values,
      onChange,
      options,
      maxOptions,
      emptyText = "No match",
      className,
      dropdownClassName,
      inputClassName,
      onClick,
      onFocus,
      onBlur,
      onKeyDown,
      disabled,
      placeholder,
      ...props
    },
    ref,
  ) => {
    const containerRef = React.useRef<HTMLDivElement | null>(null);
    const inputRef = React.useRef<HTMLInputElement | null>(null);
    const [isOpen, setIsOpen] = React.useState(false);
    const [searchQuery, setSearchQuery] = React.useState("");

    React.useImperativeHandle(ref, () => inputRef.current as HTMLInputElement);

    React.useEffect(() => {
      const handlePointerDown = (event: MouseEvent) => {
        if (!containerRef.current?.contains(event.target as Node)) {
          setIsOpen(false);
        }
      };

      document.addEventListener("mousedown", handlePointerDown);
      return () => document.removeEventListener("mousedown", handlePointerDown);
    }, []);

    React.useEffect(() => {
      if (!isOpen) {
        setSearchQuery("");
      }
    }, [isOpen]);

    const selectedSet = React.useMemo(() => new Set(values), [values]);
    const dedupedOptions = React.useMemo(
      () =>
        options.filter((option, index) => options.findIndex((candidate) => candidate.value === option.value) === index),
      [options],
    );
    const optionMap = React.useMemo(
      () => new Map(dedupedOptions.map((option) => [option.value, option])),
      [dedupedOptions],
    );
    const selectedOptions = React.useMemo(
      () => values.map((value) => optionMap.get(value) || { value }),
      [optionMap, values],
    );
    const selectedSummary = React.useMemo(
      () => selectedOptions.map((option) => option.label || option.value).join(", "),
      [selectedOptions],
    );
    const query = normalizeText(searchQuery);
    const matchedOptions = React.useMemo(
      () => dedupedOptions.filter((option) => matchesOption(option, query)),
      [dedupedOptions, query],
    );
    const filteredOptions = typeof maxOptions === "number" ? matchedOptions.slice(0, maxOptions) : matchedOptions;

    const toggleValue = (selectedValue: string) => {
      const nextValues = selectedSet.has(selectedValue)
        ? values.filter((value) => value !== selectedValue)
        : [...values, selectedValue];

      onChange(nextValues);
      setSearchQuery("");
      setIsOpen(true);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    };

    return (
      <div ref={containerRef} className={cn("relative", className)}>
        <div className="relative">
          <Input
            {...props}
            ref={inputRef}
            disabled={disabled}
            value={searchQuery}
            placeholder={selectedSummary ? undefined : placeholder}
            onClick={(event) => {
              setIsOpen(true);
              onClick?.(event);
            }}
            onFocus={(event) => {
              setIsOpen(true);
              onFocus?.(event);
            }}
            onBlur={(event) => {
              onBlur?.(event);
            }}
            onChange={(event) => {
              setSearchQuery(event.target.value);
              setIsOpen(true);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                if (filteredOptions[0]) {
                  toggleValue(filteredOptions[0].value);
                  return;
                }
              }

              if (event.key === "Backspace" && !searchQuery && values.length > 0) {
                onChange(values.slice(0, -1));
              }

              if (event.key === "Escape") {
                setIsOpen(false);
              }

              onKeyDown?.(event);
            }}
            className={cn(inputClassName, !searchQuery && selectedSummary && "text-transparent caret-foreground")}
          />

          {!searchQuery && selectedSummary && (
            <div className="pointer-events-none absolute inset-x-3 top-1/2 -translate-y-1/2 truncate text-sm text-foreground">
              {selectedSummary}
            </div>
          )}
        </div>

        {isOpen && !disabled && (
          <div
            className={cn(
              "absolute z-20 mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-lg",
              dropdownClassName,
            )}
          >
            {filteredOptions.length > 0 ? (
              <div className="max-h-72 overflow-y-auto py-1">
                {filteredOptions.map((option) => {
                  const label = option.label || option.value;
                  const showDescription = option.description && option.description !== label;
                  const isSelected = selectedSet.has(option.value);

                  return (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={isSelected}
                      className={cn(
                        "flex w-full items-start gap-3 px-3 py-2 text-left transition-colors",
                        isSelected ? "bg-primary/5 hover:bg-primary/10" : "hover:bg-muted/80",
                      )}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => toggleValue(option.value)}
                    >
                      <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-input text-muted-foreground">
                        {isSelected && <Check className="h-3 w-3" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{label}</span>
                        {showDescription && (
                          <span className="block truncate text-xs text-muted-foreground">{option.description}</span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="px-3 py-2 text-sm text-muted-foreground">{emptyText}</div>
            )}
          </div>
        )}
      </div>
    );
  },
);

MultiSelectAutoCompleteInput.displayName = "MultiSelectAutoCompleteInput";
