// ══════════════════════════════════════════════════════════════════════
//  lib/auth.js
//  LocalHub — Authentication Utilities
//
//  npm install bcryptjs jsonwebtoken
//
//  .env:
//    JWT_ACCESS_SECRET=your-64-char-random-secret
//    JWT_REFRESH_SECRET=your-other-64-char-random-secret
//    JWT_ACCESS_EXPIRES=15m
//    JWT_REFRESH_EXPIRES=7d
// ══════════════════════════════════════════════════════════════════════

import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "./prisma.js";

// ─── CONSTANTS ────────────────────────────────────────────────────────
const BCRYPT_ROUNDS = 12;
const ACCESS_EXPIRES  = process.env.JWT_ACCESS_EXPIRES  || "15m";
const REFRESH_EXPIRES = process.env.JWT_REFRESH_EXPIRES || "7d";
const REFRESH_EXPIRES_MS = 7 * 24 * 60 * 60 * 1000; // 7 days in ms

// ─── PASSWORD ─────────────────────────────────────────────────────────

/**
 * Hash a plain-text password.
 * bcrypt + 12 rounds ≈ 300ms — slow enough to resist brute-force.
 */
export async function hashPassword(plain) {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

/**
 * Compare a plain-text password against a bcrypt hash.
 * Constant-time comparison prevents timing attacks.
 */
export async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

// ─── JWT ──────────────────────────────────────────────────────────────

/**
 * Generate a short-lived access token (15 min).
 * Payload: { sub: userId, role, country, email }
 */
export function signAccessToken(user) {
  return jwt.sign(
    {
      sub:     user.id,
      email:   user.email,
      role:    user.role,
      country: user.country,
      name:    user.name,
    },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: ACCESS_EXPIRES }
  );
}

/**
 * Generate a long-lived refresh token (7 days).
 * Stored in DB — can be revoked.
 */
export function signRefreshToken(userId) {
  return jwt.sign(
    { sub: userId },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: REFRESH_EXPIRES }
  );
}

/**
 * Verify an access token.
 * Returns decoded payload or throws.
 */
export function verifyAccessToken(token) {
  return jwt.verify(token, process.env.JWT_ACCESS_SECRET);
}

/**
 * Verify a refresh token.
 */
export function verifyRefreshToken(token) {
  return jwt.verify(token, process.env.JWT_REFRESH_SECRET);
}

// ─── REFRESH TOKEN MANAGEMENT ─────────────────────────────────────────

/**
 * Persist a refresh token to DB.
 * Old tokens for this user remain valid until expiry (allows multi-device).
 */
export async function saveRefreshToken(userId, token) {
  return prisma.refreshToken.create({
    data: {
      token,
      userId,
      expiresAt: new Date(Date.now() + REFRESH_EXPIRES_MS),
    },
  });
}

/**
 * Rotate refresh token: revoke old, issue new.
 * Call this every time a refresh token is used.
 */
export async function rotateRefreshToken(oldToken) {
  const record = await prisma.refreshToken.findUnique({
    where: { token: oldToken },
    include: { user: true },
  });
  if (!record || record.isRevoked || record.expiresAt < new Date()) {
    throw new Error("Invalid or expired refresh token");
  }

  // Revoke old
  await prisma.refreshToken.update({
    where: { id: record.id },
    data: { isRevoked: true },
  });

  // Issue new
  const newRefreshToken = signRefreshToken(record.userId);
  const newAccessToken  = signAccessToken(record.user);
  await saveRefreshToken(record.userId, newRefreshToken);

  return { newAccessToken, newRefreshToken, user: record.user };
}

/**
 * Revoke all refresh tokens for a user (logout-all-devices).
 */
export async function revokeAllTokens(userId) {
  return prisma.refreshToken.updateMany({
    where: { userId, isRevoked: false },
    data:  { isRevoked: true },
  });
}

// ─── MIDDLEWARE HELPER ────────────────────────────────────────────────

/**
 * Extract and verify the Bearer token from the Authorization header.
 * Returns the decoded JWT payload or throws.
 *
 * Usage in API route:
 *   const user = await requireAuth(req);
 */
export function requireAuth(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    throw Object.assign(new Error("Unauthorized"), { status: 401 });
  }
  const token = authHeader.slice(7);
  try {
    return verifyAccessToken(token);
  } catch {
    throw Object.assign(new Error("Token expired or invalid"), { status: 401 });
  }
}

/**
 * requireAuth + role check.
 * Usage: const user = await requireRole(req, "admin");
 */
export function requireRole(req, ...roles) {
  const payload = requireAuth(req);
  if (!roles.includes(payload.role)) {
    throw Object.assign(new Error("Forbidden"), { status: 403 });
  }
  return payload;
}

// ─── COOKIE HELPERS ───────────────────────────────────────────────────

/**
 * Set the refresh token as an HttpOnly cookie.
 * HttpOnly prevents JS access → XSS-safe.
 * SameSite=Strict prevents CSRF.
 */
export function setRefreshCookie(res, token) {
  res.setHeader("Set-Cookie", [
    `refreshToken=${token}; HttpOnly; Secure; SameSite=Strict; Path=/api/auth/refresh; Max-Age=${REFRESH_EXPIRES_MS / 1000}`,
  ]);
}

/**
 * Clear the refresh token cookie (on logout).
 */
export function clearRefreshCookie(res) {
  res.setHeader("Set-Cookie", [
    "refreshToken=; HttpOnly; Secure; SameSite=Strict; Path=/api/auth/refresh; Max-Age=0",
  ]);
}

// ─── REFERRAL CODE ────────────────────────────────────────────────────

/**
 * Generate a unique referral code from a name.
 * Format: XXXX1234 (4 letters + 4 digits)
 */
export function generateReferralCode(name) {
  const prefix = name
    .replace(/[^a-zA-Z]/g, "")
    .slice(0, 4)
    .toUpperCase()
    .padEnd(4, "X");
  const suffix = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}${suffix}`;
}

// ─── VALIDATION ───────────────────────────────────────────────────────

export function validateSignupInput({ name, email, password, country, role }) {
  const errors = {};
  if (!name?.trim() || name.trim().length < 2)
    errors.name = "Name must be at least 2 characters";
  if (!email?.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/))
    errors.email = "Invalid email address";
  if (!password || password.length < 8)
    errors.password = "Password must be at least 8 characters";
  if (!["uk", "bd"].includes(country))
    errors.country = "Country must be uk or bd";
  if (!["customer", "vendor", "driver", "job_seeker"].includes(role))
    errors.role = "Invalid role";
  return { errors, valid: Object.keys(errors).length === 0 };
}

export function validateLoginInput({ email, password }) {
  const errors = {};
  if (!email?.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/))
    errors.email = "Invalid email address";
  if (!password)
    errors.password = "Password is required";
  return { errors, valid: Object.keys(errors).length === 0 };
}
