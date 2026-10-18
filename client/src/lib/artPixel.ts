/** Art pixel size (canvas pixels) for a picture `height` tall. Pieces, decorations and backdrop share it. */
export const artPixelSize = (height: number): number => Math.max(2, Math.round(height / 260));
