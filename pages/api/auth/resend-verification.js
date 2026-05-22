import { prisma } from "../../../lib/prisma";
import { requireAuth } from "../../../lib/auth";
import { sendVerificationEmail } from "../../../lib/email";
import { ok, err, methodNotAllowed } from "../../../lib/apiHelpers";
import crypto from "crypto";

async function createVerificationToken(userId, email) {
  const token = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await prisma.platformConfig.upsert({
    where: { key: `verify:${token}` },
    create: { key: `verify:${token}`, value: JSON.stringify({ userId, email, expires: expires.toISOString() }) },
    update: { value: JSON.stringify({ userId, email, expires: expires.toISOString() }) },
  });
  return token;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
  try {
    const payload = requireAuth(req);
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) return err(res, "User not found", 404);
    if (user.isEmailVerified) return err(res, "Email already verified", 400);
    const token = await createVerificationToken(user.id, user.email);
    await sendVerificationEmail(user, token);
    return ok(res, { message: "Verification email sent" });
  } catch (e) {
    return err(res, e.message, e.status || 400);
  }
}
