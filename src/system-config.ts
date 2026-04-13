import { Context } from "hono";

import {
    DEFAULT_BILLING_DISPLAY_DECIMALS,
    normalizeBillingDisplayDecimals,
} from "./billing";
import { CONSTANTS } from "./constants";
import { getJsonSetting, saveSetting } from "./utils";

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

const normalizeBoolean = (value: unknown, fallback = false): boolean => {
    return typeof value === "boolean" ? value : fallback;
};

const normalizeString = (value: unknown): string => {
    return typeof value === "string" ? value.trim() : "";
};

export const normalizeAdminSecurityConfig = (
    value: Partial<AdminSecurityConfig> | null | undefined
): AdminSecurityConfig => {
    return {
        enabled: normalizeBoolean(value?.enabled),
        telegramBotToken: normalizeString(value?.telegramBotToken),
        telegramChatId: normalizeString(value?.telegramChatId),
    };
};

export const normalizeApiDocsConfig = (
    value: Partial<ApiDocsConfig> | null | undefined
): ApiDocsConfig => {
    return {
        enabled: normalizeBoolean(value?.enabled, DEFAULT_API_DOCS_CONFIG.enabled),
    };
};

export const normalizeSystemConfig = (
    value: Partial<SystemConfig> | null | undefined
): SystemConfig => {
    return {
        displayDecimals: normalizeBillingDisplayDecimals(value?.displayDecimals),
        adminSecurity: normalizeAdminSecurityConfig(value?.adminSecurity),
        apiDocs: normalizeApiDocsConfig(value?.apiDocs),
    };
};

export const isTelegramSecurityEnabled = (
    value: AdminSecurityConfig | SystemConfig | null | undefined
): boolean => {
    const security = value && "adminSecurity" in value
        ? value.adminSecurity
        : value;

    if (!security) {
        return false;
    }

    return security.enabled
        && security.telegramBotToken.length > 0
        && security.telegramChatId.length > 0;
};

export const getSystemConfig = async (
    c: Context<HonoCustomType>
): Promise<SystemConfig> => {
    const systemConfig = await getJsonSetting<SystemConfig>(
        c,
        CONSTANTS.SYSTEM_CONFIG_KEY
    );

    if (systemConfig) {
        return normalizeSystemConfig(systemConfig);
    }

    const legacyBillingConfig = await getJsonSetting<BillingConfig>(
        c,
        CONSTANTS.BILLING_CONFIG_KEY
    );

    return normalizeSystemConfig({
        displayDecimals: legacyBillingConfig?.displayDecimals,
    });
};

export const saveSystemConfig = async (
    c: Context<HonoCustomType>,
    value: Partial<SystemConfig> | null | undefined
): Promise<SystemConfig> => {
    const config = normalizeSystemConfig(value);

    await saveSetting(
        c,
        CONSTANTS.SYSTEM_CONFIG_KEY,
        JSON.stringify(config)
    );

    await saveSetting(
        c,
        CONSTANTS.BILLING_CONFIG_KEY,
        JSON.stringify({
            displayDecimals: config.displayDecimals,
        } satisfies BillingConfig)
    );

    return config;
};
