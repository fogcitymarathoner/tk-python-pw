import { expect, type Locator, type Page } from "@playwright/test";
import { defaultE2eSeed, installTauriMock, type TauriSeed } from "./tauriMock";

export function formControl(root: Page | Locator, label: string) {
  return root.locator(".form-group").filter({ hasText: label }).locator("input, select").first();
}

export async function gotoApp(page: Page, seed: TauriSeed = defaultE2eSeed) {
  await page.addInitScript((value) => {
    (window as unknown as { __TAURI_MOCK_SEED__: TauriSeed }).__TAURI_MOCK_SEED__ = value;
  }, seed);
  await page.addInitScript(installTauriMock);
  await page.goto("/");
  await expect(page.getByText("Tauri Sync Pro v1.0.0")).toBeVisible();
}

export async function acceptNextDialog(page: Page, text?: string) {
  page.once("dialog", (dialog) => {
    void dialog.accept(text);
  });
}

export async function dismissNextDialog(page: Page) {
  page.once("dialog", (dialog) => {
    void dialog.dismiss();
  });
}
