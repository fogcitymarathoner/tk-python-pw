# personal_assistant.py
"""
Unified Personal Assistant - Password Manager, Subscription Tracker, Business Expenses
Integrated Local-First Relational SQLite Sync for Expenses (Mirroring Android Room Schema)
"""

import os
import sqlite3
import tkinter as tk
from tkinter import ttk, simpledialog, messagebox
from datetime import datetime, timedelta
import calendar
import secrets
import string

import firebase_admin
from dotenv import load_dotenv
from firebase_admin import credentials, db

# Load environment variables
load_dotenv()

SERVICE_ACCOUNT_FILE = os.getenv("SERVICE_ACCOUNT_FILE", "fogcitymarathoner-2a35f802a83d.json")
DATABASE_URL = os.getenv("DATABASE_URL", "https://fogcitymarathoner-default-rtdb.firebaseio.com")

# ── Firebase Initialization ──────────────────────────────────────────────

FIREBASE_AVAILABLE = False

try:
    if not firebase_admin._apps:
        if not os.path.exists(SERVICE_ACCOUNT_FILE):
            print(f"⚠️ Service account file not found: {SERVICE_ACCOUNT_FILE}")
            print(f"   Current directory: {os.getcwd()}")

            import glob

            json_files = glob.glob("*.json")
            if json_files:
                print(f"   Available JSON files: {json_files}")
                if json_files and "service" in json_files[0].lower():
                    SERVICE_ACCOUNT_FILE = json_files[0]
                    print(f"   Using fallback: {SERVICE_ACCOUNT_FILE}")
            else:
                print("   No JSON files found. Firebase will be disabled.")
                raise FileNotFoundError("No service account file found")

        if os.path.exists(SERVICE_ACCOUNT_FILE):
            cred = credentials.Certificate(SERVICE_ACCOUNT_FILE)
            firebase_admin.initialize_app(cred, {"databaseURL": DATABASE_URL})
            print(f"✅ Firebase initialized successfully")
            FIREBASE_AVAILABLE = True
        else:
            print("❌ Firebase initialization skipped - no credentials file")

except Exception as e:
    print(f"❌ Firebase init failed: {e}")
    print("   Running in OFFLINE mode (Firebase sync disabled)")
    FIREBASE_AVAILABLE = False


# ── Firebase Helpers ─────────────────────────────────────────────────────

def fb_get(path):
    if not FIREBASE_AVAILABLE:
        return None
    try:
        return db.reference(path).get()
    except Exception as e:
        print(f"❌ Firebase GET error: {e}")
        return None


def fb_push(path, data):
    if not FIREBASE_AVAILABLE:
        class MockRef:
            def __init__(self):
                self.key = f"mock_{datetime.now().timestamp()}"

        return MockRef()
    try:
        return db.reference(path).push(data)
    except Exception as e:
        print(f"❌ Firebase PUSH error: {e}")

        class MockRef:
            def __init__(self):
                self.key = f"mock_{datetime.now().timestamp()}"

        return MockRef()


def fb_update(path, data):
    if not FIREBASE_AVAILABLE:
        return
    try:
        db.reference(path).update(data)
    except Exception as e:
        print(f"❌ Firebase UPDATE error: {e}")


def fb_delete(path):
    if not FIREBASE_AVAILABLE:
        return
    try:
        db.reference(path).delete()
    except Exception as e:
        print(f"❌ Firebase DELETE error: {e}")


# ── SQLite Local Database Class ─────────────────────────────────────────────

class LocalDB:
    def __init__(self, db_name="personal_assistant.db"):
        self.conn = sqlite3.connect(db_name, check_same_thread=False)
        self._create_tables()
        self._migrate_database()

    def _create_tables(self):
        cursor = self.conn.cursor()

        # Categories table
        cursor.execute("""
                       CREATE TABLE IF NOT EXISTS categories
                       (
                           id
                           INTEGER
                           PRIMARY
                           KEY
                           AUTOINCREMENT,
                           remoteId
                           TEXT,
                           name
                           TEXT
                           NOT
                           NULL,
                           userId
                           TEXT
                           NOT
                           NULL,
                           created_at
                           TIMESTAMP
                           DEFAULT
                           CURRENT_TIMESTAMP
                       )
                       """)

        # Vendors table
        cursor.execute("""
                       CREATE TABLE IF NOT EXISTS vendors
                       (
                           id
                           INTEGER
                           PRIMARY
                           KEY
                           AUTOINCREMENT,
                           remoteId
                           TEXT,
                           name
                           TEXT
                           NOT
                           NULL,
                           userId
                           TEXT
                           NOT
                           NULL,
                           created_at
                           TIMESTAMP
                           DEFAULT
                           CURRENT_TIMESTAMP
                       )
                       """)

        # Expenses table
        cursor.execute("""
                       CREATE TABLE IF NOT EXISTS expenses
                       (
                           localId
                           INTEGER
                           PRIMARY
                           KEY
                           AUTOINCREMENT,
                           remoteId
                           TEXT,
                           vendor
                           TEXT,
                           vendorId
                           INTEGER,
                           categoryId
                           INTEGER,
                           amount
                           TEXT,
                           date
                           TEXT,
                           memo
                           TEXT,
                           userId
                           TEXT
                           NOT
                           NULL,
                           created_at
                           TIMESTAMP
                           DEFAULT
                           CURRENT_TIMESTAMP,
                           FOREIGN
                           KEY
                       (
                           categoryId
                       ) REFERENCES categories
                       (
                           id
                       ) ON DELETE SET NULL,
                           FOREIGN
                           KEY
                       (
                           vendorId
                       ) REFERENCES vendors
                       (
                           id
                       )
                         ON DELETE SET NULL
                           )
                       """)

        cursor.execute("CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_expenses_user_date ON expenses(userId, date)")
        self.conn.commit()

    def _migrate_database(self):
        """Migrate existing database to new schema"""
        cursor = self.conn.cursor()

        # Check if vendorId column exists
        cursor.execute("PRAGMA table_info(expenses)")
        columns = [col[1] for col in cursor.fetchall()]

        if 'vendorId' not in columns:
            print("🔄 Migrating database: Adding vendorId column...")

            try:
                # Add vendorId column
                cursor.execute("ALTER TABLE expenses ADD COLUMN vendorId INTEGER")
                self.conn.commit()
                print("✅ Added vendorId column to expenses table")
            except sqlite3.OperationalError as e:
                print(f"⚠️ Could not add vendorId column: {e}")

            # Create vendors table if it doesn't exist
            cursor.execute("""
                           CREATE TABLE IF NOT EXISTS vendors
                           (
                               id
                               INTEGER
                               PRIMARY
                               KEY
                               AUTOINCREMENT,
                               remoteId
                               TEXT,
                               name
                               TEXT
                               NOT
                               NULL,
                               userId
                               TEXT
                               NOT
                               NULL,
                               created_at
                               TIMESTAMP
                               DEFAULT
                               CURRENT_TIMESTAMP
                           )
                           """)
            self.conn.commit()

            # Migrate existing vendor data to vendors table
            try:
                # Get unique vendors from expenses
                cursor.execute("""
                               SELECT DISTINCT vendor, userId
                               FROM expenses
                               WHERE vendor IS NOT NULL
                                 AND vendor != ''
                               """)
                vendors = cursor.fetchall()

                for vendor_name, user_id in vendors:
                    # Check if vendor already exists
                    cursor.execute(
                        "SELECT id FROM vendors WHERE name = ? AND userId = ?",
                        (vendor_name, user_id)
                    )
                    existing = cursor.fetchone()

                    if not existing:
                        # Insert vendor
                        cursor.execute(
                            "INSERT INTO vendors (name, userId) VALUES (?, ?)",
                            (vendor_name, user_id)
                        )
                        vendor_id = cursor.lastrowid

                        # Update expenses with vendorId
                        cursor.execute(
                            "UPDATE expenses SET vendorId = ? WHERE vendor = ? AND userId = ?",
                            (vendor_id, vendor_name, user_id)
                        )

                self.conn.commit()
                print("✅ Vendor data migrated successfully!")
            except Exception as e:
                print(f"⚠️ Could not migrate vendor data: {e}")

    # ── Vendor Methods ──────────────────────────────────────────────────────

    def get_vendors(self, user_id):
        c = self.conn.cursor()
        c.execute("SELECT id, remoteId, name FROM vendors WHERE userId = ? ORDER BY name", (user_id,))
        return c.fetchall()

    def get_vendor_by_remote(self, remote_id):
        c = self.conn.cursor()
        c.execute("SELECT id, name FROM vendors WHERE remoteId = ?", (remote_id,))
        return c.fetchone()

    def get_vendor_by_name(self, name, user_id):
        c = self.conn.cursor()
        c.execute("SELECT id, remoteId FROM vendors WHERE name = ? AND userId = ?", (name, user_id))
        return c.fetchone()

    def upsert_vendor(self, remote_id, name, user_id):
        c = self.conn.cursor()
        c.execute("SELECT id FROM vendors WHERE remoteId = ?", (remote_id,))
        if c.fetchone():
            c.execute("UPDATE vendors SET name=? WHERE remoteId=?", (name, remote_id))
        else:
            c.execute("INSERT INTO vendors (remoteId, name, userId) VALUES (?, ?, ?)", (remote_id, name, user_id))
        self.conn.commit()
        return c.lastrowid

    def delete_vendor(self, vendor_id, user_id):
        c = self.conn.cursor()
        c.execute("UPDATE expenses SET vendorId = NULL WHERE vendorId = ? AND userId = ?", (vendor_id, user_id))
        c.execute("DELETE FROM vendors WHERE id = ? AND userId = ?", (vendor_id, user_id))
        self.conn.commit()

    # ── Category Methods ──────────────────────────────────────────────────

    def get_categories(self, user_id):
        c = self.conn.cursor()
        c.execute("SELECT id, remoteId, name FROM categories WHERE userId = ? ORDER BY name", (user_id,))
        return c.fetchall()

    def get_category_by_remote(self, remote_id):
        c = self.conn.cursor()
        c.execute("SELECT id, name FROM categories WHERE remoteId = ?", (remote_id,))
        return c.fetchone()

    def get_category_by_name(self, name, user_id):
        c = self.conn.cursor()
        c.execute("SELECT id, remoteId FROM categories WHERE name = ? AND userId = ?", (name, user_id))
        return c.fetchone()

    def upsert_category(self, remote_id, name, user_id):
        c = self.conn.cursor()
        c.execute("SELECT id FROM categories WHERE remoteId = ?", (remote_id,))
        if c.fetchone():
            c.execute("UPDATE categories SET name=? WHERE remoteId=?", (name, remote_id))
        else:
            c.execute("INSERT INTO categories (remoteId, name, userId) VALUES (?, ?, ?)", (remote_id, name, user_id))
        self.conn.commit()

    def delete_category(self, category_id, user_id):
        c = self.conn.cursor()
        c.execute("UPDATE expenses SET categoryId = NULL WHERE categoryId = ? AND userId = ?", (category_id, user_id))
        c.execute("DELETE FROM categories WHERE id = ? AND userId = ?", (category_id, user_id))
        self.conn.commit()

    # ── Expense Methods ──────────────────────────────────────────────────

    def get_vendors_by_category(self, category_id, user_id):
        c = self.conn.cursor()
        c.execute("""
                  SELECT DISTINCT v.id, v.remoteId, v.name
                  FROM vendors v
                           INNER JOIN expenses e ON e.vendorId = v.id
                  WHERE e.categoryId = ?
                    AND e.userId = ?
                  ORDER BY v.name
                  """, (category_id, user_id))
        return c.fetchall()

    def get_expenses_by_category_and_vendor(self, category_id, vendor_id, user_id, ascending=True):
        c = self.conn.cursor()
        order = "ASC" if ascending else "DESC"
        c.execute(f"""
            SELECT e.localId, e.remoteId, 
                   COALESCE(v.name, e.vendor, '') as vendor_name, 
                   e.amount, e.date, e.memo, 
                   COALESCE(cat.name, '') as category_name, 
                   e.categoryId
            FROM expenses e 
            LEFT JOIN categories cat ON e.categoryId = cat.id
            LEFT JOIN vendors v ON e.vendorId = v.id
            WHERE e.userId = ? AND e.categoryId = ? AND e.vendorId = ?
            ORDER BY 
                CAST(substr(e.date, 1, 4) AS INTEGER) {order},
                CAST(substr(e.date, 6, 2) AS INTEGER) {order},
                CAST(substr(e.date, 9, 2) AS INTEGER) {order}
        """, (user_id, category_id, vendor_id))
        return c.fetchall()

    def get_expenses_with_categories(self, user_id, ascending=True):
        c = self.conn.cursor()
        order = "ASC" if ascending else "DESC"
        c.execute(f"""
            SELECT e.localId, e.remoteId, 
                   COALESCE(v.name, e.vendor, '') as vendor_name, 
                   e.amount, e.date, e.memo, 
                   COALESCE(cat.name, '') as category_name, 
                   e.categoryId
            FROM expenses e 
            LEFT JOIN categories cat ON e.categoryId = cat.id
            LEFT JOIN vendors v ON e.vendorId = v.id
            WHERE e.userId = ? 
            ORDER BY 
                COALESCE(cat.name, 'Uncategorized') ASC,
                CAST(substr(e.date, 1, 4) AS INTEGER) {order},
                CAST(substr(e.date, 6, 2) AS INTEGER) {order},
                CAST(substr(e.date, 9, 2) AS INTEGER) {order}
        """, (user_id,))
        return c.fetchall()

    def upsert_expense(self, remote_id, vendor_id, amount, dt, memo, category_id, user_id):
        c = self.conn.cursor()
        c.execute("SELECT localId, vendor FROM expenses WHERE remoteId = ?", (remote_id,))
        result = c.fetchone()
        if result:
            if vendor_id is None:
                c.execute("SELECT vendor FROM expenses WHERE remoteId = ?", (remote_id,))
                vendor_text = c.fetchone()[0]
                c.execute(
                    "UPDATE expenses SET vendor=?, vendorId=?, amount=?, date=?, memo=?, categoryId=? WHERE remoteId=?",
                    (vendor_text, vendor_id, str(amount), dt, memo, category_id, remote_id))
            else:
                c.execute("UPDATE expenses SET vendorId=?, amount=?, date=?, memo=?, categoryId=? WHERE remoteId=?",
                          (vendor_id, str(amount), dt, memo, category_id, remote_id))
        else:
            c.execute(
                "INSERT INTO expenses (remoteId, vendorId, amount, date, memo, categoryId, userId) VALUES (?,?,?,?,?,?,?)",
                (remote_id, vendor_id, str(amount), dt, memo, category_id, user_id))
        self.conn.commit()

    def delete_expense(self, local_id):
        c = self.conn.cursor()
        c.execute("DELETE FROM expenses WHERE localId = ?", (local_id,))
        self.conn.commit()


# ── Custom Date Picker ──────────────────────────────────────────────────────

class DatePickerDialog:
    """A custom date picker dialog that positions itself relative to the parent widget"""

    def __init__(self, parent, initial_date=None):
        self.parent = parent
        self.selected_date = None
        self.current_year = datetime.now().year
        self.current_month = datetime.now().month

        if initial_date:
            try:
                if isinstance(initial_date, str):
                    dt = datetime.strptime(initial_date, "%Y-%m-%d")
                else:
                    dt = initial_date
                self.current_year = dt.year
                self.current_month = dt.month
            except:
                pass

        self.dialog = tk.Toplevel(parent)
        self.dialog.title("Select Date")
        self.dialog.resizable(False, False)
        self.dialog.configure(bg="#1e1e2e")

        self._position_dialog()
        self._build_calendar()

        self.dialog.grab_set()
        self.dialog.focus_set()
        self.dialog.bind("<Escape>", lambda e: self.dialog.destroy())
        self.dialog.protocol("WM_DELETE_WINDOW", self.dialog.destroy)

        self.dialog.wait_window()

    def _position_dialog(self):
        parent_x = self.parent.winfo_rootx()
        parent_y = self.parent.winfo_rooty()
        parent_width = self.parent.winfo_width()
        parent_height = self.parent.winfo_height()

        dialog_width = 280
        dialog_height = 260

        x = parent_x + (parent_width - dialog_width) // 2
        y = parent_y + (parent_height - dialog_height) // 2

        screen_width = self.parent.winfo_screenwidth()
        screen_height = self.parent.winfo_screenheight()

        if x < 0:
            x = 10
        if y < 0:
            y = 10
        if x + dialog_width > screen_width:
            x = screen_width - dialog_width - 10
        if y + dialog_height > screen_height:
            y = screen_height - dialog_height - 10

        self.dialog.geometry(f"{dialog_width}x{dialog_height}+{x}+{y}")

    def _build_calendar(self):
        header_frame = tk.Frame(self.dialog, bg="#1e1e2e")
        header_frame.pack(fill="x", padx=10, pady=5)

        self.header_label = tk.Label(
            header_frame,
            text=f"{calendar.month_name[self.current_month]} {self.current_year}",
            font=("Courier", 12, "bold"),
            bg="#1e1e2e",
            fg="#cba6f7"
        )
        self.header_label.pack(side="left", expand=True)

        ttk.Button(header_frame, text="◀", width=3, command=self._prev_month).pack(side="left", padx=2)
        ttk.Button(header_frame, text="▶", width=3, command=self._next_month).pack(side="left", padx=2)

        days_frame = tk.Frame(self.dialog, bg="#1e1e2e")
        days_frame.pack(fill="x", padx=10)

        day_names = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]
        for day in day_names:
            label = tk.Label(
                days_frame,
                text=day,
                font=("Courier", 9, "bold"),
                bg="#1e1e2e",
                fg="#a6e3a1",
                width=4
            )
            label.pack(side="left", expand=True)

        self.calendar_frame = tk.Frame(self.dialog, bg="#1e1e2e")
        self.calendar_frame.pack(fill="both", expand=True, padx=10, pady=5)

        self._draw_calendar()

        btn_frame = tk.Frame(self.dialog, bg="#1e1e2e")
        btn_frame.pack(fill="x", pady=5)

        ttk.Button(btn_frame, text="Today", command=self._select_today).pack(side="left", padx=5)
        ttk.Button(btn_frame, text="Cancel", command=self.dialog.destroy).pack(side="right", padx=5)

    def _draw_calendar(self):
        for widget in self.calendar_frame.winfo_children():
            widget.destroy()

        cal = calendar.monthcalendar(self.current_year, self.current_month)
        today = datetime.now().day
        today_month = datetime.now().month
        today_year = datetime.now().year

        for week in cal:
            week_frame = tk.Frame(self.calendar_frame, bg="#1e1e2e")
            week_frame.pack(fill="x", pady=1)

            for day in week:
                if day == 0:
                    label = tk.Label(
                        week_frame,
                        text="",
                        width=4,
                        height=1,
                        bg="#1e1e2e"
                    )
                    label.pack(side="left", expand=True, fill="both")
                else:
                    is_today = (day == today and
                                self.current_month == today_month and
                                self.current_year == today_year)

                    btn = tk.Button(
                        week_frame,
                        text=str(day),
                        width=4,
                        height=1,
                        bg="#313244" if not is_today else "#45475a",
                        fg="#cdd6f4",
                        activebackground="#45475a",
                        activeforeground="#cba6f7",
                        relief="flat",
                        font=("Courier", 9),
                        command=lambda d=day: self._select_date(d)
                    )
                    if is_today:
                        btn.config(bg="#45475a", fg="#cba6f7")
                    btn.pack(side="left", expand=True, fill="both", padx=1)

    def _prev_month(self):
        if self.current_month == 1:
            self.current_month = 12
            self.current_year -= 1
        else:
            self.current_month -= 1
        self.header_label.config(text=f"{calendar.month_name[self.current_month]} {self.current_year}")
        self._draw_calendar()

    def _next_month(self):
        if self.current_month == 12:
            self.current_month = 1
            self.current_year += 1
        else:
            self.current_month += 1
        self.header_label.config(text=f"{calendar.month_name[self.current_month]} {self.current_year}")
        self._draw_calendar()

    def _select_date(self, day):
        self.selected_date = datetime(self.current_year, self.current_month, day)
        self.dialog.destroy()

    def _select_today(self):
        self.selected_date = datetime.now()
        self.dialog.destroy()


# ── Main Application ──────────────────────────────────────────────────────

class PersonalAssistant(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Personal Assistant (Sync Pro)")
        self.geometry("1400x900")
        self.configure(bg="#1e1e2e")
        self.local_db = LocalDB()
        self.current_uid = None
        self.selected_category_id = None
        self.selected_vendor_id = None
        self.sort_ascending = True
        self._updating_selection = False  # ⭐ Flag to prevent recursive updates

        # Password module data storage
        self.pw_all_data = {}
        self.password_length = tk.IntVar(value=12)

        # Subscription module data storage
        self.sub_all_data = {}
        self.sub_search_v = tk.StringVar()

        # Expense module data storage
        self.vendors_cache = []
        self.category_vendors_cache = []  # Vendors for selected category

        self._configure_styles()
        self._build_ui()
        self._load_users()

    def _configure_styles(self):
        style = ttk.Style(self)
        style.theme_use("clam")
        style.configure("Treeview", background="#2a2a3e", foreground="#cdd6f4", fieldbackground="#2a2a3e", rowheight=28)
        style.configure("Treeview.Heading", background="#313244", foreground="#cba6f7", font=("Courier", 10, "bold"))
        style.map("Treeview", background=[("selected", "#45475a")])
        style.configure("TLabel", background="#1e1e2e", foreground="#cdd6f4", font=("Courier", 10))
        style.configure("TEntry", fieldbackground="#313244", foreground="#cdd6f4", font=("Courier", 10))
        style.configure("TButton", background="#313244", foreground="#cba6f7", font=("Courier", 10, "bold"), padding=4)
        style.configure("TLabelframe", background="#1e1e2e", foreground="#cba6f7")
        style.configure("TLabelframe.Label", background="#1e1e2e", foreground="#cba6f7", font=("Courier", 10, "bold"))
        style.configure("TRadiobutton", background="#1e1e2e", foreground="#cdd6f4", font=("Courier", 10))
        style.configure("TCombobox", fieldbackground="#313244", foreground="#cdd6f4", font=("Courier", 10))

    def _build_ui(self):
        # Top Bar
        top = tk.Frame(self, bg="#1e1e2e")
        top.pack(fill="x", padx=10, pady=10)
        ttk.Label(top, text="User UID:").pack(side="left")
        self.uid_combo = ttk.Combobox(top, width=42, font=("Courier", 10))
        self.uid_combo.pack(side="left", padx=6)
        self.uid_combo.bind("<<ComboboxSelected>>", self._on_user_select)
        ttk.Button(top, text="↻ Reload", command=self._load_users).pack(side="left", padx=4)
        if FIREBASE_AVAILABLE:
            ttk.Button(top, text="☁ Cloud Sync", command=self._sync_all).pack(side="left", padx=4)
        else:
            ttk.Label(top, text="🔌 OFFLINE MODE", foreground="#f9e2af").pack(side="left", padx=10)

        # Tabs
        self.notebook = ttk.Notebook(self)
        self.notebook.pack(fill="both", expand=True, padx=10, pady=5)

        self.password_frame = tk.Frame(self.notebook, bg="#1e1e2e")
        self.subscription_frame = tk.Frame(self.notebook, bg="#1e1e2e")
        self.expense_frame = tk.Frame(self.notebook, bg="#1e1e2e")

        self.notebook.add(self.password_frame, text="🔑 Passwords")
        self.notebook.add(self.subscription_frame, text="📋 Subscriptions")
        self.notebook.add(self.expense_frame, text="💰 Expenses")

        self._build_password_module()
        self._build_subscription_module()
        self._build_expense_module()

        # Status
        self.status_var = tk.StringVar(value="Ready")
        tk.Label(self, textvariable=self.status_var, bg="#181825", fg="#a6e3a1", font=("Courier", 9), anchor="w").pack(
            fill="x")

    def _on_user_select(self, _=None):
        self.current_uid = self.uid_combo.get().strip()
        self._status(f"User: {self.current_uid}")
        self._load_passwords()
        self._load_subscriptions()
        self._refresh_expense_data()
        if FIREBASE_AVAILABLE:
            self.after(500, self._sync_all)

    def _sync_all(self):
        if not self.current_uid or not FIREBASE_AVAILABLE:
            return
        self._status("Syncing...")
        try:
            cats = fb_get(f"users/{self.current_uid}/categories")
            if cats:
                for rid, d in cats.items():
                    self.local_db.upsert_category(rid, d.get("name"), self.current_uid)

            vendors = fb_get(f"users/{self.current_uid}/vendors")
            if vendors:
                for rid, d in vendors.items():
                    self.local_db.upsert_vendor(rid, d.get("name"), self.current_uid)

            remote_vendors_by_name = {
                d.get("name", "").strip().casefold(): rid
                for rid, d in (vendors or {}).items()
                if d.get("name", "").strip()
            }

            exps = fb_get(f"users/{self.current_uid}/expenses")
            if exps:
                for rid, d in exps.items():
                    rcat = d.get("remoteCategoryId")
                    lcat = self.local_db.get_category_by_remote(rcat) if rcat else None
                    rvendor = d.get("remoteVendorId")
                    vendor_name = d.get("vendor", "").strip()

                    # Repair legacy expenses that have a vendor name but no
                    # remoteVendorId. Create the remote vendor when necessary.
                    if not rvendor and vendor_name:
                        rvendor = remote_vendors_by_name.get(vendor_name.casefold())
                        if not rvendor:
                            vendor_ref = fb_push(
                                f"users/{self.current_uid}/vendors",
                                {"name": vendor_name}
                            )
                            rvendor = vendor_ref.key
                            remote_vendors_by_name[vendor_name.casefold()] = rvendor

                        local_vendor = self.local_db.get_vendor_by_name(vendor_name, self.current_uid)
                        if local_vendor:
                            cursor = self.local_db.conn.cursor()
                            cursor.execute(
                                "UPDATE vendors SET remoteId = ? WHERE id = ?",
                                (rvendor, local_vendor[0])
                            )
                            self.local_db.conn.commit()
                        else:
                            self.local_db.upsert_vendor(rvendor, vendor_name, self.current_uid)

                        fb_update(
                            f"users/{self.current_uid}/expenses/{rid}",
                            {"remoteVendorId": rvendor}
                        )

                    lvendor = self.local_db.get_vendor_by_remote(rvendor) if rvendor else None
                    self.local_db.upsert_expense(
                        rid,
                        lvendor[0] if lvendor else None,
                        d.get("amount"),
                        d.get("date"),
                        d.get("memo", ""),
                        lcat[0] if lcat else None,
                        self.current_uid
                    )
            self._refresh_expense_data()
            self._status("✅ Sync Complete")
        except Exception as e:
            self._status(f"❌ Error: {e}")

    # ── Password Module ────────────────────────────────────────────────────

    def _build_password_module(self):
        container = self.password_frame
        self.pw_account_v = tk.StringVar()
        self.pw_pass_v = tk.StringVar()
        self.pw_pass_original_v = tk.StringVar()
        self.pw_vendor_v = tk.StringVar()
        self.pw_search_v = tk.StringVar()
        self.pw_current_id = None

        search_frame = tk.Frame(container, bg="#1e1e2e")
        search_frame.pack(fill="x", pady=(5, 10))

        ttk.Label(search_frame, text="🔍 Search:").pack(side="left", padx=(0, 5))
        self.pw_search_entry = ttk.Entry(search_frame, textvariable=self.pw_search_v, width=40, font=("Courier", 10))
        self.pw_search_entry.pack(side="left", padx=5)
        ttk.Button(search_frame, text="Search", command=self._pw_search).pack(side="left", padx=2)
        ttk.Button(search_frame, text="Clear", command=self._pw_clear_search).pack(side="left", padx=2)
        self.pw_search_entry.bind("<Return>", lambda e: self._pw_search())
        ttk.Label(search_frame, text="(search by account or vendor)", foreground="#6c7086", font=("Courier", 9)).pack(
            side="left", padx=10)

        self.pw_tree = ttk.Treeview(container, columns=("v", "a", "p"), show="headings")
        self.pw_tree.heading("v", text="Vendor")
        self.pw_tree.heading("a", text="Account")
        self.pw_tree.heading("p", text="Password")
        self.pw_tree.pack(fill="both", expand=True, pady=5)
        self.pw_tree.bind("<<TreeviewSelect>>", self._pw_on_select)

        form = tk.LabelFrame(container, text=" Edit Password ", bg="#1e1e2e", fg="#cba6f7")
        form.pack(fill="x", pady=10)

        ttk.Label(form, text="Vendor:").grid(row=0, column=0, padx=5, pady=5, sticky="e")
        ttk.Entry(form, textvariable=self.pw_vendor_v, width=20).grid(row=0, column=1, padx=5)
        ttk.Label(form, text="Account:").grid(row=0, column=2, padx=5, sticky="e")
        ttk.Entry(form, textvariable=self.pw_account_v, width=20).grid(row=0, column=3, padx=5)

        ttk.Label(form, text="Password:").grid(row=1, column=0, padx=5, pady=5, sticky="e")
        self.pw_entry = ttk.Entry(form, textvariable=self.pw_pass_v, width=20)
        self.pw_entry.grid(row=1, column=1, padx=5)
        self.copy_button = ttk.Button(form, text="📋 Copy", command=self._pw_copy_password)
        self.copy_button.grid(row=1, column=2, padx=(0, 5), pady=5)
        ttk.Button(form, text="⚡ Generate Password", command=self._pw_generate_password).grid(
            row=1, column=3, padx=(0, 5), pady=5)
        ttk.Label(form, text="Length:").grid(row=1, column=4, padx=(5, 2), pady=5)
        ttk.Radiobutton(form, text="12", variable=self.password_length, value=12).grid(
            row=1, column=5, padx=(0, 2), pady=5)
        ttk.Radiobutton(form, text="14", variable=self.password_length, value=14).grid(
            row=1, column=6, padx=(0, 2), pady=5)

        ttk.Label(form, text="Original Password:").grid(row=2, column=0, padx=5, pady=5, sticky="e")
        self.pw_original_entry = ttk.Entry(form, textvariable=self.pw_pass_original_v, width=50, state="readonly")
        self.pw_original_entry.grid(row=2, column=1, columnspan=6, padx=5, pady=5, sticky="w")

        btn_f = tk.Frame(form, bg="#1e1e2e")
        btn_f.grid(row=3, column=0, columnspan=7, pady=5)
        ttk.Button(btn_f, text="➕ Add", command=self._pw_add).pack(side="left", padx=5)
        ttk.Button(btn_f, text="💾 Update", command=self._pw_update).pack(side="left", padx=5)
        ttk.Button(btn_f, text="🗑️ Delete", command=self._pw_delete).pack(side="left", padx=5)
        ttk.Button(btn_f, text="✖ Clear", command=self._pw_clear_form).pack(side="left", padx=5)

    def _pw_generate_password(self):
        length = self.password_length.get()
        allowed = (
            "abcdefghijklmnopqrstuvwxyz"
            "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
            "0123456789"
            "~@!#$%^&*()/:;?,.<>_-"
        )
        pw = ''.join(secrets.choice(allowed) for _ in range(length))
        self.pw_pass_v.set(pw)
        self._status(f"Generated {length}-character strong password.")

    def _pw_copy_password(self):
        password = self.pw_pass_v.get().strip()
        if not password:
            self._status("⚠️ No password to copy!")
            return
        try:
            self.clipboard_clear()
            self.clipboard_append(password)
            self._status("✅ Password copied to clipboard!")
            self.copy_button.configure(text="✅ Copied!")
            self.after(2000, lambda: self.copy_button.configure(text="📋 Copy"))
        except Exception as e:
            self._status(f"❌ Error copying to clipboard: {e}")

    def _pw_search(self):
        search_term = self.pw_search_v.get().strip().lower()
        if not search_term:
            self._pw_clear_search()
            return
        self.pw_tree.delete(*self.pw_tree.get_children())
        if not self.pw_all_data:
            return
        count = 0
        for pid, data in self.pw_all_data.items():
            vendor = data.get("vendor", "").lower()
            account = data.get("account", "").lower()
            if search_term in vendor or search_term in account:
                self.pw_tree.insert("", "end", iid=pid,
                                    values=(data.get("vendor", ""), data.get("account", ""), data.get("pw", "")))
                count += 1
        self._status(f"🔍 Found {count} password(s) matching '{search_term}'")

    def _pw_clear_search(self):
        self.pw_search_v.set("")
        self._load_passwords()
        self._status(f"📋 Showing all passwords")

    def _load_passwords(self):
        if not self.current_uid or not FIREBASE_AVAILABLE:
            return
        data = fb_get(f"users/{self.current_uid}/passwords")
        self.pw_tree.delete(*self.pw_tree.get_children())
        self.pw_all_data = {}
        if data:
            self.pw_all_data = data
            for pid, r in data.items():
                self.pw_tree.insert("", "end", iid=pid,
                                    values=(r.get("vendor", ""), r.get("account", ""), r.get("pw", "")))

    def _pw_on_select(self, _):
        sel = self.pw_tree.selection()
        if not sel:
            return
        self.pw_current_id = sel[0]
        v, a, p = self.pw_tree.item(sel[0], "values")
        self.pw_vendor_v.set(v)
        self.pw_account_v.set(a)
        self.pw_pass_v.set(p)
        self.pw_pass_original_v.set(p)

    def _pw_add(self):
        if not self.current_uid or not FIREBASE_AVAILABLE:
            messagebox.showerror("Error", "Firebase not available")
            return
        d = {
            "vendor": self.pw_vendor_v.get().strip(),
            "account": self.pw_account_v.get().strip(),
            "pw": self.pw_pass_v.get().strip()
        }
        if not any(d.values()):
            messagebox.showwarning("Empty", "Fill in at least one field.")
            return
        fb_push(f"users/{self.current_uid}/passwords", d)
        self._load_passwords()
        self._pw_clear_form()
        self._status("✅ Password added")

    def _pw_update(self):
        if not self.pw_current_id or not FIREBASE_AVAILABLE:
            return
        d = {
            "vendor": self.pw_vendor_v.get().strip(),
            "account": self.pw_account_v.get().strip(),
            "pw": self.pw_pass_v.get().strip()
        }
        fb_update(f"users/{self.current_uid}/passwords/{self.pw_current_id}", d)
        self._load_passwords()
        self._status("✅ Password updated")

    def _pw_delete(self):
        if not self.pw_current_id or not FIREBASE_AVAILABLE:
            return
        if not messagebox.askyesno("Confirm", "Delete this password record?"):
            return
        fb_delete(f"users/{self.current_uid}/passwords/{self.pw_current_id}")
        self._load_passwords()
        self._pw_clear_form()
        self._status("🗑️ Password deleted")

    def _pw_clear_form(self):
        self.pw_vendor_v.set("")
        self.pw_account_v.set("")
        self.pw_pass_v.set("")
        self.pw_pass_original_v.set("")
        self.pw_current_id = None
        self.pw_tree.selection_remove(self.pw_tree.selection())

    # ── Subscription Module ────────────────────────────────────────────────

    def _build_subscription_module(self):
        container = self.subscription_frame
        self.sub_name_v = tk.StringVar()
        self.sub_acc_v = tk.StringVar()
        self.sub_amt_v = tk.StringVar()
        self.sub_due_date_v = tk.StringVar()
        self.sub_memo_v = tk.StringVar()
        self.sub_current_id = None

        search_frame = tk.Frame(container, bg="#1e1e2e")
        search_frame.pack(fill="x", pady=(5, 10))

        ttk.Label(search_frame, text="🔍 Search:").pack(side="left", padx=(0, 5))
        self.sub_search_entry = ttk.Entry(search_frame, textvariable=self.sub_search_v, width=40, font=("Courier", 10))
        self.sub_search_entry.pack(side="left", padx=5)
        ttk.Button(search_frame, text="Search", command=self._sub_search).pack(side="left", padx=2)
        ttk.Button(search_frame, text="Clear", command=self._sub_clear_search).pack(side="left", padx=2)
        self.sub_search_entry.bind("<Return>", lambda e: self._sub_search())
        ttk.Label(search_frame, text="(search by name or account)", foreground="#6c7086", font=("Courier", 9)).pack(
            side="left", padx=10)

        self.sub_tree = ttk.Treeview(container, columns=("n", "a", "m", "d", "mem"), show="headings")
        self.sub_tree.heading("n", text="Service")
        self.sub_tree.heading("a", text="Account")
        self.sub_tree.heading("m", text="Amount")
        self.sub_tree.heading("d", text="Due Date")
        self.sub_tree.heading("mem", text="Memo")
        self.sub_tree.column("n", width=150)
        self.sub_tree.column("a", width=150)
        self.sub_tree.column("m", width=100)
        self.sub_tree.column("d", width=100)
        self.sub_tree.column("mem", width=200)
        self.sub_tree.pack(fill="both", expand=True, pady=5)
        self.sub_tree.bind("<<TreeviewSelect>>", self._sub_on_select)

        form = tk.LabelFrame(container, text=" Edit Subscription ", bg="#1e1e2e", fg="#cba6f7")
        form.pack(fill="x", pady=10)

        ttk.Label(form, text="Service:").grid(row=0, column=0, padx=5, pady=5, sticky="e")
        ttk.Entry(form, textvariable=self.sub_name_v, width=20).grid(row=0, column=1, padx=5)
        ttk.Label(form, text="Account:").grid(row=0, column=2, padx=5, sticky="e")
        ttk.Entry(form, textvariable=self.sub_acc_v, width=20).grid(row=0, column=3, padx=5)

        ttk.Label(form, text="Amount:").grid(row=1, column=0, padx=5, pady=5, sticky="e")
        ttk.Entry(form, textvariable=self.sub_amt_v, width=20).grid(row=1, column=1, padx=5)
        ttk.Label(form, text="Due Date:").grid(row=1, column=2, padx=5, sticky="e")
        ttk.Entry(form, textvariable=self.sub_due_date_v, width=20).grid(row=1, column=3, padx=5)

        ttk.Label(form, text="Memo:").grid(row=2, column=0, padx=5, pady=5, sticky="e")
        ttk.Entry(form, textvariable=self.sub_memo_v, width=68).grid(row=2, column=1, columnspan=3, padx=5, sticky="w")

        btn_f = tk.Frame(form, bg="#1e1e2e")
        btn_f.grid(row=3, column=0, columnspan=4, pady=5)
        ttk.Button(btn_f, text="➕ Add", command=self._sub_add).pack(side="left", padx=5)
        ttk.Button(btn_f, text="💾 Update", command=self._sub_update).pack(side="left", padx=5)
        ttk.Button(btn_f, text="🗑️ Delete", command=self._sub_delete).pack(side="left", padx=5)
        ttk.Button(btn_f, text="✖ Clear", command=self._sub_clear_form).pack(side="left", padx=5)

    def _sub_search(self):
        search_term = self.sub_search_v.get().strip().lower()
        if not search_term:
            self._sub_clear_search()
            return
        self.sub_tree.delete(*self.sub_tree.get_children())
        if not self.sub_all_data:
            return
        count = 0
        for pid, data in self.sub_all_data.items():
            name = data.get("name", "").lower()
            account = data.get("account", "").lower()
            if search_term in name or search_term in account:
                self.sub_tree.insert("", "end", iid=pid,
                                     values=(
                                         data.get("name", ""),
                                         data.get("account", ""),
                                         data.get("amount", ""),
                                         data.get("dueDate", ""),
                                         data.get("memo", "")
                                     ))
                count += 1
        self._status(f"🔍 Found {count} subscription(s) matching '{search_term}'")

    def _sub_clear_search(self):
        self.sub_search_v.set("")
        self._load_subscriptions()
        self._status(f"📋 Showing all subscriptions")

    def _load_subscriptions(self):
        if not self.current_uid or not FIREBASE_AVAILABLE:
            return
        data = fb_get(f"users/{self.current_uid}/subscriptions")
        self.sub_tree.delete(*self.sub_tree.get_children())
        self.sub_all_data = {}
        if data:
            self.sub_all_data = data
            for pid, r in data.items():
                self.sub_tree.insert("", "end", iid=pid,
                                     values=(
                                         r.get("name", ""),
                                         r.get("account", ""),
                                         r.get("amount", ""),
                                         r.get("dueDate", ""),
                                         r.get("memo", "")
                                     ))

    def _sub_on_select(self, _):
        sel = self.sub_tree.selection()
        if not sel:
            return
        self.sub_current_id = sel[0]
        n, a, m, d, mem = self.sub_tree.item(sel[0], "values")
        self.sub_name_v.set(n)
        self.sub_acc_v.set(a)
        self.sub_amt_v.set(m)
        self.sub_due_date_v.set(d)
        self.sub_memo_v.set(mem)

    def _sub_add(self):
        if not self.current_uid or not FIREBASE_AVAILABLE:
            messagebox.showerror("Error", "Firebase not available")
            return
        name = self.sub_name_v.get().strip()
        if not name:
            messagebox.showwarning("Invalid Input", "Service Name is required.")
            return
        d = {
            "name": name,
            "account": self.sub_acc_v.get().strip(),
            "amount": self.sub_amt_v.get().strip(),
            "dueDate": self.sub_due_date_v.get().strip(),
            "memo": self.sub_memo_v.get().strip()
        }
        fb_push(f"users/{self.current_uid}/subscriptions", d)
        self._load_subscriptions()
        self._sub_clear_form()
        self._status(f"✅ Subscription '{name}' added")

    def _sub_update(self):
        if not self.sub_current_id or not FIREBASE_AVAILABLE:
            messagebox.showerror("Error", "No subscription selected or Firebase not available")
            return
        name = self.sub_name_v.get().strip()
        if not name:
            messagebox.showwarning("Invalid Input", "Service Name is required.")
            return
        d = {
            "name": name,
            "account": self.sub_acc_v.get().strip(),
            "amount": self.sub_amt_v.get().strip(),
            "dueDate": self.sub_due_date_v.get().strip(),
            "memo": self.sub_memo_v.get().strip()
        }
        fb_update(f"users/{self.current_uid}/subscriptions/{self.sub_current_id}", d)
        self._load_subscriptions()
        self._status(f"✅ Subscription '{name}' updated")

    def _sub_delete(self):
        if not self.sub_current_id or not FIREBASE_AVAILABLE:
            messagebox.showerror("Error", "No subscription selected or Firebase not available")
            return
        name = self.sub_name_v.get().strip() or "this subscription"
        if not messagebox.askyesno("Confirm Delete", f"Are you sure you want to delete '{name}'?"):
            return
        fb_delete(f"users/{self.current_uid}/subscriptions/{self.sub_current_id}")
        self._load_subscriptions()
        self._sub_clear_form()
        self._status(f"🗑️ Subscription '{name}' deleted")

    def _sub_clear_form(self):
        self.sub_name_v.set("")
        self.sub_acc_v.set("")
        self.sub_amt_v.set("")
        self.sub_due_date_v.set("")
        self.sub_memo_v.set("")
        self.sub_current_id = None
        self.sub_tree.selection_remove(self.sub_tree.selection())

    # ── Expense Module ──────────────────────────────────────────────────────

    def _build_expense_module(self):
        container = self.expense_frame

        self.exp_vendor_v = tk.StringVar()
        self.exp_amt_v = tk.StringVar()
        self.exp_date_v = tk.StringVar(value=datetime.now().strftime("%Y-%m-%d"))
        self.exp_memo_v = tk.StringVar()
        self.exp_category_v = tk.StringVar()  # Category variable for editing
        self.exp_current_lid = None
        self.cats_cache = []
        self.vendors_cache = []
        self.category_vendors_cache = []
        self.current_view = "all"

        # Main Paned Window with 3 columns
        paned = ttk.PanedWindow(container, orient="horizontal")
        paned.pack(fill="both", expand=True)

        # ─── Column 1: Categories ──────────────────────────────────────────────
        left_panel = tk.Frame(paned, bg="#1e1e2e")
        paned.add(left_panel, weight=1)

        l_f = tk.LabelFrame(left_panel, text=" Categories ", bg="#1e1e2e", fg="#cba6f7")
        l_f.pack(fill="both", expand=True, padx=5, pady=5)

        self.cat_box = tk.Listbox(l_f, bg="#2a2a3e", fg="#cdd6f4", font=("Courier", 10), selectmode="single")
        self.cat_box.pack(fill="both", expand=True, padx=5, pady=5)
        self.cat_box.bind("<<ListboxSelect>>", self._on_category_select)

        cat_btn_frame = tk.Frame(l_f, bg="#1e1e2e")
        cat_btn_frame.pack(fill="x", padx=5, pady=5)
        ttk.Button(cat_btn_frame, text="➕ Add", command=self._add_category).pack(side="left", padx=2)
        ttk.Button(cat_btn_frame, text="✏️ Rename", command=self._rename_category).pack(side="left", padx=2)
        ttk.Button(cat_btn_frame, text="🗑️ Delete", command=self._delete_category).pack(side="left", padx=2)

        # ─── Column 2: Vendors (Customers) ────────────────────────────────────
        middle_panel = tk.Frame(paned, bg="#1e1e2e")
        paned.add(middle_panel, weight=1)

        m_f = tk.LabelFrame(middle_panel, text=" Vendors/Customers ", bg="#1e1e2e", fg="#cba6f7")
        m_f.pack(fill="both", expand=True, padx=5, pady=5)

        self.vendor_box = tk.Listbox(m_f, bg="#2a2a3e", fg="#cdd6f4", font=("Courier", 10), selectmode="single")
        self.vendor_box.pack(fill="both", expand=True, padx=5, pady=5)
        self.vendor_box.bind("<<ListboxSelect>>", self._on_vendor_select)

        vendor_btn_frame = tk.Frame(m_f, bg="#1e1e2e")
        vendor_btn_frame.pack(fill="x", padx=5, pady=5)
        ttk.Button(vendor_btn_frame, text="➕ Add", command=self._add_vendor).pack(side="left", padx=2)
        ttk.Button(vendor_btn_frame, text="✏️ Rename", command=self._rename_vendor).pack(side="left", padx=2)
        ttk.Button(vendor_btn_frame, text="🗑️ Delete", command=self._delete_vendor).pack(side="left", padx=2)

        # ─── Column 3: Expenses ────────────────────────────────────────────────
        right_panel = tk.Frame(paned, bg="#1e1e2e")
        paned.add(right_panel, weight=2)

        self.category_info_var = tk.StringVar(value="Select a category to manage expenses")
        info_frame = tk.Frame(right_panel, bg="#1e1e2e")
        info_frame.pack(fill="x", padx=5, pady=2)
        ttk.Label(info_frame, textvariable=self.category_info_var, font=("Courier", 10, "bold")).pack(side="left")

        self.sort_btn_var = tk.StringVar(value="⬆ Oldest First")
        ttk.Button(info_frame, textvariable=self.sort_btn_var, command=self._toggle_sort).pack(side="right", padx=5)

        self.exp_tree = ttk.Treeview(right_panel, columns=("v", "a", "d", "m"), show="headings")
        self.exp_tree.heading("v", text="Vendor")
        self.exp_tree.heading("a", text="Amount")
        self.exp_tree.heading("d", text="Date", command=lambda: self._sort_by_column("d"))
        self.exp_tree.heading("m", text="Memo")
        self.exp_tree.column("v", width=150)
        self.exp_tree.column("a", width=80)
        self.exp_tree.column("d", width=100)
        self.exp_tree.column("m", width=180)
        self.exp_tree.pack(fill="both", expand=True, pady=5)
        self.exp_tree.bind("<<TreeviewSelect>>", self._on_expense_select)

        # ─── Expense Form ──────────────────────────────────────────────────────
        form = tk.LabelFrame(right_panel, text=" Add/Edit Expense ", bg="#1e1e2e", fg="#cba6f7")
        form.pack(fill="x", pady=5)

        # Row 0: Vendor, Amount, Date
        ttk.Label(form, text="Vendor:").grid(row=0, column=0, padx=5, pady=5, sticky="e")
        self.vendor_combo = ttk.Combobox(form, textvariable=self.exp_vendor_v, width=20, font=("Courier", 10))
        self.vendor_combo.grid(row=0, column=1, padx=5, sticky="w")

        ttk.Label(form, text="Amount:").grid(row=0, column=2, padx=5, sticky="e")
        ttk.Entry(form, textvariable=self.exp_amt_v, width=15).grid(row=0, column=3, padx=5)

        ttk.Label(form, text="Date:").grid(row=0, column=4, padx=5, sticky="e")
        date_frame = tk.Frame(form, bg="#1e1e2e")
        date_frame.grid(row=0, column=5, padx=5, sticky="w")
        self.date_entry = ttk.Entry(date_frame, textvariable=self.exp_date_v, width=12)
        self.date_entry.pack(side="left")
        ttk.Button(date_frame, text="📅", width=3, command=self._show_date_picker).pack(side="left", padx=2)
        ttk.Button(date_frame, text="Today", width=5,
                   command=lambda: self.exp_date_v.set(datetime.now().strftime("%Y-%m-%d"))).pack(side="left", padx=2)

        # Row 1: Category (editable combobox), Memo
        ttk.Label(form, text="Category:").grid(row=1, column=0, padx=5, pady=5, sticky="e")
        self.category_combo = ttk.Combobox(form, textvariable=self.exp_category_v, width=20, font=("Courier", 10))
        self.category_combo.grid(row=1, column=1, padx=5, sticky="w")

        ttk.Label(form, text="Memo:").grid(row=1, column=2, padx=5, sticky="e")
        ttk.Entry(form, textvariable=self.exp_memo_v, width=45).grid(row=1, column=3, columnspan=3, padx=5, sticky="w")

        # Buttons
        btn_frame = tk.Frame(right_panel, bg="#1e1e2e")
        btn_frame.pack(fill="x", pady=5)
        ttk.Button(btn_frame, text="➕ Add Expense", command=self._add_expense).pack(side="left", padx=5)
        ttk.Button(btn_frame, text="✏️ Update Expense", command=self._update_expense).pack(side="left", padx=5)
        ttk.Button(btn_frame, text="🗑️ Delete Expense", command=self._delete_expense).pack(side="left", padx=5)
        ttk.Button(btn_frame, text="🔄 Clear Form", command=self._clear_expense_form).pack(side="left", padx=5)

        # ⭐ NEW: Bind category and vendor combobox selection to auto-fill form
        self.category_combo.bind("<<ComboboxSelected>>", self._on_category_combo_select)
        self.vendor_combo.bind("<<ComboboxSelected>>", self._on_vendor_combo_select)

    # ⭐ NEW: Handle category selection from the combobox
    def _on_category_combo_select(self, event):
        """When user selects a category from the combobox, auto-fill the vendor combo"""
        if self._updating_selection:
            return

        category_name = self.exp_category_v.get().strip()
        if not category_name:
            return

        # Find the category ID
        category = self.local_db.get_category_by_name(category_name, self.current_uid)
        if not category:
            return

        category_id = category[0]

        # Get vendors for this category
        vendors = self.local_db.get_vendors_by_category(category_id, self.current_uid)

        # The add/edit form always offers every vendor. Category filtering is
        # limited to the left-side vendor list used to browse expenses.
        self.vendor_combo['values'] = [v[2] for v in self.vendors_cache]
        self._status(f"📋 Category '{category_name}' selected")

        # Also update the category listbox selection to match
        self._updating_selection = True
        try:
            for i, cat in enumerate(self.cats_cache, start=1):
                if cat[0] == category_id:
                    self.cat_box.selection_clear(0, tk.END)
                    self.cat_box.selection_set(i)
                    self.cat_box.see(i)
                    self._on_category_select(None)
                    break
        finally:
            self._updating_selection = False

    # ⭐ NEW: Handle vendor selection from the combobox
    def _on_vendor_combo_select(self, event):
        """When user selects a vendor from the combobox, auto-fill the category"""
        if self._updating_selection:
            return

        vendor_name = self.exp_vendor_v.get().strip()
        if not vendor_name:
            return

        # Find the vendor
        vendor = self.local_db.get_vendor_by_name(vendor_name, self.current_uid)
        if not vendor:
            return

        vendor_id = vendor[0]

        # Find the category for this vendor (prefer the currently selected category)
        category_name = self.exp_category_v.get().strip()
        if category_name:
            # Use the currently selected category
            category = self.local_db.get_category_by_name(category_name, self.current_uid)
            if category:
                category_id = category[0]
                # Check if this vendor has expenses in this category
                c = self.local_db.conn.cursor()
                c.execute("""
                          SELECT COUNT(*)
                          FROM expenses
                          WHERE vendorId = ?
                            AND categoryId = ?
                            AND userId = ?
                          """, (vendor_id, category_id, self.current_uid))
                count = c.fetchone()[0]
                if count > 0:
                    self._status(f"📋 Vendor '{vendor_name}' has {count} expense(s) in '{category_name}'")
                    return

        # If no category selected or vendor has no expenses in that category,
        # find the most used category for this vendor
        c = self.local_db.conn.cursor()
        c.execute("""
                  SELECT cat.id, cat.name, COUNT(*) as count
                  FROM expenses e
                      JOIN categories cat
                  ON e.categoryId = cat.id
                  WHERE e.vendorId = ? AND e.userId = ?
                  GROUP BY cat.id, cat.name
                  ORDER BY count DESC
                      LIMIT 1
                  """, (vendor_id, self.current_uid))
        result = c.fetchone()

        if result:
            cat_id, cat_name, count = result
            # Auto-fill the category
            self.exp_category_v.set(cat_name)
            self._status(f"📋 Vendor '{vendor_name}' uses category '{cat_name}' ({count} expense(s))")

            # Also update the category combobox values if needed
            category = self.local_db.get_category_by_name(cat_name, self.current_uid)
            if category:
                self.vendor_combo['values'] = [v[2] for v in self.vendors_cache]

                # Update category listbox selection
                self._updating_selection = True
                try:
                    for i, cat in enumerate(self.cats_cache, start=1):
                        if cat[0] == category[0]:
                            self.cat_box.selection_clear(0, tk.END)
                            self.cat_box.selection_set(i)
                            self.cat_box.see(i)
                            self._on_category_select(None)
                            break
                finally:
                    self._updating_selection = False
        else:
            self._status(f"ℹ️ No expenses found for vendor '{vendor_name}'")

    def _on_category_select(self, event):
        """Handle category selection - update vendors list"""
        if self._updating_selection:
            return

        selection = self.cat_box.curselection()
        if not selection:
            return

        idx = selection[0]
        if idx == 0:  # "All Expenses"
            self.selected_category_id = None
            self.selected_vendor_id = None
            self.current_view = "all"
            self.category_info_var.set("📊 All Expenses")
            self.vendor_box.delete(0, tk.END)
            self.vendor_box.insert(tk.END, "All Vendors")
            self.category_vendors_cache = list(self.vendors_cache)
            for vendor in self.category_vendors_cache:
                self.vendor_box.insert(tk.END, vendor[2])
            self._load_all_expenses()
            self._clear_expense_form()

            # ⭐ Update category combobox to show all vendors
            self.vendor_combo['values'] = [v[2] for v in self.vendors_cache]
        else:
            cat = self.cats_cache[idx - 1]
            self.selected_category_id = cat[0]
            self.current_view = "category"
            self.category_info_var.set(f"📂 {cat[2]}")

            # Load vendors for this category
            self._load_vendors_for_category(cat[0])

            self.vendor_combo['values'] = [v[2] for v in self.vendors_cache]

            self._clear_expense_form()

            # Select first vendor if available
            if self.category_vendors_cache:
                self.vendor_box.selection_set(0)
                self.selected_vendor_id = self.category_vendors_cache[0][0]
                self._load_expenses_by_category_and_vendor(cat[0], self.selected_vendor_id)
                # ⭐ Auto-fill vendor in the form
                self.exp_vendor_v.set(self.category_vendors_cache[0][2])
                self.exp_category_v.set(cat[2])
            else:
                self.selected_vendor_id = None
                self._load_expenses_by_category(cat[0])
                self.exp_category_v.set(cat[2])

    def _load_vendors_for_category(self, category_id):
        """Load vendors that have expenses in this category"""
        self.vendor_box.delete(0, tk.END)
        self.category_vendors_cache = self.local_db.get_vendors_by_category(category_id, self.current_uid)

        if self.category_vendors_cache:
            self.vendor_box.insert(tk.END, "All Vendors")
            for vendor in self.category_vendors_cache:
                self.vendor_box.insert(tk.END, vendor[2])
        else:
            self.vendor_box.insert(tk.END, "No vendors found")

    def _on_vendor_select(self, event):
        """Handle vendor selection - update expenses list"""
        if self._updating_selection:
            return

        selection = self.vendor_box.curselection()
        if not selection or not self.selected_category_id:
            return

        self._clear_expense_form()
        idx = selection[0]
        if idx == 0 and self.vendor_box.get(0) == "All Vendors":
            # Show all expenses for this category
            self.selected_vendor_id = None
            self._load_expenses_by_category(self.selected_category_id)
        else:
            # Show expenses for specific vendor
            vendor = self.category_vendors_cache[idx - 1]
            self.selected_vendor_id = vendor[0]
            self._load_expenses_by_category_and_vendor(self.selected_category_id, vendor[0])

            # ⭐ Auto-fill vendor in the form
            self.exp_vendor_v.set(vendor[2])
            # Also update the category if not already set
            cat = next((c for c in self.cats_cache if c[0] == self.selected_category_id), None)
            if cat:
                self.exp_category_v.set(cat[2])

    def _load_expenses_by_category_and_vendor(self, category_id, vendor_id):
        """Load expenses filtered by both category and vendor"""
        if not self.current_uid:
            return

        rows = self.local_db.get_expenses_by_category_and_vendor(
            category_id, vendor_id, self.current_uid, self.sort_ascending
        )
        self._populate_expense_tree(rows)

        # Update info
        cat = next((c for c in self.cats_cache if c[0] == category_id), None)
        vendor = next((v for v in self.vendors_cache if v[0] == vendor_id), None)
        if cat and vendor:
            self.category_info_var.set(f"📂 {cat[2]} → 🏷️ {vendor[2]} ({len(rows)} expenses)")
        elif cat:
            self.category_info_var.set(f"📂 {cat[2]} ({len(rows)} expenses)")

    def _load_expenses_by_category(self, category_id):
        """Load expenses filtered by category only"""
        if not self.current_uid:
            return
        rows = self.local_db.get_expenses_by_category_and_vendor(
            category_id, None, self.current_uid, self.sort_ascending
        )
        self._populate_expense_tree(rows)

        cat = next((c for c in self.cats_cache if c[0] == category_id), None)
        if cat:
            self.category_info_var.set(f"📂 {cat[2]} (All Vendors, {len(rows)} expenses)")

    def _load_all_expenses(self):
        """Load all expenses"""
        if not self.current_uid:
            return
        rows = self.local_db.get_expenses_with_categories(self.current_uid, self.sort_ascending)
        self._populate_expense_tree(rows)
        self.category_info_var.set(f"📊 All Expenses ({len(rows)} expenses)")

    def _populate_expense_tree(self, rows):
        """Populate expense tree with vendor, amount, date, memo"""
        # ⭐ ALWAYS clear the tree before populating - FIXED
        self.exp_tree.delete(*self.exp_tree.get_children())

        if not rows:
            return

        for r in rows:
            amount = r[3] or "0.00"
            if amount and not amount.startswith("$"):
                try:
                    amount = f"${float(amount):.2f}"
                except ValueError:
                    pass

            vendor_name = r[2] or "Uncategorized"
            self.exp_tree.insert("", "end", iid=str(r[0]),
                                 values=(vendor_name, amount, r[4] or "", r[5] or ""))

    def _on_expense_select(self, event):
        """Handle expense selection - pre-fill form with category and vendor"""
        selection = self.exp_tree.selection()
        if not selection:
            return

        # ⭐ Set the updating flag to prevent recursive updates
        self._updating_selection = True

        try:
            self.exp_current_lid = int(selection[0])

            c = self.local_db.conn.cursor()
            c.execute("""
                      SELECT e.vendorId,
                             COALESCE(v.name, e.vendor, '') as vendor_name,
                             e.amount,
                             e.date,
                             e.memo,
                             e.categoryId,
                             cat.name
                      FROM expenses e
                               LEFT JOIN categories cat ON e.categoryId = cat.id
                               LEFT JOIN vendors v ON e.vendorId = v.id
                      WHERE e.localId = ?
                      """, (self.exp_current_lid,))
            result = c.fetchone()

            if result:
                vendor_id, vendor_name, amount, date, memo, category_id, category_name = result

                # Set form values
                self.exp_vendor_v.set(vendor_name or "")
                self.exp_amt_v.set(amount or "")
                self.exp_date_v.set(date or datetime.now().strftime("%Y-%m-%d"))
                self.exp_memo_v.set(memo or "")

                # Set category in the combobox
                if category_name:
                    self.exp_category_v.set(category_name)
                else:
                    self.exp_category_v.set("")

                # ⭐ Store the current selection before any refresh
                current_cat_id = self.selected_category_id

                # Set the selected IDs from the expense data
                if category_id:
                    self.selected_category_id = category_id
                if vendor_id:
                    self.selected_vendor_id = vendor_id

                # Select the category in the listbox
                if category_id and self.cats_cache:
                    for i, cat in enumerate(self.cats_cache, start=1):
                        if cat[0] == category_id:
                            self.cat_box.selection_clear(0, tk.END)
                            self.cat_box.selection_set(i)
                            self.cat_box.see(i)
                            # Load vendors for this category if needed
                            if current_cat_id != category_id:
                                self._load_vendors_for_category(category_id)
                            break

                # Select the vendor in the vendor listbox
                if vendor_id:
                    # Check if vendor is in the current category_vendors_cache
                    found = False
                    for i, vendor in enumerate(self.category_vendors_cache, start=1):
                        if vendor[0] == vendor_id:
                            self.vendor_box.selection_clear(0, tk.END)
                            self.vendor_box.selection_set(i)
                            self.vendor_box.see(i)
                            found = True
                            break

                    # If vendor not found, add it to the cache and listbox
                    if not found:
                        # Get the vendor info
                        vendor_info = self.local_db.get_vendor_by_name(vendor_name, self.current_uid)
                        if vendor_info:
                            # Add to cache
                            self.category_vendors_cache.append((vendor_info[0], None, vendor_name))
                            # Update listbox
                            self.vendor_box.delete(0, tk.END)
                            if self.category_vendors_cache:
                                self.vendor_box.insert(tk.END, "All Vendors")
                                for v in self.category_vendors_cache:
                                    v_name = v[2] if len(v) > 2 else v[1] if len(v) > 1 else vendor_name
                                    self.vendor_box.insert(tk.END, v_name)
                            # Select this vendor
                            for i, v in enumerate(self.category_vendors_cache, start=1):
                                if v[0] == vendor_id:
                                    self.vendor_box.selection_clear(0, tk.END)
                                    self.vendor_box.selection_set(i)
                                    self.vendor_box.see(i)
                                    break

                # Update the expenses tree to show the correct filtered view
                self._refresh_current_view()

                # Update status
                self._status(f"📝 Editing expense: {vendor_name} - ${amount}")

        finally:
            # ⭐ Always clear the updating flag
            # selection_set() queues ListboxSelect callbacks. Keep the guard
            # active until Tk has delivered them so they cannot clear this form.
            self.after_idle(lambda: setattr(self, "_updating_selection", False))

    def _clear_expense_form(self):
        """Clear all expense form fields"""
        self.exp_vendor_v.set("")
        self.exp_amt_v.set("")
        self.exp_date_v.set(datetime.now().strftime("%Y-%m-%d"))
        self.exp_memo_v.set("")
        self.exp_category_v.set("")
        self.exp_current_lid = None
        self.exp_tree.selection_remove(self.exp_tree.selection())
        # Don't clear selected_category_id and selected_vendor_id
        # They are managed by the selection logic

    def _show_date_picker(self):
        current_date = self.exp_date_v.get()
        try:
            datetime.strptime(current_date, "%Y-%m-%d")
        except:
            current_date = None
        picker = DatePickerDialog(self, current_date)
        if picker.selected_date:
            self.exp_date_v.set(picker.selected_date.strftime("%Y-%m-%d"))

    def _toggle_sort(self):
        self.sort_ascending = not self.sort_ascending
        self.sort_btn_var.set("⬆ Oldest First" if self.sort_ascending else "⬇ Newest First")
        self._refresh_current_view()

    def _refresh_current_view(self):
        """Refresh the current view based on category and vendor filters"""
        if self.selected_category_id and self.selected_vendor_id:
            self._load_expenses_by_category_and_vendor(self.selected_category_id, self.selected_vendor_id)
        elif self.selected_category_id:
            self._load_expenses_by_category(self.selected_category_id)
        else:
            self._load_all_expenses()
            self.vendor_box.delete(0, tk.END)
            self.vendor_box.insert(tk.END, "All Vendors")
            self.category_vendors_cache = list(self.vendors_cache)
            for vendor in self.category_vendors_cache:
                self.vendor_box.insert(tk.END, vendor[2])

    def _sort_by_column(self, column):
        items = [(self.exp_tree.set(item, column), item) for item in self.exp_tree.get_children('')]
        if column == "a":
            items.sort(key=lambda x: float(x[0].replace('$', '').replace(',', '')) if x[0] else 0,
                       reverse=not self.sort_ascending)
        elif column == "d":
            def date_key(x):
                try:
                    return datetime.strptime(x[0], "%Y-%m-%d") if x[0] else datetime.min
                except:
                    return datetime.min

            items.sort(key=date_key, reverse=not self.sort_ascending)
        else:
            items.sort(key=lambda x: x[0].lower(), reverse=not self.sort_ascending)
        for index, (_, item) in enumerate(items):
            self.exp_tree.move(item, '', index)

    def _validate_date(self, date_str):
        if not date_str or not date_str.strip():
            return datetime.now().strftime("%Y-%m-%d")
        date_str = date_str.strip()
        formats = [
            "%Y-%m-%d", "%Y/%m/%d", "%m-%d-%Y", "%m/%d/%Y",
            "%d-%m-%Y", "%d/%m/%Y", "%b %d, %Y", "%B %d, %Y",
            "%d %b %Y", "%d %B %Y",
        ]
        for fmt in formats:
            try:
                dt = datetime.strptime(date_str, fmt)
                return dt.strftime("%Y-%m-%d")
            except ValueError:
                continue
        try:
            cleaned = ''.join(c for c in date_str if c.isdigit())
            if len(cleaned) == 8:
                if int(cleaned[0:4]) > 1900:
                    dt = datetime.strptime(cleaned, "%Y%m%d")
                else:
                    dt = datetime.strptime(cleaned, "%m%d%Y")
                return dt.strftime("%Y-%m-%d")
        except:
            pass
        messagebox.showwarning("Invalid Date",
                               f"'{date_str}' could not be parsed as a date.\nUsing today's date.")
        return datetime.now().strftime("%Y-%m-%d")

    def _refresh_expense_data(self):
        if not self.current_uid:
            return

        # Refresh categories
        self.cats_cache = self.local_db.get_categories(self.current_uid)
        self.cat_box.delete(0, tk.END)
        self.cat_box.insert(tk.END, "📂 All Expenses")
        for cat in self.cats_cache:
            self.cat_box.insert(tk.END, f"📁 {cat[2]}")

        # Refresh vendors for combobox
        self.vendors_cache = self.local_db.get_vendors(self.current_uid)
        self.vendor_combo['values'] = [v[2] for v in self.vendors_cache]

        # Refresh categories for the category combobox
        self.category_combo['values'] = [cat[2] for cat in self.cats_cache]

        if self.selected_category_id:
            self._load_vendors_for_category(self.selected_category_id)
            if self.selected_vendor_id:
                self._load_expenses_by_category_and_vendor(self.selected_category_id, self.selected_vendor_id)
            else:
                self._load_expenses_by_category(self.selected_category_id)
        else:
            self._load_all_expenses()
            self.vendor_box.delete(0, tk.END)
            self.vendor_box.insert(tk.END, "All Vendors")
            self.category_vendors_cache = list(self.vendors_cache)
            for vendor in self.category_vendors_cache:
                self.vendor_box.insert(tk.END, vendor[2])

    def _add_category(self):
        if not self.current_uid:
            messagebox.showerror("Error", "Please select a user first")
            return
        name = simpledialog.askstring("New Category", "Enter category name:", parent=self)
        if not name or not name.strip():
            return
        name = name.strip()
        for cat in self.cats_cache:
            if cat[2].lower() == name.lower():
                messagebox.showerror("Error", f"Category '{name}' already exists!")
                return
        if FIREBASE_AVAILABLE:
            ref = fb_push(f"users/{self.current_uid}/categories", {"name": name})
            self.local_db.upsert_category(ref.key, name, self.current_uid)
        else:
            mock_id = f"local_{datetime.now().timestamp()}"
            self.local_db.upsert_category(mock_id, name, self.current_uid)
        self._refresh_expense_data()
        self._status(f"✅ Category '{name}' added")

    def _rename_category(self):
        selection = self.cat_box.curselection()
        if not selection or selection[0] == 0:
            messagebox.showerror("Error", "Please select a category to rename")
            return
        idx = selection[0] - 1
        cat = self.cats_cache[idx]
        new_name = simpledialog.askstring("Rename Category",
                                          f"Rename '{cat[2]}' to:",
                                          initialvalue=cat[2],
                                          parent=self)
        if not new_name or not new_name.strip():
            return
        new_name = new_name.strip()
        for c in self.cats_cache:
            if c[2].lower() == new_name.lower() and c[0] != cat[0]:
                messagebox.showerror("Error", f"Category '{new_name}' already exists!")
                return
        if FIREBASE_AVAILABLE and cat[1]:
            fb_update(f"users/{self.current_uid}/categories/{cat[1]}", {"name": new_name})
        self.local_db.upsert_category(cat[1], new_name, self.current_uid)
        self._refresh_expense_data()
        self._status(f"✅ Category renamed to '{new_name}'")

    def _delete_category(self):
        selection = self.cat_box.curselection()
        if not selection or selection[0] == 0:
            messagebox.showerror("Error", "Please select a category to delete")
            return
        idx = selection[0] - 1
        cat = self.cats_cache[idx]
        expense_count = len(self.local_db.get_expenses_by_category_and_vendor(
            cat[0], None, self.current_uid, self.sort_ascending
        ))
        msg = f"Delete category '{cat[2]}'?"
        if expense_count > 0:
            msg += f"\n\nThis category has {expense_count} expense(s). They will be moved to 'Uncategorized'."
        if not messagebox.askyesno("Delete Category", msg):
            return
        if FIREBASE_AVAILABLE and cat[1]:
            fb_delete(f"users/{self.current_uid}/categories/{cat[1]}")
        self.local_db.delete_category(cat[0], self.current_uid)
        self._refresh_expense_data()
        self._status(f"🗑️ Category '{cat[2]}' deleted")

    def _add_vendor(self):
        if not self.current_uid:
            messagebox.showerror("Error", "Please select a user first")
            return
        name = simpledialog.askstring("New Vendor", "Enter vendor name:", parent=self)
        if not name or not name.strip():
            return
        name = name.strip()
        for vendor in self.vendors_cache:
            if vendor[2].lower() == name.lower():
                messagebox.showerror("Error", f"Vendor '{name}' already exists!")
                return
        if FIREBASE_AVAILABLE:
            ref = fb_push(f"users/{self.current_uid}/vendors", {"name": name})
            self.local_db.upsert_vendor(ref.key, name, self.current_uid)
        else:
            mock_id = f"local_{datetime.now().timestamp()}"
            self.local_db.upsert_vendor(mock_id, name, self.current_uid)
        self._refresh_expense_data()
        self._status(f"✅ Vendor '{name}' added")

    def _rename_vendor(self):
        selection = self.vendor_box.curselection()
        if not selection:
            messagebox.showerror("Error", "Please select a vendor to rename")
            return
        idx = selection[0]
        if idx == 0 and self.vendor_box.get(0) == "All Vendors":
            messagebox.showerror("Error", "Cannot rename 'All Vendors'")
            return
        vendor = self.category_vendors_cache[idx - 1]
        new_name = simpledialog.askstring("Rename Vendor",
                                          f"Rename '{vendor[2]}' to:",
                                          initialvalue=vendor[2],
                                          parent=self)
        if not new_name or not new_name.strip():
            return
        new_name = new_name.strip()
        if FIREBASE_AVAILABLE and vendor[1]:
            fb_update(f"users/{self.current_uid}/vendors/{vendor[1]}", {"name": new_name})
        self.local_db.upsert_vendor(vendor[1], new_name, self.current_uid)
        self._refresh_expense_data()
        self._status(f"✅ Vendor renamed to '{new_name}'")

    def _delete_vendor(self):
        selection = self.vendor_box.curselection()
        if not selection:
            messagebox.showerror("Error", "Please select a vendor to delete")
            return
        idx = selection[0]
        if idx == 0 and self.vendor_box.get(0) == "All Vendors":
            messagebox.showerror("Error", "Cannot delete 'All Vendors'")
            return
        vendor = self.category_vendors_cache[idx - 1]
        if not messagebox.askyesno("Confirm",
                                   f"Delete vendor '{vendor[2]}'?\nExpenses using this vendor will be moved to 'Uncategorized'."):
            return

        # Clear remote expense references first. Otherwise Cloud Sync would
        # see the old vendor name and recreate the deleted vendor.
        c = self.local_db.conn.cursor()
        c.execute(
            "SELECT remoteId FROM expenses WHERE vendorId = ? AND userId = ?",
            (vendor[0], self.current_uid)
        )
        remote_expense_ids = [row[0] for row in c.fetchall() if row[0]]
        if FIREBASE_AVAILABLE:
            for remote_expense_id in remote_expense_ids:
                if not remote_expense_id.startswith("local_"):
                    fb_update(
                        f"users/{self.current_uid}/expenses/{remote_expense_id}",
                        {"vendor": "", "remoteVendorId": None}
                    )
        if FIREBASE_AVAILABLE and vendor[1]:
            fb_delete(f"users/{self.current_uid}/vendors/{vendor[1]}")
        c.execute(
            "UPDATE expenses SET vendor = '' WHERE vendorId = ? AND userId = ?",
            (vendor[0], self.current_uid)
        )
        self.local_db.conn.commit()
        self.local_db.delete_vendor(vendor[0], self.current_uid)
        self.selected_vendor_id = None
        self._refresh_expense_data()
        self._status(f"🗑️ Vendor '{vendor[2]}' deleted")

    def _add_expense(self):
        if not self.current_uid:
            messagebox.showerror("Error", "Please select a user first")
            return

        vendor_name = self.exp_vendor_v.get().strip()
        amount = self.exp_amt_v.get().strip()
        date = self.exp_date_v.get().strip()
        memo = self.exp_memo_v.get().strip()
        category_name = self.exp_category_v.get().strip()

        if not vendor_name:
            messagebox.showerror("Error", "Vendor is required")
            return
        if not amount:
            messagebox.showerror("Error", "Amount is required")
            return
        if not category_name:
            messagebox.showerror("Error", "Category is required")
            return

        date = self._validate_date(date)

        # Get or create category
        category = self.local_db.get_category_by_name(category_name, self.current_uid)
        if not category:
            # Create new category
            if FIREBASE_AVAILABLE:
                ref = fb_push(f"users/{self.current_uid}/categories", {"name": category_name})
                remote_category_id = ref.key
                category_id = self.local_db.upsert_category(remote_category_id, category_name, self.current_uid)
            else:
                mock_id = f"local_{datetime.now().timestamp()}"
                remote_category_id = mock_id
                category_id = self.local_db.upsert_category(mock_id, category_name, self.current_uid)
            self._refresh_expense_data()
        else:
            category_id = category[0]
            remote_category_id = category[1]

        # Get or create vendor
        vendor = self.local_db.get_vendor_by_name(vendor_name, self.current_uid)
        if not vendor:
            if FIREBASE_AVAILABLE:
                ref = fb_push(f"users/{self.current_uid}/vendors", {"name": vendor_name})
                remote_vendor_id = ref.key
                vendor_id = self.local_db.upsert_vendor(remote_vendor_id, vendor_name, self.current_uid)
            else:
                mock_id = f"local_{datetime.now().timestamp()}"
                remote_vendor_id = mock_id
                vendor_id = self.local_db.upsert_vendor(mock_id, vendor_name, self.current_uid)
            self._refresh_expense_data()
        else:
            vendor_id = vendor[0]
            remote_vendor_id = vendor[1]

        if FIREBASE_AVAILABLE:
            d = {
                "vendor": vendor_name,
                "remoteVendorId": remote_vendor_id,
                "amount": amount,
                "date": date,
                "memo": memo,
                "remoteCategoryId": remote_category_id
            }
            ref = fb_push(f"users/{self.current_uid}/expenses", d)
            remote_id = ref.key
        else:
            remote_id = f"local_{datetime.now().timestamp()}"

        self.local_db.upsert_expense(
            remote_id, vendor_id, amount, date, memo,
            category_id, self.current_uid
        )

        self._refresh_expense_data()
        self._clear_expense_form()
        self._status(f"✅ Expense added to '{category_name}'")

    def _update_expense(self):
        if not self.exp_current_lid:
            messagebox.showerror("Error", "Please select an expense to update")
            return

        vendor_name = self.exp_vendor_v.get().strip()
        amount = self.exp_amt_v.get().strip()
        date = self.exp_date_v.get().strip()
        memo = self.exp_memo_v.get().strip()
        category_name = self.exp_category_v.get().strip()

        if not vendor_name:
            messagebox.showerror("Error", "Vendor is required")
            return
        if not amount:
            messagebox.showerror("Error", "Amount is required")
            return
        if not category_name:
            messagebox.showerror("Error", "Category is required")
            return

        date = self._validate_date(date)

        # Get or create category
        category = self.local_db.get_category_by_name(category_name, self.current_uid)
        if not category:
            # Create new category
            if FIREBASE_AVAILABLE:
                ref = fb_push(f"users/{self.current_uid}/categories", {"name": category_name})
                remote_category_id = ref.key
                category_id = self.local_db.upsert_category(remote_category_id, category_name, self.current_uid)
            else:
                mock_id = f"local_{datetime.now().timestamp()}"
                remote_category_id = mock_id
                category_id = self.local_db.upsert_category(mock_id, category_name, self.current_uid)
            self._refresh_expense_data()
        else:
            category_id = category[0]
            remote_category_id = category[1]

        # Get or create vendor
        vendor = self.local_db.get_vendor_by_name(vendor_name, self.current_uid)
        if not vendor:
            if FIREBASE_AVAILABLE:
                ref = fb_push(f"users/{self.current_uid}/vendors", {"name": vendor_name})
                remote_vendor_id = ref.key
                vendor_id = self.local_db.upsert_vendor(remote_vendor_id, vendor_name, self.current_uid)
            else:
                mock_id = f"local_{datetime.now().timestamp()}"
                remote_vendor_id = mock_id
                vendor_id = self.local_db.upsert_vendor(mock_id, vendor_name, self.current_uid)
            self._refresh_expense_data()
        else:
            vendor_id = vendor[0]
            remote_vendor_id = vendor[1]

        c = self.local_db.conn.cursor()
        c.execute("SELECT remoteId FROM expenses WHERE localId = ?", (self.exp_current_lid,))
        result = c.fetchone()
        remote_id = result[0] if result else None

        if FIREBASE_AVAILABLE and remote_id and not remote_id.startswith("local_"):
            d = {
                "vendor": vendor_name,
                "remoteVendorId": remote_vendor_id,
                "amount": amount,
                "date": date,
                "memo": memo,
                "remoteCategoryId": remote_category_id
            }
            fb_update(f"users/{self.current_uid}/expenses/{remote_id}", d)

        self.local_db.upsert_expense(
            remote_id, vendor_id, amount, date, memo,
            category_id, self.current_uid
        )

        self._refresh_expense_data()
        self._clear_expense_form()
        self._status(f"✅ Expense updated")

    def _delete_expense(self):
        if not self.exp_current_lid:
            messagebox.showerror("Error", "Please select an expense to delete")
            return
        if not messagebox.askyesno("Delete Expense", "Delete the selected expense?"):
            return
        c = self.local_db.conn.cursor()
        c.execute("SELECT remoteId FROM expenses WHERE localId = ?", (self.exp_current_lid,))
        result = c.fetchone()
        if result and FIREBASE_AVAILABLE:
            remote_id = result[0]
            if not remote_id.startswith("local_"):
                fb_delete(f"users/{self.current_uid}/expenses/{remote_id}")
        self.local_db.delete_expense(self.exp_current_lid)
        self._refresh_expense_data()
        self._clear_expense_form()
        self._status(f"🗑️ Expense deleted")

    def _load_users(self):
        if not FIREBASE_AVAILABLE:
            self._status("⚠️ Offline mode - no users loaded")
            return
        try:
            data = fb_get("users")
            uids = list(data.keys()) if data else []
            self.uid_combo["values"] = uids
            if uids and not self.current_uid:
                self.uid_combo.set(uids[0])
                self._on_user_select()
        except Exception as e:
            self._status(f"❌ Error loading users: {e}")

    def _status(self, msg):
        self.status_var.set(msg)


if __name__ == "__main__":
    app = PersonalAssistant()
    app.mainloop()
