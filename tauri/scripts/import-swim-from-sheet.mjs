import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";

const UID = "mXJ3yvoUxNUGle4v0Y1JmlKSWSQ2";
const SRC = "C:/Users/marc/Documents/repos/googleRRGWorkspace/data/google-sheet.sqlite";
const DST = "C:/Users/marc/Documents/repos/firebase_pw/personal_assistant.db";
const DB_URL = "https://fogcitymarathoner-default-rtdb.firebaseio.com";
const SERVICE_ACCOUNT =
  "C:/Users/marc/Documents/repos/firebase_pw/fogcitymarathoner-2a35f802a83d.json";

function milesFromMeters(meters) {
  const value = Number.parseFloat(String(meters).replace(/[^\d.]/g, ""));
  if (!Number.isFinite(value) || !value) return "";
  return ((value / 1000) * 0.62137119).toFixed(2);
}

async function firebaseClient() {
  try {
    const require = createRequire(
      "C:/Users/marc/Documents/repos/googleRRGWorkspace/package.json",
    );
    const { google } = require("googleapis");
    const auth = new google.auth.GoogleAuth({
      keyFile: SERVICE_ACCOUNT,
      scopes: [
        "https://www.googleapis.com/auth/firebase.database",
        "https://www.googleapis.com/auth/userinfo.email",
      ],
    });
    const client = await auth.getClient();
    return {
      async push(path, data) {
        const token = await client.getAccessToken();
        const res = await fetch(`${DB_URL}/${path}.json`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(data),
        });
        if (!res.ok) {
          throw new Error(`Firebase POST ${path} ${res.status}: ${await res.text()}`);
        }
        const body = await res.json();
        if (!body?.name) throw new Error(`Firebase POST ${path} missing name`);
        return body.name;
      },
    };
  } catch (err) {
    console.warn("Firebase unavailable, importing locally only:", err.message);
    return null;
  }
}

const firebase = await firebaseClient();
const src = new DatabaseSync(SRC, { readOnly: true });
const dst = new DatabaseSync(DST);
dst.exec("PRAGMA foreign_keys = ON");

const alreadyWorkouts = dst
  .prepare("SELECT COUNT(*) AS n FROM swim_workouts WHERE userId = ?")
  .get(UID).n;
const alreadySessions = dst
  .prepare("SELECT COUNT(*) AS n FROM swim_sessions WHERE userId = ?")
  .get(UID).n;
if (alreadyWorkouts || alreadySessions) {
  console.log(`Suite already has ${alreadyWorkouts} workouts and ${alreadySessions} sessions. Skipping.`);
  src.close();
  dst.close();
  process.exit(0);
}

const insertWorkout = dst.prepare(
  "INSERT INTO swim_workouts (remoteId, name, userId, importKey) VALUES (?, ?, ?, ?)",
);
const insertSet = dst.prepare(`
  INSERT INTO swim_workout_sets (
    remoteId, workoutId, remoteWorkoutId, distance, description,
    splitTotal, equipment, fins, sortOrder, userId
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const insertSession = dst.prepare(`
  INSERT INTO swim_sessions (
    remoteId, date, meters, miles, stroke, note, extra,
    workoutId, remoteWorkoutId, userId, importKey
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const workouts = src.prepare("SELECT id, name FROM workouts ORDER BY id").all();
const workoutIdBySource = new Map();
let importedWorkouts = 0;
let importedSets = 0;

for (const workout of workouts) {
  const importKey = `sheet-workout:${workout.id}`;
  let remoteId = firebase
    ? await firebase.push(`users/${UID}/swimWorkouts`, {
        name: workout.name,
        importKey,
      })
    : `local_${Date.now()}_${workout.id}`;

  insertWorkout.run(remoteId, workout.name, UID, importKey);
  const localId = dst.prepare("SELECT last_insert_rowid() AS id").get().id;
  workoutIdBySource.set(workout.id, { localId, remoteId });

  const sets = src
    .prepare(
      `SELECT distance, description, split_total, equipment, fins
       FROM workout_sets WHERE workout_id = ? ORDER BY source_row`,
    )
    .all(workout.id);
  for (const [index, set] of sets.entries()) {
    const setRemote = firebase
      ? await firebase.push(`users/${UID}/swimWorkoutSets`, {
          remoteWorkoutId: remoteId,
          distance: set.distance,
          description: set.description,
          splitTotal: set.split_total,
          equipment: set.equipment,
          fins: set.fins,
          sortOrder: index,
        })
      : `local_${Date.now()}_${workout.id}_${index}`;
    insertSet.run(
      setRemote,
      localId,
      remoteId,
      set.distance,
      set.description,
      set.split_total,
      set.equipment,
      set.fins,
      index,
      UID,
    );
    importedSets += 1;
  }
  importedWorkouts += 1;
}

const rows = src
  .prepare(
    `SELECT id, date, km, stroke, miles, note, extra, workout_id
     FROM sheet_log ORDER BY source_row`,
  )
  .all();
let importedSessions = 0;
for (const row of rows) {
  if (!row.date.trim() && !row.km.trim() && !row.note.trim()) continue;
  const importKey = `sheet-log:${row.id}`;
  const linked = row.workout_id == null ? null : workoutIdBySource.get(row.workout_id);
  const miles = String(row.miles || "").trim() || milesFromMeters(row.km);
  const remoteId = firebase
    ? await firebase.push(`users/${UID}/swimSessions`, {
        date: row.date,
        meters: row.km,
        miles,
        stroke: row.stroke,
        note: row.note,
        extra: row.extra,
        remoteWorkoutId: linked?.remoteId ?? null,
        importKey,
      })
    : `local_${Date.now()}_log_${row.id}`;
  insertSession.run(
    remoteId,
    row.date,
    row.km,
    miles,
    row.stroke,
    row.note,
    row.extra,
    linked?.localId ?? null,
    linked?.remoteId ?? null,
    UID,
    importKey,
  );
  importedSessions += 1;
}

src.close();
dst.close();
console.log(
  `Imported ${importedWorkouts} workouts, ${importedSets} sets, ${importedSessions} sessions${
    firebase ? " to SQLite and Firebase" : " to SQLite only"
  }.`,
);
