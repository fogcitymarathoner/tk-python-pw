import type { Category, Expense, PasswordRecord, SubscriptionRecord, Vendor } from "../types";
import { defaultSeed } from "./fixtures";

export interface BackendSeed {
  online?: boolean;
  defaultUid?: string;
  users?: string[];
  passwords?: Record<string, PasswordRecord>;
  subscriptions?: Record<string, SubscriptionRecord>;
  categories?: Category[];
  vendors?: Vendor[];
  expenses?: Expense[];
  fail?: Record<string, string>;
  nextId?: number;
}

export interface BackendState {
  online: boolean;
  defaultUid: string;
  users: string[];
  passwords: Record<string, PasswordRecord>;
  subscriptions: Record<string, SubscriptionRecord>;
  categories: Category[];
  vendors: Vendor[];
  expenses: Expense[];
  fail: Record<string, string>;
  nextId: number;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

export function createBackend(seed: BackendSeed = {}) {
  const state: BackendState = {
    online: seed.online ?? defaultSeed.online,
    defaultUid: seed.defaultUid ?? defaultSeed.defaultUid,
    users: clone(seed.users ?? defaultSeed.users),
    passwords: clone(seed.passwords ?? defaultSeed.passwords),
    subscriptions: clone(seed.subscriptions ?? defaultSeed.subscriptions),
    categories: clone(seed.categories ?? defaultSeed.categories),
    vendors: clone(seed.vendors ?? defaultSeed.vendors),
    expenses: clone(seed.expenses ?? defaultSeed.expenses),
    fail: { ...(seed.fail ?? {}) },
    nextId: seed.nextId ?? 100,
  };

  const findOrCreateCategory = (uid: string, name: string): Category => {
    const existing = state.categories.find(
      (c) => c.name.toLowerCase() === name.toLowerCase(),
    );
    if (existing) return existing;
    const created: Category = { id: state.nextId++, remoteId: null, name, userId: uid };
    state.categories.push(created);
    return created;
  };

  const findOrCreateVendor = (uid: string, name: string): Vendor => {
    const existing = state.vendors.find((v) => v.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing;
    const created: Vendor = { id: state.nextId++, remoteId: null, name, userId: uid };
    state.vendors.push(created);
    return created;
  };

  const sortExpenses = (rows: Expense[], ascending: boolean) =>
    [...rows].sort((a, b) => {
      const da = new Date(a.date).getTime();
      const db = new Date(b.date).getTime();
      return ascending ? da - db : db - da;
    });

  const impl = async (cmd: string, args: Record<string, unknown> = {}) => {
    if (state.fail[cmd]) {
      throw state.fail[cmd];
    }

    switch (cmd) {
      case "is_firebase_available":
        return state.online;
      case "get_default_uid":
        return state.defaultUid;
      case "get_users":
        return state.users;
      case "sync_all":
        return "Synced 3 items";
      case "load_passwords":
        return { ...state.passwords };
      case "add_password": {
        const id = `pw-${state.nextId++}`;
        state.passwords[id] = {
          vendor: String(args.vendor ?? ""),
          account: String(args.account ?? ""),
          pw: String(args.pw ?? ""),
          memo: String(args.memo ?? ""),
        };
        return id;
      }
      case "update_password": {
        const id = String(args.id);
        state.passwords[id] = {
          vendor: String(args.vendor ?? ""),
          account: String(args.account ?? ""),
          pw: String(args.pw ?? ""),
          memo: String(args.memo ?? ""),
        };
        return;
      }
      case "delete_password": {
        delete state.passwords[String(args.id)];
        return;
      }
      case "load_subscriptions":
        return { ...state.subscriptions };
      case "add_subscription": {
        const id = `sub-${state.nextId++}`;
        state.subscriptions[id] = {
          name: String(args.name ?? ""),
          account: String(args.account ?? ""),
          amount: String(args.amount ?? ""),
          dueDate: String(args.dueDate ?? ""),
          memo: String(args.memo ?? ""),
          period: (args.period as SubscriptionRecord["period"]) || "monthly",
          status: (args.status as SubscriptionRecord["status"]) || "active",
        };
        return id;
      }
      case "update_subscription": {
        const id = String(args.id);
        state.subscriptions[id] = {
          name: String(args.name ?? ""),
          account: String(args.account ?? ""),
          amount: String(args.amount ?? ""),
          dueDate: String(args.dueDate ?? ""),
          memo: String(args.memo ?? ""),
          period: (args.period as SubscriptionRecord["period"]) || "monthly",
          status: (args.status as SubscriptionRecord["status"]) || "active",
        };
        return;
      }
      case "delete_subscription": {
        delete state.subscriptions[String(args.id)];
        return;
      }
      case "get_categories":
        return [...state.categories];
      case "get_vendors":
        return [...state.vendors];
      case "get_vendors_by_category": {
        const vendorIds = new Set(
          state.expenses
            .filter((e) => e.categoryId === args.categoryId)
            .map((e) => e.vendorId)
            .filter((id): id is number => id != null),
        );
        return state.vendors.filter((v) => vendorIds.has(v.id));
      }
      case "get_expenses_with_categories":
        return sortExpenses(state.expenses, Boolean(args.ascending));
      case "get_expenses_by_category_and_vendor": {
        const rows = state.expenses.filter((e) => {
          if (e.categoryId !== args.categoryId) return false;
          if (args.vendorId != null && e.vendorId !== args.vendorId) return false;
          return true;
        });
        return sortExpenses(rows, Boolean(args.ascending));
      }
      case "add_category": {
        const created = findOrCreateCategory(String(args.uid), String(args.name));
        return created.id;
      }
      case "rename_category": {
        const cat = state.categories.find((c) => c.id === args.catId);
        if (cat) cat.name = String(args.name);
        return;
      }
      case "delete_category": {
        state.categories = state.categories.filter((c) => c.id !== args.catId);
        return;
      }
      case "add_vendor": {
        const created = findOrCreateVendor(String(args.uid), String(args.name));
        return created.id;
      }
      case "rename_vendor": {
        const vendor = state.vendors.find((v) => v.id === args.vendorId);
        if (vendor) vendor.name = String(args.name);
        return;
      }
      case "delete_vendor": {
        state.vendors = state.vendors.filter((v) => v.id !== args.vendorId);
        return;
      }
      case "add_expense": {
        const cat = findOrCreateCategory(String(args.uid), String(args.categoryName));
        const vendor = findOrCreateVendor(String(args.uid), String(args.vendorName));
        state.expenses.push({
          localId: state.nextId++,
          remoteId: null,
          vendorName: vendor.name,
          vendorId: vendor.id,
          categoryId: cat.id,
          categoryName: cat.name,
          amount: String(args.amount ?? ""),
          date: String(args.date ?? ""),
          memo: args.memo == null ? null : String(args.memo),
          userId: String(args.uid),
        });
        return;
      }
      case "update_expense": {
        const exp = state.expenses.find((e) => e.localId === args.localId);
        if (!exp) return;
        const cat = findOrCreateCategory(String(args.uid), String(args.categoryName));
        const vendor = findOrCreateVendor(String(args.uid), String(args.vendorName));
        exp.vendorName = vendor.name;
        exp.vendorId = vendor.id;
        exp.categoryId = cat.id;
        exp.categoryName = cat.name;
        exp.amount = String(args.amount ?? "");
        exp.date = String(args.date ?? "");
        exp.memo = args.memo == null ? null : String(args.memo);
        return;
      }
      case "delete_expense": {
        state.expenses = state.expenses.filter((e) => e.localId !== args.localId);
        return;
      }
      default:
        throw new Error(`Unknown command: ${cmd}`);
    }
  };

  return { state, impl };
}
