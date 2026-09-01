"""Exercise real worker installation/failure/retry on an ephemeral loopback origin."""
import json
import re
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from playwright.sync_api import expect, sync_playwright
from ui_acceptance import ready, nav, compose

ROOT = Path(__file__).resolve().parents[1]


def test_upgrade(browser):
    built = (ROOT / "dist/sw.js").read_text()
    version = json.loads((ROOT / "package.json").read_text())["version"]
    cache = re.search(r'const CACHE_NAME = "([^"]+)"', built).group(1)
    assert cache.startswith(f"jinriji-{version}-") and "development" not in cache
    phase = {"value": "initial"}

    class Handler(SimpleHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            if self.path == "/sw.js":
                source = built
                if phase["value"] != "initial":
                    source = source.replace(cache, cache + "-" + phase["value"])
                if phase["value"] == "broken":
                    source = source.replace('const APP_SHELL = [', 'const APP_SHELL = ["./missing-update-proof",')
                data = source.encode()
                self.send_response(200); self.send_header("Content-Type", "text/javascript")
                self.send_header("Cache-Control", "no-store"); self.send_header("Content-Length", str(len(data)))
                self.end_headers(); self.wfile.write(data)
            else:
                super().do_GET()

    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(Handler, directory=str(ROOT / "dist")))
    thread = Thread(target=server.serve_forever, daemon=True); thread.start()
    context = browser.new_context(); page = context.new_page(); page.set_default_timeout(15000)
    try:
        page.goto(f"http://127.0.0.1:{server.server_port}/"); ready(page)
        page.wait_for_function("() => navigator.serviceWorker.controller !== null")
        compose(page, "升级前保留的内容", title="升级演练")
        nav(page, "settings")
        phase["value"] = "broken"
        page.locator("#check-update").click()
        expect(page.locator("#app-update-status")).to_contain_text("更新下载未完成")
        # Failed installation must leave the last usable cache intact.
        assert cache in page.evaluate("() => caches.keys()")
        phase["value"] = "ready"
        page.locator("#check-update").click()
        expect(page.locator("#check-update")).to_have_text("立即更新")
        page.locator("#toast-dismiss").click()
        expect(page.locator("#toast")).to_be_hidden()
        expect(page.locator("#check-update")).to_have_text("立即更新")
        with page.expect_navigation(wait_until="load"):
            page.locator("#check-update").click()
        ready(page)
        page.wait_for_function("async expected => (await caches.keys()).includes(expected)", arg=cache+"-ready")
        assert cache not in page.evaluate("() => caches.keys()")
        nav(page, "notes"); expect(page.locator("#notes-list")).to_contain_text("升级演练")
        context.set_offline(True); page.reload(); ready(page)
        expect(page.locator("#notes-list")).to_contain_text("升级演练")
        compose(page, "更新后离线写作仍可保存", title="离线演练")
        page.reload(); ready(page)
        expect(page.locator("#detail-title")).to_have_text("离线演练")
    finally:
        context.close(); server.shutdown(); server.server_close(); thread.join()


if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        test_upgrade(browser); browser.close()
    print("PASS actual worker failure / retry / activate / offline / data preservation")
