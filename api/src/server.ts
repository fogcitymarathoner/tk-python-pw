import { existsSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PersonalDb, type ExpenseInput, type SwimSessionInput, type SwimSetInput } from "./db.ts";
import { ApiError } from "./errors.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export type Config = {
  host: string;
  port: number;
  dbPath: string;
  defaultUserId: string;
};

type Params = Record<string, string>;
type Json = Record<string, unknown>;
type Result = { status: number; body: unknown };
type Handler = (ctx: RequestContext) => Result;

type RequestContext = {
  db: PersonalDb;
  dbPath: string;
  query: URLSearchParams;
  params: Params;
  body: Json;
  userId: string;
};

type Route = {
  method: string;
  parts: string[];
  handler: Handler;
};

const routes: Route[] = [
  { method: "GET", parts: [], handler: () => ok(indexBody()) },
  { method: "GET", parts: ["health"], handler: (ctx) => ok({ ok: true, dbPath: ctx.dbPath, userId: ctx.userId }) },
  { method: "GET", parts: ["categories"], handler: (ctx) => ok(ctx.db.listCategories(ctx.userId)) },
  { method: "POST", parts: ["categories"], handler: (ctx) => created(ctx.db.createCategory(ctx.userId, requiredString(ctx.body, "name"))) },
  { method: "PUT", parts: ["categories", ":id"], handler: (ctx) => found(ctx.db.renameCategory(ctx.userId, intParam(ctx.params, "id"), requiredString(ctx.body, "name")), "Category not found") },
  { method: "DELETE", parts: ["categories", ":id"], handler: (ctx) => removed(ctx.db.deleteCategory(ctx.userId, intParam(ctx.params, "id")), "Category not found") },
  { method: "GET", parts: ["vendors"], handler: (ctx) => ok(ctx.db.listVendors(ctx.userId, optionalInt(ctx.query, "categoryId"))) },
  { method: "POST", parts: ["vendors"], handler: (ctx) => created(ctx.db.createVendor(ctx.userId, requiredString(ctx.body, "name"))) },
  { method: "PUT", parts: ["vendors", ":id"], handler: (ctx) => found(ctx.db.renameVendor(ctx.userId, intParam(ctx.params, "id"), requiredString(ctx.body, "name")), "Vendor not found") },
  { method: "DELETE", parts: ["vendors", ":id"], handler: (ctx) => removed(ctx.db.deleteVendor(ctx.userId, intParam(ctx.params, "id")), "Vendor not found") },
  { method: "GET", parts: ["expenses"], handler: (ctx) => ok(listExpenses(ctx)) },
  { method: "GET", parts: ["expenses", ":localId"], handler: (ctx) => found(ctx.db.getExpense(ctx.userId, intParam(ctx.params, "localId")), "Expense not found") },
  { method: "POST", parts: ["expenses"], handler: (ctx) => created(ctx.db.createExpense(ctx.userId, expenseInput(ctx.body))) },
  { method: "PUT", parts: ["expenses", ":localId"], handler: (ctx) => found(ctx.db.updateExpense(ctx.userId, intParam(ctx.params, "localId"), expenseInput(ctx.body)), "Expense not found") },
  { method: "DELETE", parts: ["expenses", ":localId"], handler: (ctx) => removed(ctx.db.deleteExpense(ctx.userId, intParam(ctx.params, "localId")), "Expense not found") },
  { method: "GET", parts: ["swim", "workouts"], handler: (ctx) => ok(ctx.db.listSwimWorkouts(ctx.userId)) },
  { method: "GET", parts: ["swim", "workouts", ":id"], handler: (ctx) => found(ctx.db.getSwimWorkout(ctx.userId, intParam(ctx.params, "id")), "Workout not found") },
  { method: "POST", parts: ["swim", "workouts"], handler: (ctx) => created(saveWorkout(ctx)) },
  { method: "PUT", parts: ["swim", "workouts", ":id"], handler: (ctx) => found(saveWorkout(ctx, intParam(ctx.params, "id")), "Workout not found") },
  { method: "DELETE", parts: ["swim", "workouts", ":id"], handler: (ctx) => removed(ctx.db.deleteSwimWorkout(ctx.userId, intParam(ctx.params, "id")), "Workout not found") },
  { method: "GET", parts: ["swim", "sessions"], handler: (ctx) => ok(ctx.db.listSwimSessions(ctx.userId)) },
  { method: "GET", parts: ["swim", "sessions", ":id"], handler: (ctx) => found(ctx.db.getSwimSession(ctx.userId, intParam(ctx.params, "id")), "Session not found") },
  { method: "POST", parts: ["swim", "sessions"], handler: (ctx) => created(ctx.db.createSwimSession(ctx.userId, sessionInput(ctx.body))) },
  { method: "PUT", parts: ["swim", "sessions", ":id"], handler: (ctx) => found(ctx.db.updateSwimSession(ctx.userId, intParam(ctx.params, "id"), sessionInput(ctx.body)), "Session not found") },
  { method: "DELETE", parts: ["swim", "sessions", ":id"], handler: (ctx) => removed(ctx.db.deleteSwimSession(ctx.userId, intParam(ctx.params, "id")), "Session not found") },
];

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // PORT and HOST are often set for other local servers, so this app uses its own names.
  const port = Number(env.DATABASE_API_PORT ?? 8900);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid DATABASE_API_PORT: ${env.DATABASE_API_PORT}`);
  }
  return {
    host: env.DATABASE_API_HOST?.trim() || "127.0.0.1",
    port,
    dbPath: env.PERSONAL_DB_PATH?.trim() || path.join(repoRoot, "personal_assistant.db"),
    defaultUserId:
      env.USER_UID?.trim() || readEnvValue(path.join(repoRoot, ".env"), "USER_UID") || "mXJ3yvoUxNUGle4v0Y1JmlKSWSQ2",
  };
}

export function startServer(config: Config): { server: Server; db: PersonalDb } {
  const db = PersonalDb.open(config.dbPath);
  const server = createServer((req, res) => {
    void handle(req, res, config, db).catch((error: unknown) => {
      sendError(res, error);
    });
  });
  server.listen(config.port, config.host);
  return { server, db };
}

async function handle(req: IncomingMessage, res: ServerResponse, config: Config, db: PersonalDb): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const method = req.method ?? "GET";
  const matches = routes.filter((route) => samePath(route.parts, parts));
  const route = matches.find((item) => item.method === method);
  if (!route) {
    send(res, matches.length ? 405 : 404, { error: matches.length ? "Method not allowed" : "Not found" });
    return;
  }

  const body = method === "GET" || method === "DELETE" ? {} : await readBody(req);
  const result = route.handler({
    db,
    dbPath: config.dbPath,
    query: url.searchParams,
    params: pathParams(route.parts, parts),
    body,
    userId: userId(url.searchParams, body, config.defaultUserId),
  });
  send(res, result.status, result.body);
}

function samePath(pattern: string[], parts: string[]): boolean {
  if (pattern.length !== parts.length) return false;
  return pattern.every((part, index) => part.startsWith(":") || part === parts[index]);
}

function pathParams(pattern: string[], parts: string[]): Params {
  const params: Params = {};
  pattern.forEach((part, index) => {
    if (part.startsWith(":")) params[part.slice(1)] = parts[index] ?? "";
  });
  return params;
}

function userId(query: URLSearchParams, body: Json, defaultUserId: string): string {
  const fromBody = typeof body.userId === "string" ? body.userId.trim() : "";
  const value = (query.get("userId")?.trim() || fromBody || defaultUserId).trim();
  if (!value) throw new ApiError(400, "userId is required");
  return value;
}

async function readBody(req: IncomingMessage): Promise<Json> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_000_000) throw new ApiError(413, "Body too large");
    chunks.push(buffer);
  }
  if (size === 0) return {};
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ApiError(400, "JSON body must be an object");
    }
    return parsed as Json;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "Invalid JSON");
  }
}

function indexBody() {
  return {
    name: "Personal data API",
    resources: {
      categories: "/categories",
      vendors: "/vendors",
      expenses: "/expenses",
      swimWorkouts: "/swim/workouts",
      swimSessions: "/swim/sessions",
    },
  };
}

function listExpenses(ctx: RequestContext) {
  const ascending = ctx.query.get("ascending") === "true" || ctx.query.get("ascending") === "1";
  return ctx.db.listExpenses(ctx.userId, ascending, optionalInt(ctx.query, "categoryId"), optionalInt(ctx.query, "vendorId"));
}

function saveWorkout(ctx: RequestContext, id?: number) {
  const name = requiredString(ctx.body, "name");
  const note = optionalText(ctx.body, "note");
  const sets = Object.prototype.hasOwnProperty.call(ctx.body, "sets") ? swimSets(ctx.body) : undefined;
  if (id == null) return ctx.db.createSwimWorkout(ctx.userId, name, note, sets ?? []);
  return ctx.db.updateSwimWorkout(ctx.userId, id, name, note, sets);
}

function expenseInput(body: Json): ExpenseInput {
  return {
    vendorName: requiredString(body, "vendorName"),
    categoryName: requiredString(body, "categoryName"),
    amount: requiredString(body, "amount"),
    date: requiredDate(body, "date"),
    memo: optionalText(body, "memo"),
  };
}

function sessionInput(body: Json): SwimSessionInput {
  return {
    date: requiredDate(body, "date"),
    meters: optionalText(body, "meters"),
    miles: optionalText(body, "miles"),
    stroke: optionalText(body, "stroke"),
    note: optionalText(body, "note"),
    extra: optionalText(body, "extra"),
    workoutId: optionalBodyInt(body, "workoutId"),
  };
}

function swimSets(body: Json): SwimSetInput[] {
  if (!Array.isArray(body.sets)) throw new ApiError(400, "sets must be an array");
  return body.sets.map((entry, index) => {
    if (entry == null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new ApiError(400, `sets[${index}] must be an object`);
    }
    const set = entry as Json;
    return {
      distance: optionalText(set, "distance"),
      description: optionalText(set, "description"),
      splitTotal: optionalText(set, "splitTotal"),
      equipment: optionalText(set, "equipment"),
      fins: optionalText(set, "fins"),
    };
  });
}

function requiredString(body: Json, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || value.trim() === "") throw new ApiError(400, `${key} is required`);
  return value.trim();
}

function requiredDate(body: Json, key: string): string {
  const value = requiredString(body, key);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ApiError(400, `${key} must be YYYY-MM-DD`);
  return value;
}

function optionalText(body: Json, key: string): string {
  const value = body[key];
  if (value == null) return "";
  if (typeof value !== "string") throw new ApiError(400, `${key} must be a string`);
  return value;
}

function optionalBodyInt(body: Json, key: string): number | null {
  const value = body[key];
  if (value == null || value === "") return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new ApiError(400, `${key} must be a positive integer`);
  }
  return value;
}

function optionalInt(query: URLSearchParams, key: string): number | undefined {
  const raw = query.get(key);
  if (raw == null || raw === "") return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new ApiError(400, `${key} must be a positive integer`);
  return value;
}

function intParam(params: Params, key: string): number {
  const value = Number(params[key]);
  if (!Number.isInteger(value) || value <= 0) throw new ApiError(400, `${key} must be a positive integer`);
  return value;
}

function ok(body: unknown): Result {
  return { status: 200, body };
}

function created(body: unknown): Result {
  return { status: 201, body };
}

function found<T>(value: T | undefined, message: string): Result {
  if (value === undefined) throw new ApiError(404, message);
  return ok(value);
}

function removed(deleted: boolean, message: string): Result {
  if (!deleted) throw new ApiError(404, message);
  return ok({ ok: true });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  res.end(payload);
}

function sendError(res: ServerResponse, error: unknown): void {
  if (error instanceof ApiError) {
    send(res, error.status, { error: error.message });
    return;
  }
  const message = error instanceof Error ? error.message : "Internal error";
  const status = /constraint|SQLITE_CONSTRAINT/i.test(message) ? 400 : 500;
  send(res, status, { error: message });
}

function readEnvValue(file: string, key: string): string | undefined {
  if (!existsSync(file)) return undefined;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    if (trimmed.slice(0, eq).trim() === key) return trimmed.slice(eq + 1).trim();
  }
  return undefined;
}
