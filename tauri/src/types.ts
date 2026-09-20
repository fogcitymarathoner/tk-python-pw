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

export type SwimWorkout = {
  id: number;
  remoteId: string | null;
  name: string;
  note: string;
  setCount: number;
  userId: string;
};

export type SwimWorkoutSet = {
  id: number;
  remoteId: string | null;
  workoutId: number;
  distance: string;
  description: string;
  splitTotal: string;
  equipment: string;
  fins: string;
  sortOrder: number;
};

export type SwimSession = {
  id: number;
  remoteId: string | null;
  date: string;
  meters: string;
  miles: string;
  stroke: string;
  note: string;
  extra: string;
  workoutId: number | null;
  workoutName: string | null;
  userId: string;
};

export type SwimEditorMode = "line" | "workout";

export type SwimDraft = {
  id: number | null;
  remoteId: string | null;
  date: string;
  meters: string;
  miles: string;
  stroke: string;
  note: string;
  extra: string;
  workoutId: number | null;
  mode: SwimEditorMode;
};
