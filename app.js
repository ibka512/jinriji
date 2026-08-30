const state = {
  view: localStorage.getItem("jinriji:view") || "today",
  theme: localStorage.getItem("jinriji:theme") || "sage",
  entries: JSON.parse(localStorage.getItem("jinriji:entries") || "[]"),
};

const themeMap = {
  sage: { accent: "#667b68", deep: "#3f5543", soft: "#dfe8dc", tertiary: "#a86448", canvas: "#edf0e9", warm: "#f3eee3" },
  sakura: { accent: "#9d6f78", deep: "#724a54", soft: "#eedde0", tertiary: "#77806a", canvas: "#f2eaea", warm: "#f4eee7" },
  aizome: { accent: "#5a7185", deep: "#344f65", soft: "#dce5eb", tertiary: "#9b674e", canvas: "#e9eef1", warm: "#f0ece5" },
  kaki: { accent: "#a86143", deep: "#74412c", soft: "#f0ddd2", tertiary: "#697861", canvas: "#f0e9e2", warm: "#eee9dc" },
};

function applyTheme(name) {
  const theme = themeMap[name] || themeMap.sage;
  const root = document.documentElement;
  root.style.setProperty("--accent", theme.accent);
  root.style.setProperty("--accent-deep", theme.deep);
  root.style.setProperty("--accent-soft", theme.soft);
  root.style.setProperty("--tertiary", theme.tertiary);
  root.style.setProperty("--canvas", theme.canvas);
  root.style.setProperty("--canvas-warm", theme.warm);
  document.querySelectorAll(".theme-dot").forEach((button) => {
    const selected = button.dataset.theme === name;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-checked", String(selected));
  });
  state.theme = name;
  localStorage.setItem("jinriji:theme", name);
}

function setView(name, focusHeading = false) {
  const target = document.querySelector(`[data-view-panel="${name}"]`);
  if (!target) return;
  document.querySelectorAll("[data-view-panel]").forEach((panel) => panel.classList.toggle("is-active", panel === target));
  document.querySelectorAll("[data-view]").forEach((button) => {
    const active = button.dataset.view === name;
    button.classList.toggle("is-active", active);
    if (active) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
  });
  state.view = name;
  localStorage.setItem("jinriji:view", name);
  if (focusHeading) {
    window.scrollTo({ top: 0, behavior: "smooth" });
    target.querySelector("h1")?.focus({ preventScroll: true });
  }
}

const composeLayer = document.querySelector("#compose-layer");
const quickEntry = document.querySelector("#quick-entry");
const toast = document.querySelector("#toast");

function openCompose() {
  composeLayer.classList.add("is-open");
  composeLayer.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  window.setTimeout(() => quickEntry.focus(), 180);
}

function closeCompose() {
  composeLayer.classList.remove("is-open");
  composeLayer.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-showing");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("is-showing"), 2200);
}

function addNoteCard(entry) {
  const list = document.querySelector("#notes-list");
  const article = document.createElement("article");
  article.className = "note-card paper-card";
  const typeLabel = { note: "随记", task: "待办", schedule: "日程", course: "课程" }[entry.type] || "随记";
  const safeText = entry.text.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]);
  article.innerHTML = `<span class="eyebrow">${typeLabel} · 刚刚</span><h2>${safeText.slice(0, 16)}${safeText.length > 16 ? "…" : ""}</h2><p>${safeText}</p><footer><span># 今日新记</span><time>现在</time></footer>`;
  list.prepend(article);
}

function saveEntry() {
  const text = quickEntry.value.trim();
  if (!text) {
    quickEntry.focus();
    showToast("先写下一点什么吧");
    return;
  }
  const type = document.querySelector("[data-entry-type].is-active")?.dataset.entryType || "note";
  const entry = { id: crypto.randomUUID?.() || String(Date.now()), text, type, createdAt: new Date().toISOString() };
  state.entries.unshift(entry);
  localStorage.setItem("jinriji:entries", JSON.stringify(state.entries));
  addNoteCard(entry);
  quickEntry.value = "";
  closeCompose();
  showToast(type === "task" ? "已经加入今日待办" : "已经收进今日记");
}

document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view, true)));
document.querySelectorAll("[data-view-jump]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.viewJump, true)));
document.querySelectorAll("[data-open-compose]").forEach((button) => button.addEventListener("click", openCompose));
document.querySelectorAll("[data-close-compose]").forEach((button) => button.addEventListener("click", closeCompose));
document.querySelector("#save-entry").addEventListener("click", saveEntry);
document.querySelectorAll("[data-entry-type]").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll("[data-entry-type]").forEach((item) => item.classList.toggle("is-active", item === button));
}));
document.querySelectorAll(".check-button").forEach((button) => button.addEventListener("click", () => {
  const done = button.classList.toggle("is-done");
  button.setAttribute("aria-pressed", String(done));
  showToast(done ? "完成了一件事" : "已恢复待办");
}));
document.querySelectorAll(".theme-dot").forEach((button) => button.addEventListener("click", () => applyTheme(button.dataset.theme)));
document.querySelector("#glass-toggle").addEventListener("change", (event) => {
  document.body.classList.toggle("no-glass", !event.target.checked);
  showToast(event.target.checked ? "液态玻璃已经开启" : "已切换为实色表面");
});
document.querySelectorAll(".filter-row button, .segmented button").forEach((button) => button.addEventListener("click", () => {
  button.parentElement.querySelectorAll("button").forEach((item) => item.classList.toggle("is-active", item === button));
}));

document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && composeLayer.classList.contains("is-open")) saveEntry();
  if (event.key === "Escape" && composeLayer.classList.contains("is-open")) closeCompose();
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    openCompose();
  }
});

state.entries.slice().reverse().forEach(addNoteCard);
applyTheme(state.theme);
setView(state.view);
