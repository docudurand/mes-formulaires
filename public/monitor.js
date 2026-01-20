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

function normalizeLevel(entry) {
  return String(entry?.level || "info").toLowerCase();
}

function matchesFilter(entry, filter) {
  if (!filter || filter === "all") return true;
  return normalizeLevel(entry) === filter;
}

function buildSearchText(entry) {
  const message = String(entry?.message || "");
  let context = "";
  try {
    context = entry?.context ? JSON.stringify(entry.context) : "";
  } catch {
    context = "";
  }
  return `${message} ${context}`.toLowerCase();
}

function matchesSearch(entry, term) {
  const normalized = String(term || "").trim().toLowerCase();
  if (!normalized) return true;
  return buildSearchText(entry).includes(normalized);
}

function scrollToBottom(listEl) {
  listEl.scrollTop = listEl.scrollHeight;
}

function renderList(entries, listEl, filter, searchTerm, autoScroll = false) {
  listEl.textContent = "";
  const filtered = entries.filter(
    (entry) => matchesFilter(entry, filter) && matchesSearch(entry, searchTerm)
  );
  const visible =
    filtered.length > MAX_VISIBLE_LOGS
      ? filtered.slice(filtered.length - MAX_VISIBLE_LOGS)
      : filtered;
  visible.forEach((entry) => appendLog(entry, listEl));
  if (autoScroll) {
    scrollToBottom(listEl);
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

function setPausedState(buttonEl, isPaused) {
  if (!buttonEl) return;
  buttonEl.textContent = isPaused ? "Reprendre" : "Pause";
  buttonEl.classList.toggle("monitor__button--paused", isPaused);
}

document.addEventListener("DOMContentLoaded", () => {
  const listEl = document.getElementById("monitor-log-list");
  const statusEl = document.getElementById("monitor-status");
  const filterEl = document.getElementById("monitor-filter");
  const searchEl = document.getElementById("monitor-search");
  const pauseEl = document.getElementById("monitor-pause");
  if (!listEl) return;

  const entries = [];
  let currentFilter = filterEl?.value || "all";
  let searchTerm = searchEl?.value || "";
  let isPaused = false;

  if (filterEl) {
    filterEl.addEventListener("change", () => {
      currentFilter = filterEl.value || "all";
      renderList(entries, listEl, currentFilter, searchTerm, !isPaused);
    });
  }

  if (searchEl) {
    searchEl.addEventListener("input", () => {
      searchTerm = searchEl.value || "";
      renderList(entries, listEl, currentFilter, searchTerm, !isPaused);
    });
  }

  if (pauseEl) {
    setPausedState(pauseEl, isPaused);
    pauseEl.addEventListener("click", () => {
      isPaused = !isPaused;
      setPausedState(pauseEl, isPaused);
      if (!isPaused) {
        renderList(entries, listEl, currentFilter, searchTerm, true);
      }
    });
  }

  fetchHealthStatus(statusEl);

  const source = new EventSource("/monitor/stream");
  source.addEventListener("log", (event) => {
    try {
      const entry = JSON.parse(event.data || "{}");
      entries.push(entry);
      while (entries.length > MAX_VISIBLE_LOGS) {
        entries.shift();
      }

      if (!isPaused && matchesFilter(entry, currentFilter) && matchesSearch(entry, searchTerm)) {
        appendLog(entry, listEl);
        scrollToBottom(listEl);
      }

      if (normalizeLevel(entry) === "error") {
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
