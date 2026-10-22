import { Context } from "hono";
import { legacyBillingAmountToRaw } from "../billing";
import { CONSTANTS } from "../constants";
import { getSetting, saveSetting } from "../utils";
import { sanitizeChannelConfig } from "../channel-config";

const DB_INIT_QUERIES = `
CREATE TABLE IF NOT EXISTS channel_config (
    key TEXT PRIMARY KEY,
    value TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS api_token (
    key TEXT PRIMARY KEY,
    value TEXT,
    usage INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS admin_login_challenge (
    id TEXT PRIMARY KEY,
    code_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 5,
    request_ip TEXT DEFAULT '',
    request_country TEXT DEFAULT '',
    request_region TEXT DEFAULT '',
    request_city TEXT DEFAULT '',
    request_colo TEXT DEFAULT '',
    request_timezone TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS admin_session (
    token_hash TEXT PRIMARY KEY,
    expires_at TEXT NOT NULL,
    last_used_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS admin_rate_limit (
    bucket_key TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    bucket_id TEXT NOT NULL,
    window_started_at TEXT NOT NULL,
    attempts INTEGER DEFAULT 0,
    blocked_until TEXT,
    last_event_at TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_admin_login_challenge_expires_at
    ON admin_login_challenge (expires_at);
CREATE INDEX IF NOT EXISTS idx_admin_session_expires_at
    ON admin_session (expires_at);
CREATE INDEX IF NOT EXISTS idx_admin_rate_limit_category_bucket
    ON admin_rate_limit (category, bucket_id);
CREATE INDEX IF NOT EXISTS idx_admin_rate_limit_blocked_until
    ON admin_rate_limit (blocked_until);
`

let dbReadyPromise: Promise<void> | null = null;

const getInitQuery = () => DB_INIT_QUERIES.replace(/[\r\n]/g, "")
    .split(";")
    .map((query) => query.trim())
    .filter(Boolean)
    .join(";\n");

const toSingleStatement = (sql: string) => {
    return sql
        .replace(/[\r\n]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/;?$/, ";");
};

const initializeSchema = async (c: Context<HonoCustomType>) => {
    await c.env.DB.exec(getInitQuery());
};

type TableInfoRow = {
    name: string;
    type: string;
}

type SqliteMasterRow = {
    name: string;
}

type LegacyTokenRow = {
    key: string;
    value: string;
    usage: number | null;
    created_at: string;
    updated_at: string;
}

const doesTableExist = async (c: Context<HonoCustomType>, tableName: string): Promise<boolean> => {
    const table = await c.env.DB.prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`
    ).bind(tableName).first<SqliteMasterRow>();

    return Boolean(table?.name);
};

const getApiTokenUsageColumnType = async (c: Context<HonoCustomType>): Promise<string> => {
    const tableInfo = await c.env.DB.prepare(
        `PRAGMA table_info(api_token)`
    ).all<TableInfoRow>();

    const usageColumn = tableInfo.results?.find((column) => column.name === "usage");
    return (usageColumn?.type || "").toUpperCase();
};

const MIGRATION_LOCK_KEY = "db_migration_lock";
const MIGRATION_LOCK_TTL_MS = 60_000;
const MIGRATION_LOCK_WAIT_STEP_MS = 200;
const MIGRATION_LOCK_WAIT_MAX_MS = 5_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const API_TOKEN_TABLE_SQL = toSingleStatement(`
CREATE TABLE api_token (
    key TEXT PRIMARY KEY,
    value TEXT,
    usage INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
    `);

const acquireMigrationLock = async (c: Context<HonoCustomType>): Promise<boolean> => {
    const result = await c.env.DB.prepare(
        `INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`
    ).bind(MIGRATION_LOCK_KEY, new Date().toISOString()).run();

    return Boolean(result.meta?.changes && result.meta.changes > 0);
};

const releaseMigrationLock = async (c: Context<HonoCustomType>): Promise<void> => {
    await c.env.DB.prepare(
        `DELETE FROM settings WHERE key = ?`
    ).bind(MIGRATION_LOCK_KEY).run();
};

const getMigrationLockTimestamp = async (c: Context<HonoCustomType>): Promise<string | null> => {
    return await c.env.DB.prepare(
        `SELECT value FROM settings WHERE key = ?`
    ).bind(MIGRATION_LOCK_KEY).first<string>("value");
};

const tryStealStaleMigrationLock = async (c: Context<HonoCustomType>): Promise<boolean> => {
    const lockedAt = await getMigrationLockTimestamp(c);
    if (!lockedAt) {
        return false;
    }

    const lockedAtMs = Date.parse(lockedAt);
    if (!Number.isFinite(lockedAtMs) || Date.now() - lockedAtMs < MIGRATION_LOCK_TTL_MS) {
        return false;
    }

    // 持有者疑似异常中断，抢占过期锁
    await releaseMigrationLock(c);
    return acquireMigrationLock(c);
};

const waitForMigrationLock = async (c: Context<HonoCustomType>): Promise<boolean> => {
    const deadline = Date.now() + MIGRATION_LOCK_WAIT_MAX_MS;
    let lockHeld = await acquireMigrationLock(c);

    while (!lockHeld && Date.now() < deadline) {
        await sleep(MIGRATION_LOCK_WAIT_STEP_MS);
        lockHeld = await tryStealStaleMigrationLock(c);
        if (!lockHeld) {
            lockHeld = await acquireMigrationLock(c);
        }
    }

    return lockHeld;
};

const migrateApiTokenUsagePrecision = async (c: Context<HonoCustomType>) => {
    const hasLegacyTable = await doesTableExist(c, "api_token_legacy_precision");
    const hasCurrentTable = await doesTableExist(c, "api_token");
    const usageColumnType = hasCurrentTable ? await getApiTokenUsageColumnType(c) : "";
    const needsPrecisionMigration = usageColumnType !== "INTEGER";

    if (!hasLegacyTable && !needsPrecisionMigration) {
        return;
    }

    // 迁移锁保证多 isolate 并发部署时只有一个执行破坏性操作
    const lockHeld = await waitForMigrationLock(c);
    if (!lockHeld) {
        throw new Error("Timed out waiting for database migration lock");
    }

    try {
        // 持锁后重新检查，等待期间其他 isolate 可能已完成迁移
        const latestHasLegacyTable = await doesTableExist(c, "api_token_legacy_precision");
        const latestHasCurrentTable = await doesTableExist(c, "api_token");
        const latestUsageColumnType = latestHasCurrentTable ? await getApiTokenUsageColumnType(c) : "";
        if (!latestHasLegacyTable && latestUsageColumnType === "INTEGER") {
            return;
        }

        const sourceTable = latestHasLegacyTable ? "api_token_legacy_precision" : "api_token";
        const legacyTokens = await c.env.DB.prepare(
            `SELECT key, value, usage, created_at, updated_at FROM ${sourceTable}`
        ).all<LegacyTokenRow>();

        // 破坏性操作打包为单个原子 batch，失败整体回滚
        const statements: any[] = [];

        if (!latestHasLegacyTable && latestHasCurrentTable) {
            statements.push(c.env.DB.prepare(
                `ALTER TABLE api_token RENAME TO api_token_legacy_precision`
            ));
        }

        statements.push(c.env.DB.prepare(`DROP TABLE IF EXISTS api_token`));
        statements.push(c.env.DB.prepare(API_TOKEN_TABLE_SQL));

        for (const row of legacyTokens.results || []) {
            let migratedValue = row.value;

            try {
                const tokenData = JSON.parse(row.value) as ApiTokenData;
                migratedValue = JSON.stringify({
                    ...tokenData,
                    // -1 是无限配额标记，不参与金额单位换算。
                    total_quota: Number(tokenData.total_quota) === -1
                        ? -1
                        : legacyBillingAmountToRaw(tokenData.total_quota),
                });
            } catch (error) {
                console.error(`Failed to migrate token config for ${row.key}:`, error);
            }

            statements.push(c.env.DB.prepare(
                `INSERT INTO api_token (key, value, usage, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?)`
            ).bind(
                row.key,
                migratedValue,
                legacyBillingAmountToRaw(row.usage || 0),
                row.created_at,
                row.updated_at
            ));
        }

        statements.push(c.env.DB.prepare(`DROP TABLE IF EXISTS api_token_legacy_precision`));

        await c.env.DB.batch(statements);
    } finally {
        await releaseMigrationLock(c);
    }
};

const dbOperations = {
    initialize: async (c: Context<HonoCustomType>) => {
        await initializeSchema(c);
    },
    migrate: async (c: Context<HonoCustomType>) => {
        await initializeSchema(c);

        await migrateApiTokenUsagePrecision(c);

        const version = await getSetting(c, CONSTANTS.DB_VERSION_KEY);
        if (version === CONSTANTS.DB_VERSION) {
            return;
        }

        const channels = await c.env.DB.prepare(
            "SELECT key, value FROM channel_config"
        ).all<Pick<ChannelConfigRow, "key" | "value">>();

        for (const row of channels.results || []) {
            const config = (() => {
                try {
                    return JSON.parse(row.value) as ChannelConfig;
                } catch {
                    return null;
                }
            })();

            if (!config) {
                continue;
            }

            const sanitizedConfig = sanitizeChannelConfig(config);

            await c.env.DB.prepare(
                `UPDATE channel_config
                 SET value = ?, updated_at = datetime('now')
                 WHERE key = ?`
            ).bind(JSON.stringify(sanitizedConfig), row.key).run();
        }

        await saveSetting(c, CONSTANTS.DB_VERSION_KEY, CONSTANTS.DB_VERSION);
    },
    ensureReady: async (c: Context<HonoCustomType>) => {
        if (!dbReadyPromise) {
            dbReadyPromise = (async () => {
                await dbOperations.migrate(c);
            })().catch((error) => {
                dbReadyPromise = null;
                throw error;
            });
        }

        await dbReadyPromise;
    },
    getVersion: async (c: Context<HonoCustomType>): Promise<string | null> => {
        return await getSetting(c, CONSTANTS.DB_VERSION_KEY);
    }
}

export default dbOperations;
