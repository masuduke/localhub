// ══════════════════════════════════════════════════════════════════════
//  FILE 1: pages/api/webhooks/stripe.js
//  Stripe webhook — marks orders paid, credits loyalty points,
//  notifies vendor, triggers fulfillment flow
//
//  Setup:
//    npm install stripe
//    stripe listen --forward-to localhost:3000/api/webhooks/stripe
//
//  .env:
//    STRIPE_SECRET_KEY=sk_live_...
//    STRIPE_WEBHOOK_SECRET=whsec_...
//    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...
// ══════════════════════════════════════════════════════════════════════

import Stripe from "stripe";
import { prisma } from "../../../lib/prisma";
import { sendOrderConfirmationEmail } from "../../../lib/email";
import { emitOrderStatus, emitNotification } from "../../../server/socket";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-04-10" });

// Disable Next.js body parsing — Stripe needs the raw body to verify signature
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
    console.error("Stripe webhook signature verification failed:", err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  // ── Handle events ────────────────────────────────────────────────
  try {
    switch (event.type) {

      // ── Payment succeeded ────────────────────────────────────────
      case "payment_intent.succeeded": {
        const intent = event.data.object;
        const orderId = intent.metadata?.orderId;
        if (!orderId) break;

        const order = await prisma.order.update({
          where: { id: orderId },
          data: {
            isPaid: true,
            paymentRef: intent.id,
            status: "accepted",
          },
          include: {
            customer: true,
            vendor: { include: { user: true } },
            items: true,
          },
        });

        // Status history
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
            data: {
              userId: order.customerId,
              type: "earn",
              points: order.pointsEarned,
              description: `Order ${orderId} — Stripe payment`,
              orderId,
            },
          });
        }

        // Notify customer
        const customerNotif = await prisma.notification.create({
          data: {
            userId: order.customerId,
            type: "payment",
            icon: "✅",
            title: "Payment Confirmed",
            body: `Order ${orderId} paid · ${order.pointsEarned} pts earned`,
            priority: "high",
          },
        });
        emitNotification(order.customerId, customerNotif);
        emitOrderStatus(orderId, "accepted");

        // Notify vendor
        if (order.vendor?.user) {
          const vendorNotif = await prisma.notification.create({
            data: {
              userId: order.vendor.user.id,
              type: "order",
              icon: "📦",
              title: "New Paid Order",
              body: `${orderId} · £${order.total} — ready to fulfil`,
              priority: "high",
            },
          });
          emitNotification(order.vendor.user.id, vendorNotif);
        }

        // Send confirmation email
        await sendOrderConfirmationEmail(order.customer, order).catch(console.error);

        // Update vendor commission
        if (order.vendorId) {
          await prisma.vendor.update({
            where: { id: order.vendorId },
            data: {
              totalSales: { increment: order.subtotal },
              commissionOwed: { increment: order.platformFee },
            },
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

      // ── Payment failed ───────────────────────────────────────────
      case "payment_intent.payment_failed": {
        const intent = event.data.object;
        const orderId = intent.metadata?.orderId;
        if (!orderId) break;

        await prisma.order.update({
          where: { id: orderId },
          data: { status: "rejected" },
        });
        await prisma.orderStatusHistory.create({
          data: { orderId, status: "rejected", note: `Payment failed: ${intent.last_payment_error?.message}` },
        });

        const order = await prisma.order.findUnique({ where: { id: orderId } });
        if (order) {
          const notif = await prisma.notification.create({
            data: {
              userId: order.customerId,
              type: "payment",
              icon: "❌",
              title: "Payment Failed",
              body: `Order ${orderId} could not be processed. Please try again.`,
              priority: "high",
            },
          });
          emitNotification(order.customerId, notif);
          emitOrderStatus(orderId, "rejected");
        }
        break;
      }

      // ── Charge refunded ──────────────────────────────────────────
      case "charge.refunded": {
        const charge = event.data.object;
        const orderId = charge.metadata?.orderId;
        if (!orderId) break;
        await prisma.order.update({
          where: { id: orderId },
          data: { status: "refunded" },
        });
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

// ── Helper: create a PaymentIntent (called from /api/orders) ─────────
// Call this BEFORE creating the order, pass clientSecret to frontend
export async function createStripePaymentIntent({ amount, currency = "gbp", orderId, customerEmail, customerId }) {
  const intent = await stripe.paymentIntents.create({
    amount: Math.round(amount * 100), // Stripe works in pence/cents
    currency,
    metadata: { orderId, customerId },
    receipt_email: customerEmail,
    automatic_payment_methods: { enabled: true },
  });
  return { clientSecret: intent.client_secret, intentId: intent.id };
}


// ══════════════════════════════════════════════════════════════════════
//  FILE 2: lib/bkash.js
//  bKash Tokenized Payment — 3-step flow:
//    Step 1: grantToken   → get app access token (cached 1hr)
//    Step 2: createPayment → get bKashURL, redirect user
//    Step 3: executePayment → called on callback, confirms payment
//
//  npm install axios
//
//  .env:
//    BKASH_APP_KEY=...
//    BKASH_APP_SECRET=...
//    BKASH_USERNAME=...
//    BKASH_PASSWORD=...
//    BKASH_BASE_URL=https://tokenized.sandbox.bka.sh/v1.2.0-beta
//    NEXT_PUBLIC_APP_URL=http://localhost:3000
// ══════════════════════════════════════════════════════════════════════

// lib/bkash.js
import axios from "axios";

const BASE = process.env.BKASH_BASE_URL;
const HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json",
  username: process.env.BKASH_USERNAME,
  password: process.env.BKASH_PASSWORD,
};

// ── Token cache (avoid redundant grant calls) ─────────────────────────
let _token = null;
let _tokenExpiry = 0;

async function grantToken() {
  if (_token && Date.now() < _tokenExpiry) return _token;
  const { data } = await axios.post(
    `${BASE}/tokenized/checkout/token/grant`,
    { app_key: process.env.BKASH_APP_KEY, app_secret: process.env.BKASH_APP_SECRET },
    { headers: HEADERS }
  );
  if (data.statusCode !== "0000") throw new Error(`bKash grant failed: ${data.statusMessage}`);
  _token = data.id_token;
  _tokenExpiry = Date.now() + (data.expires_in - 60) * 1000; // refresh 1 min early
  return _token;
}

function authHeaders(token) {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    authorization: token,
    "x-app-key": process.env.BKASH_APP_KEY,
  };
}

// ── Step 2: Create Payment ────────────────────────────────────────────
// Returns: { bkashURL, paymentID } — redirect user to bkashURL
export async function createBkashPayment({ amount, orderId, intent = "sale" }) {
  const token = await grantToken();
  const { data } = await axios.post(
    `${BASE}/tokenized/checkout/create`,
    {
      mode: "0011", // Tokenized checkout
      payerReference: orderId,
      callbackURL: `${process.env.NEXT_PUBLIC_APP_URL}/api/payments/bkash/callback`,
      amount: String(amount),
      currency: "BDT",
      intent,
      merchantInvoiceNumber: orderId,
    },
    { headers: authHeaders(token) }
  );
  if (data.statusCode !== "0000") throw new Error(`bKash create failed: ${data.statusMessage}`);
  return { bkashURL: data.bkashURL, paymentID: data.paymentID };
}

// ── Step 3: Execute Payment (called from callback route) ──────────────
export async function executeBkashPayment(paymentID) {
  const token = await grantToken();
  const { data } = await axios.post(
    `${BASE}/tokenized/checkout/execute`,
    { paymentID },
    { headers: authHeaders(token) }
  );
  if (data.statusCode !== "0000") throw new Error(`bKash execute failed: ${data.statusMessage}`);
  return data; // { trxID, amount, merchantInvoiceNumber, ... }
}

// ── Query payment status ──────────────────────────────────────────────
export async function queryBkashPayment(paymentID) {
  const token = await grantToken();
  const { data } = await axios.post(
    `${BASE}/tokenized/checkout/payment/status`,
    { paymentID },
    { headers: authHeaders(token) }
  );
  return data;
}

// ── Refund ────────────────────────────────────────────────────────────
export async function refundBkashPayment({ paymentID, amount, trxID, sku, reason }) {
  const token = await grantToken();
  const { data } = await axios.post(
    `${BASE}/tokenized/checkout/payment/refund`,
    { paymentID, amount: String(amount), trxID, sku, reason },
    { headers: authHeaders(token) }
  );
  return data;
}


// pages/api/payments/bkash/initiate.js
// ── Call this to start a bKash payment, returns redirect URL ─────────

import { prisma }        from "../../../../lib/prisma";
import { requireAuth }   from "../../../../lib/auth";
import { createBkashPayment } from "../../../../lib/bkash";
import { ok, err, methodNotAllowed } from "../../../../lib/apiHelpers";

export default async function handler(req, res) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
  try {
    const payload = requireAuth(req);
    const { orderId } = req.body;
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.customerId !== payload.sub) return err(res, "Order not found", 404);
    if (order.isPaid) return err(res, "Order already paid", 400);

    const { bkashURL, paymentID } = await createBkashPayment({
      amount: order.total,
      orderId,
    });

    // Store paymentID temporarily
    await prisma.order.update({
      where: { id: orderId },
      data: { paymentRef: paymentID },
    });

    return ok(res, { bkashURL, paymentID });
  } catch (e) {
    return err(res, e.message, 500);
  }
}


// pages/api/payments/bkash/callback.js
// ── bKash redirects here after user pays ─────────────────────────────

import { prisma }           from "../../../../lib/prisma";
import { executeBkashPayment } from "../../../../lib/bkash";
import { emitOrderStatus, emitNotification } from "../../../../server/socket";
import { sendOrderConfirmationEmail } from "../../../../lib/email";

export default async function handler(req, res) {
  const { paymentID, status } = req.query;

  if (status === "cancel" || status === "failure") {
    return res.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/app?payment=failed`);
  }

  try {
    const result = await executeBkashPayment(paymentID);
    const orderId = result.merchantInvoiceNumber;

    const order = await prisma.order.update({
      where: { id: orderId },
      data: {
        isPaid: true,
        paymentRef: result.trxID,
        status: "accepted",
      },
      include: { customer: true, vendor: { include: { user: true } }, items: true },
    });

    await prisma.orderStatusHistory.create({
      data: { orderId, status: "accepted", note: `bKash TrxID: ${result.trxID}` },
    });

    // Loyalty points
    if (order.pointsEarned > 0) {
      await prisma.user.update({ where: { id: order.customerId }, data: { loyaltyPoints: { increment: order.pointsEarned } } });
      await prisma.pointsTransaction.create({ data: { userId: order.customerId, type: "earn", points: order.pointsEarned, description: `Order ${orderId} — bKash`, orderId } });
    }

    // Notifications
    const notif = await prisma.notification.create({ data: { userId: order.customerId, type: "payment", icon: "📱", title: "bKash Payment Confirmed", body: `Order ${orderId} · ৳${order.total} · TrxID: ${result.trxID}`, priority: "high" } });
    emitNotification(order.customerId, notif);
    emitOrderStatus(orderId, "accepted");
    await sendOrderConfirmationEmail(order.customer, order).catch(console.error);

    // Update vendor commission
    if (order.vendorId) {
      await prisma.vendor.update({ where: { id: order.vendorId }, data: { totalSales: { increment: order.subtotal }, commissionOwed: { increment: order.platformFee } } });
    }

    return res.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/app?payment=success&order=${orderId}`);
  } catch (e) {
    console.error("bKash callback error:", e);
    return res.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/app?payment=error&msg=${encodeURIComponent(e.message)}`);
  }
}


// ══════════════════════════════════════════════════════════════════════
//  FILE 3: lib/storage.js
//  Cloudflare R2 file uploads via presigned URLs
//  R2 is S3-compatible — uses @aws-sdk/client-s3
//
//  npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
//
//  .env:
//    R2_ACCOUNT_ID=abc123
//    R2_ACCESS_KEY_ID=your-key
//    R2_SECRET_ACCESS_KEY=your-secret
//    R2_BUCKET=localhub-uploads
//    NEXT_PUBLIC_CDN_URL=https://cdn.localhub.app
//
//  Cloudflare R2: free 10GB storage, 1M writes/month, 10M reads/month
// ══════════════════════════════════════════════════════════════════════

// lib/storage.js
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import crypto from "crypto";
import path from "path";

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId:     process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.R2_BUCKET;
const CDN    = process.env.NEXT_PUBLIC_CDN_URL;

// ── Allowed types ─────────────────────────────────────────────────────
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const ALLOWED_DOC_TYPES   = ["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;  // 5 MB
const MAX_DOC_SIZE   = 10 * 1024 * 1024; // 10 MB

function sanitizeFilename(original) {
  const ext = path.extname(original).toLowerCase();
  const hash = crypto.randomBytes(16).toString("hex");
  return `${hash}${ext}`;
}

function buildKey(folder, filename) {
  return `${folder}/${filename}`;
}

// ── Generate presigned upload URL ─────────────────────────────────────
// Frontend calls this, gets a URL, PUTs the file directly to R2.
// Never goes through your server — saves bandwidth.
export async function getUploadPresignedUrl({ folder, filename, contentType, contentLength }) {
  const isImage = ALLOWED_IMAGE_TYPES.includes(contentType);
  const isDoc   = ALLOWED_DOC_TYPES.includes(contentType);

  if (!isImage && !isDoc) throw new Error(`File type ${contentType} not allowed`);
  if (isImage && contentLength > MAX_IMAGE_SIZE) throw new Error("Image must be under 5MB");
  if (isDoc   && contentLength > MAX_DOC_SIZE)   throw new Error("Document must be under 10MB");

  const safeFilename = sanitizeFilename(filename);
  const key = buildKey(folder, safeFilename);

  const command = new PutObjectCommand({
    Bucket:        BUCKET,
    Key:           key,
    ContentType:   contentType,
    ContentLength: contentLength,
    // ACL: "public-read", // only if bucket is public; use CDN instead
  });

  const uploadUrl = await getSignedUrl(r2, command, { expiresIn: 300 }); // 5 min
  const publicUrl = `${CDN}/${key}`;

  return { uploadUrl, publicUrl, key };
}

// ── Generate presigned download URL (for private files) ───────────────
export async function getDownloadPresignedUrl(key, expiresIn = 3600) {
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  return getSignedUrl(r2, command, { expiresIn });
}

// ── Delete a file ─────────────────────────────────────────────────────
export async function deleteFile(key) {
  await r2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

// ── Folder conventions ────────────────────────────────────────────────
export const FOLDERS = {
  productImages:  "products",
  profileAvatars: "avatars",
  cvDocuments:    "cvs",
  promoImages:    "promos",
  restaurantImages: "restaurants",
};


// pages/api/upload/presign.js
// ── Returns a presigned URL for direct-to-R2 upload ──────────────────

import { requireAuth }         from "../../../lib/auth";
import { getUploadPresignedUrl, FOLDERS } from "../../../lib/storage";
import { ok, err, methodNotAllowed } from "../../../lib/apiHelpers";

export default async function handler(req, res) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
  try {
    const payload = requireAuth(req);
    const { filename, contentType, contentLength, uploadType } = req.body;

    if (!filename || !contentType || !contentLength || !uploadType)
      return err(res, "filename, contentType, contentLength, uploadType required", 422);

    const folder = FOLDERS[uploadType];
    if (!folder) return err(res, `Unknown uploadType: ${uploadType}`, 422);

    // CV uploads — anyone can upload their own CV
    // Product images — vendors only
    if (uploadType === "productImages" && !["vendor", "admin"].includes(payload.role))
      return err(res, "Forbidden", 403);

    const result = await getUploadPresignedUrl({ folder, filename, contentType, contentLength: Number(contentLength) });
    return ok(res, result);
  } catch (e) {
    return err(res, e.message, e.status || 400);
  }
}

// ── Frontend upload helper (call from React) ──────────────────────────
// lib/uploadFile.js
export async function uploadFile(file, uploadType) {
  // 1. Get presigned URL from your API
  const { uploadUrl, publicUrl } = await fetch("/api/upload/presign", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getAccessToken()}` },
    body: JSON.stringify({
      filename:      file.name,
      contentType:   file.type,
      contentLength: file.size,
      uploadType,
    }),
  }).then(r => r.json()).then(j => j.data);

  // 2. PUT directly to R2 (no server in the middle)
  await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type, "Content-Length": file.size },
    body: file,
  });

  return publicUrl; // CDN URL to store in DB
}


// ══════════════════════════════════════════════════════════════════════
//  FILE 4: lib/email.js
//  Free email verification using Resend (free tier: 3,000 emails/month)
//  Zero-dependency — just fetch() to their REST API.
//  No SMTP config. No SendGrid account needed.
//
//  1. Sign up free at resend.com
//  2. Add your domain (or use @resend.dev in dev mode)
//  3. Get API key
//
//  .env:
//    RESEND_API_KEY=re_...
//    EMAIL_FROM=LocalHub <noreply@localhub.app>
//    NEXT_PUBLIC_APP_URL=http://localhost:3000
//
//  For dev/testing: use @resend.dev email — no domain needed at all.
//  Resend free tier: 3,000 emails/month, 100/day. More than enough to launch.
// ══════════════════════════════════════════════════════════════════════

// lib/email.js
import crypto from "crypto";
import { prisma } from "./prisma";

const RESEND_API = "https://api.resend.com/emails";
const FROM       = process.env.EMAIL_FROM || "LocalHub <noreply@localhub.app>";
const APP_URL    = process.env.NEXT_PUBLIC_APP_URL;

// ── Core send function ────────────────────────────────────────────────
async function send({ to, subject, html, text }) {
  const res = await fetch(RESEND_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: FROM, to: Array.isArray(to) ? to : [to], subject, html, text }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Resend error: ${data.message || res.statusText}`);
  return data;
}

// ── Generate & store verification token ──────────────────────────────
async function createVerificationToken(userId, email) {
  const token = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

  // Store in PlatformConfig (lightweight — no extra table needed)
  // Key: verify:TOKEN → value: JSON{ userId, email, expires }
  await prisma.platformConfig.upsert({
    where: { key: `verify:${token}` },
    create: { key: `verify:${token}`, value: JSON.stringify({ userId, email, expires: expires.toISOString() }) },
    update: { value: JSON.stringify({ userId, email, expires: expires.toISOString() }) },
  });
  return token;
}

// ── Email templates ───────────────────────────────────────────────────
function verificationTemplate(name, url) {
  return `
<!DOCTYPE html>
<html><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width"/></head>
<body style="margin:0;padding:0;background:#0a0a0f;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0f;padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#14141e;border:1px solid rgba(255,255,255,.07);border-radius:20px;overflow:hidden;max-width:560px;width:100%;">
        <!-- Header -->
        <tr><td style="background:linear-gradient(135deg,#0ecfbe22,#7b61ff11);padding:36px 40px;border-bottom:1px solid rgba(255,255,255,.07);">
          <span style="font-family:Georgia,serif;font-size:24px;font-weight:800;color:#f8f7f4;letter-spacing:-0.5px;">
            <span style="color:#0ecfbe">LOCAL</span><span style="color:#f5b942">HUB</span>
          </span>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:40px;">
          <h1 style="color:#f8f7f4;font-family:Georgia,serif;font-size:28px;font-weight:800;letter-spacing:-1px;margin:0 0 12px">Verify your email, ${name.split(" ")[0]} 👋</h1>
          <p style="color:rgba(255,255,255,.55);font-size:15px;line-height:1.7;margin:0 0 32px">Click the button below to verify your email address and activate your LocalHub account. This link expires in 24 hours.</p>
          <a href="${url}" style="display:inline-block;background:#0ecfbe;color:#0a0a0f;font-size:15px;font-weight:700;text-decoration:none;border-radius:50px;padding:16px 40px;letter-spacing:.02em;">Verify Email Address →</a>
          <p style="color:rgba(255,255,255,.28);font-size:12px;margin:32px 0 0;line-height:1.6;">If you didn't create a LocalHub account, you can safely ignore this email. The link expires in 24 hours.</p>
          <p style="color:rgba(255,255,255,.2);font-size:11px;margin:12px 0 0;word-break:break-all;">Or copy: ${url}</p>
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding:20px 40px;border-top:1px solid rgba(255,255,255,.07);">
          <p style="color:rgba(255,255,255,.2);font-size:11px;margin:0;font-family:monospace">© 2025 LocalHub · Serving UK 🇬🇧 & Bangladesh 🇧🇩 · Electric delivery only ⚡</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function orderConfirmTemplate(user, order) {
  const cur = order.country === "uk" ? "£" : "৳";
  const itemsHtml = order.items.map(i => `
    <tr>
      <td style="padding:10px 0;color:rgba(255,255,255,.7);font-size:14px;border-bottom:1px solid rgba(255,255,255,.05)">${i.emoji || "📦"} ${i.name} ×${i.qty || 1}</td>
      <td style="padding:10px 0;color:#f8f7f4;font-size:14px;font-weight:600;text-align:right;border-bottom:1px solid rgba(255,255,255,.05)">${cur}${i.price}</td>
    </tr>`).join("");
  return `
<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#0a0a0f;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0f;padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#14141e;border:1px solid rgba(255,255,255,.07);border-radius:20px;overflow:hidden;max-width:560px;width:100%;">
        <tr><td style="padding:36px 40px;border-bottom:1px solid rgba(255,255,255,.07);">
          <span style="font-family:Georgia,serif;font-size:24px;font-weight:800;">
            <span style="color:#0ecfbe">LOCAL</span><span style="color:#f5b942">HUB</span>
          </span>
        </td></tr>
        <tr><td style="padding:40px;">
          <h1 style="color:#0ecfbe;font-family:Georgia,serif;font-size:26px;font-weight:800;letter-spacing:-1px;margin:0 0 6px">Order Confirmed! 🎉</h1>
          <p style="color:rgba(255,255,255,.4);font-family:monospace;font-size:12px;margin:0 0 28px">${order.id}</p>
          <table width="100%" cellpadding="0" cellspacing="0">${itemsHtml}</table>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;background:rgba(255,255,255,.03);border-radius:12px;padding:16px;">
            <tr><td style="color:rgba(255,255,255,.4);font-size:13px">Subtotal</td><td style="text-align:right;color:#f8f7f4;font-size:13px">${cur}${order.subtotal}</td></tr>
            <tr><td style="color:rgba(255,255,255,.4);font-size:13px;padding-top:8px">Delivery</td><td style="text-align:right;color:#f8f7f4;font-size:13px;padding-top:8px">${cur}${order.deliveryFee}</td></tr>
            <tr><td style="color:#f8f7f4;font-size:16px;font-weight:700;padding-top:12px;border-top:1px solid rgba(255,255,255,.07)">Total</td><td style="text-align:right;color:#0ecfbe;font-size:16px;font-weight:700;padding-top:12px;border-top:1px solid rgba(255,255,255,.07)">${cur}${order.total}</td></tr>
          </table>
          <p style="color:rgba(255,255,255,.55);font-size:14px;margin:24px 0 0;line-height:1.6">You earned <strong style="color:#f5b942">⭐ ${order.pointsEarned} loyalty points</strong> for this order.</p>
        </td></tr>
        <tr><td style="padding:20px 40px;border-top:1px solid rgba(255,255,255,.07);"><p style="color:rgba(255,255,255,.2);font-size:11px;margin:0;font-family:monospace">© 2025 LocalHub</p></td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function welcomeTemplate(user) {
  return `
<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#0a0a0f;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0f;padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#14141e;border:1px solid rgba(255,255,255,.07);border-radius:20px;overflow:hidden;max-width:560px;width:100%;">
        <tr><td style="padding:36px 40px;border-bottom:1px solid rgba(255,255,255,.07);">
          <span style="font-family:Georgia,serif;font-size:24px;font-weight:800;"><span style="color:#0ecfbe">LOCAL</span><span style="color:#f5b942">HUB</span></span>
        </td></tr>
        <tr><td style="padding:40px;">
          <h1 style="color:#f8f7f4;font-family:Georgia,serif;font-size:28px;font-weight:800;letter-spacing:-1px;margin:0 0 12px">Welcome to LocalHub, ${user.name.split(" ")[0]}! 🎉</h1>
          <p style="color:rgba(255,255,255,.55);font-size:15px;line-height:1.7;margin:0 0 24px">Your account is now active. Explore local shops, restaurants, and jobs within 10 miles of you.</p>
          <a href="${APP_URL}/app" style="display:inline-block;background:#0ecfbe;color:#0a0a0f;font-size:15px;font-weight:700;text-decoration:none;border-radius:50px;padding:16px 40px;">Open LocalHub →</a>
        </td></tr>
        <tr><td style="padding:20px 40px;border-top:1px solid rgba(255,255,255,.07);"><p style="color:rgba(255,255,255,.2);font-size:11px;margin:0;font-family:monospace">© 2025 LocalHub</p></td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

// ── Public email functions ─────────────────────────────────────────────
export async function sendVerificationEmail(user) {
  const token = await createVerificationToken(user.id, user.email);
  const url   = `${APP_URL}/api/auth/verify-email?token=${token}`;
  return send({
    to: user.email,
    subject: "Verify your LocalHub email address",
    html: verificationTemplate(user.name, url),
    text: `Hi ${user.name}, verify your email: ${url}`,
  });
}

export async function sendOrderConfirmationEmail(user, order) {
  return send({
    to: user.email,
    subject: `Order Confirmed — ${order.id}`,
    html: orderConfirmTemplate(user, order),
    text: `Order ${order.id} confirmed. Total: ${order.country === "uk" ? "£" : "৳"}${order.total}`,
  });
}

export async function sendWelcomeEmail(user) {
  return send({
    to: user.email,
    subject: "Welcome to LocalHub 🎉",
    html: welcomeTemplate(user),
    text: `Welcome, ${user.name}! Your LocalHub account is ready.`,
  });
}

export async function sendPasswordResetEmail(user, resetToken) {
  const url = `${APP_URL}/reset-password?token=${resetToken}`;
  return send({
    to: user.email,
    subject: "Reset your LocalHub password",
    html: `<p>Reset your password: <a href="${url}">${url}</a> (expires in 1 hour)</p>`,
    text: `Reset your password: ${url}`,
  });
}

export async function sendJobApplicationEmail(employerEmail, job, applicantName) {
  return send({
    to: employerEmail,
    subject: `New Application: ${job.title}`,
    html: `<p><strong>${applicantName}</strong> applied for <strong>${job.title}</strong>. Log in to LocalHub to review.</p>`,
    text: `${applicantName} applied for ${job.title}.`,
  });
}


// pages/api/auth/verify-email.js
// ── User clicks link → email verified ────────────────────────────────

import { prisma }   from "../../../lib/prisma";

export default async function handler(req, res) {
  const { token } = req.query;
  if (!token) return res.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/app?verify=invalid`);

  const record = await prisma.platformConfig.findUnique({ where: { key: `verify:${token}` } });
  if (!record) return res.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/app?verify=invalid`);

  const { userId, expires } = JSON.parse(record.value);
  if (new Date(expires) < new Date()) {
    await prisma.platformConfig.delete({ where: { key: `verify:${token}` } }).catch(() => {});
    return res.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/app?verify=expired`);
  }

  await Promise.all([
    prisma.user.update({ where: { id: userId }, data: { isEmailVerified: true } }),
    prisma.platformConfig.delete({ where: { key: `verify:${token}` } }),
  ]);

  return res.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/app?verify=success`);
}


// pages/api/auth/resend-verification.js
// ── Resend verification email ─────────────────────────────────────────

import { prisma }          from "../../../lib/prisma";
import { requireAuth }     from "../../../lib/auth";
import { sendVerificationEmail } from "../../../lib/email";
import { ok, err, methodNotAllowed } from "../../../lib/apiHelpers";

export default async function handler(req, res) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
  try {
    const payload = requireAuth(req);
    const user    = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) return err(res, "User not found", 404);
    if (user.isEmailVerified) return err(res, "Email already verified", 400);
    await sendVerificationEmail(user);
    return ok(res, { message: "Verification email sent" });
  } catch (e) {
    return err(res, e.message, e.status || 400);
  }
}


// ══════════════════════════════════════════════════════════════════════
//  FILE 5: lib/push.js
//  Firebase Cloud Messaging (FCM) — mobile & web push notifications
//
//  npm install firebase-admin
//
//  .env:
//    FIREBASE_PROJECT_ID=your-project-id
//    FIREBASE_CLIENT_EMAIL=firebase-adminsdk@...iam.gserviceaccount.com
//    FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
//    NEXT_PUBLIC_FIREBASE_VAPID_KEY=your-web-push-vapid-key
//
//  Setup: Firebase Console → Project Settings → Service Accounts → Generate key
//  In production: store private key in secret manager, not .env
// ══════════════════════════════════════════════════════════════════════

// lib/push.js
import admin from "firebase-admin";
import { prisma } from "./prisma";

// Singleton init — safe with Next.js HMR
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  });
}

const messaging = admin.messaging();

// ── Store FCM token per user ──────────────────────────────────────────
// Call this from the React app when the user grants push permission
export async function registerFCMToken(userId, token, platform = "web") {
  await prisma.platformConfig.upsert({
    where:  { key: `fcm:${userId}:${platform}` },
    create: { key: `fcm:${userId}:${platform}`, value: token, updatedBy: userId },
    update: { value: token, updatedBy: userId },
  });
}

export async function removeFCMToken(userId, platform = "web") {
  await prisma.platformConfig.deleteMany({ where: { key: { startsWith: `fcm:${userId}:${platform}` } } });
}

async function getUserFCMTokens(userId) {
  const records = await prisma.platformConfig.findMany({
    where: { key: { startsWith: `fcm:${userId}:` } },
  });
  return records.map((r) => r.value);
}

// ── Send push to a single user (all their devices) ───────────────────
export async function pushToUser(userId, { title, body, icon, link, data = {} }) {
  const tokens = await getUserFCMTokens(userId);
  if (!tokens.length) return; // User hasn't granted push permission

  const message = {
    notification: { title, body },
    webpush: {
      notification: { title, body, icon: icon || "/icon-192.png", badge: "/badge-72.png", requireInteraction: false },
      fcmOptions: { link: link || "/" },
    },
    data: { ...data, click_action: link || "/" },
    tokens,
  };

  const response = await messaging.sendEachForMulticast(message);

  // Clean up invalid tokens
  const invalid = [];
  response.responses.forEach((r, i) => {
    if (!r.success && (r.error?.code === "messaging/registration-token-not-registered" || r.error?.code === "messaging/invalid-registration-token")) {
      invalid.push(tokens[i]);
    }
  });
  if (invalid.length) {
    await prisma.platformConfig.deleteMany({ where: { value: { in: invalid } } });
  }

  return response;
}

// ── Send push to multiple users ───────────────────────────────────────
export async function pushToUsers(userIds, notification) {
  return Promise.allSettled(userIds.map((id) => pushToUser(id, notification)));
}

// ── Send push to a topic (e.g. all UK users) ─────────────────────────
export async function pushToTopic(topic, { title, body, link }) {
  return messaging.send({
    topic,
    notification: { title, body },
    webpush: { fcmOptions: { link } },
  });
}

// ── Subscribe user to a topic ─────────────────────────────────────────
export async function subscribeToTopic(userId, topic) {
  const tokens = await getUserFCMTokens(userId);
  if (!tokens.length) return;
  return messaging.subscribeToTopic(tokens, topic);
}

// ── Enhanced emitNotification (Socket.io + FCM together) ─────────────
// Replace the import in socket.js with this version
export async function emitNotification(userId, notif) {
  // 1. Socket.io (instant, if user is online)
  // io.to(`user:${userId}`).emit("notification:new", notif);  // called from socket.js

  // 2. FCM push (works even when tab is closed)
  await pushToUser(userId, {
    title: notif.title,
    body:  notif.body,
    icon:  notif.icon ? undefined : "/icon-192.png",
    link:  notif.link || "/app",
    data:  { notifId: notif.id, type: notif.type },
  }).catch(console.error);
}

// ── New job category notification → all matching users ────────────────
export async function notifyJobCategoryUsers(categoryId, categoryName) {
  // Find all users who follow this category
  const users = await prisma.user.findMany({
    where: { jobCategoryIds: { has: categoryId }, isActive: true },
    select: { id: true },
  });

  const notifData = {
    title: `New Job Category: ${categoryName} ✨`,
    body: `Jobs in ${categoryName} are now available near you. Tap to browse.`,
    link: "/app?tab=jobs",
    data: { categoryId: String(categoryId) },
  };

  // Batch notifications in DB
  await prisma.notification.createMany({
    data: users.map((u) => ({
      userId:   u.id,
      type:     "job",
      icon:     "✨",
      title:    notifData.title,
      body:     notifData.body,
      priority: "normal",
    })),
    skipDuplicates: true,
  });

  // Push
  await pushToUsers(users.map((u) => u.id), notifData);
}


// pages/api/push/register.js
// ── Register FCM token from browser/app ──────────────────────────────

import { requireAuth }   from "../../../lib/auth";
import { registerFCMToken } from "../../../lib/push";
import { ok, err, methodNotAllowed } from "../../../lib/apiHelpers";

export default async function handler(req, res) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
  try {
    const payload = requireAuth(req);
    const { token, platform = "web" } = req.body;
    if (!token) return err(res, "FCM token required", 422);
    await registerFCMToken(payload.sub, token, platform);
    return ok(res, { message: "Push notifications enabled" });
  } catch (e) {
    return err(res, e.message, e.status || 400);
  }
}


// ══════════════════════════════════════════════════════════════════════
//  FILE 6: lib/rateLimit.js
//  Rate limiting — in-memory for dev, Upstash Redis for production
//
//  Free options:
//    Dev:        in-memory Map (works for single-instance, no Redis needed)
//    Production: Upstash Redis (free tier: 10,000 req/day)
//               OR Vercel KV (built-in on Vercel, free tier available)
//
//  npm install @upstash/ratelimit @upstash/redis   (production)
//
//  .env (Upstash — get from upstash.com console):
//    UPSTASH_REDIS_REST_URL=https://...upstash.io
//    UPSTASH_REDIS_REST_TOKEN=AX...
// ══════════════════════════════════════════════════════════════════════

// lib/rateLimit.js

// ── In-memory store (dev / single-process) ────────────────────────────
class InMemoryStore {
  constructor() { this._store = new Map(); }
  async incr(key) {
    const now = Date.now();
    const entry = this._store.get(key) || { count: 0, resetAt: now + 60_000 };
    if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + 60_000; }
    entry.count++;
    this._store.set(key, entry);
    return { count: entry.count, resetAt: entry.resetAt };
  }
}

// ── Upstash Redis store (production) ─────────────────────────────────
class UpstashStore {
  async incr(key) {
    const url   = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) throw new Error("Upstash not configured");

    // INCR + EXPIRE in a pipeline
    const res = await fetch(`${url}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify([["INCR", key], ["EXPIRE", key, "60"]]),
    }).then((r) => r.json());

    return { count: res[0].result, resetAt: Date.now() + 60_000 };
  }
}

const store = process.env.UPSTASH_REDIS_REST_URL ? new UpstashStore() : new InMemoryStore();

// ── Rate limit configs ─────────────────────────────────────────────────
export const LIMITS = {
  auth:         { limit: 10,  window: 60  }, // 10 attempts per minute  (login/signup)
  api:          { limit: 100, window: 60  }, // 100 req per minute      (general API)
  upload:       { limit: 20,  window: 60  }, // 20 uploads per minute
  jobPost:      { limit: 5,   window: 3600}, // 5 job posts per hour
  promoCreate:  { limit: 3,   window: 3600}, // 3 promos per hour
  notification: { limit: 50,  window: 60  }, // 50 notif triggers per minute
};

// ── Core rate limit function ──────────────────────────────────────────
export async function rateLimit(identifier, type = "api") {
  const config = LIMITS[type] || LIMITS.api;
  const key    = `rl:${type}:${identifier}`;

  const { count, resetAt } = await store.incr(key);
  const remaining = Math.max(0, config.limit - count);
  const exceeded  = count > config.limit;

  return {
    exceeded,
    remaining,
    resetAt,
    limit: config.limit,
    headers: {
      "X-RateLimit-Limit":     String(config.limit),
      "X-RateLimit-Remaining": String(remaining),
      "X-RateLimit-Reset":     String(Math.ceil(resetAt / 1000)),
      ...(exceeded && { "Retry-After": String(Math.ceil((resetAt - Date.now()) / 1000)) }),
    },
  };
}

// ── Higher-order middleware wrapper ───────────────────────────────────
// Usage in any API route:
//   export default withRateLimit(handler, "auth");
//   export default withRateLimit(handler, "api", (req) => req.headers["x-user-id"]);
export function withRateLimit(handler, type = "api", getIdentifier) {
  return async function rateLimitedHandler(req, res) {
    const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || "unknown";
    const identifier = getIdentifier ? getIdentifier(req) : ip;

    try {
      const result = await rateLimit(identifier, type);
      // Always set rate limit headers
      Object.entries(result.headers).forEach(([k, v]) => res.setHeader(k, v));
      if (result.exceeded) {
        return res.status(429).json({
          success: false,
          error:   "Too many requests. Please slow down.",
          retryAfter: Math.ceil((result.resetAt - Date.now()) / 1000),
        });
      }
    } catch (e) {
      // Rate limit store failure → don't block the request, just log
      console.error("Rate limit store error:", e);
    }

    return handler(req, res);
  };
}

// ── Apply to auth routes ──────────────────────────────────────────────
// pages/api/auth/login.js — wrap existing handler:
// export default withRateLimit(handler, "auth");

// pages/api/auth/signup.js — wrap existing handler:
// export default withRateLimit(handler, "auth");

// ── Apply to upload route ─────────────────────────────────────────────
// export default withRateLimit(handler, "upload", (req) => {
//   try { return requireAuth(req).sub; } catch { return req.socket?.remoteAddress; }
// });


// ════════════════════════════════════════════════════════════════════
//  FRONTEND: hooks/usePush.js
//  React hook — requests push permission, registers FCM token with server
// ════════════════════════════════════════════════════════════════════

// hooks/usePush.js
import { useEffect } from "react";
import { initializeApp, getApps } from "firebase/app";
import { getMessaging, getToken, onMessage } from "firebase/messaging";
import { getAccessToken } from "../lib/api.client";

const FIREBASE_CONFIG = {
  apiKey:            process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain:        `${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}.firebaseapp.com`,
  projectId:         process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket:     `${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}.appspot.com`,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId:             process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export function usePush({ onMessage: onMsg } = {}) {
  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (!getAccessToken()) return; // only for logged-in users

    (async () => {
      try {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") return;

        const app = getApps().length ? getApps()[0] : initializeApp(FIREBASE_CONFIG);
        const messaging = getMessaging(app);

        const token = await getToken(messaging, { vapidKey: process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY });
        if (!token) return;

        // Register with server
        await fetch("/api/push/register", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${getAccessToken()}` },
          body: JSON.stringify({ token, platform: "web" }),
        });

        // Listen for foreground messages
        onMessage(messaging, (payload) => {
          onMsg?.(payload);
          // Show browser notification if tab is in foreground
          if (Notification.permission === "granted" && payload.notification) {
            new Notification(payload.notification.title, {
              body: payload.notification.body,
              icon: "/icon-192.png",
            });
          }
        });
      } catch (e) {
        console.error("Push setup error:", e);
      }
    })();
  }, []);
}

// public/firebase-messaging-sw.js  (service worker — handles background push)
// Copy this file to your /public folder:
/*
importScripts('https://www.gstatic.com/firebasejs/10.0.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.0.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: self.FIREBASE_API_KEY,
  projectId: self.FIREBASE_PROJECT_ID,
  messagingSenderId: self.FIREBASE_MESSAGING_SENDER_ID,
  appId: self.FIREBASE_APP_ID,
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(function(payload) {
  const { title, body } = payload.notification;
  self.registration.showNotification(title, {
    body,
    icon: '/icon-192.png',
    badge: '/badge-72.png',
    data: payload.data,
  });
});
*/


// ════════════════════════════════════════════════════════════════════
//  UPDATED: pages/api/auth/signup.js (with rate limiting + email verification)
//  Replace the original signup.js with this version.
// ════════════════════════════════════════════════════════════════════

import { prisma }           from "../../../lib/prisma";
import { hashPassword, signAccessToken, signRefreshToken, saveRefreshToken, setRefreshCookie, generateReferralCode, validateSignupInput } from "../../../lib/auth";
import { ok, err, methodNotAllowed } from "../../../lib/apiHelpers";
import { withRateLimit }    from "../../../lib/rateLimit";
import { sendVerificationEmail, sendWelcomeEmail } from "../../../lib/email";
import { subscribeToTopic } from "../../../lib/push";
import { nanoid }           from "nanoid";

async function handler(req, res) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);

  const { name, email, password, country, role, referralCode, jobCategoryIds = [], vendorType } = req.body;

  const { errors, valid } = validateSignupInput({ name, email, password, country, role });
  if (!valid) return err(res, "Validation failed", 422, errors);

  const exists = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  if (exists) return err(res, "An account with this email already exists", 409);

  // Resolve referrer
  let referredById = null;
  let referralBonus = 0;
  if (referralCode?.length === 8) {
    const referrer = await prisma.user.findUnique({ where: { referralCode: referralCode.toUpperCase() } });
    if (referrer) { referredById = referrer.id; referralBonus = 500; }
  }

  const passwordHash = await hashPassword(password);
  const myRefCode    = generateReferralCode(name);

  const user = await prisma.$transaction(async (tx) => {
    const newUser = await tx.user.create({
      data: {
        email: email.toLowerCase().trim(), passwordHash, name: name.trim(),
        role, country,
        referralCode:   myRefCode,
        referredById,
        loyaltyPoints:  referralBonus,
        jobCategoryIds: jobCategoryIds.map(Number),
      },
    });

    if (role === "vendor") {
      await tx.vendor.create({ data: { userId: newUser.id, name: name.trim(), country, type: vendorType || "ecommerce", status: "pending" } });
    }
    if (role === "driver") {
      await tx.driver.create({ data: { userId: newUser.id, country, vehicle: "Electric Bike", status: "pending" } });
    }

    if (referralBonus > 0) {
      await tx.pointsTransaction.create({ data: { userId: newUser.id, type: "bonus", points: referralBonus, description: "Referral joining bonus" } });
    }
    if (referredById) {
      await tx.notification.create({ data: { userId: referredById, type: "referral", icon: "🔗", title: "Referral Signup!", body: `${name} joined using your code!`, priority: "normal" } });
    }
    await tx.notification.create({ data: { userId: newUser.id, type: "system", icon: "🎉", title: `Welcome, ${name.split(" ")[0]}!`, body: "Explore local shops, restaurants, and jobs within 10 miles.", priority: "normal" } });
    return newUser;
  });

  // Issue tokens
  const accessToken  = signAccessToken(user);
  const refreshToken = signRefreshToken(user.id);
  await saveRefreshToken(user.id, refreshToken);
  setRefreshCookie(res, refreshToken);

  // Async post-signup tasks (don't await — don't delay response)
  Promise.allSettled([
    sendVerificationEmail(user),
    sendWelcomeEmail(user),
    subscribeToTopic(user.id, `country-${user.country}`), // FCM topic for country-wide pushes
  ]).catch(console.error);

  const { passwordHash: _, ...safeUser } = user;
  return ok(res, { user: safeUser, accessToken }, 201);
}

// Apply rate limiting: max 10 signup attempts per IP per minute
export default withRateLimit(handler, "auth");


// ════════════════════════════════════════════════════════════════════
//  UPDATED: pages/api/auth/login.js (with rate limiting)
// ════════════════════════════════════════════════════════════════════

import { prisma }          from "../../../lib/prisma";
import { verifyPassword, signAccessToken, signRefreshToken, saveRefreshToken, setRefreshCookie, validateLoginInput } from "../../../lib/auth";
import { ok, err, methodNotAllowed } from "../../../lib/apiHelpers";
import { withRateLimit }   from "../../../lib/rateLimit";

async function loginHandler(req, res) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);

  const { email, password } = req.body;
  const { errors, valid } = validateLoginInput({ email, password });
  if (!valid) return err(res, "Validation failed", 422, errors);

  // Timing-safe lookup — always run bcrypt even if user not found
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase().trim() },
    include: {
      vendor: { select: { id: true, type: true, status: true, totalSales: true, commissionOwed: true } },
      driver: { select: { id: true, status: true, isOnline: true, rating: true, totalTrips: true, pricingBase: true, pricingPerUnit: true, pricingMin: true, pricingMaxDist: true } },
    },
  });

  // Always hash-compare even for missing users (prevents user enumeration)
  const hashToCompare = user?.passwordHash || "$2a$12$invalidhashplaceholdertopreventtiming";
  const passwordMatch = await verifyPassword(password, hashToCompare);

  if (!user || !passwordMatch) return err(res, "Invalid email or password", 401);
  if (!user.isActive) return err(res, "Account suspended. Contact support@localhub.app", 403);

  const accessToken  = signAccessToken(user);
  const refreshToken = signRefreshToken(user.id);
  await saveRefreshToken(user.id, refreshToken);
  setRefreshCookie(res, refreshToken);

  const { passwordHash: _, ...safeUser } = user;
  return ok(res, { user: safeUser, accessToken });
}

// Max 10 login attempts per IP per minute — prevents brute-force
export default withRateLimit(loginHandler, "auth");
