const BLOCKED_HEADER_NAMES = new Set([
    "api-key",
    "authorization",
    "content-length",
    "cookie",
    "host",
    "true-client-ip",
    "x-admin-session",
    "x-admin-token",
    "x-api-key",
    "x-real-ip",
]);

const BLOCKED_HEADER_PREFIXES = [
    "cf-",
    "x-forwarded-",
];

const normalizeHeaderName = (value: string): string => {
    return value.trim().toLowerCase();
};

const shouldForwardHeader = (
    name: string,
    allowlist: Set<string>
): boolean => {
    if (!allowlist.has(name)) {
        return false;
    }

    if (BLOCKED_HEADER_NAMES.has(name)) {
        return false;
    }

    return !BLOCKED_HEADER_PREFIXES.some((prefix) => name.startsWith(prefix));
};

type BuildUpstreamHeadersOptions = {
    allowHeaders: string[];
    overrideHeaders?: Record<string, string | null | undefined>;
};

export const OPENAI_COMPAT_UPSTREAM_HEADER_ALLOWLIST = [
    "accept",
    "accept-encoding",
    "content-type",
    "idempotency-key",
    "openai-beta",
];

export const CLAUDE_UPSTREAM_HEADER_ALLOWLIST = [
    "accept",
    "accept-encoding",
    "anthropic-beta",
    "content-type",
    "idempotency-key",
];

export const buildUpstreamRequestHeaders = (
    request: Request,
    options: BuildUpstreamHeadersOptions
): Headers => {
    const allowlist = new Set(options.allowHeaders.map(normalizeHeaderName));
    const headers = new Headers();

    for (const [name, value] of request.headers.entries()) {
        const normalizedName = normalizeHeaderName(name);

        if (!value || !shouldForwardHeader(normalizedName, allowlist)) {
            continue;
        }

        headers.set(normalizedName, value);
    }

    for (const [name, value] of Object.entries(options.overrideHeaders || {})) {
        const normalizedName = normalizeHeaderName(name);
        headers.delete(normalizedName);

        if (typeof value === "string" && value.length > 0) {
            headers.set(normalizedName, value);
        }
    }

    return headers;
};
