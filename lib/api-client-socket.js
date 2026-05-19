// ════════════════════════════════════════════════════════════════════
//  FILE: lib/api.client.js
//  Client-side API wrapper — used by the React app
//  Every function calls a real Next.js API route.
//  Access token is kept in memory (NOT localStorage — XSS safe).
//  Refresh token lives in HttpOnly cookie — auto-sent by browser.
// ════════════════════════════════════════════════════════════════════

// ─── TOKEN STORE (in-memory only) ────────────────────────────────────
let _accessToken = null;
let _refreshing  = null; // promise guard — prevents parallel refresh races

export function setAccessToken(t) { _accessToken = t; }
export function getAccessToken()  { return _accessToken; }
export function clearTokens()     { _accessToken = null; }

// ─── BASE FETCH ───────────────────────────────────────────────────────
async function apiFetch(url, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...options.headers,
  };
  if (_accessToken) headers["Authorization"] = `Bearer ${_accessToken}`;

  const res = await fetch(url, { ...options, headers, credentials: "include" });

  // Token expired → try silent refresh once
  if (res.status === 401 && !options._retry) {
    if (!_refreshing) {
      _refreshing = silentRefresh().finally(() => { _refreshing = null; });
    }
    await _refreshing;
    if (_accessToken) {
      return apiFetch(url, { ...options, _retry: true });
    }
  }

  const json = await res.json().catch(() => ({}));

  if (!res.ok) {
    const error = new Error(json.error || "Request failed");
    error.status = res.status;
    error.details = json.details;
    throw error;
  }
  return json.data;
}

// ─── SILENT TOKEN REFRESH ─────────────────────────────────────────────
async function silentRefresh() {
  try {
    const data = await fetch("/api/auth/refresh", {
      method: "POST",
      credentials: "include",
    }).then((r) => r.json());
    if (data?.data?.accessToken) {
      _accessToken = data.data.accessToken;
      return data.data;
    }
  } catch {
    _accessToken = null;
  }
  return null;
}

// ─── AUTH ─────────────────────────────────────────────────────────────
export const auth = {
  async signup(payload) {
    const data = await apiFetch("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (data.accessToken) setAccessToken(data.accessToken);
    return data;
  },

  async login(email, password) {
    const data = await apiFetch("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    if (data.accessToken) setAccessToken(data.accessToken);
    return data;
  },

  async logout() {
    await apiFetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    clearTokens();
  },

  async me() {
    return apiFetch("/api/auth/me");
  },

  async refresh() {
    return silentRefresh();
  },
};

// ─── PRODUCTS ─────────────────────────────────────────────────────────
export const products = {
  list({ country, category, search, page = 1, limit = 20 } = {}) {
    const q = new URLSearchParams({ country, page, limit, ...(category && { category }), ...(search && { search }) });
    return apiFetch(`/api/products?${q}`);
  },
  create(data)       { return apiFetch("/api/products", { method: "POST", body: JSON.stringify(data) }); },
  update(id, data)   { return apiFetch(`/api/products/${id}`, { method: "PATCH", body: JSON.stringify(data) }); },
  delete(id)         { return apiFetch(`/api/products/${id}`, { method: "DELETE" }); },
};

// ─── GROCERY ──────────────────────────────────────────────────────────
export const grocery = {
  list({ country, category, search, page = 1, limit = 20 } = {}) {
    const q = new URLSearchParams({ country, page, limit, ...(category && { category }), ...(search && { search }) });
    return apiFetch(`/api/grocery?${q}`);
  },
};

// ─── RESTAURANTS / FOOD ───────────────────────────────────────────────
export const restaurants = {
  list({ country, cuisine, search } = {}) {
    const q = new URLSearchParams({ country, ...(cuisine && { cuisine }), ...(search && { search }) });
    return apiFetch(`/api/restaurants?${q}`);
  },
};

// ─── ORDERS ───────────────────────────────────────────────────────────
export const orders = {
  create(payload)          { return apiFetch("/api/orders", { method: "POST", body: JSON.stringify(payload) }); },
  list({ status, page } = {}) { return apiFetch(`/api/orders?${new URLSearchParams({ ...(status && { status }), ...(page && { page }) })}`); },
  get(id)                  { return apiFetch(`/api/orders/${id}`); },
  updateStatus(id, status, note) {
    return apiFetch(`/api/orders/${id}/status`, { method: "PATCH", body: JSON.stringify({ status, note }) });
  },
};

// ─── DRIVERS ──────────────────────────────────────────────────────────
export const drivers = {
  available({ country, lat, lng, dist, parcel = "small" } = {}) {
    const q = new URLSearchParams({ country, lat, lng, dist, parcel });
    return apiFetch(`/api/drivers/available?${q}`);
  },
  updatePricing(data) { return apiFetch("/api/driver/pricing", { method: "PATCH", body: JSON.stringify(data) }); },
  toggleOnline(isOnline) { return apiFetch("/api/driver/status", { method: "PATCH", body: JSON.stringify({ isOnline }) }); },
  myEarnings()   { return apiFetch("/api/driver/earnings"); },
  myOrders()     { return apiFetch("/api/driver/orders"); },
};

// ─── JOBS ─────────────────────────────────────────────────────────────
export const jobs = {
  list({ country, categoryId, search, urgent, page } = {}) {
    const q = new URLSearchParams({ ...(country && { country }), ...(categoryId && { categoryId }), ...(search && { search }), ...(urgent && { urgent }), ...(page && { page }) });
    return apiFetch(`/api/jobs?${q}`);
  },
  post(payload)        { return apiFetch("/api/jobs", { method: "POST", body: JSON.stringify(payload) }); },
  apply(id, payload)   { return apiFetch(`/api/jobs/${id}/apply`, { method: "POST", body: JSON.stringify(payload) }); },
  categories()         { return apiFetch("/api/jobs/categories"); },
  createCategory(name) { return apiFetch("/api/jobs/categories", { method: "POST", body: JSON.stringify({ name }) }); },
};

// ─── VENDOR ───────────────────────────────────────────────────────────
export const vendor = {
  myOrders()                      { return apiFetch("/api/vendor/orders"); },
  updateOrderStatus(id, status)   { return orders.updateStatus(id, status); },
  analytics()                     { return apiFetch("/api/vendor/analytics"); },
  createPromo(data)               { return promos.create(data); },
};

// ─── PROMOS ───────────────────────────────────────────────────────────
export const promos = {
  list(country)      { return apiFetch(`/api/promos?country=${country}`); },
  create(data)       { return apiFetch("/api/promos", { method: "POST", body: JSON.stringify(data) }); },
  approve(id)        { return apiFetch(`/api/promos/${id}/approve`, { method: "POST" }); },
  reject(id)         { return apiFetch(`/api/promos/${id}/reject`, { method: "POST" }); },
};

// ─── LOYALTY ──────────────────────────────────────────────────────────
export const loyalty = {
  redeem(points) { return apiFetch("/api/loyalty/redeem", { method: "POST", body: JSON.stringify({ points }) }); },
  history()      { return apiFetch("/api/loyalty/history"); },
};

// ─── REFERRAL ─────────────────────────────────────────────────────────
export const referral = {
  history()      { return apiFetch("/api/referral/history"); },
  apply(code)    { return apiFetch("/api/referral/apply", { method: "POST", body: JSON.stringify({ code }) }); },
};

// ─── NOTIFICATIONS ────────────────────────────────────────────────────
export const notifications = {
  list()         { return apiFetch("/api/notifications"); },
  markRead(id)   { return apiFetch(`/api/notifications/${id}/read`, { method: "PATCH" }); },
  markAll()      { return apiFetch("/api/notifications", { method: "PATCH" }); },
};

// ─── CHAT ─────────────────────────────────────────────────────────────
export const chat = {
  conversations()               { return apiFetch("/api/chat/conversations"); },
  messages(conversationId)      { return apiFetch(`/api/chat/conversations/${conversationId}/messages`); },
  send(conversationId, text)    { return apiFetch(`/api/chat/conversations/${conversationId}/messages`, { method: "POST", body: JSON.stringify({ text }) }); },
  start(recipientId)            { return apiFetch("/api/chat/conversations", { method: "POST", body: JSON.stringify({ recipientId }) }); },
};

// ─── ADMIN ────────────────────────────────────────────────────────────
export const admin = {
  stats()                         { return apiFetch("/api/admin/stats"); },
  rates()                         { return apiFetch("/api/admin/rates"); },
  updateRates(data)               { return apiFetch("/api/admin/rates", { method: "PATCH", body: JSON.stringify(data) }); },
  vendors({ country } = {})       { return apiFetch(`/api/admin/vendors?${new URLSearchParams(country ? { country } : {})}`); },
  updateVendor(id, data)          { return apiFetch(`/api/admin/vendors/${id}`, { method: "PATCH", body: JSON.stringify(data) }); },
  drivers({ country } = {})       { return apiFetch(`/api/admin/drivers?${new URLSearchParams(country ? { country } : {})}`); },
  updateDriver(id, data)          { return apiFetch(`/api/admin/drivers/${id}`, { method: "PATCH", body: JSON.stringify(data) }); },
  orders({ page } = {})           { return apiFetch(`/api/admin/orders?${new URLSearchParams(page ? { page } : {})}`); },
  pendingPromos()                  { return apiFetch("/api/admin/promos?status=pending"); },
  allUsers()                       { return apiFetch("/api/admin/users"); },
};

// ─── GEOCODING (free Nominatim — no API key needed) ───────────────────
export async function geocodeAddress(address, country) {
  const countryCode = country === "uk" ? "gb" : "bd";
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&countrycodes=${countryCode}&format=json&limit=1`;
  try {
    const res = await fetch(url, { headers: { "Accept-Language": "en" } });
    const data = await res.json();
    if (data[0]) return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), display: data[0].display_name };
  } catch {}
  return null;
}


// ════════════════════════════════════════════════════════════════════
//  FILE: server/socket.js
//  Socket.io real-time server
//  Run alongside Next.js: node server/socket.js
//
//  npm install socket.io
//
//  Handles:
//   - Driver GPS position streaming
//   - Order status push to customer
//   - Chat message delivery
//   - Notification push
// ════════════════════════════════════════════════════════════════════

// server/socket.js
import { createServer } from "http";
import { Server }       from "socket.io";
import jwt              from "jsonwebtoken";

const httpServer = createServer();
const io = new Server(httpServer, {
  cors: {
    origin:      process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
    credentials: true,
  },
});

// Connected sockets indexed by userId
const userSockets = new Map(); // userId → Set<socketId>
const driverRooms = new Map(); // driverId → socketId

// ── Auth middleware ───────────────────────────────────────────────────
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error("Unauthorized"));
  try {
    socket.user = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    next();
  } catch {
    next(new Error("Token invalid or expired"));
  }
});

// ── Connection ────────────────────────────────────────────────────────
io.on("connection", (socket) => {
  const { sub: userId, role } = socket.user;

  // Register socket
  if (!userSockets.has(userId)) userSockets.set(userId, new Set());
  userSockets.get(userId).add(socket.id);

  // Join personal room (for targeted push)
  socket.join(`user:${userId}`);
  if (role === "driver")  socket.join("drivers");
  if (role === "admin")   socket.join("admins");

  console.log(`✅ ${role} ${userId} connected (${socket.id})`);

  // ── DRIVER: stream GPS position ─────────────────────────────────────
  socket.on("driver:position", async ({ lat, lng }) => {
    if (role !== "driver") return;
    // Broadcast to any customers tracking this driver's orders
    socket.broadcast.emit(`driver:${userId}:position`, { lat, lng });

    // Persist to DB (debounced on client side — emit max every 3s)
    try {
      const { prisma } = await import("../lib/prisma.js");
      await prisma.driver.updateMany({
        where: { userId },
        data:  { lastLat: lat, lastLng: lng, lastSeen: new Date() },
      });
    } catch {}
  });

  // ── DRIVER: go online/offline ────────────────────────────────────────
  socket.on("driver:status", async ({ isOnline }) => {
    if (role !== "driver") return;
    try {
      const { prisma } = await import("../lib/prisma.js");
      await prisma.driver.updateMany({ where: { userId }, data: { isOnline } });
      io.to("admins").emit("driver:status:changed", { userId, isOnline });
    } catch {}
  });

  // ── CUSTOMER: subscribe to order tracking ───────────────────────────
  socket.on("order:track", ({ orderId }) => {
    socket.join(`order:${orderId}`);
  });

  socket.on("order:untrack", ({ orderId }) => {
    socket.leave(`order:${orderId}`);
  });

  // ── CHAT: send message ───────────────────────────────────────────────
  socket.on("chat:message", async ({ conversationId, text }) => {
    try {
      const { prisma } = await import("../lib/prisma.js");

      const message = await prisma.message.create({
        data: { conversationId, senderId: userId, text },
        include: { sender: { select: { name: true, avatar: true, role: true } } },
      });

      // Deliver to all conversation participants
      const conv = await prisma.conversation.findUnique({
        where: { id: conversationId },
        include: { participants: true },
      });
      conv?.participants.forEach((p) => {
        if (p.userId !== userId) {
          io.to(`user:${p.userId}`).emit("chat:message:new", { conversationId, message });
        }
      });
      // Echo back to sender
      socket.emit("chat:message:sent", { conversationId, message });
    } catch (e) {
      socket.emit("chat:error", { message: e.message });
    }
  });

  // ── Chat typing indicator ────────────────────────────────────────────
  socket.on("chat:typing", ({ conversationId, recipientId }) => {
    io.to(`user:${recipientId}`).emit("chat:typing", { conversationId, senderId: userId });
  });

  // ── Disconnect ───────────────────────────────────────────────────────
  socket.on("disconnect", () => {
    const sockets = userSockets.get(userId);
    if (sockets) {
      sockets.delete(socket.id);
      if (sockets.size === 0) userSockets.delete(userId);
    }
    console.log(`❌ ${role} ${userId} disconnected`);
  });
});

// ── Server-side emitters (called from API routes) ─────────────────────
export function emitOrderStatus(orderId, status, data = {}) {
  io.to(`order:${orderId}`).emit("order:status", { orderId, status, ...data });
}

export function emitNotification(userId, notif) {
  io.to(`user:${userId}`).emit("notification:new", notif);
}

export function emitToAdmins(event, data) {
  io.to("admins").emit(event, data);
}

const PORT = process.env.SOCKET_PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`🔌 Socket.io running on port ${PORT}`);
});


// ════════════════════════════════════════════════════════════════════
//  FILE: hooks/useSocket.js
//  React hook — connects to Socket.io, auto-reconnects, auto-refreshes token
// ════════════════════════════════════════════════════════════════════

// hooks/useSocket.js
import { useEffect, useRef, useCallback } from "react";
import { io } from "socket.io-client";
import { getAccessToken } from "../lib/api.client";

let _socket = null;

export function useSocket({ onOrderStatus, onDriverPosition, onChatMessage, onNotification, onTyping } = {}) {
  const handlersRef = useRef({ onOrderStatus, onDriverPosition, onChatMessage, onNotification, onTyping });
  useEffect(() => {
    handlersRef.current = { onOrderStatus, onDriverPosition, onChatMessage, onNotification, onTyping };
  });

  useEffect(() => {
    const token = getAccessToken();
    if (!token || _socket?.connected) return;

    _socket = io(process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:3001", {
      auth: { token },
      transports: ["websocket"],
      reconnection: true,
      reconnectionDelay: 2000,
    });

    _socket.on("order:status",       (d) => handlersRef.current.onOrderStatus?.(d));
    _socket.on("driver:position",    (d) => handlersRef.current.onDriverPosition?.(d));
    _socket.on("chat:message:new",   (d) => handlersRef.current.onChatMessage?.(d));
    _socket.on("notification:new",   (d) => handlersRef.current.onNotification?.(d));
    _socket.on("chat:typing",        (d) => handlersRef.current.onTyping?.(d));

    return () => {
      _socket?.disconnect();
      _socket = null;
    };
  }, []);

  const trackOrder = useCallback((orderId) => _socket?.emit("order:track", { orderId }), []);
  const sendGPS    = useCallback((lat, lng) => _socket?.emit("driver:position", { lat, lng }), []);
  const sendMsg    = useCallback((conversationId, text) => _socket?.emit("chat:message", { conversationId, text }), []);
  const sendTyping = useCallback((conversationId, recipientId) => _socket?.emit("chat:typing", { conversationId, recipientId }), []);
  const setOnline  = useCallback((isOnline) => _socket?.emit("driver:status", { isOnline }), []);

  return { trackOrder, sendGPS, sendMsg, sendTyping, setOnline, socket: _socket };
}


// ════════════════════════════════════════════════════════════════════
//  FILE: hooks/useAuth.js
//  React hook — wraps auth state with automatic token refresh on mount
// ════════════════════════════════════════════════════════════════════

// hooks/useAuth.js
import { useState, useEffect, useCallback } from "react";
import { auth, setAccessToken, clearTokens } from "../lib/api.client";

export function useAuth() {
  const [user,    setUser]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  // On mount: attempt silent refresh (user may have a valid refresh cookie)
  useEffect(() => {
    (async () => {
      try {
        const data = await auth.refresh();
        if (data?.user) setUser(data.user);
      } catch {
        // No valid refresh cookie — user is not logged in
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const login = useCallback(async (email, password) => {
    setError(null);
    const data = await auth.login(email, password);
    setUser(data.user);
    return data;
  }, []);

  const signup = useCallback(async (payload) => {
    setError(null);
    const data = await auth.signup(payload);
    setUser(data.user);
    return data;
  }, []);

  const logout = useCallback(async () => {
    await auth.logout();
    setUser(null);
    clearTokens();
  }, []);

  const updateUser = useCallback((patch) => setUser((u) => u ? { ...u, ...patch } : u), []);

  return { user, setUser, updateUser, loading, error, setError, login, signup, logout };
}


// ════════════════════════════════════════════════════════════════════
//  FILE: .env.example
//  Copy to .env.local and fill in real values
// ════════════════════════════════════════════════════════════════════

/*
# .env.local

# ── Database ──────────────────────────────────────────────────────
# Supabase: Settings → Database → Connection string → URI
DATABASE_URL="postgresql://postgres:[PASSWORD]@db.[PROJECT].supabase.co:5432/postgres"

# ── JWT ───────────────────────────────────────────────────────────
# Generate: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
JWT_ACCESS_SECRET="your-64-byte-random-hex-access-secret"
JWT_REFRESH_SECRET="your-64-byte-random-hex-refresh-secret"
JWT_ACCESS_EXPIRES="15m"
JWT_REFRESH_EXPIRES="7d"

# ── App ───────────────────────────────────────────────────────────
NEXT_PUBLIC_APP_URL="http://localhost:3000"
NEXT_PUBLIC_SOCKET_URL="http://localhost:3001"
NODE_ENV="development"

# ── Payments ──────────────────────────────────────────────────────
# UK — Stripe
STRIPE_SECRET_KEY="sk_test_..."
STRIPE_WEBHOOK_SECRET="whsec_..."
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY="pk_test_..."

# BD — bKash (Sandbox)
BKASH_APP_KEY="your-bkash-app-key"
BKASH_APP_SECRET="your-bkash-app-secret"
BKASH_USERNAME="your-bkash-username"
BKASH_PASSWORD="your-bkash-password"
BKASH_BASE_URL="https://tokenized.sandbox.bka.sh/v1.2.0-beta"

# BD — SSLCommerz (alternative)
SSLCZ_STORE_ID="your-store-id"
SSLCZ_STORE_PASS="your-store-password"
SSLCZ_IS_LIVE="false"

# ── Email (SendGrid) ──────────────────────────────────────────────
SENDGRID_API_KEY="SG...."
EMAIL_FROM="noreply@localhub.app"

# ── File Storage (Cloudflare R2 or AWS S3) ────────────────────────
R2_ACCOUNT_ID="your-account-id"
R2_ACCESS_KEY_ID="your-key-id"
R2_SECRET_ACCESS_KEY="your-secret"
R2_BUCKET="localhub-uploads"
NEXT_PUBLIC_CDN_URL="https://cdn.localhub.app"

# ── Maps (optional — Nominatim used by default for free geocoding) ─
# GOOGLE_MAPS_API_KEY="AIza..."

# ── Socket.io ─────────────────────────────────────────────────────
SOCKET_PORT="3001"

# ── Push (Firebase Cloud Messaging) ──────────────────────────────
FIREBASE_PROJECT_ID="your-project-id"
FIREBASE_CLIENT_EMAIL="firebase-adminsdk@...iam.gserviceaccount.com"
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n..."
NEXT_PUBLIC_FIREBASE_VAPID_KEY="your-vapid-key"
*/


// ════════════════════════════════════════════════════════════════════
//  FILE: package.json
// ════════════════════════════════════════════════════════════════════

/*
{
  "name": "localhub",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "concurrently \"next dev\" \"node server/socket.js\"",
    "build": "next build",
    "start": "node server/index.js",
    "db:migrate": "prisma migrate dev",
    "db:generate": "prisma generate",
    "db:seed": "ts-node prisma/seed.ts",
    "db:studio": "prisma studio"
  },
  "dependencies": {
    "@prisma/client": "^5.12.0",
    "bcryptjs": "^2.4.3",
    "jsonwebtoken": "^9.0.2",
    "next": "^14.2.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "socket.io": "^4.7.5",
    "socket.io-client": "^4.7.5",
    "nanoid": "^5.0.7",
    "@aws-sdk/client-s3": "^3.556.0",
    "stripe": "^15.5.0",
    "nodemailer": "^6.9.13",
    "@sendgrid/mail": "^8.1.3",
    "concurrently": "^8.2.2",
    "cookie": "^0.6.0",
    "cors": "^2.8.5"
  },
  "devDependencies": {
    "@types/bcryptjs": "^2.4.6",
    "@types/jsonwebtoken": "^9.0.6",
    "@types/node": "^20.12.7",
    "@types/react": "^18.3.1",
    "prisma": "^5.12.0",
    "typescript": "^5.4.5"
  }
}
*/
