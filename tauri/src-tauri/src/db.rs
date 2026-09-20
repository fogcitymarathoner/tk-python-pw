use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Category {
    pub id: Option<i32>,
    pub remote_id: Option<String>,
    pub name: String,
    pub user_id: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Vendor {
    pub id: Option<i32>,
    pub remote_id: Option<String>,
    pub name: String,
    pub user_id: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Expense {
    pub local_id: Option<i32>,
    pub remote_id: Option<String>,
    pub vendor: Option<String>,
    pub vendor_id: Option<i32>,
    pub category_id: Option<i32>,
    pub amount: String,
    pub date: String,
    pub memo: Option<String>,
    pub user_id: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExpenseWithCategory {
    pub local_id: Option<i32>,
    pub remote_id: Option<String>,
    pub vendor_name: String,
    pub vendor_id: Option<i32>,
    pub category_id: Option<i32>,
    pub category_name: String,
    pub amount: String,
    pub date: String,
    pub memo: Option<String>,
    pub user_id: String,
}

pub fn init_db(db_path: &str) -> Result<Connection> {
    let conn = Connection::open(db_path)?;
    
    // Enable foreign keys
    conn.execute("PRAGMA foreign_keys = ON;", [])?;

    // Categories table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            remoteId TEXT,
            name TEXT NOT NULL,
            userId TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )",
        [],
    )?;

    // Vendors table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS vendors (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            remoteId TEXT,
            name TEXT NOT NULL,
            userId TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )",
        [],
    )?;

    // Expenses table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS expenses (
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
        )",
        [],
    )?;

    conn.execute("CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date)", [])?;
    conn.execute("CREATE INDEX IF NOT EXISTS idx_expenses_user_date ON expenses(userId, date)", [])?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS swim_workouts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            remoteId TEXT,
            name TEXT NOT NULL,
            note TEXT NOT NULL DEFAULT '',
            userId TEXT NOT NULL,
            importKey TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )",
        [],
    )?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS swim_workout_sets (
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
        )",
        [],
    )?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS swim_sessions (
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
        )",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_swim_sessions_user_date ON swim_sessions(userId, date)",
        [],
    )?;
    ensure_column(&conn, "swim_workouts", "note", "TEXT NOT NULL DEFAULT ''")?;

    Ok(conn)
}

fn ensure_column(conn: &Connection, table: &str, column: &str, decl: &str) -> Result<()> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let exists = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .filter_map(|name| name.ok())
        .any(|name| name == column);
    if !exists {
        conn.execute(&format!("ALTER TABLE {table} ADD COLUMN {column} {decl}"), [])?;
    }
    Ok(())
}

// ── Vendor DB Actions ──────────────────────────────────────────────────

pub fn get_vendors(conn: &Connection, user_id: &str) -> Result<Vec<Vendor>> {
    let mut stmt = conn.prepare("SELECT id, remoteId, name, userId FROM vendors WHERE userId = ? ORDER BY name")?;
    let rows = stmt.query_map([user_id], |row| {
        Ok(Vendor {
            id: Some(row.get(0)?),
            remote_id: row.get(1)?,
            name: row.get(2)?,
            user_id: row.get(3)?,
        })
    })?;

    let mut vendors = Vec::new();
    for row in rows {
        vendors.push(row?);
    }
    Ok(vendors)
}

pub fn get_vendor_by_remote(conn: &Connection, remote_id: &str) -> Result<Option<Vendor>> {
    let mut stmt = conn.prepare("SELECT id, remoteId, name, userId FROM vendors WHERE remoteId = ?")?;
    let mut rows = stmt.query_map([remote_id], |row| {
        Ok(Vendor {
            id: Some(row.get(0)?),
            remote_id: row.get(1)?,
            name: row.get(2)?,
            user_id: row.get(3)?,
        })
    })?;

    if let Some(row) = rows.next() {
        Ok(Some(row?))
    } else {
        Ok(None)
    }
}

pub fn get_vendor_by_name(conn: &Connection, name: &str, user_id: &str) -> Result<Option<Vendor>> {
    let mut stmt = conn.prepare("SELECT id, remoteId, name, userId FROM vendors WHERE name = ? AND userId = ?")?;
    let mut rows = stmt.query_map([name, user_id], |row| {
        Ok(Vendor {
            id: Some(row.get(0)?),
            remote_id: row.get(1)?,
            name: row.get(2)?,
            user_id: row.get(3)?,
        })
    })?;

    if let Some(row) = rows.next() {
        Ok(Some(row?))
    } else {
        Ok(None)
    }
}

pub fn upsert_vendor(conn: &Connection, remote_id: Option<&str>, name: &str, user_id: &str) -> Result<i32> {
    if let Some(rid) = remote_id {
        let mut stmt = conn.prepare("SELECT id FROM vendors WHERE remoteId = ?")?;
        let exists = stmt.exists([rid])?;
        if exists {
            conn.execute(
                "UPDATE vendors SET name = ? WHERE remoteId = ?",
                params![name, rid],
            )?;
            let id: i32 = conn.query_row("SELECT id FROM vendors WHERE remoteId = ?", [rid], |r| r.get(0))?;
            return Ok(id);
        }
    }

    conn.execute(
        "INSERT INTO vendors (remoteId, name, userId) VALUES (?, ?, ?)",
        params![remote_id, name, user_id],
    )?;
    let id = conn.last_insert_rowid() as i32;
    Ok(id)
}

pub fn delete_vendor(conn: &Connection, vendor_id: i32, user_id: &str) -> Result<()> {
    conn.execute(
        "UPDATE expenses SET vendorId = NULL WHERE vendorId = ? AND userId = ?",
        params![vendor_id, user_id],
    )?;
    conn.execute(
        "DELETE FROM vendors WHERE id = ? AND userId = ?",
        params![vendor_id, user_id],
    )?;
    Ok(())
}

// ── Category DB Actions ────────────────────────────────────────────────

pub fn get_categories(conn: &Connection, user_id: &str) -> Result<Vec<Category>> {
    let mut stmt = conn.prepare("SELECT id, remoteId, name, userId FROM categories WHERE userId = ? ORDER BY name")?;
    let rows = stmt.query_map([user_id], |row| {
        Ok(Category {
            id: Some(row.get(0)?),
            remote_id: row.get(1)?,
            name: row.get(2)?,
            user_id: row.get(3)?,
        })
    })?;

    let mut categories = Vec::new();
    for row in rows {
        categories.push(row?);
    }
    Ok(categories)
}

pub fn get_category_by_remote(conn: &Connection, remote_id: &str) -> Result<Option<Category>> {
    let mut stmt = conn.prepare("SELECT id, remoteId, name, userId FROM categories WHERE remoteId = ?")?;
    let mut rows = stmt.query_map([remote_id], |row| {
        Ok(Category {
            id: Some(row.get(0)?),
            remote_id: row.get(1)?,
            name: row.get(2)?,
            user_id: row.get(3)?,
        })
    })?;

    if let Some(row) = rows.next() {
        Ok(Some(row?))
    } else {
        Ok(None)
    }
}

pub fn get_category_by_name(conn: &Connection, name: &str, user_id: &str) -> Result<Option<Category>> {
    let mut stmt = conn.prepare("SELECT id, remoteId, name, userId FROM categories WHERE name = ? AND userId = ?")?;
    let mut rows = stmt.query_map([name, user_id], |row| {
        Ok(Category {
            id: Some(row.get(0)?),
            remote_id: row.get(1)?,
            name: row.get(2)?,
            user_id: row.get(3)?,
        })
    })?;

    if let Some(row) = rows.next() {
        Ok(Some(row?))
    } else {
        Ok(None)
    }
}

pub fn upsert_category(conn: &Connection, remote_id: Option<&str>, name: &str, user_id: &str) -> Result<i32> {
    if let Some(rid) = remote_id {
        let mut stmt = conn.prepare("SELECT id FROM categories WHERE remoteId = ?")?;
        let exists = stmt.exists([rid])?;
        if exists {
            conn.execute(
                "UPDATE categories SET name = ? WHERE remoteId = ?",
                params![name, rid],
            )?;
            let id: i32 = conn.query_row("SELECT id FROM categories WHERE remoteId = ?", [rid], |r| r.get(0))?;
            return Ok(id);
        }
    }

    conn.execute(
        "INSERT INTO categories (remoteId, name, userId) VALUES (?, ?, ?)",
        params![remote_id, name, user_id],
    )?;
    let id = conn.last_insert_rowid() as i32;
    Ok(id)
}

pub fn delete_category(conn: &Connection, category_id: i32, user_id: &str) -> Result<()> {
    conn.execute(
        "UPDATE expenses SET categoryId = NULL WHERE categoryId = ? AND userId = ?",
        params![category_id, user_id],
    )?;
    conn.execute(
        "DELETE FROM categories WHERE id = ? AND userId = ?",
        params![category_id, user_id],
    )?;
    Ok(())
}

// ── Expense DB Actions ──────────────────────────────────────────────────

pub fn get_vendors_by_category(conn: &Connection, category_id: i32, user_id: &str) -> Result<Vec<Vendor>> {
    let mut stmt = conn.prepare(
        "SELECT DISTINCT v.id, v.remoteId, v.name, v.userId
         FROM vendors v
         INNER JOIN expenses e ON e.vendorId = v.id
         WHERE e.categoryId = ? AND e.userId = ?
         ORDER BY v.name"
    )?;
    let rows = stmt.query_map(params![category_id, user_id], |row| {
        Ok(Vendor {
            id: Some(row.get(0)?),
            remote_id: row.get(1)?,
            name: row.get(2)?,
            user_id: row.get(3)?,
        })
    })?;

    let mut vendors = Vec::new();
    for row in rows {
        vendors.push(row?);
    }
    Ok(vendors)
}

pub fn get_expenses_by_category_and_vendor(
    conn: &Connection,
    category_id: i32,
    vendor_id: Option<i32>,
    user_id: &str,
    ascending: bool,
) -> Result<Vec<ExpenseWithCategory>> {
    let order = if ascending { "ASC" } else { "DESC" };
    
    let query = format!(
        "SELECT e.localId, e.remoteId, 
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
             CAST(substr(e.date, 1, 4) AS INTEGER) {order},
             CAST(substr(e.date, 6, 2) AS INTEGER) {order},
             CAST(substr(e.date, 9, 2) AS INTEGER) {order}",
        order = order
    );

    let mut stmt = conn.prepare(&query)?;
    let rows = stmt.query_map(params![user_id, category_id, vendor_id, vendor_id], |row| {
        Ok(ExpenseWithCategory {
            local_id: Some(row.get(0)?),
            remote_id: row.get(1)?,
            vendor_name: row.get(2)?,
            vendor_id: row.get(3)?,
            category_id: row.get(4)?,
            category_name: row.get(5)?,
            amount: row.get(6)?,
            date: row.get(7)?,
            memo: row.get(8)?,
            user_id: row.get(9)?,
        })
    })?;

    let mut expenses = Vec::new();
    for row in rows {
        expenses.push(row?);
    }
    Ok(expenses)
}

pub fn get_expenses_with_categories(
    conn: &Connection,
    user_id: &str,
    ascending: bool,
) -> Result<Vec<ExpenseWithCategory>> {
    let order = if ascending { "ASC" } else { "DESC" };
    
    let query = format!(
        "SELECT e.localId, e.remoteId, 
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
             CAST(substr(e.date, 1, 4) AS INTEGER) {order},
             CAST(substr(e.date, 6, 2) AS INTEGER) {order},
             CAST(substr(e.date, 9, 2) AS INTEGER) {order}",
        order = order
    );

    let mut stmt = conn.prepare(&query)?;
    let rows = stmt.query_map([user_id], |row| {
        Ok(ExpenseWithCategory {
            local_id: Some(row.get(0)?),
            remote_id: row.get(1)?,
            vendor_name: row.get(2)?,
            vendor_id: row.get(3)?,
            category_id: row.get(4)?,
            category_name: row.get(5)?,
            amount: row.get(6)?,
            date: row.get(7)?,
            memo: row.get(8)?,
            user_id: row.get(9)?,
        })
    })?;

    let mut expenses = Vec::new();
    for row in rows {
        expenses.push(row?);
    }
    Ok(expenses)
}

pub fn upsert_expense(
    conn: &Connection,
    remote_id: Option<&str>,
    vendor_name: Option<&str>,
    vendor_id: Option<i32>,
    amount: &str,
    date: &str,
    memo: Option<&str>,
    category_id: Option<i32>,
    user_id: &str,
) -> Result<()> {
    if let Some(rid) = remote_id {
        let mut stmt = conn.prepare("SELECT localId, vendor FROM expenses WHERE remoteId = ?")?;
        let result: Result<(i32, Option<String>)> = stmt.query_row([rid], |r| Ok((r.get(0)?, r.get(1)?)));
        
        if result.is_ok() {
            if vendor_id.is_none() {
                // Keep the old vendor text, update the rest
                let (_, old_vendor_text) = result.unwrap();
                conn.execute(
                    "UPDATE expenses SET vendor=?, vendorId=?, amount=?, date=?, memo=?, categoryId=? WHERE remoteId=?",
                    params![old_vendor_text, vendor_id, amount, date, memo, category_id, rid],
                )?;
            } else {
                conn.execute(
                    "UPDATE expenses SET vendorId=?, amount=?, date=?, memo=?, categoryId=? WHERE remoteId=?",
                    params![vendor_id, amount, date, memo, category_id, rid],
                )?;
            }
            return Ok(());
        }
    }

    conn.execute(
        "INSERT INTO expenses (remoteId, vendor, vendorId, amount, date, memo, categoryId, userId) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        params![remote_id, vendor_name, vendor_id, amount, date, memo, category_id, user_id],
    )?;
    Ok(())
}

pub fn delete_expense(conn: &Connection, local_id: i32) -> Result<()> {
    conn.execute("DELETE FROM expenses WHERE localId = ?", params![local_id])?;
    Ok(())
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SwimWorkout {
    pub id: i32,
    pub remote_id: Option<String>,
    pub name: String,
    pub note: String,
    pub set_count: i64,
    pub user_id: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SwimWorkoutSet {
    pub id: i32,
    pub remote_id: Option<String>,
    pub workout_id: i32,
    pub distance: String,
    pub description: String,
    pub split_total: String,
    pub equipment: String,
    pub fins: String,
    pub sort_order: i32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SwimSession {
    pub id: i32,
    pub remote_id: Option<String>,
    pub date: String,
    pub meters: String,
    pub miles: String,
    pub stroke: String,
    pub note: String,
    pub extra: String,
    pub workout_id: Option<i32>,
    pub workout_name: Option<String>,
    pub user_id: String,
}

fn map_swim_workout(row: &rusqlite::Row<'_>) -> rusqlite::Result<SwimWorkout> {
    Ok(SwimWorkout {
        id: row.get(0)?,
        remote_id: row.get(1)?,
        name: row.get(2)?,
        note: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
        user_id: row.get(4)?,
        set_count: row.get(5)?,
    })
}

const SWIM_WORKOUT_SELECT: &str = "SELECT w.id, w.remoteId, w.name, COALESCE(w.note, ''), w.userId,
                (SELECT COUNT(*) FROM swim_workout_sets s WHERE s.workoutId = w.id)
         FROM swim_workouts w";

pub fn list_swim_workouts(conn: &Connection, user_id: &str) -> Result<Vec<SwimWorkout>> {
    let mut stmt = conn.prepare(&format!(
        "{SWIM_WORKOUT_SELECT}
         WHERE w.userId = ?
         ORDER BY w.name"
    ))?;
    let rows = stmt.query_map([user_id], map_swim_workout)?;
    rows.collect()
}

pub fn get_swim_workout(conn: &Connection, id: i32) -> Result<SwimWorkout> {
    conn.query_row(
        &format!("{SWIM_WORKOUT_SELECT} WHERE w.id = ?"),
        [id],
        map_swim_workout,
    )
}

pub fn get_swim_workout_by_remote(conn: &Connection, remote_id: &str) -> Result<Option<SwimWorkout>> {
    let mut stmt = conn.prepare(&format!("{SWIM_WORKOUT_SELECT} WHERE w.remoteId = ?"))?;
    let mut rows = stmt.query_map([remote_id], map_swim_workout)?;
    Ok(rows.next().transpose()?)
}

pub fn get_swim_workout_by_import_key(
    conn: &Connection,
    user_id: &str,
    import_key: &str,
) -> Result<Option<i32>> {
    let mut stmt = conn.prepare("SELECT id FROM swim_workouts WHERE userId = ? AND importKey = ?")?;
    let mut rows = stmt.query_map(params![user_id, import_key], |row| row.get(0))?;
    Ok(rows.next().transpose()?)
}

pub fn upsert_swim_workout(
    conn: &Connection,
    remote_id: Option<&str>,
    name: &str,
    user_id: &str,
    import_key: Option<&str>,
    note: Option<&str>,
) -> Result<i32> {
    if let Some(rid) = remote_id {
        let existing: Result<i32> =
            conn.query_row("SELECT id FROM swim_workouts WHERE remoteId = ?", [rid], |r| r.get(0));
        if let Ok(id) = existing {
            conn.execute(
                "UPDATE swim_workouts
                 SET name = ?, importKey = COALESCE(?, importKey), note = COALESCE(?, note)
                 WHERE id = ?",
                params![name, import_key, note, id],
            )?;
            return Ok(id);
        }
    }
    conn.execute(
        "INSERT INTO swim_workouts (remoteId, name, userId, importKey, note) VALUES (?, ?, ?, ?, ?)",
        params![remote_id, name, user_id, import_key, note.unwrap_or("")],
    )?;
    Ok(conn.last_insert_rowid() as i32)
}

pub fn delete_swim_workout(conn: &Connection, id: i32, user_id: &str) -> Result<()> {
    conn.execute(
        "UPDATE swim_sessions SET workoutId = NULL, remoteWorkoutId = NULL WHERE workoutId = ? AND userId = ?",
        params![id, user_id],
    )?;
    conn.execute(
        "DELETE FROM swim_workout_sets WHERE workoutId = ?",
        [id],
    )?;
    conn.execute(
        "DELETE FROM swim_workouts WHERE id = ? AND userId = ?",
        params![id, user_id],
    )?;
    Ok(())
}

pub fn list_swim_sets(conn: &Connection, workout_id: i32) -> Result<Vec<SwimWorkoutSet>> {
    let mut stmt = conn.prepare(
        "SELECT id, remoteId, workoutId, distance, description, splitTotal, equipment, fins, sortOrder
         FROM swim_workout_sets WHERE workoutId = ? ORDER BY sortOrder, id",
    )?;
    let rows = stmt.query_map([workout_id], |row| {
        Ok(SwimWorkoutSet {
            id: row.get(0)?,
            remote_id: row.get(1)?,
            workout_id: row.get(2)?,
            distance: row.get(3)?,
            description: row.get(4)?,
            split_total: row.get(5)?,
            equipment: row.get(6)?,
            fins: row.get(7)?,
            sort_order: row.get(8)?,
        })
    })?;
    rows.collect()
}

pub fn replace_swim_sets(
    conn: &Connection,
    workout_id: i32,
    remote_workout_id: Option<&str>,
    user_id: &str,
    sets: &[SwimWorkoutSet],
) -> Result<()> {
    conn.execute("DELETE FROM swim_workout_sets WHERE workoutId = ?", [workout_id])?;
    for (index, set) in sets.iter().enumerate() {
        conn.execute(
            "INSERT INTO swim_workout_sets (
                remoteId, workoutId, remoteWorkoutId, distance, description,
                splitTotal, equipment, fins, sortOrder, userId
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                set.remote_id,
                workout_id,
                remote_workout_id,
                set.distance,
                set.description,
                set.split_total,
                set.equipment,
                set.fins,
                set.sort_order.max(index as i32),
                user_id
            ],
        )?;
    }
    Ok(())
}

pub fn list_swim_sessions(conn: &Connection, user_id: &str) -> Result<Vec<SwimSession>> {
    let mut stmt = conn.prepare(
        "SELECT s.id, s.remoteId, s.date, s.meters, s.miles, s.stroke, s.note, s.extra,
                s.workoutId, w.name, s.userId
         FROM swim_sessions s
         LEFT JOIN swim_workouts w ON w.id = s.workoutId
         WHERE s.userId = ?
         ORDER BY s.date DESC, s.id DESC",
    )?;
    let rows = stmt.query_map([user_id], |row| {
        Ok(SwimSession {
            id: row.get(0)?,
            remote_id: row.get(1)?,
            date: row.get(2)?,
            meters: row.get(3)?,
            miles: row.get(4)?,
            stroke: row.get(5)?,
            note: row.get(6)?,
            extra: row.get(7)?,
            workout_id: row.get(8)?,
            workout_name: row.get(9)?,
            user_id: row.get(10)?,
        })
    })?;
    rows.collect()
}

pub fn get_swim_session(conn: &Connection, id: i32) -> Result<SwimSession> {
    conn.query_row(
        "SELECT s.id, s.remoteId, s.date, s.meters, s.miles, s.stroke, s.note, s.extra,
                s.workoutId, w.name, s.userId
         FROM swim_sessions s
         LEFT JOIN swim_workouts w ON w.id = s.workoutId
         WHERE s.id = ?",
        [id],
        |row| {
            Ok(SwimSession {
                id: row.get(0)?,
                remote_id: row.get(1)?,
                date: row.get(2)?,
                meters: row.get(3)?,
                miles: row.get(4)?,
                stroke: row.get(5)?,
                note: row.get(6)?,
                extra: row.get(7)?,
                workout_id: row.get(8)?,
                workout_name: row.get(9)?,
                user_id: row.get(10)?,
            })
        },
    )
}

pub fn get_swim_session_by_import_key(
    conn: &Connection,
    user_id: &str,
    import_key: &str,
) -> Result<Option<i32>> {
    let mut stmt = conn.prepare("SELECT id FROM swim_sessions WHERE userId = ? AND importKey = ?")?;
    let mut rows = stmt.query_map(params![user_id, import_key], |row| row.get(0))?;
    Ok(rows.next().transpose()?)
}

pub fn upsert_swim_session(
    conn: &Connection,
    remote_id: Option<&str>,
    date: &str,
    meters: &str,
    miles: &str,
    stroke: &str,
    note: &str,
    extra: &str,
    workout_id: Option<i32>,
    remote_workout_id: Option<&str>,
    user_id: &str,
    import_key: Option<&str>,
) -> Result<i32> {
    if let Some(rid) = remote_id {
        let existing: Result<i32> =
            conn.query_row("SELECT id FROM swim_sessions WHERE remoteId = ?", [rid], |r| r.get(0));
        if let Ok(id) = existing {
            conn.execute(
                "UPDATE swim_sessions
                 SET date=?, meters=?, miles=?, stroke=?, note=?, extra=?,
                     workoutId=?, remoteWorkoutId=?, importKey=COALESCE(?, importKey)
                 WHERE id=?",
                params![
                    date,
                    meters,
                    miles,
                    stroke,
                    note,
                    extra,
                    workout_id,
                    remote_workout_id,
                    import_key,
                    id
                ],
            )?;
            return Ok(id);
        }
    }
    conn.execute(
        "INSERT INTO swim_sessions (
            remoteId, date, meters, miles, stroke, note, extra,
            workoutId, remoteWorkoutId, userId, importKey
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            remote_id,
            date,
            meters,
            miles,
            stroke,
            note,
            extra,
            workout_id,
            remote_workout_id,
            user_id,
            import_key
        ],
    )?;
    Ok(conn.last_insert_rowid() as i32)
}

pub fn delete_swim_session(conn: &Connection, id: i32, user_id: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM swim_sessions WHERE id = ? AND userId = ?",
        params![id, user_id],
    )?;
    Ok(())
}
