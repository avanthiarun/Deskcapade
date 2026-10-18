import type { Server as HttpServer } from "node:http";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import type {
  DesktopToServer,
  ErrorMessage,
  FreezeMessage,
  PhoneToServer,
  SnapMessage,
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

// Detection runs automatically while a phone and a Story page are connected. Each scan takes a few
// seconds, so they overlap: a new one starts every SCAN_START_EVERY_MS, at most MAX_SCANS_IN_FLIGHT at once.
const SCAN_START_EVERY_MS = 1500; // 40 scans a minute
const MAX_SCANS_IN_FLIGHT = 4; // each scan takes 4-6 s, so ~4 overlap at this pace
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

/** Room codes come from the client (random per laptop tab); anything else shares the "local" room. */
const ROOM_RE = /^[a-z0-9]{6,32}$/;

/**
 * Rooms: each laptop tab and the phone that scanned its QR code share a private room, so many
 * people can play from one hosted server without seeing each other's desks. A room holds any
 * number of phones (camera) and desktops (viewer), and is dropped when the last one leaves.
 *
 * Frame wire format (phone -> server -> desktop), a binary websocket message:
 *   bytes 0-1: width  (uint16, little-endian)
 *   bytes 2-3: height (uint16, little-endian)
 *   bytes 4+ : JPEG image
 *
 * Phone frames are relayed to desktops. The server scans the latest frame on its own (several
 * overlapping scans) for Story pages; desktops only watch.
 */
export function attachRelay(server: HttpServer): void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });
  const rooms = new Map<string, Room>();

  wss.on("connection", (rawWs, req) => {
    const ws = rawWs as AliveSocket;
    const url = new URL(req.url ?? "/ws", "http://localhost");
    const code = (url.searchParams.get("room") ?? "").toLowerCase();
    const id = ROOM_RE.test(code) ? code : "local";
    let room = rooms.get(id);
    if (!room) {
      const fresh: Room = createRoom(() => {
        if (rooms.get(id) === fresh) rooms.delete(id);
      });
      rooms.set(id, fresh);
      room = fresh;
    }
    room.join(ws, url);
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

type Room = { join: (ws: AliveSocket, url: URL) => void };

/** One room's phones, desktops and scanning. `onEmpty` runs when everyone has left. */
function createRoom(onEmpty: () => void): Room {
  const phones = new Set<AliveSocket>();
  const desktops = new Set<AliveSocket>();
  // Desktops that want automatic scanning (the live-video pages). The Challenge page connects with scan=0.
  const scanners = new Set<AliveSocket>();

  let latestFrame: LatestFrame | null = null;
  let lastScannedFrame: LatestFrame | null = null;
  /** The Story page froze the desk (keep playing the current setup; no scanning meanwhile). */
  let frozen = false;
  let inFlight = 0;
  let scanSeq = 0;
  let newestSent = 0;
  let backoffUntil = 0;

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
    // desktops that don't scan the stream are Challenge pages: they take photos, so the phone can snap
    const toPhone: ServerToPhone = {
      type: "status",
      desktopConnected: desktops.size > 0,
      canSnap: desktops.size > scanners.size,
      canFreeze: scanners.size > 0,
      frozen,
    };
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
   * Start a scan of the most recent phone frame (skipped if there's no new frame, too many scans
   * are already running, or we're backing off after an error). Scans overlap: each takes several
   * seconds, so starting one every SCAN_START_EVERY_MS keeps fresh results coming. A result
   * older than one already sent is dropped.
   */
  function startScan(): void {
    if (inFlight >= MAX_SCANS_IN_FLIGHT || Date.now() < backoffUntil) return;
    if (phones.size === 0 || !latestFrame || latestFrame === lastScannedFrame) return;
    const frame = latestFrame;
    lastScannedFrame = frame;
    const seq = ++scanSeq;
    inFlight++;
    const image = `data:image/jpeg;base64,${frame.buf.subarray(FRAME_HEADER_BYTES).toString("base64")}`;
    runScan(image, frame.width, frame.height, { fast: true })
      .then((result) => {
        if (seq < newestSent) return; // a newer scan already answered
        newestSent = seq;
        broadcastDesktops({ type: "scanResult", ...result } satisfies ScanResultMessage);
      })
      .catch((err: unknown) => {
        sendError(err);
        backoffUntil = Date.now() + ERROR_BACKOFF_MS;
      })
      .finally(() => {
        inFlight--;
      });
  }

  // a frozen desk keeps its pieces, so there's nothing to scan for
  const shouldScan = (): boolean => scanners.size > 0 && phones.size > 0 && !frozen;

  function tick(gen: number): void {
    if (gen !== loopGen) return;
    startScan();
    loopTimer = setTimeout(() => tick(gen), SCAN_START_EVERY_MS);
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
    tick(loopGen);
  }

  // ---------- connections ----------

  const leftEmpty = (): void => {
    if (phones.size === 0 && desktops.size === 0) {
      stopScanLoop();
      onEmpty();
    }
  };

  function join(ws: AliveSocket, url: URL): void {
    const role = url.searchParams.get("role");

    ws.isAlive = true;
    ws.on("pong", () => {
      ws.isAlive = true;
    });

    if (role === "phone") {
      phones.add(ws);
      ws.on("message", (data: RawData, isBinary: boolean) => {
        if (!isBinary) {
          // the phone's Snap button: pass it to the Challenge pages (the ones not scanning)
          try {
            const msg = JSON.parse(toBuffer(data).toString("utf8")) as PhoneToServer;
            if (msg.type === "freeze") {
              // the phone's Freeze button: the Story pages toggle and report back ("frozen")
              for (const desk of scanners) sendJson(desk, { type: "freeze" } satisfies FreezeMessage);
            }
            if (msg.type === "snap") {
              let sent = false;
              for (const desk of desktops) {
                if (scanners.has(desk)) continue;
                sendJson(desk, { type: "snap" } satisfies SnapMessage);
                sent = true;
              }
              if (sent) sendJson(ws, { type: "snapped" } satisfies ServerToPhone);
            }
          } catch {
            /* ignore malformed messages */
          }
          return;
        }
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
        leftEmpty();
      });
    } else if (role === "desktop") {
      desktops.add(ws);
      if (url.searchParams.get("scan") !== "0") scanners.add(ws);
      // Story pages report when the desk is frozen (the phone shows it; scanning pauses meanwhile)
      ws.on("message", (data: RawData, isBinary: boolean) => {
        if (isBinary) return;
        try {
          const msg = JSON.parse(toBuffer(data).toString("utf8")) as DesktopToServer;
          if (msg.type === "frozen" && scanners.has(ws)) {
            frozen = msg.frozen;
            syncScanLoop();
            broadcastStatus();
          }
        } catch {
          /* ignore malformed messages */
        }
      });
      ws.on("close", () => {
        desktops.delete(ws);
        scanners.delete(ws);
        if (scanners.size === 0) frozen = false;
        syncScanLoop(); // stops scanning when nobody is watching
        broadcastStatus();
        leftEmpty();
      });
    } else {
      ws.close(1008, "role must be phone or desktop");
      leftEmpty();
      return;
    }

    ws.on("error", () => {
      /* handled by close */
    });
    syncScanLoop();
    broadcastStatus();
  }

  return { join };
}
