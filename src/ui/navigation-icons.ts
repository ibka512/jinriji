/** Shared geometry keeps sidebar and dock states identical; fills use cutouts, not background-colored strokes. */
const filled: Record<string, string> = {
  today: "M3 11 12 3.5 21 11v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Zm7 4v6h4v-6Z",
  notes: "M6 2.5h8.5L20 8v12.5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-17a1 1 0 0 1 1-1Zm8 2V9h4.5ZM8.5 12v1.5h8V12Zm0 4v1.5h6V16Z",
  plan: "M7 2.5h2V5h6V2.5h2V5h1.5A3.5 3.5 0 0 1 22 8.5v10a3.5 3.5 0 0 1-3.5 3.5h-13A3.5 3.5 0 0 1 2 18.5v-10A3.5 3.5 0 0 1 5.5 5H7ZM4 9v1.5h16V9Zm3 4v2h3v-2Zm7 0v2h3v-2Zm-7 4v2h3v-2Z",
  settings: "m9 3-.6 2.4-2 1.2L4 6l-2 3.5 1.8 1.7v2L2 15l2 3.5 2.4-.7 2 1.2.6 2.4h6l.6-2.4 2-1.2 2.4.7 2-3.5-1.8-1.8v-2L22 9.5 20 6l-2.4.6-2-1.2L15 3ZM15 12a3 3 0 1 0-6 0 3 3 0 0 0 6 0Z",
};

export function initializeNavigationIcons(): void {
  document.querySelectorAll<HTMLElement>("[data-view]").forEach(button => {
    const svg = button.querySelector("svg");
    const path = filled[button.dataset.view || ""];
    if (!svg || !path) return;
    if (button.dataset.view === "settings") svg.innerHTML = '<path d="m9 3-.6 2.4-2 1.2L4 6l-2 3.5 1.8 1.7v2L2 15l2 3.5 2.4-.7 2 1.2.6 2.4h6l.6-2.4 2-1.2 2.4.7 2-3.5-1.8-1.8v-2L22 9.5 20 6l-2.4.6-2-1.2L15 3Z"/><circle cx="12" cy="12" r="3"/>';
    svg.innerHTML = `<g class="icon-outline">${svg.innerHTML}</g><path class="icon-solid" fill-rule="evenodd" d="${path}"/>`;
    svg.setAttribute("aria-hidden", "true");
    button.title = button.getAttribute("aria-label") || "";
  });
}
