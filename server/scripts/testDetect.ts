/**
 * Send a local image to Perceptron POST /v1/detect (live, never mock) to verify the API key.
 * Usage: npx tsx server/scripts/testDetect.ts ./some-image.jpg
 */
import fs from "node:fs";
import path from "node:path";
import { config } from "../src/config.js";
import { detectRaw } from "../src/services/perceptron.js";

const fileArg = process.argv[2];
if (!fileArg) {
  console.error("Usage: npx tsx server/scripts/testDetect.ts <image-file>");
  process.exit(1);
}

const filePath = path.resolve(fileArg);
if (!fs.existsSync(filePath)) {
  console.error(`File not found: ${filePath}`);
  process.exit(1);
}

if (!config.perceptronApiKey || config.perceptronApiKey === "your-api-key-here") {
  console.error("No real PERCEPTRON_API_KEY in .env — cannot verify the key.");
  process.exit(1);
}

const ext = path.extname(filePath).toLowerCase();
const mime =
  ext === ".png"
    ? "image/png"
    : ext === ".webp"
      ? "image/webp"
      : ext === ".gif"
        ? "image/gif"
        : "image/jpeg";

const b64 = fs.readFileSync(filePath).toString("base64");
const imageUrl = `data:${mime};base64,${b64}`;

console.log(`POST ${config.perceptronBaseUrl}/v1/detect  (${path.basename(filePath)})`);

try {
  const { status, body } = await detectRaw(imageUrl);
  console.log("status", status);
  console.log(JSON.stringify(body, null, 2));
  process.exit(status >= 200 && status < 300 ? 0 : 1);
} catch (err) {
  console.error("Request failed:", err instanceof Error ? err.message : err);
  process.exit(1);
}
