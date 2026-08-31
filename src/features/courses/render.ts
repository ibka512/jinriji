import type { Course, Item, Term, TimetableData } from "../../domain/models";
import { dayKey } from "../../domain/dates";
import { academicWeek, addDays, courseOccurrences, ruleLabel, weekday, zonedFields, type CourseOccurrence } from "../../domain/timetable";
import { query, safeHTML as escape } from "../../ui/dom";

export interface CourseView { termId: string; week: number; day: number }
export function selectedTerm(data: TimetableData, view: CourseView): Term | undefined {
  return data.terms.find(term => term.id === view.termId) || data.terms.find(term => term.isActive) || data.terms[0];
}
export function selectedWeek(term: Term, view: CourseView, now = new Date()): number {
  return Math.min(term.totalWeeks, Math.max(1, view.week || academicWeek(term, zonedFields(now, term.timeZone).date)));
}
const occurrenceAttrs = (entry: CourseOccurrence): string => `data-occurrence-rule="${escape(entry.ruleId)}" data-occurrence-date="${entry.originalDate}"`;
const timeMinutes = (value: string): number => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));

/** Lanes include the 44px touch target and 4px gap, so short adjacent classes cannot cover each other. */
export function occurrenceLanes(entries: CourseOccurrence[]): { entry: CourseOccurrence; lane: number; lanes: number }[] {
  const result: { entry: CourseOccurrence; lane: number; lanes: number }[] = [];
  const sorted = [...entries].sort((a, b) => a.startTime.localeCompare(b.startTime));
  let group: typeof result = [];
  let ends: number[] = [];
  const flush = (): void => { for (const item of group) { item.lanes = ends.length; result.push(item); } group = []; ends = []; };
  for (const entry of sorted) {
    const start = timeMinutes(entry.startTime);
    if (ends.length && start >= Math.max(...ends)) flush();
    let lane = ends.findIndex(end => end <= start);
    if (lane < 0) lane = ends.length;
    ends[lane] = Math.max(timeMinutes(entry.endTime), start + 48 / 76 * 60);
    group.push({ entry, lane, lanes: 1 });
  }
  flush(); return result;
}

export function courseSummary(course: Course, data: TimetableData): string {
  const rules = data.recurrenceRules.filter(rule => rule.courseId === course.id && !rule.deletedAt);
  const term = data.terms.find(term => term.id === course.termId);
  return rules.length ? `${term?.name || "学期"} · ${rules.length} 个上课时段` : "尚未设置重复排课";
}

export function renderCourseDetails(course: Course, items: Item[], data: TimetableData): string {
  const term = data.terms.find(term => term.id === course.termId);
  const rules = data.recurrenceRules.filter(rule => rule.courseId === course.id && !rule.deletedAt);
  const linked = items.filter(item => !item.deletedAt && item.courseId === course.id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const today = term ? zonedFields(new Date(), term.timeZone).date : dayKey();
  const upcoming = term ? courseOccurrences([course], data, today, term.endDate, true).slice(0, 6) : [];
  return `<section class="course-detail-section"><div class="card-heading"><h3>上课安排</h3><button class="text-button" data-study-action="new-rule" data-course-id="${escape(course.id)}">添加时段</button></div>${term ? `<p class="record-meta">${escape(term.name)} · ${escape(term.timeZone)}</p>` : ""}${rules.length ? rules.map(rule => `<div class="rule-row"><div><strong>${escape(ruleLabel(rule))}</strong>${rule.location ? `<small>${escape(rule.location)}</small>` : ""}</div><button class="text-button" data-rule-edit="${escape(rule.id)}">修改</button><button class="text-button danger-text" data-rule-delete="${escape(rule.id)}">移除</button></div>`).join("") : '<p class="record-meta">添加时段后，课程将按学期周次重复。</p>'}</section>
    ${upcoming.length ? `<section class="course-detail-section"><h3>近期课次</h3>${upcoming.map(entry => `<button class="occurrence-row" ${occurrenceAttrs(entry)}><span><strong>${entry.date.slice(5).replace("-", "/")} 周${"一二三四五六日"[weekday(entry.date) - 1]} · ${entry.startTime}–${entry.endTime}</strong><small>${escape(entry.location)}</small></span><span class="occurrence-state">${entry.cancelled ? "已停课" : entry.adjusted ? "已调课" : "调整"}</span></button>`).join("")}</section>` : ""}
    <section class="course-detail-section"><div class="card-heading"><h3>课程记录</h3><button class="text-button" data-course-note="${escape(course.id)}">记一笔</button></div>${linked.length ? linked.map(item => `<button class="linked-record" data-entry-open="${escape(item.id)}" data-entity="item"><span>${item.kind === "note" ? "便签" : item.kind === "task" ? "待办" : "日程"}</span><strong>${escape(item.title)}</strong>${item.status === "completed" ? "<small>已完成</small>" : ""}</button>`).join("") : '<p class="record-meta">还没有关联记录</p>'}</section>`;
}

export function renderTimetable(courses: Course[], data: TimetableData, view: CourseView, now = new Date()): void {
  const target = query("#course-timetable");
  const pickerScroll = target.querySelector(".course-day-picker")?.scrollLeft ?? 0;
  const term = selectedTerm(data, view);
  query("#term-toolbar").innerHTML = `<div class="term-picker">${data.terms.length ? `<label><span class="sr-only">查看学期</span><select id="course-term">${data.terms.map(value => `<option value="${escape(value.id)}" ${value.id === term?.id ? "selected" : ""}>${escape(value.name)}${value.isActive ? " · 当前" : ""}</option>`).join("")}</select></label><button class="text-button" data-study-action="edit-term">设置</button>` : '<span class="record-meta">按学期安排课程</span>'}</div><button class="${data.terms.length ? "icon-button" : "secondary-button"}" data-study-action="new-term" aria-label="新建学期" title="新建学期">${data.terms.length ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>' : "新建学期"}</button>`;
  if (!term) { target.innerHTML = '<div class="timetable-empty paper-card"><h2>从一个学期开始</h2><p>设置第一周，再为课程添加上课时段。</p></div>'; return; }
  const week = selectedWeek(term, view, now);
  const start = addDays(term.startDate, (week - 1) * 7);
  const end = addDays(start, 6);
  const today = zonedFields(now, term.timeZone).date;
  const entries = courseOccurrences(courses, data, start, end, true).filter(entry => entry.termId === term.id);
  const visibleDay = view.day >= 1 && view.day <= 7 ? view.day : weekday(today);
  const min = entries.length ? Math.max(0, Math.min(...entries.map(entry => Math.floor(timeMinutes(entry.startTime) / 60) * 60)) - 60) : 8 * 60;
  const max = entries.length ? Math.min(24 * 60, Math.max(...entries.map(entry => Math.ceil(timeMinutes(entry.endTime) / 60) * 60)) + 60) : 18 * 60;
  const hours = (max - min) / 60;
  const gridHeight = hours * 76;
  const dayEntries = entries.filter(entry => weekday(entry.date) === visibleDay);
  target.innerHTML = `<div class="timetable-heading"><div><h2>第 ${week} 周 <small>${week % 2 ? "单周" : "双周"}</small></h2><p>${start.slice(5).replace("-", "/")} — ${end.slice(5).replace("-", "/")} · ${escape(term.timeZone)}</p></div><div class="timetable-week-buttons"><button class="icon-button" data-course-week="-1" aria-label="课程上一周" ${week === 1 ? "disabled" : ""}>‹</button><button class="text-button" data-course-week="0">本周</button><button class="icon-button" data-course-week="1" aria-label="课程下一周" ${week === term.totalWeeks ? "disabled" : ""}>›</button></div></div>
    <div class="course-day-picker" aria-label="课程日期">${Array.from({ length: 7 }, (_, i) => { const date = addDays(start, i); return `<button data-course-day="${i + 1}" aria-pressed="${visibleDay === i + 1}" ${date === today ? 'aria-current="date"' : ""}><span>${"一二三四五六日"[i]}</span><strong>${Number(date.slice(8))}</strong>${entries.some(entry => entry.date === date && !entry.cancelled) ? '<i aria-hidden="true"></i>' : ""}</button>`; }).join("")}</div>
    <div class="course-day-list paper-card">${dayEntries.length ? dayEntries.map(entry => `<button class="course-day-entry${entry.cancelled ? " is-cancelled" : ""}" ${occurrenceAttrs(entry)}><span class="course-time">${entry.startTime}<small>${entry.endTime}</small></span><span><strong>${escape(entry.name)}</strong><small>${escape(entry.location || "未设地点")}${entry.adjusted ? ` · ${entry.cancelled ? "已停课" : "已调课"}` : ""}</small></span><span aria-hidden="true">›</span></button>`).join("") : '<p class="agenda-empty">这一天没有课程</p>'}</div>
    <div class="timetable-scroll"><div class="timetable-grid" style="--grid-height:${gridHeight}px"><div class="timetable-corner" aria-hidden="true"></div>${Array.from({ length: 7 }, (_, index) => { const date = addDays(start, index); return `<div class="timetable-day-heading${date === today ? " is-today" : ""}">周${"一二三四五六日"[index]}<small>${date.slice(5).replace("-", "/")}</small></div>`; }).join("")}
    <div class="timetable-hours" aria-hidden="true">${Array.from({ length: hours + 1 }, (_, index) => `<span style="top:${index * 76}px">${String(min / 60 + index).padStart(2, "0")}:00</span>`).join("")}</div>${Array.from({ length: 7 }, (_, index) => {
      const date = addDays(start, index); const cells = entries.filter(entry => entry.date === date);
      return `<div class="timetable-day-column${date === today ? " is-today" : ""}">${occurrenceLanes(cells).map(({ entry, lane, lanes }) => {
        const top = (timeMinutes(entry.startTime) - min) / 60 * 76;
        const height = Math.max(44, (timeMinutes(entry.endTime) - timeMinutes(entry.startTime)) / 60 * 76 - 4);
        return `<button class="timetable-class${entry.cancelled ? " is-cancelled" : ""}" ${occurrenceAttrs(entry)} style="top:${top}px;height:${height}px;left:calc(${lane / lanes * 100}% + 2px);width:calc(${100 / lanes}% - 4px)" aria-label="${escape(`${entry.name}，${entry.date} ${entry.startTime}至${entry.endTime}，${entry.location}${entry.cancelled ? '，已停课' : entry.adjusted ? '，已调课' : ''}，调整此课次`)}"><strong>${escape(entry.name)}</strong><span>${entry.startTime}–${entry.endTime}</span>${entry.location ? `<small>${escape(entry.location)}</small>` : ""}${entry.adjusted ? `<small>${entry.cancelled ? "停课" : "调课"}</small>` : ""}</button>`;
      }).join("")}</div>`;
  }).join("")}</div></div>`;
  const picker = target.querySelector<HTMLElement>(".course-day-picker")!;
  picker.scrollLeft = pickerScroll;
  if (!entries.length) target.querySelector(".timetable-scroll")!.innerHTML = '<div class="timetable-empty"><p>本周没有课程</p></div>';
}
