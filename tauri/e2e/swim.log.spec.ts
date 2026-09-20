import { expect, test } from "@playwright/test";
import { openSwim } from "./helpers/swimSeed";

test.describe("Swim log", () => {
  test("lists sessions and filters them", async ({ page }) => {
    await openSwim(page);
    await expect(page.getByLabel("Overall totals")).toContainText("14,000");
    await expect(page.getByRole("cell", { name: "6/4/2025" })).toBeVisible();

    await page.getByPlaceholder("Filter date, note, workout…").fill("Workout 4");
    await expect(page.getByRole("cell", { name: "6/24/2025" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "6/4/2025" })).toHaveCount(0);
  });

  test("adds a session and cancel closes the editor", async ({ page }) => {
    await openSwim(page);
    await page.getByRole("button", { name: "Add session" }).click();
    await expect(page.getByText("New session")).toBeVisible();

    await page.getByLabel("Note").fill("Easy swim");
    await page.getByLabel("Meters").fill("1800");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Session saved.")).toBeVisible();
    await expect(page.getByRole("cell", { name: "Easy swim" })).toBeVisible();
    await expect(page.getByLabel("Overall totals")).toContainText("15,800");

    await page.getByRole("button", { name: "Add session" }).click();
    await expect(page.getByText("New session")).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByText("Select a session to edit, or add one.")).toBeVisible();
  });
});
