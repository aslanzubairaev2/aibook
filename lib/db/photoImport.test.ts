// Exercise the real routes, Gemini SDK, Supabase SDK, parsers and stores.
// Only the external HTTP services are replaced; no real credentials or AI spend.
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { createServer, type Server } from "node:http";
import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { startFakeGeminiServer, type FakeGeminiServer } from "../ai/fakeGeminiServer.ts";
import { saveDictionaryEntries } from "./dictionaryStore.ts";
import { isMissingContentType } from "./dictionarySchema.ts";
import type { DictionaryEntryDraft } from "../ai/buildDictionaryPrompt.ts";

type Row = Record<string, unknown>;
let gemini: FakeGeminiServer;
let database: Server;
let baseUrl: string;
let routes: Record<string, (req: Request) => Promise<Response>>;
let dictionaryGet: (req: NextRequest) => Promise<Response>;
let callMcpTool: typeof import("../mcp/tools.ts").callMcpTool;
let rows: Record<string, Row[]>;
let legacy: boolean;
let staleWriteCache: boolean;
let failTable: string;
let nextId = 0;
let calls: { table: string; method: string; url: URL; body: unknown }[];

const word: DictionaryEntryDraft = {
  headword: "der Anfang", lemma: "Anfang", contentType: "word", translation: "начало",
  partOfSpeech: "существительное", article: "der", gender: "m", plural: "Anfänge", cefr: "A1",
};
const photo = { image: "data:image/jpeg;base64,YWJj", targetLanguage: "de", nativeLanguage: "ru", homeworkDate: "2026-09-14", pageLabel: "68" };
const envKeys = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "GEMINI_API_BASE_URL", "GEMINI_API_KEY", "AI_ALLOW_DEV_AI"];
const oldEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

before(async () => {
  gemini = await startFakeGeminiServer();
  database = createServer(async (req, res) => {
    const reply = (status: number, body: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    try {
      const url = new URL(req.url!, "http://localhost");
      if (url.pathname === "/auth/v1/user") {
        return reply(200, { id: "learner", aud: "authenticated", role: "authenticated" });
      }
      const table = url.pathname.replace("/rest/v1/", "");
      assert.ok(rows[table], `Unexpected table ${table}`);
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = raw ? JSON.parse(raw) : null;
      const method = req.method!;
      calls.push({ table, method, url, body });
      if (table === failTable) return reply(403, { code: "42501", message: "permission denied for table " + table });
      const select = url.searchParams.get("select") ?? "";
      if (table === "dictionary_batches" && method === "GET" && legacy) {
        const missing = ["page_label", "training", "description", "instruction"].find((column) => select.includes(column));
        if (missing) return reply(400, { code: "42703", message: `column dictionary_batches.${missing} does not exist` });
      }
      if (table === "dictionary_entries" && method === "GET" && legacy && (select.includes("content_type") || url.searchParams.has("content_type"))) {
        return reply(400, { code: "42703", message: "column dictionary_entries.content_type does not exist" });
      }
      const payload: Row[] = body ? Array.isArray(body) ? body : [body] : [];
      if (table === "dictionary_batches" && method === "POST" && legacy && payload.some((row) => "page_label" in row)) {
        return reply(400, { code: "PGRST204", message: "Could not find the 'page_label' column in the schema cache" });
      }
      if (table === "dictionary_batches" && method === "POST" && legacy && payload.some((row) => "description" in row)) {
        return reply(400, { code: "PGRST204", message: "Could not find the 'description' column in the schema cache" });
      }
      if (table === "dictionary_entries" && method === "POST" && (legacy || staleWriteCache) && payload.some((row) => "content_type" in row)) {
        return reply(400, { code: "PGRST204", message: "Could not find the 'content_type' column of 'dictionary_entries' in the schema cache" });
      }
      const matches = (row: Row) => [...url.searchParams].every(([key, value]) => {
        if (value.startsWith("eq.")) return String(row[key]) === value.slice(3);
        if (value.startsWith("in.(")) return value.slice(4, -1).split(",").includes(String(row[key]));
        return true;
      });
      if (method === "GET") return reply(200, rows[table].filter(matches).slice(0, Number(url.searchParams.get("limit") ?? 2000)));
      if (method === "POST") {
        const stored = payload.map((row) => {
          const conflict = url.searchParams.get("on_conflict");
          const existing = conflict ? rows[table].find((prior) => conflict.split(",").every((key) => prior[key] === row[key])) : null;
          if (existing) { Object.assign(existing, row); return existing; }
          const created = { id: `row-${++nextId}`, ...row };
          rows[table].push(created);
          return created;
        });
        return reply(201, req.headers.accept?.includes("vnd.pgrst.object") ? stored[0] : stored);
      }
      if (method === "PATCH") {
        rows[table].filter(matches).forEach((row) => Object.assign(row, body));
        return reply(200, []);
      }
      if (method === "DELETE") {
        rows[table] = rows[table].filter((row) => !matches(row));
        return reply(200, []);
      }
      throw new Error(`Unexpected method ${method}`);
    } catch (error) { reply(500, { message: String(error) }); }
  });
  await new Promise<void>((resolve) => database.listen(0, "127.0.0.1", resolve));
  const address = database.address();
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
  process.env.NEXT_PUBLIC_SUPABASE_URL = baseUrl;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service";
  process.env.GEMINI_API_BASE_URL = gemini.baseUrl;
  delete process.env.GEMINI_API_KEY;
  delete process.env.AI_ALLOW_DEV_AI;
  routes = {
    dictionary: (await import("../../app/api/dictionary/from-image/route.ts")).POST,
    text: (await import("../../app/api/lessons/from-image/route.ts")).POST,
    homework: (await import("../../app/api/lessons/from-homework-image/route.ts")).POST,
  };
  dictionaryGet = (await import("../../app/api/dictionary/route.ts")).GET;
  ({ callMcpTool } = await import("../mcp/tools.ts"));
});

beforeEach(() => {
  rows = { dictionary_entries: [], dictionary_batches: [], flashcards: [], shared_books: [], shared_book_chapters: [] };
  legacy = false;
  staleWriteCache = false;
  failTable = "";
  calls = [];
});

after(async () => {
  for (const key of envKeys) {
    if (oldEnv[key] === undefined) delete process.env[key];
    else process.env[key] = oldEnv[key];
  }
  await gemini?.close();
  if (database) await new Promise<void>((resolve, reject) => database.close((error) => error ? reject(error) : resolve()));
});

function request(body: unknown = photo, authenticated = true, key = true) {
  return new Request("http://localhost/api/photo", {
    method: "POST", headers: { "Content-Type": "application/json", ...(authenticated ? { Authorization: "Bearer test-token" } : {}), ...(key ? { "x-gemini-key": "test-key" } : {}) },
    body: JSON.stringify(body),
  });
}

for (const schema of ["current", "legacy", "stale write cache"]) {
  test(`photo -> dictionary -> cards -> repeat import (${schema})`, async () => {
    legacy = schema === "legacy";
    staleWriteCache = schema === "stale write cache";
    gemini.queue({ kind: "json", value: { entries: [word, word], pageKind: "список слов", isVocabularyList: true } });
    const response = await routes.dictionary(request());
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    assert.equal((await response.json()).total, 1);
    assert.equal(rows.dictionary_entries.length, 1);
    assert.equal(rows.flashcards.length, 1);
    assert.equal(rows.dictionary_entries[0].plural, "Anfänge");
    if (legacy) assert.match(String(rows.dictionary_batches[0].kind), /страница 68/iu);
    else assert.equal(rows.dictionary_batches[0].page_label, "страница 68");
    assert.equal(rows.flashcards[0].source_book_id, rows.dictionary_batches[0].id);
    Object.assign(rows.flashcards[0], { repetitions: 8, interval_days: 15, next_review_at: "2026-10-01" });
    gemini.queue({ kind: "json", value: { entries: [{ ...word, plural: "" }] } });
    const repeated = await routes.dictionary(request());
    assert.equal(repeated.status, 200);
    assert.equal((await repeated.json()).updated, 1);
    assert.equal(rows.dictionary_entries.length, 1);
    assert.equal(rows.dictionary_entries[0].plural, "Anfänge");
    assert.equal(rows.flashcards.length, 1);
    assert.equal(rows.flashcards[0].repetitions, 8);
    assert.equal(rows.flashcards[0].next_review_at, "2026-10-01");
    const reads = calls.filter((call) => call.table === "dictionary_entries" && call.method === "GET");
    assert.ok(reads.every((call) => call.url.searchParams.get("user_id") === "eq.learner" && call.url.searchParams.get("language") === "eq.de"));
    assert.ok(calls.filter((call) => call.table === "dictionary_entries" && call.method === "POST").every((call) => call.url.searchParams.get("on_conflict") === "user_id,lemma,language"));
  });
}

test("non-word types survive on current schema and are never silently downgraded on legacy schema", async () => {
  const admin = createClient(baseUrl, "test-service");
  const draft = { ...word, contentType: "expression" as const };
  assert.equal((await saveDictionaryEntries(admin, "learner", "de", [draft], "MCP")).ok, true);
  assert.equal(rows.dictionary_entries[0].content_type, "expression");
  rows.dictionary_entries = [];
  legacy = true;
  // A distinct lemma ensures the mixed pack isn't deduplicated to its first word.
  const mixed = await saveDictionaryEntries(admin, "learner", "de", [word, { ...draft, lemma: "Guten Tag", headword: "Guten Tag" }], "MCP");
  assert.equal(mixed.ok, false);
  if (!mixed.ok) assert.match(mixed.error, /обновить базу/);
  assert.equal(rows.dictionary_entries.length, 0);
});

test("missing-column detection does not hide permission or unrelated schema failures", () => {
  assert.equal(isMissingContentType({ code: "42501", message: "permission denied for content_type" }), false);
  assert.equal(isMissingContentType({ code: "42703", message: "column plural does not exist" }), false);
});

test("dictionary failure reports an error, removes empty batch and creates no cards", async () => {
  failTable = "dictionary_entries";
  gemini.queue({ kind: "json", value: { entries: [word] } });
  const response = await routes.dictionary(request());
  assert.equal(response.status, 500);
  assert.match((await response.json()).error, /Не удалось прочитать словарь/);
  assert.equal(rows.dictionary_batches.length, 0);
  assert.equal(rows.flashcards.length, 0);
  assert.equal(calls.filter((call) => call.table === "dictionary_entries").length, 1);
});

test("photographed dictionary packs cannot be saved without a page reference", async () => {
  gemini.queue({ kind: "json", value: { entries: [word], pageKind: "список слов", isVocabularyList: true } });
  const response = await routes.dictionary(request({ ...photo, pageLabel: "" }));
  assert.equal(response.status, 422);
  assert.match((await response.json()).error, /страниц|урок|раздел/iu);
  assert.equal(rows.dictionary_batches.length, 0);
  assert.equal(rows.dictionary_entries.length, 0);
});

test("failed card creation does not report a successful import or leave an empty batch", async () => {
  failTable = "flashcards";
  gemini.queue({ kind: "json", value: { entries: [word] } });
  const response = await routes.dictionary(request());
  assert.equal(response.status, 500);
  assert.match((await response.json()).error, /карточки/);
  assert.equal(rows.dictionary_batches.length, 0);
  assert.equal(rows.flashcards.length, 0);
});

for (const name of ["dictionary", "text", "homework"]) {
  test(`${name}: authentication, API key and bad image block processing before AI or writes`, async () => {
    const count = gemini.requests.length;
    assert.equal((await routes[name](request(photo, false))).status, 401);
    assert.equal((await routes[name](request(photo, true, false))).status, 403);
    for (const image of ["", "not-an-image", "data:image/gif;base64,YWJj"]) {
      assert.equal((await routes[name](request({ ...photo, image }))).status, 400);
    }
    assert.equal((await routes[name](request({ ...photo, image: "data:image/jpeg;base64," + "A".repeat(6 * 1024 * 1024) }))).status, 413);
    assert.equal(gemini.requests.length, count);
    assert.equal(calls.length, 0);
  });

  test(`${name}: unreadable photo and upstream errors never produce false success`, async () => {
    gemini.queue({ kind: "json", value: {} });
    assert.equal((await routes[name](request())).status, 422);
    gemini.queue({ kind: "httpError", status: 403, message: "API key invalid" });
    assert.equal((await routes[name](request())).status, 403);
    assert.equal(calls.length, 0);
  });
}

test("text photo is transcribed without touching dictionary schema", async () => {
  legacy = true;
  gemini.queue({ kind: "json", value: { language: "de", text: "Ihr Wortschatz", isStudyMaterial: true } });
  const response = await routes.text(request());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).text, "Ihr Wortschatz");
  assert.equal(calls.length, 0);
});

test("homework photo saves exercises independently of dictionary schema", async () => {
  legacy = true;
  gemini.queue({ kind: "json", value: { title: "Übungen", exercises: [{ number: 1, instruction: "Ergänzen Sie", widget: "cloze", items: [{ number: 1, text: "Ich ___ hier." }] }] } });
  const response = await routes.homework(request());
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  assert.equal((await response.json()).exerciseCount, 1);
  assert.equal(rows.shared_books[0].owner_user_id, "learner");
  assert.equal(rows.shared_book_chapters.length, 1);
  assert.equal(rows.dictionary_entries.length, 0);
});

test("dictionary screen and MCP reads work on legacy schema with owner/type filters", async () => {
  legacy = true;
  rows.dictionary_entries = [{ id: "word", user_id: "learner", language: "de", batch_id: "batch", headword: "der Anfang", lemma: "Anfang" }, { id: "private", user_id: "someone-else", language: "de", headword: "private" }];
  const response = await dictionaryGet(new NextRequest("http://localhost/api/dictionary?language=de", { headers: { Authorization: "Bearer test-token" } }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).entries.length, 1);
  const admin = createClient(baseUrl, "test-service");
  const search = await callMcpTool(admin, "learner", "search_dictionary", { content_type: "word" }) as { words: Row[] };
  assert.equal(search.words.length, 1);
  const phrases = await callMcpTool(admin, "learner", "search_dictionary", { content_type: "phrase" }) as { words: Row[] };
  assert.equal(phrases.words.length, 0);
  const batch = await callMcpTool(admin, "learner", "list_batch_words", { batch_id: "batch" }) as { words: Row[] };
  assert.equal(batch.words.length, 1);
  assert.ok(calls.filter((call) => call.table === "dictionary_entries").every((call) => call.url.searchParams.get("user_id") === "eq.learner"));
});
