const { spawn } = require("node:child_process");

function main() {
  const electronBinary = require("electron");
  const args = process.argv.slice(2);

  const env = { ...process.env };
  // If this is set, Electron runs as Node and no window will show.
  delete env.ELECTRON_RUN_AS_NODE;

  const child = spawn(electronBinary, args, {
    stdio: "inherit",
    env,
    windowsHide: false,
  });

  child.on("exit", (code, signal) => {
    if (code != null) process.exit(code);
    // eslint-disable-next-line no-console
    console.error(`Electron exited with signal ${signal ?? "unknown"}`);
    process.exit(1);
  });
}

main();

