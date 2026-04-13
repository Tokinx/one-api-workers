import { BillingConfig } from "@/types";

export const BILLING_RAW_SCALE = 1_000_000_000;
export const DEFAULT_BILLING_DISPLAY_DECIMALS = 6;
export const MIN_BILLING_DISPLAY_DECIMALS = 0;
export const MAX_BILLING_DISPLAY_DECIMALS = 9;

export const normalizeBillingDisplayDecimals = (value: unknown): number => {
  const parsed = typeof value === "number" && Number.isFinite(value)
    ? Math.round(value)
    : DEFAULT_BILLING_DISPLAY_DECIMALS;

  return Math.min(MAX_BILLING_DISPLAY_DECIMALS, Math.max(MIN_BILLING_DISPLAY_DECIMALS, parsed));
};

export const normalizeBillingConfig = (value?: Partial<BillingConfig> | null): BillingConfig => {
  return {
    displayDecimals: normalizeBillingDisplayDecimals(value?.displayDecimals),
  };
};

export const rawBillingToUsd = (value: number): number => {
  return Number.isFinite(value) ? value / BILLING_RAW_SCALE : 0;
};

export const usdToRawBilling = (value: string | number): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.max(0, Math.round(parsed * BILLING_RAW_SCALE));
};

export const formatRawBillingInput = (value: number, displayDecimals = DEFAULT_BILLING_DISPLAY_DECIMALS): string => {
  const decimals = normalizeBillingDisplayDecimals(displayDecimals);
  return rawBillingToUsd(value).toFixed(decimals);
};
