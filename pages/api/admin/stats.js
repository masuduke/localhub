import { prisma } from "../../../lib/prisma";
import { requireRole } from "../../../lib/auth";
import { ok, err, methodNotAllowed } from "../../../lib/apiHelpers";

export default async function handler(req, res) {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);
  try {
    requireRole(req, "admin");
    const [uk, bd] = await Promise.all(
      ["uk", "bd"].map(async (country) => {
        const [users, vendors, drivers, ordersData] = await Promise.all([
          prisma.user.count({ where: { country } }),
          prisma.vendor.count({ where: { country } }),
          prisma.driver.count({ where: { country } }),
          prisma.order.aggregate({
            where: { country, status: { not: "rejected" } },
            _count: { id: true },
            _sum: { total: true, platformFee: true },
          }),
        ]);
        return {
          users, vendors, drivers,
          orders: ordersData._count.id,
          revenue: ordersData._sum.total || 0,
          commission: ordersData._sum.platformFee || 0,
        };
      })
    );
    return ok(res, { uk, bd });
  } catch (e) {
    return err(res, e.message, e.status || 400);
  }
}
