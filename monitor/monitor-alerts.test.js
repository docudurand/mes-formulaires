import assert from "node:assert/strict";
import test from "node:test";
import { log, __resetForTests } from "./monitor.js";

const MAX_AGE_MS = 5 * 60 * 1000;

function withMockedFetch(fn) {
  const original = global.fetch;
  const calls = [];
  global.fetch = async (...args) => {
    calls.push(args);
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };

  return fn(calls)
    .finally(() => {
      global.fetch = original;
    });
}

test("alerts do not fire when threshold is not set", async () => {
  __resetForTests();
  process.env.MONITOR_ALERT_THRESHOLD = "";
  process.env.MONITOR_ALERT_WEBHOOK_URL = "https://example.test/hook";

  await withMockedFetch(async (calls) => {
    log("error", "boom");
    assert.equal(calls.length, 0);
  });
});

test("alerts fire when threshold is reached", async () => {
  __resetForTests();
  process.env.MONITOR_ALERT_THRESHOLD = "2";
  process.env.MONITOR_ALERT_WEBHOOK_URL = "https://example.test/hook";

  await withMockedFetch(async (calls) => {
    log("error", "boom 1");
    log("error", "boom 2");
    assert.equal(calls.length, 1);

    const opts = calls[0][1] || {};
    const payload = JSON.parse(opts.body || "{}");
    assert.equal(payload.type, "monitor_error_threshold");
    assert.equal(payload.threshold, 2);
    assert.equal(payload.count, 2);
  });
});

test("alerts rearm after errors fall below threshold", async () => {
  __resetForTests();
  process.env.MONITOR_ALERT_THRESHOLD = "2";
  process.env.MONITOR_ALERT_WEBHOOK_URL = "https://example.test/hook";

  const realNow = Date.now;
  let now = 0;
  Date.now = () => now;

  try {
    await withMockedFetch(async (calls) => {
      log("error", "boom 1");
      now += 1000;
      log("error", "boom 2");
      assert.equal(calls.length, 1);

      now = MAX_AGE_MS + 2000;
      log("info", "tick");

      log("error", "boom 3");
      now += 1000;
      log("error", "boom 4");
      assert.equal(calls.length, 2);
    });
  } finally {
    Date.now = realNow;
  }
});
