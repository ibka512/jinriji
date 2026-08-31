import { afterEach, describe, expect, it, vi } from "vitest";
import { registerServiceWorker } from "../../src/platform/service-worker";
import { showToast } from "../../src/ui/toast";

vi.mock("../../src/ui/toast", () => ({ showToast: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("safe update", () => {
  it("labels the action correctly and never activates before the editor is ready", async () => {
    vi.stubEnv("DEV", false);
    const workerEvents = new EventTarget();
    const postMessage = vi.fn(); const reload = vi.fn();
    const registration = { waiting: { postMessage }, addEventListener: vi.fn(), update: vi.fn().mockResolvedValue(undefined) };
    vi.stubGlobal("navigator", { serviceWorker: Object.assign(workerEvents, { register: vi.fn().mockResolvedValue(registration) }) });
    vi.stubGlobal("window", { location: { reload } });
    vi.stubGlobal("document", { readyState: "complete" });
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
