import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const python = process.env.PYTHON || "python3";
const port = process.env.JINRIJI_TEST_PORT || "4173";
const base = `http://127.0.0.1:${port}`;
const output = process.env.JINRIJI_TEST_OUTPUT || "test-results/screenshots-v1.0";
const core = process.argv.includes("--core");

const run = (command, args, extraEnv = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, {
    stdio: "inherit",
    env: { ...process.env, JINRIJI_BASE_URL: base, JINRIJI_TEST_OUTPUT: output, ...extraEnv },
  });
  child.once("error", reject);
  child.once("exit", code => code === 0 ? resolve() : reject(new Error(`${command} ${args.join(" ")} exited with ${code}`)));
});

const waitForServer = async (server) => {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (server.exitCode !== null) throw new Error(`Preview server exited with ${server.exitCode}`);
    try {
      const response = await fetch(base);
      if (response.ok) return;
    } catch { /* The next attempt handles normal startup latency. */ }
    await delay(250);
  }
  throw new Error(`Preview did not become ready at ${base}`);
};

const suites = core
  ? ["ui_acceptance.py", "editor_page_acceptance.py"]
  : ["ui_acceptance.py", "editor_page_acceptance.py", "timetable_acceptance.py", "organization_acceptance.py",
      "writing_acceptance.py", "library_acceptance.py", "maturity_acceptance.py", "release_acceptance.py"];

const server = spawn(python, ["-m", "http.server", port, "--bind", "127.0.0.1", "--directory", "dist"], { stdio: "ignore" });
try {
  await waitForServer(server);
  for (const suite of suites) await run(python, [`tests/${suite}`]);
  if (!core) {
    await run(python, ["tests/release_acceptance.py"], {
      JINRIJI_TEST_ENGINE: "webkit",
      JINRIJI_TEST_OUTPUT: `${output}-webkit`,
    });
    await run(python, ["tests/update_acceptance.py"]);
  }
} finally {
  server.kill("SIGTERM");
}
