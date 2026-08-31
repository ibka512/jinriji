import type { Course, Item, TimetableData } from "../../domain/models";
import { addDays, courseOccurrences, emptyTimetable } from "../../domain/timetable";
import { courseSummary, renderCourseDetails, renderTimetable, type CourseView } from "../courses/render";
import { appointments, dayKey, itemDay, itemTime, momentLabel, startOfWeek, taskGroup, taskGroupNames, type Appointment, type TaskGroup } from "../../domain/dates";
import { query, safeHTML as escape } from "../../ui/dom";
import { filterRecords, repeatNames, tagKey } from "../../domain/organization";
import { documentHTML } from "../../domain/note-document";
import { documentReferences } from "../../domain/notebooks";
import { hydrateImages } from "./local-images";

export interface Selection { entity: "item" | "course"; id: string }
export interface RenderOptions {
  search: string;
  filter: string;
  weekOffset: number;
  completedOpen: boolean;
  selection?: Selection;
  timetable: TimetableData;
  courseView: CourseView;
  tag?: string;
  pinnedOnly?: boolean;
  selecting?: boolean;
  selected?: Map<string, number>;
  notebookId?: string;
}
const labels = { note: "便签", task: "待办", event: "日程" };
const empty = (message: string, type?: string, action = "添加第一条记录"): string => `<div class="empty-state"><p>${message}</p>${type ? `<button class="secondary-button" data-open-compose data-compose-type="${type}">${action}</button>` : ""}</div>`;
const openAttrs = (id: string, entity = "item"): string => `data-entry-open="${escape(id)}" data-entity="${entity}"`;

const pinIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 3 8 0-1 7 4 4v2H5v-2l4-4Zm4 13v6"/></svg>';
function noteCard(item: Item, selected = false, options?: RenderOptions): string {
  const picking = Boolean(options?.selecting); const picked = options?.selected?.has(item.id);
  const attrs = picking ? `data-record-select="${escape(item.id)}" aria-pressed="${Boolean(picked)}"` : `${openAttrs(item.id)} ${selected ? 'aria-current="true"' : ""}`;
  const tags = item.tags || [];
  return `<article class="note-card paper-card user-entry${selected || picked ? " is-selected" : ""}" data-entry-id="${escape(item.id)}"><button class="record-open" ${attrs}>${picking ? `<span class="record-pick" aria-hidden="true">${picked ? "✓" : ""}</span>` : ""}<span class="eyebrow">${labels[item.kind]}${item.pinned ? " · 置顶" : ""}${item.status === "completed" ? " · 已完成" : item.status === "archived" ? " · 已归档" : ""}</span><h2>${escape(item.title)}</h2>${item.body !== item.title ? `<p>${escape(item.body.slice(0, 240))}</p>` : ""}<span class="record-meta">${escape(momentLabel(itemTime(item) || item.updatedAt, itemTime(item) ? item.allDay : false, item.dateOnly))}${item.repeat ? ` · ${repeatNames[item.repeat.frequency]}` : ""}</span>${tags.length ? `<span class="record-tags">${tags.slice(0, 3).map(tag => `<span>#${escape(tag)}</span>`).join("")}${tags.length > 3 ? `<span>+${tags.length - 3}</span>` : ""}</span>` : ""}</button>${!picking ? `<button class="record-pin${item.pinned ? " is-pinned" : ""}" data-record-pin="${escape(item.id)}" aria-label="${item.pinned ? "取消置顶" : "置顶"}：${escape(item.title)}" aria-pressed="${Boolean(item.pinned)}">${pinIcon}</button>` : ""}</article>`;
}

export function taskRow(item: Item): string {
  const done = item.status === "completed";
  return `<div class="task-row user-entry${done ? " is-completed" : ""}" data-entry-id="${escape(item.id)}"><label class="task-check"><input type="checkbox" data-entry-check="${escape(item.id)}" aria-label="${done ? "恢复待办" : "完成"}：${escape(item.title)}" ${done ? "checked" : ""}/><i aria-hidden="true"></i></label><button class="task-open" ${openAttrs(item.id)}><strong>${escape(item.title)}</strong><small>${escape(momentLabel(item.dueAt, item.allDay, item.dateOnly))}${item.repeat ? ` · ${repeatNames[item.repeat.frequency]}` : ""}</small></button></div>`;
}

function appointmentRow(entry: Appointment): string {
  const label = entry.allDay ? "全天" : new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(entry.at));
  return `<button class="agenda-entry" ${openAttrs(entry.id, entry.entity)}><time>${label}</time><span>${escape(entry.title)}</span><small>${entry.entity === "course" ? "课程" : ""}</small></button>`;
}

export function renderNotes(items: Item[], options: RenderOptions): void {
  const filtered = filterRecords(items, options.search, options.filter, options.tag, options.pinnedOnly).filter(item => !options.notebookId || (options.notebookId === "unfiled" ? item.kind === "note" && !item.notebookId : item.notebookId === options.notebookId));
  const visible = new Set(filtered.map(item => item.id));
  for (const id of options.selected?.keys() || []) if (!visible.has(id)) options.selected?.delete(id);
  const tags = new Map<string, string>();
  for (const item of items) if (!item.deletedAt) for (const tag of item.tags || []) tags.set(tagKey(tag), tag);
  if (options.tag) tags.set(tagKey(options.tag), options.tag);
  query<HTMLSelectElement>("#record-tag-filter").innerHTML = '<option value="">全部标签</option>' + [...tags.values()].sort((a, b) => a.localeCompare(b, "zh-CN")).map(tag => `<option value="${escape(tag)}" ${tag === options.tag ? "selected" : ""}>${escape(tag)}</option>`).join("");
  query<HTMLElement>("#record-tag-label").hidden = !tags.size;
  query("#pinned-only").setAttribute("aria-pressed", String(Boolean(options.pinnedOnly)));
  query("#organize-toggle").textContent = options.selecting ? "取消" : "整理";
  query("#organize-toggle").setAttribute("aria-pressed", String(Boolean(options.selecting)));
  query<HTMLElement>("#bulk-toolbar").hidden = !options.selecting;
  query("#selection-count").textContent = `已选 ${options.selected?.size || 0} 项`;
  query("#select-visible").textContent = filtered.length && options.selected?.size === filtered.length ? "取消全选" : "全选";
  document.querySelectorAll<HTMLButtonElement>("[data-bulk-action]").forEach(button => {
    button.disabled = !options.selected?.size || (button.dataset.bulkAction === "complete" && !filtered.some(item => options.selected?.has(item.id) && item.kind === "task" && item.status === "open"));
  });
  query("#notes-list").innerHTML = filtered.length ? filtered.map(item => noteCard(item, options.selection?.entity === "item" && options.selection.id === item.id, options)).join("")
    : options.search || options.filter !== "all" || options.tag || options.pinnedOnly ? empty("没有找到记录") : empty("还没有记录", "note");
  query("#search-summary").textContent = `${filtered.length} 条记录`;
}

export function renderDetail(items: Item[], courses: Course[], selection?: Selection, timetable = emptyTimetable()): void {
  const target = query<HTMLElement>("#entry-detail");
  const writing = document.body.classList.contains("note-writing");
  target.hidden = !selection || writing;
  query(".records-workspace").classList.toggle("has-detail", Boolean(selection) || writing);
  query("#view-notes").classList.toggle("has-detail", Boolean(selection) || writing);
  if (!selection) { target.innerHTML = ""; return; }
  const item = selection.entity === "item" ? items.find(item => item.id === selection.id && !item.deletedAt) : undefined;
  const course = selection.entity === "course" ? courses.find(course => course.id === selection.id && !course.deletedAt) : undefined;
  const record = item || course;
  const back = '<button class="text-button" data-detail-back>‹ 返回</button>';
  if (!record) { target.innerHTML = `${back}<h2 id="detail-title" tabindex="-1">记录已移除</h2><p>可以到“最近删除”中恢复。</p>`; return; }
  const title = item?.title ?? course!.name;
  const moment = item ? momentLabel(itemTime(item), item.allDay, item.dateOnly) : course!.termId ? courseSummary(course!, timetable) : momentLabel(course!.firstMeetingAt, course!.allDay, course!.dateOnly);
  const attr = `data-entity="${selection.entity}"`;
  target.innerHTML = `<div class="detail-toolbar">${back}<button class="secondary-button" data-entry-edit="${escape(record.id)}" ${attr}>编辑</button></div><span class="eyebrow">${item ? labels[item.kind] : "课程"}</span><h2 id="detail-title" tabindex="-1">${escape(title)}</h2>${!item || item.kind !== "note" ? `<p class="record-meta">${escape(moment)}</p>` : ""}<div class="detail-body">${escape(item?.body === title ? "" : item?.body ?? "")}</div>${course?.location ? `<p>${escape(course.location)}</p>` : ""}${course?.instructor ? `<p>${escape(course.instructor)}</p>` : ""}<div class="detail-actions">${item?.kind === "note" ? `<button class="secondary-button" data-entry-convert="${escape(item.id)}">转为待办</button>` : ""}<button class="text-button danger-text" data-entry-delete="${escape(record.id)}" ${attr}>删除</button></div><p class="record-meta">更新于 ${escape(momentLabel(record.updatedAt))}</p>`;
  if (item?.document) {
    const body = target.querySelector<HTMLElement>(".detail-body")!;
    body.classList.add("rich-prose");
    try { body.innerHTML = documentHTML(item.document); }
    catch { body.textContent = item.body; }
  }
  if (item?.kind === "note") target.querySelector<HTMLElement>(".detail-body")!.classList.add("editable-prose");
  if (course) target.insertAdjacentHTML("beforeend", renderCourseDetails(course, items, timetable));
  if (item) {
    target.querySelector(".detail-actions")?.insertAdjacentHTML("afterbegin", `<button class="secondary-button" data-record-pin="${escape(item.id)}" aria-pressed="${Boolean(item.pinned)}">${item.pinned ? "取消置顶" : "置顶"}</button>`);
    if (item.tags?.length) target.querySelector(".detail-body")?.insertAdjacentHTML("beforebegin", `<div class="record-tags">${item.tags.map(tag => `<span>#${escape(tag)}</span>`).join("")}</div>`);
    if (item.repeat) target.querySelector(".detail-body")?.insertAdjacentHTML("beforebegin", `<p class="record-meta">${repeatNames[item.repeat.frequency]} · 按原计划重复</p>`);
    if (item.repeatNextId) target.insertAdjacentHTML("beforeend", `<button class="text-button" ${openAttrs(item.repeatNextId)}>查看下一次待办 →</button>`);
  }
  if (item?.courseId) {
    const associated = courses.find(course => course.id === item.courseId);
    target.querySelector(".detail-body")?.insertAdjacentHTML("beforebegin", associated && !associated.deletedAt
      ? `<button class="course-link" ${openAttrs(associated.id, "course")}>课程 · ${escape(associated.name)} →</button>`
      : '<p class="record-meta">关联课程已移除，记录仍保留。</p>');
  }
  if (item?.sourceNoteId) target.insertAdjacentHTML("beforeend", `<button class="text-button" ${openAttrs(item.sourceNoteId)}>查看来源笔记 →</button>`);
  if (item?.kind === "note") {
    const linked = items.filter(other => !other.deletedAt && other.id !== item.id && (other.sourceNoteId === item.id || documentReferences(other.document).notes.has(item.id)));
    if (linked.length) target.insertAdjacentHTML("beforeend", `<section class="note-backlinks"><h3>关联记录</h3>${linked.map(other => `<button class="text-button" ${openAttrs(other.id)}>${escape(other.title)} →</button>`).join("")}</section>`);
    target.querySelectorAll<HTMLAnchorElement>("a[data-note-id]").forEach(link => {
      if (!items.some(other => other.id === link.dataset.noteId && !other.deletedAt)) { link.classList.add("is-unavailable"); link.title = "关联笔记已移除"; }
    });
  }
  hydrateImages(target);
}

export function renderTimeViews(items: Item[], courses: Course[], options: RenderOptions, now = new Date()): void {
  const today = dayKey(now);
  const tasks = items.filter(item => item.kind === "task" && !item.deletedAt && item.status !== "archived");
  const visibleWeek = startOfWeek(now); visibleWeek.setDate(visibleWeek.getDate() + options.weekOffset * 7);
  const from = [addDays(today, -1), addDays(dayKey(visibleWeek), -1)].sort()[0]!;
  const to = [addDays(today, 420), addDays(dayKey(visibleWeek), 7)].sort().at(-1)!;
  const scheduledCourseIds = new Set(options.timetable.recurrenceRules.map(rule => rule.courseId));
  const allAppointments = appointments(items, courses.filter(course => !scheduledCourseIds.has(course.id)));
  for (const occurrence of courseOccurrences(courses, options.timetable, from, to)) {
    allAppointments.push({ id: occurrence.courseId, entity: "course", title: occurrence.name, at: occurrence.startAt, endAt: occurrence.endAt, day: dayKey(new Date(occurrence.startAt)), allDay: false });
  }
  allAppointments.sort((a, b) => a.day.localeCompare(b.day) || Number(b.allDay) - Number(a.allDay) || Date.parse(a.at) - Date.parse(b.at));
  const next = allAppointments.find(entry => entry.day >= today && (entry.allDay || new Date(entry.endAt || entry.at).valueOf() >= now.valueOf()));
  const todayTasks = tasks.filter(item => itemDay(item) === today);
  const overdue = tasks.filter(item => taskGroup(item, now) === "overdue");
  const openToday = todayTasks.filter(item => item.status === "open");
  const recent = items.find(item => !item.deletedAt && item.kind === "note");
  query("#today-year").textContent = `${now.getFullYear()} 年`;
  query("#today-date").textContent = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(now);
  query("#today-content").innerHTML = `<section class="now-card paper-card"><div class="card-heading"><h2>接下来</h2><button class="text-button" data-view-jump="plan">查看计划</button></div>${next ? `<button class="next-entry" ${openAttrs(next.id, next.entity)}><h3>${escape(next.title)}</h3><p>${escape(momentLabel(next.at, next.allDay, next.dateOnly))}</p></button>` : empty("暂时没有安排", "schedule", "添加日程")}</section><section class="timeline-card paper-card"><div class="card-heading"><h2>今日待办</h2><span class="count-pill" aria-label="今日待办完成数">${todayTasks.filter(item => item.status === "completed").length} / ${todayTasks.length}</span></div>${overdue.length ? `<button class="overdue-notice text-button" data-view-jump="plan" data-jump-tab="tasks">${overdue.length} 项逾期，去处理 →</button>` : ""}${openToday.length ? openToday.map(taskRow).join("") : empty(todayTasks.length ? "今天的待办已完成" : "今天还没有待办", "task", "添加待办")}</section><section class="note-preview paper-card"><div class="card-heading"><h2>最近记录</h2><button class="text-button" data-view-jump="notes">全部记录</button></div>${recent ? `<button class="recent-note" ${openAttrs(recent.id)}><h3>${escape(recent.title)}</h3>${recent.body !== recent.title ? `<p>${escape(recent.body.slice(0, 240))}</p>` : ""}<span class="record-meta">${escape(momentLabel(recent.updatedAt))}</span></button>` : empty("记下此刻的想法", "note", "记一笔")}</section>`;
  query("#task-count").textContent = String(tasks.filter(item => item.status === "open").length);
  const groups: TaskGroup[] = ["overdue", "today", "later", "undated", "completed"];
  query("#user-task-list").innerHTML = tasks.length ? groups.map(group => {
    const entries = tasks.filter(item => taskGroup(item, now) === group).sort((a, b) => (new Date(a.dueAt || 0).valueOf() - new Date(b.dueAt || 0).valueOf()));
    if (!entries.length) return "";
    const rows = entries.map(taskRow).join("");
    return group === "completed" ? `<details class="task-group completed-group" data-completed-group ${options.completedOpen ? "open" : ""}><summary>已完成 · ${entries.length}</summary>${rows}</details>`
      : `<section class="task-group" data-task-group="${group}"><h3 class="task-group__label${group === "overdue" ? " danger-text" : ""}">${taskGroupNames[group]}</h3>${rows}</section>`;
  }).join("") : empty("还没有待办", "task", "添加待办");

  const week = startOfWeek(now);
  week.setDate(week.getDate() + options.weekOffset * 7);
  const end = new Date(week); end.setDate(end.getDate() + 6);
  query("#week-range").textContent = `${week.getMonth() + 1}月${week.getDate()}日 — ${end.getMonth() + 1}月${end.getDate()}日`;
  query("#week-agenda").innerHTML = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(week); date.setDate(date.getDate() + index);
    const key = dayKey(date);
    const entries = allAppointments.filter(entry => entry.day === key);
    return `<section class="agenda-day paper-card${key === today ? " is-today" : ""}"><h3><span>${new Intl.DateTimeFormat("zh-CN", { weekday: "short" }).format(date)}</span><span>${date.getDate()}${key === today ? ' <small>今天</small>' : ""}</span></h3><div>${entries.length ? entries.map(appointmentRow).join("") : '<p class="agenda-empty">无安排</p>'}</div></section>`;
  }).join("");
  const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowEntries = allAppointments.filter(entry => entry.day === dayKey(tomorrow));
  query("#tomorrow-preview").innerHTML = `<div class="card-heading"><h2>明日</h2><span class="count-pill">${tomorrowEntries.length}</span></div>${tomorrowEntries.length ? tomorrowEntries.map(appointmentRow).join("") : empty("暂无安排")}`;
  const offset = (new Date(now.getFullYear(), now.getMonth(), 1).getDay() + 6) % 7;
  const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  query("#mini-calendar").innerHTML = `<div class="card-heading"><h2>${now.getMonth() + 1}月</h2></div><div class="calendar-weekdays">${["一", "二", "三", "四", "五", "六", "日"].map(day => `<span>${day}</span>`).join("")}</div><div class="calendar-days">${'<span></span>'.repeat(offset)}${Array.from({ length: days }, (_, index) => index + 1 === now.getDate() ? `<strong aria-current="date">${index + 1}</strong>` : `<span>${index + 1}</span>`).join("")}</div>`;
  renderTimetable(courses, options.timetable, options.courseView, now);
}

export function renderEntries(allItems: Item[], allCourses: Course[], options: RenderOptions): void {
  const items = allItems.filter(item => !item.deletedAt).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const courses = allCourses.filter(course => !course.deletedAt).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  renderNotes(items, options);
  renderDetail(allItems, allCourses, options.selection, options.timetable);
  renderTimeViews(items, courses, options);
  query("#sidebar-count").textContent = `${items.length} 条记录`;
  query("#user-course-list").innerHTML = courses.length ? courses.map(course => `<article class="course-card paper-card user-entry"><button class="record-open" ${openAttrs(course.id, "course")}><span class="eyebrow">课程</span><h2>${escape(course.name)}</h2><p>${escape(course.termId ? courseSummary(course, options.timetable) : momentLabel(course.firstMeetingAt, course.allDay, course.dateOnly))}</p></button></article>`).join("") : empty("还没有课程");
  const deleted = [...allItems.filter(item => item.deletedAt).map(item => ({ ...item, entity: "item", name: item.title })), ...allCourses.filter(course => course.deletedAt).map(course => ({ ...course, entity: "course" }))].sort((a, b) => b.deletedAt!.localeCompare(a.deletedAt!));
  query("#trash-list").innerHTML = deleted.length ? deleted.map(record => `<div class="trash-row"><div><strong>${escape(record.name)}</strong><small>${escape(momentLabel(record.deletedAt))}</small></div><button class="secondary-button" data-entry-restore="${escape(record.id)}" data-entity="${record.entity}">恢复</button></div>`).join("") : empty("没有已删除的记录");
}
