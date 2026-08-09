import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
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

  // Autocomplete state
  const [vendorSuggestions, setVendorSuggestions] = useState<string[]>([]);
  const [categorySuggestions, setCategorySuggestions] = useState<string[]>([]);
  const [showVendorSug, setShowVendorSug] = useState<boolean>(false);
  const [showCategorySug, setShowCategorySug] = useState<boolean>(false);

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
    setPwModalMode("edit");
    setIsPwModalOpen(true);
  };

  const openAddPwModal = () => {
    setSelectedPwId(null);
    setPwVendor("");
    setPwAccount("");
    setPwPassword("");
    setPwOriginal("");
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
    if (!pwVendor && !pwAccount && !pwPassword) {
      alert("Fill in at least one field.");
      return;
    }
    try {
      await invoke("add_password", {
        uid: userUid,
        vendor: pwVendor,
        account: pwAccount,
        pw: pwPassword,
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

  // Form Field Changers with suggestions/autocomplete
  const handleVendorInputChange = (val: string) => {
    setExpVendor(val);
    if (!val) {
      setVendorSuggestions([]);
      setShowVendorSug(false);
      return;
    }
    const filtered = allVendors
      .map(v => v.name)
      .filter(name => name.toLowerCase().includes(val.toLowerCase()))
      .slice(0, 10);
    setVendorSuggestions(filtered);
    setShowVendorSug(filtered.length > 0);
  };

  const handleCategoryInputChange = (val: string) => {
    setExpCategory(val);
    if (!val) {
      setCategorySuggestions([]);
      setShowCategorySug(false);
      return;
    }
    const filtered = allCategories
      .map(c => c.name)
      .filter(name => name.toLowerCase().includes(val.toLowerCase()))
      .slice(0, 10);
    setCategorySuggestions(filtered);
    setShowCategorySug(filtered.length > 0);
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
    if (allCategories.some(c => c.name.toLowerCase() === catName.toLowerCase())) {
      alert(`Category '${catName}' already exists!`);
      return;
    }
    try {
      await invoke<number>("add_category", { uid: userUid, name: catName });
      setStatusMsg(`✅ Category '${catName}' added`);
      refreshExpenseData();
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
    if (allVendors.some(v => v.name.toLowerCase() === vName.toLowerCase())) {
      alert(`Vendor '${vName}' already exists!`);
      return;
    }
    try {
      await invoke("add_vendor", { uid: userUid, name: vName });
      setStatusMsg(`✅ Vendor '${vName}' added`);
      refreshExpenseData();
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
        category_name: expCategory,
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
        category_name: expCategory,
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
    return record.vendor.toLowerCase().includes(term) || record.account.toLowerCase().includes(term);
  });

  const filteredSubscriptions = Object.entries(subscriptionsMap).filter(([_, record]) => {
    const term = subSearch.toLowerCase();
    return record.name.toLowerCase().includes(term) || record.account.toLowerCase().includes(term);
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
                  </tr>
                ))}
                {filteredPasswords.length === 0 && (
                  <tr>
                    <td colSpan={3} style={{ textAlign: "center", color: "var(--text-muted)" }}>
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
            <span className="search-hint" style={{ marginRight: "auto" }}>(search by name or account)</span>
            <button className="btn-primary" onClick={openAddSubModal}>➕ Add Subscription</button>
          </div>

          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Service</th>
                  <th>Account</th>
                  <th>Amount</th>
                  <th>Due Date</th>
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

              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th onClick={() => sortExpenses("v")}>Vendor</th>
                      <th onClick={() => sortExpenses("a")}>Amount</th>
                      <th onClick={() => sortExpenses("d")}>Date</th>
                      <th onClick={() => sortExpenses("m")}>Memo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {expenses.map((exp) => (
                      <tr
                        key={exp.localId}
                        className={selectedExpense?.localId === exp.localId ? "selected" : ""}
                        onClick={() => handleExpenseSelect(exp)}
                        style={{ cursor: "pointer" }}
                      >
                        <td>{exp.vendorName || "Uncategorized"}</td>
                        <td>
                          {exp.amount.startsWith("$")
                            ? exp.amount
                            : `$${parseFloat(exp.amount).toFixed(2)}`}
                        </td>
                        <td>{exp.date}</td>
                        <td>{exp.memo}</td>
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
                  <input
                    type="text"
                    className="input-field"
                    value={subDueDate}
                    onChange={(e) => setSubDueDate(e.target.value)}
                  />
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
                <div className="form-group suggestions-container">
                  <label>Vendor:</label>
                  <input
                    type="text"
                    className="input-field"
                    value={expVendor}
                    onChange={(e) => handleVendorInputChange(e.target.value)}
                    onFocus={() => expVendor && setShowVendorSug(true)}
                    onBlur={() => setTimeout(() => setShowVendorSug(false), 200)}
                  />
                  {showVendorSug && (
                    <div className="suggestions-list">
                      {vendorSuggestions.map((sug) => (
                        <div
                          key={sug}
                          className="suggestion-item"
                          onMouseDown={() => {
                            setExpVendor(sug);
                            setShowVendorSug(false);
                            autoFillCategoryForVendor(sug);
                          }}
                        >
                          {sug}
                        </div>
                      ))}
                    </div>
                  )}
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
                      type="date"
                      className="input-field"
                      value={expDate}
                      onChange={(e) => setExpDate(e.target.value)}
                    />
                    <button onClick={() => setExpDate(new Date().toISOString().split("T")[0])}>Today</button>
                  </div>
                </div>

                <div className="form-group suggestions-container">
                  <label>Category:</label>
                  <input
                    type="text"
                    className="input-field"
                    value={expCategory}
                    onChange={(e) => handleCategoryInputChange(e.target.value)}
                    onFocus={() => expCategory && setShowCategorySug(true)}
                    onBlur={() => setTimeout(() => setShowCategorySug(false), 200)}
                  />
                  {showCategorySug && (
                    <div className="suggestions-list">
                      {categorySuggestions.map((sug) => (
                        <div
                          key={sug}
                          className="suggestion-item"
                          onMouseDown={() => {
                            setExpCategory(sug);
                            setShowCategorySug(false);
                          }}
                        >
                          {sug}
                        </div>
                      ))}
                    </div>
                  )}
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
