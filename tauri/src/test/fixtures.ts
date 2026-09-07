import type {
  Category,
  Expense,
  PasswordRecord,
  SubscriptionRecord,
  Vendor,
} from "../types";

export const food: Category = { id: 1, remoteId: "c1", name: "Food", userId: "user-1" };
export const travel: Category = { id: 2, remoteId: null, name: "Travel", userId: "user-1" };

export const costco: Vendor = { id: 1, remoteId: "v1", name: "Costco", userId: "user-1" };
export const uber: Vendor = { id: 2, remoteId: null, name: "Uber", userId: "user-1" };

export const groceryExpense: Expense = {
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
};

export const uberExpense: Expense = {
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
};

export const samplePasswords: Record<string, PasswordRecord> = {
  p1: { vendor: "GitHub", account: "marc", pw: "secret1", memo: "work" },
  p2: { vendor: "Adobe", account: "design", pw: "secret2" },
};

export const sampleSubscriptions: Record<string, SubscriptionRecord> = {
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
  s3: {
    name: "Domain",
    account: "admin",
    amount: "$20",
    dueDate: "March 10th",
    memo: "dns",
    period: "annual",
    status: "active",
  },
};

export const defaultSeed = {
  online: true,
  defaultUid: "user-1",
  users: ["user-1", "user-2"],
  passwords: samplePasswords,
  subscriptions: sampleSubscriptions,
  categories: [food, travel],
  vendors: [costco, uber],
  expenses: [groceryExpense, uberExpense],
};
