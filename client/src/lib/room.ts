/* ------------------------------------------------------------------
   Private rooms: every laptop tab gets its own random room code, and the phone joins it through
   the QR link (/phone?room=...). The server keeps each room's video, scans and buttons separate,
   so many people can play from the same hosted link without seeing each other's desks.
   ------------------------------------------------------------------ */

const ROOM_KEY = "deskcapade.room";
const VALID = /^[a-z0-9]{6,32}$/;

const newRoom = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => (b % 36).toString(36)).join("") + Date.now().toString(36).slice(-4);
};

let room: string | null = null;

/** This tab's room: from the link (phone), else kept for this tab (laptop; survives a reload). */
export function roomId(): string {
  if (room) return room;
  const fromLink = new URLSearchParams(location.search).get("room")?.toLowerCase() ?? "";
  let stored = "";
  try {
    stored = sessionStorage.getItem(ROOM_KEY) ?? "";
  } catch {
    /* storage unavailable */
  }
  room = VALID.test(fromLink) ? fromLink : VALID.test(stored) ? stored : newRoom();
  try {
    sessionStorage.setItem(ROOM_KEY, room);
  } catch {
    /* storage unavailable: a reload just makes a new room */
  }
  return room;
}

/** The address the phone opens (the QR code) to join this laptop's room. */
export const phoneLink = (base: string): string => `${base}/phone?room=${roomId()}`;
