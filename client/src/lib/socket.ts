export type SocketState = "connecting" | "open" | "closed";

export type SocketHandle = {
  /** Returns false if the socket is not open (message dropped). */
  send(msg: unknown): boolean;
  /** Send raw bytes (used for camera frames). Returns false if not open. */
  sendBinary(data: Blob | ArrayBuffer): boolean;
  isOpen(): boolean;
  bufferedAmount(): number;
  close(): void;
};

type Handlers = {
  onMessage: (data: string) => void;
  /** Called for binary messages (camera frames relayed to the laptop). */
  onBinary?: (data: ArrayBuffer) => void;
  onState: (state: SocketState) => void;
};

const MAX_BACKOFF_MS = 5000;

/** WebSocket to /ws with automatic reconnect (backoff 0.5s -> 5s). */
export function connectSocket(role: "phone" | "desktop", handlers: Handlers): SocketHandle {
  let ws: WebSocket | null = null;
  let attempts = 0;
  let stopped = false;
  let retryTimer: number | undefined;

  const open = (): void => {
    if (stopped) return;
    handlers.onState("connecting");
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(`${proto}//${location.host}/ws?role=${role}`);
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      attempts = 0;
      handlers.onState("open");
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data === "string") handlers.onMessage(ev.data);
      else if (ev.data instanceof ArrayBuffer) handlers.onBinary?.(ev.data);
    };
    ws.onclose = () => {
      handlers.onState("closed");
      if (stopped) return;
      const delay = Math.min(MAX_BACKOFF_MS, 500 * 2 ** attempts);
      attempts += 1;
      retryTimer = window.setTimeout(open, delay);
    };
    ws.onerror = () => ws?.close();
  };

  open();

  return {
    send(msg) {
      if (!ws || ws.readyState !== WebSocket.OPEN) return false;
      ws.send(JSON.stringify(msg));
      return true;
    },
    sendBinary(data) {
      if (!ws || ws.readyState !== WebSocket.OPEN) return false;
      ws.send(data);
      return true;
    },
    isOpen: () => ws?.readyState === WebSocket.OPEN,
    bufferedAmount: () => ws?.bufferedAmount ?? 0,
    close() {
      stopped = true;
      window.clearTimeout(retryTimer);
      ws?.close();
    },
  };
}