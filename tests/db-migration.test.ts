import { expect, test } from "bun:test";
import db from "../src/db";
import { createTestDatabase } from "./helpers/sqlite-d1";

for (const source of ["api_token", "api_token_legacy_precision"]) {
    test(`precision migration preserves unlimited quota from ${source} and is idempotent`, async () => {
        const fixture = createTestDatabase();
        try {
            fixture.sqlite.exec(`CREATE TABLE ${source} (
                key TEXT PRIMARY KEY, value TEXT, usage REAL,
                created_at TEXT, updated_at TEXT
            )`);
            const quotas = [-1, "-1", 0, 1.25];
            for (const [index, total_quota] of quotas.entries()) {
                fixture.sqlite.query(`INSERT INTO ${source} VALUES (?, ?, ?, ?, ?)`).run(
                    String(index), JSON.stringify({ name: "legacy", channel_keys: [], total_quota }),
                    0.125, "2025-01-01", "2025-02-01",
                );
            }

            await db.migrate(fixture.context);
            const rows = fixture.sqlite.query("SELECT * FROM api_token ORDER BY key").all() as {
                key: string; value: string; usage: number; created_at: string; updated_at: string;
            }[];
            expect(rows.map(row => JSON.parse(row.value).total_quota)).toEqual([-1, -1, 0, 1250]);
            expect(rows.map(row => row.usage)).toEqual([125, 125, 125, 125]);
            expect(rows.every(row => row.created_at === "2025-01-01" && row.updated_at === "2025-02-01")).toBe(true);
            expect(fixture.sqlite.query("SELECT name FROM sqlite_master WHERE name = 'api_token_legacy_precision'").get()).toBeNull();

            await db.migrate(fixture.context);
            expect(fixture.sqlite.query("SELECT * FROM api_token ORDER BY key").all()).toEqual(rows);
        } finally {
            fixture.close();
        }
    });
}
