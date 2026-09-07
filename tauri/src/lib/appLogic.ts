import type {
  Expense,
  ExpenseSortCol,
  PasswordRecord,
  SubscriptionPeriod,
  SubscriptionRecord,
  SubStatusFilter,
} from "../types";

export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export const PERIOD_LABELS: Record<SubscriptionPeriod, string> = {
  monthly: "Monthly",
  annual: "Annual",
  every_two_months: "Every two months",
};

export const CALENDAR_DAY_PREVIEW_COUNT = 4;

export const PW_ALLOWED_CHARS =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789~@!#$%^&*()/:;?,.<>_-";

export function formatPeriod(period?: string): string {
  if (period && period in PERIOD_LABELS) {
    return PERIOD_LABELS[period as SubscriptionPeriod];
  }
  return PERIOD_LABELS.monthly;
}

export function periodUsesDueMonth(period?: string): boolean {
  return period === "annual" || period === "every_two_months";
}

export function parseDueMonthName(dueDate: string): string | undefined {
  return MONTHS.find((m) => dueDate.toLowerCase().includes(m.toLowerCase()));
}

export function monthMatchesPeriod(
  period: string | undefined,
  dueDate: string,
  calMonth: number,
): boolean {
  if (period === "annual") {
    const monthName = parseDueMonthName(dueDate);
    return monthName ? MONTHS[calMonth] === monthName : false;
  }
  if (period === "every_two_months") {
    const monthName = parseDueMonthName(dueDate);
    const anchor = monthName ? MONTHS.indexOf(monthName) : 0;
    return ((calMonth - anchor) % 2 + 2) % 2 === 0;
  }
  return true;
}

export function getOrdinalDay(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function parseDueDateToNumber(dueDate: string): number {
  if (!dueDate) return 999;
  const clean = dueDate.trim();

  if (clean.includes("-") || clean.includes("/")) {
    const parsed = Date.parse(clean);
    if (!isNaN(parsed)) {
      return new Date(parsed).getDate();
    }
  }

  const match = clean.match(/\d+/);
  if (match) {
    return parseInt(match[0], 10);
  }
  return 999;
}

export function createPassword(
  length: number,
  random: () => number = Math.random,
): string {
  let generated = "";
  for (let i = 0; i < length; i++) {
    generated += PW_ALLOWED_CHARS.charAt(Math.floor(random() * PW_ALLOWED_CHARS.length));
  }
  return generated;
}

export function passwordMatchesSearch(record: PasswordRecord, term: string): boolean {
  const needle = term.toLowerCase();
  return (
    record.vendor.toLowerCase().includes(needle) ||
    record.account.toLowerCase().includes(needle) ||
    (record.memo || "").toLowerCase().includes(needle)
  );
}

export function filterAndSortPasswords(
  passwordsMap: Record<string, PasswordRecord>,
  pwSearch: string,
  pwSortAscending: boolean,
): [string, PasswordRecord][] {
  return Object.entries(passwordsMap)
    .filter(([, record]) => passwordMatchesSearch(record, pwSearch))
    .sort((a, b) => {
      const vendorA = a[1].vendor.toLowerCase();
      const vendorB = b[1].vendor.toLowerCase();
      if (vendorA < vendorB) return pwSortAscending ? -1 : 1;
      if (vendorA > vendorB) return pwSortAscending ? 1 : -1;
      return 0;
    });
}

export function filterAndSortSubscriptions(
  subscriptionsMap: Record<string, SubscriptionRecord>,
  subSearch: string,
  subStatusFilter: SubStatusFilter,
  subSortAscending: boolean,
): [string, SubscriptionRecord][] {
  return Object.entries(subscriptionsMap)
    .filter(([, record]) => {
      const term = subSearch.toLowerCase();
      const matchesSearch =
        record.name.toLowerCase().includes(term) ||
        record.account.toLowerCase().includes(term);
      if (!matchesSearch) return false;

      const recordStatus = record.status || "active";
      if (subStatusFilter !== "all" && recordStatus !== subStatusFilter) {
        return false;
      }
      return true;
    })
    .sort((a, b) => {
      const dayA = parseDueDateToNumber(a[1].dueDate);
      const dayB = parseDueDateToNumber(b[1].dueDate);
      if (dayA < dayB) return subSortAscending ? -1 : 1;
      if (dayA > dayB) return subSortAscending ? 1 : -1;
      return 0;
    });
}

export function getSubsForDay(
  dayNum: number,
  subscriptionsMap: Record<string, SubscriptionRecord>,
  calYear: number,
  calMonth: number,
  subStatusFilter: SubStatusFilter,
  subSearch: string,
): [string, SubscriptionRecord][] {
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();

  return Object.entries(subscriptionsMap)
    .filter(([, sub]) => {
      const subStatusValue = sub.status || "active";
      if (subStatusFilter !== "all" && subStatusValue !== subStatusFilter) {
        return false;
      }

      const term = subSearch.toLowerCase();
      if (term) {
        const matchesSearch =
          sub.name.toLowerCase().includes(term) ||
          sub.account.toLowerCase().includes(term);
        if (!matchesSearch) return false;
      }

      const clean = sub.dueDate.trim();

      if (clean.includes("-") || clean.includes("/")) {
        const parsed = Date.parse(clean);
        if (!isNaN(parsed)) {
          const d = new Date(parsed);
          return d.getDate() === dayNum && d.getMonth() === calMonth && d.getFullYear() === calYear;
        }
      }

      if (!monthMatchesPeriod(sub.period, clean, calMonth)) {
        return false;
      }

      const match = clean.match(/\d+/);
      if (match) {
        const subDay = parseInt(match[0], 10);
        if (subDay === dayNum && subDay <= daysInMonth) {
          return true;
        }
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
              name: `${sub.name}*`,
            },
          ];
        }
      }
      return [id, sub];
    });
}

export function sortExpenses(
  expenses: Expense[],
  col: ExpenseSortCol,
  sortAscending: boolean,
): Expense[] {
  return [...expenses].sort((a, b) => {
    let valA: string | number = "";
    let valB: string | number = "";

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
}

export function mostUsedCategoryForVendor(expenses: Expense[], vName: string): string {
  const usages: Record<string, number> = {};
  expenses.forEach((exp) => {
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
  return mostUsedCat;
}

export function clampPaneWidth(width: number, min = 150, max = 500): number {
  return Math.max(min, Math.min(max, width));
}
