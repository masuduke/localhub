// ══════════════════════════════════════════════════════════════════════
//  lib/prisma.js  — Prisma singleton (prevents connection pool exhaustion)
// ══════════════════════════════════════════════════════════════════════
// lib/prisma.js
import { PrismaClient } from "@prisma/client";

const globalForPrisma = global;
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error"] : ["error"],
  });
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;


// ══════════════════════════════════════════════════════════════════════
//  middleware.js  — Edge middleware for Next.js (protects routes)
// ══════════════════════════════════════════════════════════════════════
// middleware.js  (place in project root)
import { NextResponse } from "next/server";
import { verifyAccessToken } from "./lib/auth";

const PROTECTED = [
  "/api/orders",
  "/api/vendor",
  "/api/driver",
  "/api/admin",
  "/api/chat",
  "/api/loyalty",
  "/api/notifications",
];

const ADMIN_ONLY = ["/api/admin"];
const VENDOR_ONLY = ["/api/vendor"];
const DRIVER_ONLY = ["/api/driver"];

export function middleware(request) {
  const { pathname } = request.nextUrl;

  // Check if route needs protection
  const needsAuth = PROTECTED.some((p) => pathname.startsWith(p));
  if (!needsAuth) return NextResponse.next();

  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const payload = verifyAccessToken(token);

    // Role-based access
    if (ADMIN_ONLY.some((p) => pathname.startsWith(p)) && payload.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (VENDOR_ONLY.some((p) => pathname.startsWith(p)) && payload.role !== "vendor" && payload.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (DRIVER_ONLY.some((p) => pathname.startsWith(p)) && payload.role !== "driver" && payload.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Pass user info downstream via header
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-user-id",      payload.sub);
    requestHeaders.set("x-user-role",    payload.role);
    requestHeaders.set("x-user-country", payload.country);
    requestHeaders.set("x-user-email",   payload.email);

    return NextResponse.next({ request: { headers: requestHeaders } });
  } catch {
    return NextResponse.json({ error: "Token expired" }, { status: 401 });
  }
}

export const config = {
  matcher: ["/api/:path*"],
};


// ══════════════════════════════════════════════════════════════════════
//  lib/apiHelpers.js  — Shared API utilities
// ══════════════════════════════════════════════════════════════════════
// lib/apiHelpers.js

export function ok(res, data, status = 200) {
  return res.status(status).json({ success: true, data });
}

export function err(res, message, status = 400, details = null) {
  return res.status(status).json({ success: false, error: message, ...(details && { details }) });
}

export function methodNotAllowed(res, allowed = ["GET", "POST"]) {
  res.setHeader("Allow", allowed);
  return err(res, `Method not allowed`, 405);
}

export function paginate(query, { page = 1, limit = 20 } = {}) {
  const take = Math.min(Number(limit), 100);
  const skip = (Math.max(Number(page), 1) - 1) * take;
  return { ...query, take, skip };
}


// ══════════════════════════════════════════════════════════════════════
//  pages/api/auth/signup.js
// ══════════════════════════════════════════════════════════════════════
// pages/api/auth/signup.js

import { prisma }          from "../../../lib/prisma";
import {
  hashPassword, signAccessToken, signRefreshToken,
  saveRefreshToken, setRefreshCookie,
  generateReferralCode, validateSignupInput,
} from "../../../lib/auth";
import { ok, err, methodNotAllowed } from "../../../lib/apiHelpers";

export default async function handler(req, res) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);

  const { name, email, password, country, role, referralCode, jobCategoryIds = [] } = req.body;

  // Validate
  const { errors, valid } = validateSignupInput({ name, email, password, country, role });
  if (!valid) return err(res, "Validation failed", 422, errors);

  // Check duplicate email
  const exists = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  if (exists) return err(res, "An account with this email already exists", 409);

  // Resolve referrer
  let referredById = null;
  let referralBonus = 0;
  if (referralCode) {
    const referrer = await prisma.user.findUnique({ where: { referralCode: referralCode.toUpperCase() } });
    if (referrer && referrer.id) {
      referredById = referrer.id;
      referralBonus = country === "uk" ? 500 : 500; // 500 points joining bonus
    }
  }

  const passwordHash = await hashPassword(password);
  const myReferralCode = generateReferralCode(name);

  // Create user + vendor/driver profile in transaction
  const user = await prisma.$transaction(async (tx) => {
    const newUser = await tx.user.create({
      data: {
        email: email.toLowerCase().trim(),
        passwordHash,
        name:           name.trim(),
        role,
        country,
        referralCode:   myReferralCode,
        referredById,
        loyaltyPoints:  referralBonus,
        jobCategoryIds: jobCategoryIds.map(Number),
      },
    });

    // Create role-specific profile
    if (role === "vendor") {
      await tx.vendor.create({
        data: {
          userId:  newUser.id,
          name:    name.trim(),
          country,
          type:    req.body.vendorType || "ecommerce",
          status:  "pending",
        },
      });
    }
    if (role === "driver") {
      await tx.driver.create({
        data: {
          userId:  newUser.id,
          country,
          vehicle: "Electric Bike",
          status:  "pending",
        },
      });
    }

    // Record referral bonus points
    if (referralBonus > 0) {
      await tx.pointsTransaction.create({
        data: {
          userId:      newUser.id,
          type:        "bonus",
          points:      referralBonus,
          description: "Referral joining bonus",
        },
      });
    }

    // Reward referrer too (when new user places first order — flagged here for later)
    if (referredById) {
      await tx.notification.create({
        data: {
          userId:   referredById,
          type:     "referral",
          icon:     "🔗",
          title:    "Referral Signup!",
          body:     `${name} joined using your referral code. You'll earn credit on their first order.`,
          priority: "normal",
        },
      });
    }

    // Welcome notification
    await tx.notification.create({
      data: {
        userId:   newUser.id,
        type:     "system",
        icon:     "🎉",
        title:    `Welcome to LocalHub, ${name.split(" ")[0]}!`,
        body:     "Explore local shops, restaurants, and jobs within 10 miles of you.",
        priority: "normal",
      },
    });

    return newUser;
  });

  // Issue tokens
  const accessToken  = signAccessToken(user);
  const refreshToken = signRefreshToken(user.id);
  await saveRefreshToken(user.id, refreshToken);
  setRefreshCookie(res, refreshToken);

  // Return (never return passwordHash)
  const { passwordHash: _, ...safeUser } = user;
  return ok(res, { user: safeUser, accessToken }, 201);
}


// ══════════════════════════════════════════════════════════════════════
//  pages/api/auth/login.js
// ══════════════════════════════════════════════════════════════════════
// pages/api/auth/login.js

import { prisma }          from "../../../lib/prisma";
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
      driver: { select: { id: true, status: true, isOnline: true, pricingBase: true, pricingPerUnit: true, pricingMin: true, pricingMaxDist: true } },
    },
  });

  if (!user) return err(res, "Invalid email or password", 401);
  if (!user.isActive) return err(res, "Account suspended. Contact support.", 403);

  const valid2 = await verifyPassword(password, user.passwordHash);
  if (!valid2) return err(res, "Invalid email or password", 401);

  const accessToken  = signAccessToken(user);
  const refreshToken = signRefreshToken(user.id);
  await saveRefreshToken(user.id, refreshToken);
  setRefreshCookie(res, refreshToken);

  const { passwordHash: _, ...safeUser } = user;
  return ok(res, { user: safeUser, accessToken });
}


// ══════════════════════════════════════════════════════════════════════
//  pages/api/auth/refresh.js  — Refresh access token using cookie
// ══════════════════════════════════════════════════════════════════════
// pages/api/auth/refresh.js

import { rotateRefreshToken, setRefreshCookie } from "../../../lib/auth";
import { ok, err, methodNotAllowed } from "../../../lib/apiHelpers";

export default async function handler(req, res) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);

  const cookies = req.headers.cookie || "";
  const match   = cookies.match(/refreshToken=([^;]+)/);
  const token   = match?.[1];

  if (!token) return err(res, "No refresh token", 401);

  try {
    const { newAccessToken, newRefreshToken, user } = await rotateRefreshToken(token);
    setRefreshCookie(res, newRefreshToken);
    const { passwordHash: _, ...safeUser } = user;
    return ok(res, { user: safeUser, accessToken: newAccessToken });
  } catch (e) {
    return err(res, e.message, 401);
  }
}


// ══════════════════════════════════════════════════════════════════════
//  pages/api/auth/logout.js
// ══════════════════════════════════════════════════════════════════════
// pages/api/auth/logout.js

import { revokeAllTokens, clearRefreshCookie } from "../../../lib/auth";
import { requireAuth } from "../../../lib/auth";
import { ok, err, methodNotAllowed } from "../../../lib/apiHelpers";

export default async function handler(req, res) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
  try {
    const payload = requireAuth(req);
    await revokeAllTokens(payload.sub);
    clearRefreshCookie(res);
    return ok(res, { message: "Logged out" });
  } catch (e) {
    clearRefreshCookie(res);
    return ok(res, { message: "Logged out" });
  }
}


// ══════════════════════════════════════════════════════════════════════
//  pages/api/auth/me.js  — Get current user from token
// ══════════════════════════════════════════════════════════════════════
// pages/api/auth/me.js

import { prisma }     from "../../../lib/prisma";
import { requireAuth } from "../../../lib/auth";
import { ok, err, methodNotAllowed } from "../../../lib/apiHelpers";

export default async function handler(req, res) {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);
  try {
    const payload = requireAuth(req);
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        vendor: true,
        driver: { select: { id: true, status: true, isOnline: true, rating: true, totalTrips: true, pricingBase: true, pricingPerUnit: true, pricingMin: true, pricingMaxDist: true, totalEarnings: true, monthEarnings: true } },
        notifications: { where: { isRead: false }, orderBy: { createdAt: "desc" }, take: 20 },
      },
    });
    if (!user) return err(res, "User not found", 404);
    const { passwordHash: _, ...safeUser } = user;
    return ok(res, { user: safeUser });
  } catch (e) {
    return err(res, e.message, e.status || 401);
  }
}


// ══════════════════════════════════════════════════════════════════════
//  pages/api/products/index.js
// ══════════════════════════════════════════════════════════════════════
// pages/api/products/index.js

import { prisma }      from "../../../lib/prisma";
import { requireAuth } from "../../../lib/auth";
import { ok, err, methodNotAllowed, paginate } from "../../../lib/apiHelpers";

export default async function handler(req, res) {
  if (req.method === "GET") {
    const { country, category, page, limit, search } = req.query;
    const where = {
      isActive: true,
      ...(country && { country }),
      ...(category && { category }),
      ...(search && { name: { contains: search, mode: "insensitive" } }),
    };
    const [products, total] = await Promise.all([
      prisma.product.findMany({
        ...paginate({ where, orderBy: { totalSales: "desc" } }, { page, limit }),
        include: { vendor: { select: { name: true, status: true } }, reviews: { select: { rating: true, text: true, author: { select: { name: true } }, createdAt: true } } },
      }),
      prisma.product.count({ where }),
    ]);
    return ok(res, { products, total, page: Number(page || 1) });
  }

  if (req.method === "POST") {
    try {
      const payload = requireAuth(req);
      if (!["vendor", "admin"].includes(payload.role))
        return err(res, "Forbidden", 403);

      const vendor = await prisma.vendor.findUnique({ where: { userId: payload.sub } });
      if (!vendor) return err(res, "Vendor profile not found", 404);

      const { name, price, emoji, color, category, sizes, stock, description } = req.body;
      if (!name || !price || !category) return err(res, "name, price, category required", 422);

      const product = await prisma.product.create({
        data: {
          vendorId: vendor.id,
          country:  vendor.country,
          name, price: Number(price), emoji, color, category,
          sizes:    Array.isArray(sizes) ? sizes : [],
          stock:    Number(stock || 0),
          description,
        },
      });
      return ok(res, { product }, 201);
    } catch (e) {
      return err(res, e.message, e.status || 400);
    }
  }

  return methodNotAllowed(res, ["GET", "POST"]);
}


// ══════════════════════════════════════════════════════════════════════
//  pages/api/orders/index.js
// ══════════════════════════════════════════════════════════════════════
// pages/api/orders/index.js

import { prisma }      from "../../../lib/prisma";
import { requireAuth } from "../../../lib/auth";
import { ok, err, methodNotAllowed } from "../../../lib/apiHelpers";
import { nanoid }      from "nanoid";

const POINTS_PER_GBP = 10, POINTS_PER_BDT = 1;

function calcPoints(total, country) {
  return Math.floor(total * (country === "uk" ? POINTS_PER_GBP : POINTS_PER_BDT));
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    try {
      const payload = requireAuth(req);
      const { status, page, limit } = req.query;
      const where = {
        customerId: payload.sub,
        ...(status && { status }),
      };
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
      const { items, vendorId, driverId, subtotal, discount = 0, deliveryFee = 0, platformFee, total, payment, promoId, addressLine1, addressCity, addressPostcode, addressLat, addressLng, pickupAddress, pickupLat, pickupLng, distanceMiles } = req.body;

      if (!items?.length) return err(res, "Order must have items", 422);
      if (!payment)       return err(res, "Payment method required", 422);

      const orderId = "ORD-" + nanoid(6).toUpperCase();
      const country = payload.country;
      const pointsEarned = calcPoints(subtotal - discount, country);

      const order = await prisma.$transaction(async (tx) => {
        const newOrder = await tx.order.create({
          data: {
            id:           orderId,
            customerId:   payload.sub,
            vendorId:     vendorId || null,
            driverId:     driverId || null,
            country,
            status:       "pending",
            subtotal:     Number(subtotal),
            discount:     Number(discount),
            deliveryFee:  Number(deliveryFee),
            platformFee:  Number(platformFee || subtotal * 0.1),
            total:        Number(total),
            payment,
            promoId:      promoId || null,
            pointsEarned,
            addressLine1, addressCity, addressPostcode,
            addressLat:   Number(addressLat || 0),
            addressLng:   Number(addressLng || 0),
            pickupAddress, pickupLat: Number(pickupLat || 0),
            pickupLng:    Number(pickupLng || 0),
            distanceMiles: Number(distanceMiles || 0),
            items: {
              create: items.map((item) => ({
                name:      item.name,
                price:     Number(item.price),
                qty:       Number(item.qty || 1),
                emoji:     item.emoji || null,
                productId: item.productId || null,
                from:      item.from || null,
              })),
            },
          },
          include: { items: true },
        });

        // Earn loyalty points
        if (pointsEarned > 0) {
          await tx.user.update({
            where: { id: payload.sub },
            data:  { loyaltyPoints: { increment: pointsEarned } },
          });
          await tx.pointsTransaction.create({
            data: {
              userId:      payload.sub,
              type:        "earn",
              points:      pointsEarned,
              description: `Order ${orderId}`,
              orderId:     orderId,
            },
          });
        }

        // Order status history
        await tx.orderStatusHistory.create({
          data: { orderId, status: "pending" },
        });

        // Notify vendor
        if (vendorId) {
          const vendor = await tx.vendor.findUnique({ where: { id: vendorId }, select: { userId: true } });
          if (vendor) {
            await tx.notification.create({
              data: {
                userId:   vendor.userId,
                type:     "order",
                icon:     "📦",
                title:    "New Order Received",
                body:     `${orderId} · ${country === "uk" ? "£" : "৳"}${total}`,
                priority: "high",
              },
            });
          }
        }

        // Notify driver
        if (driverId) {
          const driver = await tx.driver.findUnique({ where: { id: driverId }, select: { userId: true } });
          if (driver) {
            await tx.notification.create({
              data: {
                userId:   driver.userId,
                type:     "order",
                icon:     "🛵",
                title:    "New Delivery Assigned",
                body:     `Order ${orderId} ready for pickup`,
                priority: "high",
              },
            });
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


// ══════════════════════════════════════════════════════════════════════
//  pages/api/orders/[id]/status.js  — Update order status
// ══════════════════════════════════════════════════════════════════════
// pages/api/orders/[id]/status.js

import { prisma }      from "../../../../lib/prisma";
import { requireAuth } from "../../../../lib/auth";
import { ok, err, methodNotAllowed } from "../../../../lib/apiHelpers";

const VALID_TRANSITIONS = {
  vendor: { pending: "accepted", accepted: "ready", ready: "dispatched" },
  driver: { dispatched: "delivered" },
  admin:  { pending: "accepted", accepted: "ready", ready: "dispatched", dispatched: "delivered", pending2: "rejected" },
};

export default async function handler(req, res) {
  if (req.method !== "PATCH") return methodNotAllowed(res, ["PATCH"]);
  try {
    const payload = requireAuth(req);
    const { id }  = req.query;
    const { status, note } = req.body;

    const order = await prisma.order.findUnique({ where: { id } });
    if (!order) return err(res, "Order not found", 404);

    // Permission check
    const allowed = VALID_TRANSITIONS[payload.role] || {};
    if (!allowed[order.status] && allowed[order.status] !== status && payload.role !== "admin") {
      return err(res, `Cannot transition from ${order.status} to ${status}`, 422);
    }

    const updated = await prisma.$transaction(async (tx) => {
      const upd = await tx.order.update({
        where: { id },
        data:  {
          status,
          ...(status === "delivered" && { deliveredAt: new Date() }),
        },
      });
      await tx.orderStatusHistory.create({ data: { orderId: id, status, note } });

      // Notify customer
      const msgs = {
        accepted:    { icon: "✅", title: "Order Accepted", body: `${id} has been accepted by the vendor` },
        ready:       { icon: "📦", title: "Order Ready",    body: `${id} is packed and ready for pickup` },
        dispatched:  { icon: "🛵", title: "On the Way!",    body: `${id} — your driver is heading to you` },
        delivered:   { icon: "🏠", title: "Delivered!",     body: `${id} has been delivered. Enjoy! ⭐ Rate your experience` },
        rejected:    { icon: "❌", title: "Order Rejected",  body: `${id} was rejected. No payment taken.` },
      };
      if (msgs[status]) {
        await tx.notification.create({
          data: { userId: order.customerId, type: "order", priority: status === "delivered" ? "high" : "normal", ...msgs[status] },
        });
      }
      return upd;
    });

    return ok(res, { order: updated });
  } catch (e) {
    return err(res, e.message, e.status || 400);
  }
}


// ══════════════════════════════════════════════════════════════════════
//  pages/api/drivers/available.js  — Get available drivers with quotes
// ══════════════════════════════════════════════════════════════════════
// pages/api/drivers/available.js

import { prisma }   from "../../../lib/prisma";
import { ok, err, methodNotAllowed } from "../../../lib/apiHelpers";

function haversine(lat1, lon1, lat2, lon2, unit = "miles") {
  const R = unit === "miles" ? 3958.8 : 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export default async function handler(req, res) {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);
  const { country, lat, lng, dist, parcel = "small" } = req.query;
  if (!country || !lat || !lng || !dist) return err(res, "country, lat, lng, dist required", 422);

  const distance = Number(dist);
  const parcelMult = { small: 1, medium: 1.3, large: 1.6 }[parcel] || 1;

  const drivers = await prisma.driver.findMany({
    where:   { country, isOnline: true, status: "active" },
    include: { user: { select: { name: true, avatar: true } }, reviews: { select: { rating: true } } },
  });

  const quoted = drivers
    .filter((d) => d.lastLat && d.lastLng && d.pricingMaxDist >= distance)
    .map((d) => {
      const driverDist = haversine(Number(lat), Number(lng), d.lastLat, d.lastLng, country === "uk" ? "miles" : "km");
      const quote = +(Math.max(d.pricingMin, d.pricingBase + distance * d.pricingPerUnit) * parcelMult).toFixed(2);
      const eta   = Math.round((distance / (country === "uk" ? 12 : 19)) * 60 + 4 + driverDist * 3);
      const avgRating = d.reviews.length ? d.reviews.reduce((s, r) => s + r.rating, 0) / d.reviews.length : d.rating;
      return {
        id:          d.id,
        name:        d.user.name,
        avatar:      d.user.avatar,
        vehicle:     d.vehicle,
        rating:      +avgRating.toFixed(1),
        reviewCount: d.reviews.length,
        totalTrips:  d.totalTrips,
        badge:       d.badge,
        quote,
        eta,
        distance,
        pricingBase:    d.pricingBase,
        pricingPerUnit: d.pricingPerUnit,
        pricingMin:     d.pricingMin,
      };
    })
    .sort((a, b) => a.quote - b.quote)
    .slice(0, 5);

  return ok(res, { drivers: quoted, distance, unit: country === "uk" ? "miles" : "km" });
}


// ══════════════════════════════════════════════════════════════════════
//  pages/api/loyalty/redeem.js  — Redeem loyalty points for credit
// ══════════════════════════════════════════════════════════════════════
// pages/api/loyalty/redeem.js

import { prisma }      from "../../../lib/prisma";
import { requireAuth } from "../../../lib/auth";
import { ok, err, methodNotAllowed } from "../../../lib/apiHelpers";

const POINTS_TO_GBP = 100;   // 100 pts = £1
const POINTS_TO_BDT = 1000;  // 1000 pts = ৳1

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
      await tx.user.update({
        where: { id: payload.sub },
        data:  {
          loyaltyPoints:  { decrement: points },
          loyaltyCredits: { increment: creditValue },
        },
      });
      await tx.pointsTransaction.create({
        data: {
          userId:      payload.sub,
          type:        "redeem",
          points:      -points,
          description: `Redeemed for ${user.country === "uk" ? "£" : "৳"}${creditValue} credit`,
        },
      });
      await tx.notification.create({
        data: {
          userId:   payload.sub,
          type:     "payment",
          icon:     "💰",
          title:    "Points Redeemed",
          body:     `${points.toLocaleString()} pts → ${user.country === "uk" ? "£" : "৳"}${creditValue} added to your wallet`,
          priority: "normal",
        },
      });
    });

    return ok(res, { pointsRedeemed: points, creditAdded: creditValue });
  } catch (e) {
    return err(res, e.message, e.status || 400);
  }
}


// ══════════════════════════════════════════════════════════════════════
//  pages/api/admin/rates.js  — Admin: get & update platform commission rates
// ══════════════════════════════════════════════════════════════════════
// pages/api/admin/rates.js

import { prisma }      from "../../../lib/prisma";
import { requireRole } from "../../../lib/auth";
import { ok, err, methodNotAllowed } from "../../../lib/apiHelpers";

export default async function handler(req, res) {
  try {
    requireRole(req, "admin");
  } catch (e) {
    return err(res, e.message, e.status || 401);
  }

  if (req.method === "GET") {
    const configs = await prisma.platformConfig.findMany();
    const rates = Object.fromEntries(configs.map((c) => [c.key, c.value]));
    return ok(res, { rates });
  }

  if (req.method === "PATCH") {
    const updates = req.body; // { ecommerce_rate_uk: "12", ... }
    await Promise.all(
      Object.entries(updates).map(([key, value]) =>
        prisma.platformConfig.upsert({
          where:  { key },
          create: { key, value: String(value) },
          update: { value: String(value) },
        })
      )
    );
    return ok(res, { message: "Rates updated" });
  }

  return methodNotAllowed(res, ["GET", "PATCH"]);
}


// ══════════════════════════════════════════════════════════════════════
//  pages/api/admin/stats.js  — Platform-wide statistics
// ══════════════════════════════════════════════════════════════════════
// pages/api/admin/stats.js

import { prisma }      from "../../../lib/prisma";
import { requireRole } from "../../../lib/auth";
import { ok, err, methodNotAllowed } from "../../../lib/apiHelpers";

export default async function handler(req, res) {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);
  try {
    requireRole(req, "admin");
    const [uk, bd] = await Promise.all(
      ["uk", "bd"].map(async (country) => {
        const [users, vendors, drivers, ordersData] = await Promise.all([
          prisma.user.count({ where: { country } }),
          prisma.vendor.count({ where: { country } }),
          prisma.driver.count({ where: { country } }),
          prisma.order.aggregate({
            where:   { country, status: { not: "rejected" } },
            _count:  { id: true },
            _sum:    { total: true, platformFee: true },
          }),
        ]);
        return {
          users, vendors, drivers,
          orders:     ordersData._count.id,
          revenue:    ordersData._sum.total || 0,
          commission: ordersData._sum.platformFee || 0,
        };
      })
    );
    return ok(res, { uk, bd });
  } catch (e) {
    return err(res, e.message, e.status || 400);
  }
}


// ══════════════════════════════════════════════════════════════════════
//  pages/api/promos/index.js  — Get & create promos
// ══════════════════════════════════════════════════════════════════════
// pages/api/promos/index.js

import { prisma }      from "../../../lib/prisma";
import { requireAuth, requireRole } from "../../../lib/auth";
import { ok, err, methodNotAllowed } from "../../../lib/apiHelpers";

export default async function handler(req, res) {
  if (req.method === "GET") {
    const { country } = req.query;
    const promos = await prisma.promo.findMany({
      where:   { country, status: "active", expiresAt: { gt: new Date() } },
      include: { vendor: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });
    return ok(res, { promos });
  }

  if (req.method === "POST") {
    try {
      const payload = requireAuth(req);
      if (!["vendor", "admin"].includes(payload.role)) return err(res, "Forbidden", 403);

      const vendor = await prisma.vendor.findUnique({ where: { userId: payload.sub } });
      if (!vendor && payload.role !== "admin") return err(res, "Vendor not found", 404);

      const { title, description, discount, type, minOrder, category, emoji, color, expiresInSeconds } = req.body;
      const expiresAt = new Date(Date.now() + Number(expiresInSeconds || 86400) * 1000);

      const promo = await prisma.promo.create({
        data: {
          vendorId: vendor?.id || req.body.vendorId,
          country:  vendor?.country || req.body.country,
          title, description,
          discount: Number(discount),
          type,
          minOrder: Number(minOrder),
          category, emoji, color,
          status: payload.role === "admin" ? "active" : "pending",
          expiresAt,
        },
      });
      return ok(res, { promo }, 201);
    } catch (e) {
      return err(res, e.message, e.status || 400);
    }
  }

  return methodNotAllowed(res, ["GET", "POST"]);
}


// ══════════════════════════════════════════════════════════════════════
//  pages/api/notifications/index.js
// ══════════════════════════════════════════════════════════════════════
// pages/api/notifications/index.js

import { prisma }      from "../../../lib/prisma";
import { requireAuth } from "../../../lib/auth";
import { ok, err, methodNotAllowed } from "../../../lib/apiHelpers";

export default async function handler(req, res) {
  if (req.method === "GET") {
    try {
      const payload = requireAuth(req);
      const notifs  = await prisma.notification.findMany({
        where:   { userId: payload.sub },
        orderBy: { createdAt: "desc" },
        take:    50,
      });
      const unread = notifs.filter((n) => !n.isRead).length;
      return ok(res, { notifications: notifs, unread });
    } catch (e) {
      return err(res, e.message, e.status || 401);
    }
  }

  if (req.method === "PATCH") {
    // Mark all as read
    try {
      const payload = requireAuth(req);
      await prisma.notification.updateMany({
        where: { userId: payload.sub, isRead: false },
        data:  { isRead: true },
      });
      return ok(res, { message: "All marked as read" });
    } catch (e) {
      return err(res, e.message, e.status || 401);
    }
  }

  return methodNotAllowed(res, ["GET", "PATCH"]);
}


// ══════════════════════════════════════════════════════════════════════
//  pages/api/jobs/index.js
// ══════════════════════════════════════════════════════════════════════
// pages/api/jobs/index.js

import { prisma }      from "../../../lib/prisma";
import { requireAuth } from "../../../lib/auth";
import { ok, err, methodNotAllowed, paginate } from "../../../lib/apiHelpers";

export default async function handler(req, res) {
  if (req.method === "GET") {
    const { country, categoryId, search, urgent, page, limit } = req.query;
    const where = {
      isActive:  true,
      expiresAt: { gt: new Date() },
      ...(country    && { country }),
      ...(categoryId && { categoryId: Number(categoryId) }),
      ...(urgent     && { isUrgent: urgent === "true" }),
      ...(search     && { OR: [{ title: { contains: search, mode: "insensitive" } }, { company: { contains: search, mode: "insensitive" } }] }),
    };
    const [jobs, total] = await Promise.all([
      prisma.job.findMany({
        ...paginate({ where, orderBy: { createdAt: "desc" } }, { page, limit }),
        include: { category: true, _count: { select: { applications: true } } },
      }),
      prisma.job.count({ where }),
    ]);
    return ok(res, { jobs, total });
  }

  if (req.method === "POST") {
    try {
      const payload = requireAuth(req);
      const { title, company, location, salary, categoryId, minExp, description, isUrgent, weeks, country } = req.body;
      if (!title || !company || !categoryId || !weeks) return err(res, "Required fields missing", 422);

      const weeklyRate = country === "uk" ? 4.99 : 299;
      const expiresAt  = new Date(Date.now() + Number(weeks) * 7 * 24 * 60 * 60 * 1000);

      const job = await prisma.job.create({
        data: {
          country, categoryId: Number(categoryId), title, company, location, salary,
          minExp: Number(minExp || 0), description, isUrgent: Boolean(isUrgent),
          postedById: payload.sub, weeklyRate, expiresAt,
        },
        include: { category: true },
      });
      return ok(res, { job }, 201);
    } catch (e) {
      return err(res, e.message, e.status || 400);
    }
  }

  return methodNotAllowed(res, ["GET", "POST"]);
}


// ══════════════════════════════════════════════════════════════════════
//  pages/api/jobs/[id]/apply.js
// ══════════════════════════════════════════════════════════════════════
// pages/api/jobs/[id]/apply.js

import { prisma }      from "../../../../lib/prisma";
import { requireAuth } from "../../../../lib/auth";
import { ok, err, methodNotAllowed } from "../../../../lib/apiHelpers";

export default async function handler(req, res) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
  try {
    const payload = requireAuth(req);
    const { id }  = req.query;
    const { name, email, coverLetter, cvUrl } = req.body;

    const job = await prisma.job.findUnique({ where: { id } });
    if (!job || !job.isActive) return err(res, "Job not found or closed", 404);

    const application = await prisma.jobApplication.upsert({
      where:  { jobId_applicantId: { jobId: id, applicantId: payload.sub } },
      create: { jobId: id, applicantId: payload.sub, name, email, coverLetter, cvUrl },
      update: { name, email, coverLetter, cvUrl },
    });

    return ok(res, { application }, 201);
  } catch (e) {
    return err(res, e.message, e.status || 400);
  }
}
