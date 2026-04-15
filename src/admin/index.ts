import { Hono } from "hono"
import { fromHono } from 'chanfana';
import { DBInitializeEndpoint } from "./db_api"
import db from "../db"
import {
    ChannelGetEndpoint, ChannelUpsertEndpoint, ChannelDeleteEndpoint, ChannelFetchModelsEndpoint
} from "./channel_api"
import {
    TokenListEndpoint, TokenUpsertEndpoint, TokenDeleteEndpoint, TokenResetUsageEndpoint
} from "./token_api"
import {
    PricingGetEndpoint, PricingUpdateEndpoint
} from "./pricing_api"
import {
    BillingConfigGetEndpoint, BillingConfigUpdateEndpoint
} from "./billing_api"
import {
    SystemConfigGetEndpoint,
    SystemConfigUpdateEndpoint,
    TelegramTestMessageEndpoint,
} from "./system_api"
import {
    AdminLoginStartEndpoint,
    AdminLoginVerifyEndpoint,
    AdminLogoutEndpoint,
} from "./auth_api"
import {
    AnalyticsOverviewEndpoint,
    AnalyticsTrendEndpoint,
    AnalyticsBreakdownEndpoint,
    AnalyticsEventsEndpoint,
    UsageLogSearchEndpoint,
} from "./analytics_api"
import { getSystemConfig, isTelegramSecurityEnabled } from "../system-config"
import { t } from "../i18n"
import {
    clearAdminSessionCookie,
    getAdminSessionTokenFromRequest,
    validateAdminSession,
} from "./auth_shared"

const app = new Hono<HonoCustomType>()
export const api = fromHono(app)

const PUBLIC_AUTH_ROUTES = new Set([
    "/api/admin/auth/login",
    "/api/admin/auth/verify",
]);

app.use('/api/admin/*', async (c, next) => {
    await db.ensureReady(c);
    await next();
});

// Authentication Middleware - using environment variable or admin session
app.use('/api/admin/*', async (c, next) => {
    if (PUBLIC_AUTH_ROUTES.has(c.req.path)) {
        await next();
        return;
    }

    const sessionToken = getAdminSessionTokenFromRequest(c);

    if (sessionToken) {
        if (await validateAdminSession(c, sessionToken)) {
            await next();
            return;
        }

        clearAdminSessionCookie(c);
    }

    const systemConfig = await getSystemConfig(c);
    const securityEnabled = isTelegramSecurityEnabled(systemConfig.adminSecurity);
    const token = c.req.header('x-admin-token');
    const adminToken = c.env.ADMIN_TOKEN;

    if (!securityEnabled && token && adminToken && token === adminToken) {
        await next();
        return;
    }

    return c.text(
        securityEnabled
            ? t(c.get('lang') || 'zh-CN', 'auth.telegramRequired')
            : t(c.get('lang') || 'zh-CN', 'auth.unauthorized'),
        401
    );
});

api.post("/api/admin/db_initialize", DBInitializeEndpoint)

// Authentication routes
api.post("/api/admin/auth/login", AdminLoginStartEndpoint)
api.post("/api/admin/auth/verify", AdminLoginVerifyEndpoint)
api.post("/api/admin/auth/logout", AdminLogoutEndpoint)

api.get("/api/admin/channel", ChannelGetEndpoint)
api.post("/api/admin/channel/:key", ChannelUpsertEndpoint)
api.delete("/api/admin/channel/:key", ChannelDeleteEndpoint)
api.post("/api/admin/channel/models/fetch", ChannelFetchModelsEndpoint)

// Token management routes
api.get("/api/admin/token", TokenListEndpoint)
api.post("/api/admin/token/:key", TokenUpsertEndpoint)
api.post("/api/admin/token/:key/reset", TokenResetUsageEndpoint)
api.delete("/api/admin/token/:key", TokenDeleteEndpoint)

// Pricing management routes
api.get("/api/admin/pricing", PricingGetEndpoint)
api.post("/api/admin/pricing", PricingUpdateEndpoint)
api.get("/api/admin/billing/config", BillingConfigGetEndpoint)
api.post("/api/admin/billing/config", BillingConfigUpdateEndpoint)
api.get("/api/admin/system/config", SystemConfigGetEndpoint)
api.post("/api/admin/system/config", SystemConfigUpdateEndpoint)
api.post("/api/admin/system/telegram/test", TelegramTestMessageEndpoint)

// Analytics management routes
api.get("/api/admin/analytics/overview", AnalyticsOverviewEndpoint)
api.get("/api/admin/analytics/trend", AnalyticsTrendEndpoint)
api.get("/api/admin/analytics/breakdown", AnalyticsBreakdownEndpoint)
api.get("/api/admin/analytics/events", AnalyticsEventsEndpoint)
api.get("/api/admin/usage-logs", UsageLogSearchEndpoint)
