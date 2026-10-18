export async function startRearCamera(video: HTMLVideoElement): Promise<MediaStream> {
  if (!window.isSecureContext) {
    throw new Error(
      "Camera needs HTTPS. Open this page via the Vite network URL (https://<laptop-ip>:5173) or a tunnel.",
    );
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("This browser cannot access the camera.");
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    });
    video.srcObject = stream;
    video.playsInline = true;
    video.muted = true;
    await video.play();
    return stream;
  } catch (err) {
    const name = err instanceof DOMException ? err.name : "";
    if (name === "NotAllowedError" || name === "PermissionDeniedError") {
      throw new Error("Camera permission was denied. Allow the camera and reload.");
    }
    if (name === "NotFoundError") {
      throw new Error("No camera was found on this device.");
    }
    throw new Error(err instanceof Error ? err.message : "Could not start the camera.");
  }
}

export function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((t) => t.stop());
}
