import crypto from "crypto";
import { PrismaClient } from "@prisma/client";
import "dotenv/config";

const prisma = new PrismaClient();

function hashKey(plaintext) {
  const salt = process.env.GATEWAY_KEY_SALT || "";
  if (!salt) throw new Error("GATEWAY_KEY_SALT is required");
  return crypto.createHash("sha256").update(`${salt}:${plaintext}`).digest("hex");
}

function randomKey() {
  return crypto.randomBytes(32).toString("hex");
}

async function main() {
  const name = process.env.SEED_KEY_NAME || "default";
  const monthlyLimit = process.env.DEFAULT_MONTHLY_LIMIT_USD || "200.00";

  const key = randomKey();
  const keyHash = hashKey(key);

  // Store monthly limit on ApiKey; 0 means "use DEFAULT_MONTHLY_LIMIT_USD"
  const created = await prisma.apiKey.create({
    data: {
      name,
      keyHash,
      monthlyLimitUsd: monthlyLimit
    }
  });

  console.log("\n✅ Seeded API key");
  console.log("  id:", created.id);
  console.log("  name:", created.name);
  console.log("\n🔑 PLAINTEXT KEY (store this securely; shown only once):\n");
  console.log(key);
  console.log();
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
