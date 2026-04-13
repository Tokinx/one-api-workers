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
    AnalyticsOverviewEndpoint,
    AnalyticsTrendEndpoint,
    AnalyticsBreakdownEndpoint,
    AnalyticsEventsEndpoint,
    UsageLogSearchEndpoint,
} from "./analytics_api"

const app = new Hono<HonoCustomType>()
export const api = fromHono(app)

// Authentication Middleware - using environment variable
app.use('/api/admin/*', async (c, next) => {
    const token = c.req.header('x-admin-token');
    const adminToken = c.env.ADMIN_TOKEN;

    if (!token || !adminToken || token !== adminToken) {
        return c.text("Unauthorized", 401);
    }
    await next();
});

app.use('/api/admin/*', async (c, next) => {
    await db.ensureReady(c);
    await next();
});

api.post("/api/admin/db_initialize", DBInitializeEndpoint)

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

// Analytics management routes
api.get("/api/admin/analytics/overview", AnalyticsOverviewEndpoint)
api.get("/api/admin/analytics/trend", AnalyticsTrendEndpoint)
api.get("/api/admin/analytics/breakdown", AnalyticsBreakdownEndpoint)
api.get("/api/admin/analytics/events", AnalyticsEventsEndpoint)
api.get("/api/admin/usage-logs", UsageLogSearchEndpoint)
