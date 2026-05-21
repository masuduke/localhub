import { prisma } from "../../../lib/prisma";
import { requireAuth } from "../../../lib/auth";
import { ok, err, methodNotAllowed } from "../../../lib/apiHelpers";

export default async function handler(req, res) {
  if (req.method !== "PATCH") return methodNotAllowed(res, ["PATCH"]);
  try {
    const payload = requireAuth(req);
    const { pricingBase, pricingPerUnit, pricingMin, pricingMaxDist } = req.body;
    const driver = await prisma.driver.update({
      where: { userId: payload.sub },
      data: {
        ...(pricingBase !== undefined && { pricingBase: Number(pricingBase) }),
        ...(pricingPerUnit !== undefined && { pricingPerUnit: Number(pricingPerUnit) }),
        ...(pricingMin !== undefined && { pricingMin: Number(pricingMin) }),
        ...(pricingMaxDist !== undefined && { pricingMaxDist: Number(pricingMaxDist) }),
      },
    });
    return ok(res, { driver });
  } catch (e) {
    return err(res, e.message, e.status || 400);
  }
}
