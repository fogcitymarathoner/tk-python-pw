import { DatabaseSync } from "node:sqlite";
import { ApiError } from "./errors.ts";

export type Category = {
  id: number;
  remoteId: string | null;
  name: string;
  userId: string;
};

export type Vendor = {
  id: number;
  remoteId: string | null;
  name: string;
  userId: string;
};

export type Expense = {
  localId: number;
  remoteId: string | null;
  vendorName: string;
  vendorId: number | null;
  categoryId: number | null;
  categoryName: string;
  amount: string;
  date: string;
  memo: string | null;
  userId: string;
};

export type SwimWorkout = {
  id: number;
  remoteId: string | null;
  name: string;
  note: string;
  setCount: number;
  userId: string;
};

export type SwimSet = {
  id: number;
  remoteId: string | null;
  workoutId: number;
  distance: string;
  description: string;
  splitTotal: string;
  equipment: string;
  fins: string;
  sortOrder: number;
};

export type SwimWorkoutDetail = SwimWorkout & { sets: SwimSet[] };

export type SwimSession = {
  id: number;
  remoteId: string | null;
  date: string;
  meters: string;
  miles: string;
  stroke: string;
  note: string;
  extra: string;
  workoutId: number | null;
  workoutName: string | null;
  userId: string;
};

export type SwimSetInput = {
  distance: string;
  description: string;
  splitTotal: string;
  equipment: string;
  fins: string;
};

export type ExpenseInput = {
  vendorName: string;
  amount: string;
  date: string;
  memo: string;
  categoryName: string;
};

export type SwimSessionInput = {
  date: string;
  meters: string;
  miles: string;
  stroke: string;
  note: string;
  extra: string;
  workoutId: number | null;
};

type Row = Record<string, unknown>;
type RunResult = { changes: number | bigint; lastInsertRowid: number | bigint };

const SCHEMA = `
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  remoteId TEXT,
  name TEXT NOT NULL,
  userId TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS vendors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  remoteId TEXT,
  name TEXT NOT NULL,
  userId TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS expenses (
  localId INTEGER PRIMARY KEY AUTOINCREMENT,
  remoteId TEXT,
  vendor TEXT,
  vendorId INTEGER,
  categoryId INTEGER,
  amount TEXT,
  date TEXT,
  memo TEXT,
  userId TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (categoryId) REFERENCES categories (id) ON DELETE SET NULL,
  FOREIGN KEY (vendorId) REFERENCES vendors (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);
CREATE INDEX IF NOT EXISTS idx_expenses_user_date ON expenses(userId, date);

CREATE TABLE IF NOT EXISTS swim_workouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  remoteId TEXT,
  name TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  userId TEXT NOT NULL,
  importKey TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS swim_workout_sets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  remoteId TEXT,
  workoutId INTEGER NOT NULL,
  remoteWorkoutId TEXT,
  distance TEXT,
  description TEXT,
  splitTotal TEXT,
  equipment TEXT,
  fins TEXT,
  sortOrder INTEGER NOT NULL DEFAULT 0,
  userId TEXT NOT NULL,
  FOREIGN KEY (workoutId) REFERENCES swim_workouts (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS swim_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  remoteId TEXT,
  date TEXT NOT NULL,
  meters TEXT,
  miles TEXT,
  stroke TEXT,
  note TEXT,
  extra TEXT,
  workoutId INTEGER,
  remoteWorkoutId TEXT,
  userId TEXT NOT NULL,
  importKey TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workoutId) REFERENCES swim_workouts (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_swim_sessions_user_date ON swim_sessions(userId, date);
`;

function localKey(): string {
  return `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function str(row: Row, key: string): string {
  const value = row[key];
  return value == null ? "" : String(value);
}

function strNull(row: Row, key: string): string | null {
  const value = row[key];
  return value == null ? null : String(value);
}

function num(row: Row, key: string): number {
  return Number(row[key]);
}

function numNull(row: Row, key: string): number | null {
  const value = row[key];
  return value == null ? null : Number(value);
}

function changes(result: RunResult): number {
  return Number(result.changes);
}

function insertedId(result: RunResult): number {
  return Number(result.lastInsertRowid);
}

export class PersonalDb {
  private readonly db: DatabaseSync;

  private constructor(db: DatabaseSync) {
    this.db = db;
  }

  static open(dbPath: string): PersonalDb {
    const db = new DatabaseSync(dbPath);
    const personal = new PersonalDb(db);
    personal.migrate();
    return personal;
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec(SCHEMA);
    this.ensureColumn("swim_workouts", "note", "TEXT NOT NULL DEFAULT ''");
    try {
      this.db.exec("PRAGMA journal_mode = WAL");
    } catch (error) {
      console.error(`Could not enable WAL mode: ${error instanceof Error ? error.message : error}`);
    }
  }

  private ensureColumn(table: string, column: string, decl: string): void {
    const rows = this.db.prepare(`PRAGMA table_info(${table})`).all() as Row[];
    if (!rows.some((row) => row.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
    }
  }

  private transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // The original error is the one the caller needs.
      }
      throw error;
    }
  }

  listCategories(userId: string): Category[] {
    const rows = this.db
      .prepare("SELECT id, remoteId, name, userId FROM categories WHERE userId = ? ORDER BY name")
      .all(userId) as Row[];
    return rows.map(mapCategory);
  }

  getCategory(userId: string, id: number): Category | undefined {
    const row = this.db
      .prepare("SELECT id, remoteId, name, userId FROM categories WHERE userId = ? AND id = ?")
      .get(userId, id) as Row | undefined;
    return row ? mapCategory(row) : undefined;
  }

  createCategory(userId: string, name: string): Category {
    const id = this.ensureNamed("categories", userId, name);
    return this.getCategory(userId, id) as Category;
  }

  renameCategory(userId: string, id: number, name: string): Category | undefined {
    const result = this.db
      .prepare("UPDATE categories SET name = ? WHERE id = ? AND userId = ?")
      .run(name, id, userId) as RunResult;
    if (changes(result) === 0) return undefined;
    return this.getCategory(userId, id);
  }

  deleteCategory(userId: string, id: number): boolean {
    return this.transaction(() => {
      const existing = this.getCategory(userId, id);
      if (!existing) return false;
      this.db.prepare("UPDATE expenses SET categoryId = NULL WHERE categoryId = ? AND userId = ?").run(id, userId);
      this.db.prepare("DELETE FROM categories WHERE id = ? AND userId = ?").run(id, userId);
      return true;
    });
  }

  listVendors(userId: string, categoryId?: number): Vendor[] {
    if (categoryId == null) {
      const rows = this.db
        .prepare("SELECT id, remoteId, name, userId FROM vendors WHERE userId = ? ORDER BY name")
        .all(userId) as Row[];
      return rows.map(mapVendor);
    }
    const rows = this.db
      .prepare(
        `SELECT DISTINCT v.id, v.remoteId, v.name, v.userId
         FROM vendors v
         INNER JOIN expenses e ON e.vendorId = v.id
         WHERE e.categoryId = ? AND e.userId = ?
         ORDER BY v.name`,
      )
      .all(categoryId, userId) as Row[];
    return rows.map(mapVendor);
  }

  getVendor(userId: string, id: number): Vendor | undefined {
    const row = this.db
      .prepare("SELECT id, remoteId, name, userId FROM vendors WHERE userId = ? AND id = ?")
      .get(userId, id) as Row | undefined;
    return row ? mapVendor(row) : undefined;
  }

  createVendor(userId: string, name: string): Vendor {
    const id = this.ensureNamed("vendors", userId, name);
    return this.getVendor(userId, id) as Vendor;
  }

  renameVendor(userId: string, id: number, name: string): Vendor | undefined {
    const result = this.db
      .prepare("UPDATE vendors SET name = ? WHERE id = ? AND userId = ?")
      .run(name, id, userId) as RunResult;
    if (changes(result) === 0) return undefined;
    return this.getVendor(userId, id);
  }

  deleteVendor(userId: string, id: number): boolean {
    return this.transaction(() => {
      const existing = this.getVendor(userId, id);
      if (!existing) return false;
      this.db.prepare("UPDATE expenses SET vendorId = NULL WHERE vendorId = ? AND userId = ?").run(id, userId);
      this.db.prepare("DELETE FROM vendors WHERE id = ? AND userId = ?").run(id, userId);
      return true;
    });
  }

  listExpenses(userId: string, ascending: boolean, categoryId?: number, vendorId?: number): Expense[] {
    const order = ascending ? "ASC" : "DESC";
    if (categoryId == null) {
      const rows = this.db
        .prepare(
          `SELECT e.localId, e.remoteId,
                  COALESCE(v.name, e.vendor, '') as vendor_name,
                  e.vendorId, e.categoryId,
                  COALESCE(cat.name, '') as category_name,
                  e.amount, e.date, e.memo, e.userId
           FROM expenses e
           LEFT JOIN categories cat ON e.categoryId = cat.id
           LEFT JOIN vendors v ON e.vendorId = v.id
           WHERE e.userId = ?
           ORDER BY
             COALESCE(cat.name, 'Uncategorized') ASC,
             CAST(substr(e.date, 1, 4) AS INTEGER) ${order},
             CAST(substr(e.date, 6, 2) AS INTEGER) ${order},
             CAST(substr(e.date, 9, 2) AS INTEGER) ${order}`,
        )
        .all(userId) as Row[];
      return rows.map(mapExpense);
    }

    const rows = this.db
      .prepare(
        `SELECT e.localId, e.remoteId,
                COALESCE(v.name, e.vendor, '') as vendor_name,
                e.vendorId, e.categoryId,
                COALESCE(cat.name, '') as category_name,
                e.amount, e.date, e.memo, e.userId
         FROM expenses e
         LEFT JOIN categories cat ON e.categoryId = cat.id
         LEFT JOIN vendors v ON e.vendorId = v.id
         WHERE e.userId = ?
           AND e.categoryId = ?
           AND (? IS NULL OR e.vendorId = ?)
         ORDER BY
           CAST(substr(e.date, 1, 4) AS INTEGER) ${order},
           CAST(substr(e.date, 6, 2) AS INTEGER) ${order},
           CAST(substr(e.date, 9, 2) AS INTEGER) ${order}`,
      )
      .all(userId, categoryId, vendorId ?? null, vendorId ?? null) as Row[];
    return rows.map(mapExpense);
  }

  getExpense(userId: string, localId: number): Expense | undefined {
    const row = this.db
      .prepare(
        `SELECT e.localId, e.remoteId,
                COALESCE(v.name, e.vendor, '') as vendor_name,
                e.vendorId, e.categoryId,
                COALESCE(cat.name, '') as category_name,
                e.amount, e.date, e.memo, e.userId
         FROM expenses e
         LEFT JOIN categories cat ON e.categoryId = cat.id
         LEFT JOIN vendors v ON e.vendorId = v.id
         WHERE e.userId = ? AND e.localId = ?`,
      )
      .get(userId, localId) as Row | undefined;
    return row ? mapExpense(row) : undefined;
  }

  createExpense(userId: string, input: ExpenseInput): Expense {
    return this.transaction(() => {
      const categoryId = this.ensureNamed("categories", userId, input.categoryName);
      const vendorId = this.ensureNamed("vendors", userId, input.vendorName);
      const result = this.db
        .prepare(
          `INSERT INTO expenses (remoteId, vendor, vendorId, amount, date, memo, categoryId, userId)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(localKey(), input.vendorName, vendorId, input.amount, input.date, input.memo, categoryId, userId) as RunResult;
      return this.getExpense(userId, insertedId(result)) as Expense;
    });
  }

  updateExpense(userId: string, localId: number, input: ExpenseInput): Expense | undefined {
    return this.transaction(() => {
      const existing = this.getExpense(userId, localId);
      if (!existing) return undefined;
      const categoryId = this.ensureNamed("categories", userId, input.categoryName);
      const vendorId = this.ensureNamed("vendors", userId, input.vendorName);
      this.db
        .prepare(
          `UPDATE expenses
           SET vendor = ?, vendorId = ?, amount = ?, date = ?, memo = ?, categoryId = ?
           WHERE localId = ? AND userId = ?`,
        )
        .run(input.vendorName, vendorId, input.amount, input.date, input.memo, categoryId, localId, userId);
      return this.getExpense(userId, localId);
    });
  }

  deleteExpense(userId: string, localId: number): boolean {
    const result = this.db
      .prepare("DELETE FROM expenses WHERE localId = ? AND userId = ?")
      .run(localId, userId) as RunResult;
    return changes(result) > 0;
  }

  listSwimWorkouts(userId: string): SwimWorkout[] {
    const rows = this.db
      .prepare(
        `SELECT w.id, w.remoteId, w.name, COALESCE(w.note, '') AS note, w.userId,
                (SELECT COUNT(*) FROM swim_workout_sets s WHERE s.workoutId = w.id) AS setCount
         FROM swim_workouts w
         WHERE w.userId = ?
         ORDER BY w.name`,
      )
      .all(userId) as Row[];
    return rows.map(mapWorkout);
  }

  getSwimWorkout(userId: string, id: number): SwimWorkoutDetail | undefined {
    const row = this.db
      .prepare(
        `SELECT w.id, w.remoteId, w.name, COALESCE(w.note, '') AS note, w.userId,
                (SELECT COUNT(*) FROM swim_workout_sets s WHERE s.workoutId = w.id) AS setCount
         FROM swim_workouts w
         WHERE w.userId = ? AND w.id = ?`,
      )
      .get(userId, id) as Row | undefined;
    if (!row) return undefined;
    return { ...mapWorkout(row), sets: this.listSwimSets(id) };
  }

  createSwimWorkout(userId: string, name: string, note: string, sets: SwimSetInput[]): SwimWorkoutDetail {
    return this.transaction(() => {
      const remoteId = localKey();
      const result = this.db
        .prepare("INSERT INTO swim_workouts (remoteId, name, userId, note) VALUES (?, ?, ?, ?)")
        .run(remoteId, name, userId, note) as RunResult;
      const id = insertedId(result);
      this.replaceSwimSets(id, remoteId, userId, sets);
      return this.getSwimWorkout(userId, id) as SwimWorkoutDetail;
    });
  }

  updateSwimWorkout(
    userId: string,
    id: number,
    name: string,
    note: string,
    sets: SwimSetInput[] | undefined,
  ): SwimWorkoutDetail | undefined {
    return this.transaction(() => {
      const existing = this.db
        .prepare("SELECT remoteId FROM swim_workouts WHERE id = ? AND userId = ?")
        .get(id, userId) as Row | undefined;
      if (!existing) return undefined;
      this.db.prepare("UPDATE swim_workouts SET name = ?, note = ? WHERE id = ? AND userId = ?").run(name, note, id, userId);
      if (sets !== undefined) this.replaceSwimSets(id, strNull(existing, "remoteId"), userId, sets);
      return this.getSwimWorkout(userId, id);
    });
  }

  deleteSwimWorkout(userId: string, id: number): boolean {
    return this.transaction(() => {
      const existing = this.db.prepare("SELECT id FROM swim_workouts WHERE id = ? AND userId = ?").get(id, userId);
      if (!existing) return false;
      this.db
        .prepare("UPDATE swim_sessions SET workoutId = NULL, remoteWorkoutId = NULL WHERE workoutId = ? AND userId = ?")
        .run(id, userId);
      this.db.prepare("DELETE FROM swim_workout_sets WHERE workoutId = ?").run(id);
      this.db.prepare("DELETE FROM swim_workouts WHERE id = ? AND userId = ?").run(id, userId);
      return true;
    });
  }

  listSwimSessions(userId: string): SwimSession[] {
    const rows = this.db
      .prepare(
        `SELECT s.id, s.remoteId, s.date, s.meters, s.miles, s.stroke, s.note, s.extra,
                s.workoutId, w.name AS workoutName, s.userId
         FROM swim_sessions s
         LEFT JOIN swim_workouts w ON w.id = s.workoutId
         WHERE s.userId = ?
         ORDER BY s.date DESC, s.id DESC`,
      )
      .all(userId) as Row[];
    return rows.map(mapSession);
  }

  getSwimSession(userId: string, id: number): SwimSession | undefined {
    const row = this.db
      .prepare(
        `SELECT s.id, s.remoteId, s.date, s.meters, s.miles, s.stroke, s.note, s.extra,
                s.workoutId, w.name AS workoutName, s.userId
         FROM swim_sessions s
         LEFT JOIN swim_workouts w ON w.id = s.workoutId
         WHERE s.userId = ? AND s.id = ?`,
      )
      .get(userId, id) as Row | undefined;
    return row ? mapSession(row) : undefined;
  }

  createSwimSession(userId: string, input: SwimSessionInput): SwimSession {
    return this.transaction(() => {
      const remoteWorkoutId = this.remoteWorkoutId(userId, input.workoutId);
      const result = this.db
        .prepare(
          `INSERT INTO swim_sessions (
             remoteId, date, meters, miles, stroke, note, extra, workoutId, remoteWorkoutId, userId
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          localKey(),
          input.date,
          input.meters,
          input.miles,
          input.stroke,
          input.note,
          input.extra,
          input.workoutId,
          remoteWorkoutId,
          userId,
        ) as RunResult;
      return this.getSwimSession(userId, insertedId(result)) as SwimSession;
    });
  }

  updateSwimSession(userId: string, id: number, input: SwimSessionInput): SwimSession | undefined {
    return this.transaction(() => {
      const existing = this.getSwimSession(userId, id);
      if (!existing) return undefined;
      const remoteWorkoutId = this.remoteWorkoutId(userId, input.workoutId);
      this.db
        .prepare(
          `UPDATE swim_sessions
           SET date = ?, meters = ?, miles = ?, stroke = ?, note = ?, extra = ?, workoutId = ?, remoteWorkoutId = ?
           WHERE id = ? AND userId = ?`,
        )
        .run(
          input.date,
          input.meters,
          input.miles,
          input.stroke,
          input.note,
          input.extra,
          input.workoutId,
          remoteWorkoutId,
          id,
          userId,
        );
      return this.getSwimSession(userId, id);
    });
  }

  deleteSwimSession(userId: string, id: number): boolean {
    const result = this.db
      .prepare("DELETE FROM swim_sessions WHERE id = ? AND userId = ?")
      .run(id, userId) as RunResult;
    return changes(result) > 0;
  }

  private listSwimSets(workoutId: number): SwimSet[] {
    const rows = this.db
      .prepare(
        `SELECT id, remoteId, workoutId, distance, description, splitTotal, equipment, fins, sortOrder
         FROM swim_workout_sets
         WHERE workoutId = ?
         ORDER BY sortOrder, id`,
      )
      .all(workoutId) as Row[];
    return rows.map(mapSet);
  }

  private replaceSwimSets(workoutId: number, remoteWorkoutId: string | null, userId: string, sets: SwimSetInput[]): void {
    this.db.prepare("DELETE FROM swim_workout_sets WHERE workoutId = ?").run(workoutId);
    const insert = this.db.prepare(
      `INSERT INTO swim_workout_sets (
         remoteId, workoutId, remoteWorkoutId, distance, description, splitTotal, equipment, fins, sortOrder, userId
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    sets.forEach((set, index) => {
      insert.run(
        localKey(),
        workoutId,
        remoteWorkoutId,
        set.distance,
        set.description,
        set.splitTotal,
        set.equipment,
        set.fins,
        index,
        userId,
      );
    });
  }

  private remoteWorkoutId(userId: string, workoutId: number | null): string | null {
    if (workoutId == null) return null;
    const row = this.db
      .prepare("SELECT remoteId FROM swim_workouts WHERE id = ? AND userId = ?")
      .get(workoutId, userId) as Row | undefined;
    if (!row) throw new ApiError(400, "workoutId was not found");
    return strNull(row, "remoteId");
  }

  private ensureNamed(table: "categories" | "vendors", userId: string, name: string): number {
    const existing = this.db
      .prepare(`SELECT id FROM ${table} WHERE name = ? AND userId = ?`)
      .get(name, userId) as Row | undefined;
    if (existing) return num(existing, "id");
    const result = this.db
      .prepare(`INSERT INTO ${table} (remoteId, name, userId) VALUES (?, ?, ?)`)
      .run(localKey(), name, userId) as RunResult;
    return insertedId(result);
  }
}

function mapCategory(row: Row): Category {
  return { id: num(row, "id"), remoteId: strNull(row, "remoteId"), name: str(row, "name"), userId: str(row, "userId") };
}

function mapVendor(row: Row): Vendor {
  return { id: num(row, "id"), remoteId: strNull(row, "remoteId"), name: str(row, "name"), userId: str(row, "userId") };
}

function mapExpense(row: Row): Expense {
  return {
    localId: num(row, "localId"),
    remoteId: strNull(row, "remoteId"),
    vendorName: str(row, "vendor_name"),
    vendorId: numNull(row, "vendorId"),
    categoryId: numNull(row, "categoryId"),
    categoryName: str(row, "category_name"),
    amount: str(row, "amount"),
    date: str(row, "date"),
    memo: strNull(row, "memo"),
    userId: str(row, "userId"),
  };
}

function mapWorkout(row: Row): SwimWorkout {
  return {
    id: num(row, "id"),
    remoteId: strNull(row, "remoteId"),
    name: str(row, "name"),
    note: str(row, "note"),
    setCount: num(row, "setCount"),
    userId: str(row, "userId"),
  };
}

function mapSet(row: Row): SwimSet {
  return {
    id: num(row, "id"),
    remoteId: strNull(row, "remoteId"),
    workoutId: num(row, "workoutId"),
    distance: str(row, "distance"),
    description: str(row, "description"),
    splitTotal: str(row, "splitTotal"),
    equipment: str(row, "equipment"),
    fins: str(row, "fins"),
    sortOrder: num(row, "sortOrder"),
  };
}

function mapSession(row: Row): SwimSession {
  return {
    id: num(row, "id"),
    remoteId: strNull(row, "remoteId"),
    date: str(row, "date"),
    meters: str(row, "meters"),
    miles: str(row, "miles"),
    stroke: str(row, "stroke"),
    note: str(row, "note"),
    extra: str(row, "extra"),
    workoutId: numNull(row, "workoutId"),
    workoutName: strNull(row, "workoutName"),
    userId: str(row, "userId"),
  };
}
