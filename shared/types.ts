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
  /** Story's live scans: ask for plain object categories (much faster than full descriptions). */
  fast?: boolean;
};

/**
 * What the fast live scans look for: every object the game has a transformation for, plus common
 * desk things (the AI matcher maps those to the closest listed object).
 */
export const DESK_CATEGORIES: readonly string[] = [
  "can", "cup", "mug", "bowl", "drinking glass", "pencil", "pen", "phone", "eraser", "cube", "sticky note",
  "scissors", "knife", "spoon", "fork", "eyeglasses", "plastic water bottle", "bottle", "cable", "mouse",
  "keyboard", "lamp", "candle", "plate", "ball", "toy", "book", "notebook", "laptop", "tablet", "box",
  "headphones", "wallet", "keys", "remote", "calculator", "stapler", "tape", "charger", "plant", "watch",
];

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

/** The phone's Snap button was pressed: the Challenge page takes its photo. */
export type SnapMessage = { type: "snap" };

export type ServerToDesktop = FrameMessage | ScanResultMessage | StatusToDesktop | ErrorMessage | SnapMessage;

/** Text messages the phone sends (frames go as binary). */
export type PhoneToServer = SnapMessage;

/** `ack` tells the phone its last frame arrived, so it can send the next (fresh) one. */
export type ServerToPhone =
  | { type: "status"; desktopConnected: boolean; /** a Challenge page is open: show the Snap button */ canSnap: boolean }
  | { type: "ack" }
  /** your snap reached the laptop */
  | { type: "snapped" };

export type InfoResponse = { lanUrls: string[]; tunnelUrl?: string };

// ---------- Challenge course designer (POST /api/course) ----------

export type Difficulty = "easy" | "medium" | "hard" | "boss";

/** A desk object as the game sees it, in the level's canvas pixels. */
export type CourseObject = { id: string; label: string; kind: string; box: Box };

export type CourseRequest = {
  difficulty: Difficulty;
  /** Level canvas size; every coordinate in the request and the answer uses it. */
  width: number;
  height: number;
  /** The desk photo, a small JPEG data URL (optional). */
  image?: string;
  objects: CourseObject[];
  physics: { groundY: number; jumpHeight: number; jumpReach: number; playerWidth: number; playerHeight: number };
};

/** The designer's plan. The game validates it and fills any gaps before it is played. */
export type CourseDesign = {
  title: string;
  intro: string;
  start: { x: number; y: number };
  goal: { x: number; y: number };
  /** Extra floating ledges: top-left x, top y, width, and how they behave. */
  ledges: { x: number; y: number; w: number; style?: "still" | "moving" | "crumbling" }[];
  /** Hazards on the ground: left x and width. */
  hazards: { kind: "spikes" | "lava"; x: number; w: number }[];
  /** Coins to collect (all of them) before the flag counts. */
  coins: { x: number; y: number }[];
  /** Beetles that patrol a surface near each point (touch = back to start, stomp = knocked out). */
  critters?: { x: number; y: number }[];
  /** How long a decent player needs, generously (the course must be beaten within this). */
  timeLimitSec?: number;
};

/** POST /api/match answer: unlisted desk-object label -> the kind of the listed object it's most like. */
export type MatchResponse = { ok: true; kinds: Record<string, string> };

export type CourseResponse = { ok: true; design: CourseDesign; model: string };