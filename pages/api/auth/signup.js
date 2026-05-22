import { prisma } from "../../../lib/prisma";
import {
  hashPassword, signAccessToken, signRefreshToken,
  saveRefreshToken, setRefreshCookie,
  generateReferralCode, validateSignupInput,
} from "../../../lib/auth";
import { ok, err, methodNotAllowed } from "../../../lib/apiHelpers";
import { sendVerificationEmail, sendWelcomeEmail } from "../../../lib/email";
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

  const { name, email, password, country, role, referralCode, jobCategoryIds = [], vendorType } = req.body;

  const { errors, valid } = validateSignupInput({ name, email, password, country, role });
  if (!valid) return err(res, "Validation failed", 422, errors);

  const exists = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  if (exists) return err(res, "An account with this email already exists", 409);

  let referredById = null;
  let referralBonus = 0;
  if (referralCode?.length === 8) {
    const referrer = await prisma.user.findUnique({ where: { referralCode: referralCode.toUpperCase() } });
    if (referrer) { referredById = referrer.id; referralBonus = 500; }
  }

  const passwordHash = await hashPassword(password);
  const myRefCode = generateReferralCode(name);

  const user = await prisma.$transaction(async (tx) => {
    const newUser = await tx.user.create({
      data: {
        email: email.toLowerCase().trim(),
        passwordHash,
        name: name.trim(),
        role,
        country,
        referralCode: myRefCode,
        referredById,
        loyaltyPoints: referralBonus,
        jobCategoryIds: jobCategoryIds.map(Number),
      },
    });

    if (role === "vendor") {
      await tx.vendor.create({
        data: { userId: newUser.id, name: name.trim(), country, type: vendorType || "ecommerce", status: "pending" },
      });
    }
    if (role === "driver") {
      await tx.driver.create({
        data: { userId: newUser.id, country, vehicle: "Electric Bike", status: "pending" },
      });
    }
    if (referralBonus > 0) {
      await tx.pointsTransaction.create({
        data: { userId: newUser.id, type: "bonus", points: referralBonus, description: "Referral joining bonus" },
      });
    }
    if (referredById) {
      await tx.notification.create({
        data: { userId: referredById, type: "referral", icon: "🔗", title: "Referral Signup!", body: `${name} joined using your code!`, priority: "normal" },
      });
    }
    await tx.notification.create({
      data: { userId: newUser.id, type: "system", icon: "🎉", title: `Welcome, ${name.split(" ")[0]}!`, body: "Explore local shops, restaurants, and jobs within 10 miles.", priority: "normal" },
    });
    return newUser;
  });

  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user.id);
  await saveRefreshToken(user.id, refreshToken);
  setRefreshCookie(res, refreshToken);

  // Send emails async — don't block the response
  Promise.allSettled([
    createVerificationToken(user.id, user.email).then(token => sendVerificationEmail(user, token)),
    sendWelcomeEmail(user),
  ]).catch(console.error);

  const { passwordHash: _, ...safeUser } = user;
  return ok(res, { user: safeUser, accessToken }, 201);
}
