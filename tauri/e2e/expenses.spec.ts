import { expect, test } from "@playwright/test";
import { acceptNextDialog, dismissNextDialog, formControl, gotoApp } from "./helpers/gotoApp";

test.describe("expenses", () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
  });

  test("filters the expense table and resets", async ({ page }) => {
    await expect(page.getByText("$42.50")).toBeVisible();
    await expect(page.getByText("$18.00")).toBeVisible();
    await page.getByText("📁 Food").click();
    await expect(page.getByText("📂 Food")).toBeVisible();
    await page.getByText("👤 Costco").click();
    await expect(page.getByText(/→ 👤 Costco/)).toBeVisible();
    await page.getByRole("button", { name: /Reset Filters/ }).click();
    await expect(page.locator(".col-categories .list-item.selected")).toContainText("All Expenses");
    await page.getByRole("button", { name: /Oldest First/ }).click();
    await expect(page.getByRole("button", { name: /Newest First/ })).toBeVisible();
    await page.getByRole("columnheader", { name: "Vendor" }).click();
  });

  test("adds, updates, and deletes an expense", async ({ page }) => {
    await page.getByRole("button", { name: /Add Expense/ }).click();
    await acceptNextDialog(page);
    const modal = page.locator(".modal-content");
    await modal.getByRole("button", { name: /Add Expense/ }).click();
    await formControl(modal, "Vendor:").selectOption("Uber");
    await formControl(modal, "Amount:").fill("33.10");
    await formControl(modal, "Category:").selectOption("Travel");
    await formControl(modal, "Memo:").fill("ride");
    await modal.getByRole("button", { name: "Today" }).click();
    await modal.getByRole("button", { name: /Add Expense/ }).click();
    await expect(page.getByText("✅ Expense added successfully")).toBeVisible();
    await expect(page.getByText("$33.10")).toBeVisible();

    await page.locator(".col-categories").getByText("All Expenses").click();
    await page.getByRole("cell", { name: "Costco" }).click();
    await formControl(page, "Amount:").fill("50");
    await page.getByRole("button", { name: /Update/ }).click();
    await expect(page.getByText("✅ Expense updated")).toBeVisible();

    await page.getByRole("cell", { name: "Costco" }).click();
    await dismissNextDialog(page);
    await page.locator(".modal-content").getByRole("button", { name: /Delete/ }).click();
    await expect(page.getByText("💰 Edit Expense")).toBeVisible();
    await acceptNextDialog(page);
    await page.locator(".modal-content").getByRole("button", { name: /Delete/ }).click();
    await expect(page.getByText("🗑️ Expense deleted")).toBeVisible();
  });

  test("creates and removes categories and vendors", async ({ page }) => {
    const categoryPanel = page.locator(".col-categories");
    await acceptNextDialog(page, "Health");
    await categoryPanel.getByRole("button", { name: /Add/ }).click();
    await expect(page.getByText("✅ Category 'Health' added")).toBeVisible();
    await expect(page.getByText("📁 Health")).toBeVisible();

    await page.getByText("📁 Health").click();
    await acceptNextDialog(page, "Medical");
    await categoryPanel.getByRole("button", { name: /Rename/ }).click();
    await expect(page.getByText("✅ Category renamed to 'Medical'")).toBeVisible();

    await page.getByText("📁 Food").click();
    await acceptNextDialog(page);
    await categoryPanel.getByRole("button", { name: /Delete/ }).click();
    await expect(page.getByText(/Category 'Food' deleted/)).toBeVisible();

    const vendorPanel = page.locator(".col-vendors");
    await acceptNextDialog(page, "Amazon");
    await vendorPanel.getByRole("button", { name: /Add/ }).click();
    await expect(page.getByText("✅ Vendor 'Amazon' added")).toBeVisible();
    await page.getByText("👤 Amazon").click();
    await acceptNextDialog(page, "AWS");
    await vendorPanel.getByRole("button", { name: /Rename/ }).click();
    await expect(page.getByText("✅ Vendor renamed to 'AWS'")).toBeVisible();
    await page.getByText("👤 Uber").click();
    await acceptNextDialog(page);
    await vendorPanel.getByRole("button", { name: /Delete/ }).click();
    await expect(page.getByText(/Vendor 'Uber' deleted/)).toBeVisible();
  });

  test("selects an existing category instead of duplicating it", async ({ page }) => {
    await acceptNextDialog(page, "Food");
    await page.locator(".col-categories").getByRole("button", { name: /Add/ }).click();
    await expect(page.getByText(/Category 'Food' already exists/)).toBeVisible();
  });
});
