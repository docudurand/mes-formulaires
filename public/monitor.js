const MAX_VISIBLE_LOGS = 200;
const STATUS_CLASSES = {
  ok: "monitor__status--ok",
  error: "monitor__status--error",
};

function formatLine(entry) {
  const ts = entry.ts || "";
  const level = (entry.level || "info").toUpperCase();
  const msg = entry.message || "";
  return `[${ts}] [${level}] ${msg}`;
}

function appendLog(entry, listEl) {
  const li = document.createElement("li");
  li.className = `log log--${entry.level || "info"}`;
  li.textContent = formatLine(entry);
  listEl.appendChild(li);

  while (listEl.children.length > MAX_VISIBLE_LOGS) {
    listEl.removeChild(listEl.firstChild);
  }
}

function setStatus(statusEl, state, label) {
  if (!statusEl) return;
  const normalized = state === "error" ? "error" : "ok";
  statusEl.classList.remove(STATUS_CLASSES.ok, STATUS_CLASSES.error);
  statusEl.classList.add(STATUS_CLASSES[normalized]);
  statusEl.textContent = label || (normalized === "error" ? "ERREUR" : "OK");
}

async function fetchHealthStatus(statusEl) {
  try {
    const res = await fetch("/monitor/health", {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error("health_fetch_failed");
    const data = await res.json();
    setStatus(statusEl, data?.status === "error" ? "error" : "ok");
  } catch {
    setStatus(statusEl, "error");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const listEl = document.getElementById("monitor-log-list");
  const statusEl = document.getElementById("monitor-status");
  if (!listEl) return;

  fetchHealthStatus(statusEl);

  const source = new EventSource("/monitor/stream");
  source.addEventListener("log", (event) => {
    try {
      const entry = JSON.parse(event.data || "{}");
      appendLog(entry, listEl);
      if (String(entry.level || "").toLowerCase() === "error") {
        setStatus(statusEl, "error");
      }
    } catch {
      // Ignore malformed entries.
    }
  });

  source.addEventListener("error", () => {
    setStatus(statusEl, "error");
  });
});
