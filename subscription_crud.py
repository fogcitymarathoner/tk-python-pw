# subscriptions_app.py
import tkinter as tk
from tkinter import ttk, messagebox
import firebase_admin
from firebase_admin import credentials, db
import os
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

SERVICE_ACCOUNT_FILE = "fogcitymarathoner-2a35f802a83d.json"
DATABASE_URL = os.getenv("DATABASE_URL", "https://fogcitymarathoner-default-rtdb.firebaseio.com")

# ── Firebase init ──────────────────────────────────────────────────────────────

cred = credentials.Certificate(SERVICE_ACCOUNT_FILE)
firebase_admin.initialize_app(cred, {"databaseURL": DATABASE_URL})


def fb_get(path):
    return db.reference(path).get()


def fb_push(path, data):
    return db.reference(path).push(data)


def fb_update(path, data):
    db.reference(path).update(data)


def fb_delete(path):
    db.reference(path).delete()


# ── Main app ───────────────────────────────────────────────────────────────────

class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Subscription Tracker")
        self.geometry("920x680")
        self.configure(bg="#1e1e2e")
        self.resizable(True, True)

        # Form variables
        self.uid_var = tk.StringVar()
        self.name_var = tk.StringVar()
        self.account_var = tk.StringVar()
        self.amount_var = tk.StringVar()
        self.due_date_var = tk.StringVar()
        self.memo_var = tk.StringVar()

        self.current_uid = None
        self.current_pushid = None
        self.all_rows = []

        self._build_ui()
        self._load_users()

    # ── UI ─────────────────────────────────────────────────────────────────────

    def _build_ui(self):
        style = ttk.Style(self)
        style.theme_use("clam")
        style.configure("Treeview",
                        background="#2a2a3e", foreground="#cdd6f4",
                        fieldbackground="#2a2a3e", rowheight=28)
        style.configure("Treeview.Heading",
                        background="#313244", foreground="#cba6f7",
                        font=("Courier", 10, "bold"))
        style.map("Treeview", background=[("selected", "#45475a")])
        style.configure("TLabel", background="#1e1e2e", foreground="#cdd6f4",
                        font=("Courier", 10))
        style.configure("TEntry", fieldbackground="#313244", foreground="#cdd6f4",
                        font=("Courier", 10))
        style.configure("TButton", background="#313244", foreground="#cba6f7",
                        font=("Courier", 10, "bold"), padding=4)
        style.map("TButton", background=[("active", "#45475a")])

        # ── Top Bar ──
        top = tk.Frame(self, bg="#1e1e2e")
        top.pack(fill="x", padx=10, pady=(10, 0))

        ttk.Label(top, text="User UID:").pack(side="left")
        self.uid_combo = ttk.Combobox(top, textvariable=self.uid_var, width=42,
                                      font=("Courier", 10))
        self.uid_combo.pack(side="left", padx=6)
        self.uid_combo.bind("<<ComboboxSelected>>", lambda e: self._load_subscriptions())

        ttk.Button(top, text="↻ Refresh", command=self._load_users).pack(side="left", padx=4)
        ttk.Button(top, text="+ New User", command=self._new_user_dialog).pack(side="left", padx=4)

        tk.Label(top, text="📋 Subscription Tracker", bg="#1e1e2e", fg="#a6e3a1",
                 font=("Courier", 9, "bold")).pack(side="right", padx=8)

        # ── Filter Bar ──
        filter_bar = tk.Frame(self, bg="#1e1e2e")
        filter_bar.pack(fill="x", padx=10, pady=(0, 4))

        ttk.Label(filter_bar, text="Search:").pack(side="left")
        self.filter_var = tk.StringVar()
        self.filter_entry = ttk.Entry(filter_bar, textvariable=self.filter_var, width=30)
        self.filter_entry.pack(side="left", padx=6)
        self.filter_entry.bind("<Return>", lambda e: self._apply_filter())

        ttk.Button(filter_bar, text="🔍 Search", command=self._apply_filter).pack(side="left", padx=4)
        ttk.Button(filter_bar, text="✖ Clear", command=self._clear_filter).pack(side="left", padx=4)

        # ── Subscription List ──
        mid = tk.Frame(self, bg="#1e1e2e")
        mid.pack(fill="both", expand=True, padx=10, pady=8)

        # Define columns
        cols = ("name", "account", "amount", "due_date", "memo")
        self.tree = ttk.Treeview(mid, columns=cols, show="headings", selectmode="browse")

        # Set column headings and widths
        col_config = [
            ("Name", 200),
            ("Account", 200),
            ("Amount", 120),
            ("Due Date", 120),
            ("Memo", 200)
        ]

        for col, width in col_config:
            # The column identifier must match the column name in cols tuple
            col_id = col.lower().replace(" ", "_")
            self.tree.heading(col_id, text=col)
            self.tree.column(col_id, width=width)

        vsb = ttk.Scrollbar(mid, orient="vertical", command=self.tree.yview)
        self.tree.configure(yscrollcommand=vsb.set)
        vsb.pack(side="right", fill="y")
        self.tree.pack(fill="both", expand=True)
        self.tree.bind("<<TreeviewSelect>>", self._on_select)

        # ── Form ──
        form = tk.LabelFrame(self, text=" Subscription Details ",
                             bg="#1e1e2e", fg="#cba6f7",
                             font=("Courier", 10, "bold"), bd=1, relief="groove")
        form.pack(fill="x", padx=10, pady=(0, 10))

        # Row 0: Name, Account
        ttk.Label(form, text="Service Name:").grid(row=0, column=0, padx=(10, 2), pady=6, sticky="e")
        ttk.Entry(form, textvariable=self.name_var, width=25).grid(row=0, column=1, padx=(0, 10), pady=6)

        ttk.Label(form, text="Account:").grid(row=0, column=2, padx=(10, 2), pady=6, sticky="e")
        ttk.Entry(form, textvariable=self.account_var, width=25).grid(row=0, column=3, padx=(0, 10), pady=6)

        # Row 1: Amount, Due Date
        ttk.Label(form, text="Amount:").grid(row=1, column=0, padx=(10, 2), pady=6, sticky="e")
        ttk.Entry(form, textvariable=self.amount_var, width=25).grid(row=1, column=1, padx=(0, 10), pady=6)

        ttk.Label(form, text="Due Date:").grid(row=1, column=2, padx=(10, 2), pady=6, sticky="e")
        ttk.Entry(form, textvariable=self.due_date_var, width=25).grid(row=1, column=3, padx=(0, 10), pady=6)

        # Row 2: Memo
        ttk.Label(form, text="Memo:").grid(row=2, column=0, padx=(10, 2), pady=6, sticky="e")
        ttk.Entry(form, textvariable=self.memo_var, width=68).grid(row=2, column=1, columnspan=3,
                                                                   padx=(0, 10), pady=6, sticky="w")

        # Row 3: Buttons
        btn_frame = tk.Frame(form, bg="#1e1e2e")
        btn_frame.grid(row=3, column=0, columnspan=4, pady=(0, 8))
        for text, cmd in [("➕ Add", self._add), ("💾 Update", self._update),
                          ("🗑 Delete", self._delete), ("✖ Clear", self._clear_form)]:
            ttk.Button(btn_frame, text=text, command=cmd).pack(side="left", padx=6)

        # ── Status Bar ──
        self.status_var = tk.StringVar(value="Ready")
        tk.Label(self, textvariable=self.status_var,
                 bg="#181825", fg="#a6e3a1", font=("Courier", 9), anchor="w").pack(fill="x")

    # ── Data Operations ──

    def _load_users(self):
        self._status("Loading users…")
        try:
            data = fb_get("users")
            uids = list(data.keys()) if data else []
            self.uid_combo["values"] = uids
            if uids:
                self.uid_var.set(uids[0])
                self._load_subscriptions()
            self._status(f"Loaded {len(uids)} user(s).")
        except Exception as ex:
            self._status(f"Error: {ex}")

    def _load_subscriptions(self):
        uid = self.uid_var.get().strip()
        if not uid:
            return
        self.current_uid = uid
        self._status(f"Loading subscriptions for {uid}…")
        try:
            data = fb_get(f"users/{uid}/subscriptions")
            self.tree.delete(*self.tree.get_children())
            if data:
                self.all_rows = []
                for pushid, rec in data.items():
                    row = (
                        rec.get("name", ""),
                        rec.get("account", ""),
                        rec.get("amount", ""),
                        rec.get("dueDate", ""),
                        rec.get("memo", "")
                    )
                    self.all_rows.append((pushid, row))
                    self.tree.insert("", "end", iid=pushid, values=row)
            self._status(f"Loaded {len(data) if data else 0} subscription(s).")
        except Exception as ex:
            self._status(f"Error: {ex}")

    def _on_select(self, _=None):
        sel = self.tree.selection()
        if not sel:
            return
        self.current_pushid = sel[0]
        name, account, amount, due_date, memo = self.tree.item(sel[0], "values")
        self.name_var.set(name)
        self.account_var.set(account)
        self.amount_var.set(amount)
        self.due_date_var.set(due_date)
        self.memo_var.set(memo)

    # ── CRUD Operations ──

    def _add(self):
        if not self.current_uid:
            messagebox.showwarning("No User", "Select a user first.")
            return

        name = self.name_var.get().strip()
        if not name:
            messagebox.showwarning("Invalid Input", "Service Name is required.")
            return

        subscription = {
            "name": name,
            "account": self.account_var.get().strip(),
            "amount": self.amount_var.get().strip(),
            "dueDate": self.due_date_var.get().strip(),
            "memo": self.memo_var.get().strip()
        }

        try:
            ref = fb_push(f"users/{self.current_uid}/subscriptions", subscription)
            pushid = ref.key
            row = (subscription["name"], subscription["account"],
                   subscription["amount"], subscription["dueDate"], subscription["memo"])
            self.all_rows.append((pushid, row))
            self.tree.insert("", "end", iid=pushid, values=row)
            self._clear_form()
            self._status(f"Added subscription: {subscription['name']}")
        except Exception as ex:
            self._status(f"Error: {ex}")

    def _update(self):
        if not self.current_pushid:
            messagebox.showwarning("No Selection", "Select a subscription to update.")
            return

        name = self.name_var.get().strip()
        if not name:
            messagebox.showwarning("Invalid Input", "Service Name is required.")
            return

        subscription = {
            "name": name,
            "account": self.account_var.get().strip(),
            "amount": self.amount_var.get().strip(),
            "dueDate": self.due_date_var.get().strip(),
            "memo": self.memo_var.get().strip()
        }

        try:
            fb_update(f"users/{self.current_uid}/subscriptions/{self.current_pushid}", subscription)
            self.tree.item(self.current_pushid,
                           values=(subscription["name"], subscription["account"],
                                   subscription["amount"], subscription["dueDate"],
                                   subscription["memo"]))
            # Update all_rows
            for i, (pid, row) in enumerate(self.all_rows):
                if pid == self.current_pushid:
                    self.all_rows[i] = (pid, (subscription["name"], subscription["account"],
                                              subscription["amount"], subscription["dueDate"],
                                              subscription["memo"]))
                    break
            self._status(f"Updated subscription: {subscription['name']}")
        except Exception as ex:
            self._status(f"Error: {ex}")

    def _delete(self):
        if not self.current_pushid:
            messagebox.showwarning("No Selection", "Select a subscription to delete.")
            return

        name = self.name_var.get().strip() or "this subscription"
        if not messagebox.askyesno("Confirm Delete", f"Are you sure you want to delete '{name}'?"):
            return

        try:
            fb_delete(f"users/{self.current_uid}/subscriptions/{self.current_pushid}")
            self.tree.delete(self.current_pushid)
            self.all_rows = [(pid, row) for pid, row in self.all_rows if pid != self.current_pushid]
            self.current_pushid = None
            self._clear_form()
            self._status(f"Deleted subscription: {name}")
        except Exception as ex:
            self._status(f"Error: {ex}")

    # ── Filter Operations ──

    def _apply_filter(self):
        search = self.filter_var.get().strip().lower()
        if not search:
            return
        self.tree.delete(*self.tree.get_children())
        match_count = 0
        for pushid, row in self.all_rows:
            name = row[0].lower()
            account = row[1].lower()
            if search in name or search in account:
                self.tree.insert("", "end", iid=pushid, values=row)
                match_count += 1
        self._status(f"Found {match_count} match(es) for '{search}'")

    def _clear_filter(self):
        self.filter_var.set("")
        self.tree.delete(*self.tree.get_children())
        for pushid, row in self.all_rows:
            self.tree.insert("", "end", iid=pushid, values=row)

    # ── Utility Operations ──

    def _new_user_dialog(self):
        dlg = tk.Toplevel(self)
        dlg.title("New User UID")
        dlg.configure(bg="#1e1e2e")
        dlg.resizable(False, False)

        ttk.Label(dlg, text="Enter User UID (e.g., Firebase Auth UID):").pack(padx=16, pady=(12, 4))
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
                self.uid_var.set(uid)
                self._load_subscriptions()
                dlg.destroy()
                self._status(f"Created user: {uid}")
            except Exception as ex:
                self._status(f"Error: {ex}")

        ttk.Button(dlg, text="Create User", command=create).pack(pady=10)

    def _clear_form(self):
        self.name_var.set("")
        self.account_var.set("")
        self.amount_var.set("")
        self.due_date_var.set("")
        self.memo_var.set("")
        self.current_pushid = None
        self.tree.selection_remove(self.tree.selection())

    def _status(self, msg):
        self.status_var.set(msg)


if __name__ == "__main__":
    App().mainloop()