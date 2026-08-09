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

    Ok(conn)
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
