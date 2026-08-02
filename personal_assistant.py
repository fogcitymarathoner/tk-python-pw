# personal_assistant.py
"""
Unified Personal Assistant - Password Manager, Subscription Tracker, Business Expenses
Integrated Local-First Relational SQLite Sync for Expenses (Mirroring Android Room Schema)
"""

import tkinter as tk
from tkinter import ttk, messagebox, simpledialog
import sqlite3
import firebase_admin
from firebase_admin import credentials, db
import secrets
import string
import os
from dotenv import load_dotenv
from datetime import date, datetime

# Load environment variables
load_dotenv()

SERVICE_ACCOUNT_FILE = os.getenv("SERVICE_ACCOUNT_FILE", "fogcitymarathoner-2a35f802a83d.json")
DATABASE_URL = os.getenv("DATABASE_URL", "https://fogcitymarathoner-default-rtdb.firebaseio.com")

# ── Firebase Initialization ──────────────────────────────────────────────

try:
    if not firebase_admin._apps:
        cred = credentials.Certificate(SERVICE_ACCOUNT_FILE)
        firebase_admin.initialize_app(cred, {"databaseURL": DATABASE_URL})
    print(f"✅ Firebase initialized")
except Exception as e:
    print(f"❌ Firebase init failed: {e}")
    raise

# ── Firebase Helpers ─────────────────────────────────────────────────────

def fb_get(path): return db.reference(path).get()
def fb_push(path, data): return db.reference(path).push(data)
def fb_update(path, data): db.reference(path).update(data)
def fb_delete(path): db.reference(path).delete()

# ── SQLite Local Database Class (Relational) ─────────────────────────────

class LocalDB:
    def __init__(self, db_name="personal_assistant.db"):
        self.conn = sqlite3.connect(db_name, check_same_thread=False)
        self._create_tables()

    def _create_tables(self):
        cursor = self.conn.cursor()
        # Mirroring Android Room Tables
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS categories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                remoteId TEXT,
                name TEXT NOT NULL,
                userId TEXT NOT NULL
            )
        """)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS expenses (
                localId INTEGER PRIMARY KEY AUTOINCREMENT,
                remoteId TEXT,
                vendor TEXT,
                categoryId INTEGER,
                amount TEXT,
                date TEXT,
                memo TEXT,
                userId TEXT NOT NULL,
                FOREIGN KEY (categoryId) REFERENCES categories (id) ON DELETE SET NULL
            )
        """)
        self.conn.commit()

    def get_categories(self, user_id):
        c = self.conn.cursor()
        c.execute("SELECT id, remoteId, name FROM categories WHERE userId = ?", (user_id,))
        return c.fetchall()

    def get_category_by_remote(self, remote_id):
        c = self.conn.cursor()
        c.execute("SELECT id, name FROM categories WHERE remoteId = ?", (remote_id,))
        return c.fetchone()

    def upsert_category(self, remote_id, name, user_id):
        c = self.conn.cursor()
        c.execute("SELECT id FROM categories WHERE remoteId = ?", (remote_id,))
        if c.fetchone():
            c.execute("UPDATE categories SET name=? WHERE remoteId=?", (name, remote_id))
        else:
            c.execute("INSERT INTO categories (remoteId, name, userId) VALUES (?, ?, ?)", (remote_id, name, user_id))
        self.conn.commit()

    def get_expenses_with_categories(self, user_id):
        c = self.conn.cursor()
        c.execute("""
            SELECT e.localId, e.remoteId, e.vendor, e.amount, e.date, e.memo, cat.name, e.categoryId
            FROM expenses e LEFT JOIN categories cat ON e.categoryId = cat.id
            WHERE e.userId = ? ORDER BY e.date DESC
        """, (user_id,))
        return c.fetchall()

    def upsert_expense(self, remote_id, vendor, amount, dt, memo, category_id, user_id):
        c = self.conn.cursor()
        c.execute("SELECT localId FROM expenses WHERE remoteId = ?", (remote_id,))
        exists = c.fetchone()
        if exists:
            c.execute("UPDATE expenses SET vendor=?, amount=?, date=?, memo=?, categoryId=? WHERE remoteId=?",
                      (vendor, str(amount), dt, memo, category_id, remote_id))
        else:
            c.execute("INSERT INTO expenses (remoteId, vendor, amount, date, memo, categoryId, userId) VALUES (?,?,?,?,?,?,?)",
                      (remote_id, vendor, str(amount), dt, memo, category_id, user_id))
        self.conn.commit()

# ── Main Application ──────────────────────────────────────────────────────

class PersonalAssistant(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Personal Assistant (Sync Pro)")
        self.geometry("1200x850")
        self.configure(bg="#1e1e2e")
        self.local_db = LocalDB()
        self.current_uid = None

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

    def _build_ui(self):
        # Top Bar
        top = tk.Frame(self, bg="#1e1e2e")
        top.pack(fill="x", padx=10, pady=10)
        ttk.Label(top, text="User UID:").pack(side="left")
        self.uid_combo = ttk.Combobox(top, width=42, font=("Courier", 10))
        self.uid_combo.pack(side="left", padx=6)
        self.uid_combo.bind("<<ComboboxSelected>>", self._on_user_select)
        ttk.Button(top, text="↻ Reload", command=self._load_users).pack(side="left", padx=4)
        ttk.Button(top, text="☁ Cloud Sync", command=self._sync_all).pack(side="left", padx=4)

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
        tk.Label(self, textvariable=self.status_var, bg="#181825", fg="#a6e3a1", font=("Courier", 9), anchor="w").pack(fill="x")

    def _on_user_select(self, _=None):
        self.current_uid = self.uid_combo.get().strip()
        self._status(f"User: {self.current_uid}")
        self._load_passwords()
        self._load_subscriptions()
        self._refresh_expense_data()
        self.after(500, self._sync_all)

    def _sync_all(self):
        if not self.current_uid: return
        self._status("Syncing...")
        try:
            # Sync Categories
            cats = fb_get(f"users/{self.current_uid}/categories")
            if cats:
                for rid, d in cats.items(): self.local_db.upsert_category(rid, d.get("name"), self.current_uid)
            # Sync Expenses
            exps = fb_get(f"users/{self.current_uid}/expenses")
            if exps:
                for rid, d in exps.items():
                    rcat = d.get("remoteCategoryId")
                    lcat = self.local_db.get_category_by_remote(rcat) if rcat else None
                    self.local_db.upsert_expense(rid, d.get("vendor"), d.get("amount"), d.get("date"), d.get("memo",""), lcat[0] if lcat else None, self.current_uid)
            self._refresh_expense_data()
            self._status("✅ Sync Complete")
        except Exception as e: self._status(f"❌ Error: {e}")

    # ── Password Module (Form at bottom) ────────────────────────────────────

    def _build_password_module(self):
        container = self.password_frame
        self.pw_account_v = tk.StringVar(); self.pw_pass_v = tk.StringVar(); self.pw_vendor_v = tk.StringVar()
        self.pw_current_id = None; self.pw_all_data = []

        # Tree
        self.pw_tree = ttk.Treeview(container, columns=("v", "a", "p"), show="headings")
        self.pw_tree.heading("v", text="Vendor"); self.pw_tree.heading("a", text="Account"); self.pw_tree.heading("p", text="Password")
        self.pw_tree.pack(fill="both", expand=True, pady=5)
        self.pw_tree.bind("<<TreeviewSelect>>", self._pw_on_select)

        # Form at bottom
        form = tk.LabelFrame(container, text=" Edit Password ", bg="#1e1e2e", fg="#cba6f7")
        form.pack(fill="x", pady=10)
        ttk.Label(form, text="Vendor:").grid(row=0, column=0, padx=5, pady=5)
        ttk.Entry(form, textvariable=self.pw_vendor_v).grid(row=0, column=1)
        ttk.Label(form, text="Account:").grid(row=0, column=2, padx=5)
        ttk.Entry(form, textvariable=self.pw_account_v).grid(row=0, column=3)
        ttk.Label(form, text="Password:").grid(row=0, column=4, padx=5)
        ttk.Entry(form, textvariable=self.pw_pass_v).grid(row=0, column=5)

        btn_f = tk.Frame(container, bg="#1e1e2e")
        btn_f.pack(fill="x", pady=5)
        ttk.Button(btn_f, text="Add", command=self._pw_add).pack(side="left", padx=5)
        ttk.Button(btn_f, text="Update", command=self._pw_update).pack(side="left", padx=5)
        ttk.Button(btn_f, text="Delete", command=self._pw_delete).pack(side="left", padx=5)

    def _load_passwords(self):
        data = fb_get(f"users/{self.current_uid}/passwords")
        self.pw_tree.delete(*self.pw_tree.get_children())
        if data:
            for pid, r in data.items():
                self.pw_tree.insert("", "end", iid=pid, values=(r.get("vendor",""), r.get("account",""), r.get("pw","")))

    def _pw_on_select(self, _):
        sel = self.pw_tree.selection()
        if not sel: return
        self.pw_current_id = sel[0]
        v, a, p = self.pw_tree.item(sel[0], "values")
        self.pw_vendor_v.set(v); self.pw_account_v.set(a); self.pw_pass_v.set(p)

    def _pw_add(self):
        d = {"vendor": self.pw_vendor_v.get(), "account": self.pw_account_v.get(), "pw": self.pw_pass_v.get()}
        fb_push(f"users/{self.current_uid}/passwords", d); self._load_passwords()

    def _pw_update(self):
        if not self.pw_current_id: return
        d = {"vendor": self.pw_vendor_v.get(), "account": self.pw_account_v.get(), "pw": self.pw_pass_v.get()}
        fb_update(f"users/{self.current_uid}/passwords/{self.pw_current_id}", d); self._load_passwords()

    def _pw_delete(self):
        if not self.pw_current_id: return
        fb_delete(f"users/{self.current_uid}/passwords/{self.pw_current_id}"); self._load_passwords()

    # ── Subscription Module (Form at bottom) ────────────────────────────────

    def _build_subscription_module(self):
        container = self.subscription_frame
        self.sub_name_v = tk.StringVar(); self.sub_acc_v = tk.StringVar(); self.sub_amt_v = tk.StringVar()
        self.sub_current_id = None

        self.sub_tree = ttk.Treeview(container, columns=("n", "a", "m"), show="headings")
        self.sub_tree.heading("n", text="Service"); self.sub_tree.heading("a", text="Account"); self.sub_tree.heading("m", text="Amount")
        self.sub_tree.pack(fill="both", expand=True, pady=5)
        self.sub_tree.bind("<<TreeviewSelect>>", self._sub_on_select)

        form = tk.LabelFrame(container, text=" Edit Subscription ", bg="#1e1e2e", fg="#cba6f7")
        form.pack(fill="x", pady=10)
        ttk.Label(form, text="Service:").grid(row=0, column=0, padx=5, pady=5)
        ttk.Entry(form, textvariable=self.sub_name_v).grid(row=0, column=1)
        ttk.Label(form, text="Account:").grid(row=0, column=2, padx=5)
        ttk.Entry(form, textvariable=self.sub_acc_v).grid(row=0, column=3)
        ttk.Label(form, text="Amount:").grid(row=0, column=4, padx=5)
        ttk.Entry(form, textvariable=self.sub_amt_v).grid(row=0, column=5)

        btn_f = tk.Frame(container, bg="#1e1e2e")
        btn_f.pack(fill="x", pady=5)
        ttk.Button(btn_f, text="Add", command=self._sub_add).pack(side="left", padx=5)
        ttk.Button(btn_f, text="Update", command=self._sub_update).pack(side="left", padx=5)
        ttk.Button(btn_f, text="Delete", command=self._sub_delete).pack(side="left", padx=5)

    def _load_subscriptions(self):
        data = fb_get(f"users/{self.current_uid}/subscriptions")
        self.sub_tree.delete(*self.sub_tree.get_children())
        if data:
            for pid, r in data.items():
                self.sub_tree.insert("", "end", iid=pid, values=(r.get("name",""), r.get("account",""), r.get("amount","")))

    def _sub_on_select(self, _):
        sel = self.sub_tree.selection()
        if not sel: return
        self.sub_current_id = sel[0]
        n, a, m = self.sub_tree.item(sel[0], "values")
        self.sub_name_v.set(n); self.sub_acc_v.set(a); self.sub_amt_v.set(m)

    def _sub_add(self):
        d = {"name": self.sub_name_v.get(), "account": self.sub_acc_v.get(), "amount": self.sub_amt_v.get()}
        fb_push(f"users/{self.current_uid}/subscriptions", d); self._load_subscriptions()

    def _sub_update(self):
        if not self.sub_current_id: return
        d = {"name": self.sub_name_v.get(), "account": self.sub_acc_v.get(), "amount": self.sub_amt_v.get()}
        fb_update(f"users/{self.current_uid}/subscriptions/{self.sub_current_id}", d); self._load_subscriptions()

    def _sub_delete(self):
        if not self.sub_current_id: return
        fb_delete(f"users/{self.current_uid}/subscriptions/{self.sub_current_id}"); self._load_subscriptions()

    # ── Relational Expense Module (SQLite Sync) ──────────────────────────────

    def _build_expense_module(self):
        container = self.expense_frame
        self.exp_vendor_v = tk.StringVar(); self.exp_amt_v = tk.StringVar(); self.exp_date_v = tk.StringVar()
        self.exp_memo_v = tk.StringVar(); self.exp_current_lid = None
        self.cats_cache = []

        paned = ttk.PanedWindow(container, orient="horizontal")
        paned.pack(fill="both", expand=True)

        # Left Listbox
        l_f = tk.LabelFrame(paned, text=" Categories ", bg="#1e1e2e", fg="#cba6f7")
        paned.add(l_f, weight=1)
        self.cat_box = tk.Listbox(l_f, bg="#2a2a3e", fg="#cdd6f4", font=("Courier", 10))
        self.cat_box.pack(fill="both", expand=True, padx=5, pady=5)
        self.cat_box.bind("<<ListboxSelect>>", self._on_exp_cat_select)
        ttk.Button(l_f, text="+ Add Category", command=self._exp_new_cat).pack(fill="x", padx=5, pady=5)

        # Right Tree + Form
        r_f = tk.Frame(paned, bg="#1e1e2e")
        paned.add(r_f, weight=4)

        self.exp_tree = ttk.Treeview(r_f, columns=("v", "c", "a", "d"), show="headings")
        self.exp_tree.heading("v", text="Vendor"); self.exp_tree.heading("c", text="Category")
        self.exp_tree.heading("a", text="Amount"); self.exp_tree.heading("d", text="Date")
        self.exp_tree.pack(fill="both", expand=True, pady=5)
        self.exp_tree.bind("<<TreeviewSelect>>", self._on_exp_select)

        # Form at bottom of right frame
        form = tk.LabelFrame(r_f, text=" Edit Expense ", bg="#1e1e2e", fg="#cba6f7")
        form.pack(fill="x", pady=5)
        ttk.Label(form, text="Vendor:").grid(row=0, column=0, padx=5, pady=5)
        ttk.Entry(form, textvariable=self.exp_vendor_v).grid(row=0, column=1)
        ttk.Label(form, text="Category:").grid(row=0, column=2, padx=5)
        self.exp_cat_combo = ttk.Combobox(form); self.exp_cat_combo.grid(row=0, column=3)
        ttk.Label(form, text="Amount:").grid(row=0, column=4, padx=5)
        ttk.Entry(form, textvariable=self.exp_amt_v).grid(row=0, column=5)
        ttk.Label(form, text="Date:").grid(row=1, column=0, padx=5, pady=5)
        ttk.Entry(form, textvariable=self.exp_date_v).grid(row=1, column=1)
        ttk.Label(form, text="Memo:").grid(row=1, column=2, padx=5)
        ttk.Entry(form, textvariable=self.exp_memo_v, width=40).grid(row=1, column=3, columnspan=3)

        btn_f = tk.Frame(r_f, bg="#1e1e2e")
        btn_f.pack(fill="x", pady=5)
        ttk.Button(btn_f, text="Add Expense", command=self._exp_add).pack(side="left", padx=5)
        ttk.Button(btn_f, text="Update", command=self._exp_update).pack(side="left", padx=5)
        ttk.Button(btn_f, text="Delete", command=self._exp_delete).pack(side="left", padx=5)

    def _refresh_expense_data(self):
        if not self.current_uid: return
        self.cats_cache = self.local_db.get_categories(self.current_uid)
        self.cat_box.delete(0, "end"); self.cat_box.insert("end", "All")
        c_names = []
        for c in self.cats_cache: self.cat_box.insert("end", c[2]); c_names.append(c[2])
        self.exp_cat_combo["values"] = c_names

        rows = self.local_db.get_expenses_with_categories(self.current_uid)
        self.exp_tree.delete(*self.exp_tree.get_children())
        for r in rows: self.exp_tree.insert("", "end", iid=r[0], values=(r[2], r[6] or "None", r[3], r[4]))

    def _on_exp_cat_select(self, _):
        idx = self.cat_box.curselection()
        if not idx or idx[0] == 0: self._refresh_expense_data(); return
        name = self.cat_box.get(idx[0])
        rows = self.local_db.get_expenses_with_categories(self.current_uid)
        self.exp_tree.delete(*self.exp_tree.get_children())
        for r in rows:
            if r[6] == name: self.exp_tree.insert("", "end", iid=r[0], values=(r[2], r[6], r[3], r[4]))

    def _on_exp_select(self, _):
        sel = self.exp_tree.selection()
        if not sel: return
        self.exp_current_lid = sel[0]
        # fetch full record from local db
        c = self.local_db.conn.cursor()
        c.execute("SELECT e.vendor, e.amount, e.date, e.memo, cat.name FROM expenses e LEFT JOIN categories cat ON e.categoryId=cat.id WHERE e.localId=?", (self.exp_current_lid,))
        r = c.fetchone()
        if r:
            self.exp_vendor_v.set(r[0]); self.exp_amt_v.set(r[1]); self.exp_date_v.set(r[2])
            self.exp_memo_v.set(r[3]); self.exp_cat_combo.set(r[4] or "")

    def _exp_new_cat(self):
        n = simpledialog.askstring("Category", "New category name:")
        if n and self.current_uid:
            ref = fb_push(f"users/{self.current_uid}/categories", {"name": n})
            self.local_db.upsert_category(ref.key, n, self.current_uid); self._refresh_expense_data()

    def _exp_add(self):
        c_name = self.exp_cat_combo.get()
        c_obj = next((x for x in self.cats_cache if x[2] == c_name), None)
        d = {"vendor": self.exp_vendor_v.get(), "amount": self.exp_amt_v.get(), "date": self.exp_date_v.get(), "memo": self.exp_memo_v.get(), "remoteCategoryId": c_obj[1] if c_obj else None}
        ref = fb_push(f"users/{self.current_uid}/expenses", d)
        self.local_db.upsert_expense(ref.key, d["vendor"], d["amount"], d["date"], d["memo"], c_obj[0] if c_obj else None, self.current_uid)
        self._refresh_expense_data()

    def _exp_update(self):
        if not self.exp_current_lid: return
        c_name = self.exp_cat_combo.get()
        c_obj = next((x for x in self.cats_cache if x[2] == c_name), None)
        # get remoteId
        cursor = self.local_db.conn.cursor()
        cursor.execute("SELECT remoteId FROM expenses WHERE localId=?", (self.exp_current_lid,))
        rid = cursor.fetchone()[0]
        d = {"vendor": self.exp_vendor_v.get(), "amount": self.exp_amt_v.get(), "date": self.exp_date_v.get(), "memo": self.exp_memo_v.get(), "remoteCategoryId": c_obj[1] if c_obj else None}
        fb_update(f"users/{self.current_uid}/expenses/{rid}", d)
        self.local_db.upsert_expense(rid, d["vendor"], d["amount"], d["date"], d["memo"], c_obj[0] if c_obj else None, self.current_uid)
        self._refresh_expense_data()

    def _exp_delete(self):
        if not self.exp_current_lid: return
        cursor = self.local_db.conn.cursor()
        cursor.execute("SELECT remoteId FROM expenses WHERE localId=?", (self.exp_current_lid,))
        rid = cursor.fetchone()[0]
        fb_delete(f"users/{self.current_uid}/expenses/{rid}")
        cursor.execute("DELETE FROM expenses WHERE localId=?", (self.exp_current_lid,))
        self.local_db.conn.commit(); self._refresh_expense_data()

    # ── Utilities ────────────────────────────────────────────────────────────

    def _load_users(self):
        try:
            data = fb_get("users")
            uids = list(data.keys()) if data else []
            self.uid_combo["values"] = uids
            if uids and not self.current_uid: self.uid_combo.set(uids[0]); self._on_user_select()
        except: pass

    def _status(self, msg): self.status_var.set(msg)

if __name__ == "__main__":
    PersonalAssistant().mainloop()
