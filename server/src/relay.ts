import type { Server as HttpServer } from "node:http";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { z } from "zod";
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
const MIN_AUTOSCAN_MS = 1000;
const HEARTBEAT_MS = 20_000;
const FRAME_HEADER_BYTES = 4;

const desktopMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("scan") }),
  z.object({
    type: z.literal("autoscan"),
    enabled: z.boolean(),
    intervalMs: z.number(),
  }),
]);

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
 * Phone frames are relayed to desktops; desktops ask the server to scan the latest frame.
 */
export function attachRelay(server: HttpServer): void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });

  const phones = new Set<AliveSocket>();
  const desktops = new Set<AliveSocket>();

  let latestFrame: LatestFrame | null = null;
  let autoscan = { enabled: false, intervalMs: 1500 };
  let timer: NodeJS.Timeout | null = null;
  let scanning = false;

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
      autoscan: autoscan.enabled,
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

  /** Scan the most recent phone frame. `quiet` skips error spam for auto-scan ticks with no frame. */
  async function doScan(quiet: boolean): Promise<void> {
    if (scanning) return;

    if (phones.size === 0 || !latestFrame) {
      if (!quiet) {
        broadcastDesktops({
          type: "error",
          error: phones.size === 0 ? "No phone connected" : "No phone frame yet",
          code: "NO_FRAME",
        } satisfies ErrorMessage);
      }
      return;
    }

    scanning = true;
    try {
      const frame = latestFrame;
      const image = `data:image/jpeg;base64,${frame.buf.subarray(FRAME_HEADER_BYTES).toString("base64")}`;
      const result = await runScan(image, frame.width, frame.height);
      broadcastDesktops({ type: "scanResult", ...result } satisfies ScanResultMessage);
    } catch (err) {
      sendError(err);
    } finally {
      scanning = false;
    }
  }

  function stopTimer(): void {
    if (timer) clearInterval(timer);
    timer = null;
  }

  function syncTimer(): void {
    stopTimer();
    if (autoscan.enabled && desktops.size > 0) {
      timer = setInterval(() => void doScan(true), autoscan.intervalMs);
    }
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
        if (phones.size === 0) latestFrame = null;
        broadcastStatus();
      });
    } else if (role === "desktop") {
      desktops.add(ws);
      ws.on("message", (data: RawData, isBinary: boolean) => {
        if (isBinary) return;
        let parsed: unknown;
        try {
          parsed = JSON.parse(toBuffer(data).toString());
        } catch {
          return;
        }
        const msg = desktopMessageSchema.safeParse(parsed);
        if (!msg.success) return;

        if (msg.data.type === "scan") {
          void doScan(false);
        } else {
          autoscan = {
            enabled: msg.data.enabled,
            intervalMs: Math.max(MIN_AUTOSCAN_MS, msg.data.intervalMs),
          };
          syncTimer();
          broadcastStatus();
        }
      });
      ws.on("close", () => {
        desktops.delete(ws);
        syncTimer(); // stops auto-scan when nobody is watching
        broadcastStatus();
      });
    } else {
      ws.close(1008, "role must be phone or desktop");
      return;
    }

    ws.on("error", () => {
      /* handled by close */
    });
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