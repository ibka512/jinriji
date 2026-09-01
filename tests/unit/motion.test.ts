import { describe, expect, it } from "vitest";
import { feedbackDuration } from "../../src/ui/motion";

describe("motion feedback contract", () => {
  it("never holds a keyboard action", () => expect(feedbackDuration(false, false, "140ms")).toBe(0));
  it("never holds reduced-motion feedback", () => expect(feedbackDuration(true, true, "140ms")).toBe(0));
  it("uses the existing press token for pointer feedback", () => expect(feedbackDuration(true, false, "140ms")).toBe(140));
  it("caps accidental long tokens and rejects invalid ones", () => {
    expect(feedbackDuration(true, false, "500ms")).toBe(160);
    expect(feedbackDuration(true, false, "")).toBe(0);
    expect(feedbackDuration(true, false, "-1ms")).toBe(0);
  });
});
