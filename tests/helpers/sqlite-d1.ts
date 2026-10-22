import { Database, type SQLQueryBindings } from "bun:sqlite";
import { Context } from "hono";

// Execute production SQL against an isolated SQLite database. Async boundaries
// deliberately allow concurrent callers to interleave between statements.
export function createTestDatabase() {
    const sqlite = new Database(":memory:");
    const prepare = (sql: string, params: SQLQueryBindings[] = []) => ({
        bind: (...values: SQLQueryBindings[]) => prepare(sql, values),
        async first(column?: string) {
            const row = sqlite.query(sql).get(...params) as Record<string, unknown> | null;
            return column ? row?.[column] ?? null : row;
        },
        async all() {
            return { success: true, results: sqlite.query(sql).all(...params) };
        },
        async run() {
            const result = sqlite.query(sql).run(...params);
            return { success: true, meta: { changes: result.changes } };
        },
    });
    const database = {
        prepare,
        async exec(sql: string) { sqlite.exec(sql); },
        async batch(statements: ReturnType<typeof prepare>[]) {
            sqlite.exec("BEGIN");
            try {
                const results = [];
                for (const statement of statements) results.push(await statement.run());
                sqlite.exec("COMMIT");
                return results;
            } catch (error) {
                sqlite.exec("ROLLBACK");
                throw error;
            }
        },
    };
    const context = new Context<HonoCustomType>(new Request("http://localhost/"), {
        env: { DB: database } as unknown as CloudflareBindings,
    });
    return { sqlite, database, context, close: () => sqlite.close() };
}
