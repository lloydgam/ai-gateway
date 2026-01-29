import crypto from "crypto";
import { prisma } from "./prisma.js";
import { json } from "stream/consumers";
import { pl } from "zod/v4/locales";

export function hashKey(plaintext) {
  const salt = process.env.GATEWAY_KEY_SALT || "";
  if (!salt) throw new Error("GATEWAY_KEY_SALT is required");
  return crypto.createHash("sha256").update(`${salt}:${plaintext}`).digest("hex");
}

export async function requireApiKey(req) {
  let plaintext;

  const auth = req.headers["authorization"] || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  
  if (m) {
    plaintext = m[1].trim();
  } else if (req.headers["x-api-key"]) {
    plaintext = req.headers["x-api-key"].toString().trim();
    // Try to find by claudecodeUserKey
    if (plaintext.startsWith("sk-ant-api")) {
      try {
        const userByMapper = await prisma.userApiKey.findUnique({ where: { claudecodeUserKey: plaintext } });
        if (userByMapper && userByMapper.aigatewayUserKey) {
          // Use aigatewayUserKey as the plaintext for hashing and downstream
          plaintext = userByMapper.aigatewayUserKey;
        } else {
          return { ok: false, status: 403, error: "Invalid or unmapped ClaudeCode API key: " + plaintext + " Please report this error message to rocks support together with your email information"};
        }
      } catch (err) {
        return { ok: false, status: 500, error: "Server error during ClaudeCode API key lookup" };
      }
    }
  }
  if (!plaintext) {
    return { ok: false, status: 401, error: "Missing Bearer token or x-api-key" };
  }

  const keyHash = hashKey(plaintext);
  // Try ApiKey table first
  let apiKey = await prisma.apiKey.findUnique({ where: { keyHash } });
  if (apiKey && apiKey.isActive) {
    // update last used (best-effort)
    prisma.apiKey.update({
      where: { id: apiKey.id },
      data: { lastUsedAt: new Date() }
    }).catch(() => {});
    return { ok: true, apiKey, type: 'gateway' };
  }
  // Try UserApiKey table
  let userApiKey = await prisma.userApiKey.findUnique({ where: { apiKeyHash: keyHash } });
  if (userApiKey && userApiKey.isActive) {
    return { ok: true, apiKey: userApiKey, type: 'user' };
  }
  return { ok: false, status: 403, error: "Invalid or disabled API key" };
}
