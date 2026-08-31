import { DraftStore, type ComposeType, type Draft } from "../../data/drafts";
import { AppRepository } from "../../data/repositories";
import type { Course, Item } from "../../domain/models";
import { dateFields, itemTime, parseSchedule } from "../../domain/dates";
import { normalizeTags } from "../../domain/organization";
import { query, queryAll, safeHTML as escape } from "../../ui/dom";
import { confirmAction } from "../../ui/confirmation";
import { showToast } from "../../ui/toast";
import type { Selection } from "./render";

const typeNames: Record<ComposeType, string> = { note: "便签", task: "待办", schedule: "日程", course: "课程" };

export class EntryEditor {
  private readonly dialog = query<HTMLDialogElement>("#compose-layer");
  private readonly title = query<HTMLInputElement>("#entry-title");
  private readonly body = query<HTMLTextAreaElement>("#quick-entry");
  private readonly date = query<HTMLInputElement>("#entry-date");
  private readonly time = query<HTMLInputElement>("#entry-time");
  private current?: Draft;
  private baseline = "";
  private busy = false;
  private storageFailed = false;
  private courses: Course[] = [];
  private readonly courseField = query<HTMLSelectElement>("#entry-course");
  private readonly instructor = query<HTMLInputElement>("#entry-instructor");
  private readonly location = query<HTMLInputElement>("#entry-location");
  private readonly tags = query<HTMLInputElement>("#entry-tags");
  private readonly repeat = query<HTMLSelectElement>("#entry-repeat");

  constructor(private readonly repository: AppRepository, readonly drafts: DraftStore,
    private readonly onSaved: (selection: Selection) => Promise<void>, private readonly onDraftChange: () => void) {}

  get isOpen(): boolean { return this.dialog.open; }
  setCourses(courses: Course[]): void { this.courses = courses; }

  initialize(): void {
    const updateViewport = (): void => {
      this.dialog.style.setProperty("--visual-height", `${window.visualViewport?.height ?? window.innerHeight}px`);
      this.dialog.style.setProperty("--visual-top", `${window.visualViewport?.offsetTop ?? 0}px`);
    };
    window.visualViewport?.addEventListener("resize", updateViewport);
    window.visualViewport?.addEventListener("scroll", updateViewport);
    updateViewport();
    query("#entry-form").addEventListener("submit", event => { event.preventDefault(); void this.save(); });
    queryAll("[data-close-compose]").forEach(button => button.addEventListener("click", () => this.close()));
    this.dialog.addEventListener("cancel", event => { event.preventDefault(); this.close(); });
    for (const input of [this.title, this.body, this.date, this.time, this.courseField, this.instructor, this.location, this.tags, this.repeat]) input.addEventListener("input", () => this.persist());
    this.repeat.addEventListener("change", () => { query<HTMLElement>("#repeat-hint").hidden = !this.repeat.value; this.persist(); });
    queryAll<HTMLButtonElement>("[data-entry-type]").forEach(button => button.addEventListener("click", () => {
      if (!this.current || this.busy) return;
      this.current.type = button.dataset.entryType as ComposeType;
      this.updateType(); this.persist();
    }));
    query("#save-as-new").addEventListener("click", () => void this.save(true));
    query("#discard-draft").addEventListener("click", () => {
      if (this.busy || !this.current) return;
      void confirmAction("舍弃草稿？", "未保存的修改将被移除，已保存的记录不受影响。", "舍弃", async () => {
        this.drafts.remove(this.current!.key);
      }).then(confirmed => { if (confirmed) this.finishClose(); });
    });
    document.addEventListener("keydown", event => {
      if (this.isOpen && (event.metaKey || event.ctrlKey) && event.key === "Enter" && !event.isComposing && !query<HTMLDialogElement>("#confirm-dialog").open) {
        event.preventDefault(); void this.save();
      }
    });
    window.addEventListener("beforeunload", event => {
      if (this.busy || (this.isOpen && !this.persist())) { event.preventDefault(); event.returnValue = ""; }
    });
  }

  openNew(type: ComposeType, date = "", courseId?: string): void {
    const draft = this.drafts.get("new");
    this.open(draft ?? { key: "new", id: crypto.randomUUID(), type, title: "", body: "", date, time: "", courseId, updatedAt: new Date().toISOString() }, Boolean(draft));
  }

  openRecord(record: Item | Course): void {
    const item = "kind" in record ? record : undefined;
    const course = !item ? record as Course : undefined;
    const entity = item ? "item" : "course";
    const key = `${entity}:${record.id}`;
    const draft = this.drafts.get(key);
    const fields = dateFields(item ? itemTime(item) : course!.firstMeetingAt, record.allDay, record.dateOnly);
    this.open(draft ?? { key, entity, id: record.id, revision: record.revision, type: item ? item.kind === "event" ? "schedule" : item.kind : "course",
      title: item ? item.title === item.body ? "" : item.title : course!.name, body: item?.body ?? "", courseId: item?.courseId, location: course?.location, instructor: course?.instructor,
      tagsText: item?.tags?.join("，"), repeatFrequency: item?.repeat?.frequency || "", repeat: item?.repeat, repeatSourceDate: fields.date,
      ...fields, updatedAt: new Date().toISOString() }, Boolean(draft));
  }

  open(draft: Draft, recovered = true): void {
    if (document.querySelector("dialog[open]")) return;
    this.current = { ...draft, id: draft.id || crypto.randomUUID() };
    this.title.value = draft.title; this.body.value = draft.body; this.date.value = draft.date; this.time.value = draft.time;
    this.instructor.value = draft.instructor || ""; this.location.value = draft.location || "";
    this.tags.value = draft.tagsText || ""; this.repeat.value = draft.repeatFrequency || "";
    query<HTMLDetailsElement>("#entry-organization").open = Boolean(this.tags.value);
    query<HTMLElement>("#repeat-hint").hidden = !this.repeat.value;
    const available = this.courses.filter(course => !course.deletedAt || course.id === draft.courseId);
    this.courseField.innerHTML = '<option value="">不关联</option>' + available.map(course => `<option value="${escape(course.id)}">${escape(course.name)}${course.deletedAt ? "（已删除）" : ""}</option>`).join("")
      + (draft.courseId && !available.some(course => course.id === draft.courseId) ? `<option value="${escape(draft.courseId)}">原课程不可用</option>` : "");
    this.courseField.value = draft.courseId || "";
    this.baseline = recovered ? "" : this.contents();
    this.storageFailed = false;
    query<HTMLElement>("#entry-error").hidden = true;
    query<HTMLElement>("#save-as-new").hidden = true;
    query("#draft-status").textContent = recovered ? "已恢复草稿" : "";
    this.updateType();
    history.pushState({ ...history.state, jinrijiModal: "editor" }, "", location.href);
    this.dialog.showModal();
    document.body.classList.add("editor-open");
    if (draft.type === "course") this.title.focus(); else {
      this.body.focus();
      this.body.setSelectionRange(0, 0);
      this.body.scrollTop = 0;
    }
  }

  private contents(): string {
    return JSON.stringify({ type: this.current?.type, title: this.title.value, body: this.body.value, date: this.date.value, time: this.time.value, courseId: this.courseField.value, instructor: this.instructor.value, location: this.location.value, tagsText: this.tags.value, repeatFrequency: this.repeat.value });
  }

  private updateType(): void {
    if (!this.current) return;
    const course = this.current.type === "course";
    this.dialog.dataset.entryKind = this.current.type;
    const editing = this.current.revision !== undefined;
    query("#compose-title").textContent = `${editing ? "编辑" : "新建"}${typeNames[this.current.type]}`;
    query("#entry-title-label").textContent = course ? "课程名称" : "标题（选填）";
    this.title.placeholder = course ? "课程名称" : "取一个标题";
    this.body.hidden = course;
    query<HTMLElement>("#entry-body-label").hidden = course;
    query<HTMLElement>("#entry-details").hidden = this.current.type === "note" || (course && Boolean(this.courses.find(value => value.id === this.current?.id)?.termId));
    query<HTMLElement>("#course-metadata").hidden = !course;
    query<HTMLElement>("#entry-organization").hidden = course;
    query<HTMLElement>("#entry-repeat-field").hidden = this.current.type !== "task";
    query<HTMLElement>("#entry-course-field").hidden = course || (!this.courses.length && !this.current.courseId);
    queryAll<HTMLButtonElement>("[data-entry-type]").forEach(button => {
      const active = button.dataset.entryType === this.current!.type;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
      button.hidden = editing && (course ? button.dataset.entryType !== "course" : button.dataset.entryType === "course");
    });
  }

  persist(): boolean {
    if (!this.current || !this.isOpen || this.busy) return !this.busy;
    const dirty = this.contents() !== this.baseline;
    try {
      if (dirty) {
        this.current = { ...this.current, title: this.title.value, body: this.body.value, date: this.date.value, time: this.time.value, courseId: this.courseField.value || undefined, instructor: this.instructor.value, location: this.location.value, tagsText: this.tags.value, repeatFrequency: this.repeat.value as Draft["repeatFrequency"], updatedAt: new Date().toISOString() };
        this.drafts.save(this.current);
        query("#draft-status").textContent = "草稿已暂存";
      }
      this.storageFailed = false;
      return true;
    } catch {
      this.storageFailed = true;
      this.error("草稿暂存失败，请先保存记录，或复制内容后再离开。");
      return false;
    }
  }

  close(fromHistory = false): void {
    if (!this.isOpen || this.busy) return;
    if (!this.persist()) {
      if (fromHistory) history.pushState({ ...history.state, jinrijiModal: "editor" }, "", location.href);
      return;
    }
    this.finishClose(fromHistory);
  }

  private finishClose(fromHistory = false): void {
    this.dialog.close(); document.body.classList.remove("editor-open");
    this.current = undefined; this.storageFailed = false;
    this.onDraftChange();
    if (!fromHistory && history.state?.jinrijiModal === "editor") history.back();
  }

  private error(message: string): void {
    const element = query<HTMLElement>("#entry-error");
    element.textContent = message; element.hidden = false;
  }

  prepareForUpdate(): boolean {
    if (this.busy) { showToast("正在保存，请稍后更新"); return false; }
    if (this.isOpen && !this.persist()) return false;
    return !this.storageFailed;
  }

  private async save(asNew = false): Promise<void> {
    if (this.busy || !this.current) return;
    const body = this.body.value.trim();
    const typedTitle = this.title.value.trim();
    const course = this.current.type === "course";
    if (!(course ? typedTitle || body : body || typedTitle)) {
      this.error(course ? "请输入课程名称" : "请输入标题或内容");
      (course ? this.title : this.body).focus(); return;
    }
    let schedule: ReturnType<typeof parseSchedule>;
    let tags: string[];
    try { tags = course ? [] : normalizeTags(this.tags.value); }
    catch (cause) {
      this.error((cause as Error).message);
      query<HTMLDetailsElement>("#entry-organization").open = true; this.tags.focus(); return;
    }
    try {
      schedule = parseSchedule(this.current.type === "note" ? "" : this.date.value, this.current.type === "note" ? "" : this.time.value);
      if (this.current.type === "task" && this.repeat.value && !this.date.value) throw new Error("重复待办需要先选择日期");
    }
    catch (cause) { this.error((cause as Error).message); this.date.focus(); return; }
    const title = typedTitle || body.split(/\r?\n/)[0]!.slice(0, 120);
    this.persist();
    this.busy = true;
    const controls = queryAll<HTMLInputElement | HTMLButtonElement | HTMLTextAreaElement | HTMLSelectElement>("button, input, textarea, select", this.dialog);
    controls.forEach(control => control.disabled = true);
    const saveButton = query<HTMLButtonElement>("#save-entry");
    saveButton.textContent = "保存中…"; saveButton.setAttribute("aria-busy", "true");
    query<HTMLElement>("#entry-error").hidden = true;
    let saved: Selection | undefined;
    try {
      const editing = this.current.revision !== undefined && !asNew;
      const id = asNew ? crypto.randomUUID() : this.current.id;
      if (course) {
        const values = { name: title, firstMeetingAt: schedule.at, allDay: schedule.allDay, dateOnly: schedule.dateOnly, location: this.location.value.trim(), instructor: this.instructor.value.trim() };
        const result = editing ? await this.repository.updateCourse(id!, values, this.current.revision) : await this.repository.createCourse(values, id);
        if (!result) throw new Error("原课程已不存在，请另存为新记录");
        saved = { entity: "course", id: result.id };
      } else {
        const kind: Item["kind"] = this.current.type === "schedule" ? "event" : this.current.type as "note" | "task";
        const frequency = this.repeat.value as NonNullable<Item["repeat"]>["frequency"];
        const repeat = kind === "task" && frequency ? this.current.repeat?.frequency === frequency && this.date.value === this.current.repeatSourceDate && !asNew
          ? this.current.repeat : { frequency, anchorDate: this.date.value, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone } : undefined;
        const values = { title, body: body || typedTitle, kind, dueAt: kind === "task" ? schedule.at : undefined,
          startAt: kind === "event" ? schedule.at : undefined, allDay: schedule.allDay, dateOnly: schedule.dateOnly, courseId: this.courseField.value || undefined, tags, repeat };
        const result = editing ? await this.repository.updateItem(id!, values, this.current.revision) : await this.repository.createItem(values, id);
        if (!result) throw new Error("原记录已不存在，请另存为新记录");
        saved = { entity: "item", id: result.id };
      }
      try { this.drafts.remove(this.current.key); }
      catch { showToast("记录已保存，但旧草稿未能清理"); }
      this.finishClose();
    } catch (cause) {
      this.error(cause instanceof Error && cause.name === "QuotaExceededError" ? "存储空间不足，输入仍保留。请释放空间后重试，或先复制内容。"
        : cause instanceof Error && cause.name !== "ConstraintError" ? cause.message : "这条记录可能已保存，请关闭后查看；输入仍保留。");
      query<HTMLElement>("#save-as-new").hidden = this.current?.revision === undefined;
    } finally {
      this.busy = false;
      controls.forEach(control => control.disabled = false);
      saveButton.textContent = "保存记录"; saveButton.removeAttribute("aria-busy");
    }
    if (saved) {
      try { await this.onSaved(saved); }
      catch { showToast("已保存，请刷新查看"); }
    }
  }
}
