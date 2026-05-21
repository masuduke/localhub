import { prisma } from "../../../lib/prisma";
import { requireAuth } from "../../../lib/auth";
import { ok, err, methodNotAllowed } from "../../../lib/apiHelpers";

export default async function handler(req, res) {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);
  try {
    const payload = requireAuth(req);
    const vendor = await prisma.vendor.findUnique({ where: { userId: payload.sub } });
    if (!vendor) return err(res, "Vendor not found", 404);
    const orders = await prisma.order.findMany({
      where: { vendorId: vendor.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { items: true, customer: { select: { name: true, email: true } } },
    });
    return ok(res, { orders });
  } catch (e) {
    return err(res, e.message, e.status || 400);
  }
}
