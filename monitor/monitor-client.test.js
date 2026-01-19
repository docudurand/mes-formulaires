import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const htmlPath = path.join(__dirname, "..", "public", "monitor.html");
const jsPath = path.join(__dirname, "..", "public", "monitor.js");

function read(pathname) {
  return fs.readFileSync(pathname, "utf8");
}

test("monitor.html contains log list container", () => {
  const html = read(htmlPath);
  assert.ok(html.includes("monitor-log-list"));
});

test("monitor.html contains status element", () => {
  const html = read(htmlPath);
  assert.ok(html.includes("monitor-status"));
});

test("monitor.html starts with ok status badge", () => {
  const html = read(htmlPath);
  assert.ok(html.includes("monitor__status--ok"));
});

test("monitor.html contains filter control", () => {
  const html = read(htmlPath);
  assert.ok(html.includes("monitor-filter"));
});

test("monitor.html contains search and pause controls", () => {
  const html = read(htmlPath);
  assert.ok(html.includes("monitor-search"));
  assert.ok(html.includes("monitor-pause"));
});

test("monitor.html contains export control", () => {
  const html = read(htmlPath);
  assert.ok(html.includes("monitor-export"));
});

test("monitor.js uses EventSource", () => {
  const js = read(jsPath);
  assert.ok(js.includes("new EventSource"));
  assert.ok(js.includes("/monitor/stream"));
});

test("monitor.js loads health status", () => {
  const js = read(jsPath);
  assert.ok(js.includes("/monitor/health"));
});

test("monitor.js toggles status classes", () => {
  const js = read(jsPath);
  assert.ok(js.includes("monitor__status--ok"));
  assert.ok(js.includes("monitor__status--error"));
});

test("monitor.js applies log filtering", () => {
  const js = read(jsPath);
  assert.ok(js.includes("monitor-filter"));
  assert.ok(js.includes("matchesFilter"));
});

test("monitor.js applies keyword search and pause", () => {
  const js = read(jsPath);
  assert.ok(js.includes("matchesSearch"));
  assert.ok(js.includes("monitor-search"));
  assert.ok(js.includes("monitor-pause"));
});

test("monitor.js handles export", () => {
  const js = read(jsPath);
  assert.ok(js.includes("/monitor/logs"));
  assert.ok(js.includes("monitor-export"));
});

test("monitor.js handles SSE errors", () => {
  const js = read(jsPath);
  assert.ok(js.includes("addEventListener(\"error\""));
});
