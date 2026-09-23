import { describe, expect, it } from "vitest";
import { drawStroke, pressureUsable, repaintStrokes, rescaleStrokes, smoothPressure, strokeWidthAt, type Stroke } from "../../src/domain/drawing";

interface Call { op: string; args: unknown[] }
const stubContext = (): CanvasRenderingContext2D & { calls: Call[] } => {
  const calls: Call[] = [];
  const record = (op: string) => (...args: unknown[]) => { calls.push({ op, args }); };
  return { calls, save: record("save"), restore: record("restore"), beginPath: record("beginPath"), arc: record("arc"), fill: record("fill"), moveTo: record("moveTo"), quadraticCurveTo: record("quadratic"), stroke: record("stroke"), clearRect: record("clearRect"), canvas: { width: 100, height: 100 } } as unknown as CanvasRenderingContext2D & { calls: Call[] };
};

describe("pressure shaping", () => {
  it("keeps the line within the light-to-heavy band", () => {
    expect(strokeWidthAt(6, 0, "pen")).toBe(6 * 0.35);
    expect(strokeWidthAt(6, 1, "pen")).toBe(6);
    expect(strokeWidthAt(6, 0.5, "pen")).toBeCloseTo(6 * 0.675);
  });
  it("clamps out-of-range pressure instead of throwing", () => {
    expect(strokeWidthAt(4, -3, "pen")).toBe(4 * 0.35);
    expect(strokeWidthAt(4, 9, "pen")).toBe(4);
  });
  it("widens the eraser over the pen nib", () => {
    expect(strokeWidthAt(6, 1, "eraser")).toBeCloseTo(6 * 2.2);
  });
  it("smooths pressure with exponential averaging", () => {
    expect(smoothPressure(0.5, 0.5)).toBe(0.5);
    expect(smoothPressure(0.5, 1)).toBeCloseTo(0.5 + 0.35 * 0.5);
    expect(smoothPressure(0.5, Number.NaN)).toBeCloseTo(0.5);
    expect(smoothPressure(0.5, 42)).toBeCloseTo(0.675);
  });
  it("treats constant browser pressure as unusable", () => {
    expect(pressureUsable([])).toBe(false);
    expect(pressureUsable([0.5, 0.5, 0.5, 0.5])).toBe(false);
    expect(pressureUsable([0.1, 0.3, 0.5, 0.7, 0.9])).toBe(true);
  });
});

describe("stroke rendering", () => {
  it("renders a tap as a single dot with the pen colour", () => {
    const context = stubContext();
    drawStroke(context, { tool: "pen", color: "#123456", width: 4, points: [{ x: 10, y: 10, pressure: 0.8 }] });
    expect(context.calls.some(call => call.op === "arc")).toBe(true);
    expect(context.calls.some(call => call.op === "fill")).toBe(true);
    expect(context.strokeStyle).toBe("#123456");
  });
  it("draws smoothed segments between points", () => {
    const context = stubContext();
    drawStroke(context, { tool: "pen", color: "#000", width: 3, points: [{ x: 0, y: 0, pressure: 0.5 }, { x: 8, y: 4, pressure: 0.5 }, { x: 16, y: 2, pressure: 0.5 }] });
    expect(context.calls.filter(call => call.op === "quadratic").length).toBe(2);
  });
  it("switches the eraser to destination-out compositing", () => {
    const context = stubContext();
    drawStroke(context, { tool: "eraser", color: "", width: 10, points: [{ x: 1, y: 1, pressure: 0.5 }, { x: 9, y: 9, pressure: 0.5 }] });
    expect(context.globalCompositeOperation).toBe("destination-out");
  });
  it("renders constant-pressure strokes identically on replay", () => {
    const stroke: Stroke = { tool: "pen", color: "#000", width: 4, points: [{ x: 0, y: 0, pressure: 0.2 }, { x: 6, y: 6, pressure: 0.2 }] };
    const live = stubContext();
    drawStroke(live, { ...stroke, points: stroke.points.slice(-2) });
    const replay = stubContext();
    drawStroke(replay, stroke);
    expect(live.calls.filter(call => call.op === "stroke").map(call => call.args[0])).toEqual(replay.calls.filter(call => call.op === "stroke").map(call => call.args[0]));
    expect(live.lineWidth).toBe(replay.lineWidth);
  });
  it("repaint clears the full canvas before replaying strokes", () => {
    const context = stubContext();
    repaintStrokes(context, [
      { tool: "pen", color: "#000", width: 2, points: [{ x: 0, y: 0, pressure: 0.5 }, { x: 5, y: 5, pressure: 0.5 }] },
      { tool: "pen", color: "#111", width: 2, points: [{ x: 9, y: 9, pressure: 0.5 }] },
    ]);
    expect(context.calls[0]).toEqual({ op: "clearRect", args: [0, 0, 100, 100] });
    expect(context.calls.filter(call => call.op === "save").length).toBe(2);
  });
});

describe("stroke rescaling", () => {
  const stroke: Stroke = { tool: "pen", color: "#000", width: 2, points: [{ x: 50, y: 50, pressure: 0.5 }] };
  it("keeps strokes untouched at the same size", () => {
    expect(rescaleStrokes([stroke], { width: 100, height: 100 }, { width: 100, height: 100 })).toEqual([stroke]);
  });
  it("centres and scales content into a smaller canvas", () => {
    const [moved] = rescaleStrokes([stroke], { width: 100, height: 100 }, { width: 50, height: 100 });
    expect(moved!.points[0]).toEqual({ x: 25, y: 50, pressure: 0.5 });
  });
  it("returns an empty list untouched", () => {
    expect(rescaleStrokes([], { width: 10, height: 10 }, { width: 20, height: 20 })).toEqual([]);
  });
});
