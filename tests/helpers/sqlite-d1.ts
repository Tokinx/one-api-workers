import { Database, type SQLQueryBindings } from "bun:sqlite";
import { Context } from "hono";

// Execute production SQL against an isolated SQLite database. Async boundaries
// deliberately allow concurrent callers to interleave between statements.
export function createTestDatabase() {
    const sqlite = new Database(":memory:");
    const prepare = (sql: string, params: SQLQueryBindings[] = []) => ({
        bind: (...values: SQLQueryBindings[]) => prepare(sql, values),
        execute() {
            const results = sqlite.query(sql).all(...params);
            const changes = sqlite.query("SELECT changes() AS count").get() as { count: number };
            return { success: true, results, meta: { changes: changes.count } };
        },
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
            // Match D1: the whole batch runs without another caller interleaving.
            return sqlite.transaction(() => statements.map(statement => statement.execute()))();
        },
    };
    const context = new Context<HonoCustomType>(new Request("http://localhost/"), {
        env: { DB: database } as unknown as CloudflareBindings,
    });
    return { sqlite, database, context, close: () => sqlite.close() };
}
