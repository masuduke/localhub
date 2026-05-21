import Stripe from "stripe";
import { prisma } from "../../../lib/prisma";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-04-10" });

// Disable Next.js body parsing — Stripe needs raw body
export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const rawBody = await getRawBody(req);
  const sig = req.headers["stripe-signature"];

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Stripe webhook signature failed:", err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  try {
    switch (event.type) {

      case "payment_intent.succeeded": {
        const intent = event.data.object;
        const orderId = intent.metadata?.orderId;
        if (!orderId) break;

        const order = await prisma.order.update({
          where: { id: orderId },
          data: { isPaid: true, paymentRef: intent.id, status: "accepted" },
          include: { customer: true, vendor: { include: { user: true } }, items: true },
        });

        await prisma.orderStatusHistory.create({
          data: { orderId, status: "accepted", note: `Stripe payment ${intent.id}` },
        });

        // Credit loyalty points
        if (order.pointsEarned > 0) {
          await prisma.user.update({
            where: { id: order.customerId },
            data: { loyaltyPoints: { increment: order.pointsEarned } },
          });
          await prisma.pointsTransaction.create({
            data: { userId: order.customerId, type: "earn", points: order.pointsEarned, description: `Order ${orderId} — Stripe`, orderId },
          });
        }

        // Notify customer
        await prisma.notification.create({
          data: { userId: order.customerId, type: "payment", icon: "✅", title: "Payment Confirmed", body: `Order ${orderId} paid · ${order.pointsEarned} pts earned`, priority: "high" },
        });

        // Notify vendor
        if (order.vendor?.user) {
          await prisma.notification.create({
            data: { userId: order.vendor.user.id, type: "order", icon: "📦", title: "New Paid Order", body: `${orderId} · £${order.total} — ready to fulfil`, priority: "high" },
          });
          await prisma.vendor.update({
            where: { id: order.vendorId },
            data: { totalSales: { increment: order.subtotal }, commissionOwed: { increment: order.platformFee } },
          });
        }

        // Update driver earnings
        if (order.driverId) {
          await prisma.driver.update({
            where: { id: order.driverId },
            data: {
              totalEarnings: { increment: order.deliveryFee * 0.9 },
              monthEarnings: { increment: order.deliveryFee * 0.9 },
              commissionPaid: { increment: order.deliveryFee * 0.1 },
              totalTrips: { increment: 1 },
            },
          });
        }
        break;
      }

      case "payment_intent.payment_failed": {
        const intent = event.data.object;
        const orderId = intent.metadata?.orderId;
        if (!orderId) break;

        await prisma.order.update({ where: { id: orderId }, data: { status: "rejected" } });
        await prisma.orderStatusHistory.create({
          data: { orderId, status: "rejected", note: `Payment failed: ${intent.last_payment_error?.message}` },
        });

        const order = await prisma.order.findUnique({ where: { id: orderId } });
        if (order) {
          await prisma.notification.create({
            data: { userId: order.customerId, type: "payment", icon: "❌", title: "Payment Failed", body: `Order ${orderId} could not be processed. Please try again.`, priority: "high" },
          });
        }
        break;
      }

      case "charge.refunded": {
        const charge = event.data.object;
        const orderId = charge.metadata?.orderId;
        if (orderId) {
          await prisma.order.update({ where: { id: orderId }, data: { status: "refunded" } });
        }
        break;
      }

      default:
        console.log(`Unhandled Stripe event: ${event.type}`);
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("Webhook handler error:", err);
    return res.status(500).json({ error: "Internal webhook error" });
  }
}
