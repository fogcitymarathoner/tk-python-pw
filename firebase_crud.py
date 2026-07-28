"""
Firebase CRUD - users/{uid}/passwords
Structure: users/{uid}/passwords/{pushId}/{account, pw, vendor}

Requirements:
    pip install firebase-admin python-dotenv

Place your service account JSON file next to this script, and create a .env file
with: DATABASE_URL=https://fogcitymarathoner-default-rtdb.firebaseio.com
"""
# firebase_crud.py
import tkinter as tk
from tkinter import ttk, messagebox
import firebase_admin
from firebase_admin import credentials, db
import secrets
import string
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
    return db.reference(path).push(data)  # returns a Reference; .key is the push id


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

        self.uid_var = tk.StringVar()
        self.account_var = tk.StringVar()
        self.pw_var = tk.StringVar()
        self.pw_var_original = tk.StringVar()
        self.vendor_var = tk.StringVar()
        self.password_length = tk.IntVar(value=12)  # Default to 12

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
                        fieldbackground="#2a2a3e", rowheight=24)
        style.configure("Treeview.Heading",
                        background="#313244", foreground="#cba6f7", font=("Courier", 10, "bold"))
        style.map("Treeview", background=[("selected", "#45475a")])
        style.configure("TLabel", background="#1e1e2e", foreground="#cdd6f4", font=("Courier", 10))
        style.configure("TEntry", fieldbackground="#313244", foreground="#cdd6f4", font=("Courier", 10))
        style.configure("TButton", background="#313244", foreground="#cba6f7",
                        font=("Courier", 10, "bold"), padding=4)
        style.map("TButton", background=[("active", "#45475a")])
        style.configure("TRadiobutton", background="#1e1e2e", foreground="#cdd6f4",
                        font=("Courier", 10))

        # top bar
        top = tk.Frame(self, bg="#1e1e2e")
        top.pack(fill="x", padx=10, pady=(10, 0))

        ttk.Label(top, text="User UID:").pack(side="left")
        self.uid_combo = ttk.Combobox(top, textvariable=self.uid_var, width=42,
                                      font=("Courier", 10))
        self.uid_combo.pack(side="left", padx=6)
        self.uid_combo.bind("<<ComboboxSelected>>", lambda e: self._load_passwords())

        ttk.Button(top, text="↻ Refresh", command=self._load_users).pack(side="left", padx=4)
        ttk.Button(top, text="+ New User", command=self._new_user_dialog).pack(side="left", padx=4)

        tk.Label(top, text="🔑 service account", bg="#1e1e2e", fg="#a6e3a1",
                 font=("Courier", 9)).pack(side="right", padx=8)
        # filter bar
        filter_bar = tk.Frame(self, bg="#1e1e2e")
        filter_bar.pack(fill="x", padx=10, pady=(0, 4))

        ttk.Label(filter_bar, text="Filter Vendor:").pack(side="left")
        self.filter_var = tk.StringVar()
        self.filter_entry = ttk.Entry(filter_bar, textvariable=self.filter_var, width=30)
        self.filter_entry.pack(side="left", padx=6)
        # Bind Enter key to apply filter
        self.filter_entry.bind("<Return>", lambda e: self._apply_filter())
        self.filter_entry.bind("<KP_Enter>", lambda e: self._apply_filter())  # Numpad Enter

        ttk.Button(filter_bar, text="🔍 Search", command=self._apply_filter).pack(side="left", padx=4)
        ttk.Button(filter_bar, text="✖ Clear", command=self._clear_filter).pack(side="left", padx=4)

        # password list
        mid = tk.Frame(self, bg="#1e1e2e")
        mid.pack(fill="both", expand=True, padx=10, pady=8)
        # Table Headers - removed pushid column
        cols = ("vendor", "account", "pw")
        self.tree = ttk.Treeview(mid, columns=cols, show="headings", selectmode="browse")
        # Arrange column widths - removed pushid column
        for col, w in [("vendor", 200), ("account", 250), ("pw", 280)]:
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

        # Row 0: Vendor, Account
        ttk.Label(form, text="Vendor:").grid(row=0, column=0, padx=(10, 2), pady=8, sticky="e")
        ttk.Entry(form, textvariable=self.vendor_var, width=20).grid(row=0, column=1, padx=(0, 10), pady=8)

        ttk.Label(form, text="Account:").grid(row=0, column=2, padx=(10, 2), pady=8, sticky="e")
        ttk.Entry(form, textvariable=self.account_var, width=20).grid(row=0, column=3, padx=(0, 10), pady=8)

        # Row 1: Password, Copy button, Generate button, Length selector
        ttk.Label(form, text="Password:").grid(row=1, column=0, padx=(10, 2), pady=8, sticky="e")
        self.pw_entry = ttk.Entry(form, textvariable=self.pw_var, width=20)
        self.pw_entry.grid(row=1, column=1, padx=(0, 10), pady=8)

        # Copy button with icon - using TButton for consistent styling
        self.copy_button = ttk.Button(
            form,
            text="📋 Copy",
            command=self._copy_password
        )
        self.copy_button.grid(row=1, column=2, padx=(0, 4), pady=8)

        ttk.Button(form, text="⚡ Generate Password", command=self._generate_password).grid(row=1, column=3, padx=(0, 4), pady=8)
        ttk.Label(form, text="Length:").grid(row=1, column=4, padx=(10, 2), pady=8)
        ttk.Radiobutton(form, text="12", variable=self.password_length, value=12).grid(row=1, column=5, padx=(0, 2), pady=8)
        ttk.Radiobutton(form, text="14", variable=self.password_length, value=14).grid(row=1, column=6, padx=(0, 2), pady=8)

        # Row 2: Password Original (full width)
        ttk.Label(form, text="Password Original:").grid(row=2, column=0, padx=(10, 2), pady=8, sticky="e")
        ttk.Entry(form, textvariable=self.pw_var_original, width=50).grid(row=2, column=1, columnspan=6, padx=(0, 10), pady=8, sticky="w")

        # Row 3: Buttons
        btn_frame = tk.Frame(form, bg="#1e1e2e")
        btn_frame.grid(row=3, column=0, columnspan=7, pady=(0, 8))
        for text, cmd in [("➕ Add", self._add), ("💾 Update", self._update),
                          ("🗑 Delete", self._delete), ("✖ Clear", self._clear_form)]:
            ttk.Button(btn_frame, text=text, command=cmd).pack(side="left", padx=6)

        self.status_var = tk.StringVar(value="Ready")
        tk.Label(self, textvariable=self.status_var,
                 bg="#181825", fg="#a6e3a1", font=("Courier", 9), anchor="w").pack(fill="x")

    # ── Copy Password Function ──────────────────────────────────────────────

    def _copy_password(self):
        """Copy the current password to clipboard and update status"""
        password = self.pw_var.get().strip()
        if not password:
            self._status("⚠️ No password to copy!")
            return

        try:
            # Clear clipboard and append the password
            self.clipboard_clear()
            self.clipboard_append(password)
            self._status("✅ Password copied to clipboard!")

            # Optional: Flash the copy button to give visual feedback
            self.copy_button.configure(text="✅ Copied!")
            self.after(2000, lambda: self.copy_button.configure(text="📋 Copy"))

        except Exception as e:
            self._status(f"❌ Error copying to clipboard: {e}")

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
                    # Store pushid in all_rows but only display vendor, account, pw
                    row = (rec.get("vendor", ""), rec.get("account", ""), rec.get("pw", ""))
                    self.all_rows.append((pushid, row))  # Store pushid separately
                    self.tree.insert("", "end", iid=pushid, values=row)
            self._status(f"Loaded {len(data) if data else 0} password(s).")
        except Exception as ex:
            self._status(f"Error: {ex}")

    def _on_select(self, _=None):
        sel = self.tree.selection()
        if not sel:
            return
        self.current_pushid = sel[0]
        # Put record data into form - now only 3 values (vendor, account, pw)
        vendor, account, pw = self.tree.item(sel[0], "values")
        self.account_var.set(account)
        self.vendor_var.set(vendor)
        self.pw_var.set(pw)
        self.pw_var_original.set(pw)

    # ── CRUD ───────────────────────────────────────────────────────────────────

    def _add(self):
        if not self.current_uid:
            messagebox.showwarning("No User", "Select a user first.")
            return
        # The record arrangement for record
        rec = {"vendor": self.vendor_var.get(),
               "pw": self.pw_var.get(),
               "account": self.account_var.get()}
        if not any(rec.values()):
            messagebox.showwarning("Empty", "Fill in at least one field.")
            return
        try:
            ref = fb_push(f"users/{self.current_uid}/passwords", rec)
            pushid = ref.key
            # The record arrangement for table - only display vendor, account, pw
            row = (rec["vendor"], rec["account"], rec["pw"])
            self.all_rows.append((pushid, row))
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
            # The record arrangement for table - only display vendor, account, pw
            self.tree.item(self.current_pushid,
                           values=(rec["vendor"], rec["account"], rec["pw"]))
            # Update all_rows
            for i, (pid, row) in enumerate(self.all_rows):
                if pid == self.current_pushid:
                    self.all_rows[i] = (pid, (rec["vendor"], rec["account"], rec["pw"]))
                    break
            self._status(f"Updated {self.current_pushid}")
        except Exception as ex:
            self._status(f"Error: {ex}")

    def _delete(self):
        if not self.current_pushid:
            messagebox.showwarning("No Selection", "Select a record to delete.")
            return
        if not messagebox.askyesno("Confirm", f"Delete this record?"):
            return
        try:
            fb_delete(f"users/{self.current_uid}/passwords/{self.current_pushid}")
            self.tree.delete(self.current_pushid)
            # Remove from all_rows
            self.all_rows = [(pid, row) for pid, row in self.all_rows if pid != self.current_pushid]
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
        match_count = 0
        for pushid, row in self.all_rows:
            vendor = row[0].lower()
            account = row[1].lower()
            if search in vendor or search in account:
                self.tree.insert("", "end", iid=pushid, values=row)
                match_count += 1
        self._status(f"Found {match_count} match(es) for '{search}'")

    def _generate_password(self):
        length = self.password_length.get()  # Get selected length (12 or 14)
        allowed = (
            "abcdefghijklmnopqrstuvwxyz"
            "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
            "0123456789"
            "#!@$%^*()_=?.,:~-[]"
        )
        pw = ''.join(secrets.choice(allowed) for _ in range(length))
        self.pw_var.set(pw)
        self._status(f"Generated {length}-character strong password.")

    def _clear_filter(self):
        self.filter_var.set("")
        self.tree.delete(*self.tree.get_children())
        for pushid, row in self.all_rows:
            self.tree.insert("", "end", iid=pushid, values=row)

    def _new_user_dialog(self):
        dlg = tk.Toplevel(self)
        dlg.title("New User UID")
        dlg.configure(bg="#1e1e2e")
        dlg.resizable(False, False)
        ttk.Label(dlg, text="Enter UID (e.g. Firebase Auth UID):").pack(padx=16, pady=(12, 4))
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
        self.pw_var_original.set("")
        self.vendor_var.set("")
        self.current_pushid = None
        self.tree.selection_remove(self.tree.selection())

    def _status(self, msg):
        self.status_var.set(msg)


if __name__ == "__main__":
    App().mainloop()