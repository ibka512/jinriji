import { afterEach, describe, expect, it, vi } from "vitest";
import { registerServiceWorker } from "../../src/platform/service-worker";
import { showToast } from "../../src/ui/toast";

vi.mock("../../src/ui/toast", () => ({ showToast: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("safe update", () => {
  it("keeps a persistent update action after blocked acceptance and supports offline retry", async () => {
    vi.stubEnv("DEV", false);
    const status = { textContent: "" };
    const button = { textContent: "", disabled: false, onclick: undefined as undefined | (() => void) };
    const events = new EventTarget(); const postMessage = vi.fn();
    const registration = { waiting: null as null | { postMessage: typeof postMessage }, addEventListener: vi.fn(), update: vi.fn().mockResolvedValue(undefined) };
    const navigator = { onLine: false, serviceWorker: Object.assign(events, { register: vi.fn().mockResolvedValue(registration) }) };
    vi.stubGlobal("navigator", navigator); vi.stubGlobal("window", { location: { reload: vi.fn() } });
    vi.stubGlobal("document", { readyState: "complete", querySelector: (selector: string) => selector === "#check-update" ? button : status });
    const prepare = vi.fn().mockReturnValue(false); registerServiceWorker(prepare);
    await vi.waitFor(() => expect(status.textContent).toContain("联网后重试"));
    expect(registration.update).not.toHaveBeenCalled();
    navigator.onLine = true; registration.waiting = { postMessage }; button.onclick!();
    await vi.waitFor(() => expect(button.textContent).toBe("立即更新"));
    button.onclick!(); expect(postMessage).not.toHaveBeenCalled(); expect(button.disabled).toBe(false);
    expect(status.textContent).toContain("已就绪");
    prepare.mockReturnValue(true); button.onclick!(); expect(postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
  });
  it("labels the action correctly and never activates before the editor is ready", async () => {
    vi.stubEnv("DEV", false);
    const workerEvents = new EventTarget();
    const postMessage = vi.fn(); const reload = vi.fn();
    const registration = { waiting: { postMessage }, addEventListener: vi.fn(), update: vi.fn().mockResolvedValue(undefined) };
    vi.stubGlobal("navigator", { serviceWorker: Object.assign(workerEvents, { register: vi.fn().mockResolvedValue(registration) }) });
    vi.stubGlobal("window", { location: { reload } });
    vi.stubGlobal("document", { readyState: "complete", querySelector: () => null });
    const prepare = vi.fn().mockReturnValue(false);
    registerServiceWorker(prepare);
    await vi.waitFor(() => expect(showToast).toHaveBeenCalled());
    const [, action, label] = vi.mocked(showToast).mock.calls[0]!;
    expect(label).toBe("更新");
    action!(); expect(prepare).toHaveBeenCalled(); expect(postMessage).not.toHaveBeenCalled();
    workerEvents.dispatchEvent(new Event("controllerchange")); expect(reload).not.toHaveBeenCalled();
    prepare.mockReturnValue(true); action!();
    expect(postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    workerEvents.dispatchEvent(new Event("controllerchange"));
    workerEvents.dispatchEvent(new Event("controllerchange"));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
