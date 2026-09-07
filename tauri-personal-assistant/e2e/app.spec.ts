import { expect, test } from "@playwright/test";
import { card, gotoApp } from "./helpers/gotoApp";
import { defaultE2eSeed } from "./helpers/tauriMock";

test("renders the launcher and all app cards", async ({ page }) => {
  await gotoApp(page);
  await expect(page.getByText("Launch and monitor local apps")).toBeVisible();
  await expect(card(page, "Wiki")).toBeVisible();
  await expect(card(page, "Personal Data App")).toBeVisible();
  await expect(card(page, "Gmail Filter Editor")).toBeVisible();
  await expect(card(page, "Wiki").getByText("Stopped")).toBeVisible();
  await expect(card(page, "Wiki").getByText("Opens at http://localhost:8899")).toBeVisible();
  await expect(card(page, "Wiki").getByRole("button", { name: "Rebuild" })).toBeHidden();
  await expect(card(page, "Personal Data App").getByRole("button", { name: "Rebuild" })).toBeVisible();
});

test("starts and stops the wiki and opens its url", async ({ page }) => {
  await gotoApp(page);
  const wiki = card(page, "Wiki");
  await wiki.getByRole("button", { name: "Start" }).click();
  await expect(wiki.getByText("Running")).toBeVisible();
  await expect(wiki.getByRole("button", { name: "Start" })).toBeDisabled();
  await expect(wiki.getByRole("link", { name: "http://localhost:8899" })).toBeVisible();
  await expect(wiki.locator(".log-accordion")).toHaveAttribute("open");

  await wiki.getByRole("link", { name: "http://localhost:8899" }).click();
  await expect.poll(async () => page.evaluate(() => (window as unknown as { __TAURI_OPENED__: string[] }).__TAURI_OPENED__)).toEqual([
    "http://localhost:8899",
  ]);

  await wiki.getByRole("button", { name: "Stop" }).click();
  await expect(wiki.getByText("Stopped")).toBeVisible();
  await expect(wiki.getByText("Opens at http://localhost:8899")).toBeVisible();
});

test("rebuilds an app and shows logs", async ({ page }) => {
  await gotoApp(page);
  const personal = card(page, "Personal Data App");
  await personal.getByRole("button", { name: "Rebuild" }).click();
  await expect(personal.locator(".status-badge")).toHaveText("Rebuilding");
  await expect(personal.getByRole("button", { name: "Rebuilding..." })).toBeDisabled();
  await expect(personal.getByText("cargo build started")).toBeVisible();
});

test("toggles the log accordion and shows empty logs", async ({ page }) => {
  await gotoApp(page);
  const personal = card(page, "Personal Data App");
  await personal.getByText("Logs").click();
  await expect(personal.getByText("(empty)").first()).toBeVisible();
  await personal.getByText("Logs").click();
  await expect(personal.locator(".log-accordion")).not.toHaveAttribute("open");
});

test("creates a zip backup and reports a failure", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("button", { name: "Backup" }).click();
  await expect(page.getByText(/Backup saved to/)).toBeVisible();
  await expect(page.getByText(/repo.zip/)).toBeVisible();
});

test("shows a backup error", async ({ page }) => {
  await gotoApp(page, { ...defaultE2eSeed, fail: { backup_repo: "disk full" } });
  await page.getByRole("button", { name: "Backup" }).click();
  await expect(page.getByText("disk full")).toBeVisible();
  await expect(page.locator("#backup-status")).toHaveClass(/error/);
});

test("shows start errors on the card", async ({ page }) => {
  await gotoApp(page, { ...defaultE2eSeed, fail: { start_app: "already running" } });
  await card(page, "Wiki").getByRole("button", { name: "Start" }).click();
  await expect(page.getByText("already running")).toBeVisible();
});
