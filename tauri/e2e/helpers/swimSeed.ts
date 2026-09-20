import { gotoApp } from "./gotoApp";
import { defaultE2eSeed, type TauriSeed } from "./tauriMock";
import { swimSeed } from "../../src/test/swimFixtures";
import type { Page } from "@playwright/test";

export const swimE2eSeed: TauriSeed = {
  ...defaultE2eSeed,
  ...swimSeed,
};

export async function openSwim(page: Page, seed: TauriSeed = swimE2eSeed) {
  await gotoApp(page, seed);
  await page.getByRole("button", { name: /Swim/ }).click();
  await page.getByRole("button", { name: "Add session" }).waitFor();
}
