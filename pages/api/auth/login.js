import { prisma } from "../../../lib/prisma";
import {
  verifyPassword, signAccessToken, signRefreshToken,
  saveRefreshToken, setRefreshCookie, validateLoginInput,
} from "../../../lib/auth";
import { ok, err, methodNotAllowed } from "../../../lib/apiHelpers";

export default async function handler(req, res) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);

  const { email, password } = req.body;
  const { errors, valid } = validateLoginInput({ email, password });
  if (!valid) return err(res, "Validation failed", 422, errors);

  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase().trim() },
    include: {
      vendor: { select: { id: true, type: true, status: true, totalSales: true, commissionOwed: true } },
      driver: { select: { id: true, status: true, isOnline: true, rating: true, totalTrips: true, pricingBase: true, pricingPerUnit: true, pricingMin: true, pricingMaxDist: true } },
    },
  });

  const hashToCompare = user?.passwordHash || "$2a$12$invalidhashplaceholdertopreventtiming";
  const passwordMatch = await verifyPassword(password, hashToCompare);

  if (!user || !passwordMatch) return err(res, "Invalid email or password", 401);
  if (!user.isActive) return err(res, "Account suspended. Contact support.", 403);

  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user.id);
  await saveRefreshToken(user.id, refreshToken);
  setRefreshCookie(res, refreshToken);

  const { passwordHash: _, ...safeUser } = user;
  return ok(res, { user: safeUser, accessToken });
}
