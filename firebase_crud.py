"""
Firebase CRUD - users/{uid}/passwords
Structure: users/{uid}/passwords/{pushId}/{account, pw, vendor}

Requirements:
    pip install firebase-admin

Place your service account JSON file next to this script, or update
SERVICE_ACCOUNT_FILE below.
"""

import tkinter as tk
from tkinter import ttk, messagebox
import firebase_admin
from firebase_admin import credentials, db

SERVICE_ACCOUNT_FILE = "fogcitymarathoner-2a35f802a83d.json"
DATABASE_URL         = "https://fogcitymarathoner-default-rtdb.firebaseio.com"

# ── Firebase init ──────────────────────────────────────────────────────────────

cred = credentials.Certificate(SERVICE_ACCOUNT_FILE)
firebase_admin.initialize_app(cred, {"databaseURL": DATABASE_URL})

def fb_get(path):
    return db.reference(path).get()

def fb_push(path, data):
    return db.reference(path).push(data)   # returns a Reference; .key is the push id

def fb_update(path, data):
    db.reference(path).update(data)

def fb_delete(path):
    db.reference(path).delete()

# ── Main app ───────────────────────────────────────────────────────────────────

class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Firebase Password Manager")
        self.geometry("920x640")
        self.configure(bg="#1e1e2e")
        self.resizable(True, True)

        self.uid_var     = tk.StringVar()
        self.account_var = tk.StringVar()
        self.pw_var      = tk.StringVar()
        self.vendor_var  = tk.StringVar()

        self.current_uid    = None
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
            fieldbackground="#2a2a3e", rowheight=24)
        style.configure("Treeview.Heading",
            background="#313244", foreground="#cba6f7", font=("Courier", 10, "bold"))
        style.map("Treeview", background=[("selected", "#45475a")])
        style.configure("TLabel", background="#1e1e2e", foreground="#cdd6f4", font=("Courier", 10))
        style.configure("TEntry", fieldbackground="#313244", foreground="#cdd6f4", font=("Courier", 10))
        style.configure("TButton", background="#313244", foreground="#cba6f7",
                        font=("Courier", 10, "bold"), padding=4)
        style.map("TButton", background=[("active", "#45475a")])

        # top bar
        top = tk.Frame(self, bg="#1e1e2e")
        top.pack(fill="x", padx=10, pady=(10, 0))

        ttk.Label(top, text="User UID:").pack(side="left")
        self.uid_combo = ttk.Combobox(top, textvariable=self.uid_var, width=42,
                                       font=("Courier", 10))
        self.uid_combo.pack(side="left", padx=6)
        self.uid_combo.bind("<<ComboboxSelected>>", lambda e: self._load_passwords())

        ttk.Button(top, text="↻ Refresh",  command=self._load_users).pack(side="left", padx=4)
        ttk.Button(top, text="+ New User", command=self._new_user_dialog).pack(side="left", padx=4)

        tk.Label(top, text="🔑 service account", bg="#1e1e2e", fg="#a6e3a1",
                 font=("Courier", 9)).pack(side="right", padx=8)
        # filter bar
        filter_bar = tk.Frame(self, bg="#1e1e2e")
        filter_bar.pack(fill="x", padx=10, pady=(0, 4))

        ttk.Label(filter_bar, text="Filter Vendor:").pack(side="left")
        self.filter_var = tk.StringVar()
        ttk.Entry(filter_bar, textvariable=self.filter_var, width=30).pack(side="left", padx=6)
        ttk.Button(filter_bar, text="🔍 Search", command=self._apply_filter).pack(side="left", padx=4)
        ttk.Button(filter_bar, text="✖ Clear", command=self._clear_filter).pack(side="left", padx=4)
        # password list
        mid = tk.Frame(self, bg="#1e1e2e")
        mid.pack(fill="both", expand=True, padx=10, pady=8)
        # Table Headers
        cols = ("pushid", "vendor", "account", "pw")
        self.tree = ttk.Treeview(mid, columns=cols, show="headings", selectmode="browse")
        # Arrange column widths
        for col, w in [("pushid", 180), ("vendor", 160), ("account", 210), ("pw", 210)]:
            self.tree.heading(col, text=col.capitalize())
            self.tree.column(col, width=w)

        vsb = ttk.Scrollbar(mid, orient="vertical", command=self.tree.yview)
        self.tree.configure(yscrollcommand=vsb.set)
        vsb.pack(side="right", fill="y")
        self.tree.pack(fill="both", expand=True)
        self.tree.bind("<<TreeviewSelect>>", self._on_select)

        # form
        form = tk.LabelFrame(self, text=" Password Record ",
                             bg="#1e1e2e", fg="#cba6f7",
                             font=("Courier", 10, "bold"), bd=1, relief="groove")
        form.pack(fill="x", padx=10, pady=(0, 10))
        # Arrange the form field labels
        for i, (label, var, show) in enumerate([
            ("Vendor",   self.vendor_var,  ""),
            ("Account",  self.account_var, ""),
            ("Password", self.pw_var,      ""),
        ]):
            ttk.Label(form, text=f"{label}:").grid(row=0, column=i*2, padx=(10,2), pady=8, sticky="e")
            ttk.Entry(form, textvariable=var, width=24, show=show).grid(
                row=0, column=i*2+1, padx=(0,10), pady=8)

        btn_frame = tk.Frame(form, bg="#1e1e2e")
        btn_frame.grid(row=1, column=0, columnspan=6, pady=(0,8))
        for text, cmd in [("➕ Add", self._add), ("💾 Update", self._update),
                          ("🗑 Delete", self._delete), ("✖ Clear", self._clear_form)]:
            ttk.Button(btn_frame, text=text, command=cmd).pack(side="left", padx=6)

        self.status_var = tk.StringVar(value="Ready")
        tk.Label(self, textvariable=self.status_var,
                 bg="#181825", fg="#a6e3a1", font=("Courier", 9), anchor="w").pack(fill="x")

    # ── data ───────────────────────────────────────────────────────────────────

    def _load_users(self):
        self._status("Loading users…")
        try:
            data = fb_get("users")
            uids = list(data.keys()) if data else []
            self.uid_combo["values"] = uids
            if uids:
                self.uid_var.set(uids[0])
                self._load_passwords()
            self._status(f"Loaded {len(uids)} user(s).")
        except Exception as ex:
            self._status(f"Error: {ex}")

    def _load_passwords(self):
        uid = self.uid_var.get().strip()
        if not uid:
            return
        self.current_uid = uid
        self._status(f"Loading passwords for {uid}…")
        try:
            data = fb_get(f"users/{uid}/passwords")
            self.tree.delete(*self.tree.get_children())
            if data:
                self.all_rows = []
                for pushid, rec in data.items():
                    row = (pushid, rec.get("vendor", ""), rec.get("account", ""), rec.get("pw", ""))
                    self.all_rows.append(row)
                    self.tree.insert("", "end", iid=pushid, values=row)
            self._status(f"Loaded {len(data) if data else 0} password(s).")
        except Exception as ex:
            self._status(f"Error: {ex}")

    def _on_select(self, _=None):
        sel = self.tree.selection()
        if not sel:
            return
        self.current_pushid = sel[0]
        # Put record data into form
        _, vendor, account, pw = self.tree.item(sel[0], "values")
        self.account_var.set(account)
        self.vendor_var.set(vendor)
        self.pw_var.set(pw)

    # ── CRUD ───────────────────────────────────────────────────────────────────

    def _add(self):
        if not self.current_uid:
            messagebox.showwarning("No User", "Select a user first.")
            return
        # The record arrangement for record
        rec = {"vendor":  self.vendor_var.get(),
               "pw":      self.pw_var.get(),
               "account": self.account_var.get()}
        if not any(rec.values()):
            messagebox.showwarning("Empty", "Fill in at least one field.")
            return
        try:
            ref    = fb_push(f"users/{self.current_uid}/passwords", rec)
            pushid = ref.key
            # The record arrangement for table
            row = (pushid, rec["vendor"], rec["account"], rec["pw"])
            self.all_rows.append(row)
            self.tree.insert("", "end", iid=pushid, values=row)
            self._clear_form()
            self._status(f"Added {pushid}")
        except Exception as ex:
            self._status(f"Error: {ex}")

    def _update(self):
        if not self.current_pushid:
            messagebox.showwarning("No Selection", "Select a record to update.")
            return
        # The record arrangement for record
        rec = {
            "vendor": self.vendor_var.get(),
            "pw": self.pw_var.get(),
            "account": self.account_var.get()}
        try:
            fb_update(f"users/{self.current_uid}/passwords/{self.current_pushid}", rec)
            # The record arrangement for table
            self.tree.item(self.current_pushid,
                           values=(self.current_pushid, rec["vendor"], rec["account"], rec["pw"]))
            self._status(f"Updated {self.current_pushid}")
        except Exception as ex:
            self._status(f"Error: {ex}")

    def _delete(self):
        if not self.current_pushid:
            messagebox.showwarning("No Selection", "Select a record to delete.")
            return
        if not messagebox.askyesno("Confirm", f"Delete {self.current_pushid}?"):
            return
        try:
            fb_delete(f"users/{self.current_uid}/passwords/{self.current_pushid}")
            self.tree.delete(self.current_pushid)
            self.current_pushid = None
            self._clear_form()
            self._status("Deleted.")
        except Exception as ex:
            self._status(f"Error: {ex}")

    def _apply_filter(self):
        search = self.filter_var.get().strip().lower()
        if not search:
            return
        self.tree.delete(*self.tree.get_children())
        for row in self.all_rows:
            if search in row[1].lower():  # row[1] is vendor
                self.tree.insert("", "end", iid=row[0], values=row)

    def _clear_filter(self):
        self.filter_var.set("")
        self.tree.delete(*self.tree.get_children())
        for row in self.all_rows:
            self.tree.insert("", "end", iid=row[0], values=row)

    def _new_user_dialog(self):
        dlg = tk.Toplevel(self)
        dlg.title("New User UID")
        dlg.configure(bg="#1e1e2e")
        dlg.resizable(False, False)
        ttk.Label(dlg, text="Enter UID (e.g. Firebase Auth UID):").pack(padx=16, pady=(12,4))
        uid_entry = ttk.Entry(dlg, width=40)
        uid_entry.pack(padx=16)

        def create():
            uid = uid_entry.get().strip()
            if not uid:
                return
            try:
                fb_update(f"users/{uid}", {"_created": True})
                self._load_users()
                self.uid_var.set(uid)
                self._load_passwords()
                dlg.destroy()
                self._status(f"Created user {uid}")
            except Exception as ex:
                self._status(f"Error: {ex}")

        ttk.Button(dlg, text="Create", command=create).pack(pady=10)

    def _clear_form(self):
        self.account_var.set("")
        self.pw_var.set("")
        self.vendor_var.set("")
        self.current_pushid = None
        self.tree.selection_remove(self.tree.selection())

    def _status(self, msg):
        self.status_var.set(msg)


if __name__ == "__main__":
    App().mainloop()
