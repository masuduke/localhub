import { prisma } from "../../../lib/prisma";
import { requireAuth } from "../../../lib/auth";
import { ok, err, methodNotAllowed } from "../../../lib/apiHelpers";
import { nanoid } from "nanoid";

const POINTS_PER_GBP = 10, POINTS_PER_BDT = 1;
function calcPoints(total, country) {
  return Math.floor(total * (country === "uk" ? POINTS_PER_GBP : POINTS_PER_BDT));
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    try {
      const payload = requireAuth(req);
      const { status, page, limit } = req.query;
      const where = { customerId: payload.sub, ...(status && { status }) };
      const [orders, total] = await Promise.all([
        prisma.order.findMany({
          where, take: Number(limit || 20), skip: ((Number(page || 1) - 1) * Number(limit || 20)),
          orderBy: { createdAt: "desc" },
          include: { items: true, driver: { include: { user: { select: { name: true } } } }, vendor: { select: { name: true } } },
        }),
        prisma.order.count({ where }),
      ]);
      return ok(res, { orders, total });
    } catch (e) {
      return err(res, e.message, e.status || 400);
    }
  }

  if (req.method === "POST") {
    try {
      const payload = requireAuth(req);
      const {
        items, vendorId, driverId, subtotal, discount = 0, deliveryFee = 0,
        platformFee, total, payment, promoId, addressLine1, addressCity,
        addressPostcode, addressLat, addressLng, pickupAddress, pickupLat,
        pickupLng, distanceMiles,
      } = req.body;

      if (!items?.length) return err(res, "Order must have items", 422);
      if (!payment) return err(res, "Payment method required", 422);

      const orderId = "ORD-" + nanoid(6).toUpperCase();
      const country = payload.country;
      const pointsEarned = calcPoints(subtotal - discount, country);

      const order = await prisma.$transaction(async (tx) => {
        const newOrder = await tx.order.create({
          data: {
            id: orderId,
            customerId: payload.sub,
            vendorId: vendorId || null,
            driverId: driverId || null,
            country,
            status: "pending",
            subtotal: Number(subtotal),
            discount: Number(discount),
            deliveryFee: Number(deliveryFee),
            platformFee: Number(platformFee || subtotal * 0.1),
            total: Number(total),
            payment,
            promoId: promoId || null,
            pointsEarned,
            addressLine1, addressCity, addressPostcode,
            addressLat: Number(addressLat || 0),
            addressLng: Number(addressLng || 0),
            pickupAddress,
            pickupLat: Number(pickupLat || 0),
            pickupLng: Number(pickupLng || 0),
            distanceMiles: Number(distanceMiles || 0),
            items: {
              create: items.map((item) => ({
                name: item.name,
                price: Number(item.price),
                qty: Number(item.qty || 1),
                emoji: item.emoji || null,
                productId: item.productId || null,
                from: item.from || null,
              })),
            },
          },
          include: { items: true },
        });

        if (pointsEarned > 0) {
          await tx.user.update({ where: { id: payload.sub }, data: { loyaltyPoints: { increment: pointsEarned } } });
          await tx.pointsTransaction.create({ data: { userId: payload.sub, type: "earn", points: pointsEarned, description: `Order ${orderId}`, orderId } });
        }

        await tx.orderStatusHistory.create({ data: { orderId, status: "pending" } });

        if (vendorId) {
          const vendor = await tx.vendor.findUnique({ where: { id: vendorId }, select: { userId: true } });
          if (vendor) {
            await tx.notification.create({ data: { userId: vendor.userId, type: "order", icon: "📦", title: "New Order Received", body: `${orderId} · ${country === "uk" ? "£" : "৳"}${total}`, priority: "high" } });
          }
        }

        return newOrder;
      });

      return ok(res, { order, pointsEarned }, 201);
    } catch (e) {
      return err(res, e.message, e.status || 400);
    }
  }

  return methodNotAllowed(res, ["GET", "POST"]);
}
