import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { PersonalDb } from "../src/db.ts";
import type { Category, Expense, SwimSession, SwimWorkoutDetail } from "../src/db.ts";
import { loadConfig, startServer } from "../src/server.ts";

const dir = mkdtempSync(path.join(tmpdir(), "personal-data-api-"));
const dbPath = path.join(dir, "test.db");
const userId = "user-a";

let server: Server;
let db: PersonalDb;
let base: string;

before(async () => {
  const port = await freePort();
  ({ server, db } = startServer({ host: "127.0.0.1", port, dbPath, defaultUserId: userId }));
  if (!server.listening) {
    await new Promise<void>((resolve, reject) => {
      server.once("listening", () => resolve());
      server.once("error", reject);
    });
  }
  const address = server.address() as AddressInfo;
  base = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("personal data API", { concurrency: 1 }, () => {
  it("stays on port 8900 when another server owns PORT", () => {
    const config = loadConfig({ PORT: "5432", HOST: "192.168.0.23", USER_UID: userId });
    assert.equal(config.port, 8900);
    assert.equal(config.host, "127.0.0.1");
    assert.equal(config.defaultUserId, userId);
  });

  it("reports health and the route index", async () => {
    const health = await request("/");
    assert.equal(health.status, 200);
    assert.equal(health.body.name, "Personal data API");

    const status = await request("/health");
    assert.equal(status.body.ok, true);
    assert.equal(status.body.userId, userId);
    assert.equal(status.body.dbPath, dbPath);
  });

  it("creates, renames, filters, and deletes categories and vendors", async () => {
    const category = await request<Category>("/categories", {
      method: "POST",
      body: { name: " Groceries " },
    });
    assert.equal(category.status, 201);
    assert.equal(category.body.name, "Groceries");
    assert.equal(category.body.userId, userId);
    assert.match(category.body.remoteId ?? "", /^local_/);

    const renamed = await request<Category>(`/categories/${category.body.id}`, {
      method: "PUT",
      body: { name: "Food" },
    });
    assert.equal(renamed.body.name, "Food");

    const otherUser = await request<Category[]>("/categories?userId=someone-else");
    assert.deepEqual(otherUser.body, []);

    const vendor = await request<{ id: number; name: string }>("/vendors", {
      method: "POST",
      body: { name: "Market" },
    });
    assert.equal(vendor.status, 201);

    const missing = await request("/categories/999999", { method: "DELETE" });
    assert.equal(missing.status, 404);

    const removedVendor = await request(`/vendors/${vendor.body.id}`, { method: "DELETE" });
    assert.equal(removedVendor.body.ok, true);
    const removedCategory = await request(`/categories/${category.body.id}`, { method: "DELETE" });
    assert.equal(removedCategory.body.ok, true);
  });

  it("stores expenses under a category and vendor", async () => {
    const created = await request<Expense>("/expenses", {
      method: "POST",
      body: {
        vendorName: "Market",
        categoryName: "Food",
        amount: "12.50",
        date: "2026-11-02",
        memo: "apples",
      },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.vendorName, "Market");
    assert.equal(created.body.categoryName, "Food");
    assert.equal(created.body.amount, "12.50");

    const again = await request<Expense>("/expenses", {
      method: "POST",
      body: {
        vendorName: "Market",
        categoryName: "Food",
        amount: "4.00",
        date: "2026-11-01",
      },
    });
    const categories = await request<{ id: number; name: string }[]>("/categories");
    const food = categories.body.find((item) => item.name === "Food");
    assert.ok(food);

    const filtered = await request<Expense[]>(
      `/expenses?categoryId=${food.id}&vendorId=${created.body.vendorId}&ascending=true`,
    );
    assert.deepEqual(
      filtered.body.map((item) => item.amount),
      ["4.00", "12.50"],
    );

    const updated = await request<Expense>(`/expenses/${created.body.localId}`, {
      method: "PUT",
      body: {
        vendorName: "Market",
        categoryName: "Food",
        amount: "13.00",
        date: "2026-11-03",
        memo: "pears",
      },
    });
    assert.equal(updated.body.amount, "13.00");
    assert.equal(updated.body.memo, "pears");

    const vendors = await request<{ name: string }[]>(`/vendors?categoryId=${food.id}`);
    assert.deepEqual(
      vendors.body.map((item) => item.name),
      ["Market"],
    );

    const badDate = await request("/expenses", {
      method: "POST",
      body: { vendorName: "Market", categoryName: "Food", amount: "1", date: "11/04/2026" },
    });
    assert.equal(badDate.status, 400);

    assert.equal((await request(`/expenses/${again.body.localId}`, { method: "DELETE" })).body.ok, true);
    assert.equal((await request(`/expenses/${created.body.localId}`, { method: "DELETE" })).body.ok, true);
  });

  it("saves swim workouts with sets and sessions that point at them", async () => {
    const workout = await request<SwimWorkoutDetail>("/swim/workouts", {
      method: "POST",
      body: {
        name: "Endurance",
        note: "easy",
        sets: [
          { distance: "100", description: "free", splitTotal: "1:30", equipment: "paddles", fins: "" },
          { distance: "200", description: "pull" },
        ],
      },
    });
    assert.equal(workout.status, 201);
    assert.equal(workout.body.setCount, 2);
    assert.equal(workout.body.sets[0]?.equipment, "paddles");
    assert.equal(workout.body.sets[1]?.sortOrder, 1);

    const renamed = await request<SwimWorkoutDetail>(`/swim/workouts/${workout.body.id}`, {
      method: "PUT",
      body: { name: "Endurance plus", note: "easy" },
    });
    assert.equal(renamed.body.name, "Endurance plus");
    assert.equal(renamed.body.setCount, 2);

    const session = await request<SwimSession>("/swim/sessions", {
      method: "POST",
      body: {
        date: "2026-11-04",
        meters: "3000",
        miles: "1.86",
        stroke: "free",
        note: "felt good",
        workoutId: workout.body.id,
      },
    });
    assert.equal(session.status, 201);
    assert.equal(session.body.workoutName, "Endurance plus");

    const unknownWorkout = await request("/swim/sessions", {
      method: "POST",
      body: { date: "2026-11-05", workoutId: 999999 },
    });
    assert.equal(unknownWorkout.status, 400);

    assert.equal((await request(`/swim/sessions/${session.body.id}`, { method: "DELETE" })).body.ok, true);
    assert.equal((await request(`/swim/workouts/${workout.body.id}`, { method: "DELETE" })).body.ok, true);
    assert.equal((await request(`/swim/workouts/${workout.body.id}`)).status, 404);
  });

  it("rejects unknown routes, the wrong method, and invalid JSON", async () => {
    assert.equal((await request("/missing")).status, 404);
    assert.equal((await request("/categories", { method: "PATCH", body: { name: "x" } })).status, 405);
    const response = await fetch(`${base}/categories`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    assert.equal(response.status, 400);
    assert.equal(((await response.json()) as { error: string }).error, "Invalid JSON");
  });
});

async function request<T = { ok?: boolean; error?: string; name?: string; userId?: string; dbPath?: string }>(
  pathname: string,
  options: { method?: string; body?: unknown } = {},
): Promise<{ status: number; body: T }> {
  const response = await fetch(`${base}${pathname}`, {
    method: options.method ?? "GET",
    headers: options.body === undefined ? undefined : { "content-type": "application/json" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return { status: response.status, body: (await response.json()) as T };
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address() as AddressInfo;
      probe.close(() => resolve(address.port));
    });
    probe.on("error", reject);
  });
}
