import { describe, expect, it } from "vitest";
import { parseBackup } from "../../src/data/backup";

describe("backup compatibility", () => {
  it("imports the v1 entries format into the v2 model", () => {
    const parsed = parseBackup(JSON.stringify({
      version: 1,
      theme: "sakura",
      glass: false,
      entries: [
        { id: "note-1", text: "旧便签", type: "note" },
        { id: "course-1", text: "旧课程", type: "course" },
      ],
    }));

    expect(parsed.version).toBe(2);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.courses).toHaveLength(1);
    expect(parsed.theme).toBe("sakura");
    expect(parsed.glass).toBe(false);
  });
});
