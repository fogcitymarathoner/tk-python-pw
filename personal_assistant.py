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

        # Vendors table (new)
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

    def get_expenses_by_category(self, category_id, user_id, ascending=True):
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
            WHERE e.userId = ? AND (e.categoryId = ? OR ? IS NULL)
            ORDER BY 
                CAST(substr(e.date, 1, 4) AS INTEGER) {order},
                CAST(substr(e.date, 6, 2) AS INTEGER) {order},
                CAST(substr(e.date, 9, 2) AS INTEGER) {order}
        """, (user_id, category_id, category_id))
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
            # If vendor_id is None, keep the existing vendor text if available
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
        self.sort_ascending = True  # True = oldest first, False = newest first

        # Password module data storage
        self.pw_all_data = {}  # Store all password data for searching
        self.password_length = tk.IntVar(value=12)  # Default to 12 characters

        # Subscription module data storage
        self.sub_all_data = {}  # Store all subscription data for searching
        self.sub_search_v = tk.StringVar()  # Search variable for subscriptions

        # Expense module data storage
        self.vendors_cache = []  # Store vendors for dropdown

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

            # Sync vendors
            vendors = fb_get(f"users/{self.current_uid}/vendors")
            if vendors:
                for rid, d in vendors.items():
                    self.local_db.upsert_vendor(rid, d.get("name"), self.current_uid)

            exps = fb_get(f"users/{self.current_uid}/expenses")
            if exps:
                for rid, d in exps.items():
                    rcat = d.get("remoteCategoryId")
                    lcat = self.local_db.get_category_by_remote(rcat) if rcat else None

                    rvendor = d.get("remoteVendorId")
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
        self.pw_pass_original_v = tk.StringVar()  # Store original password
        self.pw_vendor_v = tk.StringVar()
        self.pw_search_v = tk.StringVar()  # Search variable
        self.pw_current_id = None

        # ─── Search Bar ──────────────────────────────────────────────────────────
        search_frame = tk.Frame(container, bg="#1e1e2e")
        search_frame.pack(fill="x", pady=(5, 10))

        ttk.Label(search_frame, text="🔍 Search:").pack(side="left", padx=(0, 5))
        self.pw_search_entry = ttk.Entry(search_frame, textvariable=self.pw_search_v, width=40, font=("Courier", 10))
        self.pw_search_entry.pack(side="left", padx=5)

        ttk.Button(search_frame, text="Search", command=self._pw_search).pack(side="left", padx=2)
        ttk.Button(search_frame, text="Clear", command=self._pw_clear_search).pack(side="left", padx=2)

        # Bind Enter key to search
        self.pw_search_entry.bind("<Return>", lambda e: self._pw_search())

        ttk.Label(search_frame, text="(search by account or vendor)", foreground="#6c7086", font=("Courier", 9)).pack(
            side="left", padx=10)

        # ─── Treeview ────────────────────────────────────────────────────────────
        self.pw_tree = ttk.Treeview(container, columns=("v", "a", "p"), show="headings")
        self.pw_tree.heading("v", text="Vendor")
        self.pw_tree.heading("a", text="Account")
        self.pw_tree.heading("p", text="Password")
        self.pw_tree.pack(fill="both", expand=True, pady=5)
        self.pw_tree.bind("<<TreeviewSelect>>", self._pw_on_select)

        # ─── Form ──────────────────────────────────────────────────────────────
        form = tk.LabelFrame(container, text=" Edit Password ", bg="#1e1e2e", fg="#cba6f7")
        form.pack(fill="x", pady=10)

        # Row 0: Vendor and Account
        ttk.Label(form, text="Vendor:").grid(row=0, column=0, padx=5, pady=5, sticky="e")
        ttk.Entry(form, textvariable=self.pw_vendor_v, width=20).grid(row=0, column=1, padx=5)

        ttk.Label(form, text="Account:").grid(row=0, column=2, padx=5, sticky="e")
        ttk.Entry(form, textvariable=self.pw_account_v, width=20).grid(row=0, column=3, padx=5)

        # Row 1: Password, Generate, Length
        ttk.Label(form, text="Password:").grid(row=1, column=0, padx=5, pady=5, sticky="e")
        self.pw_entry = ttk.Entry(form, textvariable=self.pw_pass_v, width=20)
        self.pw_entry.grid(row=1, column=1, padx=5)

        # Copy button
        self.copy_button = ttk.Button(form, text="📋 Copy", command=self._pw_copy_password)
        self.copy_button.grid(row=1, column=2, padx=(0, 5), pady=5)

        # Generate button
        ttk.Button(form, text="⚡ Generate Password", command=self._pw_generate_password).grid(
            row=1, column=3, padx=(0, 5), pady=5)

        # Length selection
        ttk.Label(form, text="Length:").grid(row=1, column=4, padx=(5, 2), pady=5)
        ttk.Radiobutton(form, text="12", variable=self.password_length, value=12).grid(
            row=1, column=5, padx=(0, 2), pady=5)
        ttk.Radiobutton(form, text="14", variable=self.password_length, value=14).grid(
            row=1, column=6, padx=(0, 2), pady=5)

        # Row 2: Original Password (read-only)
        ttk.Label(form, text="Original Password:").grid(row=2, column=0, padx=5, pady=5, sticky="e")
        self.pw_original_entry = ttk.Entry(form, textvariable=self.pw_pass_original_v, width=50, state="readonly")
        self.pw_original_entry.grid(row=2, column=1, columnspan=6, padx=5, pady=5, sticky="w")

        # Row 3: Buttons
        btn_f = tk.Frame(form, bg="#1e1e2e")
        btn_f.grid(row=3, column=0, columnspan=7, pady=5)
        ttk.Button(btn_f, text="➕ Add", command=self._pw_add).pack(side="left", padx=5)
        ttk.Button(btn_f, text="💾 Update", command=self._pw_update).pack(side="left", padx=5)
        ttk.Button(btn_f, text="🗑️ Delete", command=self._pw_delete).pack(side="left", padx=5)
        ttk.Button(btn_f, text="✖ Clear", command=self._pw_clear_form).pack(side="left", padx=5)

    def _pw_generate_password(self):
        """Generate a strong password with the selected length"""
        length = self.password_length.get()  # Get selected length (12 or 14)
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
        """Copy the current password to clipboard"""
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
        """Filter passwords by account or vendor"""
        search_term = self.pw_search_v.get().strip().lower()

        if not search_term:
            self._pw_clear_search()
            return

        # Clear the tree and show only matching items
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
        """Clear search and show all passwords"""
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
        self.pw_pass_original_v.set(p)  # Store original password

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
        """Clear all password form fields"""
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
        self.sub_due_date_v = tk.StringVar()  # Due Date
        self.sub_memo_v = tk.StringVar()  # Memo
        self.sub_current_id = None

        # ─── Search Bar ──────────────────────────────────────────────────────────
        search_frame = tk.Frame(container, bg="#1e1e2e")
        search_frame.pack(fill="x", pady=(5, 10))

        ttk.Label(search_frame, text="🔍 Search:").pack(side="left", padx=(0, 5))
        self.sub_search_entry = ttk.Entry(search_frame, textvariable=self.sub_search_v, width=40, font=("Courier", 10))
        self.sub_search_entry.pack(side="left", padx=5)

        ttk.Button(search_frame, text="Search", command=self._sub_search).pack(side="left", padx=2)
        ttk.Button(search_frame, text="Clear", command=self._sub_clear_search).pack(side="left", padx=2)

        # Bind Enter key to search
        self.sub_search_entry.bind("<Return>", lambda e: self._sub_search())

        ttk.Label(search_frame, text="(search by name or account)", foreground="#6c7086", font=("Courier", 9)).pack(
            side="left", padx=10)

        # ─── Treeview ────────────────────────────────────────────────────────────
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

        # ─── Form ──────────────────────────────────────────────────────────────
        form = tk.LabelFrame(container, text=" Edit Subscription ", bg="#1e1e2e", fg="#cba6f7")
        form.pack(fill="x", pady=10)

        # Row 0: Service Name and Account
        ttk.Label(form, text="Service:").grid(row=0, column=0, padx=5, pady=5, sticky="e")
        ttk.Entry(form, textvariable=self.sub_name_v, width=20).grid(row=0, column=1, padx=5)

        ttk.Label(form, text="Account:").grid(row=0, column=2, padx=5, sticky="e")
        ttk.Entry(form, textvariable=self.sub_acc_v, width=20).grid(row=0, column=3, padx=5)

        # Row 1: Amount and Due Date
        ttk.Label(form, text="Amount:").grid(row=1, column=0, padx=5, pady=5, sticky="e")
        ttk.Entry(form, textvariable=self.sub_amt_v, width=20).grid(row=1, column=1, padx=5)

        ttk.Label(form, text="Due Date:").grid(row=1, column=2, padx=5, sticky="e")
        ttk.Entry(form, textvariable=self.sub_due_date_v, width=20).grid(row=1, column=3, padx=5)

        # Row 2: Memo (full width)
        ttk.Label(form, text="Memo:").grid(row=2, column=0, padx=5, pady=5, sticky="e")
        ttk.Entry(form, textvariable=self.sub_memo_v, width=68).grid(row=2, column=1, columnspan=3, padx=5, sticky="w")

        # Row 3: Buttons
        btn_f = tk.Frame(form, bg="#1e1e2e")
        btn_f.grid(row=3, column=0, columnspan=4, pady=5)
        ttk.Button(btn_f, text="➕ Add", command=self._sub_add).pack(side="left", padx=5)
        ttk.Button(btn_f, text="💾 Update", command=self._sub_update).pack(side="left", padx=5)
        ttk.Button(btn_f, text="🗑️ Delete", command=self._sub_delete).pack(side="left", padx=5)
        ttk.Button(btn_f, text="✖ Clear", command=self._sub_clear_form).pack(side="left", padx=5)

    def _sub_search(self):
        """Filter subscriptions by name or account"""
        search_term = self.sub_search_v.get().strip().lower()

        if not search_term:
            self._sub_clear_search()
            return

        # Clear the tree and show only matching items
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
        """Clear search and show all subscriptions"""
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
        """Clear all subscription form fields"""
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
        self.exp_current_lid = None
        self.cats_cache = []
        self.vendors_cache = []
        self.current_view = "all"  # "all" or "category"

        # Main Paned Window
        paned = ttk.PanedWindow(container, orient="horizontal")
        paned.pack(fill="both", expand=True)

        # ─── Left Panel: Categories ───────────────────────────────────────────
        left_panel = tk.Frame(paned, bg="#1e1e2e")
        paned.add(left_panel, weight=1)

        l_f = tk.LabelFrame(left_panel, text=" Categories ", bg="#1e1e2e", fg="#cba6f7")
        l_f.pack(fill="both", expand=True, padx=5, pady=5)

        self.cat_box = tk.Listbox(l_f, bg="#2a2a3e", fg="#cdd6f4", font=("Courier", 10), selectmode="single")
        self.cat_box.pack(fill="both", expand=True, padx=5, pady=5)
        self.cat_box.bind("<<ListboxSelect>>", self._on_category_select)

        cat_btn_frame = tk.Frame(l_f, bg="#1e1e2e")
        cat_btn_frame.pack(fill="x", padx=5, pady=5)
        ttk.Button(cat_btn_frame, text="➕ Add Category", command=self._add_category).pack(side="left", padx=2)
        ttk.Button(cat_btn_frame, text="✏️ Rename", command=self._rename_category).pack(side="left", padx=2)
        ttk.Button(cat_btn_frame, text="🗑️ Delete", command=self._delete_category).pack(side="left", padx=2)

        # ─── Right Panel: Expenses ────────────────────────────────────────────
        right_panel = tk.Frame(paned, bg="#1e1e2e")
        paned.add(right_panel, weight=3)

        self.category_info_var = tk.StringVar(value="Select a category to manage expenses")
        info_frame = tk.Frame(right_panel, bg="#1e1e2e")
        info_frame.pack(fill="x", padx=5, pady=2)
        ttk.Label(info_frame, textvariable=self.category_info_var, font=("Courier", 10, "bold")).pack(side="left")

        # Sort toggle button
        self.sort_btn_var = tk.StringVar(value="⬆ Oldest First")
        ttk.Button(info_frame, textvariable=self.sort_btn_var, command=self._toggle_sort).pack(side="right", padx=5)

        # Expense Tree - columns depend on view
        self.exp_tree = ttk.Treeview(right_panel, columns=("c", "v", "a", "d", "m"), show="headings")
        self.exp_tree.heading("c", text="Category")
        self.exp_tree.heading("v", text="Vendor")
        self.exp_tree.heading("a", text="Amount")
        self.exp_tree.heading("d", text="Date", command=lambda: self._sort_by_column("d"))
        self.exp_tree.heading("m", text="Memo")
        self.exp_tree.column("c", width=120, minwidth=80)
        self.exp_tree.column("v", width=150)
        self.exp_tree.column("a", width=80)
        self.exp_tree.column("d", width=100)
        self.exp_tree.column("m", width=180)
        self.exp_tree.pack(fill="both", expand=True, pady=5)
        self.exp_tree.bind("<<TreeviewSelect>>", self._on_expense_select)

        # ─── Expense Form ──────────────────────────────────────────────────────
        form = tk.LabelFrame(right_panel, text=" Add/Edit Expense ", bg="#1e1e2e", fg="#cba6f7")
        form.pack(fill="x", pady=5)

        # Row 1 - Vendor (Combobox), Amount, Date
        ttk.Label(form, text="Vendor:").grid(row=0, column=0, padx=5, pady=5, sticky="e")

        # Vendor Combobox with ability to add new vendors
        vendor_frame = tk.Frame(form, bg="#1e1e2e")
        vendor_frame.grid(row=0, column=1, padx=5, sticky="w")

        self.vendor_combo = ttk.Combobox(vendor_frame, textvariable=self.exp_vendor_v, width=18, font=("Courier", 10))
        self.vendor_combo.pack(side="left")

        ttk.Button(vendor_frame, text="➕", width=3, command=self._add_vendor).pack(side="left", padx=2)

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

        # Row 2 - Memo
        ttk.Label(form, text="Memo:").grid(row=1, column=0, padx=5, pady=5, sticky="e")
        ttk.Entry(form, textvariable=self.exp_memo_v, width=60).grid(row=1, column=1, columnspan=5, padx=5, sticky="ew")

        # Buttons
        btn_frame = tk.Frame(right_panel, bg="#1e1e2e")
        btn_frame.pack(fill="x", pady=5)
        ttk.Button(btn_frame, text="➕ Add Expense", command=self._add_expense).pack(side="left", padx=5)
        ttk.Button(btn_frame, text="✏️ Update Expense", command=self._update_expense).pack(side="left", padx=5)
        ttk.Button(btn_frame, text="🗑️ Delete Expense", command=self._delete_expense).pack(side="left", padx=5)
        ttk.Button(btn_frame, text="🔄 Clear Form", command=self._clear_expense_form).pack(side="left", padx=5)

        # Vendor management buttons
        ttk.Button(btn_frame, text="🏷️ Manage Vendors", command=self._manage_vendors).pack(side="left", padx=5)

    def _add_vendor(self):
        """Add a new vendor"""
        if not self.current_uid:
            messagebox.showerror("Error", "Please select a user first")
            return

        name = simpledialog.askstring("New Vendor", "Enter vendor name:", parent=self)
        if not name or not name.strip():
            return

        name = name.strip()

        # Check if vendor already exists
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

    def _manage_vendors(self):
        """Open a dialog to manage vendors"""
        if not self.current_uid:
            messagebox.showerror("Error", "Please select a user first")
            return

        dialog = tk.Toplevel(self)
        dialog.title("Manage Vendors")
        dialog.geometry("400x500")
        dialog.configure(bg="#1e1e2e")
        dialog.resizable(False, False)

        # Listbox for vendors
        list_frame = tk.Frame(dialog, bg="#1e1e2e")
        list_frame.pack(fill="both", expand=True, padx=10, pady=10)

        vendor_listbox = tk.Listbox(list_frame, bg="#2a2a3e", fg="#cdd6f4", font=("Courier", 10), selectmode="single")
        vendor_listbox.pack(fill="both", expand=True)

        # Load vendors
        vendors = self.local_db.get_vendors(self.current_uid)
        for vendor in vendors:
            vendor_listbox.insert(tk.END, vendor[2])

        # Buttons
        btn_frame = tk.Frame(dialog, bg="#1e1e2e")
        btn_frame.pack(fill="x", padx=10, pady=10)

        def delete_vendor():
            selection = vendor_listbox.curselection()
            if not selection:
                messagebox.showerror("Error", "Please select a vendor to delete")
                return

            idx = selection[0]
            vendor = vendors[idx]

            if not messagebox.askyesno("Confirm",
                                       f"Delete vendor '{vendor[2]}'?\nExpenses using this vendor will be moved to 'Uncategorized'."):
                return

            if FIREBASE_AVAILABLE and vendor[1]:
                fb_delete(f"users/{self.current_uid}/vendors/{vendor[1]}")

            self.local_db.delete_vendor(vendor[0], self.current_uid)
            self._refresh_expense_data()
            dialog.destroy()
            self._status(f"🗑️ Vendor '{vendor[2]}' deleted")

        def rename_vendor():
            selection = vendor_listbox.curselection()
            if not selection:
                messagebox.showerror("Error", "Please select a vendor to rename")
                return

            idx = selection[0]
            vendor = vendors[idx]

            new_name = simpledialog.askstring("Rename Vendor",
                                              f"Rename '{vendor[2]}' to:",
                                              initialvalue=vendor[2],
                                              parent=dialog)
            if not new_name or not new_name.strip():
                return

            new_name = new_name.strip()

            if FIREBASE_AVAILABLE and vendor[1]:
                fb_update(f"users/{self.current_uid}/vendors/{vendor[1]}", {"name": new_name})

            self.local_db.upsert_vendor(vendor[1], new_name, self.current_uid)
            self._refresh_expense_data()
            dialog.destroy()
            self._status(f"✅ Vendor renamed to '{new_name}'")

        ttk.Button(btn_frame, text="✏️ Rename", command=rename_vendor).pack(side="left", padx=5)
        ttk.Button(btn_frame, text="🗑️ Delete", command=delete_vendor).pack(side="left", padx=5)
        ttk.Button(btn_frame, text="Close", command=dialog.destroy).pack(side="right", padx=5)

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
        """Toggle between oldest first and newest first"""
        self.sort_ascending = not self.sort_ascending
        self.sort_btn_var.set("⬆ Oldest First" if self.sort_ascending else "⬇ Newest First")
        self._refresh_current_view()

    def _refresh_current_view(self):
        if self.selected_category_id:
            self._load_expenses_by_category(self.selected_category_id)
        else:
            self._load_all_expenses()

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
        if not self.exp_vendor_v.get():
            self.vendor_combo.set('')

        if self.selected_category_id:
            self._load_expenses_by_category(self.selected_category_id)
        else:
            self._load_all_expenses()

    def _on_category_select(self, event):
        selection = self.cat_box.curselection()
        if not selection:
            return

        idx = selection[0]

        if idx == 0:  # "All Expenses"
            self.selected_category_id = None
            self.current_view = "all"
            self.category_info_var.set("📊 All Expenses")
            self._load_all_expenses()
        else:
            cat = self.cats_cache[idx - 1]
            self.selected_category_id = cat[0]
            self.current_view = "category"
            expense_count = self._get_expense_count(cat[0])
            self.category_info_var.set(f"📂 Category: {cat[2]} ({expense_count} expenses)")
            self._load_expenses_by_category(cat[0])

        self._clear_expense_form()

    def _load_all_expenses(self):
        if not self.current_uid:
            return
        rows = self.local_db.get_expenses_with_categories(self.current_uid, self.sort_ascending)
        self._populate_expense_tree(rows, show_category=True)

    def _load_expenses_by_category(self, category_id):
        if not self.current_uid:
            return
        rows = self.local_db.get_expenses_by_category(category_id, self.current_uid, self.sort_ascending)
        self._populate_expense_tree(rows, show_category=False)

    def _populate_expense_tree(self, rows, show_category=True):
        self.exp_tree.delete(*self.exp_tree.get_children())

        if show_category:
            # All Expenses view: Category | Vendor | Amount | Date | Memo
            self.exp_tree.config(columns=("c", "v", "a", "d", "m"))
            self.exp_tree.heading("c", text="Category")
            self.exp_tree.heading("v", text="Vendor")
            self.exp_tree.heading("a", text="Amount")
            self.exp_tree.heading("d", text="Date")
            self.exp_tree.heading("m", text="Memo")
            self.exp_tree.column("c", width=120, minwidth=80)
            self.exp_tree.column("v", width=150)
            self.exp_tree.column("a", width=80)
            self.exp_tree.column("d", width=100)
            self.exp_tree.column("m", width=180)

            for r in rows:
                amount = r[3] or "0.00"
                if amount and not amount.startswith("$"):
                    try:
                        amount = f"${float(amount):.2f}"
                    except ValueError:
                        pass

                category_name = r[6] or "Uncategorized"
                vendor_name = r[2] or "Uncategorized"
                self.exp_tree.insert("", "end", iid=str(r[0]),
                                     values=(category_name, vendor_name, amount, r[4] or "", r[5] or ""))
        else:
            # Category view: Vendor | Amount | Date | Memo
            self.exp_tree.config(columns=("v", "a", "d", "m"))
            self.exp_tree.heading("v", text="Vendor")
            self.exp_tree.heading("a", text="Amount")
            self.exp_tree.heading("d", text="Date")
            self.exp_tree.heading("m", text="Memo")
            self.exp_tree.column("v", width=150)
            self.exp_tree.column("a", width=80)
            self.exp_tree.column("d", width=100)
            self.exp_tree.column("m", width=180)

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

    def _get_expense_count(self, category_id):
        if not self.current_uid:
            return 0
        rows = self.local_db.get_expenses_by_category(category_id, self.current_uid, self.sort_ascending)
        return len(rows)

    def _on_expense_select(self, event):
        selection = self.exp_tree.selection()
        if not selection:
            return

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
            self.exp_vendor_v.set(vendor_name or "")
            self.exp_amt_v.set(amount or "")
            self.exp_date_v.set(date or datetime.now().strftime("%Y-%m-%d"))
            self.exp_memo_v.set(memo or "")

            if category_id and self.cats_cache:
                for i, cat in enumerate(self.cats_cache, start=1):
                    if cat[0] == category_id:
                        self.cat_box.selection_clear(0, tk.END)
                        self.cat_box.selection_set(i)
                        self.cat_box.see(i)
                        break

    def _clear_expense_form(self):
        self.exp_vendor_v.set("")
        self.exp_amt_v.set("")
        self.exp_date_v.set(datetime.now().strftime("%Y-%m-%d"))
        self.exp_memo_v.set("")
        self.exp_current_lid = None
        self.exp_tree.selection_remove(self.exp_tree.selection())

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

        expense_count = self._get_expense_count(cat[0])
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

    def _add_expense(self):
        if not self.current_uid:
            messagebox.showerror("Error", "Please select a user first")
            return

        if not self.selected_category_id:
            messagebox.showerror("Error", "Please select a category first")
            return

        vendor_name = self.exp_vendor_v.get().strip()
        amount = self.exp_amt_v.get().strip()
        date = self.exp_date_v.get().strip()
        memo = self.exp_memo_v.get().strip()

        if not vendor_name:
            messagebox.showerror("Error", "Vendor is required")
            return
        if not amount:
            messagebox.showerror("Error", "Amount is required")
            return

        date = self._validate_date(date)

        cat = next((c for c in self.cats_cache if c[0] == self.selected_category_id), None)
        if not cat:
            messagebox.showerror("Error", "Selected category not found")
            return

        # Get or create vendor
        vendor = self.local_db.get_vendor_by_name(vendor_name, self.current_uid)
        if not vendor:
            # Create new vendor
            if FIREBASE_AVAILABLE:
                ref = fb_push(f"users/{self.current_uid}/vendors", {"name": vendor_name})
                vendor_id = self.local_db.upsert_vendor(ref.key, vendor_name, self.current_uid)
            else:
                mock_id = f"local_{datetime.now().timestamp()}"
                vendor_id = self.local_db.upsert_vendor(mock_id, vendor_name, self.current_uid)

            self._refresh_expense_data()
        else:
            vendor_id = vendor[0]

        if FIREBASE_AVAILABLE:
            d = {
                "vendor": vendor_name,  # Keep for backward compatibility
                "remoteVendorId": vendor[1] if vendor else None,
                "amount": amount,
                "date": date,
                "memo": memo,
                "remoteCategoryId": cat[1]
            }
            ref = fb_push(f"users/{self.current_uid}/expenses", d)
            remote_id = ref.key
        else:
            remote_id = f"local_{datetime.now().timestamp()}"

        self.local_db.upsert_expense(
            remote_id, vendor_id, amount, date, memo,
            cat[0], self.current_uid
        )

        self._refresh_expense_data()
        self._clear_expense_form()
        self._status(f"✅ Expense added to '{cat[2]}'")

    def _update_expense(self):
        if not self.exp_current_lid:
            messagebox.showerror("Error", "Please select an expense to update")
            return

        vendor_name = self.exp_vendor_v.get().strip()
        amount = self.exp_amt_v.get().strip()
        date = self.exp_date_v.get().strip()
        memo = self.exp_memo_v.get().strip()

        if not vendor_name:
            messagebox.showerror("Error", "Vendor is required")
            return
        if not amount:
            messagebox.showerror("Error", "Amount is required")
            return

        date = self._validate_date(date)

        c = self.local_db.conn.cursor()
        c.execute("SELECT remoteId, categoryId FROM expenses WHERE localId = ?", (self.exp_current_lid,))
        result = c.fetchone()
        if not result:
            messagebox.showerror("Error", "Expense not found")
            return

        remote_id, category_id = result

        # Get or create vendor
        vendor = self.local_db.get_vendor_by_name(vendor_name, self.current_uid)
        if not vendor:
            # Create new vendor
            if FIREBASE_AVAILABLE:
                ref = fb_push(f"users/{self.current_uid}/vendors", {"name": vendor_name})
                vendor_id = self.local_db.upsert_vendor(ref.key, vendor_name, self.current_uid)
            else:
                mock_id = f"local_{datetime.now().timestamp()}"
                vendor_id = self.local_db.upsert_vendor(mock_id, vendor_name, self.current_uid)

            self._refresh_expense_data()
        else:
            vendor_id = vendor[0]

        cat = next((c for c in self.cats_cache if c[0] == category_id), None)

        if FIREBASE_AVAILABLE and remote_id and not remote_id.startswith("local_"):
            d = {
                "vendor": vendor_name,
                "remoteVendorId": vendor[1] if vendor else None,
                "amount": amount,
                "date": date,
                "memo": memo,
                "remoteCategoryId": cat[1] if cat else None
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