import { PrismaClient } from "@prisma/client";

/**
 * Prisma client singleton (Node runtime).
 * Uses DATABASE_URL (Neon pooled) for queries; migrations use
 * DATABASE_URL_UNPOOLED via schema `directUrl`.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["error", "warn"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
