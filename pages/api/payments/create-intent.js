import Stripe from "stripe";
import { requireAuth } from "../../../lib/auth";
import { prisma } from "../../../lib/prisma";
import { ok, err, methodNotAllowed } from "../../../lib/apiHelpers";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-04-10" });

export default async function handler(req, res) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
  try {
    const payload = requireAuth(req);
    const { orderId, amount, currency = "gbp", checkout = false, successUrl, cancelUrl } = req.body;

    if (!amount || amount < 0.5) return err(res, "Amount must be at least £0.50", 422);

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { email: true, name: true },
    });

    if (checkout) {
      const origin = req.headers.origin || `https://${req.headers.host}`;
      const success = successUrl || `${origin}/app?checkout=success&orderId=${encodeURIComponent(orderId || "")}`;
      const cancel = cancelUrl || `${origin}/app?checkout=cancelled&orderId=${encodeURIComponent(orderId || "")}`;
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        success_url: success,
        cancel_url: cancel,
        customer_email: user?.email || undefined,
        line_items: [{
          quantity: 1,
          price_data: {
            currency,
            unit_amount: Math.round(amount * 100),
            product_data: { name: orderId ? `LocalHub Order ${orderId}` : "LocalHub Order" },
          },
        }],
        payment_intent_data: {
          receipt_email: user?.email || undefined,
          metadata: {
            orderId: orderId || "",
            customerId: payload.sub,
            customerName: user?.name || "",
          },
        },
        metadata: {
          orderId: orderId || "",
          customerId: payload.sub,
        },
      });
      return ok(res, { checkoutUrl: session.url, sessionId: session.id });
    }

    const intent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100),
      currency,
      metadata: {
        orderId: orderId || "",
        customerId: payload.sub,
        customerName: user?.name || "",
      },
      receipt_email: user?.email,
      automatic_payment_methods: { enabled: true },
    });

    return ok(res, {
      clientSecret: intent.client_secret,
      intentId: intent.id,
    });
  } catch (e) {
    return err(res, e.message, 500);
  }
}
