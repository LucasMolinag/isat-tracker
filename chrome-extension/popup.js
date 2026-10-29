import { getStatuses, setStatus, STATUS } from "./lib/status.js";

const $ = (id) => document.getElementById(id);

const btnAuth = $("btn-auth");
const btnRefresh = $("btn-refresh");
const btnDisconnect = $("btn-disconnect");
const statusEl = $("status");
const listEl = $("list");
const metaEl = $("meta");

/** @type {Array<object>} */
let currentEmails = [];

function setStatusMsg(text, isError = false) {
  statusEl.textContent = text || "";
  statusEl.classList.toggle("error", Boolean(isError));
}

function send(type, payload = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, ...payload }, (response) => {
      const err = chrome.runtime.lastError;
      if (err) {
        resolve({ ok: false, error: err.message });
        return;
      }
      resolve(response || { ok: false, error: "No response" });
    });
  });
}

function formatWhen(iso) {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function chipClass(status) {
  if (status === STATUS.Read) return "chip chip-read";
  if (status === STATUS.Submitted) return "chip chip-submitted";
  return "chip chip-unread";
}

/**
 * @param {Array<object>} emails
 * @param {Record<string, string>} statusById
 */
function renderEmails(emails, statusById) {
  currentEmails = emails || [];
  listEl.innerHTML = "";
  if (!currentEmails.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent =
      "No matching Jira survey emails. Try Refresh after Connect.";
    listEl.appendChild(empty);
    return;
  }

  for (const entry of currentEmails) {
    const status = statusById[entry.id] || STATUS.Unread;
    const li = document.createElement("li");
    li.className = "card";

    const top = document.createElement("div");
    top.className = "card-top";

    const chip = document.createElement("span");
    chip.className = chipClass(status);
    chip.textContent = status;
    chip.title =
      status === STATUS.Unread
        ? "Not opened yet"
        : status === STATUS.Read
          ? "Open Form was clicked"
          : "Marked submitted (Sheet match — coming later)";
    top.appendChild(chip);

    const subject = document.createElement("p");
    subject.className = "subject";
    subject.textContent = entry.subject;
    top.appendChild(subject);
    li.appendChild(top);

    const meta = document.createElement("p");
    meta.className = "meta-row";
    const bits = [];
    if (entry.ticketKey) bits.push(entry.ticketKey);
    if (entry.receivedAt) bits.push(formatWhen(entry.receivedAt));
    if (!entry.formUrl) bits.push("no form link");
    meta.textContent = bits.join(" · ");
    li.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "actions";

    if (entry.ticketUrl) {
      const ticket = document.createElement("a");
      ticket.href = entry.ticketUrl;
      ticket.target = "_blank";
      ticket.rel = "noopener noreferrer";
      ticket.textContent = "Open Ticket";
      ticket.title = entry.ticketKey
        ? `Open ${entry.ticketKey} in Jira`
        : "Open ticket";
      actions.appendChild(ticket);
    }

    const form = document.createElement("a");
    form.textContent = "Open Form";
    if (entry.formUrl) {
      // Use button-like link: do NOT use target=_blank directly — the popup
      // closes as soon as a new tab opens, aborting async setStatus.
      form.href = entry.formUrl;
      form.rel = "noopener noreferrer";
      form.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const messageId = entry.id;
        const formUrl = entry.formUrl;
        if (!messageId || !formUrl) return;

        // Persist Read BEFORE opening a tab (popup may unload right after).
        await setStatus(messageId, STATUS.Read);

        try {
          await chrome.tabs.create({ url: formUrl, active: true });
        } catch {
          // Fallback if tabs API unavailable
          window.open(formUrl, "_blank", "noopener,noreferrer");
        }

        // Re-render if popup is still open.
        if (document.body) {
          await paintEmails(currentEmails);
        }
      });
    } else {
      form.className = "disabled";
      form.href = "#";
      form.addEventListener("click", (e) => e.preventDefault());
    }
    actions.appendChild(form);

    li.appendChild(actions);
    listEl.appendChild(li);
  }
}

async function paintEmails(emails) {
  const statuses = await getStatuses((emails || []).map((e) => e.id));
  renderEmails(emails || [], statuses);
  const counts = { Unread: 0, Read: 0, Submitted: 0 };
  for (const id of Object.keys(statuses)) {
    counts[statuses[id]] = (counts[statuses[id]] || 0) + 1;
  }
  metaEl.textContent = `${(emails || []).length} emails · ${counts.Unread} unread · ${counts.Read} read`;
}

function setConnectedUi(connected) {
  btnAuth.hidden = connected;
  btnRefresh.hidden = !connected;
  btnDisconnect.hidden = !connected;
  if (!connected) {
    btnAuth.textContent = "Connect Google";
  }
}

async function loadFromCache() {
  const data = await chrome.storage.session.get(["connected", "cache"]);
  setConnectedUi(Boolean(data.connected));
  if (data.cache?.emails) {
    await paintEmails(data.cache.emails);
  }
}

async function refresh() {
  setStatusMsg("Loading surveys…");
  btnRefresh.disabled = true;
  btnAuth.disabled = true;
  try {
    const res = await send("FETCH_SURVEYS");
    if (!res.ok) {
      setStatusMsg(res.error || "Failed to load", true);
      return;
    }
    setConnectedUi(true);
    await paintEmails(res.emails);
    setStatusMsg("Up to date");
  } finally {
    btnRefresh.disabled = false;
    btnAuth.disabled = false;
  }
}

btnAuth.addEventListener("click", async () => {
  setStatusMsg("Connecting to Google…");
  btnAuth.disabled = true;
  try {
    const res = await send("CONNECT");
    if (!res.ok) {
      setStatusMsg(res.error || "Connect failed", true);
      return;
    }
    setConnectedUi(true);
    await refresh();
  } finally {
    btnAuth.disabled = false;
  }
});

btnRefresh.addEventListener("click", () => {
  refresh();
});

btnDisconnect.addEventListener("click", async () => {
  await send("DISCONNECT");
  setConnectedUi(false);
  listEl.innerHTML = "";
  metaEl.textContent = "";
  currentEmails = [];
  setStatusMsg("Disconnected");
});

loadFromCache().then(() => {
  chrome.storage.session.get("connected").then((data) => {
    if (data.connected) refresh();
  });
});
