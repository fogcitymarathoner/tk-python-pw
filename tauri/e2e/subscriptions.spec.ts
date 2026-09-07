import { expect, test } from "@playwright/test";
import { acceptNextDialog, dismissNextDialog, formControl, gotoApp } from "./helpers/gotoApp";

test.describe("subscriptions", () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
    await page.getByRole("button", { name: /Subscriptions/ }).click();
  });

  test("filters by status and search", async ({ page }) => {
    const list = page.locator(".tab-panel.active");
    await expect(list.getByRole("cell", { name: "Netflix" })).toBeVisible();
    await expect(list.getByRole("cell", { name: "Adobe" })).toHaveCount(0);
    await page.getByRole("button", { name: /Inactive/ }).click();
    await expect(list.getByRole("cell", { name: "Adobe" })).toBeVisible();
    await page.getByRole("button", { name: /All/ }).click();
    await page.getByPlaceholder("Search subscriptions...").fill("net");
    await expect(list.getByRole("cell", { name: "Netflix" })).toBeVisible();
    await expect(list.getByRole("cell", { name: "Adobe" })).toHaveCount(0);
    await page.getByRole("button", { name: "Clear" }).click();
    await page.getByRole("columnheader", { name: /Due Date/ }).click();
  });

  test("adds a monthly subscription and an annual one", async ({ page }) => {
    await page.getByRole("button", { name: /Add Subscription/ }).click();
    await acceptNextDialog(page);
    await page.getByRole("button", { name: /^➕ Add$/ }).click();

    const modal = page.locator(".modal-content");
    await formControl(modal, "Service:").fill("Spotify");
    await formControl(modal, "Account:").fill("music");
    await formControl(modal, "Amount:").fill("$10");
    await formControl(modal, "Due Date:").selectOption("15th");
    await modal.getByRole("button", { name: /^➕ Add$/ }).click();
    await expect(page.getByText("✅ Subscription 'Spotify' added")).toBeVisible();
    await expect(page.getByRole("cell", { name: "Spotify" })).toBeVisible();

    await page.getByRole("button", { name: /Add Subscription/ }).click();
    await formControl(page, "Service:").fill("Car Insurance");
    await formControl(page, "Period:").selectOption("annual");
    await formControl(page, "Due Month:").selectOption("June");
    await formControl(page, "Due Day:").selectOption("10th");
    await page.getByRole("button", { name: /^➕ Add$/ }).click();
    await expect(page.getByText("✅ Subscription 'Car Insurance' added")).toBeVisible();
  });

  test("edits, toggles, and deletes a subscription", async ({ page }) => {
    await page.getByText("Netflix").click();
    await formControl(page, "Service:").fill("Netflix Family");
    await formControl(page, "Status:").selectOption("inactive");
    await page.getByRole("button", { name: /Update/ }).click();
    await expect(page.getByText("✅ Subscription 'Netflix Family' updated")).toBeVisible();

    await page.getByRole("button", { name: /All/ }).click();
    await page.getByRole("row", { name: /Netflix Family/ }).locator(".status-badge").click();
    await expect(page.getByText(/status set to active/)).toBeVisible();

    await page.getByRole("cell", { name: "Netflix Family" }).click();
    await dismissNextDialog(page);
    await page.getByRole("button", { name: /Delete/ }).click();
    await expect(page.getByText("📋 Edit Subscription")).toBeVisible();
    await acceptNextDialog(page);
    await page.getByRole("button", { name: /Delete/ }).click();
    await expect(page.getByText(/Subscription 'Netflix Family' deleted/)).toBeVisible();
  });

  test("shows subscriptions on the calendar and expands a day", async ({ page }) => {
    await page.getByRole("button", { name: /Calendar/ }).click();
    await expect(page.getByText("TODAY", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "▶" }).click();
    await page.getByRole("button", { name: "◀" }).click();
    await page.getByRole("button", { name: "Today" }).click();
    await page.getByText("Netflix").click();
    await expect(page.getByText("📋 Edit Subscription")).toBeVisible();
    await page.getByRole("button", { name: "✖ Cancel" }).click();

    await page.getByRole("button", { name: /Calendar/ }).click();
    await page.locator(".calendar-day-cell").filter({ hasText: "Netflix" }).locator("span").first().click();
    await expect(page.locator(".calendar-day-modal")).toBeVisible();
    await page.getByRole("button", { name: "✕" }).click();
  });
});
