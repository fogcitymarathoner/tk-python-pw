import { expect, type Page } from "@playwright/test";
import { installTauriMock, SAMPLE_XML, type TauriSeed } from "./tauriMock";

export async function gotoApp(page: Page, seed: TauriSeed = {}) {
  await page.addInitScript((value) => {
    (window as unknown as { __TAURI_MOCK_SEED__: TauriSeed }).__TAURI_MOCK_SEED__ = value;
  }, { xml: SAMPLE_XML, ...seed });
  await page.addInitScript(installTauriMock);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Gmail Filters Editor" })).toBeVisible();
}
