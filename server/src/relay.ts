import type { Server as HttpServer } from "node:http";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import type {
  ErrorMessage,
  ScanResultMessage,
  ServerToPhone,
  StatusToDesktop,
} from "@deskcapade/shared";
import { config } from "./config.js";
import { PerceptronError } from "./services/perceptron.js";
import { runScan } from "./services/scan.js";

const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024;
// Skip frames for a slow desktop. Kept small so old frames are dropped instead of queued,
// which keeps the laptop's video close to live.
const MAX_BUFFERED_BYTES = 128 * 1024;
const HEARTBEAT_MS = 20_000;
const FRAME_HEADER_BYTES = 4;

// Detection always runs automatically: one scan every 250 ms while a phone and a laptop are connected.
const SCAN_INTERVAL_MS = 250;
// After a failed scan (rate limit, network), wait longer before trying again.
const ERROR_BACKOFF_MS = 2000;

type AliveSocket = WebSocket & { isAlive?: boolean };

/** Latest camera frame. `buf` is the whole binary message: 4-byte header + JPEG bytes. */
type LatestFrame = { buf: Buffer; width: number; height: number };

function toBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}

/**
 * One room: any number of phones (camera) and desktops (viewer).
 *
 * Frame wire format (phone -> server -> desktop), a binary websocket message:
 *   bytes 0-1: width  (uint16, little-endian)
 *   bytes 2-3: height (uint16, little-endian)
 *   bytes 4+ : JPEG image
 *
 * Phone frames are relayed to desktops. The server scans the latest frame every 250 ms
 * on its own; desktops only watch.
 */
export function attachRelay(server: HttpServer): void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });

  const phones = new Set<AliveSocket>();
  const desktops = new Set<AliveSocket>();
  // Desktops that want automatic scanning (the live-video pages). The Challenge page connects with scan=0.
  const scanners = new Set<AliveSocket>();

  let latestFrame: LatestFrame | null = null;
  let lastScannedFrame: LatestFrame | null = null;
  let scanning = false;

  let loopRunning = false;
  let loopGen = 0;
  let loopTimer: NodeJS.Timeout | null = null;

  // ---------- helpers ----------

  function sendJson(ws: WebSocket, msg: unknown): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  function broadcastDesktops(msg: unknown): void {
    const text = JSON.stringify(msg);
    for (const ws of desktops) {
      if (ws.readyState === WebSocket.OPEN) ws.send(text);
    }
  }

  function broadcastStatus(): void {
    const toDesktop: StatusToDesktop = {
      type: "status",
      phoneConnected: phones.size > 0,
      autoscan: true, // always on
      mock: config.mock,
    };
    const toPhone: ServerToPhone = { type: "status", desktopConnected: desktops.size > 0 };
    for (const ws of desktops) sendJson(ws, toDesktop);
    for (const ws of phones) sendJson(ws, toPhone);
  }

  function sendError(err: unknown): void {
    const msg: ErrorMessage =
      err instanceof PerceptronError
        ? { type: "error", error: err.message, ...(err.code ? { code: err.code } : {}) }
        : { type: "error", error: "Scan failed", code: "INTERNAL" };
    broadcastDesktops(msg);
  }

  // ---------- scanning ----------

  /**
   * Scan the most recent phone frame (skips if there is no new frame since the last scan).
   * Returns false only if the scan itself failed.
   */
  async function doScan(): Promise<boolean> {
    if (scanning) return true;
    if (phones.size === 0 || !latestFrame || latestFrame === lastScannedFrame) return true;

    scanning = true;
    try {
      const frame = latestFrame;
      lastScannedFrame = frame;
      const image = `data:image/jpeg;base64,${frame.buf.subarray(FRAME_HEADER_BYTES).toString("base64")}`;
      const result = await runScan(image, frame.width, frame.height);
      broadcastDesktops({ type: "scanResult", ...result } satisfies ScanResultMessage);
      return true;
    } catch (err) {
      sendError(err);
      return false;
    } finally {
      scanning = false;
    }
  }

  const shouldScan = (): boolean => scanners.size > 0 && phones.size > 0;

  async function tick(gen: number): Promise<void> {
    if (gen !== loopGen) return;
    const started = Date.now();
    const ok = await doScan();
    if (gen !== loopGen) return; // loop was stopped (and maybe restarted) meanwhile
    const wait = ok ? SCAN_INTERVAL_MS : ERROR_BACKOFF_MS;
    loopTimer = setTimeout(() => void tick(gen), Math.max(0, wait - (Date.now() - started)));
  }

  function stopScanLoop(): void {
    loopGen += 1;
    loopRunning = false;
    if (loopTimer) clearTimeout(loopTimer);
    loopTimer = null;
  }

  /** Runs the scan loop whenever both a phone and a laptop are connected. */
  function syncScanLoop(): void {
    if (!shouldScan()) {
      if (loopRunning) stopScanLoop();
      return;
    }
    if (loopRunning) return;
    loopRunning = true;
    loopGen += 1;
    void tick(loopGen);
  }

  // ---------- connections ----------

  wss.on("connection", (rawWs, req) => {
    const ws = rawWs as AliveSocket;
    const url = new URL(req.url ?? "/ws", "http://localhost");
    const role = url.searchParams.get("role");

    ws.isAlive = true;
    ws.on("pong", () => {
      ws.isAlive = true;
    });

    if (role === "phone") {
      phones.add(ws);
      ws.on("message", (data: RawData, isBinary: boolean) => {
        if (!isBinary) return;
        const buf = toBuffer(data);
        if (buf.length <= FRAME_HEADER_BYTES) return;
        const width = buf.readUInt16LE(0);
        const height = buf.readUInt16LE(2);
        if (width === 0 || height === 0) return;

        latestFrame = { buf, width, height };
        sendJson(ws, { type: "ack" } satisfies ServerToPhone); // lets the phone send the next frame
        for (const desk of desktops) {
          if (desk.readyState === WebSocket.OPEN && desk.bufferedAmount < MAX_BUFFERED_BYTES) {
            desk.send(buf); // a Buffer goes out as a binary message, relayed untouched
          }
        }
      });
      ws.on("close", () => {
        phones.delete(ws);
        if (phones.size === 0) {
          latestFrame = null;
          lastScannedFrame = null;
        }
        syncScanLoop();
        broadcastStatus();
      });
    } else if (role === "desktop") {
      desktops.add(ws);
      if (url.searchParams.get("scan") !== "0") scanners.add(ws);
      // Desktops only watch: they send nothing the server needs to act on.
      ws.on("close", () => {
        desktops.delete(ws);
        scanners.delete(ws);
        syncScanLoop(); // stops scanning when nobody is watching
        broadcastStatus();
      });
    } else {
      ws.close(1008, "role must be phone or desktop");
      return;
    }

    ws.on("error", () => {
      /* handled by close */
    });
    syncScanLoop();
    broadcastStatus();
  });

  // ---------- upgrade + heartbeat ----------

  server.on("upgrade", (req, socket, head) => {
    const { pathname } = new URL(req.url ?? "/", "http://localhost");
    if (pathname !== "/ws") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  // Drop sockets that stopped answering (phone slept, wifi dropped).
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients as Set<AliveSocket>) {
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, HEARTBEAT_MS);
  wss.on("close", () => clearInterval(heartbeat));
}