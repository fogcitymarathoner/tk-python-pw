export interface Category {
  id: number;
  remoteId: string | null;
  name: string;
  userId: string;
}

export interface Vendor {
  id: number;
  remoteId: string | null;
  name: string;
  userId: string;
}

export interface Expense {
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

export interface PasswordRecord {
  vendor: string;
  account: string;
  pw: string;
  memo?: string;
}

export type SubscriptionPeriod = "monthly" | "annual" | "every_two_months";

export interface SubscriptionRecord {
  name: string;
  account: string;
  amount: string;
  dueDate: string;
  memo: string;
  period?: SubscriptionPeriod;
  status?: "active" | "inactive";
}

export type SubStatusFilter = "active" | "inactive" | "all";
export type ExpenseSortCol = "d" | "v" | "a" | "m";
