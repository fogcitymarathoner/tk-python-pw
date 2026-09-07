export type TauriSeed = {
  online?: boolean;
  defaultUid?: string;
  users?: string[];
  passwords?: Record<string, { vendor: string; account: string; pw: string; memo?: string }>;
  subscriptions?: Record<
    string,
    {
      name: string;
      account: string;
      amount: string;
      dueDate: string;
      memo: string;
      period?: string;
      status?: string;
    }
  >;
  categories?: Array<{ id: number; remoteId: string | null; name: string; userId: string }>;
  vendors?: Array<{ id: number; remoteId: string | null; name: string; userId: string }>;
  expenses?: Array<{
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
  }>;
  fail?: Record<string, string>;
};

export const defaultE2eSeed: TauriSeed = {
  online: true,
  defaultUid: "user-1",
  users: ["user-1", "user-2"],
  passwords: {
    p1: { vendor: "GitHub", account: "marc", pw: "secret1", memo: "work" },
    p2: { vendor: "Adobe", account: "design", pw: "secret2", memo: "" },
  },
  subscriptions: {
    s1: {
      name: "Netflix",
      account: "marc@ex.com",
      amount: "$15",
      dueDate: "15th",
      memo: "family",
      period: "monthly",
      status: "active",
    },
    s2: {
      name: "Adobe",
      account: "work",
      amount: "$60",
      dueDate: "1st",
      memo: "tools",
      period: "monthly",
      status: "inactive",
    },
  },
  categories: [
    { id: 1, remoteId: "c1", name: "Food", userId: "user-1" },
    { id: 2, remoteId: null, name: "Travel", userId: "user-1" },
  ],
  vendors: [
    { id: 1, remoteId: "v1", name: "Costco", userId: "user-1" },
    { id: 2, remoteId: null, name: "Uber", userId: "user-1" },
  ],
  expenses: [
    {
      localId: 1,
      remoteId: "e1",
      vendorName: "Costco",
      vendorId: 1,
      categoryId: 1,
      categoryName: "Food",
      amount: "42.50",
      date: "2026-01-15",
      memo: "groceries",
      userId: "user-1",
    },
    {
      localId: 2,
      remoteId: null,
      vendorName: "Uber",
      vendorId: 2,
      categoryId: 2,
      categoryName: "Travel",
      amount: "$18.00",
      date: "2026-02-01",
      memo: "airport",
      userId: "user-1",
    },
  ],
};

export function installTauriMock() {
  const seed = (window as unknown as { __TAURI_MOCK_SEED__?: TauriSeed }).__TAURI_MOCK_SEED__ ?? {};
  const state = {
    online: seed.online !== false,
    defaultUid: seed.defaultUid || "user-1",
    users: seed.users ? [...seed.users] : ["user-1"],
    passwords: { ...(seed.passwords ?? {}) },
    subscriptions: { ...(seed.subscriptions ?? {}) },
    categories: [...(seed.categories ?? [])],
    vendors: [...(seed.vendors ?? [])],
    expenses: [...(seed.expenses ?? [])],
    fail: { ...(seed.fail ?? {}) },
    nextId: 200,
  };

  const findOrCreate = (
    list: Array<{ id: number; remoteId: string | null; name: string; userId: string }>,
    uid: string,
    name: string,
  ) => {
    const existing = list.find((item) => item.name.toLowerCase() === name.toLowerCase());
    if (existing) return existing;
    const created = { id: state.nextId++, remoteId: null, name, userId: uid };
    list.push(created);
    return created;
  };

  const internals = {
    invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
      if (state.fail[cmd]) throw state.fail[cmd];
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
        case "update_password":
          state.passwords[String(args.id)] = {
            vendor: String(args.vendor ?? ""),
            account: String(args.account ?? ""),
            pw: String(args.pw ?? ""),
            memo: String(args.memo ?? ""),
          };
          return;
        case "delete_password":
          delete state.passwords[String(args.id)];
          return;
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
            period: String(args.period ?? "monthly"),
            status: String(args.status ?? "active"),
          };
          return id;
        }
        case "update_subscription":
          state.subscriptions[String(args.id)] = {
            name: String(args.name ?? ""),
            account: String(args.account ?? ""),
            amount: String(args.amount ?? ""),
            dueDate: String(args.dueDate ?? ""),
            memo: String(args.memo ?? ""),
            period: String(args.period ?? "monthly"),
            status: String(args.status ?? "active"),
          };
          return;
        case "delete_subscription":
          delete state.subscriptions[String(args.id)];
          return;
        case "get_categories":
          return [...state.categories];
        case "get_vendors":
          return [...state.vendors];
        case "get_vendors_by_category":
          return state.vendors.filter((vendor) =>
            state.expenses.some((e) => e.categoryId === args.categoryId && e.vendorId === vendor.id),
          );
        case "get_expenses_with_categories":
          return [...state.expenses];
        case "get_expenses_by_category_and_vendor":
          return state.expenses.filter((e) => {
            if (e.categoryId !== args.categoryId) return false;
            if (args.vendorId != null && e.vendorId !== args.vendorId) return false;
            return true;
          });
        case "add_category":
          return findOrCreate(state.categories, String(args.uid), String(args.name)).id;
        case "rename_category": {
          const cat = state.categories.find((c) => c.id === args.catId);
          if (cat) cat.name = String(args.name);
          return;
        }
        case "delete_category":
          state.categories = state.categories.filter((c) => c.id !== args.catId);
          return;
        case "add_vendor":
          return findOrCreate(state.vendors, String(args.uid), String(args.name)).id;
        case "rename_vendor": {
          const vendor = state.vendors.find((v) => v.id === args.vendorId);
          if (vendor) vendor.name = String(args.name);
          return;
        }
        case "delete_vendor":
          state.vendors = state.vendors.filter((v) => v.id !== args.vendorId);
          return;
        case "add_expense": {
          const cat = findOrCreate(state.categories, String(args.uid), String(args.categoryName));
          const vendor = findOrCreate(state.vendors, String(args.uid), String(args.vendorName));
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
          const cat = findOrCreate(state.categories, String(args.uid), String(args.categoryName));
          const vendor = findOrCreate(state.vendors, String(args.uid), String(args.vendorName));
          Object.assign(exp, {
            vendorName: vendor.name,
            vendorId: vendor.id,
            categoryId: cat.id,
            categoryName: cat.name,
            amount: String(args.amount ?? ""),
            date: String(args.date ?? ""),
            memo: args.memo == null ? null : String(args.memo),
          });
          return;
        }
        case "delete_expense":
          state.expenses = state.expenses.filter((e) => e.localId !== args.localId);
          return;
        default:
          throw new Error(`Unknown command: ${cmd}`);
      }
    },
  };

  (window as unknown as { __TAURI_INTERNALS__: typeof internals }).__TAURI_INTERNALS__ = internals;
}
