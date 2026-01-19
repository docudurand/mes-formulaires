import test from "node:test";
import assert from "node:assert/strict";
import { monitorAuth } from "./auth.js";

function makeReq(url, authHeader) {
  const u = new URL(url, "http://localhost");
  const query = Object.fromEntries(u.searchParams.entries());
  return {
    url: u.pathname + u.search,
    path: u.pathname,
    query,
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
    send(payload) {
      this.body = payload;
      return this;
    },
  };
}

function simulateRoute(url, authHeader) {
  const req = makeReq(url, authHeader);
  const res = makeRes();
  let nextCalled = false;

  monitorAuth(req, res, () => {
    nextCalled = true;
    if (req.path === "/monitor" || req.path === "/monitor/health" || req.path === "/monitor/stream") {
      res.status(200).send("ok");
    } else {
      res.status(404).json({ error: "not_found" });
    }
  });

  return { res, nextCalled };
}

test("routes reject without token when enabled", async () => {
  const oldEnabled = process.env.MONITOR_ENABLED;
  const oldToken = process.env.MONITOR_TOKEN;
  process.env.MONITOR_ENABLED = "true";
  process.env.MONITOR_TOKEN = "secret";

  const { res } = simulateRoute("http://localhost/monitor", undefined);
  assert.equal(res.statusCode, 401);

  process.env.MONITOR_ENABLED = oldEnabled;
  process.env.MONITOR_TOKEN = oldToken;
});

test("routes allow query token when enabled", async () => {
  const oldEnabled = process.env.MONITOR_ENABLED;
  const oldToken = process.env.MONITOR_TOKEN;
  process.env.MONITOR_ENABLED = "true";
  process.env.MONITOR_TOKEN = "secret";

  const { res } = simulateRoute("http://localhost/monitor?token=secret", undefined);
  assert.equal(res.statusCode, 200);

  process.env.MONITOR_ENABLED = oldEnabled;
  process.env.MONITOR_TOKEN = oldToken;
});

test("routes allow bearer token when enabled", async () => {
  const oldEnabled = process.env.MONITOR_ENABLED;
  const oldToken = process.env.MONITOR_TOKEN;
  process.env.MONITOR_ENABLED = "true";
  process.env.MONITOR_TOKEN = "secret";

  const { res } = simulateRoute("http://localhost/monitor/health", "Bearer secret");
  assert.equal(res.statusCode, 200);

  process.env.MONITOR_ENABLED = oldEnabled;
  process.env.MONITOR_TOKEN = oldToken;
});

test("routes allow bearer token on stream endpoint", async () => {
  const oldEnabled = process.env.MONITOR_ENABLED;
  const oldToken = process.env.MONITOR_TOKEN;
  process.env.MONITOR_ENABLED = "true";
  process.env.MONITOR_TOKEN = "secret";

  const { res } = simulateRoute("http://localhost/monitor/stream", "Bearer secret");
  assert.equal(res.statusCode, 200);

  process.env.MONITOR_ENABLED = oldEnabled;
  process.env.MONITOR_TOKEN = oldToken;
});

test("routes return 404 when monitoring disabled", async () => {
  const oldEnabled = process.env.MONITOR_ENABLED;
  const oldToken = process.env.MONITOR_TOKEN;
  process.env.MONITOR_ENABLED = "false";
  process.env.MONITOR_TOKEN = "secret";

  const { res } = simulateRoute("http://localhost/monitor", undefined);
  assert.equal(res.statusCode, 404);

  process.env.MONITOR_ENABLED = oldEnabled;
  process.env.MONITOR_TOKEN = oldToken;
});
