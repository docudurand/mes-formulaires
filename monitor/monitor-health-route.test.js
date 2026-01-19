import assert from "node:assert/strict";
import test from "node:test";

function createReq() {
  return {};
}

function createRes() {
  return {
    statusCode: null,
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

test("/monitor/health returns status payload", async (t) => {
  let routes;
  try {
    routes = await import("./routes.js");
  } catch (err) {
    if (/Cannot find package 'express'/.test(String(err?.message || err))) {
      t.skip("express must be installed to run route tests");
      return;
    }
    throw err;
  }

  const router = routes.default;
  const layer = router.stack.find((l) => l.route && l.route.path === "/health");
  const handler = layer.route.stack[0].handle;

  const req = createReq();
  const res = createRes();
  handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.ok(res.body);
  assert.ok("status" in res.body);
  assert.ok("lastErrorAt" in res.body);
});
