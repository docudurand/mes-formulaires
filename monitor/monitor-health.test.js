import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { getHealthStatus, log, __resetForTests } from "./monitor.js";

beforeEach(() => {
  __resetForTests();
});

test("health status is ok by default", () => {
  const health = getHealthStatus();
  assert.equal(health.status, "ok");
  assert.equal(health.lastErrorAt, null);
});

test("health status becomes error after error log", () => {
  log("error", "boom");
  const health = getHealthStatus();
  assert.equal(health.status, "error");
  assert.ok(health.lastErrorAt);
});

test("health status returns to ok after error is stale", () => {
  const originalNow = Date.now;
  const t0 = Date.now();

  try {
    Date.now = () => t0;
    log("error", "boom");

    Date.now = () => t0 + 6 * 60 * 1000;
    const health = getHealthStatus();
    assert.equal(health.status, "ok");
    assert.ok(health.lastErrorAt);
  } finally {
    Date.now = originalNow;
  }
});
