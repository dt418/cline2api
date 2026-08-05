import { AsyncQueue } from "./async-queue.js";
import { BoundedDiagnostics } from "./diagnostics.js";
import type { ClineCliEvent, NdjsonLimits } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function normalizeNdjsonMessage(value: unknown): ClineCliEvent | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const text = optionalString(value.text);
  const subtype = optionalString(value.type === "say" ? value.say : value.ask);
  const partial = typeof value.partial === "boolean" ? value.partial : undefined;

  if (value.type === "say") {
    return { transport: "ndjson", kind: "message", text, subtype, partial };
  }

  if (value.type === "ask") {
    return { transport: "ndjson", kind: "ask", text, subtype, partial };
  }

  return undefined;
}

function decodeLine(parts: readonly Buffer[]): string {
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let line = "";
  for (const part of parts) {
    line += decoder.decode(part, { stream: true });
  }
  return line + decoder.decode();
}

export async function consumeNdjsonOutput(
  stream: NodeJS.ReadableStream,
  queue: AsyncQueue<ClineCliEvent>,
  diagnostics: BoundedDiagnostics,
  limits: NdjsonLimits,
): Promise<void> {
  let lineParts: Buffer[] = [];
  let lineBytes = 0;
  let discarding = false;
  let pendingCarriageReturn = false;

  const appendPayload = (part: Buffer): void => {
    if (part.byteLength === 0) return;
    lineBytes += part.byteLength;
    if (!discarding && lineBytes <= limits.maxLineBytes) {
      lineParts.push(part);
    } else {
      discarding = true;
    }
  };

  const appendSegment = (part: Buffer, terminatedByLf: boolean): void => {
    if (pendingCarriageReturn) {
      if (!terminatedByLf || part.byteLength > 0) appendPayload(Buffer.from([0x0d]));
      pendingCarriageReturn = false;
    }

    const endsWithCarriageReturn = part.at(-1) === 0x0d;
    if (endsWithCarriageReturn) {
      appendPayload(part.subarray(0, -1));
      pendingCarriageReturn = !terminatedByLf;
    } else {
      appendPayload(part);
    }
  };

  const finishLine = (): void => {
    if (discarding) {
      diagnostics.recordMalformedMessage();
      diagnostics.markTruncated();
    } else if (lineBytes > 0) {
      const line = decodeLine(lineParts);
      try {
        const event = normalizeNdjsonMessage(JSON.parse(line) as unknown);
        if (event === undefined) {
          diagnostics.recordMalformedMessage();
        } else if (diagnostics.recordEvent()) {
          queue.push(event);
        }
      } catch {
        diagnostics.recordMalformedMessage();
      }
    }

    lineParts = [];
    lineBytes = 0;
    discarding = false;
  };

  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    diagnostics.recordStdout(bytes.byteLength);
    let start = 0;
    for (let index = 0; index < bytes.length; index += 1) {
      if (bytes[index] !== 0x0a) {
        continue;
      }

      const part = bytes.subarray(start, index);
      appendSegment(part, true);
      finishLine();
      start = index + 1;
    }

    if (start < bytes.length) {
      const part = bytes.subarray(start);
      appendSegment(part, false);
    }
  }

  if (pendingCarriageReturn) appendPayload(Buffer.from([0x0d]));
  if (lineBytes > 0 || discarding) {
    finishLine();
  }
  queue.close();
}
