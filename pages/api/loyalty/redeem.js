// ── pages/api/loyalty/redeem.js ──────────────────────────────────────
import { prisma } from "../../../lib/prisma";
import { requireAuth } from "../../../lib/auth";
import { ok, err, methodNotAllowed } from "../../../lib/apiHelpers";

const POINTS_TO_GBP = 100;
const POINTS_TO_BDT = 1000;

export default async function handler(req, res) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
  try {
    const payload = requireAuth(req);
    const { points } = req.body;
    if (!points || points < 500) return err(res, "Minimum redemption is 500 points", 422);
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) return err(res, "User not found", 404);
    if (user.loyaltyPoints < points) return err(res, "Insufficient points", 400);
    const creditValue = user.country === "uk"
      ? +(points / POINTS_TO_GBP).toFixed(2)
      : +(points / POINTS_TO_BDT).toFixed(2);
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: payload.sub }, data: { loyaltyPoints: { decrement: points }, loyaltyCredits: { increment: creditValue } } });
      await tx.pointsTransaction.create({ data: { userId: payload.sub, type: "redeem", points: -points, description: `Redeemed for ${user.country === "uk" ? "£" : "৳"}${creditValue} credit` } });
      await tx.notification.create({ data: { userId: payload.sub, type: "payment", icon: "💰", title: "Points Redeemed", body: `${points.toLocaleString()} pts → ${user.country === "uk" ? "£" : "৳"}${creditValue} added to your wallet`, priority: "normal" } });
    });
    return ok(res, { pointsRedeemed: points, creditAdded: creditValue });
  } catch (e) {
    return err(res, e.message, e.status || 400);
  }
}
