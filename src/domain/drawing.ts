/** Pure drawing-stroke model and rendering rules; no DOM access beyond Canvas2D contexts. */

export type DrawingTool = "pen" | "eraser";

export interface StrokePoint { x: number; y: number; pressure: number }

export interface Stroke {
  tool: DrawingTool;
  color: string;
  width: number;
  points: StrokePoint[];
}

export const PRESSURE_MIN = 0.35;
export const PRESSURE_SPAN = 0.65;
const PRESSURE_SMOOTH = 0.35;
const ERASER_FACTOR = 2.2;

/** Pen width at a point; callers must already pass a smoothed pressure value. */
export function strokeWidthAt(width: number, pressure: number, tool: DrawingTool): number {
  const ratio = PRESSURE_MIN + PRESSURE_SPAN * Math.min(1, Math.max(0, pressure));
  const base = width * (tool === "eraser" ? ERASER_FACTOR : 1);
  return Math.max(0.5, base * ratio);
}

/** Exponential smoothing keeps 240Hz pen samples from flickering the line width. */
export function smoothPressure(previous: number, pressure: number): number {
  const raw = Number.isFinite(pressure) ? Math.min(1, Math.max(0, pressure)) : 0.5;
  return previous + PRESSURE_SMOOTH * (raw - previous);
}

/** Some browsers report a constant pen pressure; such samples must not shape the line. */
export function pressureUsable(samples: number[]): boolean {
  const real = samples.filter(value => Number.isFinite(value) && value > 0);
  if (real.length < 4) return false;
  return Math.max(...real) - Math.min(...real) > 0.02;
}

/** Midpoint quadratic smoothing: each segment bows through the midpoint of its neighbours. */
export function drawStroke(context: CanvasRenderingContext2D, stroke: Stroke): void {
  const points = stroke.points;
  if (!points.length) return;
  const eraser = stroke.tool === "eraser";
  const usable = pressureUsable(points.map(point => point.pressure));
  context.save();
  context.globalCompositeOperation = eraser ? "destination-out" : "source-over";
  context.strokeStyle = stroke.color;
  context.lineCap = "round";
  context.lineJoin = "round";
  const width = (point: StrokePoint): number => {
    if (eraser) return strokeWidthAt(stroke.width, 1, "eraser");
    // Constant samples (browser pressure bug or finger input) fall back to their own value
    // so a live stroke and its replay always render identically.
    const pressure = usable ? point.pressure : points[0]!.pressure;
    return strokeWidthAt(stroke.width, pressure, "pen");
  };
  if (points.length === 1) {
    context.beginPath();
    context.fillStyle = stroke.color;
    context.arc(points[0]!.x, points[0]!.y, width(points[0]!) / 2, 0, Math.PI * 2);
    context.fill();
    context.restore();
    return;
  }
  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    const midX = (previous.x + current.x) / 2;
    const midY = (previous.y + current.y) / 2;
    const start = index === 1 ? previous : { x: (points[index - 2]!.x + previous.x) / 2, y: (points[index - 2]!.y + previous.y) / 2 };
    context.beginPath();
    context.lineWidth = width(current);
    context.moveTo(start.x, start.y);
    context.quadraticCurveTo(previous.x, previous.y, midX, midY);
    context.stroke();
  }
  context.restore();
}

/** Redraws every stroke onto a cleared canvas; strokes carry absolute canvas coordinates. */
export function repaintStrokes(context: CanvasRenderingContext2D, strokes: Stroke[]): void {
  context.clearRect(0, 0, context.canvas.width, context.canvas.height);
  for (const stroke of strokes) drawStroke(context, stroke);
}

/** Scales strokes into a new canvas size so rotation or resize keeps the drawing intact. */
export function rescaleStrokes(strokes: Stroke[], from: { width: number; height: number }, to: { width: number; height: number }): Stroke[] {
  const scale = Math.min(to.width / Math.max(1, from.width), to.height / Math.max(1, from.height));
  if (!Number.isFinite(scale) || scale <= 0 || (scale === 1 && from.width === to.width)) return strokes;
  const offsetX = (to.width - from.width * scale) / 2;
  const offsetY = (to.height - from.height * scale) / 2;
  return strokes.map(stroke => ({ ...stroke, points: stroke.points.map(point => ({
    ...point, x: point.x * scale + offsetX, y: point.y * scale + offsetY,
  })) }));
}

/** Bakes the paper background under transparent ink so exports survive dark themes. */
export function exportToBlob(source: HTMLCanvasElement, paperColor: string): Promise<Blob> {
  const target = document.createElement("canvas");
  target.width = source.width;
  target.height = source.height;
  const context = target.getContext("2d");
  if (!context) return Promise.reject(new Error("浏览器无法生成画板图片"));
  context.fillStyle = paperColor;
  context.fillRect(0, 0, target.width, target.height);
  context.drawImage(source, 0, 0);
  return new Promise((resolve, reject) => {
    target.toBlob(blob => blob ? resolve(blob) : reject(new Error("浏览器无法生成画板图片")), "image/png");
  });
}

export async function createDrawingFile(source: HTMLCanvasElement, paperColor: string): Promise<File> {
  const blob = await exportToBlob(source, paperColor);
  return new File([blob], "手绘.png", { type: "image/png" });
}
