import type { Request, Response, NextFunction } from "express";

const MAX_STRING_LENGTH = 500000; // large enough for base64 images and video URLs
const MAX_ARRAY_LENGTH = 200;
const MAX_OBJECT_DEPTH = 6;

// Recursively walks req.body and rejects payloads that are too large,
// too deep, or contain string values that look like script injection.
// This runs BEFORE any route handler, so it protects every endpoint
// without needing per-route schema changes.
function isDangerousString(value: string): boolean {
  // Catches obvious script/HTML injection attempts in text fields
  // (notes, descriptions, names) without blocking normal punctuation.
  return /<script|<\/script|javascript:|on\w+\s*=/i.test(value);
}

function validateValue(value: unknown, depth: number): string | null {
  if (depth > MAX_OBJECT_DEPTH) return "Payload is too deeply nested.";

  if (typeof value === "string") {
    if (value.length > MAX_STRING_LENGTH) return `A field exceeds the maximum allowed length (${MAX_STRING_LENGTH} characters).`;
    if (isDangerousString(value)) return "A field contains disallowed content.";
    return null;
  }

  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_LENGTH) return `A list exceeds the maximum allowed length (${MAX_ARRAY_LENGTH} items).`;
    for (const item of value) {
      const err = validateValue(item, depth + 1);
      if (err) return err;
    }
    return null;
  }

  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      const err = validateValue((value as Record<string, unknown>)[key], depth + 1);
      if (err) return err;
    }
    return null;
  }

  // numbers, booleans, null, undefined — all fine as-is
  return null;
}

export function sanitizeBody(req: Request, res: Response, next: NextFunction): void {
  if (req.body && typeof req.body === "object") {
    const error = validateValue(req.body, 0);
    if (error) {
      // console.error("sanitizeBody rejected:", JSON.stringify(req.body), "reason:", error);
      res.status(400).json({ error });
      return;
    }
  }
  next();
}