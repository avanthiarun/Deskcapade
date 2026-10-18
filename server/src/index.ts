import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import type { InfoResponse } from "@deskcapade/shared";
import { config, logStartupMode } from "./config.js";
import { attachRelay } from "./relay.js";
import { courseRouter } from "./routes/course.js";
import { healthRouter } from "./routes/health.js";
import { matchRouter } from "./routes/match.js";
import { scanRouter } from "./routes/scan.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TUNNEL_FILE = path.join(rootDir, ".tunnel-url"); // written by scripts/tunnel.mjs

/** The public tunnel address, if the tunnel script is running. */
function readTunnelUrl(): string | undefined {
  try {
    const url = fs.readFileSync(TUNNEL_FILE, "utf8").trim();
    return /^https:\/\/[\w.-]+$/.test(url) ? url : undefined;
  } catch {
    return undefined;
  }
}

const CLIENT_PORT = Number(process.env["CLIENT_PORT"]) || 5173;

/** Non-internal IPv4 addresses, most likely home/campus LAN first. */
function lanUrls(): string[] {
  const ips: string[] = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === "IPv4" && !a.internal) ips.push(a.address);
    }
  }
  const rank = (ip: string): number => {
    if (ip.startsWith("192.168.")) return 0;
    if (ip.startsWith("10.")) return 1;
    return 2; // 172.x is often WSL / Hyper-V / Docker
  };
  return ips.sort((a, b) => rank(a) - rank(b)).map((ip) => `https://${ip}:${CLIENT_PORT}`);
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.use("/api/health", healthRouter);
app.use("/api/scan", scanRouter);
app.use("/api/course", courseRouter);
app.use("/api/match", matchRouter);
app.get("/api/info", (_req, res) => {
  const tunnelUrl = readTunnelUrl();
  const body: InfoResponse = { lanUrls: lanUrls(), ...(tunnelUrl ? { tunnelUrl } : {}) };
  res.json(body);
});

const server = app.listen(config.port, () => {
  logStartupMode();
  console.log(`[deskcapade] API listening on http://localhost:${config.port}`);
});

attachRelay(server);