import { describe, expect, it } from "vitest";
import { createBackup, parseBackup } from "../../src/data/backup";

describe("backup compatibility", () => {
  it("still accepts v2 backups with the retired glass setting disabled", () => {
    const source = createBackup([], [], "aizome", false);
    const parsed = parseBackup(JSON.stringify(source));
    expect(parsed).toEqual(source);
    expect(parsed.glass).toBe(false);
  });

  it("keeps the v2 export format for the always-on glass presentation", () => {
    const backup = createBackup([], [], "sage", true);
    expect(parseBackup(JSON.stringify(backup))).toMatchObject({
      version: 2,
      theme: "sage",
      glass: true,
      items: [],
      courses: [],
    });
  });

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
