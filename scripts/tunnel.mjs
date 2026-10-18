// Starts a Cloudflare quick tunnel to the Vite dev server and saves its public address
// in .tunnel-url, so the laptop page shows the right QR code automatically.
// Run with: npm run dev:all   (starts the server, the client, and this tunnel together)
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const urlFile = path.join(root, ".tunnel-url");
const target = process.env.TUNNEL_TARGET ?? "https://localhost:5173";

fs.rmSync(urlFile, { force: true }); // forget the previous run's address

const child = spawn("npx", ["cloudflared", "tunnel", "--url", target, "--no-tls-verify"], {
  shell: true,
  stdio: ["ignore", "pipe", "pipe"],
});

let found = false;

function onData(chunk) {
  const text = chunk.toString();

  if (!found) {
    const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
    if (match) {
      found = true;
      fs.writeFileSync(urlFile, match[0]);
      console.log(`[tunnel] Phone link: ${match[0]}/phone`);
    }
  }

  for (const line of text.split(/\r?\n/)) {
    if (/\bERR\b/.test(line)) console.log(`[tunnel] ${line.trim()}`);
  }
}

child.stdout.on("data", onData);
child.stderr.on("data", onData);

function stop() {
  fs.rmSync(urlFile, { force: true });
  if (child.exitCode !== null || child.pid === undefined) return;
  if (process.platform === "win32") {
    // shell:true wraps cloudflared in cmd.exe, so kill the whole process tree
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    child.kill();
  }
}

child.on("exit", (code) => {
  fs.rmSync(urlFile, { force: true });
  console.log(`[tunnel] stopped (code ${code})`);
  process.exit(code ?? 0);
});
process.on("SIGINT", () => {
  stop();
  process.exit(0);
});
process.on("SIGTERM", () => {
  stop();
  process.exit(0);
});
process.on("exit", stop);