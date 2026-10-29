const $ = (id) => document.getElementById(id);

const btnAuth = $("btn-auth");
const btnRefresh = $("btn-refresh");
const btnDisconnect = $("btn-disconnect");
const statusEl = $("status");
const listEl = $("list");
const metaEl = $("meta");

function setStatus(text, isError = false) {
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

function renderEmails(emails) {
  listEl.innerHTML = "";
  if (!emails?.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent =
      "No matching Jira survey emails. Try Refresh after Connect.";
    listEl.appendChild(empty);
    return;
  }

  for (const entry of emails) {
    const li = document.createElement("li");
    li.className = "card";

    const subject = document.createElement("p");
    subject.className = "subject";
    subject.textContent = entry.subject;
    li.appendChild(subject);

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
      form.href = entry.formUrl;
      form.target = "_blank";
      form.rel = "noopener noreferrer";
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
    renderEmails(data.cache.emails);
    metaEl.textContent = `${data.cache.emails.length} emails`;
  }
}

async function refresh() {
  setStatus("Loading surveys…");
  btnRefresh.disabled = true;
  btnAuth.disabled = true;
  try {
    const res = await send("FETCH_SURVEYS");
    if (!res.ok) {
      setStatus(res.error || "Failed to load", true);
      return;
    }
    setConnectedUi(true);
    renderEmails(res.emails);
    metaEl.textContent = `${res.emails.length} emails`;
    setStatus("Up to date");
  } finally {
    btnRefresh.disabled = false;
    btnAuth.disabled = false;
  }
}

btnAuth.addEventListener("click", async () => {
  setStatus("Connecting to Google…");
  btnAuth.disabled = true;
  try {
    const res = await send("CONNECT");
    if (!res.ok) {
      const err = res.error || "Connect failed";
      // Surface bad-client guidance without burying it.
      setStatus(err, true);
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
  setStatus("Disconnected");
});

loadFromCache().then(() => {
  // Auto-refresh if already connected this session.
  chrome.storage.session.get("connected").then((data) => {
    if (data.connected) refresh();
  });
});
