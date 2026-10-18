/**
 * Every page address in one place. If your router uses different paths for the existing
 * pages, change them here and nothing else.
 */
export const ROUTES = {
  home: "/",
  story: "/story",
  challenge: "/challenge",
  how: "/how-to-play",
  credits: "/credits",
  /** Live video, laptop camera (pages/capture.ts) */
  storyLaptop: "/capture",
  /** Live video, phone camera shown on the laptop (pages/desktop.ts) */
  storyPhone: "/desktop",
} as const;