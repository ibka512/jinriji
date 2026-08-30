const state = {
  view: localStorage.getItem("jinriji:view") || "today",
  theme: localStorage.getItem("jinriji:theme") || "sage",
  entries: JSON.parse(localStorage.getItem("jinriji:entries") || "[]"),
  glass: localStorage.getItem("jinriji:glass") !== "off",
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
const toastMessage = document.querySelector("#toast-message");
const toastAction = document.querySelector("#toast-action");

function selectEntryType(type = "note") {
  document.querySelectorAll("[data-entry-type]").forEach((item) => item.classList.toggle("is-active", item.dataset.entryType === type));
  const details = document.querySelector("#entry-details");
  details.hidden = !["task", "schedule", "course"].includes(type);
  const title = document.querySelector("#compose-title");
  title.textContent = type === "course" ? "添加哪一门课程？" : type === "task" ? "接下来要做什么？" : type === "schedule" ? "把什么安排进时间？" : "此刻想到什么？";
}

function openCompose(type = "note") {
  selectEntryType(type);
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

function showToast(message, action = null) {
  toastMessage.textContent = message;
  toastAction.hidden = !action;
  toastAction.onclick = action ? () => {
    action();
    toast.classList.remove("is-showing");
  } : null;
  toast.classList.add("is-showing");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("is-showing"), 2200);
}

function safeHTML(text) {
  return String(text).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]);
}

function createNoteCard(entry) {
  const list = document.querySelector("#notes-list");
  const article = document.createElement("article");
  article.className = "note-card paper-card user-entry";
  article.dataset.entryId = entry.id;
  const typeLabel = { note: "随记", task: "待办", schedule: "日程", course: "课程" }[entry.type] || "随记";
  const text = safeHTML(entry.text);
  const detail = [entry.date, entry.time].filter(Boolean).join(" · ");
  article.innerHTML = `<span class="eyebrow">${typeLabel} · 自建</span><h2>${text.slice(0, 16)}${text.length > 16 ? "…" : ""}</h2><p>${text}</p><footer><span>${detail || "# 今日新记"}</span><span class="note-actions">${entry.type === "note" ? `<button type="button" data-entry-convert="${entry.id}">转为待办</button>` : ""}<button type="button" data-entry-delete="${entry.id}" aria-label="删除这条记录">删除</button></span></footer>`;
  list.prepend(article);
}

function renderEntries() {
  document.querySelectorAll(".user-entry").forEach((element) => element.remove());
  const taskList = document.querySelector("#user-task-list");
  const courseList = document.querySelector("#user-course-list");
  taskList.innerHTML = '<span class="task-group__label">新近添加</span>';
  courseList.innerHTML = "";

  state.entries.slice().reverse().forEach(createNoteCard);
  state.entries.filter((entry) => entry.type === "task").forEach((entry) => {
    const row = document.createElement("label");
    row.className = "task-row user-entry";
    row.dataset.entryId = entry.id;
    row.innerHTML = `<input type="checkbox" data-entry-check="${entry.id}" ${entry.done ? "checked" : ""}/><i></i><span><strong>${safeHTML(entry.text)}</strong><small>${[entry.date || "今天", entry.time].filter(Boolean).join(" · ")}</small></span>`;
    taskList.append(row);
  });
  state.entries.filter((entry) => entry.type === "course").forEach((entry) => {
    const card = document.createElement("article");
    card.className = "course-card paper-card user-entry";
    card.dataset.entryId = entry.id;
    card.innerHTML = `<span class="course-card__mark">${safeHTML(entry.text).slice(0, 1)}</span><span class="eyebrow">自建课程</span><h2>${safeHTML(entry.text)}</h2><p>${[entry.date || "待安排", entry.time].filter(Boolean).join(" · ")}</p><footer><span>课程记录</span><span>可继续关联待办</span></footer>`;
    courseList.append(card);
  });
  const remaining = state.entries.filter((entry) => entry.type === "task" && !entry.done).length + 2;
  document.querySelector("#task-count").textContent = String(remaining);
}

function persistEntries() {
  localStorage.setItem("jinriji:entries", JSON.stringify(state.entries));
  renderEntries();
}

function saveEntry() {
  const text = quickEntry.value.trim();
  if (!text) {
    quickEntry.focus();
    showToast("先写下一点什么吧");
    return;
  }
  const type = document.querySelector("[data-entry-type].is-active")?.dataset.entryType || "note";
  const entry = {
    id: crypto.randomUUID?.() || String(Date.now()),
    text,
    type,
    date: document.querySelector("#entry-date").value,
    time: document.querySelector("#entry-time").value,
    done: false,
    createdAt: new Date().toISOString(),
  };
  state.entries.unshift(entry);
  persistEntries();
  quickEntry.value = "";
  document.querySelector("#entry-date").value = "";
  document.querySelector("#entry-time").value = "";
  closeCompose();
  showToast(type === "task" ? "已经加入今日待办" : type === "course" ? "课程已经添加" : "已经收进今日记");
}

function setPlanTab(name) {
  document.querySelectorAll("[data-plan-tab]").forEach((button) => {
    const active = button.dataset.planTab === name;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll("[data-plan-panel]").forEach((panel) => panel.classList.toggle("is-active", panel.dataset.planPanel === name));
}

function exportData() {
  const payload = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), theme: state.theme, glass: state.glass, entries: state.entries }, null, 2);
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
  link.download = `今日记-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
  showToast("数据已经导出");
}

function importData(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const payload = JSON.parse(reader.result);
      if (!Array.isArray(payload.entries)) throw new Error("Invalid entries");
      state.entries = payload.entries;
      persistEntries();
      if (payload.theme && themeMap[payload.theme]) applyTheme(payload.theme);
      showToast("数据已经恢复");
    } catch {
      showToast("无法读取这个备份文件");
    }
  };
  reader.readAsText(file);
}

document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view, true)));
document.querySelectorAll("[data-view-jump]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.viewJump, true)));
document.querySelectorAll("[data-open-compose]").forEach((button) => button.addEventListener("click", () => openCompose(button.dataset.composeType || "note")));
document.querySelectorAll("[data-close-compose]").forEach((button) => button.addEventListener("click", closeCompose));
document.querySelector("#save-entry").addEventListener("click", saveEntry);
document.querySelectorAll("[data-entry-type]").forEach((button) => button.addEventListener("click", () => selectEntryType(button.dataset.entryType)));
document.querySelectorAll(".check-button").forEach((button) => button.addEventListener("click", () => {
  const done = button.classList.toggle("is-done");
  button.setAttribute("aria-pressed", String(done));
  showToast(done ? "完成了一件事" : "已恢复待办");
}));
document.querySelectorAll(".theme-dot").forEach((button) => button.addEventListener("click", () => applyTheme(button.dataset.theme)));
document.querySelector("#glass-toggle").addEventListener("change", (event) => {
  state.glass = event.target.checked;
  localStorage.setItem("jinriji:glass", state.glass ? "on" : "off");
  document.body.classList.toggle("no-glass", !state.glass);
  showToast(event.target.checked ? "液态玻璃已经开启" : "已切换为实色表面");
});
document.querySelectorAll(".filter-row button").forEach((button) => button.addEventListener("click", () => {
  button.parentElement.querySelectorAll("button").forEach((item) => item.classList.toggle("is-active", item === button));
}));
document.querySelectorAll("[data-plan-tab]").forEach((button) => button.addEventListener("click", () => setPlanTab(button.dataset.planTab)));
document.querySelector("#export-data").addEventListener("click", exportData);
document.querySelector("#import-data").addEventListener("change", (event) => importData(event.target.files[0]));

document.addEventListener("click", (event) => {
  const convert = event.target.closest("[data-entry-convert]");
  const remove = event.target.closest("[data-entry-delete]");
  if (convert) {
    const entry = state.entries.find((item) => item.id === convert.dataset.entryConvert);
    if (entry) {
      entry.type = "task";
      persistEntries();
      setView("plan", true);
      setPlanTab("tasks");
      showToast("已经转为待办");
    }
  }
  if (remove) {
    const deletedIndex = state.entries.findIndex((item) => item.id === remove.dataset.entryDelete);
    const deletedEntry = state.entries[deletedIndex];
    state.entries = state.entries.filter((item) => item.id !== remove.dataset.entryDelete);
    persistEntries();
    showToast("记录已删除", () => {
      state.entries.splice(Math.max(0, deletedIndex), 0, deletedEntry);
      persistEntries();
      showToast("记录已经恢复");
    });
  }
});

document.addEventListener("change", (event) => {
  const checkbox = event.target.closest("[data-entry-check]");
  if (!checkbox) return;
  const entry = state.entries.find((item) => item.id === checkbox.dataset.entryCheck);
  if (entry) {
    entry.done = checkbox.checked;
    persistEntries();
    showToast(entry.done ? "完成了一件事" : "已恢复待办");
  }
});

document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && composeLayer.classList.contains("is-open")) saveEntry();
  if (event.key === "Escape" && composeLayer.classList.contains("is-open")) closeCompose();
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    openCompose("note");
  }
});

renderEntries();
applyTheme(state.theme);
document.querySelector("#glass-toggle").checked = state.glass;
document.body.classList.toggle("no-glass", !state.glass);
setView(state.view);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}
