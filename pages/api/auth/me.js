import { prisma } from "../../../lib/prisma";
import { requireAuth } from "../../../lib/auth";
import { ok, err, methodNotAllowed } from "../../../lib/apiHelpers";

export default async function handler(req, res) {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);
  try {
    const payload = requireAuth(req);
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        vendor: true,
        driver: { select: { id: true, status: true, isOnline: true, rating: true, totalTrips: true, pricingBase: true, pricingPerUnit: true, pricingMin: true, pricingMaxDist: true, totalEarnings: true, monthEarnings: true } },
        notifications: { where: { isRead: false }, orderBy: { createdAt: "desc" }, take: 20 },
      },
    });
    if (!user) return err(res, "User not found", 404);
    const { passwordHash: _, ...safeUser } = user;
    return ok(res, { user: safeUser });
  } catch (e) {
    return err(res, e.message, e.status || 401);
  }
}
