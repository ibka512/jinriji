import { query } from "../../ui/dom";
import { confirmAction } from "../../ui/confirmation";
import { createDrawingFile, drawStroke, repaintStrokes, rescaleStrokes, smoothPressure, type Stroke, type StrokePoint, type DrawingTool } from "../../domain/drawing";

/** Colours resolve from semantic tokens at runtime so the board follows all four themes. */
const INK_TOKENS = ["--ink", "--accent-deep", "--event-blue-ink", "--event-warm-ink", "--ink-soft"] as const;
const WIDTH_STEPS = [3, 6, 12] as const;

const button = (action: string, label: string, symbol = label): string =>
  `<button type="button" data-draw="${action}" aria-label="${label}" title="${label}">${symbol}</button>`;

/** Full-screen canvas board; strokes leave through onInsert as a PNG File, nothing else persists. */
export class DrawingBoard {
  private readonly layer = document.createElement("div");
  private readonly canvas = document.createElement("canvas");
  private context = this.canvas.getContext("2d")!;
  private strokes: Stroke[] = [];
  private redoStack: Stroke[] = [];
  private active?: { id: number; tool: DrawingTool; color: string; width: number; pressure: number };
  private penActive = false;
  private tool: DrawingTool = "pen";
  private widthIndex = 1;
  private color = "";
  private onInsert?: (file: File) => Promise<void>;
  private onClose?: () => void;

  constructor() {
    this.layer.className = "drawing-layer";
    this.layer.hidden = true;
    this.layer.innerHTML = `<header class="drawing-bar"><strong>手绘</strong>
      <div class="drawing-tools" role="toolbar" aria-label="画板工具">
        ${button("pen", "画笔", "✎")}${button("eraser", "橡皮", "橡皮")}
        ${button("thin", "细线", "细")}${button("medium", "中等粗细", "中")}${button("thick", "粗线", "粗")}
        <span class="drawing-colors" role="radiogroup" aria-label="颜色"></span>
        ${button("undo", "撤销", "↶")}${button("redo", "重做", "↷")}${button("clear", "清空画板", "清空")}
      </div>
      <div class="drawing-actions">${button("cancel", "取消", "取消")}${button("insert", "插入正文", "插入")}</div>
    </header><div class="drawing-surface"></div>`;
    this.layer.querySelector(".drawing-surface")!.append(this.canvas);
    document.body.append(this.layer);
    this.color = this.readToken(INK_TOKENS[0]);
    this.renderColors();
    this.layer.addEventListener("pointerdown", event => { if ((event.target as Element).closest(".drawing-bar button")) event.preventDefault(); });
    this.layer.addEventListener("click", event => this.act((event.target as Element).closest<HTMLElement>("[data-draw]")?.dataset.draw));
    this.canvas.addEventListener("pointerdown", event => this.startStroke(event));
    this.canvas.addEventListener("pointermove", event => this.extendStroke(event));
    this.canvas.addEventListener("pointerup", event => this.finishStroke(event));
    this.canvas.addEventListener("pointercancel", event => this.finishStroke(event));
    this.canvas.addEventListener("pointerleave", event => { if (this.active && event.pointerType !== "pen") this.finishStroke(event); });
    this.canvas.addEventListener("contextmenu", event => event.preventDefault());
    document.addEventListener("keydown", this.onKey);
    window.addEventListener("resize", this.onResize);
  }
  private readonly onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && !this.layer.hidden) { event.stopPropagation(); void this.close(); }
  };
  private readonly onResize = (): void => { if (!this.layer.hidden) this.sizeCanvas(); };

  get isOpen(): boolean { return !this.layer.hidden; }
  get strokeCount(): number { return this.strokes.length; }

  open(onInsert: (file: File) => Promise<void>, onClose?: () => void): void {
    this.onInsert = onInsert; this.onClose = onClose;
    this.strokes = []; this.redoStack = []; this.active = undefined; this.penActive = false;
    this.layer.hidden = false;
    this.sizeCanvas();
    this.syncTools();
    query<HTMLButtonElement>('[data-draw="insert"]', this.layer).focus();
  }

  private readToken(name: string): string {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || "#28312b";
  }

  private renderColors(): void {
    const group = query<HTMLElement>(".drawing-colors", this.layer);
    group.innerHTML = INK_TOKENS.map((token, index) => {
      const color = this.readToken(token);
      return `<button type="button" role="radio" data-draw="color-${index}" aria-label="颜色 ${index + 1}" aria-checked="${color === this.color}" style="--swatch:${color}"></button>`;
    }).join("");
  }

  private sizeCanvas(): void {
    const surface = query<HTMLElement>(".drawing-surface", this.layer);
    const scale = Math.min(2, window.devicePixelRatio || 1);
    const previous = { width: this.canvas.width / scale, height: this.canvas.height / scale };
    const next = { width: Math.max(200, Math.floor(surface.clientWidth)), height: Math.max(200, Math.floor(surface.clientHeight)) };
    this.canvas.width = Math.floor(next.width * scale);
    this.canvas.height = Math.floor(next.height * scale);
    this.canvas.style.width = `${next.width}px`;
    this.canvas.style.height = `${next.height}px`;
    this.context = this.canvas.getContext("2d")!;
    if (this.strokes.length) {
      this.strokes = rescaleStrokes(this.strokes, previous, next);
      this.redoStack = [];
    }
    this.repaint();
  }

  private repaint(): void {
    repaintStrokes(this.context, this.strokes);
  }

  private pointOf(event: PointerEvent): StrokePoint {
    const bounds = this.canvas.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top, pressure: event.pressure };
  }

  /** Pen input wins over palm touches while a stroke is in progress or a pen was seen. */
  private startStroke(event: PointerEvent): void {
    if (this.active) return;
    if (event.pointerType === "touch" && this.penActive) return;
    if (event.button !== 0 && event.pointerType === "mouse") return;
    this.canvas.setPointerCapture(event.pointerId);
    if (event.pointerType === "pen") this.penActive = true;
    this.active = { id: event.pointerId, tool: this.tool, color: this.color, width: WIDTH_STEPS[this.widthIndex]!, pressure: smoothPressure(0.5, event.pressure) };
    this.redoStack = [];
    this.extendStroke(event);
  }

  private extendStroke(event: PointerEvent): void {
    const state = this.active;
    if (!state || event.pointerId !== state.id) return;
    event.preventDefault();
    const samples = event.getCoalescedEvents?.().filter(sample => sample.pointerId === state.id) ?? [];
    const events = samples.length ? samples : [event];
    let stroke = this.strokes.at(-1);
    if (!stroke || stroke.tool !== state.tool || stroke.color !== state.color || stroke.width !== state.width) {
      stroke = { tool: state.tool, color: state.color, width: state.width, points: [] };
      this.strokes.push(stroke);
    }
    for (const sample of events) {
      state.pressure = smoothPressure(state.pressure, sample.pressure);
      stroke.points.push({ ...this.pointOf(sample), pressure: state.pressure });
      drawStroke(this.context, { ...stroke, points: stroke.points.slice(-2) });
    }
  }

  private finishStroke(event: PointerEvent): void {
    const state = this.active;
    if (!state || event.pointerId !== state.id) return;
    this.active = undefined;
    if (this.strokes.at(-1)?.points.length === 1) this.repaint();
    this.syncTools();
  }

  private async close(): Promise<void> {
    if (this.strokes.length && !await confirmAction("放弃手绘？", "画板内容尚未插入正文，关闭后不会保留。", "放弃", async () => {})) return;
    this.hide();
  }

  private hide(): void {
    this.layer.hidden = true; this.active = undefined;
    this.onClose?.();
  }

  private async act(action?: string): Promise<void> {
    if (!action) return;
    switch (action) {
      case "pen": case "eraser": this.tool = action; break;
      case "thin": case "medium": case "thick": this.widthIndex = { thin: 0, medium: 1, thick: 2 }[action]!; break;
      case "undo": if (this.strokes.length) this.redoStack.push(this.strokes.pop()!); this.repaint(); break;
      case "redo": if (this.redoStack.length) { this.strokes.push(this.redoStack.pop()!); this.repaint(); } break;
      case "clear":
        if (this.strokes.length && await confirmAction("清空画板？", "当前笔画会被全部清除。", "清空", async () => {})) { this.strokes = []; this.redoStack = []; this.repaint(); }
        break;
      case "cancel": await this.close(); break;
      case "insert": {
        if (!this.strokes.length || !this.onInsert) { this.hide(); break; }
        try {
          await this.onInsert(await createDrawingFile(this.canvas, this.readToken("--paper-solid")));
          this.hide();
        } catch { /* Errors are reported by the editor pipeline. */ }
        break;
      }
      default: {
        if (action.startsWith("color-")) { this.color = this.readToken(INK_TOKENS[Number(action.slice(6))]!); this.renderColors(); }
      }
    }
    this.syncTools();
  }

  private syncTools(): void {
    for (const name of ["pen", "eraser"]) query<HTMLButtonElement>(`[data-draw="${name}"]`, this.layer).setAttribute("aria-pressed", String(this.tool === name));
    for (const [name, index] of [["thin", 0], ["medium", 1], ["thick", 2]] as const)
      query<HTMLButtonElement>(`[data-draw="${name}"]`, this.layer).setAttribute("aria-pressed", String(this.widthIndex === index));
    query<HTMLButtonElement>('[data-draw="undo"]', this.layer).disabled = !this.strokes.length;
    query<HTMLButtonElement>('[data-draw="redo"]', this.layer).disabled = !this.redoStack.length;
    query<HTMLButtonElement>('[data-draw="clear"]', this.layer).disabled = !this.strokes.length;
  }
}
