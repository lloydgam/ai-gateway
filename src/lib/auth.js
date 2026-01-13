import crypto from "crypto";
import { prisma } from "./prisma.js";

function hashKey(plaintext) {
  const salt = process.env.GATEWAY_KEY_SALT || "";
  if (!salt) throw new Error("GATEWAY_KEY_SALT is required");
  return crypto.createHash("sha256").update(`${salt}:${plaintext}`).digest("hex");
}

export async function requireApiKey(req) {
  const auth = req.headers["authorization"] || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) {
    return { ok: false, status: 401, error: "Missing Bearer token" };
  }
  const plaintext = m[1].trim();
  if (!plaintext) {
    return { ok: false, status: 401, error: "Missing Bearer token" };
  }

  const keyHash = hashKey(plaintext);
  const apiKey = await prisma.apiKey.findUnique({ where: { keyHash } });

  if (!apiKey || !apiKey.isActive) {
    return { ok: false, status: 403, error: "Invalid or disabled API key" };
  }

  // update last used (best-effort)
  prisma.apiKey.update({
    where: { id: apiKey.id },
    data: { lastUsedAt: new Date() }
  }).catch(() => {});

  return { ok: true, apiKey };
}
