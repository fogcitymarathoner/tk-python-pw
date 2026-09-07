import { expect, test } from "@playwright/test";
import { gotoApp } from "./helpers/gotoApp";

test("loads the expenses workspace and switches tabs", async ({ page }) => {
  await gotoApp(page);
  await expect(page.locator(".col-categories .list-item.selected")).toContainText("All Expenses");
  await expect(page.getByRole("button", { name: /Cloud Sync/ })).toBeVisible();
  await expect(page.getByText("$42.50")).toBeVisible();

  await page.getByRole("combobox").selectOption("user-2");
  await expect(page.getByText(/Loaded user: user-2|Synced 3 items/)).toBeVisible();

  await page.getByRole("button", { name: /Reload/ }).click();
  await page.getByRole("button", { name: /Cloud Sync/ }).click();
  await expect(page.getByText("Synced 3 items")).toBeVisible();

  await page.getByRole("button", { name: /Passwords/ }).click();
  await expect(page.getByPlaceholder("Search passwords...")).toBeVisible();
  await expect(page.getByText("GitHub")).toBeVisible();

  await page.getByRole("button", { name: /Subscriptions/ }).click();
  await expect(page.getByPlaceholder("Search subscriptions...")).toBeVisible();
  await expect(page.getByText("Netflix")).toBeVisible();

  await page.getByRole("button", { name: /Expenses/ }).click();
  await expect(page.getByText("📁 Food")).toBeVisible();
});

test("shows offline mode when firebase is unavailable", async ({ page }) => {
  await gotoApp(page, { online: false, defaultUid: "local-user", users: ["local-user"] });
  await expect(page.getByText("🔌 OFFLINE MODE")).toBeVisible();
  await expect(page.getByText("Offline Mode - SQLite only")).toBeVisible();
});

test("reports a failed cloud sync in the status bar", async ({ page }) => {
  await gotoApp(page, {
    online: true,
    defaultUid: "user-1",
    users: ["user-1"],
    fail: { sync_all: "timeout" },
  });
  await page.getByRole("button", { name: /Cloud Sync/ }).click();
  await expect(page.getByText("❌ Sync failed: timeout")).toBeVisible();
});
