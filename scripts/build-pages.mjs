import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const nextExecutable = fileURLToPath(
  new URL("../node_modules/next/dist/bin/next", import.meta.url),
);

const child = spawn(process.execPath, [nextExecutable, "build"], {
  env: {
    ...process.env,
    GITHUB_PAGES: "true",
    GITHUB_REPOSITORY:
      process.env.GITHUB_REPOSITORY ?? "buscaeterna/ncrl-poetic-marker",
  },
  stdio: "inherit",
});

child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`Next.js build terminated by ${signal}`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
