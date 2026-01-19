import assert from "node:assert/strict";
import test from "node:test";
import { log } from "./monitor.js";

function createRes() {
  const chunks = [];
  return {
    headers: {},
    statusCode: null,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    write(chunk) {
      chunks.push(String(chunk));
    },
    flushHeaders() {},
    get body() {
      return chunks.join("");
    },
  };
}

function createReq() {
  const handlers = new Map();
  return {
    on(event, handler) {
      handlers.set(event, handler);
    },
    destroy() {
      const handler = handlers.get("close");
      if (handler) handler();
    },
  };
}

test("SSE stream sends log events", async (t) => {
  let routes;
  try {
    routes = await import("./routes.js");
  } catch (err) {
    if (/Cannot find package 'express'/.test(String(err?.message || err))) {
      t.skip("express must be installed to run SSE route tests");
      return;
    }
    throw err;
  }

  const router = routes.default;
  const layer = router.stack.find((l) => l.route && l.route.path === "/stream");
  const handler = layer.route.stack[0].handle;

  const req = createReq();
  const res = createRes();

  handler(req, res);
  log("info", "hello");

  assert.ok(res.body.includes("event: log"));
  assert.ok(res.body.includes("data:"));
});
