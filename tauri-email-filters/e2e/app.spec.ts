import { expect, test } from "@playwright/test";
import { gotoApp } from "./helpers/gotoApp";
import { SAMPLE_XML } from "./helpers/tauriMock";

test("loads native filters and shows the editor", async ({ page }) => {
  await gotoApp(page);
  await expect(page.locator(".status-badge")).toContainText("Natively loaded mailFilters.xml");
  await expect(page.getByText("From: alice@example.com")).toBeVisible();
  await expect(page.getByText("Desktop App")).toBeVisible();
  await expect(page.getByText("Filter Configuration")).toBeVisible();
  await expect(page.getByText("Active Filters:")).toContainText("2");
});

test("edits a filter, searches, and toggles compact sort", async ({ page }) => {
  await gotoApp(page);
  await page.getByPlaceholder("Sender address, domain, or query...").fill("team@corp.com");
  await expect(page.locator(".status-badge")).toContainText("Unsaved changes present");
  await expect(page.getByText("From: team@corp.com")).toBeVisible();

  await page.getByPlaceholder(/Search filters/).fill("invoice");
  await expect(page.getByText("From: team@corp.com")).toHaveCount(0);
  await expect(page.getByText("Subj: Invoice 2026")).toBeVisible();
  await page.getByTitle("Clear search").click();

  await page.getByRole("button", { name: /Compact Sort/ }).click();
  await expect(page.getByText("Filter Configuration")).toHaveCount(0);
  await page.getByRole("button", { name: /Edit Details/ }).click();
  await expect(page.getByText("Filter Configuration")).toBeVisible();
});

test("adds, duplicates, reorders, and deletes a filter", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("button", { name: /Add New Filter/ }).click();
  await expect(page.getByText("Active Filters:")).toContainText("3");

  await page.getByTitle("Duplicate Filter").first().click();
  await expect(page.getByText("Active Filters:")).toContainText("4");

  await page.getByTitle("Move Down").first().click();
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByTitle("Delete Filter").first().click();
  await expect(page.locator(".status-badge")).toContainText("Unsaved changes present");
});

test("saves changes, saves as, and copies a report", async ({ page }) => {
  await gotoApp(page);
  await page.getByRole("button", { name: /Save Changes/ }).click();
  await expect(page.locator(".status-badge")).toContainText("Successfully saved mailFilters.xml");
  await expect(page.getByText(/Written to mailFilters.xml/)).toBeVisible();

  await page.getByRole("button", { name: /Save As/ }).click();
  await expect(page.locator(".status-badge")).toContainText("Successfully saved as saved.xml");

  await page.getByRole("button", { name: /Copy Report/ }).click();
  await expect(page.locator(".status-badge")).toContainText("report copied to clipboard");
});

test("opens a custom file", async ({ page }) => {
  await gotoApp(page, { xml: SAMPLE_XML, selectPath: "C:\\\\data\\\\custom.xml" });
  await page.getByRole("button", { name: /Open File/ }).click();
  await expect(page.locator(".status-badge")).toContainText("Loaded custom.xml");
  await expect(page.getByText("📍 custom.xml")).toBeVisible();
});

test("shows a load error when the backend fails", async ({ page }) => {
  await gotoApp(page, { fail: { read_filters_file: "missing file" } });
  await expect(page.locator(".status-badge")).toContainText("Failed to load: missing file");
  await expect(page.getByText("No Active Filter Data Loaded")).toBeVisible();
});

test("cancels an open-file dialog without changing the loaded filters", async ({ page }) => {
  await gotoApp(page, { xml: SAMPLE_XML, selectPath: null });
  await page.getByRole("button", { name: /Open File/ }).click();
  await expect(page.locator(".status-badge")).toContainText("Natively loaded mailFilters.xml");
  await expect(page.getByText("From: alice@example.com")).toBeVisible();
});

test("shows web preview mode without a native backend", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Gmail Filters Editor" })).toBeVisible();
  await expect(page.locator(".status-badge")).toContainText("web preview mode");
  await expect(page.getByText("Web Browser")).toBeVisible();
  await expect(page.getByText("No Active Filter Data Loaded")).toBeVisible();
});
