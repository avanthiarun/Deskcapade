/** Axis-aligned box in image pixels (top-left origin). */
export type Box = { x: number; y: number; w: number; h: number };

export type DetectedObject = { id: string; box: Box; label?: string };

export type ScanResponse = {
  ok: true;
  objects: DetectedObject[];
  imageSize: { w: number; h: number };
  latencyMs: number;
  mock: boolean;
};

export type ApiError = { ok: false; error: string; code?: string };

/** Future world model (unused in Milestone 1). */
export type WorldObject = DetectedObject & {
  ocr?: string;
  material?: string;
  sprite?: string;
  reaction?: string;
};

export type HealthResponse = { ok: true; mock: boolean; scanMaxWidth?: number };

export type ScanRequest = {
  image: string;
  width: number;
  height: number;
};

// ---------- WebSocket relay (phone camera -> server -> laptop) ----------

/** A camera frame. Sent phone -> server, then relayed unchanged to desktops. */
export type FrameMessage = {
  type: "frame";
  image: string; // JPEG data URL
  width: number;
  height: number;
};

export type DesktopToServer =
  | { type: "scan" }
  | { type: "autoscan"; enabled: boolean; intervalMs: number };

export type ScanResultMessage = { type: "scanResult" } & ScanResponse;

export type StatusToDesktop = {
  type: "status";
  phoneConnected: boolean;
  autoscan: boolean;
  mock: boolean;
};

export type ErrorMessage = { type: "error"; error: string; code?: string };

export type ServerToDesktop = FrameMessage | ScanResultMessage | StatusToDesktop | ErrorMessage;

/** `ack` tells the phone its last frame arrived, so it can send the next (fresh) one. */
export type ServerToPhone = { type: "status"; desktopConnected: boolean } | { type: "ack" };

export type InfoResponse = { lanUrls: string[]; tunnelUrl?: string };