# business_expenses.py
import tkinter as tk
from tkinter import ttk, messagebox
from datetime import datetime, date
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


# ── Expense Categories ─────────────────────────────────────────────────────────

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


# ── Main app ───────────────────────────────────────────────────────────────────

class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Business Expenses")
        self.geometry("1024x768")
        self.configure(bg="#1e1e2e")
        self.resizable(True, True)

        # State variables
        self.current_user = None
        self.current_category = None
        self.current_expense_id = None
        self.all_expenses = []
        self.filtered_expenses = []

        # Form variables
        self.vendor_var = tk.StringVar()
        self.amount_var = tk.StringVar()
        self.purpose_var = tk.StringVar()
        self.date_var = tk.StringVar()
        self.category_var = tk.StringVar()

        # Set today's date
        today = date.today()
        self.date_var.set(today.strftime("%Y-%m-%d"))

        # Main container
        self.main_container = tk.Frame(self, bg="#1e1e2e")
        self.main_container.pack(fill="both", expand=True)

        self._build_ui()
        self._load_users()

    # ── UI ─────────────────────────────────────────────────────────────────────

    def _build_ui(self):
        style = ttk.Style(self)
        style.theme_use("clam")

        # Configure styles
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
        style.configure("TLabelframe", background="#1e1e2e", foreground="#cba6f7")
        style.configure("TLabelframe.Label", background="#1e1e2e", foreground="#cba6f7",
                        font=("Courier", 10, "bold"))

        # ── Top Bar ──
        top = tk.Frame(self.main_container, bg="#1e1e2e")
        top.pack(fill="x", padx=10, pady=(10, 0))

        ttk.Label(top, text="User:").pack(side="left")
        self.user_combo = ttk.Combobox(top, width=40, font=("Courier", 10))
        self.user_combo.pack(side="left", padx=6)
        self.user_combo.bind("<<ComboboxSelected>>", self._on_user_select)

        ttk.Button(top, text="↻ Refresh", command=self._load_users).pack(side="left", padx=4)
        ttk.Button(top, text="+ New User", command=self._new_user_dialog).pack(side="left", padx=4)

        tk.Label(top, text="💼 Business Expenses", bg="#1e1e2e", fg="#a6e3a1",
                 font=("Courier", 9, "bold")).pack(side="right", padx=8)

        # ── Main Content (split view) ──
        # Create PanedWindow for resizable split
        paned = ttk.PanedWindow(self.main_container, orient="horizontal")
        paned.pack(fill="both", expand=True, padx=10, pady=8)

        # Left side - Category Grid (with scroll)
        left_frame = tk.LabelFrame(paned, text=" Categories ", bg="#1e1e2e", fg="#cba6f7",
                                   font=("Courier", 10, "bold"))
        paned.add(left_frame, weight=1)

        # Create canvas with scrollbar for categories
        canvas_container = tk.Frame(left_frame, bg="#1e1e2e")
        canvas_container.pack(fill="both", expand=True, padx=5, pady=5)

        canvas = tk.Canvas(canvas_container, bg="#1e1e2e", highlightthickness=0)
        scrollbar = ttk.Scrollbar(canvas_container, orient="vertical", command=canvas.yview)
        scrollable_frame = tk.Frame(canvas, bg="#1e1e2e")

        scrollable_frame.bind(
            "<Configure>",
            lambda e: canvas.configure(scrollregion=canvas.bbox("all"))
        )

        canvas.create_window((0, 0), window=scrollable_frame, anchor="nw")
        canvas.configure(yscrollcommand=scrollbar.set)

        # Mouse wheel scrolling
        def _on_mousewheel(event):
            canvas.yview_scroll(int(-1 * (event.delta / 120)), "units")

        canvas.bind_all("<MouseWheel>", _on_mousewheel)

        canvas.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")

        # Category buttons in grid
        rows = 11
        cols = 2
        for i, (cat_key, cat_name) in enumerate(CATEGORIES_LIST):
            row = i // cols
            col = i % cols
            btn = tk.Button(
                scrollable_frame,
                text=cat_name,
                command=lambda k=cat_key: self._select_category(k),
                bg="#313244",
                fg="#cdd6f4",
                font=("Courier", 9),
                relief="flat",
                padx=10,
                pady=15,
                width=25,
                height=2,
                wraplength=180,
                justify="center"
            )
            btn.grid(row=row, column=col, padx=4, pady=4, sticky="nsew")
            scrollable_frame.grid_rowconfigure(row, weight=1)
            scrollable_frame.grid_columnconfigure(col, weight=1)

        # Right side - Expense List and Form
        right_frame = tk.LabelFrame(paned, text=" Expenses ", bg="#1e1e2e", fg="#cba6f7",
                                    font=("Courier", 10, "bold"))
        paned.add(right_frame, weight=2)

        # Category header
        header_frame = tk.Frame(right_frame, bg="#1e1e2e")
        header_frame.pack(fill="x", padx=5, pady=5)

        self.category_label = ttk.Label(header_frame, text="No category selected",
                                        font=("Courier", 12, "bold"))
        self.category_label.pack(side="left")

        # Search bar
        search_frame = tk.Frame(right_frame, bg="#1e1e2e")
        search_frame.pack(fill="x", padx=5, pady=(0, 5))

        ttk.Label(search_frame, text="🔍").pack(side="left")
        self.search_var = tk.StringVar()
        self.search_entry = ttk.Entry(search_frame, textvariable=self.search_var, width=30)
        self.search_entry.pack(side="left", padx=5)
        self.search_entry.bind("<KeyRelease>", self._apply_filter)

        ttk.Button(search_frame, text="Clear", command=self._clear_filter).pack(side="left", padx=5)
        ttk.Button(search_frame, text="Add Expense", command=self._show_add_dialog).pack(side="right")

        # Expense list
        list_frame = tk.Frame(right_frame, bg="#1e1e2e")
        list_frame.pack(fill="both", expand=True, padx=5, pady=5)

        cols = ("vendor", "date", "amount", "purpose")
        self.tree = ttk.Treeview(list_frame, columns=cols, show="headings", selectmode="browse")

        col_config = [
            ("Vendor", 200),
            ("Date", 100),
            ("Amount", 100),
            ("Purpose", 250)
        ]

        for col, width in col_config:
            col_id = col.lower()
            self.tree.heading(col_id, text=col)
            self.tree.column(col_id, width=width)

        vsb = ttk.Scrollbar(list_frame, orient="vertical", command=self.tree.yview)
        self.tree.configure(yscrollcommand=vsb.set)
        vsb.pack(side="right", fill="y")
        self.tree.pack(fill="both", expand=True)

        # Bind double-click and right-click
        self.tree.bind("<Double-1>", self._on_expense_double_click)
        self.tree.bind("<Button-3>", self._on_right_click)  # Right-click context menu

        # ── Status Bar ──
        self.status_var = tk.StringVar(value="Ready")
        tk.Label(self.main_container, textvariable=self.status_var,
                 bg="#181825", fg="#a6e3a1", font=("Courier", 9), anchor="w").pack(fill="x")

    # ── Data Operations ──

    def _load_users(self):
        self._status("Loading users…")
        try:
            data = fb_get("users")
            uids = list(data.keys()) if data else []
            self.user_combo["values"] = uids
            if uids:
                self.user_combo.set(uids[0])
                self._on_user_select()
            self._status(f"Loaded {len(uids)} user(s).")
        except Exception as ex:
            self._status(f"Error: {ex}")

    def _on_user_select(self, _=None):
        user = self.user_combo.get().strip()
        if not user:
            return
        self.current_user = user
        self._status(f"Selected user: {user}")
        self._load_expenses()

    def _load_expenses(self):
        if not self.current_user:
            return
        try:
            data = fb_get(f"users/{self.current_user}/expenses")
            self.all_expenses = []
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
                    self.all_expenses.append(expense)
            self._status(f"Loaded {len(self.all_expenses)} expense(s).")
            if self.current_category:
                self._display_category_expenses()
        except Exception as ex:
            self._status(f"Error: {ex}")

    def _display_category_expenses(self):
        if not self.current_category:
            self.tree.delete(*self.tree.get_children())
            return

        self.filtered_expenses = [
            e for e in self.all_expenses
            if e.get("category") == self.current_category
        ]
        self._update_tree()
        category_name = EXPENSE_CATEGORIES.get(self.current_category, self.current_category)
        self.category_label.config(text=f"📁 {category_name} ({len(self.filtered_expenses)})")

    def _update_tree(self):
        self.tree.delete(*self.tree.get_children())
        search = self.search_var.get().strip().lower()

        # Sort by date descending
        sorted_expenses = sorted(self.filtered_expenses,
                                 key=lambda x: x.get("date", ""), reverse=True)

        for expense in sorted_expenses:
            if search:
                if (search not in expense["vendor"].lower() and
                        search not in expense["purpose"].lower()):
                    continue
            self.tree.insert("", "end", iid=expense["id"], values=(
                expense["vendor"],
                expense["date"],
                f"${expense['amount']:.2f}",
                expense["purpose"]
            ))

    # ── Category Selection ──

    def _select_category(self, category_key):
        self.current_category = category_key
        self._display_category_expenses()
        self._status(f"Showing expenses for: {EXPENSE_CATEGORIES.get(category_key, category_key)}")

    # ── Filter Operations ──

    def _apply_filter(self, _=None):
        self._update_tree()

    def _clear_filter(self):
        self.search_var.set("")
        self._update_tree()

    # ── Right-click Context Menu ──

    def _on_right_click(self, event):
        """Show context menu on right-click"""
        item = self.tree.identify_row(event.y)
        if item:
            self.tree.selection_set(item)
            menu = tk.Menu(self, tearoff=0)
            menu.add_command(label="✏️ Edit", command=lambda: self._edit_selected_expense())
            menu.add_command(label="🗑 Delete", command=lambda: self._delete_selected_expense())
            menu.post(event.x_root, event.y_root)

    # ── Expense Operations ──

    def _on_expense_double_click(self, _=None):
        """Handle double-click on expense"""
        self._edit_selected_expense()

    def _edit_selected_expense(self):
        """Edit the currently selected expense"""
        selection = self.tree.selection()
        if not selection:
            messagebox.showinfo("No Selection", "Please select an expense to edit.")
            return

        expense_id = selection[0]
        expense = next((e for e in self.all_expenses if e["id"] == expense_id), None)
        if expense:
            self._show_edit_dialog(add_mode=False, expense=expense)

    def _delete_selected_expense(self):
        """Delete the currently selected expense"""
        selection = self.tree.selection()
        if not selection:
            messagebox.showinfo("No Selection", "Please select an expense to delete.")
            return

        expense_id = selection[0]
        expense = next((e for e in self.all_expenses if e["id"] == expense_id), None)
        if expense:
            if messagebox.askyesno("Confirm Delete",
                                   f"Are you sure you want to delete this expense?\n\nVendor: {expense['vendor']}\nAmount: ${expense['amount']:.2f}"):
                try:
                    fb_delete(f"users/{self.current_user}/expenses/{expense_id}")
                    self.all_expenses = [e for e in self.all_expenses if e["id"] != expense_id]
                    self._display_category_expenses()
                    self._status(f"Deleted expense: {expense['vendor']}")
                except Exception as ex:
                    self._status(f"Error deleting expense: {ex}")
                    messagebox.showerror("Error", f"Failed to delete expense: {ex}")

    def _show_add_dialog(self):
        if not self.current_user:
            messagebox.showwarning("No User", "Select a user first.")
            return
        if not self.current_category:
            messagebox.showwarning("No Category", "Select a category first.")
            return

        self._show_edit_dialog(add_mode=True)

    def _show_edit_dialog(self, add_mode=True, expense=None):
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
        category_name = EXPENSE_CATEGORIES.get(self.current_category, self.current_category)
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
                "category": self.current_category
            }

            try:
                if add_mode:
                    ref = fb_push(f"users/{self.current_user}/expenses", expense_data)
                    expense_id = ref.key
                    expense_data["id"] = expense_id
                    self.all_expenses.append(expense_data)
                    self._status(f"Added expense: {vendor}")
                else:
                    expense_id = expense["id"]
                    fb_update(f"users/{self.current_user}/expenses/{expense_id}", expense_data)
                    # Update in-memory data
                    for e in self.all_expenses:
                        if e["id"] == expense_id:
                            e.update(expense_data)
                            break
                    self._status(f"Updated expense: {vendor}")

                self._display_category_expenses()
                dialog.destroy()
            except Exception as ex:
                self._status(f"Error: {ex}")
                messagebox.showerror("Error", f"Failed to save expense: {ex}")

        def delete_expense():
            if not add_mode and expense:
                if messagebox.askyesno("Confirm Delete", f"Delete expense '{expense['vendor']}'?"):
                    try:
                        fb_delete(f"users/{self.current_user}/expenses/{expense['id']}")
                        self.all_expenses = [e for e in self.all_expenses if e["id"] != expense["id"]]
                        self._display_category_expenses()
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

    # ── Utility Operations ──

    def _new_user_dialog(self):
        dlg = tk.Toplevel(self)
        dlg.title("New User UID")
        dlg.configure(bg="#1e1e2e")
        dlg.resizable(False, False)
        dlg.transient(self)
        dlg.grab_set()

        ttk.Label(dlg, text="Enter User UID:").pack(padx=16, pady=(12, 4))
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
                self.user_combo.set(uid)
                self._on_user_select()
                dlg.destroy()
                self._status(f"Created user: {uid}")
            except Exception as ex:
                self._status(f"Error: {ex}")

        ttk.Button(dlg, text="Create User", command=create).pack(pady=10)

    def _status(self, msg):
        self.status_var.set(msg)


if __name__ == "__main__":
    App().mainloop()