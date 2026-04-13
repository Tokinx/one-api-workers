import { type AdminSecurityConfig, type ApiDocsConfig, type SystemConfig } from "@/types";
import {
  DEFAULT_BILLING_DISPLAY_DECIMALS,
  normalizeBillingDisplayDecimals,
} from "@/lib/billing";

export const DEFAULT_ADMIN_SECURITY_CONFIG: AdminSecurityConfig = {
  enabled: false,
  telegramBotToken: "",
  telegramChatId: "",
};

export const DEFAULT_API_DOCS_CONFIG: ApiDocsConfig = {
  enabled: true,
};

export const DEFAULT_SYSTEM_CONFIG: SystemConfig = {
  displayDecimals: DEFAULT_BILLING_DISPLAY_DECIMALS,
  adminSecurity: DEFAULT_ADMIN_SECURITY_CONFIG,
  apiDocs: DEFAULT_API_DOCS_CONFIG,
};

export const PRECISION_OPTIONS = [
  { label: "低", value: 2 },
  { label: "中", value: 4 },
  { label: "高", value: 6 },
  { label: "超高", value: 9 },
] as const;

const normalizeString = (value: unknown): string => {
  return typeof value === "string" ? value.trim() : "";
};

export const normalizeAdminSecurityConfig = (value?: Partial<AdminSecurityConfig> | null): AdminSecurityConfig => {
  return {
    enabled: value?.enabled === true,
    telegramBotToken: normalizeString(value?.telegramBotToken),
    telegramChatId: normalizeString(value?.telegramChatId),
  };
};

export const normalizeApiDocsConfig = (value?: Partial<ApiDocsConfig> | null): ApiDocsConfig => {
  return {
    enabled: value?.enabled ?? DEFAULT_API_DOCS_CONFIG.enabled,
  };
};

export const normalizeSystemConfig = (value?: Partial<SystemConfig> | null): SystemConfig => {
  return {
    displayDecimals: normalizeBillingDisplayDecimals(value?.displayDecimals),
    adminSecurity: normalizeAdminSecurityConfig(value?.adminSecurity),
    apiDocs: normalizeApiDocsConfig(value?.apiDocs),
  };
};

export const isTelegramSecurityEnabled = (config?: Partial<AdminSecurityConfig> | null): boolean => {
  return config?.enabled === true
    && typeof config.telegramBotToken === "string"
    && config.telegramBotToken.trim().length > 0
    && typeof config.telegramChatId === "string"
    && config.telegramChatId.trim().length > 0;
};
