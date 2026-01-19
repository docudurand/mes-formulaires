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
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
      return this;
    },
    getHeader(name) {
      return this.headers[String(name).toLowerCase()];
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
  assert.ok(String(res.getHeader("Set-Cookie") || "").includes("monitor_token="));

  process.env.MONITOR_ENABLED = oldEnabled;
  process.env.MONITOR_TOKEN = oldToken;
});

test("monitorAuth allows token from query string when enabled", () => {
  const oldEnabled = process.env.MONITOR_ENABLED;
  const oldToken = process.env.MONITOR_TOKEN;
  process.env.MONITOR_ENABLED = "true";
  process.env.MONITOR_TOKEN = "secret";

  const req = { query: { token: "secret" } };
  const res = makeRes();
  let nextCalled = false;

  monitorAuth(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
  assert.ok(String(res.getHeader("Set-Cookie") || "").includes("monitor_token="));

  process.env.MONITOR_ENABLED = oldEnabled;
  process.env.MONITOR_TOKEN = oldToken;
});

test("monitorAuth sets Secure cookie when request is https", () => {
  const oldEnabled = process.env.MONITOR_ENABLED;
  const oldToken = process.env.MONITOR_TOKEN;
  process.env.MONITOR_ENABLED = "true";
  process.env.MONITOR_TOKEN = "secret";

  const req = { query: { token: "secret" }, headers: { "x-forwarded-proto": "https" } };
  const res = makeRes();
  let nextCalled = false;

  monitorAuth(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.ok(String(res.getHeader("Set-Cookie") || "").includes("Secure"));

  process.env.MONITOR_ENABLED = oldEnabled;
  process.env.MONITOR_TOKEN = oldToken;
});

test("monitorAuth allows cookie token when enabled", () => {
  const oldEnabled = process.env.MONITOR_ENABLED;
  const oldToken = process.env.MONITOR_TOKEN;
  process.env.MONITOR_ENABLED = "true";
  process.env.MONITOR_TOKEN = "secret!";

  const req = { headers: { cookie: "monitor_token=secret%21" } };
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

test("monitorAuth returns 404 when monitoring disabled", () => {
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

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 404);

  process.env.MONITOR_ENABLED = oldEnabled;
  process.env.MONITOR_TOKEN = oldToken;
});
