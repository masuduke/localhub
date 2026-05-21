import { prisma } from "../../../../lib/prisma";
import { requireAuth } from "../../../../lib/auth";
import { ok, err, methodNotAllowed } from "../../../../lib/apiHelpers";

export default async function handler(req, res) {
  if (req.method !== "PATCH") return methodNotAllowed(res, ["PATCH"]);
  try {
    const payload = requireAuth(req);
    const { id } = req.query;
    const { status, note } = req.body;

    const order = await prisma.order.findUnique({ where: { id } });
    if (!order) return err(res, "Order not found", 404);

    const updated = await prisma.$transaction(async (tx) => {
      const upd = await tx.order.update({
        where: { id },
        data: { status, ...(status === "delivered" && { deliveredAt: new Date() }) },
      });
      await tx.orderStatusHistory.create({ data: { orderId: id, status, note } });

      const msgs = {
        accepted:   { icon: "✅", title: "Order Accepted",  body: `${id} has been accepted` },
        ready:      { icon: "📦", title: "Order Ready",     body: `${id} is packed and ready` },
        dispatched: { icon: "🛵", title: "On the Way!",     body: `${id} — driver is heading to you` },
        delivered:  { icon: "🏠", title: "Delivered!",      body: `${id} has been delivered. ⭐ Rate your experience` },
        rejected:   { icon: "❌", title: "Order Rejected",  body: `${id} was rejected.` },
      };
      if (msgs[status]) {
        await tx.notification.create({ data: { userId: order.customerId, type: "order", priority: status === "delivered" ? "high" : "normal", ...msgs[status] } });
      }
      return upd;
    });

    return ok(res, { order: updated });
  } catch (e) {
    return err(res, e.message, e.status || 400);
  }
}
