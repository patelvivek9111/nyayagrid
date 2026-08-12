/**
 * Minimal in-memory stand-in for the Drizzle query builder.
 *
 * It exists so orchestration behavior — budgets, dependency skipping, idempotent re-runs,
 * cancellation, approval gating — can be tested without Postgres. It is not a database: filters
 * are interpreted from simplified condition descriptors that tests inject in place of Drizzle's
 * `eq`/`and`/`inArray`, and anything requiring real SQL belongs in an integration test.
 */

export type FakeRow = Record<string, unknown>;

export type FakeCondition =
  | { op: "eq"; name: string; val: unknown }
  | { op: "in"; name: string; vals: unknown[] }
  | { op: "and"; conds: FakeCondition[] }
  | { op: "order"; name: string }
  | null
  | undefined;

/** Test doubles for Drizzle's condition helpers, keyed by column name instead of SQL. */
export const fakeConditionHelpers = {
  eq: (column: { name: string }, val: unknown): FakeCondition => ({
    op: "eq",
    name: column.name,
    val,
  }),
  and: (...conds: FakeCondition[]): FakeCondition => ({
    op: "and",
    conds: conds.filter(Boolean) as FakeCondition[],
  }),
  inArray: (column: { name: string }, vals: unknown[]): FakeCondition => ({
    op: "in",
    name: column.name,
    vals,
  }),
  asc: (column: { name: string }): FakeCondition => ({ op: "order", name: column.name }),
  desc: (column: { name: string }): FakeCondition => ({ op: "order", name: column.name }),
};

function toCamelCase(snake: string): string {
  return snake.replace(/_([a-z0-9])/g, (_, char: string) => char.toUpperCase());
}

function readField(row: FakeRow, columnName: string): unknown {
  if (columnName in row) return row[columnName];
  return row[toCamelCase(columnName)];
}

function matches(row: FakeRow, condition: FakeCondition): boolean {
  if (!condition) return true;
  switch (condition.op) {
    case "eq":
      return readField(row, condition.name) === condition.val;
    case "in":
      return condition.vals.includes(readField(row, condition.name));
    case "and":
      return condition.conds.every((child) => matches(row, child));
    default:
      return true;
  }
}

class FakeSelectQuery implements PromiseLike<FakeRow[]> {
  constructor(private rows: FakeRow[]) {}

  where(condition: FakeCondition): this {
    this.rows = this.rows.filter((row) => matches(row, condition));
    return this;
  }

  orderBy(): this {
    return this;
  }

  limit(count: number): this {
    this.rows = this.rows.slice(0, count);
    return this;
  }

  then<TResult1 = FakeRow[], TResult2 = never>(
    onfulfilled?: ((value: FakeRow[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.rows.map((row) => ({ ...row }))).then(onfulfilled, onrejected);
  }
}

class FakeInsertQuery implements PromiseLike<FakeRow[]> {
  private inserted: FakeRow[] = [];

  constructor(
    private readonly table: FakeRow[],
    private readonly defaults: FakeRow,
  ) {}

  values(input: FakeRow | FakeRow[]): this {
    const rows = Array.isArray(input) ? input : [input];
    for (const row of rows) {
      const now = new Date();
      const stored: FakeRow = {
        id: crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,
        ...this.defaults,
        ...row,
      };
      this.table.push(stored);
      this.inserted.push(stored);
    }
    return this;
  }

  returning(): this {
    return this;
  }

  then<TResult1 = FakeRow[], TResult2 = never>(
    onfulfilled?: ((value: FakeRow[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.inserted.map((row) => ({ ...row }))).then(onfulfilled, onrejected);
  }
}

class FakeUpdateQuery implements PromiseLike<FakeRow[]> {
  private patch: FakeRow = {};
  private updated: FakeRow[] = [];

  constructor(private readonly table: FakeRow[]) {}

  set(patch: FakeRow): this {
    this.patch = patch;
    return this;
  }

  where(condition: FakeCondition): this {
    for (const row of this.table) {
      if (matches(row, condition)) {
        Object.assign(row, this.patch);
        this.updated.push(row);
      }
    }
    return this;
  }

  returning(): this {
    return this;
  }

  then<TResult1 = FakeRow[], TResult2 = never>(
    onfulfilled?: ((value: FakeRow[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.updated.map((row) => ({ ...row }))).then(onfulfilled, onrejected);
  }
}

export type FakeTableDefaults = Map<unknown, FakeRow>;

export class FakeDatabase {
  private readonly store = new Map<unknown, FakeRow[]>();

  constructor(private readonly defaults: FakeTableDefaults = new Map()) {}

  rows(table: unknown): FakeRow[] {
    const existing = this.store.get(table);
    if (existing) return existing;
    const created: FakeRow[] = [];
    this.store.set(table, created);
    return created;
  }

  seed(table: unknown, rows: FakeRow[]): void {
    this.rows(table).push(...rows);
  }

  select(): { from: (table: unknown) => FakeSelectQuery } {
    return { from: (table: unknown) => new FakeSelectQuery(this.rows(table)) };
  }

  insert(table: unknown): FakeInsertQuery {
    return new FakeInsertQuery(this.rows(table), this.defaults.get(table) ?? {});
  }

  update(table: unknown): FakeUpdateQuery {
    return new FakeUpdateQuery(this.rows(table));
  }
}
