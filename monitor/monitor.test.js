import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { log, getLastLogs, onLog, __resetForTests } from "./monitor.js";

function last(arr) {
  return arr[arr.length - 1];
}

beforeEach(() => {
  __resetForTests();
});

test("log stores normalized entry", () => {
  log("info", "hello", { requestId: "r1" });
  const entries = getLastLogs();
  const entry = last(entries);
  assert.ok(entry.ts);
  assert.equal(entry.level, "info");
  assert.equal(entry.message, "hello");
  assert.deepEqual(entry.context, { requestId: "r1" });
});

test("log normalizes invalid level to info", () => {
  log("nope", "fallback");
  const entries = getLastLogs();
  const entry = last(entries);
  assert.equal(entry.level, "info");
});

test("onLog receives new entries", () => {
  let received = null;
  const unsubscribe = onLog((entry) => {
    received = entry;
  });

  log("warn", "event");
  unsubscribe();

  assert.ok(received);
  assert.equal(received.level, "warn");
  assert.equal(received.message, "event");
});

test("getLastLogs returns defensive copies", () => {
  log("info", "immutable");
  const entries = getLastLogs();
  entries[entries.length - 1].message = "mutated";

  const fresh = getLastLogs();
  assert.notEqual(last(fresh).message, "mutated");
});

test("log captures error details in context", () => {
  log("error", new Error("boom"));
  const entries = getLastLogs();
  const entry = last(entries);
  assert.equal(entry.message, "boom");
  assert.ok(entry.context && entry.context.error);
  assert.equal(entry.context.error.message, "boom");
});

test("buffer evicts by size", () => {
  for (let i = 0; i < 600; i += 1) {
    log("info", `size-${i}`);
  }
  const entries = getLastLogs();
  assert.ok(entries.length <= 500);
  assert.ok(entries.every((entry) => String(entry.message).startsWith("size-")));
  assert.equal(last(entries).message, "size-599");
});

test("buffer evicts by age", () => {
  const originalNow = Date.now;
  const t0 = Date.now();

  try {
    Date.now = () => t0;
    log("info", "old-1");
    log("info", "old-2");

    Date.now = () => t0 + 6 * 60 * 1000;
    log("info", "new-1");
    const entries = getLastLogs();

    assert.ok(entries.length >= 1);
    assert.ok(entries.every((entry) => String(entry.message).startsWith("new-")));
    assert.equal(last(entries).message, "new-1");
  } finally {
    Date.now = originalNow;
  }
});

test("listener errors do not crash logging", () => {
  onLog(() => {
    throw new Error("listener boom");
  });
  log("warn", "still-logged");
  const entries = getLastLogs();
  assert.equal(last(entries).message, "still-logged");
});
