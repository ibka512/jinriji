import { describe, expect, it } from "vitest";
import { parseRoute, routeHash } from "../../src/ui/navigation";

describe("routes", () => {
  it("keeps course detail in plan while accepting legacy note routes", () => {
    const route = { view: "plan" as const, tab: "courses" as const, selection: { entity: "course" as const, id: "课程/1" } };
    expect(parseRoute(routeHash(route))).toEqual(route);
    expect(parseRoute("#notes/course/old").selection).toEqual({ entity: "course", id: "old" });
  });
  it("round-trips encoded legacy IDs without treating them as markup or paths", () => {
    const route = { view: "notes" as const, selection: { entity: "item" as const, id: '中文/"<>&?#' } };
    expect(parseRoute(routeHash(route))).toEqual(route);
  });
  it("keeps plan subviews and tolerates broken links", () => {
    expect(parseRoute("#plan/tasks")).toEqual({ view: "plan", tab: "tasks" });
    expect(parseRoute("#notes/item/%xx")).toEqual({ view: "notes" });
    expect(parseRoute("#not-a-route")).toEqual({ view: "today" });
  });
});
