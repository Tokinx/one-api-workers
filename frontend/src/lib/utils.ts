import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const TIMESTAMP_TIMEZONE_PATTERN = /(Z|[+-]\d{2}:\d{2})$/i

export function parseUtcTimestamp(value: string): Date | null {
  const rawValue = value.trim()
  if (!rawValue) {
    return null
  }

  const normalizedValue = rawValue.includes('T')
    ? rawValue
    : rawValue.replace(' ', 'T')
  const candidate = TIMESTAMP_TIMEZONE_PATTERN.test(normalizedValue)
    ? normalizedValue
    : `${normalizedValue}Z`
  const date = new Date(candidate)

  return Number.isNaN(date.getTime()) ? null : date
}

export function formatCurrency(value: number): string {
  return `$${(value / 1000000).toFixed(2)}`
}

export function formatQuota(value: number): string {
  if (value >= 1000000) {
    return `$${(value / 1000000).toFixed(2)}`
  }
  return value.toString()
}

export function copyToClipboard(text: string): Promise<void> {
  return navigator.clipboard.writeText(text)
}

export function generateTokenKey(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let token = 'sk-'
  for (let i = 0; i < 48; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return token
}
