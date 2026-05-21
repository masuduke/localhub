import { prisma } from "../../../lib/prisma";
import { requireRole } from "../../../lib/auth";
import { ok, err, methodNotAllowed } from "../../../lib/apiHelpers";

export default async function handler(req, res) {
  try { requireRole(req, "admin"); } catch (e) { return err(res, e.message, e.status || 401); }

  if (req.method === "GET") {
    const configs = await prisma.platformConfig.findMany();
    const rates = Object.fromEntries(configs.map((c) => [c.key, c.value]));
    return ok(res, { rates });
  }

  if (req.method === "PATCH") {
    const updates = req.body;
    await Promise.all(
      Object.entries(updates).map(([key, value]) =>
        prisma.platformConfig.upsert({
          where: { key },
          create: { key, value: String(value) },
          update: { value: String(value) },
        })
      )
    );
    return ok(res, { message: "Rates updated" });
  }

  return methodNotAllowed(res, ["GET", "PATCH"]);
}
