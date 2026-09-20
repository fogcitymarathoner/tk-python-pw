import { expect, test } from "@playwright/test";
import { openSwim } from "./helpers/swimSeed";

test.describe("Swim workouts", () => {
  test("edits an existing workout and creates a new one", async ({ page }) => {
    await openSwim(page);
    await page.getByRole("button", { name: "Workouts" }).click();

    await page.getByRole("button", { name: "Workout 2, 3 sets" }).click();
    await expect(page.getByLabel("Name")).toHaveValue("Workout 2");
    await expect(page.locator(".set-row input").nth(1)).toHaveValue("kick with board, snorkel");
    await expect(page.getByLabel("Workout distance totals")).toContainText("500 m");

    await page.getByRole("button", { name: /\+ New workout/ }).click();
    await page.getByLabel("Name").fill("Threshold");
    await page.locator(".set-row input").nth(0).fill("200");
    await page.locator(".set-row input").nth(1).fill("free");
    await page.getByRole("button", { name: "Save workout" }).click();

    await expect(page.getByText("Workout saved.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Threshold, 1 sets" })).toBeVisible();
  });

  test("deletes a workout after confirm", async ({ page }) => {
    await openSwim(page);
    await page.getByRole("button", { name: "Workouts" }).click();
    await page.getByRole("button", { name: "Workout 4, 1 sets" }).click();

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Delete" }).click();

    await expect(page.getByText("Workout deleted.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Workout 4, 1 sets" })).toHaveCount(0);
  });
});
