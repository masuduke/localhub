import { prisma } from "../../../lib/prisma";
import { requireAuth } from "../../../lib/auth";
import { ok, err, methodNotAllowed } from "../../../lib/apiHelpers";

export default async function handler(req, res) {
  if (req.method === "GET") {
    const { country } = req.query;
    const promos = await prisma.promo.findMany({
      where: { country, status: "active", expiresAt: { gt: new Date() } },
      include: { vendor: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });
    return ok(res, { promos });
  }

  if (req.method === "POST") {
    try {
      const payload = requireAuth(req);
      if (!["vendor", "admin"].includes(payload.role)) return err(res, "Forbidden", 403);
      const vendor = await prisma.vendor.findUnique({ where: { userId: payload.sub } });
      if (!vendor && payload.role !== "admin") return err(res, "Vendor not found", 404);
      const { title, description, discount, type, minOrder, category, emoji, color, expiresInSeconds } = req.body;
      const expiresAt = new Date(Date.now() + Number(expiresInSeconds || 86400) * 1000);
      const promo = await prisma.promo.create({
        data: {
          vendorId: vendor?.id || req.body.vendorId,
          country: vendor?.country || req.body.country,
          title, description,
          discount: Number(discount),
          type, minOrder: Number(minOrder),
          category, emoji, color,
          status: payload.role === "admin" ? "active" : "pending",
          expiresAt,
        },
      });
      return ok(res, { promo }, 201);
    } catch (e) {
      return err(res, e.message, e.status || 400);
    }
  }

  return methodNotAllowed(res, ["GET", "POST"]);
}
