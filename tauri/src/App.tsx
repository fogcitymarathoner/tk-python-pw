import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  useTable,
  ColumnDef,
  flexRender,
  stockFeatures,
  StockFeatures,
} from "@tanstack/react-table";
import "./App.css";

// --- Types ---
interface Category {
  id: number;
  remoteId: string | null;
  name: string;
  userId: string;
}

interface Vendor {
  id: number;
  remoteId: string | null;
  name: string;
  userId: string;
}

interface Expense {
  localId: number;
  remoteId: string | null;
  vendorName: string;
  vendorId: number | null;
  categoryId: number | null;
  categoryName: string;
  amount: string;
  date: string;
  memo: string | null;
  userId: string;
}

interface PasswordRecord {
  vendor: string;
  account: string;
  pw: string;
  memo?: string;
}

interface SubscriptionRecord {
  name: string;
  account: string;
  amount: string;
  dueDate: string;
  memo: string;
}

function App() {
  // --- Global App State ---
  const [activeTab, setActiveTab] = useState<"passwords" | "subscriptions" | "expenses">("expenses");
  const [uids, setUids] = useState<string[]>([]);
  const [userUid, setUserUid] = useState<string>("");
  const [isOnline, setIsOnline] = useState<boolean>(false);
  const [statusMsg, setStatusMsg] = useState<string>("Ready");

  // --- Modals State ---
  const [isPwModalOpen, setIsPwModalOpen] = useState<boolean>(false);
  const [pwModalMode, setPwModalMode] = useState<"add" | "edit">("add");

  const [isSubModalOpen, setIsSubModalOpen] = useState<boolean>(false);
  const [subModalMode, setSubModalMode] = useState<"add" | "edit">("add");

  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState<boolean>(false);
  const [expenseModalMode, setExpenseModalMode] = useState<"add" | "edit">("add");

  // --- Passwords State ---
  const [passwordsMap, setPasswordsMap] = useState<Record<string, PasswordRecord>>({});
  const [pwSearch, setPwSearch] = useState<string>("");
  const [selectedPwId, setSelectedPwId] = useState<string | null>(null);
  const [pwVendor, setPwVendor] = useState<string>("");
  const [pwAccount, setPwAccount] = useState<string>("");
  const [pwPassword, setPwPassword] = useState<string>("");
  const [pwMemo, setPwMemo] = useState<string>("");
  const [pwLength, setPwLength] = useState<12 | 14>(12);
  const [pwOriginal, setPwOriginal] = useState<string>("");
  const [copiedText, setCopiedText] = useState<boolean>(false);

  // --- Subscriptions State ---
  const [subscriptionsMap, setSubscriptionsMap] = useState<Record<string, SubscriptionRecord>>({});
  const [subSearch, setSubSearch] = useState<string>("");
  const [selectedSubId, setSelectedSubId] = useState<string | null>(null);
  const [subName, setSubName] = useState<string>("");
  const [subAccount, setSubAccount] = useState<string>("");
  const [subAmount, setSubAmount] = useState<string>("");
  const [subDueDate, setSubDueDate] = useState<string>("");
  const [subMemo, setSubMemo] = useState<string>("");
  const [subSortAscending, setSubSortAscending] = useState<boolean>(true);
  const [subViewMode, setSubViewMode] = useState<"list" | "calendar">("list");
  const [calMonth, setCalMonth] = useState<number>(new Date().getMonth());
  const [calYear, setCalYear] = useState<number>(new Date().getFullYear());

  // --- Expenses State ---
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null); // null means "All Expenses"
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [selectedVendor, setSelectedVendor] = useState<Vendor | null>(null); // null means "All Vendors"
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null);
  
  // Expenses Form State
  const [expVendor, setExpVendor] = useState<string>("");
  const [expAmount, setExpAmount] = useState<string>("");
  const [expDate, setExpDate] = useState<string>(new Date().toISOString().split("T")[0]);
  const [expCategory, setExpCategory] = useState<string>("");
  const [expMemo, setExpMemo] = useState<string>("");
  const [sortAscending, setSortAscending] = useState<boolean>(true);

  // Refs for tracking lists of all items for suggestions
  const [allVendors, setAllVendors] = useState<Vendor[]>([]);
  const [allCategories, setAllCategories] = useState<Category[]>([]);

  // --- Resizable Panes State for Expenses Tab ---
  const [col1Width, setCol1Width] = useState<number>(240);
  const [col2Width, setCol2Width] = useState<number>(240);
  const [isResizing1, setIsResizing1] = useState<boolean>(false);
  const [isResizing2, setIsResizing2] = useState<boolean>(false);

  const startResize1 = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing1(true);
  };

  const startResize2 = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing2(true);
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isResizing1) {
        const container = document.querySelector(".paned-container");
        if (container) {
          const rect = container.getBoundingClientRect();
          const newWidth = Math.max(150, Math.min(500, e.clientX - rect.left));
          setCol1Width(newWidth);
        }
      } else if (isResizing2) {
        const container = document.querySelector(".paned-container");
        if (container) {
          const rect = container.getBoundingClientRect();
          const newWidth = Math.max(150, Math.min(500, e.clientX - rect.left - col1Width));
          setCol2Width(newWidth);
        }
      }
    };

    const handleMouseUp = () => {
      setIsResizing1(false);
      setIsResizing2(false);
    };

    if (isResizing1 || isResizing2) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    }

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing1, isResizing2, col1Width]);

  // Guard to prevent recursive select loops
  const isUpdatingSelection = useRef<boolean>(false);
  const dateInputRef = useRef<HTMLInputElement>(null);

  // --- Initialization ---
  useEffect(() => {
    async function init() {
      try {
        const available = await invoke<boolean>("is_firebase_available");
        setIsOnline(available);

        let defaultUid = await invoke<string>("get_default_uid");
        setUserUid(defaultUid);

        if (available) {
          const fetchedUids = await invoke<string[]>("get_users");
          setUids(fetchedUids);
          if (fetchedUids.length > 0 && !fetchedUids.includes(defaultUid)) {
            setUserUid(fetchedUids[0]);
          }
        } else {
          setUids([defaultUid]);
        }
      } catch (err: any) {
        setStatusMsg(`❌ Initialization Error: ${err}`);
      }
    }
    init();
  }, []);

  // --- Trigger load when userUid changes ---
  useEffect(() => {
    if (!userUid) return;
    setStatusMsg(`Loaded user: ${userUid}`);
    loadAllData();
  }, [userUid]);

  const loadAllData = async () => {
    if (!userUid) return;
    try {
      if (isOnline) {
        // Load passwords & subscriptions
        loadPasswords();
        loadSubscriptions();
        // Sync expenses
        await handleCloudSync();
      } else {
        setStatusMsg("Offline Mode - SQLite only");
      }
      // Load expenses from local SQLite
      refreshExpenseData();
    } catch (err: any) {
      setStatusMsg(`❌ Error loading data: ${err}`);
    }
  };

  // ── Sync Helper ─────────────────────────────────────────────────────────
  const handleCloudSync = async () => {
    if (!isOnline || !userUid) return;
    setStatusMsg("Syncing with cloud...");
    try {
      const res = await invoke<string>("sync_all", { uid: userUid });
      setStatusMsg(res);
      refreshExpenseData();
    } catch (err: any) {
      setStatusMsg(`❌ Sync failed: ${err}`);
    }
  };

  // ── Password Handlers ──────────────────────────────────────────────────
  const loadPasswords = async () => {
    try {
      const data = await invoke<Record<string, PasswordRecord>>("load_passwords", { uid: userUid });
      setPasswordsMap(data || {});
    } catch (err: any) {
      setPasswordsMap({});
    }
  };

  const handlePasswordSelect = (id: string, record: PasswordRecord) => {
    setSelectedPwId(id);
    setPwVendor(record.vendor);
    setPwAccount(record.account);
    setPwPassword(record.pw);
    setPwOriginal(record.pw);
    setPwMemo(record.memo || "");
    setPwModalMode("edit");
    setIsPwModalOpen(true);
  };

  const openAddPwModal = () => {
    setSelectedPwId(null);
    setPwVendor("");
    setPwAccount("");
    setPwPassword("");
    setPwOriginal("");
    setPwMemo("");
    setPwModalMode("add");
    setIsPwModalOpen(true);
  };

  const closePwModal = () => {
    setIsPwModalOpen(false);
    setSelectedPwId(null);
  };

  const generatePassword = () => {
    const allowed = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789~@!#$%^&*()/:;?,.<>_-";
    let generated = "";
    for (let i = 0; i < pwLength; i++) {
      generated += allowed.charAt(Math.floor(Math.random() * allowed.length));
    }
    setPwPassword(generated);
    setStatusMsg(`Generated ${pwLength}-character strong password.`);
  };

  const copyPasswordToClipboard = async () => {
    if (!pwPassword) return;
    try {
      await navigator.clipboard.writeText(pwPassword);
      setCopiedText(true);
      setStatusMsg("✅ Password copied to clipboard!");
      setTimeout(() => setCopiedText(false), 2000);
    } catch (err) {
      setStatusMsg("❌ Failed to copy to clipboard.");
    }
  };

  const handleAddPassword = async () => {
    if (!pwVendor && !pwAccount && !pwPassword && !pwMemo) {
      alert("Fill in at least one field.");
      return;
    }
    try {
      await invoke("add_password", {
        uid: userUid,
        vendor: pwVendor,
        account: pwAccount,
        pw: pwPassword,
        memo: pwMemo,
      });
      setStatusMsg("✅ Password added");
      closePwModal();
      loadPasswords();
    } catch (err: any) {
      setStatusMsg(`❌ Error: ${err}`);
    }
  };

  const handleUpdatePassword = async () => {
    if (!selectedPwId) return;
    try {
      await invoke("update_password", {
        uid: userUid,
        id: selectedPwId,
        vendor: pwVendor,
        account: pwAccount,
        pw: pwPassword,
        memo: pwMemo,
      });
      setStatusMsg("✅ Password updated");
      closePwModal();
      loadPasswords();
    } catch (err: any) {
      setStatusMsg(`❌ Error: ${err}`);
    }
  };

  const handleDeletePassword = async () => {
    if (!selectedPwId) return;
    if (!window.confirm("Delete this password record?")) return;
    try {
      await invoke("delete_password", { uid: userUid, id: selectedPwId });
      setStatusMsg("🗑️ Password deleted");
      closePwModal();
      loadPasswords();
    } catch (err: any) {
      setStatusMsg(`❌ Error: ${err}`);
    }
  };

  // ── Subscription Handlers ──────────────────────────────────────────────
  const loadSubscriptions = async () => {
    try {
      const data = await invoke<Record<string, SubscriptionRecord>>("load_subscriptions", { uid: userUid });
      setSubscriptionsMap(data || {});
    } catch (err: any) {
      setSubscriptionsMap({});
    }
  };

  const handleSubscriptionSelect = (id: string, record: SubscriptionRecord) => {
    setSelectedSubId(id);
    setSubName(record.name);
    setSubAccount(record.account);
    setSubAmount(record.amount);
    setSubDueDate(record.dueDate);
    setSubMemo(record.memo);
    setSubModalMode("edit");
    setIsSubModalOpen(true);
  };

  const openAddSubModal = () => {
    setSelectedSubId(null);
    setSubName("");
    setSubAccount("");
    setSubAmount("");
    setSubDueDate("");
    setSubMemo("");
    setSubModalMode("add");
    setIsSubModalOpen(true);
  };

  const closeSubModal = () => {
    setIsSubModalOpen(false);
    setSelectedSubId(null);
  };

  const handleAddSubscription = async () => {
    if (!subName) {
      alert("Service Name is required.");
      return;
    }
    try {
      await invoke("add_subscription", {
        uid: userUid,
        name: subName,
        account: subAccount,
        amount: subAmount,
        dueDate: subDueDate,
        memo: subMemo,
      });
      setStatusMsg(`✅ Subscription '${subName}' added`);
      closeSubModal();
      loadSubscriptions();
    } catch (err: any) {
      setStatusMsg(`❌ Error: ${err}`);
    }
  };

  const handleUpdateSubscription = async () => {
    if (!selectedSubId) return;
    if (!subName) {
      alert("Service Name is required.");
      return;
    }
    try {
      await invoke("update_subscription", {
        uid: userUid,
        id: selectedSubId,
        name: subName,
        account: subAccount,
        amount: subAmount,
        dueDate: subDueDate,
        memo: subMemo,
      });
      setStatusMsg(`✅ Subscription '${subName}' updated`);
      closeSubModal();
      loadSubscriptions();
    } catch (err: any) {
      setStatusMsg(`❌ Error: ${err}`);
    }
  };

  const handleDeleteSubscription = async () => {
    if (!selectedSubId) return;
    if (!window.confirm(`Are you sure you want to delete '${subName}'?`)) return;
    try {
      await invoke("delete_subscription", { uid: userUid, id: selectedSubId });
      setStatusMsg(`🗑️ Subscription '${subName}' deleted`);
      closeSubModal();
      loadSubscriptions();
    } catch (err: any) {
      setStatusMsg(`❌ Error: ${err}`);
    }
  };

  // ── Expense Local DB & Sync Handlers ──────────────────────────────────
  const refreshExpenseData = async () => {
    if (!userUid) return;
    try {
      const cats = await invoke<Category[]>("get_categories", { uid: userUid });
      setCategories(cats);
      setAllCategories(cats);

      const vends = await invoke<Vendor[]>("get_vendors", { uid: userUid });
      setAllVendors(vends);

      if (selectedCategory) {
        // Load vendors for this category
        const catVendors = await invoke<Vendor[]>("get_vendors_by_category", {
          uid: userUid,
          categoryId: selectedCategory.id,
        });
        setVendors(catVendors);
        loadFilteredExpenses(selectedCategory.id, selectedVendor?.id || null);
      } else {
        setVendors(vends);
        loadAllExpenses();
      }
    } catch (err: any) {
      setStatusMsg(`Error refreshing expenses: ${err}`);
    }
  };

  const loadAllExpenses = async () => {
    try {
      const rows = await invoke<Expense[]>("get_expenses_with_categories", {
        uid: userUid,
        ascending: sortAscending,
      });
      setExpenses(rows);
    } catch (err: any) {
      setExpenses([]);
    }
  };

  const loadFilteredExpenses = async (catId: number, vendId: number | null) => {
    try {
      const rows = await invoke<Expense[]>("get_expenses_by_category_and_vendor", {
        uid: userUid,
        categoryId: catId,
        vendorId: vendId,
        ascending: sortAscending,
      });
      setExpenses(rows);
    } catch (err: any) {
      setExpenses([]);
    }
  };

  // Selection callbacks
  const handleCategorySelect = async (cat: Category | null) => {
    if (isUpdatingSelection.current) return;
    setSelectedCategory(cat);
    setSelectedVendor(null); // Reset vendor selection when category changes

    if (cat === null) {
      // "All Expenses"
      setVendors(allVendors);
      const rows = await invoke<Expense[]>("get_expenses_with_categories", {
        uid: userUid,
        ascending: sortAscending,
      });
      setExpenses(rows);
    } else {
      // Specific Category
      setExpCategory(cat.name);
      const catVendors = await invoke<Vendor[]>("get_vendors_by_category", {
        uid: userUid,
        categoryId: cat.id,
      });
      setVendors(catVendors);
      
      const rows = await invoke<Expense[]>("get_expenses_by_category_and_vendor", {
        uid: userUid,
        categoryId: cat.id,
        vendorId: null,
        ascending: sortAscending,
      });
      setExpenses(rows);
    }
  };

  const handleVendorSelect = async (vend: Vendor | null) => {
    if (isUpdatingSelection.current) return;
    setSelectedVendor(vend);

    if (selectedCategory) {
      if (vend === null) {
        loadFilteredExpenses(selectedCategory.id, null);
      } else {
        loadFilteredExpenses(selectedCategory.id, vend.id);
        setExpVendor(vend.name);
        setExpCategory(selectedCategory.name);
      }
    } else {
      // All Expenses selection with specific vendor
      if (vend === null) {
        loadAllExpenses();
      } else {
        setExpVendor(vend.name);
        // Find most used category for this vendor
        autoFillCategoryForVendor(vend.name);
      }
    }
  };

  const autoFillCategoryForVendor = async (vName: string) => {
    const vend = allVendors.find(v => v.name.toLowerCase() === vName.toLowerCase());
    if (!vend) return;

    try {
      const usages: Record<string, number> = {};
      expenses.forEach(exp => {
        if (exp.vendorName.toLowerCase() === vName.toLowerCase() && exp.categoryName) {
          usages[exp.categoryName] = (usages[exp.categoryName] || 0) + 1;
        }
      });

      let mostUsedCat = "";
      let maxCount = 0;
      Object.entries(usages).forEach(([catName, count]) => {
        if (count > maxCount) {
          maxCount = count;
          mostUsedCat = catName;
        }
      });

      if (mostUsedCat) {
        setExpCategory(mostUsedCat);
        setStatusMsg(`Vendor '${vName}' auto-filled category '${mostUsedCat}'`);
        
        // Update listbox category select to match
        const matchingCat = allCategories.find(c => c.name === mostUsedCat);
        if (matchingCat) {
          setSelectedCategory(matchingCat);
          const catVendors = await invoke<Vendor[]>("get_vendors_by_category", {
            uid: userUid,
            categoryId: matchingCat.id,
          });
          setVendors(catVendors);
          const matchingVend = catVendors.find(v => v.name.toLowerCase() === vName.toLowerCase());
          setSelectedVendor(matchingVend || null);
        }
      }
    } catch (err) {}
  };

  const handleExpenseSelect = async (exp: Expense) => {
    isUpdatingSelection.current = true;
    try {
      setSelectedExpense(exp);
      setExpVendor(exp.vendorName || "");
      setExpAmount(exp.amount || "");
      setExpDate(exp.date || "");
      setExpMemo(exp.memo || "");
      setExpCategory(exp.categoryName || "");

      // Auto-select Category in Column 1
      const matchingCat = allCategories.find(c => c.id === exp.categoryId);
      if (matchingCat) {
        setSelectedCategory(matchingCat);
        
        // Auto-select Vendor in Column 2
        const catVendors = await invoke<Vendor[]>("get_vendors_by_category", {
          uid: userUid,
          categoryId: matchingCat.id,
        });
        setVendors(catVendors);
        
        const matchingVend = catVendors.find(v => v.id === exp.vendorId);
        setSelectedVendor(matchingVend || null);
      }

      setExpenseModalMode("edit");
      setIsExpenseModalOpen(true);
    } finally {
      isUpdatingSelection.current = false;
    }
  };

  const openAddExpenseModal = () => {
    setSelectedExpense(null);
    setExpVendor(selectedVendor?.name || "");
    setExpAmount("");
    setExpDate(new Date().toISOString().split("T")[0]);
    setExpMemo("");
    setExpCategory(selectedCategory?.name || "");
    setExpenseModalMode("add");
    setIsExpenseModalOpen(true);
  };

  const closeExpenseModal = () => {
    setIsExpenseModalOpen(false);
    setSelectedExpense(null);
  };

  const clearExpenseAllFilters = () => {
    setSelectedCategory(null);
    setSelectedVendor(null);
    setSelectedExpense(null);
    refreshExpenseData();
  };

  // Column Actions
  const handleAddCategory = async () => {
    const name = prompt("Enter new category name:");
    if (!name || !name.trim()) return;
    const catName = name.trim();
    
    // Check if it already exists (case-insensitive, trimmed)
    const existing = allCategories.find(c => c.name.trim().toLowerCase() === catName.toLowerCase());
    if (existing) {
      setStatusMsg(`ℹ️ Category '${existing.name}' already exists; selecting it.`);
      
      setSelectedCategory(existing);
      setSelectedVendor(null);

      // Re-fetch everything to ensure state is clean and the existing category is shown and selected
      const cats = await invoke<Category[]>("get_categories", { uid: userUid });
      setCategories(cats);
      setAllCategories(cats);

      const vends = await invoke<Vendor[]>("get_vendors", { uid: userUid });
      setAllVendors(vends);
      
      // Load vendors for this category
      const catVendors = await invoke<Vendor[]>("get_vendors_by_category", {
        uid: userUid,
        categoryId: existing.id,
      });
      setVendors(catVendors);

      setExpCategory(existing.name);
      loadFilteredExpenses(existing.id, null);
      return;
    }

    try {
      const newId = await invoke<number>("add_category", { uid: userUid, name: catName });
      setStatusMsg(`✅ Category '${catName}' added`);

      const newCategory: Category = {
        id: newId,
        remoteId: null,
        name: catName,
        userId: userUid,
      };

      setSelectedCategory(newCategory);
      setSelectedVendor(null);

      // Re-fetch everything
      const cats = await invoke<Category[]>("get_categories", { uid: userUid });
      setCategories(cats);
      setAllCategories(cats);

      const vends = await invoke<Vendor[]>("get_vendors", { uid: userUid });
      setAllVendors(vends);
      setVendors([]); // A brand new category has no vendors associated with its expenses yet

      setExpenses([]); // Since new category has no expenses
    } catch (err: any) {
      alert(`Error: ${err}`);
    }
  };

  const handleRenameCategory = async () => {
    if (!selectedCategory) {
      alert("Please select a category to rename");
      return;
    }
    const name = prompt(`Rename category '${selectedCategory.name}' to:`, selectedCategory.name);
    if (!name || !name.trim()) return;
    const newName = name.trim();
    try {
      await invoke("rename_category", {
        uid: userUid,
        catId: selectedCategory.id,
        remoteId: selectedCategory.remoteId,
        name: newName,
      });
      setStatusMsg(`✅ Category renamed to '${newName}'`);
      setSelectedCategory(null);
      refreshExpenseData();
    } catch (err: any) {
      alert(`Error: ${err}`);
    }
  };

  const handleDeleteCategory = async () => {
    if (!selectedCategory) {
      alert("Please select a category to delete");
      return;
    }
    if (!window.confirm(`Delete category '${selectedCategory.name}'? Related expenses will be uncategorized.`)) return;
    try {
      await invoke("delete_category", {
        uid: userUid,
        catId: selectedCategory.id,
        remoteId: selectedCategory.remoteId,
      });
      setStatusMsg(`🗑️ Category '${selectedCategory.name}' deleted`);
      setSelectedCategory(null);
      refreshExpenseData();
    } catch (err: any) {
      alert(`Error: ${err}`);
    }
  };

  const handleAddVendor = async () => {
    const name = prompt("Enter new vendor name:");
    if (!name || !name.trim()) return;
    const vName = name.trim();

    // Check if it already exists (case-insensitive, trimmed)
    const existing = allVendors.find(v => v.name.trim().toLowerCase() === vName.toLowerCase());
    if (existing) {
      setStatusMsg(`ℹ️ Vendor '${existing.name}' already exists; selecting it.`);
      
      // Clear category selection so we see all vendors and the existing vendor is shown
      setSelectedCategory(null);
      setSelectedVendor(existing);

      // Re-fetch everything to ensure state is clean and the existing vendor is shown in the full list
      const cats = await invoke<Category[]>("get_categories", { uid: userUid });
      setCategories(cats);
      setAllCategories(cats);

      const vends = await invoke<Vendor[]>("get_vendors", { uid: userUid });
      setAllVendors(vends);
      setVendors(vends); // Ensure the full list of vendors is displayed so they can see "existing"!

      setExpVendor(existing.name);
      loadAllExpenses();
      return;
    }

    try {
      const newId = await invoke<number>("add_vendor", { uid: userUid, name: vName });
      setStatusMsg(`✅ Vendor '${vName}' added`);
      
      const newVendor: Vendor = {
        id: newId,
        remoteId: null,
        name: vName,
        userId: userUid,
      };

      // Clear category selection so we see all vendors and the new vendor is shown
      setSelectedCategory(null);
      setSelectedVendor(newVendor);

      // Re-fetch everything
      const cats = await invoke<Category[]>("get_categories", { uid: userUid });
      setCategories(cats);
      setAllCategories(cats);

      const vends = await invoke<Vendor[]>("get_vendors", { uid: userUid });
      setAllVendors(vends);
      setVendors(vends); // Show all vendors including the new one
      
      setExpenses([]); // Since new vendor has no expenses
    } catch (err: any) {
      alert(`Error: ${err}`);
    }
  };

  const handleRenameVendor = async () => {
    if (!selectedVendor) {
      alert("Please select a vendor to rename");
      return;
    }
    const name = prompt(`Rename vendor '${selectedVendor.name}' to:`, selectedVendor.name);
    if (!name || !name.trim()) return;
    const newName = name.trim();
    try {
      await invoke("rename_vendor", {
        uid: userUid,
        vendorId: selectedVendor.id,
        remoteId: selectedVendor.remoteId,
        name: newName,
      });
      setStatusMsg(`✅ Vendor renamed to '${newName}'`);
      setSelectedVendor(null);
      refreshExpenseData();
    } catch (err: any) {
      alert(`Error: ${err}`);
    }
  };

  const handleDeleteVendor = async () => {
    if (!selectedVendor) {
      alert("Please select a vendor to delete");
      return;
    }
    if (!window.confirm(`Delete vendor '${selectedVendor.name}'? Related expenses will be uncategorized.`)) return;
    try {
      await invoke("delete_vendor", {
        uid: userUid,
        vendorId: selectedVendor.id,
        remoteId: selectedVendor.remoteId,
      });
      setStatusMsg(`🗑️ Vendor '${selectedVendor.name}' deleted`);
      setSelectedVendor(null);
      refreshExpenseData();
    } catch (err: any) {
      alert(`Error: ${err}`);
    }
  };

  // CRUD Expense Actions
  const handleAddExpense = async () => {
    if (!expVendor || !expAmount || !expCategory) {
      alert("Vendor, Amount, and Category are required");
      return;
    }
    try {
      await invoke("add_expense", {
        uid: userUid,
        vendorName: expVendor,
        amount: expAmount,
        date: expDate,
        memo: expMemo,
        categoryName: expCategory,
      });
      setStatusMsg("✅ Expense added successfully");
      closeExpenseModal();
      refreshExpenseData();
    } catch (err: any) {
      alert(`Error adding expense: ${err}`);
    }
  };

  const handleUpdateExpense = async () => {
    if (!selectedExpense) return;
    if (!expVendor || !expAmount || !expCategory) {
      alert("Vendor, Amount, and Category are required");
      return;
    }
    try {
      await invoke("update_expense", {
        uid: userUid,
        localId: selectedExpense.localId,
        remoteId: selectedExpense.remoteId,
        vendorName: expVendor,
        amount: expAmount,
        date: expDate,
        memo: expMemo,
        categoryName: expCategory,
      });
      setStatusMsg("✅ Expense updated");
      closeExpenseModal();
      refreshExpenseData();
    } catch (err: any) {
      alert(`Error updating expense: ${err}`);
    }
  };

  const handleDeleteExpense = async () => {
    if (!selectedExpense) return;
    if (!window.confirm("Delete the selected expense?")) return;
    try {
      await invoke("delete_expense", {
        uid: userUid,
        localId: selectedExpense.localId,
        remoteId: selectedExpense.remoteId,
      });
      setStatusMsg("🗑️ Expense deleted");
      closeExpenseModal();
      refreshExpenseData();
    } catch (err: any) {
      alert(`Error deleting expense: ${err}`);
    }
  };

  // Toggle Sorting
  const toggleSortOrder = () => {
    setSortAscending(!sortAscending);
  };

  useEffect(() => {
    if (!userUid) return;
    if (selectedCategory) {
      loadFilteredExpenses(selectedCategory.id, selectedVendor?.id || null);
    } else {
      loadAllExpenses();
    }
  }, [sortAscending]);

  // Click Column Sorting
  const sortExpenses = (col: "d" | "v" | "a" | "m") => {
    const sorted = [...expenses].sort((a, b) => {
      let valA: any = "";
      let valB: any = "";

      if (col === "d") {
        valA = new Date(a.date).getTime() || 0;
        valB = new Date(b.date).getTime() || 0;
      } else if (col === "v") {
        valA = a.vendorName.toLowerCase();
        valB = b.vendorName.toLowerCase();
      } else if (col === "a") {
        valA = parseFloat(a.amount) || 0;
        valB = parseFloat(b.amount) || 0;
      } else if (col === "m") {
        valA = (a.memo || "").toLowerCase();
        valB = (b.memo || "").toLowerCase();
      }

      if (valA < valB) return sortAscending ? -1 : 1;
      if (valA > valB) return sortAscending ? 1 : -1;
      return 0;
    });
    setExpenses(sorted);
  };

  // --- Filtering computations ---
  const filteredPasswords = Object.entries(passwordsMap).filter(([_, record]) => {
    const term = pwSearch.toLowerCase();
    return (
      record.vendor.toLowerCase().includes(term) ||
      record.account.toLowerCase().includes(term) ||
      (record.memo || "").toLowerCase().includes(term)
    );
  });

  const getOrdinalDay = (n: number): string => {
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  };

  const parseDueDateToNumber = (dueDate: string): number => {
    if (!dueDate) return 999;
    const clean = dueDate.trim();
    
    // Check if it's a full date (e.g. YYYY-MM-DD or MM/DD/YYYY)
    if (clean.includes("-") || clean.includes("/")) {
      const parsed = Date.parse(clean);
      if (!isNaN(parsed)) {
        return new Date(parsed).getDate();
      }
    }

    // Extract leading/any sequence of digits (e.g. "1st" -> 1, "22nd" -> 22)
    const match = clean.match(/\d+/);
    if (match) {
      return parseInt(match[0], 10);
    }
    return 999;
  };

  const filteredSubscriptions = Object.entries(subscriptionsMap)
    .filter(([_, record]) => {
      const term = subSearch.toLowerCase();
      return record.name.toLowerCase().includes(term) || record.account.toLowerCase().includes(term);
    })
    .sort((a, b) => {
      const dayA = parseDueDateToNumber(a[1].dueDate);
      const dayB = parseDueDateToNumber(b[1].dueDate);
      if (dayA < dayB) return subSortAscending ? -1 : 1;
      if (dayA > dayB) return subSortAscending ? 1 : -1;
      return 0;
    });

  const handlePrevMonth = () => {
    setCalMonth((prev) => {
      if (prev === 0) {
        setCalYear((y) => y - 1);
        return 11;
      }
      return prev - 1;
    });
  };

  const handleNextMonth = () => {
    setCalMonth((prev) => {
      if (prev === 11) {
        setCalYear((y) => y + 1);
        return 0;
      }
      return prev + 1;
    });
  };

  const getSubsForDay = (dayNum: number): [string, SubscriptionRecord][] => {
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();

    return Object.entries(subscriptionsMap)
      .filter(([_, sub]) => {
        const clean = sub.dueDate.trim();
        
        // Full date match (YYYY-MM-DD or MM/DD/YYYY)
        if (clean.includes("-") || clean.includes("/")) {
          const parsed = Date.parse(clean);
          if (!isNaN(parsed)) {
            const d = new Date(parsed);
            return d.getDate() === dayNum && d.getMonth() === calMonth && d.getFullYear() === calYear;
          }
        }

        // Recurring month day (e.g. "15th" -> 15)
        const match = clean.match(/\d+/);
        if (match) {
          const subDay = parseInt(match[0], 10);
          // Standard match: the subscription's day is exactly equal to today's day number
          if (subDay === dayNum && subDay <= daysInMonth) {
            return true;
          }
          // Overflow match: if this is the last day of the month,
          // and the subscription is scheduled on a day that exceeds this month's length
          if (dayNum === daysInMonth && subDay > daysInMonth) {
            return true;
          }
        }
        return false;
      })
      .map(([id, sub]) => {
        const clean = sub.dueDate.trim();
        const match = clean.match(/\d+/);
        if (match) {
          const subDay = parseInt(match[0], 10);
          if (dayNum === daysInMonth && subDay > daysInMonth) {
            return [
              id,
              {
                ...sub,
                name: `${sub.name}*`, // Mark as overflow on last day of shorter months
              },
            ];
          }
        }
        return [id, sub];
      });
  };

  // --- TanStack Table Definition ---
  const columns: ColumnDef<StockFeatures, Expense, any>[] = [
    {
      accessorKey: "vendorName",
      header: "Vendor",
      size: 150,
      minSize: 80,
    },
    {
      accessorKey: "amount",
      header: "Amount",
      size: 100,
      minSize: 60,
      cell: (info: any) => {
        const val = info.getValue() as string;
        return val.startsWith("$") ? val : `$${parseFloat(val).toFixed(2)}`;
      },
    },
    {
      accessorKey: "date",
      header: "Date",
      size: 110,
      minSize: 80,
    },
    {
      accessorKey: "memo",
      header: "Memo",
      size: 200,
      minSize: 100,
    },
  ];

  const [columnSizing, setColumnSizing] = useState<Record<string, number>>({});

  const table = useTable<StockFeatures, Expense>({
    features: stockFeatures,
    data: expenses,
    columns,
    columnResizeMode: "onChange",
    state: {
      columnSizing,
    },
    onColumnSizingChange: setColumnSizing,
  });

  return (
    <div className="app-container">
      {/* Top Selection Bar */}
      <div className="top-bar">
        <label>User UID:</label>
        <select value={userUid} onChange={(e) => setUserUid(e.target.value)}>
          {uids.map((uid) => (
            <option key={uid} value={uid}>
              {uid}
            </option>
          ))}
        </select>
        <button onClick={loadAllData}>↻ Reload</button>
        {isOnline ? (
          <button className="btn-primary" onClick={handleCloudSync}>☁ Cloud Sync</button>
        ) : (
          <span className="status-badge">🔌 OFFLINE MODE</span>
        )}
      </div>

      {/* Tabs Menu */}
      <div className="notebook-tabs">
        <button
          className={`tab-btn ${activeTab === "passwords" ? "active" : ""}`}
          onClick={() => setActiveTab("passwords")}
        >
          🔑 Passwords
        </button>
        <button
          className={`tab-btn ${activeTab === "subscriptions" ? "active" : ""}`}
          onClick={() => setActiveTab("subscriptions")}
        >
          📋 Subscriptions
        </button>
        <button
          className={`tab-btn ${activeTab === "expenses" ? "active" : ""}`}
          onClick={() => setActiveTab("expenses")}
        >
          💰 Expenses
        </button>
      </div>

      {/* Main Tab Panels */}
      <div className="tab-content">
        {/* --- Passwords Tab --- */}
        <div className={`tab-panel ${activeTab === "passwords" ? "active" : ""}`}>
          <div className="search-bar">
            <span>🔍 Search:</span>
            <input
              type="text"
              placeholder="Search passwords..."
              value={pwSearch}
              onChange={(e) => setPwSearch(e.target.value)}
            />
            <button onClick={() => setPwSearch("")}>Clear</button>
            <span className="search-hint" style={{ marginRight: "auto" }}>(search by account or vendor)</span>
            <button className="btn-primary" onClick={openAddPwModal}>➕ Add Password</button>
          </div>

          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Vendor</th>
                  <th>Account</th>
                  <th>Password</th>
                  <th>Memo</th>
                </tr>
              </thead>
              <tbody>
                {filteredPasswords.map(([id, r]) => (
                  <tr
                    key={id}
                    className={selectedPwId === id ? "selected" : ""}
                    onClick={() => handlePasswordSelect(id, r)}
                    style={{ cursor: "pointer" }}
                  >
                    <td>{r.vendor}</td>
                    <td>{r.account}</td>
                    <td>{r.pw}</td>
                    <td>{r.memo || ""}</td>
                  </tr>
                ))}
                {filteredPasswords.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ textAlign: "center", color: "var(--text-muted)" }}>
                      No passwords found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* --- Subscriptions Tab --- */}
        <div className={`tab-panel ${activeTab === "subscriptions" ? "active" : ""}`}>
          <div className="search-bar">
            <span>🔍 Search:</span>
            <input
              type="text"
              placeholder="Search subscriptions..."
              value={subSearch}
              onChange={(e) => setSubSearch(e.target.value)}
            />
            <button onClick={() => setSubSearch("")}>Clear</button>

            <div className="view-toggle-group" style={{ marginLeft: "10px", marginRight: "10px", display: "flex", gap: "4px" }}>
              <button
                className={`tab-btn ${subViewMode === "list" ? "active" : ""}`}
                onClick={() => setSubViewMode("list")}
                style={{ padding: "4px 10px", fontSize: "0.9em" }}
              >
                📋 List
              </button>
              <button
                className={`tab-btn ${subViewMode === "calendar" ? "active" : ""}`}
                onClick={() => setSubViewMode("calendar")}
                style={{ padding: "4px 10px", fontSize: "0.9em" }}
              >
                📅 Calendar
              </button>
            </div>

            <span className="search-hint" style={{ marginRight: "auto" }}>(search by name or account)</span>
            <button className="btn-primary" onClick={openAddSubModal}>➕ Add Subscription</button>
          </div>

          {subViewMode === "list" ? (
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Service</th>
                    <th>Account</th>
                    <th>Amount</th>
                    <th
                      onClick={() => setSubSortAscending(!subSortAscending)}
                      style={{ cursor: "pointer", userSelect: "none" }}
                      title="Click to sort by due date"
                    >
                      Due Date {subSortAscending ? "▲" : "▼"}
                    </th>
                    <th>Memo</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSubscriptions.map(([id, r]) => (
                    <tr
                      key={id}
                      className={selectedSubId === id ? "selected" : ""}
                      onClick={() => handleSubscriptionSelect(id, r)}
                      style={{ cursor: "pointer" }}
                    >
                      <td>{r.name}</td>
                      <td>{r.account}</td>
                      <td>{r.amount}</td>
                      <td>{r.dueDate}</td>
                      <td>{r.memo}</td>
                    </tr>
                  ))}
                  {filteredSubscriptions.length === 0 && (
                    <tr>
                      <td colSpan={5} style={{ textAlign: "center", color: "var(--text-muted)" }}>
                        No subscriptions found
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="calendar-container">
              <div className="calendar-month-header" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "15px", marginBottom: "12px", fontSize: "1.2em", fontWeight: "bold" }}>
                <button onClick={handlePrevMonth} className="btn-secondary" style={{ padding: "4px 10px" }}>◀</button>
                <span>
                  {[
                    "January", "February", "March", "April", "May", "June",
                    "July", "August", "September", "October", "November", "December"
                  ][calMonth]} {calYear}
                </span>
                <button onClick={handleNextMonth} className="btn-secondary" style={{ padding: "4px 10px" }}>▶</button>
                <button
                  onClick={() => {
                    setCalMonth(new Date().getMonth());
                    setCalYear(new Date().getFullYear());
                  }}
                  className="btn-secondary"
                  style={{ padding: "4px 8px", fontSize: "0.8em", marginLeft: "10px" }}
                >
                  Today
                </button>
              </div>

              <div className="calendar-grid">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(w => (
                  <div
                    key={w}
                    className="calendar-week-header"
                    style={{
                      textAlign: "center",
                      fontWeight: "bold",
                      padding: "6px",
                      backgroundColor: "var(--bg-input)",
                      borderRadius: "4px",
                      color: "var(--color-purple)"
                    }}
                  >
                    {w}
                  </div>
                ))}

                {[
                  ...Array(new Date(calYear, calMonth, 1).getDay()).fill(null),
                  ...Array.from({ length: new Date(calYear, calMonth + 1, 0).getDate() }, (_, i) => i + 1)
                ].map((cellDay, index) => {
                  if (cellDay === null) {
                    return (
                      <div
                        key={`blank-${index}`}
                        className="calendar-day-cell blank"
                        style={{
                          minHeight: "90px",
                          backgroundColor: "var(--bg-base)",
                          opacity: 0.15,
                          borderRadius: "4px"
                        }}
                      />
                    );
                  }

                  const isTodayActive =
                    new Date().getDate() === cellDay &&
                    new Date().getMonth() === calMonth &&
                    new Date().getFullYear() === calYear;

                  const daySubs = getSubsForDay(cellDay);

                  return (
                    <div
                      key={`day-${cellDay}`}
                      className={`calendar-day-cell ${isTodayActive ? "today" : ""}`}
                      style={{
                        minHeight: "95px",
                        border: isTodayActive ? "2px solid var(--color-purple)" : "1px solid var(--bg-input)",
                        backgroundColor: isTodayActive ? "rgba(203, 166, 247, 0.15)" : "var(--bg-surface)",
                        borderRadius: "4px",
                        padding: "6px",
                        display: "flex",
                        flexDirection: "column",
                        gap: "6px",
                        boxShadow: isTodayActive ? "0 0 12px rgba(203, 166, 247, 0.25)" : "none",
                        transition: "all 0.2s ease"
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span
                          style={{
                            fontWeight: "bold",
                            fontSize: "1em",
                            color: isTodayActive ? "var(--color-purple)" : "var(--text-main)"
                          }}
                        >
                          {cellDay}
                        </span>
                        {isTodayActive && (
                          <span
                            style={{
                              fontSize: "0.7em",
                              color: "var(--color-purple)",
                              backgroundColor: "rgba(203, 166, 247, 0.2)",
                              padding: "1px 5px",
                              borderRadius: "3px",
                              fontWeight: "bold"
                            }}
                          >
                            TODAY
                          </span>
                        )}
                      </div>

                      <div
                        style={{
                          flex: 1,
                          display: "flex",
                          flexDirection: "column",
                          gap: "4px",
                          overflowY: "auto",
                          maxHeight: "70px"
                        }}
                      >
                        {daySubs.map(([id, sub]) => (
                          <div
                            key={id}
                            onClick={() => handleSubscriptionSelect(id, sub)}
                            className="calendar-sub-badge"
                            style={{
                              fontSize: "0.8em",
                              backgroundColor: "var(--color-purple)",
                              color: "#11111b",
                              padding: "2px 5px",
                              borderRadius: "3px",
                              cursor: "pointer",
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              fontWeight: "bold",
                              display: "flex",
                              justifyContent: "space-between"
                            }}
                            title={`${sub.name} - ${sub.amount}`}
                          >
                            <span>{sub.name}</span>
                            <span>{sub.amount}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* --- Expenses Tab (3-Column Layout with Modals) --- */}
        <div className={`tab-panel ${activeTab === "expenses" ? "active" : ""}`}>
          <div className="paned-container">
            {/* Column 1: Categories */}
            <div className="panel-col col-categories" style={{ width: `${col1Width}px` }}>
              <div className="panel-header">
                <span>Categories</span>
              </div>
              <div className="list-box">
                <div
                  className={`list-item ${selectedCategory === null ? "selected" : ""}`}
                  onClick={() => handleCategorySelect(null)}
                >
                  📊 All Expenses
                </div>
                {categories.map((cat) => (
                  <div
                    key={cat.id}
                    className={`list-item ${selectedCategory?.id === cat.id ? "selected" : ""}`}
                    onClick={() => handleCategorySelect(cat)}
                  >
                    📁 {cat.name}
                  </div>
                ))}
              </div>
              <div className="panel-actions">
                <button onClick={handleAddCategory}>➕ Add</button>
                <button onClick={handleRenameCategory} disabled={!selectedCategory}>✏️ Rename</button>
                <button onClick={handleDeleteCategory} disabled={!selectedCategory}>🗑️ Delete</button>
              </div>
            </div>

            {/* Resizer Handle 1 */}
            <div className={`resizer-handle ${isResizing1 ? "resizing" : ""}`} onMouseDown={startResize1} />

            {/* Column 2: Vendors */}
            <div className="panel-col col-vendors" style={{ width: `${col2Width}px` }}>
              <div className="panel-header">
                <span>Vendors/Customers</span>
              </div>
              <div className="list-box">
                <div
                  className={`list-item ${selectedVendor === null ? "selected" : ""}`}
                  onClick={() => handleVendorSelect(null)}
                >
                  🏷️ All Vendors
                </div>
                {vendors.map((vend) => (
                  <div
                    key={vend.id}
                    className={`list-item ${selectedVendor?.id === vend.id ? "selected" : ""}`}
                    onClick={() => handleVendorSelect(vend)}
                  >
                    👤 {vend.name}
                  </div>
                ))}
              </div>
              <div className="panel-actions">
                <button onClick={handleAddVendor}>➕ Add</button>
                <button onClick={handleRenameVendor} disabled={!selectedVendor}>✏️ Rename</button>
                <button onClick={handleDeleteVendor} disabled={!selectedVendor}>🗑️ Delete</button>
              </div>
            </div>

            {/* Resizer Handle 2 */}
            <div className={`resizer-handle ${isResizing2 ? "resizing" : ""}`} onMouseDown={startResize2} />

            {/* Column 3: Main Expenses list */}
            <div className="panel-col col-main">
              <div className="panel-header">
                <span>
                  {selectedCategory
                    ? `📂 ${selectedCategory.name} ${selectedVendor ? `→ 👤 ${selectedVendor.name}` : ""}`
                    : "📊 All Expenses"}{" "}
                  ({expenses.length} items)
                </span>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button onClick={toggleSortOrder}>
                    {sortAscending ? "⬆ Oldest First" : "⬇ Newest First"}
                  </button>
                  <button onClick={clearExpenseAllFilters}>🔄 Reset Filters</button>
                  <button className="btn-primary" onClick={openAddExpenseModal}>➕ Add Expense</button>
                </div>
              </div>

              {/* TanStack Resizable DataTable */}
              <div className="table-container">
                <table style={{ width: "100%", minWidth: `${table.getCenterTotalSize()}px` }}>
                  <thead>
                    {table.getHeaderGroups().map((headerGroup: any) => (
                      <tr key={headerGroup.id}>
                        {headerGroup.headers.map((header: any) => (
                          <th
                            key={header.id}
                            style={{ width: `${header.getSize()}px`, position: "relative" }}
                            onClick={() => {
                              const id = header.column.id;
                              if (id === "vendorName") sortExpenses("v");
                              else if (id === "amount") sortExpenses("a");
                              else if (id === "date") sortExpenses("d");
                              else if (id === "memo") sortExpenses("m");
                            }}
                          >
                            {header.isPlaceholder
                              ? null
                              : flexRender(header.column.columnDef.header, header.getContext())}
                            <div
                              onMouseDown={header.getResizeHandler()}
                              onTouchStart={header.getResizeHandler()}
                              className={`col-resizer ${header.column.getIsResizing() ? "is-resizing" : ""}`}
                              onClick={(e) => e.stopPropagation()} // Prevent trigger sort on resize drag!
                            />
                          </th>
                        ))}
                      </tr>
                    ))}
                  </thead>
                  <tbody>
                    {table.getRowModel().rows.map((row: any) => (
                      <tr
                        key={row.id}
                        className={selectedExpense?.localId === row.original.localId ? "selected" : ""}
                        onClick={() => handleExpenseSelect(row.original)}
                        style={{ cursor: "pointer" }}
                      >
                        {row.getVisibleCells().map((cell: any) => (
                          <td key={cell.id} style={{ width: `${cell.column.getSize()}px` }}>
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {expenses.length === 0 && (
                      <tr>
                        <td colSpan={4} style={{ textAlign: "center", color: "var(--text-muted)" }}>
                          No expenses found
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* --- Passwords Add/Edit Modal --- */}
      {isPwModalOpen && (
        <div className="modal-overlay" onClick={closePwModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span>{pwModalMode === "add" ? "🔑 Add Password" : "🔑 Edit Password"}</span>
              <button className="modal-close-btn" onClick={closePwModal}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-grid">
                <div className="form-group">
                  <label>Vendor:</label>
                  <input
                    type="text"
                    className="input-field"
                    value={pwVendor}
                    onChange={(e) => setPwVendor(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Account:</label>
                  <input
                    type="text"
                    className="input-field"
                    value={pwAccount}
                    onChange={(e) => setPwAccount(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Password:</label>
                  <input
                    type="text"
                    className="input-field"
                    value={pwPassword}
                    onChange={(e) => setPwPassword(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <button onClick={copyPasswordToClipboard}>
                    {copiedText ? "✅ Copied!" : "📋 Copy"}
                  </button>
                  <button onClick={generatePassword}>⚡ Generate</button>
                  <div className="radio-group" style={{ marginLeft: "10px" }}>
                    <span>Len:</span>
                    <label className="radio-option">
                      <input
                        type="radio"
                        name="modal-pw-length"
                        checked={pwLength === 12}
                        onChange={() => setPwLength(12)}
                      />
                      12
                    </label>
                    <label className="radio-option">
                      <input
                        type="radio"
                        name="modal-pw-length"
                        checked={pwLength === 14}
                        onChange={() => setPwLength(14)}
                      />
                      14
                    </label>
                  </div>
                </div>
                <div className="form-group form-row-wide">
                  <label>Memo:</label>
                  <input
                    type="text"
                    className="input-field"
                    value={pwMemo}
                    onChange={(e) => setPwMemo(e.target.value)}
                  />
                </div>
                {pwModalMode === "edit" && (
                  <div className="form-group form-row-wide">
                    <label>Original:</label>
                    <input
                      type="text"
                      className="input-field"
                      value={pwOriginal}
                      readOnly
                      style={{ color: "var(--text-muted)", backgroundColor: "transparent", border: "none" }}
                    />
                  </div>
                )}
              </div>
              <div className="form-actions" style={{ marginTop: "20px" }}>
                {pwModalMode === "add" ? (
                  <button className="btn-primary" onClick={handleAddPassword}>➕ Add</button>
                ) : (
                  <>
                    <button className="btn-primary" onClick={handleUpdatePassword}>💾 Update</button>
                    <button className="btn-danger" onClick={handleDeletePassword}>🗑️ Delete</button>
                  </>
                )}
                <button onClick={closePwModal}>✖ Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --- Subscriptions Add/Edit Modal --- */}
      {isSubModalOpen && (
        <div className="modal-overlay" onClick={closeSubModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span>{subModalMode === "add" ? "📋 Add Subscription" : "📋 Edit Subscription"}</span>
              <button className="modal-close-btn" onClick={closeSubModal}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-grid">
                <div className="form-group">
                  <label>Service:</label>
                  <input
                    type="text"
                    className="input-field"
                    value={subName}
                    onChange={(e) => setSubName(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Account:</label>
                  <input
                    type="text"
                    className="input-field"
                    value={subAccount}
                    onChange={(e) => setSubAccount(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Amount:</label>
                  <input
                    type="text"
                    className="input-field"
                    value={subAmount}
                    onChange={(e) => setSubAmount(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Due Date:</label>
                  <select
                    className="input-field"
                    value={subDueDate}
                    onChange={(e) => setSubDueDate(e.target.value)}
                  >
                    <option value="">-- Select Day --</option>
                    {Array.from({ length: 31 }, (_, i) => {
                      const dayStr = getOrdinalDay(i + 1);
                      return (
                        <option key={dayStr} value={dayStr}>
                          {dayStr}
                        </option>
                      );
                    })}
                  </select>
                </div>
                <div className="form-group form-row-wide">
                  <label>Memo:</label>
                  <input
                    type="text"
                    className="input-field"
                    value={subMemo}
                    onChange={(e) => setSubMemo(e.target.value)}
                  />
                </div>
              </div>
              <div className="form-actions" style={{ marginTop: "20px" }}>
                {subModalMode === "add" ? (
                  <button className="btn-primary" onClick={handleAddSubscription}>➕ Add</button>
                ) : (
                  <>
                    <button className="btn-primary" onClick={handleUpdateSubscription}>💾 Update</button>
                    <button className="btn-danger" onClick={handleDeleteSubscription}>🗑️ Delete</button>
                  </>
                )}
                <button onClick={closeSubModal}>✖ Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --- Expenses Add/Edit Modal --- */}
      {isExpenseModalOpen && (
        <div className="modal-overlay" onClick={closeExpenseModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span>{expenseModalMode === "add" ? "💰 Add Expense" : "💰 Edit Expense"}</span>
              <button className="modal-close-btn" onClick={closeExpenseModal}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-grid">
                <div className="form-group">
                  <label>Vendor:</label>
                  <select
                    className="input-field"
                    value={expVendor}
                    onChange={(e) => {
                      setExpVendor(e.target.value);
                      autoFillCategoryForVendor(e.target.value);
                    }}
                  >
                    <option value="">-- Select Vendor --</option>
                    {allVendors.map((v) => (
                      <option key={v.id} value={v.name}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label>Amount:</label>
                  <input
                    type="text"
                    className="input-field"
                    value={expAmount}
                    onChange={(e) => setExpAmount(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label>Date:</label>
                  <div className="date-input-container">
                    <input
                      ref={dateInputRef}
                      type="date"
                      className="input-field"
                      value={expDate}
                      onChange={(e) => setExpDate(e.target.value)}
                    />
                    <button onClick={() => dateInputRef.current?.showPicker()} title="Open calendar">📅</button>
                    <button onClick={() => setExpDate(new Date().toISOString().split("T")[0])}>Today</button>
                  </div>
                </div>

                <div className="form-group">
                  <label>Category:</label>
                  <select
                    className="input-field"
                    value={expCategory}
                    onChange={(e) => setExpCategory(e.target.value)}
                  >
                    <option value="">-- Select Category --</option>
                    {allCategories.map((c) => (
                      <option key={c.id} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group form-row-wide">
                  <label>Memo:</label>
                  <input
                    type="text"
                    className="input-field"
                    value={expMemo}
                    onChange={(e) => setExpMemo(e.target.value)}
                  />
                </div>
              </div>

              <div className="form-actions" style={{ marginTop: "20px" }}>
                {expenseModalMode === "add" ? (
                  <button className="btn-primary" onClick={handleAddExpense}>➕ Add Expense</button>
                ) : (
                  <>
                    <button className="btn-primary" onClick={handleUpdateExpense}>✏️ Update</button>
                    <button className="btn-danger" onClick={handleDeleteExpense}>🗑️ Delete</button>
                  </>
                )}
                <button onClick={closeExpenseModal}>✖ Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Footer Status Bar */}
      <div className="status-bar">
        <span>{statusMsg}</span>
        <span>Tauri Sync Pro v1.0.0</span>
      </div>
    </div>
  );
}

export default App;
