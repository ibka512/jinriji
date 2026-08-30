import { queryAll } from "./dom";

export const themeMap = {
  sage: { accent: "#667b68", deep: "#3f5543", soft: "#dfe8dc", tertiary: "#a86448", canvas: "#edf0e9", warm: "#f3eee3" },
  sakura: { accent: "#9d6f78", deep: "#724a54", soft: "#eedde0", tertiary: "#77806a", canvas: "#f2eaea", warm: "#f4eee7" },
  aizome: { accent: "#5a7185", deep: "#344f65", soft: "#dce5eb", tertiary: "#9b674e", canvas: "#e9eef1", warm: "#f0ece5" },
  kaki: { accent: "#a86143", deep: "#74412c", soft: "#f0ddd2", tertiary: "#697861", canvas: "#f0e9e2", warm: "#eee9dc" },
} as const;

export type ThemeName = keyof typeof themeMap;

export function isThemeName(value: string): value is ThemeName {
  return value in themeMap;
}

export function applyTheme(name: ThemeName): void {
  const theme = themeMap[name];
  const root = document.documentElement;
  root.style.setProperty("--accent", theme.accent);
  root.style.setProperty("--accent-deep", theme.deep);
  root.style.setProperty("--accent-soft", theme.soft);
  root.style.setProperty("--tertiary", theme.tertiary);
  root.style.setProperty("--canvas", theme.canvas);
  root.style.setProperty("--canvas-warm", theme.warm);
  queryAll<HTMLButtonElement>(".theme-dot").forEach((button) => {
    const selected = button.dataset.theme === name;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-checked", String(selected));
  });
}
