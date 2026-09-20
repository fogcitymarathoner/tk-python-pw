use crate::db::{self, SwimSession, SwimWorkout, SwimWorkoutSet};
use crate::firebase::FirebaseClient;
use crate::{DbState, FirebaseState};
use rusqlite::{params, Connection};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::Path;
use tauri::State;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwimSetInput {
    pub distance: String,
    pub description: String,
    pub split_total: String,
    pub equipment: String,
    pub fins: String,
}

fn local_id() -> String {
    format!("local_{}", chrono::Utc::now().timestamp_millis())
}

fn json_str(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

#[tauri::command]
pub async fn list_swim_sessions(uid: String, db: State<'_, DbState>) -> Result<Vec<SwimSession>, String> {
    let conn = db.0.lock().unwrap();
    db::list_swim_sessions(&conn, &uid).map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn list_swim_workouts(uid: String, db: State<'_, DbState>) -> Result<Vec<SwimWorkout>, String> {
    let conn = db.0.lock().unwrap();
    db::list_swim_workouts(&conn, &uid).map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn list_swim_sets(workout_id: i32, db: State<'_, DbState>) -> Result<Vec<SwimWorkoutSet>, String> {
    let conn = db.0.lock().unwrap();
    db::list_swim_sets(&conn, workout_id).map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn save_swim_session(
    uid: String,
    id: Option<i32>,
    remote_id: Option<String>,
    date: String,
    meters: String,
    miles: String,
    stroke: String,
    note: String,
    extra: String,
    workout_id: Option<i32>,
    import_key: Option<String>,
    db: State<'_, DbState>,
    firebase: State<'_, FirebaseState>,
) -> Result<SwimSession, String> {
    let remote_workout_id = {
        let conn = db.0.lock().unwrap();
        workout_id.and_then(|wid| db::get_swim_workout(&conn, wid).ok()?.remote_id)
    };

    let payload = json!({
        "date": date,
        "meters": meters,
        "miles": miles,
        "stroke": stroke,
        "note": note,
        "extra": extra,
        "remoteWorkoutId": remote_workout_id,
        "importKey": import_key,
    });

    let remote = if firebase.0.is_available() {
        if let Some(ref rid) = remote_id {
            if !rid.starts_with("local_") {
                let _ = firebase
                    .0
                    .update(&format!("users/{}/swimSessions/{}", uid, rid), &payload)
                    .await;
                Some(rid.clone())
            } else {
                firebase
                    .0
                    .push(&format!("users/{}/swimSessions", uid), &payload)
                    .await
                    .ok()
            }
        } else {
            firebase
                .0
                .push(&format!("users/{}/swimSessions", uid), &payload)
                .await
                .ok()
        }
    } else {
        remote_id.clone()
    };

    let conn = db.0.lock().unwrap();
    let stored_remote = remote.unwrap_or_else(local_id);
    let local_id = if let Some(existing) = id {
        conn.execute(
            "UPDATE swim_sessions
             SET remoteId=?, date=?, meters=?, miles=?, stroke=?, note=?, extra=?,
                 workoutId=?, remoteWorkoutId=?
             WHERE id=? AND userId=?",
            params![
                stored_remote,
                date,
                meters,
                miles,
                stroke,
                note,
                extra,
                workout_id,
                remote_workout_id,
                existing,
                uid
            ],
        )
        .map_err(|err| err.to_string())?;
        existing
    } else {
        db::upsert_swim_session(
            &conn,
            Some(&stored_remote),
            &date,
            &meters,
            &miles,
            &stroke,
            &note,
            &extra,
            workout_id,
            remote_workout_id.as_deref(),
            &uid,
            import_key.as_deref(),
        )
        .map_err(|err| err.to_string())?
    };
    db::get_swim_session(&conn, local_id).map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn delete_swim_session(
    uid: String,
    id: i32,
    db: State<'_, DbState>,
    firebase: State<'_, FirebaseState>,
) -> Result<(), String> {
    let remote_id = {
        let conn = db.0.lock().unwrap();
        db::get_swim_session(&conn, id)
            .ok()
            .and_then(|session| session.remote_id)
    };
    if firebase.0.is_available() {
        if let Some(rid) = remote_id {
            if !rid.starts_with("local_") {
                let _ = firebase
                    .0
                    .delete(&format!("users/{}/swimSessions/{}", uid, rid))
                    .await;
            }
        }
    }
    let conn = db.0.lock().unwrap();
    db::delete_swim_session(&conn, id, &uid).map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn save_swim_workout(
    uid: String,
    id: Option<i32>,
    remote_id: Option<String>,
    name: String,
    note: Option<String>,
    sets: Vec<SwimSetInput>,
    import_key: Option<String>,
    db: State<'_, DbState>,
    firebase: State<'_, FirebaseState>,
) -> Result<SwimWorkout, String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("Name the workout.".to_string());
    }
    let note = note.unwrap_or_default();

    let workout_payload = json!({ "name": name, "note": note, "importKey": import_key });
    let remote = if firebase.0.is_available() {
        if let Some(ref rid) = remote_id {
            if !rid.starts_with("local_") {
                let _ = firebase
                    .0
                    .update(&format!("users/{}/swimWorkouts/{}", uid, rid), &workout_payload)
                    .await;
                Some(rid.clone())
            } else {
                firebase
                    .0
                    .push(&format!("users/{}/swimWorkouts", uid), &workout_payload)
                    .await
                    .ok()
            }
        } else {
            firebase
                .0
                .push(&format!("users/{}/swimWorkouts", uid), &workout_payload)
                .await
                .ok()
        }
    } else {
        remote_id.clone()
    };
    let stored_remote = remote.unwrap_or_else(local_id);

    let workout_id = {
        let conn = db.0.lock().unwrap();
        if let Some(existing) = id {
            conn.execute(
                "UPDATE swim_workouts SET remoteId=?, name=?, note=? WHERE id=? AND userId=?",
                params![stored_remote, name, note, existing, uid],
            )
            .map_err(|err| err.to_string())?;
            existing
        } else {
            db::upsert_swim_workout(
                &conn,
                Some(&stored_remote),
                &name,
                &uid,
                import_key.as_deref(),
                Some(note.as_str()),
            )
            .map_err(|err| err.to_string())?
        }
    };

    if firebase.0.is_available() {
        let existing_sets = firebase
            .0
            .get(&format!("users/{}/swimWorkoutSets", uid))
            .await
            .unwrap_or(Value::Null);
        if let Value::Object(map) = existing_sets {
            for (rid, value) in map {
                if value.get("remoteWorkoutId").and_then(|v| v.as_str()) == Some(stored_remote.as_str())
                {
                    let _ = firebase
                        .0
                        .delete(&format!("users/{}/swimWorkoutSets/{}", uid, rid))
                        .await;
                }
            }
        }
    }

    let mut stored_sets = Vec::new();
    for (index, set) in sets.iter().enumerate() {
        let set_payload = json!({
            "remoteWorkoutId": stored_remote,
            "distance": set.distance,
            "description": set.description,
            "splitTotal": set.split_total,
            "equipment": set.equipment,
            "fins": set.fins,
            "sortOrder": index,
        });
        let set_remote = if firebase.0.is_available() {
            firebase
                .0
                .push(&format!("users/{}/swimWorkoutSets", uid), &set_payload)
                .await
                .ok()
        } else {
            None
        };
        stored_sets.push(SwimWorkoutSet {
            id: 0,
            remote_id: Some(set_remote.unwrap_or_else(local_id)),
            workout_id,
            distance: set.distance.clone(),
            description: set.description.clone(),
            split_total: set.split_total.clone(),
            equipment: set.equipment.clone(),
            fins: set.fins.clone(),
            sort_order: index as i32,
        });
    }

    let conn = db.0.lock().unwrap();
    db::replace_swim_sets(&conn, workout_id, Some(&stored_remote), &uid, &stored_sets)
        .map_err(|err| err.to_string())?;
    db::get_swim_workout(&conn, workout_id).map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn delete_swim_workout(
    uid: String,
    id: i32,
    db: State<'_, DbState>,
    firebase: State<'_, FirebaseState>,
) -> Result<(), String> {
    let remote_id = {
        let conn = db.0.lock().unwrap();
        db::get_swim_workout(&conn, id)
            .ok()
            .and_then(|workout| workout.remote_id)
    };
    if firebase.0.is_available() {
        if let Some(ref rid) = remote_id {
            if !rid.starts_with("local_") {
                let _ = firebase
                    .0
                    .delete(&format!("users/{}/swimWorkouts/{}", uid, rid))
                    .await;
                if let Ok(Value::Object(map)) = firebase
                    .0
                    .get(&format!("users/{}/swimWorkoutSets", uid))
                    .await
                {
                    for (set_rid, value) in map {
                        if value.get("remoteWorkoutId").and_then(|v| v.as_str()) == Some(rid) {
                            let _ = firebase
                                .0
                                .delete(&format!("users/{}/swimWorkoutSets/{}", uid, set_rid))
                                .await;
                        }
                    }
                }
            }
        }
    }
    let conn = db.0.lock().unwrap();
    db::delete_swim_workout(&conn, id, &uid).map_err(|err| err.to_string())
}

pub async fn sync_swim(uid: &str, db: &DbState, firebase: &FirebaseClient) -> Result<(), String> {
    let workouts_val = firebase
        .get(&format!("users/{}/swimWorkouts", uid))
        .await
        .unwrap_or(Value::Null);
    let sets_val = firebase
        .get(&format!("users/{}/swimWorkoutSets", uid))
        .await
        .unwrap_or(Value::Null);
    let sessions_val = firebase
        .get(&format!("users/{}/swimSessions", uid))
        .await
        .unwrap_or(Value::Null);

    let conn = db.0.lock().unwrap();

    let mut remote_workout_ids = HashSet::new();
    if let Value::Object(map) = workouts_val {
        for (rid, data) in map {
            remote_workout_ids.insert(rid.clone());
            let name = json_str(&data, "name");
            if !name.is_empty() {
                let import_key = json_str(&data, "importKey");
                let note = json_str(&data, "note");
                let _ = db::upsert_swim_workout(
                    &conn,
                    Some(&rid),
                    &name,
                    uid,
                    if import_key.is_empty() {
                        None
                    } else {
                        Some(import_key.as_str())
                    },
                    if note.is_empty() { None } else { Some(note.as_str()) },
                );
            }
        }
    }
    for workout in db::list_swim_workouts(&conn, uid).unwrap_or_default() {
        if let Some(ref rid) = workout.remote_id {
            if !rid.starts_with("local_") && !remote_workout_ids.contains(rid) {
                let _ = db::delete_swim_workout(&conn, workout.id, uid);
            }
        }
    }

    if let Value::Object(map) = sets_val {
        let mut by_workout: std::collections::HashMap<i32, Vec<SwimWorkoutSet>> =
            std::collections::HashMap::new();
        for (rid, data) in map {
            let remote_workout_id = json_str(&data, "remoteWorkoutId");
            let Some(workout) = db::get_swim_workout_by_remote(&conn, &remote_workout_id)
                .ok()
                .flatten()
            else {
                continue;
            };
            by_workout.entry(workout.id).or_default().push(SwimWorkoutSet {
                id: 0,
                remote_id: Some(rid),
                workout_id: workout.id,
                distance: json_str(&data, "distance"),
                description: json_str(&data, "description"),
                split_total: json_str(&data, "splitTotal"),
                equipment: json_str(&data, "equipment"),
                fins: json_str(&data, "fins"),
                sort_order: data.get("sortOrder").and_then(|v| v.as_i64()).unwrap_or(0) as i32,
            });
        }
        for (workout_id, mut sets) in by_workout {
            sets.sort_by_key(|set| set.sort_order);
            let remote_workout_id = db::get_swim_workout(&conn, workout_id)
                .ok()
                .and_then(|workout| workout.remote_id);
            let _ = db::replace_swim_sets(
                &conn,
                workout_id,
                remote_workout_id.as_deref(),
                uid,
                &sets,
            );
        }
    }

    let mut remote_session_ids = HashSet::new();
    if let Value::Object(map) = sessions_val {
        for (rid, data) in map {
            remote_session_ids.insert(rid.clone());
            let remote_workout_id = json_str(&data, "remoteWorkoutId");
            let workout_id = if remote_workout_id.is_empty() {
                None
            } else {
                db::get_swim_workout_by_remote(&conn, &remote_workout_id)
                    .ok()
                    .flatten()
                    .map(|workout| workout.id)
            };
            let import_key = json_str(&data, "importKey");
            let _ = db::upsert_swim_session(
                &conn,
                Some(&rid),
                &json_str(&data, "date"),
                &json_str(&data, "meters"),
                &json_str(&data, "miles"),
                &json_str(&data, "stroke"),
                &json_str(&data, "note"),
                &json_str(&data, "extra"),
                workout_id,
                if remote_workout_id.is_empty() {
                    None
                } else {
                    Some(remote_workout_id.as_str())
                },
                uid,
                if import_key.is_empty() {
                    None
                } else {
                    Some(import_key.as_str())
                },
            );
        }
    }
    for session in db::list_swim_sessions(&conn, uid).unwrap_or_default() {
        if let Some(ref rid) = session.remote_id {
            if !rid.starts_with("local_") && !remote_session_ids.contains(rid) {
                let _ = db::delete_swim_session(&conn, session.id, uid);
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn import_swim_from_sheet(
    uid: String,
    source_path: Option<String>,
    db: State<'_, DbState>,
    firebase: State<'_, FirebaseState>,
) -> Result<String, String> {
    let path = source_path.unwrap_or_else(|| {
        "C:\\Users\\marc\\Documents\\repos\\googleRRGWorkspace\\data\\google-sheet.sqlite"
            .to_string()
    });
    if !Path::new(&path).exists() {
        return Err(format!(
            "Sheet snapshot not found at {path}. Run npm run sync:sheet in googleRRGWorkspace first."
        ));
    }

    struct SheetWorkout {
        source_id: i64,
        name: String,
        sets: Vec<SwimSetInput>,
    }
    struct SheetSession {
        source_id: i64,
        date: String,
        meters: String,
        miles: String,
        stroke: String,
        note: String,
        extra: String,
        source_workout_id: Option<i64>,
    }

    let (sheet_workouts, sheet_sessions) = {
        let source = Connection::open(&path).map_err(|err| err.to_string())?;
        let mut workout_stmt = source
            .prepare("SELECT id, name FROM workouts ORDER BY id")
            .map_err(|err| err.to_string())?;
        let workouts = workout_stmt
            .query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)))
            .map_err(|err| err.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|err| err.to_string())?;
        drop(workout_stmt);

        let mut sheet_workouts = Vec::new();
        for (source_id, name) in workouts {
            let mut set_stmt = source
                .prepare(
                    "SELECT distance, description, split_total, equipment, fins
                     FROM workout_sets WHERE workout_id = ? ORDER BY source_row",
                )
                .map_err(|err| err.to_string())?;
            let sets = set_stmt
                .query_map([source_id], |row| {
                    Ok(SwimSetInput {
                        distance: row.get(0)?,
                        description: row.get(1)?,
                        split_total: row.get(2)?,
                        equipment: row.get(3)?,
                        fins: row.get(4)?,
                    })
                })
                .map_err(|err| err.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|err| err.to_string())?;
            sheet_workouts.push(SheetWorkout {
                source_id,
                name,
                sets,
            });
        }

        let mut log_stmt = source
            .prepare(
                "SELECT id, date, km, stroke, miles, note, extra, workout_id
                 FROM sheet_log ORDER BY source_row",
            )
            .map_err(|err| err.to_string())?;
        let sheet_sessions = log_stmt
            .query_map([], |row| {
                Ok(SheetSession {
                    source_id: row.get(0)?,
                    date: row.get(1)?,
                    meters: row.get(2)?,
                    stroke: row.get(3)?,
                    miles: row.get(4)?,
                    note: row.get(5)?,
                    extra: row.get(6)?,
                    source_workout_id: row.get(7)?,
                })
            })
            .map_err(|err| err.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|err| err.to_string())?;
        (sheet_workouts, sheet_sessions)
    };

    let mut imported_workouts = 0;
    let mut imported_sessions = 0;

    for workout in sheet_workouts {
        let import_key = format!("sheet-workout:{}", workout.source_id);
        let already = {
            let conn = db.0.lock().unwrap();
            db::get_swim_workout_by_import_key(&conn, &uid, &import_key)
                .map_err(|err| err.to_string())?
        };
        if already.is_some() {
            continue;
        }

        save_swim_workout(
            uid.clone(),
            None,
            None,
            workout.name,
            None,
            workout.sets,
            Some(import_key),
            db.clone(),
            firebase.clone(),
        )
        .await?;
        imported_workouts += 1;
    }

    for session in sheet_sessions {
        if session.date.trim().is_empty()
            && session.meters.trim().is_empty()
            && session.note.trim().is_empty()
        {
            continue;
        }
        let import_key = format!("sheet-log:{}", session.source_id);
        let already = {
            let conn = db.0.lock().unwrap();
            db::get_swim_session_by_import_key(&conn, &uid, &import_key)
                .map_err(|err| err.to_string())?
        };
        if already.is_some() {
            continue;
        }
        let workout_id = if let Some(source_wid) = session.source_workout_id {
            let conn = db.0.lock().unwrap();
            db::get_swim_workout_by_import_key(&conn, &uid, &format!("sheet-workout:{source_wid}"))
                .ok()
                .flatten()
        } else {
            None
        };
        save_swim_session(
            uid.clone(),
            None,
            None,
            session.date,
            session.meters,
            session.miles,
            session.stroke,
            session.note,
            session.extra,
            workout_id,
            Some(import_key),
            db.clone(),
            firebase.clone(),
        )
        .await?;
        imported_sessions += 1;
    }

    Ok(format!(
        "Imported {imported_workouts} workouts and {imported_sessions} sessions from the sheet snapshot."
    ))
}
