import { TimetableRepository } from "../../data/timetable-repository";
import type { Course, OccurrenceException, RecurrenceRule, TimetableData } from "../../domain/models";
import { addDays, defaultTerm, ruleLabel, validateRule, zonedFields, zonedInstant } from "../../domain/timetable";
import { confirmAction } from "../../ui/confirmation";
import { query, safeHTML as escape } from "../../ui/dom";
import { showToast } from "../../ui/toast";
import { selectedTerm, selectedWeek, type CourseView } from "./render";

interface Context { courses: Course[]; data: TimetableData; view: CourseView }
const field = (label: string, id: string, type: string, value = "", extra = ""): string => `<label class="study-field" for="${id}"><span>${label}</span><input id="${id}" name="${id}" type="${type}" value="${escape(value)}" ${extra}/></label>`;
const select = (label: string, id: string, options: [string, string][], value: string): string => `<label class="study-field" for="${id}"><span>${label}</span><select id="${id}" name="${id}">${options.map(([key, name]) => `<option value="${escape(key)}" ${key === value ? "selected" : ""}>${escape(name)}</option>`).join("")}</select></label>`;

export class CourseController {
  private readonly dialog = query<HTMLDialogElement>("#study-dialog");
  private readonly form = query<HTMLFormElement>("#study-form");
  private saveAction?: () => Promise<void>;
  private baseline = "";
  private busy = false;
  private closing = false;
  private viewedCourse?: string;

  constructor(private readonly repository: TimetableRepository, private readonly context: () => Context,
    private readonly refresh: () => Promise<void>, private readonly rerender: () => void,
    private readonly openCourse: (id: string) => void) {}

  get isOpen(): boolean { return this.dialog.open; }
  initialize(): void {
    document.addEventListener("click", event => {
      const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("button") : null;
      if (target && !target.disabled) void this.run(() => this.click(target));
    });
    document.addEventListener("change", event => {
      if (event.target instanceof HTMLSelectElement && event.target.id === "course-term") {
        this.context().view.termId = event.target.value; this.context().view.week = 0; this.rerender();
      }
    });
    this.dialog.addEventListener("cancel", event => { event.preventDefault(); void this.close(); });
    this.form.addEventListener("submit", event => { event.preventDefault(); void this.save(); });
    this.dialog.addEventListener("keydown", event => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && !event.isComposing && !query<HTMLDialogElement>("#confirm-dialog").open) { event.preventDefault(); void this.save(); }
    });
    window.addEventListener("beforeunload", event => {
      if (this.isOpen && (this.busy || this.dirty())) { event.preventDefault(); event.returnValue = ""; }
    });
    const viewport = (): void => {
      this.dialog.style.setProperty("--visual-height", `${window.visualViewport?.height ?? innerHeight}px`);
      this.dialog.style.setProperty("--visual-top", `${window.visualViewport?.offsetTop ?? 0}px`);
    };
    window.visualViewport?.addEventListener("resize", viewport); window.visualViewport?.addEventListener("scroll", viewport); viewport();
  }

  private async run(action: () => Promise<void>): Promise<void> {
    try { await action(); } catch (cause) { showToast(cause instanceof Error ? cause.message : "操作失败，请重试"); }
  }
  private contents(): string { return JSON.stringify(Array.from(new FormData(this.form))); }
  private dirty(): boolean { return this.contents() !== this.baseline; }
  prepareForUpdate(): boolean {
    if (this.isOpen) { showToast("请先保存或关闭课程设置，再更新"); return false; }
    return true;
  }

  /** False keeps the browser-history overlay marker until the user resolves unsaved edits. */
  dismissFromHistory(): boolean {
    if (!this.isOpen) return true;
    if (this.busy || this.closing) return false;
    if (this.dirty()) { void this.close(); return false; }
    this.finishClose(true); return true;
  }
  async close(): Promise<boolean> {
    if (!this.isOpen) return true;
    if (this.busy || this.closing) return false;
    this.closing = true;
    try {
      if (this.dirty() && !await confirmAction("放弃未保存的修改？", "已保存的课程与安排不受影响。", "放弃修改", async () => undefined)) return false;
      this.finishClose(); return true;
    } finally { this.closing = false; }
  }
  private finishClose(fromHistory = false): void {
    this.dialog.close(); document.body.classList.remove("study-open"); this.saveAction = undefined;
    if (!fromHistory && history.state?.jinrijiModal) history.back();
  }
  private open(title: string, fields: string, save: () => Promise<void>, extra = ""): void {
    if (document.querySelector("dialog[open]")) return;
    query("#study-title").textContent = title;
    query("#study-fields").innerHTML = fields;
    query("#study-extra-actions").innerHTML = extra;
    query<HTMLElement>("#study-error").hidden = true;
    this.saveAction = save; this.baseline = this.contents();
    history.pushState({ ...history.state, jinrijiModal: "study" }, "", location.href);
    this.dialog.showModal(); document.body.classList.add("study-open");
    this.form.querySelector<HTMLElement>("input:not([type=checkbox]), select")?.focus();
  }
  private async save(): Promise<void> {
    if (this.busy || !this.saveAction || !this.isOpen) return;
    this.busy = true;
    const controls = Array.from(this.dialog.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>("input,button,select"));
    // Capture form values through direct controls in each save callback (disabled fields are omitted by FormData).
    controls.forEach(control => control.disabled = true);
    const button = query<HTMLButtonElement>("#study-save"); button.textContent = "保存中…"; button.setAttribute("aria-busy", "true");
    query<HTMLElement>("#study-error").hidden = true;
    try {
      await this.saveAction(); this.finishClose();
      await this.refresh(); showToast("已保存安排");
    } catch (cause) {
      const message = cause instanceof Error ? cause.name === "QuotaExceededError" ? "空间不足，输入仍保留。请释放空间后重试。" : cause.message : "保存失败，请重试";
      query("#study-error").textContent = message; query<HTMLElement>("#study-error").hidden = false;
    } finally {
      this.busy = false; controls.forEach(control => control.disabled = false);
      button.textContent = "保存"; button.removeAttribute("aria-busy");
    }
  }
  private value(id: string): string { return query<HTMLInputElement | HTMLSelectElement>(`#${id}`, this.dialog).value; }

  private openTerm(edit: boolean): void {
    const { data, view } = this.context();
    const original = edit ? selectedTerm(data, view) : undefined;
    const term = original || defaultTerm();
    this.viewedCourse = undefined;
    this.open(edit ? "学期设置" : "新建学期", `${field("学期名称", "study-name", "text", term.name, 'maxlength="200" placeholder="例如：2026 秋季"')}
      <div class="study-fields-pair">${field("第一周周一", "study-start", "date", term.startDate)}${field("总周数", "study-weeks", "number", String(term.totalWeeks), 'min="1" max="60"')}</div>
      <label class="study-checkbox"><input id="study-active" name="study-active" type="checkbox" ${term.isActive ? "checked" : ""}/>设为当前学期</label>
      <p class="record-meta">时区 ${escape(term.timeZone)}。${edit ? "修改开学日期会影响本学期所有重复课程；有冲突的单次调整须先恢复。" : "单双周从第一周计算。"}</p>`, async () => {
        const startDate = this.value("study-start"); const totalWeeks = Number(this.value("study-weeks"));
        if (!startDate || !Number.isInteger(totalWeeks) || totalWeeks < 1 || totalWeeks > 60) throw new Error("请选择有效的开学日期与周数");
        await this.repository.saveTerm({ ...term, name: this.value("study-name").trim(), startDate, totalWeeks,
          endDate: addDays(startDate, totalWeeks * 7 - 1), isActive: query<HTMLInputElement>("#study-active").checked }, original?.revision ?? 0);
        view.termId = term.id; view.week = 0;
      });
  }

  private openRule(courseId: string, ruleId?: string): void {
    const { courses, data, view } = this.context();
    const course = courses.find(value => value.id === courseId && !value.deletedAt);
    if (!course) throw new Error("课程已不存在");
    const available = course.termId ? data.terms.filter(term => term.id === course.termId) : data.terms;
    if (!available.length) { showToast(course.termId ? "原学期不可用，请先恢复包含该学期的备份" : "请先新建学期，再添加时段"); this.openTerm(false); return; }
    const original = data.recurrenceRules.find(rule => rule.id === ruleId);
    const term = available.find(term => term.id === selectedTerm(data, view)?.id) || available[0]!;
    const rule: RecurrenceRule = original || { id: crypto.randomUUID(), courseId, weekday: 1, startTime: "09:00", endTime: "10:00", startWeek: 1, endWeek: term.totalWeeks, intervalWeeks: 1 };
    this.viewedCourse = course.id;
    this.open(original ? "修改时段" : "添加上课时段", `<p class="study-course-name">${escape(course.name)}</p>${select("学期", "study-term", available.map(term => [term.id, term.name]), term.id)}
      <div class="study-fields-pair">${select("星期", "study-weekday", Array.from({ length: 7 }, (_, index) => [String(index + 1), `周${"一二三四五六日"[index]}`]), String(rule.weekday))}${select("重复", "study-repeat", [["every", "每周"], ["odd", "单周"], ["even", "双周"]], rule.intervalWeeks === 1 ? "every" : rule.startWeek % 2 ? "odd" : "even")}</div>
      <div class="study-fields-pair">${field("上课时间", "study-time-start", "time", rule.startTime)}${field("下课时间", "study-time-end", "time", rule.endTime)}</div>
      <div class="study-fields-pair">${field("起始周", "study-week-start", "number", String(rule.startWeek), 'min="1" max="60"')}${field("结束周", "study-week-end", "number", String(rule.endWeek), 'min="1" max="60"')}</div>
      ${field("地点（选填）", "study-location", "text", rule.location ?? course.location ?? "", 'maxlength="200"')}
      <p class="record-meta">按学期单双周重复；临时变动请在具体课次中调整。</p>`, async () => {
        const selected = available.find(term => term.id === this.value("study-term"))!;
        const repeat = this.value("study-repeat");
        let startWeek = Number(this.value("study-week-start"));
        if (repeat !== "every" && startWeek % 2 !== (repeat === "odd" ? 1 : 0)) startWeek += 1;
        const updated: RecurrenceRule = { ...rule, weekday: Number(this.value("study-weekday")), startTime: this.value("study-time-start"), endTime: this.value("study-time-end"),
          startWeek, endWeek: Number(this.value("study-week-end")), intervalWeeks: repeat === "every" ? 1 : 2, location: this.value("study-location").trim() };
        validateRule(updated, selected);
        await this.repository.saveRule(updated, selected.id, original?.revision ?? 0, course.revision, selected.revision ?? 0);
        view.termId = selected.id;
      });
  }

  private openOccurrence(ruleId: string, date: string): void {
    const { data, courses } = this.context();
    const rule = data.recurrenceRules.find(rule => rule.id === ruleId && !rule.deletedAt);
    const course = rule && courses.find(course => course.id === rule.courseId && !course.deletedAt);
    const term = course && data.terms.find(term => term.id === course.termId);
    if (!rule || !course || !term) throw new Error("课程安排已不存在");
    const exception = data.occurrenceExceptions.find(entry => entry.ruleId === ruleId && entry.originalDate === date);
    const start = exception?.kind === "rescheduled" ? zonedFields(new Date(exception.replacementStartAt!), term.timeZone) : { date, time: rule.startTime };
    const end = exception?.kind === "rescheduled" ? zonedFields(new Date(exception.replacementEndAt!), term.timeZone).time : rule.endTime;
    this.viewedCourse = course.id;
    this.open("调整这一次", `<p class="study-course-name">${escape(course.name)}</p><p class="record-meta">原安排 ${escape(date)} · ${escape(ruleLabel(rule))}<br/>${escape(term.timeZone)} · 不影响其他课次</p>
      ${select("调整方式", "study-adjustment", [["rescheduled", "调课"], ["cancelled", "停课"]], exception?.kind ?? "rescheduled")}
      <div id="study-replacement">${field("调整日期", "study-date", "date", start.date, `min="${term.startDate}" max="${term.endDate}"`)}<div class="study-fields-pair">${field("上课时间", "study-time-start", "time", start.time)}${field("下课时间", "study-time-end", "time", end)}</div>${field("地点（选填）", "study-location", "text", exception?.replacementLocation ?? rule.location ?? course.location ?? "", 'maxlength="200"')}</div>`, async () => {
        const kind = this.value("study-adjustment") as OccurrenceException["kind"];
        const updated: OccurrenceException = { id: exception?.id ?? crypto.randomUUID(), ruleId, originalDate: date, kind,
          ...(kind === "rescheduled" ? { replacementStartAt: zonedInstant(this.value("study-date"), this.value("study-time-start"), term.timeZone), replacementEndAt: zonedInstant(this.value("study-date"), this.value("study-time-end"), term.timeZone), replacementLocation: this.value("study-location").trim() } : {}) };
        await this.repository.saveException(updated, exception?.revision ?? 0, rule.revision ?? 0);
      }, `<button type="button" class="text-button" data-study-action="view-course">课程详情</button>${exception ? `<button type="button" class="text-button" data-exception-reset="${escape(exception.id)}">恢复原安排</button>` : ""}`);
    const toggle = (): void => { query<HTMLElement>("#study-replacement").hidden = this.value("study-adjustment") === "cancelled"; };
    query("#study-adjustment").addEventListener("change", toggle); toggle();
  }

  private async click(target: HTMLButtonElement): Promise<void> {
    const d = target.dataset;
    const { data, view } = this.context();
    if (d.studyAction === "close") await this.close();
    if (d.studyAction === "new-term" || d.studyAction === "edit-term") this.openTerm(d.studyAction === "edit-term");
    if (d.studyAction === "new-rule" && d.courseId) this.openRule(d.courseId);
    if (d.ruleEdit) { const rule = data.recurrenceRules.find(rule => rule.id === d.ruleEdit); if (rule) this.openRule(rule.courseId, rule.id); }
    if (d.ruleDelete) {
      const rule = data.recurrenceRules.find(rule => rule.id === d.ruleDelete);
      if (rule && await confirmAction("移除这个时段？", "该时段的重复课程将不再显示，课程与关联记录保留。", "移除", () => this.repository.deleteRule(rule.id, rule.revision ?? 0))) {
        await this.refresh(); showToast("已移除时段", () => void this.run(async () => {
          const termId = this.context().courses.find(course => course.id === rule.courseId)?.termId;
          if (termId) { await this.repository.saveRule({ ...rule, deletedAt: undefined }, termId, (rule.revision ?? 0) + 1); await this.refresh(); }
        }));
      }
    }
    if (d.occurrenceRule && d.occurrenceDate) this.openOccurrence(d.occurrenceRule, d.occurrenceDate);
    if (d.courseWeek !== undefined) {
      const term = selectedTerm(data, view);
      if (term) { view.week = d.courseWeek === "0" ? 0 : selectedWeek(term, view) + Number(d.courseWeek); this.rerender(); }
    }
    if (d.courseDay) { view.day = Number(d.courseDay); this.rerender(); }
    if (d.studyAction === "view-course" && this.viewedCourse) {
      const id = this.viewedCourse;
      if (await this.close()) {
        // Consume the modal history entry before navigating to the course detail.
        window.addEventListener("popstate", () => this.openCourse(id), { once: true });
      }
    }
    if (d.exceptionReset && !this.busy) {
      const exception = data.occurrenceExceptions.find(entry => entry.id === d.exceptionReset);
      if (exception && await confirmAction("恢复原安排？", "仅撤销这一次的调课或停课。", "恢复", () => this.repository.resetException(exception.id, exception.revision ?? 0))) {
        this.finishClose(); await this.refresh(); showToast("已恢复原安排");
      }
    }
  }
}
