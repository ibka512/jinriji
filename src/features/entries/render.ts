import type { Course, Item } from "../../domain/models";
import { query, queryAll, safeHTML } from "../../ui/dom";

function displayMoment(item: Item): string {
  const value = item.dueAt || item.startAt;
  if (!value) return item.kind === "note" ? "" : "未设时间";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "时间待确认";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: item.allDay ? undefined : "2-digit",
    minute: item.allDay ? undefined : "2-digit",
  }).format(date);
}

function createNoteCard(item: Item): HTMLElement {
  const article = document.createElement("article");
  article.className = "note-card paper-card user-entry";
  article.dataset.entryId = item.id;
  const typeLabel = { note: "随记", task: "待办", event: "日程" }[item.kind];
  const title = safeHTML(item.title);
  article.innerHTML = `<span class="eyebrow">${typeLabel}</span><h2>${title.slice(0, 16)}${title.length > 16 ? "…" : ""}</h2><p>${safeHTML(item.body)}</p><footer><span>${displayMoment(item)}</span><span class="note-actions">${item.kind === "note" ? `<button type="button" data-entry-convert="${item.id}">转为待办</button>` : ""}<button type="button" data-entry-delete="${item.id}" aria-label="删除这条记录">删除</button></span></footer>`;
  return article;
}

function createTaskRow(item: Item): HTMLElement {
  const row = document.createElement("label");
  row.className = "task-row user-entry";
  row.dataset.entryId = item.id;
  row.innerHTML = `<input type="checkbox" data-entry-check="${item.id}" ${item.status === "completed" ? "checked" : ""}/><i></i><span><strong>${safeHTML(item.title)}</strong><small>${displayMoment(item)}</small></span>`;
  return row;
}

function createCourseCard(course: Course): HTMLElement {
  const card = document.createElement("article");
  card.className = "course-card paper-card user-entry";
  card.dataset.entryId = course.id;
  const firstMeeting = course.firstMeetingAt ? new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(course.firstMeetingAt)) : "待安排";
  card.innerHTML = `<span class="course-card__mark">${safeHTML(course.name).slice(0, 1)}</span><span class="eyebrow">课程</span><h2>${safeHTML(course.name)}</h2><p>${firstMeeting}</p>`;
  return card;
}

export function renderEntries(items: Item[], courses: Course[]): void {
  queryAll<HTMLElement>(".user-entry").forEach((element) => element.remove());
  const notesList = query<HTMLElement>("#notes-list");
  const taskList = query<HTMLElement>("#user-task-list");
  const courseList = query<HTMLElement>("#user-course-list");
  taskList.innerHTML = '<span class="task-group__label">新近添加</span>';
  courseList.innerHTML = "";

  items.slice().reverse().forEach((item) => notesList.prepend(createNoteCard(item)));
  items.filter((item) => item.kind === "task").forEach((item) => taskList.append(createTaskRow(item)));
  courses.forEach((course) => courseList.append(createCourseCard(course)));

  const remaining = items.filter((item) => item.kind === "task" && item.status !== "completed").length + 2;
  query<HTMLElement>("#task-count").textContent = String(remaining);
}
