mod db;
mod firebase;

use db::{Category, Vendor, ExpenseWithCategory};
use firebase::FirebaseClient;
use std::sync::Mutex;
use serde_json::{json, Value};
use tauri::State;
use std::path::Path;
use rusqlite::params;

struct DbState(Mutex<rusqlite::Connection>);
struct FirebaseState(FirebaseClient);

// Helper to parse simple key=value from .env files
fn parse_env_file() -> (String, String, String) {
    let mut db_url = "https://fogcitymarathoner-default-rtdb.firebaseio.com".to_string();
    let mut service_account = "C:\\Users\\marc\\Documents\\repos\\firebase_pw\\fogcitymarathoner-2a35f802a83d.json".to_string();
    let mut default_uid = "mXJ3yvoUxNUGle4v0Y1JmlKSWSQ2".to_string();

    let env_paths = [
        "C:\\Users\\marc\\Documents\\repos\\firebase_pw\\.env",
        ".env",
        "../.env",
    ];

    for path in env_paths {
        if Path::new(path).exists() {
            if let Ok(content) = std::fs::read_to_string(path) {
                for line in content.lines() {
                    let parts: Vec<&str> = line.split('=').collect();
                    if parts.len() == 2 {
                        let key = parts[0].trim();
                        let value = parts[1].trim();
                        if key == "DATABASE_URL" {
                            db_url = value.to_string();
                        } else if key == "SERVICE_ACCOUNT_FILE" {
                            // If it's a relative path, make it absolute to the repo root
                            if !value.contains('\\') && !value.contains('/') {
                                service_account = format!("C:\\Users\\marc\\Documents\\repos\\firebase_pw\\{}", value);
                            } else {
                                service_account = value.to_string();
                            }
                        } else if key == "USER_UID" {
                            default_uid = value.to_string();
                        }
                    }
                }
                break;
            }
        }
    }

    (db_url, service_account, default_uid)
}

// ── General & User Commands ──────────────────────────────────────────────

#[tauri::command]
async fn is_firebase_available(firebase: State<'_, FirebaseState>) -> Result<bool, String> {
    Ok(firebase.0.is_available())
}

#[tauri::command]
async fn get_users(firebase: State<'_, FirebaseState>) -> Result<Vec<String>, String> {
    if !firebase.0.is_available() {
        return Ok(vec![]);
    }
    match firebase.0.get("users").await {
        Ok(Value::Object(map)) => {
            let keys: Vec<String> = map.keys().cloned().collect();
            Ok(keys)
        }
        Ok(_) => Ok(vec![]),
        Err(e) => Err(e),
    }
}

#[tauri::command]
async fn get_default_uid() -> Result<String, String> {
    let (_, _, default_uid) = parse_env_file();
    Ok(default_uid)
}

// ── Password Commands ──────────────────────────────────────────────────

#[tauri::command]
async fn load_passwords(uid: String, firebase: State<'_, FirebaseState>) -> Result<Value, String> {
    if !firebase.0.is_available() {
        return Err("Firebase not available".to_string());
    }
    firebase.0.get(&format!("users/{}/passwords", uid)).await
}

#[tauri::command]
async fn add_password(
    uid: String,
    vendor: String,
    account: String,
    pw: String,
    memo: String,
    firebase: State<'_, FirebaseState>,
) -> Result<String, String> {
    if !firebase.0.is_available() {
        return Err("Firebase not available".to_string());
    }
    let data = json!({
        "vendor": vendor,
        "account": account,
        "pw": pw,
        "memo": memo,
    });
    firebase.0.push(&format!("users/{}/passwords", uid), &data).await
}

#[tauri::command]
async fn update_password(
    uid: String,
    id: String,
    vendor: String,
    account: String,
    pw: String,
    memo: String,
    firebase: State<'_, FirebaseState>,
) -> Result<(), String> {
    if !firebase.0.is_available() {
        return Err("Firebase not available".to_string());
    }
    let data = json!({
        "vendor": vendor,
        "account": account,
        "pw": pw,
        "memo": memo,
    });
    firebase.0.update(&format!("users/{}/passwords/{}", uid, id), &data).await
}

#[tauri::command]
async fn delete_password(
    uid: String,
    id: String,
    firebase: State<'_, FirebaseState>,
) -> Result<(), String> {
    if !firebase.0.is_available() {
        return Err("Firebase not available".to_string());
    }
    firebase.0.delete(&format!("users/{}/passwords/{}", uid, id)).await
}

// ── Subscription Commands ──────────────────────────────────────────────

#[tauri::command]
async fn load_subscriptions(uid: String, firebase: State<'_, FirebaseState>) -> Result<Value, String> {
    if !firebase.0.is_available() {
        return Err("Firebase not available".to_string());
    }
    firebase.0.get(&format!("users/{}/subscriptions", uid)).await
}

#[tauri::command]
async fn add_subscription(
    uid: String,
    name: String,
    account: String,
    amount: String,
    due_date: String,
    memo: String,
    period: String,
    status: String,
    firebase: State<'_, FirebaseState>,
) -> Result<String, String> {
    if !firebase.0.is_available() {
        return Err("Firebase not available".to_string());
    }
    let data = json!({
        "name": name,
        "account": account,
        "amount": amount,
        "dueDate": due_date,
        "memo": memo,
        "period": period,
        "status": status,
    });
    firebase.0.push(&format!("users/{}/subscriptions", uid), &data).await
}

#[tauri::command]
async fn update_subscription(
    uid: String,
    id: String,
    name: String,
    account: String,
    amount: String,
    due_date: String,
    memo: String,
    period: String,
    status: String,
    firebase: State<'_, FirebaseState>,
) -> Result<(), String> {
    if !firebase.0.is_available() {
        return Err("Firebase not available".to_string());
    }
    let data = json!({
        "name": name,
        "account": account,
        "amount": amount,
        "dueDate": due_date,
        "memo": memo,
        "period": period,
        "status": status,
    });
    firebase.0.update(&format!("users/{}/subscriptions/{}", uid, id), &data).await
}

#[tauri::command]
async fn delete_subscription(
    uid: String,
    id: String,
    firebase: State<'_, FirebaseState>,
) -> Result<(), String> {
    if !firebase.0.is_available() {
        return Err("Firebase not available".to_string());
    }
    firebase.0.delete(&format!("users/{}/subscriptions/{}", uid, id)).await
}

// ── Expense Local DB & Cloud Sync Commands ────────────────────────────────

#[tauri::command]
async fn get_categories(uid: String, db: State<'_, DbState>) -> Result<Vec<Category>, String> {
    let conn = db.0.lock().unwrap();
    db::get_categories(&conn, &uid).map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_vendors(uid: String, db: State<'_, DbState>) -> Result<Vec<Vendor>, String> {
    let conn = db.0.lock().unwrap();
    db::get_vendors(&conn, &uid).map_err(|e| e.to_string())
}

#[tauri::command]
async fn add_category(
    uid: String,
    name: String,
    db: State<'_, DbState>,
    firebase: State<'_, FirebaseState>,
) -> Result<i32, String> {
    let remote_id = if firebase.0.is_available() {
        let data = json!({ "name": name });
        match firebase.0.push(&format!("users/{}/categories", uid), &data).await {
            Ok(key) => Some(key),
            Err(_) => None,
        }
    } else {
        None
    };

    let conn = db.0.lock().unwrap();
    let local_id_str;
    let remote_id_str = match remote_id {
        Some(ref rid) => rid.as_str(),
        None => {
            local_id_str = format!("local_{}", chrono::Utc::now().timestamp_millis());
            &local_id_str
        }
    };
    db::upsert_category(&conn, Some(remote_id_str), &name, &uid).map_err(|e| e.to_string())
}

#[tauri::command]
async fn rename_category(
    uid: String,
    _cat_id: i32,
    remote_id: Option<String>,
    name: String,
    db: State<'_, DbState>,
    firebase: State<'_, FirebaseState>,
) -> Result<i32, String> {
    if firebase.0.is_available() {
        if let Some(ref rid) = remote_id {
            if !rid.starts_with("local_") {
                let data = json!({ "name": name });
                let _ = firebase.0.update(&format!("users/{}/categories/{}", uid, rid), &data).await;
            }
        }
    }
    let conn = db.0.lock().unwrap();
    db::upsert_category(&conn, remote_id.as_deref(), &name, &uid).map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_category(
    uid: String,
    cat_id: i32,
    remote_id: Option<String>,
    db: State<'_, DbState>,
    firebase: State<'_, FirebaseState>,
) -> Result<(), String> {
    if firebase.0.is_available() {
        if let Some(ref rid) = remote_id {
            if !rid.starts_with("local_") {
                let _ = firebase.0.delete(&format!("users/{}/categories/{}", uid, rid)).await;
            }
        }
    }
    let conn = db.0.lock().unwrap();
    db::delete_category(&conn, cat_id, &uid).map_err(|e| e.to_string())
}

#[tauri::command]
async fn add_vendor(
    uid: String,
    name: String,
    db: State<'_, DbState>,
    firebase: State<'_, FirebaseState>,
) -> Result<i32, String> {
    let remote_id = if firebase.0.is_available() {
        let data = json!({ "name": name });
        match firebase.0.push(&format!("users/{}/vendors", uid), &data).await {
            Ok(key) => Some(key),
            Err(_) => None,
        }
    } else {
        None
    };

    let conn = db.0.lock().unwrap();
    let local_id_str;
    let remote_id_str = match remote_id {
        Some(ref rid) => rid.as_str(),
        None => {
            local_id_str = format!("local_{}", chrono::Utc::now().timestamp_millis());
            &local_id_str
        }
    };
    db::upsert_vendor(&conn, Some(remote_id_str), &name, &uid).map_err(|e| e.to_string())
}

#[tauri::command]
async fn rename_vendor(
    uid: String,
    _vendor_id: i32,
    remote_id: Option<String>,
    name: String,
    db: State<'_, DbState>,
    firebase: State<'_, FirebaseState>,
) -> Result<i32, String> {
    if firebase.0.is_available() {
        if let Some(ref rid) = remote_id {
            if !rid.starts_with("local_") {
                let data = json!({ "name": name });
                let _ = firebase.0.update(&format!("users/{}/vendors/{}", uid, rid), &data).await;
            }
        }
    }
    let conn = db.0.lock().unwrap();
    db::upsert_vendor(&conn, remote_id.as_deref(), &name, &uid).map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_vendor(
    uid: String,
    vendor_id: i32,
    remote_id: Option<String>,
    db: State<'_, DbState>,
    firebase: State<'_, FirebaseState>,
) -> Result<(), String> {
    let remote_expense_ids: Vec<String> = {
        let conn = db.0.lock().unwrap();
        let mut stmt = conn.prepare("SELECT remoteId FROM expenses WHERE vendorId = ? AND userId = ?").unwrap();
        stmt.query_map([vendor_id, vendor_id], |row| row.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .filter_map(|r: Option<String>| r)
            .collect()
    };

    if firebase.0.is_available() {
        for rid in remote_expense_ids {
            if !rid.starts_with("local_") {
                let data = json!({ "vendor": "", "remoteVendorId": null });
                let _ = firebase.0.update(&format!("users/{}/expenses/{}", uid, rid), &data).await;
            }
        }

        if let Some(ref rid) = remote_id {
            if !rid.starts_with("local_") {
                let _ = firebase.0.delete(&format!("users/{}/vendors/{}", uid, rid)).await;
            }
        }
    }

    let conn = db.0.lock().unwrap();
    let _ = conn.execute("UPDATE expenses SET vendor = '' WHERE vendorId = ? AND userId = ?", params![vendor_id, uid]);
    db::delete_vendor(&conn, vendor_id, &uid).map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_vendors_by_category(
    uid: String,
    category_id: i32,
    db: State<'_, DbState>,
) -> Result<Vec<Vendor>, String> {
    let conn = db.0.lock().unwrap();
    db::get_vendors_by_category(&conn, category_id, &uid).map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_expenses_by_category_and_vendor(
    uid: String,
    category_id: i32,
    vendor_id: Option<i32>,
    ascending: bool,
    db: State<'_, DbState>,
) -> Result<Vec<ExpenseWithCategory>, String> {
    let conn = db.0.lock().unwrap();
    db::get_expenses_by_category_and_vendor(&conn, category_id, vendor_id, &uid, ascending).map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_expenses_with_categories(
    uid: String,
    ascending: bool,
    db: State<'_, DbState>,
) -> Result<Vec<ExpenseWithCategory>, String> {
    let conn = db.0.lock().unwrap();
    db::get_expenses_with_categories(&conn, &uid, ascending).map_err(|e| e.to_string())
}

#[tauri::command]
async fn add_expense(
    uid: String,
    vendor_name: String,
    amount: String,
    date: String,
    memo: String,
    category_name: String,
    db: State<'_, DbState>,
    firebase: State<'_, FirebaseState>,
) -> Result<(), String> {
    // 1. Resolve category_id and remote_category_id
    let (category_id, mut remote_category_id) = {
        let conn = db.0.lock().unwrap();
        let category = db::get_category_by_name(&conn, &category_name, &uid).unwrap();
        if let Some(cat) = category {
            (cat.id.unwrap(), cat.remote_id)
        } else {
            (0, None)
        }
    };

    if category_id == 0 && firebase.0.is_available() {
        let rc_id = firebase.0.push(&format!("users/{}/categories", uid), &json!({ "name": category_name })).await.ok();
        remote_category_id = rc_id;
    }

    let category_id = {
        let conn = db.0.lock().unwrap();
        let remote_id_str = remote_category_id.clone().unwrap_or_else(|| format!("local_{}", chrono::Utc::now().timestamp_millis()));
        db::upsert_category(&conn, Some(&remote_id_str), &category_name, &uid).unwrap()
    };

    // 2. Resolve vendor_id and remote_vendor_id
    let (vendor_id, mut remote_vendor_id) = {
        let conn = db.0.lock().unwrap();
        let vendor = db::get_vendor_by_name(&conn, &vendor_name, &uid).unwrap();
        if let Some(ven) = vendor {
            (ven.id.unwrap(), ven.remote_id)
        } else {
            (0, None)
        }
    };

    if vendor_id == 0 && firebase.0.is_available() {
        let rv_id = firebase.0.push(&format!("users/{}/vendors", uid), &json!({ "name": vendor_name })).await.ok();
        remote_vendor_id = rv_id;
    }

    let vendor_id = {
        let conn = db.0.lock().unwrap();
        let remote_id_str = remote_vendor_id.clone().unwrap_or_else(|| format!("local_{}", chrono::Utc::now().timestamp_millis()));
        db::upsert_vendor(&conn, Some(&remote_id_str), &vendor_name, &uid).unwrap()
    };

    // 3. Push to Firebase
    let remote_id = if firebase.0.is_available() {
        let exp_data = json!({
            "vendor": vendor_name,
            "remoteVendorId": remote_vendor_id,
            "amount": amount,
            "date": date,
            "memo": memo,
            "remoteCategoryId": remote_category_id,
        });
        firebase.0.push(&format!("users/{}/expenses", uid), &exp_data).await.ok()
    } else {
        None
    };

    // 4. Save to DB
    let conn = db.0.lock().unwrap();
    let remote_id_str = remote_id.unwrap_or_else(|| format!("local_{}", chrono::Utc::now().timestamp_millis()));

    db::upsert_expense(
        &conn,
        Some(&remote_id_str),
        Some(&vendor_name),
        Some(vendor_id),
        &amount,
        &date,
        Some(&memo),
        Some(category_id),
        &uid,
    ).map_err(|e| e.to_string())
}

#[tauri::command]
async fn update_expense(
    uid: String,
    _local_id: i32,
    remote_id: Option<String>,
    vendor_name: String,
    amount: String,
    date: String,
    memo: String,
    category_name: String,
    db: State<'_, DbState>,
    firebase: State<'_, FirebaseState>,
) -> Result<(), String> {
    // 1. Resolve category
    let (category_id, mut remote_category_id) = {
        let conn = db.0.lock().unwrap();
        let category = db::get_category_by_name(&conn, &category_name, &uid).unwrap();
        if let Some(cat) = category {
            (cat.id.unwrap(), cat.remote_id)
        } else {
            (0, None)
        }
    };

    if category_id == 0 && firebase.0.is_available() {
        let rc_id = firebase.0.push(&format!("users/{}/categories", uid), &json!({ "name": category_name })).await.ok();
        remote_category_id = rc_id;
    }

    let category_id = {
        let conn = db.0.lock().unwrap();
        let remote_id_str = remote_category_id.clone().unwrap_or_else(|| format!("local_{}", chrono::Utc::now().timestamp_millis()));
        db::upsert_category(&conn, Some(&remote_id_str), &category_name, &uid).unwrap()
    };

    // 2. Resolve vendor
    let (vendor_id, mut remote_vendor_id) = {
        let conn = db.0.lock().unwrap();
        let vendor = db::get_vendor_by_name(&conn, &vendor_name, &uid).unwrap();
        if let Some(ven) = vendor {
            (ven.id.unwrap(), ven.remote_id)
        } else {
            (0, None)
        }
    };

    if vendor_id == 0 && firebase.0.is_available() {
        let rv_id = firebase.0.push(&format!("users/{}/vendors", uid), &json!({ "name": vendor_name })).await.ok();
        remote_vendor_id = rv_id;
    }

    let vendor_id = {
        let conn = db.0.lock().unwrap();
        let remote_id_str = remote_vendor_id.clone().unwrap_or_else(|| format!("local_{}", chrono::Utc::now().timestamp_millis()));
        db::upsert_vendor(&conn, Some(&remote_id_str), &vendor_name, &uid).unwrap()
    };

    // 3. Update Firebase
    if firebase.0.is_available() {
        if let Some(ref rid) = remote_id {
            if !rid.starts_with("local_") {
                let exp_data = json!({
                    "vendor": vendor_name,
                    "remoteVendorId": remote_vendor_id,
                    "amount": amount,
                    "date": date,
                    "memo": memo,
                    "remoteCategoryId": remote_category_id,
                });
                let _ = firebase.0.update(&format!("users/{}/expenses/{}", uid, rid), &exp_data).await;
            }
        }
    }

    // 4. Update in local DB
    let conn = db.0.lock().unwrap();
    db::upsert_expense(
        &conn,
        remote_id.as_deref(),
        Some(&vendor_name),
        Some(vendor_id),
        &amount,
        &date,
        Some(&memo),
        Some(category_id),
        &uid,
    ).map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_expense(
    uid: String,
    local_id: i32,
    remote_id: Option<String>,
    db: State<'_, DbState>,
    firebase: State<'_, FirebaseState>,
) -> Result<(), String> {
    if firebase.0.is_available() {
        if let Some(ref rid) = remote_id {
            if !rid.starts_with("local_") {
                let _ = firebase.0.delete(&format!("users/{}/expenses/{}", uid, rid)).await;
            }
        }
    }
    let conn = db.0.lock().unwrap();
    db::delete_expense(&conn, local_id).map_err(|e| e.to_string())
}

// ── TWO-WAY CLOUD SYNC LOOP ─────────────────────────────────────────────

#[tauri::command]
async fn sync_all(uid: String, db: State<'_, DbState>, firebase: State<'_, FirebaseState>) -> Result<String, String> {
    if !firebase.0.is_available() {
        return Err("Firebase not available".to_string());
    }

    // 1. Fetch from Firebase first (async)
    let cats_val = firebase.0.get(&format!("users/{}/categories", uid)).await.map_err(|e| format!("Failed to fetch categories: {}", e))?;
    let vendors_val = firebase.0.get(&format!("users/{}/vendors", uid)).await.map_err(|e| format!("Failed to fetch vendors: {}", e))?;
    let exps_val = firebase.0.get(&format!("users/{}/expenses", uid)).await.map_err(|e| format!("Failed to fetch expenses: {}", e))?;

    // 2. Lock and Sync locally
    let conn = db.0.lock().unwrap();

    // Sync Categories
    let mut remote_cat_ids = std::collections::HashSet::new();
    if let Value::Object(map) = cats_val {
        for (rid, d) in map {
            remote_cat_ids.insert(rid.clone());
            if let Some(name) = d.get("name").and_then(|n| n.as_str()) {
                let _ = db::upsert_category(&conn, Some(&rid), name, &uid);
            }
        }
    }

    // Delete local categories that have been deleted from Firebase
    let local_categories = db::get_categories(&conn, &uid).unwrap_or_default();
    for cat in local_categories {
        if let Some(ref rid) = cat.remote_id {
            if !rid.starts_with("local_") && !remote_cat_ids.contains(rid) {
                if let Some(id) = cat.id {
                    let _ = db::delete_category(&conn, id, &uid);
                }
            }
        }
    }

    // Sync Vendors
    let mut remote_vendors_by_name = std::collections::HashMap::new();
    let mut remote_vendor_ids = std::collections::HashSet::new();
    if let Value::Object(map) = vendors_val {
        for (rid, d) in map {
            remote_vendor_ids.insert(rid.clone());
            if let Some(name) = d.get("name").and_then(|n| n.as_str()) {
                let _ = db::upsert_vendor(&conn, Some(&rid), name, &uid);
                remote_vendors_by_name.insert(name.trim().to_lowercase(), rid);
            }
        }
    }

    // Delete local vendors that have been deleted from Firebase
    let local_vendors = db::get_vendors(&conn, &uid).unwrap_or_default();
    for vendor in local_vendors {
        if let Some(ref rid) = vendor.remote_id {
            if !rid.starts_with("local_") && !remote_vendor_ids.contains(rid) {
                if let Some(id) = vendor.id {
                    let _ = db::delete_vendor(&conn, id, &uid);
                }
            }
        }
    }

    // Sync Expenses
    let mut remote_expense_ids = std::collections::HashSet::new();
    if let Value::Object(map) = exps_val {
        for (rid, d) in map {
            remote_expense_ids.insert(rid.clone());
            let rcat = d.get("remoteCategoryId").and_then(|c| c.as_str());
            let lcat = if let Some(rc) = rcat {
                db::get_category_by_remote(&conn, rc).ok().flatten()
            } else {
                None
            };

            let mut rvendor = d.get("remoteVendorId").and_then(|v| v.as_str()).map(|s| s.to_string());
            let vendor_name = d.get("vendor").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();

            // Repair legacy expenses having a vendor name but no remoteVendorId (just like the Python script!)
            if rvendor.is_none() && !vendor_name.is_empty() {
                let key = vendor_name.to_lowercase();
                if let Some(rv) = remote_vendors_by_name.get(&key) {
                    rvendor = Some(rv.clone());
                    if let Ok(Some(local_v)) = db::get_vendor_by_name(&conn, &vendor_name, &uid) {
                        let _ = conn.execute(
                            "UPDATE vendors SET remoteId = ? WHERE id = ?",
                            params![rv, local_v.id],
                        );
                    } else {
                        let _ = db::upsert_vendor(&conn, Some(&rv), &vendor_name, &uid);
                    }
                }
            }

            let lvendor = if let Some(ref rv) = rvendor {
                db::get_vendor_by_remote(&conn, rv).ok().flatten()
            } else {
                None
            };

            let amount = d.get("amount").and_then(|a| a.as_str()).unwrap_or("0.00");
            let date = d.get("date").and_then(|d| d.as_str()).unwrap_or("");
            let memo = d.get("memo").and_then(|m| m.as_str());

            let _ = db::upsert_expense(
                &conn,
                Some(&rid),
                if !vendor_name.is_empty() { Some(&vendor_name) } else { None },
                lvendor.and_then(|v| v.id),
                amount,
                date,
                memo,
                lcat.and_then(|c| c.id),
                &uid,
            );
        }
    }

    // Delete local expenses that have been deleted from Firebase
    let local_expenses = db::get_expenses_with_categories(&conn, &uid, true).unwrap_or_default();
    for exp in local_expenses {
        if let Some(ref rid) = exp.remote_id {
            if !rid.starts_with("local_") && !remote_expense_ids.contains(rid) {
                if let Some(id) = exp.local_id {
                    let _ = db::delete_expense(&conn, id);
                }
            }
        }
    }

    Ok("✅ Sync Complete".to_string())
}

// ── Tauri Mobile & Desktop Run Config ─────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let (db_url, service_account, _) = parse_env_file();
    
    // SQLite local connection path
    let db_path = "C:\\Users\\marc\\Documents\\repos\\firebase_pw\\personal_assistant.db";
    let db_conn = db::init_db(db_path).expect("Failed to initialize SQLite local database");

    // Initialize Firebase client
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    let firebase_client = rt.block_on(FirebaseClient::new(&service_account, &db_url));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(DbState(Mutex::new(db_conn)))
        .manage(FirebaseState(firebase_client))
        .invoke_handler(tauri::generate_handler![
            is_firebase_available,
            get_users,
            get_default_uid,
            load_passwords,
            add_password,
            update_password,
            delete_password,
            load_subscriptions,
            add_subscription,
            update_subscription,
            delete_subscription,
            get_categories,
            get_vendors,
            add_category,
            rename_category,
            delete_category,
            add_vendor,
            rename_vendor,
            delete_vendor,
            get_vendors_by_category,
            get_expenses_by_category_and_vendor,
            get_expenses_with_categories,
            add_expense,
            update_expense,
            delete_expense,
            sync_all
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
