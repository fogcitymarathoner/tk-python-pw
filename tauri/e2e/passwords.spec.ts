import { expect, test } from "@playwright/test";
import { acceptNextDialog, dismissNextDialog, formControl, gotoApp } from "./helpers/gotoApp";
import { defaultE2eSeed } from "./helpers/tauriMock";

test.describe("passwords", () => {
  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
    await page.getByRole("button", { name: /Passwords/ }).click();
  });

  test("searches and sorts the password list", async ({ page }) => {
    await expect(page.getByText("GitHub")).toBeVisible();
    await expect(page.getByText("Adobe")).toBeVisible();
    await page.getByPlaceholder("Search passwords...").fill("git");
    await expect(page.getByText("GitHub")).toBeVisible();
    await expect(page.getByText("Adobe")).toBeHidden();
    await page.getByRole("button", { name: "Clear" }).click();
    await expect(page.getByText("Adobe")).toBeVisible();
    await page.getByRole("columnheader", { name: /Vendor/ }).click();
    await expect(page.getByLabel("Sort by vendor")).toHaveText("▼");
  });

  test("adds a generated password", async ({ page }) => {
    await page.getByRole("button", { name: /Add Password/ }).click();
    await acceptNextDialog(page);
    await page.getByRole("button", { name: /^➕ Add$/ }).click();

    const modal = page.locator(".modal-content");
    await formControl(modal, "Vendor:").fill("Bank");
    await formControl(modal, "Account:").fill("checking");
    await modal.getByLabel("14").check();
    await modal.getByRole("button", { name: /Generate/ }).click();
    await expect(formControl(modal, "Password:")).toHaveValue(/^\S{14}$/);
    await formControl(modal, "Memo:").fill("vault");
    await modal.getByRole("button", { name: /Copy/ }).click();
    await modal.getByRole("button", { name: /^➕ Add$/ }).click();
    await expect(page.getByText("✅ Password added")).toBeVisible();
    await expect(page.getByText("Bank")).toBeVisible();
  });

  test("edits and deletes a password", async ({ page }) => {
    await page.getByText("GitHub").click();
    await expect(page.getByText("🔑 Edit Password")).toBeVisible();
    await formControl(page, "Vendor:").fill("GitLab");
    await page.getByRole("button", { name: /Update/ }).click();
    await expect(page.getByText("✅ Password updated")).toBeVisible();
    await expect(page.getByText("GitLab")).toBeVisible();

    await page.getByText("GitLab").click();
    await dismissNextDialog(page);
    await page.getByRole("button", { name: /Delete/ }).click();
    await expect(page.getByText("🔑 Edit Password")).toBeVisible();

    await acceptNextDialog(page);
    await page.getByRole("button", { name: /Delete/ }).click();
    await expect(page.getByText("🗑️ Password deleted")).toBeVisible();
    await expect(page.getByText("GitLab")).toHaveCount(0);
  });

  test("cancels the add modal", async ({ page }) => {
    await page.getByRole("button", { name: /Add Password/ }).click();
    await page.getByRole("button", { name: "✖ Cancel" }).click();
    await expect(page.getByText("🔑 Add Password")).toHaveCount(0);
  });
});

test("shows an empty password list", async ({ page }) => {
  await gotoApp(page, { ...defaultE2eSeed, passwords: {} });
  await page.getByRole("button", { name: /Passwords/ }).click();
  await expect(page.getByText("No passwords found")).toBeVisible();
});
