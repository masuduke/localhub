import { prisma } from "../../../lib/prisma";
import { requireAuth } from "../../../lib/auth";
import { ok, err, methodNotAllowed } from "../../../lib/apiHelpers";

export default async function handler(req, res) {
  if (req.method === "GET") {
    try {
      const payload = requireAuth(req);
      const notifs = await prisma.notification.findMany({
        where: { userId: payload.sub },
        orderBy: { createdAt: "desc" },
        take: 50,
      });
      const unread = notifs.filter((n) => !n.isRead).length;
      return ok(res, { notifications: notifs, unread });
    } catch (e) {
      return err(res, e.message, e.status || 401);
    }
  }

  if (req.method === "PATCH") {
    try {
      const payload = requireAuth(req);
      await prisma.notification.updateMany({
        where: { userId: payload.sub, isRead: false },
        data: { isRead: true },
      });
      return ok(res, { message: "All marked as read" });
    } catch (e) {
      return err(res, e.message, e.status || 401);
    }
  }

  return methodNotAllowed(res, ["GET", "PATCH"]);
}
