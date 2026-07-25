import { randomUUID } from "node:crypto";
import type { ImagePart } from "./llm.js";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_STORED_IMAGES = 40;

type ImageMediaType = ImagePart["mediaType"];

interface StoredImage {
  buffer: Buffer;
  mediaType: ImageMediaType;
}

// In-memory, LRU-capped photo store. Ephemeral by design — fine for a demo.
const store = new Map<string, StoredImage>();

export class UploadError extends Error {}

export function sniffImageType(buffer: Buffer): ImageMediaType | null {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  return null;
}

export function putImage(buffer: Buffer): { id: string; mediaType: ImageMediaType } {
  if (buffer.length === 0) throw new UploadError("Empty file.");
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new UploadError("Image is larger than 5 MB.");
  }
  const mediaType = sniffImageType(buffer);
  if (!mediaType) {
    throw new UploadError("Unsupported file type. Use JPEG, PNG, or WebP.");
  }
  const id = randomUUID();
  store.set(id, { buffer, mediaType });
  while (store.size > MAX_STORED_IMAGES) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
  return { id, mediaType };
}

export function getImage(id: string): StoredImage | undefined {
  const img = store.get(id);
  if (img) {
    // refresh LRU position
    store.delete(id);
    store.set(id, img);
  }
  return img;
}

const LOCAL_UPLOAD_RE = /\/uploads\/([0-9a-f-]{36})$/i;

/**
 * Resolve a photo URL to an image part for the LLM. Local upload URLs are read
 * straight from the store; remote http(s) URLs are fetched and re-validated
 * (size + magic bytes) before use.
 */
export async function resolveImage(url: string): Promise<ImagePart> {
  const local = LOCAL_UPLOAD_RE.exec(url);
  if (local) {
    const img = getImage(local[1]);
    if (!img) {
      throw new UploadError(
        `Uploaded photo not found (${url}). Uploads are temporary — please re-upload and try again.`,
      );
    }
    return { kind: "image", base64: img.buffer.toString("base64"), mediaType: img.mediaType };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new UploadError(`Not a valid photo URL: ${url}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new UploadError(`Photo URLs must be http(s): ${url}`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  let response: Response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } catch {
    throw new UploadError(`Could not fetch photo: ${url}`);
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    throw new UploadError(`Could not fetch photo (HTTP ${response.status}): ${url}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new UploadError(`Photo is larger than 5 MB: ${url}`);
  }
  const mediaType = sniffImageType(bytes);
  if (!mediaType) {
    throw new UploadError(`URL is not a JPEG/PNG/WebP image: ${url}`);
  }
  return { kind: "image", base64: bytes.toString("base64"), mediaType };
}
