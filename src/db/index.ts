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

const createApiTokenTable = async (c: Context<HonoCustomType>) => {
    await c.env.DB.exec(toSingleStatement(`
CREATE TABLE api_token (
    key TEXT PRIMARY KEY,
    value TEXT,
    usage INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
    `));
};

const migrateApiTokenUsagePrecision = async (c: Context<HonoCustomType>) => {
    const hasLegacyTable = await doesTableExist(c, "api_token_legacy_precision");
    const hasCurrentTable = await doesTableExist(c, "api_token");
    const usageColumnType = hasCurrentTable ? await getApiTokenUsageColumnType(c) : "";
    const needsPrecisionMigration = usageColumnType !== "INTEGER";

    if (!hasLegacyTable && !needsPrecisionMigration) {
        return;
    }

    const sourceTable = hasLegacyTable ? "api_token_legacy_precision" : "api_token";
    const legacyTokens = await c.env.DB.prepare(
        `SELECT key, value, usage, created_at, updated_at FROM ${sourceTable}`
    ).all<LegacyTokenRow>();

    if (!hasLegacyTable && hasCurrentTable) {
        await c.env.DB.exec(
            `ALTER TABLE api_token RENAME TO api_token_legacy_precision`
        );
    }

    if (await doesTableExist(c, "api_token")) {
        await c.env.DB.exec(`DROP TABLE IF EXISTS api_token`);
    }

    await createApiTokenTable(c);

    for (const row of legacyTokens.results || []) {
        let migratedValue = row.value;

        try {
            const tokenData = JSON.parse(row.value) as ApiTokenData;
            migratedValue = JSON.stringify({
                ...tokenData,
                total_quota: legacyBillingAmountToRaw(tokenData.total_quota),
            });
        } catch (error) {
            console.error(`Failed to migrate token config for ${row.key}:`, error);
        }

        await c.env.DB.prepare(
            `INSERT INTO api_token (key, value, usage, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?)`
        ).bind(
            row.key,
            migratedValue,
            legacyBillingAmountToRaw(row.usage || 0),
            row.created_at,
            row.updated_at
        ).run();
    }

    await c.env.DB.exec(`DROP TABLE IF EXISTS api_token_legacy_precision`);
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
