import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type * as z4 from "zod/v4";

// The only module that talks to the Anthropic SDK. Everything else goes
// through generate() / generateStructured() / generateVision().

const MODEL = "claude-opus-5";
const DEFAULT_TIMEOUT_MS = 60_000;

// Lazily constructed so .env loading (in index.ts) runs before the SDK reads
// ANTHROPIC_API_KEY — ESM evaluates imported modules before the entrypoint body.
let _client: Anthropic | undefined;
function client(): Anthropic {
  _client ??= new Anthropic({
    maxRetries: 2, // SDK retries 429 / 5xx / connection errors with backoff
  });
  return _client;
}

export class LlmError extends Error {
  constructor(
    public readonly code:
      | "rate_limited"
      | "auth"
      | "timeout"
      | "refused"
      | "truncated"
      | "bad_output"
      | "api_error",
    message: string,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

function mapError(err: unknown): LlmError {
  if (err instanceof LlmError) return err;
  if (err instanceof Anthropic.RateLimitError) {
    return new LlmError("rate_limited", "The AI service is busy. Please try again in a moment.");
  }
  if (err instanceof Anthropic.AuthenticationError) {
    return new LlmError("auth", "Server is missing a valid ANTHROPIC_API_KEY.");
  }
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return new LlmError("timeout", "The AI request timed out. Please try again.");
  }
  if (err instanceof Anthropic.APIError) {
    return new LlmError("api_error", `AI service error: ${err.message}`);
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new LlmError("api_error", "Could not reach the AI service.");
  }
  return new LlmError("api_error", err instanceof Error ? err.message : "Unknown error");
}

// One extra application-level retry for timeouts; all calls here are idempotent.
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof Anthropic.APIConnectionTimeoutError) {
      return await fn();
    }
    throw err;
  }
}

function checkStopReason(response: { stop_reason: string | null }): void {
  if (response.stop_reason === "refusal") {
    throw new LlmError("refused", "The AI declined to process this request.");
  }
  if (response.stop_reason === "max_tokens") {
    throw new LlmError("truncated", "The AI response was cut short. Please try a shorter input.");
  }
}

export interface ImagePart {
  kind: "image";
  base64: string;
  mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
}

export interface TextPart {
  kind: "text";
  text: string;
}

export type VisionPart = ImagePart | TextPart;

type UserContent = Anthropic.Messages.ContentBlockParam[];

function toContent(parts: VisionPart[]): UserContent {
  return parts.map((p) =>
    p.kind === "text"
      ? { type: "text" as const, text: p.text }
      : {
          type: "image" as const,
          source: { type: "base64" as const, media_type: p.mediaType, data: p.base64 },
        },
  );
}

export async function generate(opts: {
  system: string;
  prompt: string;
  maxTokens: number;
  timeoutMs?: number;
}): Promise<string> {
  try {
    const response = await withRetry(() =>
      client().messages.create(
        {
          model: MODEL,
          max_tokens: opts.maxTokens,
          system: opts.system,
          messages: [{ role: "user", content: opts.prompt }],
        },
        { timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS },
      ),
    );
    checkStopReason(response);
    const text = response.content.find((b) => b.type === "text");
    if (!text) throw new LlmError("bad_output", "The AI returned no text.");
    return text.text;
  } catch (err) {
    throw mapError(err);
  }
}

async function structuredCall<S extends z4.ZodType>(opts: {
  system: string;
  content: string | UserContent;
  schema: S;
  maxTokens: number;
  timeoutMs?: number;
}): Promise<z4.infer<S>> {
  try {
    const response = await withRetry(() =>
      client().messages.parse(
        {
          model: MODEL,
          max_tokens: opts.maxTokens,
          system: opts.system,
          messages: [{ role: "user", content: opts.content }],
          output_config: { format: zodOutputFormat(opts.schema) },
        },
        { timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS },
      ),
    );
    checkStopReason(response);
    if (response.parsed_output == null) {
      throw new LlmError("bad_output", "The AI returned an unparseable response.");
    }
    return response.parsed_output as z4.infer<S>;
  } catch (err) {
    throw mapError(err);
  }
}

export async function generateStructured<S extends z4.ZodType>(opts: {
  system: string;
  prompt: string;
  schema: S;
  maxTokens: number;
  timeoutMs?: number;
}): Promise<z4.infer<S>> {
  return structuredCall({ ...opts, content: opts.prompt });
}

export async function generateVision<S extends z4.ZodType>(opts: {
  system: string;
  parts: VisionPart[];
  schema: S;
  maxTokens: number;
  timeoutMs?: number;
}): Promise<z4.infer<S>> {
  return structuredCall({ ...opts, content: toContent(opts.parts) });
}
