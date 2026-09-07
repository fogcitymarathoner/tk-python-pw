import { expect, type Page } from "@playwright/test";
import { defaultE2eSeed, installTauriMock, type TauriSeed } from "./tauriMock";

export async function gotoApp(page: Page, seed: TauriSeed = defaultE2eSeed) {
  await page.addInitScript((value) => {
    (window as unknown as { __TAURI_MOCK_SEED__: TauriSeed }).__TAURI_MOCK_SEED__ = value;
  }, seed);
  await page.addInitScript(installTauriMock);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Personal Assistant" })).toBeVisible();
}

export function card(page: Page, name: string) {
  return page.locator(".app-card").filter({ hasText: name });
}
