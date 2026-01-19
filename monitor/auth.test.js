import test from "node:test";
import assert from "node:assert/strict";
import { monitorAuth } from "./auth.js";

function makeReq(authHeader) {
  return {
    get(name) {
      if (name && name.toLowerCase() === "authorization") return authHeader;
      return undefined;
    },
  };
}

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

test("monitorAuth rejects missing Authorization when enabled", () => {
  const oldEnabled = process.env.MONITOR_ENABLED;
  const oldToken = process.env.MONITOR_TOKEN;
  process.env.MONITOR_ENABLED = "true";
  process.env.MONITOR_TOKEN = "secret";

  const req = makeReq(undefined);
  const res = makeRes();
  let nextCalled = false;

  monitorAuth(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);

  process.env.MONITOR_ENABLED = oldEnabled;
  process.env.MONITOR_TOKEN = oldToken;
});

test("monitorAuth allows valid bearer token when enabled", () => {
  const oldEnabled = process.env.MONITOR_ENABLED;
  const oldToken = process.env.MONITOR_TOKEN;
  process.env.MONITOR_ENABLED = "true";
  process.env.MONITOR_TOKEN = "secret";

  const req = makeReq("Bearer secret");
  const res = makeRes();
  let nextCalled = false;

  monitorAuth(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);

  process.env.MONITOR_ENABLED = oldEnabled;
  process.env.MONITOR_TOKEN = oldToken;
});

test("monitorAuth rejects when token is not configured", () => {
  const oldEnabled = process.env.MONITOR_ENABLED;
  const oldToken = process.env.MONITOR_TOKEN;
  process.env.MONITOR_ENABLED = "true";
  process.env.MONITOR_TOKEN = "";

  const req = makeReq("Bearer anything");
  const res = makeRes();
  let nextCalled = false;

  monitorAuth(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 500);

  process.env.MONITOR_ENABLED = oldEnabled;
  process.env.MONITOR_TOKEN = oldToken;
});

test("monitorAuth bypasses when monitoring disabled", () => {
  const oldEnabled = process.env.MONITOR_ENABLED;
  const oldToken = process.env.MONITOR_TOKEN;
  process.env.MONITOR_ENABLED = "false";
  process.env.MONITOR_TOKEN = "secret";

  const req = makeReq(undefined);
  const res = makeRes();
  let nextCalled = false;

  monitorAuth(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);

  process.env.MONITOR_ENABLED = oldEnabled;
  process.env.MONITOR_TOKEN = oldToken;
});
