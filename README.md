# Python TK Is an Abandon App
# Tauri TS is the current APP

# Setup

```
npm install
npm run setup
npm run build:tauri
```

# Desktop Password Manager
Updates Firebase Realtime Database.

## Local SQLite database

The personal-data Tauri app (`tauri/`) keeps **one** SQLite file on disk:

`C:\Users\marc\Documents\repos\firebase_pw\personal_assistant.db`

That file is **not temporary**. It survives closing the app. It is a local working copy of expense data so the UI can load and edit without hitting the network every time.

### What lives where

| Data | SQLite | Firebase |
|---|---|---|
| Categories, vendors, expenses | Yes | Yes (when online) |
| Passwords, subscriptions | No | Yes only |

SQLite tables: `categories`, `vendors`, `expenses`. Each row has a local integer id and a `remoteId` that matches the Firebase key. Offline-created rows get a placeholder id like `local_123…` until they are written to Firebase.

### How the two copies stay in sync

- **Online write** (add/update/delete): write to Firebase first, then write the same change to SQLite.
- **Offline write:** write only to SQLite. The UI still reads from SQLite.
- **Cloud Sync** (`sync_all`): pull categories, vendors, and expenses **from Firebase into SQLite**. If a row exists locally but was deleted in Firebase, sync deletes it locally too. Firebase is the source of truth for already-synced rows.

Offline `local_…` rows are **not** uploaded by Cloud Sync. They stay local until an add/update runs while online.

Passwords and subscriptions never go through SQLite. Offline, those lists are not available locally.

### Code layout

Same database, two Rust files:

- `tauri/src-tauri/src/db.rs` — SQL: open the file, create tables, read/write rows.
- `tauri/src-tauri/src/lib.rs` — app commands: the UI calls these; they lock the shared connection and call `db.rs`. Startup opens the `.db` path above and holds one connection for the process.

## Authentication
Uses google service account.
 
## Running Gemini-cli
```C:\Users\marc\AppData\Roaming\npm\gemini.ps1```

## Running Tauri APP
```aiignore
cd C:\Users\marc\Documents\repos\firebase_pw\tauri
pnpm tauri dev
```