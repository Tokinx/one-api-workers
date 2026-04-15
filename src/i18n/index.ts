import type { Context } from "hono";
import zhCN from "./zh-CN";
import zhTW from "./zh-TW";
import en from "./en";

type SupportedLang = "zh-CN" | "zh-TW" | "en";

const locales: Record<SupportedLang, Record<string, string>> = {
    "zh-CN": zhCN,
    "zh-TW": zhTW,
    "en": en,
};

const DEFAULT_LANG: SupportedLang = "zh-CN";

const ACCEPT_LANGUAGE_PATTERN = /([a-zA-Z]{1,8}(?:-[a-zA-Z0-9]{1,8})*)\s*(?:;\s*q\s*=\s*([\d.]+))?/g;

/**
 * Resolve the preferred language from the request context.
 *
 * Priority: `x-lang` header > `Accept-Language` header > default (`zh-CN`).
 */
export const resolveLanguage = (c: Context<HonoCustomType>): string => {
    const explicit = c.req.header("x-lang");
    if (explicit) {
        const matched = matchLang(explicit);
        if (matched) {
            return matched;
        }
    }

    const acceptLanguage = c.req.header("accept-language");
    if (acceptLanguage) {
        const candidates = parseAcceptLanguage(acceptLanguage);
        for (const candidate of candidates) {
            const matched = matchLang(candidate);
            if (matched) {
                return matched;
            }
        }
    }

    return DEFAULT_LANG;
};

/**
 * Translate a key for the given language.
 *
 * Supports simple `{{variable}}` interpolation via an optional `params` map.
 */
export const t = (
    lang: string,
    key: string,
    params?: Record<string, string>
): string => {
    const locale = locales[lang as SupportedLang] ?? locales[DEFAULT_LANG];
    let text = locale[key] ?? locales[DEFAULT_LANG][key] ?? key;

    if (params) {
        for (const [name, value] of Object.entries(params)) {
            text = text.replaceAll(`{{${name}}}`, value);
        }
    }

    return text;
};

/**
 * Match a raw language tag to one of the supported locales.
 * Returns the matched locale key, or `undefined` if no match.
 */
const matchLang = (tag: string): SupportedLang | undefined => {
    const normalized = tag.trim().toLowerCase();

    if (normalized === "zh-cn" || normalized === "zh-hans") {
        return "zh-CN";
    }
    if (normalized === "zh-tw" || normalized === "zh-hant" || normalized === "zh-hk") {
        return "zh-TW";
    }
    if (normalized === "en" || normalized.startsWith("en-")) {
        return "en";
    }
    if (normalized === "zh" || normalized.startsWith("zh-")) {
        return "zh-CN";
    }

    return undefined;
};

/**
 * Parse an `Accept-Language` header value and return language tags
 * sorted by quality (descending).
 */
const parseAcceptLanguage = (header: string): string[] => {
    const entries: Array<{ tag: string; quality: number }> = [];
    let match: RegExpExecArray | null;

    ACCEPT_LANGUAGE_PATTERN.lastIndex = 0;
    while ((match = ACCEPT_LANGUAGE_PATTERN.exec(header)) !== null) {
        entries.push({
            tag: match[1],
            quality: match[2] !== undefined ? parseFloat(match[2]) : 1.0,
        });
    }

    entries.sort((a, b) => b.quality - a.quality);
    return entries.map((e) => e.tag);
};
