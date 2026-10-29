import {
  getShowDone,
  getStatuses,
  setDone,
  setShowDone,
  STATUS,
} from "./lib/status.js";

const $ = (id) => document.getElementById(id);

const btnAuth = $("btn-auth");
const btnRefresh = $("btn-refresh");
const btnDisconnect = $("btn-disconnect");
const statusEl = $("status");
const listEl = $("list");
const metaEl = $("meta");
const filterBar = $("filter-bar");
const chkShowDone = $("chk-show-done");

/** @type {Array<object>} */
let currentEmails = [];
/** @type {boolean} */
let showDone = false;

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
 * @param {boolean} includeDone
 */
function renderEmails(emails, statusById, includeDone) {
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

  const visible = currentEmails.filter((entry) => {
    const status = statusById[entry.id] || STATUS.Unread;
    return includeDone || status !== STATUS.Submitted;
  });

  if (!visible.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = includeDone
      ? "No matching Jira survey emails."
      : "All caught up — enable “Show done” to see Submitted items.";
    listEl.appendChild(empty);
    return;
  }

  for (const entry of visible) {
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
          : "Marked done (Submitted)";
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
    form.textContent = "Open Form + Submit";
    form.title =
      "TEST: open prefilled form, auto-click Submit, mark Done locally";
    if (entry.formUrl) {
      form.href = entry.formUrl;
      form.rel = "noopener noreferrer";
      form.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const messageId = entry.id;
        const formUrl = entry.formUrl;
        if (!messageId || !formUrl) return;

        setStatusMsg("Opening form and auto-submitting…");
        const res = await send("OPEN_FORM_AUTOSUBMIT", { messageId, formUrl });
        if (!res.ok) {
          setStatusMsg(res.error || "Open/autosubmit failed", true);
          return;
        }

        if (document.body) {
          await paintEmails(currentEmails);
          setStatusMsg(
            "Form tab opened — Submit runs in the page; Done marks when confirmed.",
          );
        }
      });
    } else {
      form.className = "disabled";
      form.href = "#";
      form.addEventListener("click", (e) => e.preventDefault());
    }
    actions.appendChild(form);

    const doneLabel = document.createElement("label");
    doneLabel.className = "done-label";
    doneLabel.title = "Mark as Submitted (local)";
    const doneBox = document.createElement("input");
    doneBox.type = "checkbox";
    doneBox.checked = status === STATUS.Submitted;
    doneBox.addEventListener("change", async () => {
      doneBox.disabled = true;
      try {
        await setDone(entry.id, doneBox.checked);
        await paintEmails(currentEmails);
      } finally {
        doneBox.disabled = false;
      }
    });
    const doneText = document.createElement("span");
    doneText.textContent = "Done";
    doneLabel.appendChild(doneBox);
    doneLabel.appendChild(doneText);
    actions.appendChild(doneLabel);

    li.appendChild(actions);
    listEl.appendChild(li);
  }
}

async function paintEmails(emails) {
  const list = emails || [];
  const statuses = await getStatuses(list.map((e) => e.id));
  renderEmails(list, statuses, showDone);
  const counts = { Unread: 0, Read: 0, Submitted: 0 };
  for (const entry of list) {
    const s = statuses[entry.id] || STATUS.Unread;
    counts[s] = (counts[s] || 0) + 1;
  }
  const hiddenDone = showDone ? 0 : counts.Submitted;
  const shown = list.length - hiddenDone;
  metaEl.textContent = showDone
    ? `${list.length} emails · ${counts.Unread} unread · ${counts.Read} read · ${counts.Submitted} done`
    : `${shown} shown · ${counts.Submitted} done hidden`;
}

function setConnectedUi(connected) {
  btnAuth.hidden = connected;
  btnRefresh.hidden = !connected;
  btnDisconnect.hidden = !connected;
  filterBar.hidden = !connected;
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

chkShowDone.addEventListener("change", async () => {
  showDone = chkShowDone.checked;
  await setShowDone(showDone);
  await paintEmails(currentEmails);
});

async function initFilter() {
  showDone = await getShowDone();
  chkShowDone.checked = showDone;
}

initFilter()
  .then(() => loadFromCache())
  .then(() => {
    chrome.storage.session.get("connected").then((data) => {
      if (data.connected) refresh();
    });
  });
