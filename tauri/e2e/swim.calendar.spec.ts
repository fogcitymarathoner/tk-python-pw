import { expect, test } from "@playwright/test";
import { openSwim } from "./helpers/swimSeed";

test.describe("Swim calendar", () => {
  test("shows month totals and drills into week and day", async ({ page }) => {
    await openSwim(page);
    await page.getByRole("button", { name: "Calendar" }).click();

    await expect(page.getByRole("heading", { name: "July 2025" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Period totals" })).toContainText("3,200");
    await expect(page.getByRole("button", { name: "2025-07-15, 3,200 meters" })).toBeVisible();

    await page.getByRole("button", { name: "Week of 2025-07-14, 3,200 meters, 1 session" }).click();
    await expect(page.getByRole("heading", { name: "Jul 14 – Jul 20, 2025" })).toBeVisible();
    await expect(page.getByRole("button", { name: "2025-07-15, 1 session, 3,200 meters" })).toBeVisible();

    await page.getByRole("button", { name: "2025-07-15, 1 session, 3,200 meters" }).click();
    await expect(page.getByRole("heading", { name: "Tue, Jul 15, 2025" })).toBeVisible();
    await page.getByRole("button", { name: "3,200 meters, Workout 5" }).click();
    await expect(page.getByText("Edit session")).toBeVisible();
    await expect(page.getByLabel("Date")).toHaveValue("2025-07-15");
    await expect(page.getByLabel("Meters")).toHaveValue("3200");
  });

  test("navigates to June totals and adds a session from a day", async ({ page }) => {
    await openSwim(page);
    await page.getByRole("button", { name: "Calendar" }).click();
    await page.getByRole("button", { name: "‹" }).click();

    await expect(page.getByRole("heading", { name: "June 2025" })).toBeVisible();
    const period = page.getByRole("region", { name: "Period totals" });
    await expect(period).toContainText("4");
    await expect(period).toContainText("10,800");
    await expect(period).toContainText("6.70");
    await expect(page.getByRole("button", { name: "Week of 2025-06-23, 5,800 meters, 2 sessions" })).toBeVisible();

    await page.getByRole("button", { name: "2025-06-24, 3,000 meters" }).click();
    await page.getByRole("button", { name: "Add session this day" }).click();
    await expect(page.getByText("New session")).toBeVisible();
    await expect(page.getByLabel("Date")).toHaveValue("2025-06-24");
  });
});
