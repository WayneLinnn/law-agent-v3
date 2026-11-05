import { spawn } from "node:child_process";

const flag = "--experimental-sqlite";
const existing = process.env.NODE_OPTIONS ?? "";
const nodeOptions = existing.includes(flag)
  ? existing
  : `${existing} ${flag}`.trim();

const child = spawn(process.execPath, process.argv.slice(2), {
  stdio: "inherit",
  env: { ...process.env, NODE_OPTIONS: nodeOptions },
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
