import type { ApiError, HealthResponse, ScanResponse } from "@deskcapade/shared";

async function readJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

export async function getHealth(): Promise<HealthResponse> {
  const res = await fetch("/api/health");
  const body = await readJson<HealthResponse | ApiError>(res);
  if (!res.ok || !("mock" in body)) {
    const err = body as ApiError;
    throw new Error(err.error ?? "Health check failed");
  }
  return body;
}

export async function postScan(input: {
  image: string;
  width: number;
  height: number;
}): Promise<ScanResponse> {
  const res = await fetch("/api/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await readJson<ScanResponse | ApiError>(res);
  if (!res.ok || !body.ok) {
    const err = body as ApiError;
    throw new Error(err.error ?? `Scan failed (${res.status})`);
  }
  return body;
}
