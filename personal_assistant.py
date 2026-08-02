# personal_assistant.py
"""
Unified Personal Assistant - Password Manager, Subscription Tracker, Business Expenses
All data stored in Firebase under users/{uid}/{module}

Requirements:
    pip install firebase-admin python-dotenv

Place your service account JSON file next to this script, and create a .env file
with:
    DATABASE_URL=https://fogcitymarathoner-default-rtdb.firebaseio.com
    SERVICE_ACCOUNT_FILE=fogcitymarathoner-2a35f802a83d.json
"""

import tkinter as tk
from tkinter import ttk, messagebox
import firebase_admin
from firebase_admin import credentials, db
import secrets
import string
import os
from dotenv import load_dotenv
from datetime import date

# Load environment variables from .env file
load_dotenv()

# Get configuration from environment variables
SERVICE_ACCOUNT_FILE = os.getenv("SERVICE_ACCOUNT_FILE", "fogcitymarathoner-2a35f802a83d.json")
DATABASE_URL = os.getenv("DATABASE_URL", "https://fogcitymarathoner-default-rtdb.firebaseio.com")

# ── Firebase Initialization ──────────────────────────────────────────────

try:
    cred = credentials.Certificate(SERVICE_ACCOUNT_FILE)
    firebase_admin.initialize_app(cred, {"databaseURL": DATABASE_URL})
    print(f"✅ Firebase initialized with service account: {SERVICE_ACCOUNT_FILE}")
except Exception as e:
    print(f"❌ Failed to initialize Firebase: {e}")
    print(f"   Service account file: {SERVICE_ACCOUNT_FILE}")
    print(f"   Database URL: {DATABASE_URL}")
    raise


# ── Firebase Helper Functions ──────────────────────────────────────────────

def fb_get(path):
    return db.reference(path).get()


def fb_push(path, data):
    return db.reference(path).push(data)


def fb_update(path, data):
    db.reference(path).update(data)


def fb_delete(path):
    db.reference(path).delete()


# ── Expense Categories ──────────────────────────────────────────────────────

EXPENSE_CATEGORIES = {
    "COGS": "Cost of goods sold",
    "ADVERTISING": "Advertising & marketing",
    "CAR_TRUCK": "Car & truck expenses",
    "COMMISSIONS": "Commissions & fees",
    "CONTRACT_LABOR": "Contract labor",
    "DEPRECIATION": "Depreciation",
    "EMPLOYEE_BENEFITS": "Employee benefit programs",
    "INSURANCE": "Insurance",
    "INTEREST": "Interest",
    "LEGAL_PROFESSIONAL": "Legal & professional services",
    "OFFICE_EXPENSES": "Office expenses",
    "RENT": "Rent",
    "REPAIRS": "Repairs & maintenance",
    "SUPPLIES": "Supplies",
    "TAXES_LICENSES": "Taxes & licenses",
    "TRAVEL": "Travel",
    "MEALS": "Meals",
    "UTILITIES": "Utilities",
    "WAGES": "Wages",
    "HOME_OFFICE": "Home office",
    "SOFTWARE_SUBSCRIPTIONS": "Software & subscriptions",
    "EDUCATION": "Education"
}

CATEGORIES_LIST = list(EXPENSE_CATEGORIES.items())


# ── Main Application ──────────────────────────────────────────────────────

class PersonalAssistant(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Personal Assistant")
        self.geometry("1024x768")
        self.configure(bg="#1e1e2e")
        self.resizable(True, True)

        # Global state
        self.current_uid = None
        self.current_user = None  # Alias for current_uid (for expense module)

        # Configure styles
        self._configure_styles()

        # Build UI
        self._build_ui()
        self._load_users()

    def _configure_styles(self):
        style = ttk.Style(self)
        style.theme_use("clam")

        # Common styles for all modules
        style.configure("Treeview",
                        background="#2a2a3e",
                        foreground="#cdd6f4",
                        fieldbackground="#2a2a3e",
                        rowheight=28)
        style.configure("Treeview.Heading",
                        background="#313244",
                        foreground="#cba6f7",
                        font=("Courier", 10, "bold"))
        style.map("Treeview", background=[("selected", "#45475a")])
        style.configure("TLabel",
                        background="#1e1e2e",
                        foreground="#cdd6f4",
                        font=("Courier", 10))
        style.configure("TEntry",
                        fieldbackground="#313244",
                        foreground="#cdd6f4",
                        font=("Courier", 10))
        style.configure("TButton",
                        background="#313244",
                        foreground="#cba6f7",
                        font=("Courier", 10, "bold"),
                        padding=4)
        style.map("TButton", background=[("active", "#45475a")])
        style.configure("TLabelframe",
                        background="#1e1e2e",
                        foreground="#cba6f7")
        style.configure("TLabelframe.Label",
                        background="#1e1e2e",
                        foreground="#cba6f7",
                        font=("Courier", 10, "bold"))
        style.configure("TRadiobutton",
                        background="#1e1e2e",
                        foreground="#cdd6f4",
                        font=("Courier", 10))

    def _build_ui(self):
        # ── Top Bar ──
        top = tk.Frame(self, bg="#1e1e2e")
        top.pack(fill="x", padx=10, pady=(10, 0))

        ttk.Label(top, text="User UID:").pack(side="left")
        self.uid_combo = ttk.Combobox(top, textvariable=tk.StringVar(),
                                      width=42, font=("Courier", 10))
        self.uid_combo.pack(side="left", padx=6)
        self.uid_combo.bind("<<ComboboxSelected>>", self._on_user_select)

        ttk.Button(top, text="↻ Refresh", command=self._load_users).pack(side="left", padx=4)
        ttk.Button(top, text="+ New User", command=self._new_user_dialog).pack(side="left", padx=4)

        # Show which service account is being used
        tk.Label(top, text=f"🔑 {os.path.basename(SERVICE_ACCOUNT_FILE)}",
                 bg="#1e1e2e", fg="#a6e3a1", font=("Courier", 9)).pack(side="right", padx=8)

        # ── Tabbed Interface ──
        self.notebook = ttk.Notebook(self)
        self.notebook.pack(fill="both", expand=True, padx=10, pady=8)

        # Create tabs
        self.password_frame = tk.Frame(self.notebook, bg="#1e1e2e")
        self.subscription_frame = tk.Frame(self.notebook, bg="#1e1e2e")
        self.expense_frame = tk.Frame(self.notebook, bg="#1e1e2e")

        self.notebook.add(self.password_frame, text="🔑 Passwords")
        self.notebook.add(self.subscription_frame, text="📋 Subscriptions")
        self.notebook.add(self.expense_frame, text="💰 Expenses")

        # Build each module
        self._build_password_module()
        self._build_subscription_module()
        self._build_expense_module()

        # ── Status Bar ──
        self.status_var = tk.StringVar(value="Ready")
        tk.Label(self, textvariable=self.status_var,
                 bg="#181825", fg="#a6e3a1", font=("Courier", 9), anchor="w").pack(fill="x")

    # ── User Management ─────────────────────────────────────────────────────

    def _load_users(self):
        self._status("Loading users…")
        try:
            data = fb_get("users")
            uids = list(data.keys()) if data else []
            self.uid_combo["values"] = uids
            if uids and not self.current_uid:
                self.uid_combo.set(uids[0])
                self._on_user_select()
            self._status(f"Loaded {len(uids)} user(s).")
        except Exception as ex:
            self._status(f"Error: {ex}")

    def _on_user_select(self, _=None):
        uid = self.uid_combo.get().strip()
        if not uid:
            return
        self.current_uid = uid
        self.current_user = uid
        self._status(f"Selected user: {uid}")
        # Refresh all modules
        self._load_passwords()
        self._load_subscriptions()
        self._load_expenses()

    def _new_user_dialog(self):
        dlg = tk.Toplevel(self)
        dlg.title("New User UID")
        dlg.configure(bg="#1e1e2e")
        dlg.resizable(False, False)
        dlg.transient(self)
        dlg.grab_set()

        ttk.Label(dlg, text="Enter UID (e.g. Firebase Auth UID):").pack(padx=16, pady=(12, 4))
        uid_entry = ttk.Entry(dlg, width=40)
        uid_entry.pack(padx=16)

        def create():
            uid = uid_entry.get().strip()
            if not uid:
                messagebox.showwarning("Invalid", "Please enter a UID.")
                return
            try:
                fb_update(f"users/{uid}", {"_created": True})
                self._load_users()
                self.uid_combo.set(uid)
                self._on_user_select()
                dlg.destroy()
                self._status(f"Created user: {uid}")
            except Exception as ex:
                self._status(f"Error: {ex}")

        ttk.Button(dlg, text="Create User", command=create).pack(pady=10)

    def _status(self, msg):
        self.status_var.set(msg)

    # ── Password Manager Module ────────────────────────────────────────────

    def _build_password_module(self):
        container = self.password_frame

        # Variables
        self.pw_account_var = tk.StringVar()
        self.pw_password_var = tk.StringVar()
        self.pw_password_original_var = tk.StringVar()
        self.pw_vendor_var = tk.StringVar()
        self.pw_password_length = tk.IntVar(value=12)
        self.pw_current_pushid = None
        self.pw_all_rows = []
        self.pw_filter_var = tk.StringVar()

        # Filter bar
        filter_bar = tk.Frame(container, bg="#1e1e2e")
        filter_bar.pack(fill="x", pady=(0, 4))

        ttk.Label(filter_bar, text="Filter:").pack(side="left")
        pw_filter_entry = ttk.Entry(filter_bar, textvariable=self.pw_filter_var, width=30)
        pw_filter_entry.pack(side="left", padx=6)
        pw_filter_entry.bind("<Return>", lambda e: self._pw_apply_filter())

        ttk.Button(filter_bar, text="🔍 Search", command=self._pw_apply_filter).pack(side="left", padx=4)
        ttk.Button(filter_bar, text="✖ Clear", command=self._pw_clear_filter).pack(side="left", padx=4)

        # Password list
        mid = tk.Frame(container, bg="#1e1e2e")
        mid.pack(fill="both", expand=True, pady=8)

        cols = ("vendor", "account", "pw")
        self.pw_tree = ttk.Treeview(mid, columns=cols, show="headings", selectmode="browse")
        for col, w in [("vendor", 200), ("account", 250), ("pw", 280)]:
            self.pw_tree.heading(col, text=col.capitalize())
            self.pw_tree.column(col, width=w)

        vsb = ttk.Scrollbar(mid, orient="vertical", command=self.pw_tree.yview)
        self.pw_tree.configure(yscrollcommand=vsb.set)
        vsb.pack(side="right", fill="y")
        self.pw_tree.pack(fill="both", expand=True)
        self.pw_tree.bind("<<TreeviewSelect>>", self._pw_on_select)

        # Form
        form = tk.LabelFrame(container, text=" Password Record ", bg="#1e1e2e",
                             fg="#cba6f7", font=("Courier", 10, "bold"),
                             bd=1, relief="groove")
        form.pack(fill="x", pady=(0, 10))

        # Row 0: Vendor, Account
        ttk.Label(form, text="Vendor:").grid(row=0, column=0, padx=(10, 2), pady=8, sticky="e")
        ttk.Entry(form, textvariable=self.pw_vendor_var, width=20).grid(row=0, column=1, padx=(0, 10), pady=8)

        ttk.Label(form, text="Account:").grid(row=0, column=2, padx=(10, 2), pady=8, sticky="e")
        ttk.Entry(form, textvariable=self.pw_account_var, width=20).grid(row=0, column=3, padx=(0, 10), pady=8)

        # Row 1: Password with copy and generate
        ttk.Label(form, text="Password:").grid(row=1, column=0, padx=(10, 2), pady=8, sticky="e")
        self.pw_password_entry = ttk.Entry(form, textvariable=self.pw_password_var, width=20)
        self.pw_password_entry.grid(row=1, column=1, padx=(0, 10), pady=8)

        ttk.Button(form, text="📋 Copy", command=self._pw_copy_password).grid(row=1, column=2, padx=(0, 4), pady=8)
        ttk.Button(form, text="⚡ Generate", command=self._pw_generate_password).grid(row=1, column=3, padx=(0, 4),
                                                                                     pady=8)

        ttk.Label(form, text="Length:").grid(row=1, column=4, padx=(10, 2), pady=8)
        ttk.Radiobutton(form, text="12", variable=self.pw_password_length, value=12).grid(row=1, column=5, padx=(0, 2),
                                                                                          pady=8)
        ttk.Radiobutton(form, text="14", variable=self.pw_password_length, value=14).grid(row=1, column=6, padx=(0, 2),
                                                                                          pady=8)

        # Row 2: Password Original
        ttk.Label(form, text="Original:").grid(row=2, column=0, padx=(10, 2), pady=8, sticky="e")
        ttk.Entry(form, textvariable=self.pw_password_original_var, width=50).grid(row=2, column=1, columnspan=6,
                                                                                   padx=(0, 10), pady=8, sticky="w")

        # Row 3: Buttons
        btn_frame = tk.Frame(form, bg="#1e1e2e")
        btn_frame.grid(row=3, column=0, columnspan=7, pady=(0, 8))
        for text, cmd in [("➕ Add", self._pw_add), ("💾 Update", self._pw_update),
                          ("🗑 Delete", self._pw_delete), ("✖ Clear", self._pw_clear_form)]:
            ttk.Button(btn_frame, text=text, command=cmd).pack(side="left", padx=6)

    def _load_passwords(self):
        if not self.current_uid:
            return
        self._status("Loading passwords…")
        try:
            data = fb_get(f"users/{self.current_uid}/passwords")
            self.pw_tree.delete(*self.pw_tree.get_children())
            self.pw_all_rows = []
            if data:
                for pushid, rec in data.items():
                    row = (rec.get("vendor", ""), rec.get("account", ""), rec.get("pw", ""))
                    self.pw_all_rows.append((pushid, row))
                    self.pw_tree.insert("", "end", iid=pushid, values=row)
            self._status(f"Loaded {len(data) if data else 0} password(s).")
        except Exception as ex:
            self._status(f"Error loading passwords: {ex}")

    def _pw_on_select(self, _=None):
        sel = self.pw_tree.selection()
        if not sel:
            return
        self.pw_current_pushid = sel[0]
        vendor, account, pw = self.pw_tree.item(sel[0], "values")
        self.pw_account_var.set(account)
        self.pw_vendor_var.set(vendor)
        self.pw_password_var.set(pw)
        self.pw_password_original_var.set(pw)

    def _pw_copy_password(self):
        password = self.pw_password_var.get().strip()
        if not password:
            self._status("⚠️ No password to copy!")
            return
        try:
            self.clipboard_clear()
            self.clipboard_append(password)
            self._status("✅ Password copied to clipboard!")
        except Exception as e:
            self._status(f"❌ Error copying to clipboard: {e}")

    def _pw_generate_password(self):
        length = self.pw_password_length.get()
        allowed = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#!@$%^*()_=?.,:~-[]"
        pw = ''.join(secrets.choice(allowed) for _ in range(length))
        self.pw_password_var.set(pw)
        self._status(f"Generated {length}-character strong password.")

    def _pw_add(self):
        if not self.current_uid:
            messagebox.showwarning("No User", "Select a user first.")
            return
        rec = {"vendor": self.pw_vendor_var.get(), "pw": self.pw_password_var.get(),
               "account": self.pw_account_var.get()}
        if not any(rec.values()):
            messagebox.showwarning("Empty", "Fill in at least one field.")
            return
        try:
            ref = fb_push(f"users/{self.current_uid}/passwords", rec)
            pushid = ref.key
            row = (rec["vendor"], rec["account"], rec["pw"])
            self.pw_all_rows.append((pushid, row))
            self.pw_tree.insert("", "end", iid=pushid, values=row)
            self._pw_clear_form()
            self._status(f"Added password for {rec['vendor']}")
        except Exception as ex:
            self._status(f"Error: {ex}")

    def _pw_update(self):
        if not self.pw_current_pushid:
            messagebox.showwarning("No Selection", "Select a record to update.")
            return
        rec = {"vendor": self.pw_vendor_var.get(), "pw": self.pw_password_var.get(),
               "account": self.pw_account_var.get()}
        try:
            fb_update(f"users/{self.current_uid}/passwords/{self.pw_current_pushid}", rec)
            self.pw_tree.item(self.pw_current_pushid, values=(rec["vendor"], rec["account"], rec["pw"]))
            for i, (pid, row) in enumerate(self.pw_all_rows):
                if pid == self.pw_current_pushid:
                    self.pw_all_rows[i] = (pid, (rec["vendor"], rec["account"], rec["pw"]))
                    break
            self._status(f"Updated password for {rec['vendor']}")
        except Exception as ex:
            self._status(f"Error: {ex}")

    def _pw_delete(self):
        if not self.pw_current_pushid:
            messagebox.showwarning("No Selection", "Select a record to delete.")
            return
        if not messagebox.askyesno("Confirm", "Delete this password record?"):
            return
        try:
            fb_delete(f"users/{self.current_uid}/passwords/{self.pw_current_pushid}")
            self.pw_tree.delete(self.pw_current_pushid)
            self.pw_all_rows = [(pid, row) for pid, row in self.pw_all_rows if pid != self.pw_current_pushid]
            self.pw_current_pushid = None
            self._pw_clear_form()
            self._status("Deleted password record.")
        except Exception as ex:
            self._status(f"Error: {ex}")

    def _pw_apply_filter(self):
        search = self.pw_filter_var.get().strip().lower()
        if not search:
            return
        self.pw_tree.delete(*self.pw_tree.get_children())
        match_count = 0
        for pushid, row in self.pw_all_rows:
            if search in row[0].lower() or search in row[1].lower():
                self.pw_tree.insert("", "end", iid=pushid, values=row)
                match_count += 1
        self._status(f"Found {match_count} match(es) for '{search}'")

    def _pw_clear_filter(self):
        self.pw_filter_var.set("")
        self.pw_tree.delete(*self.pw_tree.get_children())
        for pushid, row in self.pw_all_rows:
            self.pw_tree.insert("", "end", iid=pushid, values=row)

    def _pw_clear_form(self):
        self.pw_account_var.set("")
        self.pw_password_var.set("")
        self.pw_password_original_var.set("")
        self.pw_vendor_var.set("")
        self.pw_current_pushid = None
        self.pw_tree.selection_remove(self.pw_tree.selection())

    # ── Subscription Module ────────────────────────────────────────────────

    def _build_subscription_module(self):
        container = self.subscription_frame

        # Variables
        self.sub_name_var = tk.StringVar()
        self.sub_account_var = tk.StringVar()
        self.sub_amount_var = tk.StringVar()
        self.sub_due_date_var = tk.StringVar()
        self.sub_memo_var = tk.StringVar()
        self.sub_current_pushid = None
        self.sub_all_rows = []
        self.sub_filter_var = tk.StringVar()

        # Filter bar
        filter_bar = tk.Frame(container, bg="#1e1e2e")
        filter_bar.pack(fill="x", pady=(0, 4))

        ttk.Label(filter_bar, text="Search:").pack(side="left")
        sub_filter_entry = ttk.Entry(filter_bar, textvariable=self.sub_filter_var, width=30)
        sub_filter_entry.pack(side="left", padx=6)
        sub_filter_entry.bind("<Return>", lambda e: self._sub_apply_filter())

        ttk.Button(filter_bar, text="🔍 Search", command=self._sub_apply_filter).pack(side="left", padx=4)
        ttk.Button(filter_bar, text="✖ Clear", command=self._sub_clear_filter).pack(side="left", padx=4)

        # Subscription list
        mid = tk.Frame(container, bg="#1e1e2e")
        mid.pack(fill="both", expand=True, pady=8)

        cols = ("name", "account", "amount", "due_date", "memo")
        self.sub_tree = ttk.Treeview(mid, columns=cols, show="headings", selectmode="browse")

        col_config = [("Name", 200), ("Account", 200), ("Amount", 120),
                      ("Due Date", 120), ("Memo", 200)]
        for col, width in col_config:
            col_id = col.lower().replace(" ", "_")
            self.sub_tree.heading(col_id, text=col)
            self.sub_tree.column(col_id, width=width)

        vsb = ttk.Scrollbar(mid, orient="vertical", command=self.sub_tree.yview)
        self.sub_tree.configure(yscrollcommand=vsb.set)
        vsb.pack(side="right", fill="y")
        self.sub_tree.pack(fill="both", expand=True)
        self.sub_tree.bind("<<TreeviewSelect>>", self._sub_on_select)

        # Form
        form = tk.LabelFrame(container, text=" Subscription Details ", bg="#1e1e2e",
                             fg="#cba6f7", font=("Courier", 10, "bold"),
                             bd=1, relief="groove")
        form.pack(fill="x", pady=(0, 10))

        # Row 0: Name, Account
        ttk.Label(form, text="Service Name:").grid(row=0, column=0, padx=(10, 2), pady=6, sticky="e")
        ttk.Entry(form, textvariable=self.sub_name_var, width=25).grid(row=0, column=1, padx=(0, 10), pady=6)

        ttk.Label(form, text="Account:").grid(row=0, column=2, padx=(10, 2), pady=6, sticky="e")
        ttk.Entry(form, textvariable=self.sub_account_var, width=25).grid(row=0, column=3, padx=(0, 10), pady=6)

        # Row 1: Amount, Due Date
        ttk.Label(form, text="Amount:").grid(row=1, column=0, padx=(10, 2), pady=6, sticky="e")
        ttk.Entry(form, textvariable=self.sub_amount_var, width=25).grid(row=1, column=1, padx=(0, 10), pady=6)

        ttk.Label(form, text="Due Date:").grid(row=1, column=2, padx=(10, 2), pady=6, sticky="e")
        ttk.Entry(form, textvariable=self.sub_due_date_var, width=25).grid(row=1, column=3, padx=(0, 10), pady=6)

        # Row 2: Memo
        ttk.Label(form, text="Memo:").grid(row=2, column=0, padx=(10, 2), pady=6, sticky="e")
        ttk.Entry(form, textvariable=self.sub_memo_var, width=68).grid(row=2, column=1, columnspan=3,
                                                                       padx=(0, 10), pady=6, sticky="w")

        # Row 3: Buttons
        btn_frame = tk.Frame(form, bg="#1e1e2e")
        btn_frame.grid(row=3, column=0, columnspan=4, pady=(0, 8))
        for text, cmd in [("➕ Add", self._sub_add), ("💾 Update", self._sub_update),
                          ("🗑 Delete", self._sub_delete), ("✖ Clear", self._sub_clear_form)]:
            ttk.Button(btn_frame, text=text, command=cmd).pack(side="left", padx=6)

    def _load_subscriptions(self):
        if not self.current_uid:
            return
        self._status("Loading subscriptions…")
        try:
            data = fb_get(f"users/{self.current_uid}/subscriptions")
            self.sub_tree.delete(*self.sub_tree.get_children())
            self.sub_all_rows = []
            if data:
                for pushid, rec in data.items():
                    row = (rec.get("name", ""), rec.get("account", ""), rec.get("amount", ""),
                           rec.get("dueDate", ""), rec.get("memo", ""))
                    self.sub_all_rows.append((pushid, row))
                    self.sub_tree.insert("", "end", iid=pushid, values=row)
            self._status(f"Loaded {len(data) if data else 0} subscription(s).")
        except Exception as ex:
            self._status(f"Error loading subscriptions: {ex}")

    def _sub_on_select(self, _=None):
        sel = self.sub_tree.selection()
        if not sel:
            return
        self.sub_current_pushid = sel[0]
        name, account, amount, due_date, memo = self.sub_tree.item(sel[0], "values")
        self.sub_name_var.set(name)
        self.sub_account_var.set(account)
        self.sub_amount_var.set(amount)
        self.sub_due_date_var.set(due_date)
        self.sub_memo_var.set(memo)

    def _sub_add(self):
        if not self.current_uid:
            messagebox.showwarning("No User", "Select a user first.")
            return
        name = self.sub_name_var.get().strip()
        if not name:
            messagebox.showwarning("Invalid Input", "Service Name is required.")
            return
        subscription = {
            "name": name,
            "account": self.sub_account_var.get().strip(),
            "amount": self.sub_amount_var.get().strip(),
            "dueDate": self.sub_due_date_var.get().strip(),
            "memo": self.sub_memo_var.get().strip()
        }
        try:
            ref = fb_push(f"users/{self.current_uid}/subscriptions", subscription)
            pushid = ref.key
            row = (subscription["name"], subscription["account"], subscription["amount"],
                   subscription["dueDate"], subscription["memo"])
            self.sub_all_rows.append((pushid, row))
            self.sub_tree.insert("", "end", iid=pushid, values=row)
            self._sub_clear_form()
            self._status(f"Added subscription: {subscription['name']}")
        except Exception as ex:
            self._status(f"Error: {ex}")

    def _sub_update(self):
        if not self.sub_current_pushid:
            messagebox.showwarning("No Selection", "Select a subscription to update.")
            return
        name = self.sub_name_var.get().strip()
        if not name:
            messagebox.showwarning("Invalid Input", "Service Name is required.")
            return
        subscription = {
            "name": name,
            "account": self.sub_account_var.get().strip(),
            "amount": self.sub_amount_var.get().strip(),
            "dueDate": self.sub_due_date_var.get().strip(),
            "memo": self.sub_memo_var.get().strip()
        }
        try:
            fb_update(f"users/{self.current_uid}/subscriptions/{self.sub_current_pushid}", subscription)
            self.sub_tree.item(self.sub_current_pushid,
                               values=(subscription["name"], subscription["account"],
                                       subscription["amount"], subscription["dueDate"], subscription["memo"]))
            for i, (pid, row) in enumerate(self.sub_all_rows):
                if pid == self.sub_current_pushid:
                    self.sub_all_rows[i] = (pid, (subscription["name"], subscription["account"],
                                                  subscription["amount"], subscription["dueDate"],
                                                  subscription["memo"]))
                    break
            self._status(f"Updated subscription: {subscription['name']}")
        except Exception as ex:
            self._status(f"Error: {ex}")

    def _sub_delete(self):
        if not self.sub_current_pushid:
            messagebox.showwarning("No Selection", "Select a subscription to delete.")
            return
        name = self.sub_name_var.get().strip() or "this subscription"
        if not messagebox.askyesno("Confirm Delete", f"Delete '{name}'?"):
            return
        try:
            fb_delete(f"users/{self.current_uid}/subscriptions/{self.sub_current_pushid}")
            self.sub_tree.delete(self.sub_current_pushid)
            self.sub_all_rows = [(pid, row) for pid, row in self.sub_all_rows if pid != self.sub_current_pushid]
            self.sub_current_pushid = None
            self._sub_clear_form()
            self._status(f"Deleted subscription: {name}")
        except Exception as ex:
            self._status(f"Error: {ex}")

    def _sub_apply_filter(self):
        search = self.sub_filter_var.get().strip().lower()
        if not search:
            return
        self.sub_tree.delete(*self.sub_tree.get_children())
        match_count = 0
        for pushid, row in self.sub_all_rows:
            if search in row[0].lower() or search in row[1].lower():
                self.sub_tree.insert("", "end", iid=pushid, values=row)
                match_count += 1
        self._status(f"Found {match_count} match(es) for '{search}'")

    def _sub_clear_filter(self):
        self.sub_filter_var.set("")
        self.sub_tree.delete(*self.sub_tree.get_children())
        for pushid, row in self.sub_all_rows:
            self.sub_tree.insert("", "end", iid=pushid, values=row)

    def _sub_clear_form(self):
        self.sub_name_var.set("")
        self.sub_account_var.set("")
        self.sub_amount_var.set("")
        self.sub_due_date_var.set("")
        self.sub_memo_var.set("")
        self.sub_current_pushid = None
        self.sub_tree.selection_remove(self.sub_tree.selection())

    # ── Expense Module ─────────────────────────────────────────────────────

    def _build_expense_module(self):
        container = self.expense_frame

        # Variables
        self.exp_vendor_var = tk.StringVar()
        self.exp_amount_var = tk.StringVar()
        self.exp_purpose_var = tk.StringVar()
        self.exp_date_var = tk.StringVar()
        self.exp_category_var = tk.StringVar()
        self.exp_current_id = None
        self.exp_current_category = None
        self.exp_all_expenses = []
        self.exp_filtered_expenses = []
        self.exp_search_var = tk.StringVar()

        # Set today's date
        self.exp_date_var.set(date.today().strftime("%Y-%m-%d"))

        # Main content (split view)
        paned = ttk.PanedWindow(container, orient="horizontal")
        paned.pack(fill="both", expand=True)

        # Left side - Categories
        left_frame = tk.LabelFrame(paned, text=" Categories ", bg="#1e1e2e",
                                   fg="#cba6f7", font=("Courier", 10, "bold"))
        paned.add(left_frame, weight=1)

        canvas_container = tk.Frame(left_frame, bg="#1e1e2e")
        canvas_container.pack(fill="both", expand=True, padx=5, pady=5)

        canvas = tk.Canvas(canvas_container, bg="#1e1e2e", highlightthickness=0)
        scrollbar = ttk.Scrollbar(canvas_container, orient="vertical", command=canvas.yview)
        scrollable_frame = tk.Frame(canvas, bg="#1e1e2e")

        scrollable_frame.bind("<Configure>",
                              lambda e: canvas.configure(scrollregion=canvas.bbox("all")))
        canvas.create_window((0, 0), window=scrollable_frame, anchor="nw")
        canvas.configure(yscrollcommand=scrollbar.set)

        def _on_mousewheel(event):
            canvas.yview_scroll(int(-1 * (event.delta / 120)), "units")

        # Bind mousewheel to canvas
        canvas.bind_all("<MouseWheel>", _on_mousewheel)

        canvas.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")

        # Category buttons
        rows = 11
        cols = 2
        for i, (cat_key, cat_name) in enumerate(CATEGORIES_LIST):
            row = i // cols
            col = i % cols
            btn = tk.Button(scrollable_frame, text=cat_name,
                            command=lambda k=cat_key: self._exp_select_category(k),
                            bg="#313244", fg="#cdd6f4", font=("Courier", 9),
                            relief="flat", padx=10, pady=15, width=25, height=2,
                            wraplength=180, justify="center")
            btn.grid(row=row, column=col, padx=4, pady=4, sticky="nsew")
            scrollable_frame.grid_rowconfigure(row, weight=1)
            scrollable_frame.grid_columnconfigure(col, weight=1)

        # Right side - Expense List and Form
        right_frame = tk.LabelFrame(paned, text=" Expenses ", bg="#1e1e2e",
                                    fg="#cba6f7", font=("Courier", 10, "bold"))
        paned.add(right_frame, weight=2)

        # Category header
        header_frame = tk.Frame(right_frame, bg="#1e1e2e")
        header_frame.pack(fill="x", padx=5, pady=5)

        self.exp_category_label = ttk.Label(header_frame, text="No category selected",
                                            font=("Courier", 12, "bold"))
        self.exp_category_label.pack(side="left")

        # Search bar
        search_frame = tk.Frame(right_frame, bg="#1e1e2e")
        search_frame.pack(fill="x", padx=5, pady=(0, 5))

        ttk.Label(search_frame, text="🔍").pack(side="left")
        self.exp_search_entry = ttk.Entry(search_frame, textvariable=self.exp_search_var, width=30)
        self.exp_search_entry.pack(side="left", padx=5)
        self.exp_search_entry.bind("<KeyRelease>", self._exp_apply_filter)

        ttk.Button(search_frame, text="Clear", command=self._exp_clear_filter).pack(side="left", padx=5)
        ttk.Button(search_frame, text="Add Expense", command=self._exp_show_add_dialog).pack(side="right")

        # Expense list
        list_frame = tk.Frame(right_frame, bg="#1e1e2e")
        list_frame.pack(fill="both", expand=True, padx=5, pady=5)

        cols = ("vendor", "date", "amount", "purpose")
        self.exp_tree = ttk.Treeview(list_frame, columns=cols, show="headings", selectmode="browse")

        col_config = [("Vendor", 200), ("Date", 100), ("Amount", 100), ("Purpose", 250)]
        for col, width in col_config:
            col_id = col.lower()
            self.exp_tree.heading(col_id, text=col)
            self.exp_tree.column(col_id, width=width)

        vsb = ttk.Scrollbar(list_frame, orient="vertical", command=self.exp_tree.yview)
        self.exp_tree.configure(yscrollcommand=vsb.set)
        vsb.pack(side="right", fill="y")
        self.exp_tree.pack(fill="both", expand=True)

        # Bind double-click and right-click
        self.exp_tree.bind("<Double-1>", self._exp_on_expense_double_click)
        self.exp_tree.bind("<Button-3>", self._exp_on_right_click)

    def _load_expenses(self):
        if not self.current_uid:
            return
        self._status("Loading expenses…")
        try:
            data = fb_get(f"users/{self.current_uid}/expenses")
            self.exp_all_expenses = []
            if data:
                for pushid, rec in data.items():
                    expense = {
                        "id": pushid,
                        "vendor": rec.get("vendor", ""),
                        "date": rec.get("date", ""),
                        "amount": rec.get("amount", 0.0),
                        "purpose": rec.get("purpose", ""),
                        "category": rec.get("category", "")
                    }
                    self.exp_all_expenses.append(expense)
            self._status(f"Loaded {len(self.exp_all_expenses)} expense(s).")
            if self.exp_current_category:
                self._exp_display_category_expenses()
        except Exception as ex:
            self._status(f"Error loading expenses: {ex}")

    def _exp_select_category(self, category_key):
        self.exp_current_category = category_key
        self._exp_display_category_expenses()
        category_name = EXPENSE_CATEGORIES.get(category_key, category_key)
        self._status(f"Showing expenses for: {category_name}")

    def _exp_display_category_expenses(self):
        if not self.exp_current_category:
            self.exp_tree.delete(*self.exp_tree.get_children())
            return

        self.exp_filtered_expenses = [
            e for e in self.exp_all_expenses
            if e.get("category") == self.exp_current_category
        ]
        self._exp_update_tree()
        category_name = EXPENSE_CATEGORIES.get(self.exp_current_category, self.exp_current_category)
        self.exp_category_label.config(text=f"📁 {category_name} ({len(self.exp_filtered_expenses)})")

    def _exp_update_tree(self):
        self.exp_tree.delete(*self.exp_tree.get_children())
        search = self.exp_search_var.get().strip().lower()

        # Sort by date descending
        sorted_expenses = sorted(self.exp_filtered_expenses,
                                 key=lambda x: x.get("date", ""), reverse=True)

        for expense in sorted_expenses:
            if search:
                if (search not in expense["vendor"].lower() and
                        search not in expense["purpose"].lower()):
                    continue
            self.exp_tree.insert("", "end", iid=expense["id"], values=(
                expense["vendor"],
                expense["date"],
                f"${expense['amount']:.2f}",
                expense["purpose"]
            ))

    def _exp_apply_filter(self, _=None):
        self._exp_update_tree()

    def _exp_clear_filter(self):
        self.exp_search_var.set("")
        self._exp_update_tree()

    def _exp_on_right_click(self, event):
        """Show context menu on right-click"""
        item = self.exp_tree.identify_row(event.y)
        if item:
            self.exp_tree.selection_set(item)
            menu = tk.Menu(self, tearoff=0)
            menu.add_command(label="✏️ Edit", command=self._exp_edit_selected_expense)
            menu.add_command(label="🗑 Delete", command=self._exp_delete_selected_expense)
            menu.post(event.x_root, event.y_root)

    def _exp_on_expense_double_click(self, _=None):
        """Handle double-click on expense"""
        self._exp_edit_selected_expense()

    def _exp_edit_selected_expense(self):
        """Edit the currently selected expense"""
        selection = self.exp_tree.selection()
        if not selection:
            messagebox.showinfo("No Selection", "Please select an expense to edit.")
            return

        expense_id = selection[0]
        expense = next((e for e in self.exp_all_expenses if e["id"] == expense_id), None)
        if expense:
            self._exp_show_edit_dialog(add_mode=False, expense=expense)

    def _exp_delete_selected_expense(self):
        """Delete the currently selected expense"""
        selection = self.exp_tree.selection()
        if not selection:
            messagebox.showinfo("No Selection", "Please select an expense to delete.")
            return

        expense_id = selection[0]
        expense = next((e for e in self.exp_all_expenses if e["id"] == expense_id), None)
        if expense:
            if messagebox.askyesno("Confirm Delete",
                                   f"Delete expense?\n\nVendor: {expense['vendor']}\nAmount: ${expense['amount']:.2f}"):
                try:
                    fb_delete(f"users/{self.current_uid}/expenses/{expense_id}")
                    self.exp_all_expenses = [e for e in self.exp_all_expenses if e["id"] != expense_id]
                    self._exp_display_category_expenses()
                    self._status(f"Deleted expense: {expense['vendor']}")
                except Exception as ex:
                    self._status(f"Error deleting expense: {ex}")

    def _exp_show_add_dialog(self):
        if not self.current_uid:
            messagebox.showwarning("No User", "Select a user first.")
            return
        if not self.exp_current_category:
            messagebox.showwarning("No Category", "Select a category first.")
            return

        self._exp_show_edit_dialog(add_mode=True)

    def _exp_show_edit_dialog(self, add_mode=True, expense=None):
        dialog = tk.Toplevel(self)
        dialog.title("Add Expense" if add_mode else "Edit Expense")
        dialog.configure(bg="#1e1e2e")
        dialog.geometry("500x550")
        dialog.resizable(False, False)

        # Center the dialog
        dialog.transient(self)
        dialog.grab_set()

        # Create scrollable form
        canvas = tk.Canvas(dialog, bg="#1e1e2e", highlightthickness=0)
        scrollbar = ttk.Scrollbar(dialog, orient="vertical", command=canvas.yview)
        scrollable_frame = tk.Frame(canvas, bg="#1e1e2e")

        scrollable_frame.bind(
            "<Configure>",
            lambda e: canvas.configure(scrollregion=canvas.bbox("all"))
        )

        canvas.create_window((0, 0), window=scrollable_frame, anchor="nw")
        canvas.configure(yscrollcommand=scrollbar.set)

        canvas.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")

        form = scrollable_frame
        form.configure(padx=20, pady=20)

        # Vendor
        ttk.Label(form, text="Vendor:").pack(anchor="w", pady=(0, 2))
        vendor_entry = ttk.Entry(form, width=50)
        vendor_entry.pack(fill="x", pady=(0, 10))
        if not add_mode:
            vendor_entry.insert(0, expense["vendor"])

        # Amount
        ttk.Label(form, text="Amount:").pack(anchor="w", pady=(0, 2))
        amount_entry = ttk.Entry(form, width=50)
        amount_entry.pack(fill="x", pady=(0, 10))
        if not add_mode:
            amount_entry.insert(0, str(expense["amount"]))

        # Date
        ttk.Label(form, text="Date (YYYY-MM-DD):").pack(anchor="w", pady=(0, 2))
        date_entry = ttk.Entry(form, width=50)
        date_entry.pack(fill="x", pady=(0, 10))
        if not add_mode:
            date_entry.insert(0, expense["date"])
        else:
            date_entry.insert(0, date.today().strftime("%Y-%m-%d"))

        # Purpose
        ttk.Label(form, text="Purpose:").pack(anchor="w", pady=(0, 2))
        purpose_entry = ttk.Entry(form, width=50)
        purpose_entry.pack(fill="x", pady=(0, 10))
        if not add_mode:
            purpose_entry.insert(0, expense["purpose"])

        # Category (read-only)
        category_name = EXPENSE_CATEGORIES.get(self.exp_current_category, self.exp_current_category)
        ttk.Label(form, text=f"Category: {category_name}").pack(anchor="w", pady=(0, 10))

        # Buttons
        btn_frame = tk.Frame(form, bg="#1e1e2e")
        btn_frame.pack(fill="x", pady=(10, 0))

        def save():
            vendor = vendor_entry.get().strip()
            amount_str = amount_entry.get().strip()
            date_str = date_entry.get().strip()
            purpose = purpose_entry.get().strip()

            if not vendor:
                messagebox.showwarning("Invalid", "Vendor is required.")
                return

            try:
                amount = float(amount_str) if amount_str else 0.0
            except ValueError:
                messagebox.showwarning("Invalid", "Amount must be a number.")
                return

            if not date_str:
                messagebox.showwarning("Invalid", "Date is required.")
                return

            expense_data = {
                "vendor": vendor,
                "amount": amount,
                "date": date_str,
                "purpose": purpose,
                "category": self.exp_current_category
            }

            try:
                if add_mode:
                    ref = fb_push(f"users/{self.current_uid}/expenses", expense_data)
                    expense_id = ref.key
                    expense_data["id"] = expense_id
                    self.exp_all_expenses.append(expense_data)
                    self._status(f"Added expense: {vendor}")
                else:
                    expense_id = expense["id"]
                    fb_update(f"users/{self.current_uid}/expenses/{expense_id}", expense_data)
                    # Update in-memory data
                    for e in self.exp_all_expenses:
                        if e["id"] == expense_id:
                            e.update(expense_data)
                            break
                    self._status(f"Updated expense: {vendor}")

                self._exp_display_category_expenses()
                dialog.destroy()
            except Exception as ex:
                self._status(f"Error: {ex}")
                messagebox.showerror("Error", f"Failed to save expense: {ex}")

        def delete_expense():
            if not add_mode and expense:
                if messagebox.askyesno("Confirm Delete", f"Delete expense '{expense['vendor']}'?"):
                    try:
                        fb_delete(f"users/{self.current_uid}/expenses/{expense['id']}")
                        self.exp_all_expenses = [e for e in self.exp_all_expenses if e["id"] != expense["id"]]
                        self._exp_display_category_expenses()
                        self._status(f"Deleted expense: {expense['vendor']}")
                        dialog.destroy()
                    except Exception as ex:
                        self._status(f"Error: {ex}")
                        messagebox.showerror("Error", f"Failed to delete expense: {ex}")

        button_frame = tk.Frame(form, bg="#1e1e2e")
        button_frame.pack(fill="x", pady=(10, 0))

        ttk.Button(button_frame, text="Save", command=save).pack(side="left", padx=5)
        if not add_mode:
            ttk.Button(button_frame, text="Delete", command=delete_expense).pack(side="left", padx=5)
        ttk.Button(button_frame, text="Cancel", command=dialog.destroy).pack(side="left", padx=5)


if __name__ == "__main__":
    app = PersonalAssistant()
    app.mainloop()