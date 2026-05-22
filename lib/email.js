const RESEND_API = "https://api.resend.com/emails";
const FROM = process.env.EMAIL_FROM || "LocalHub <onboarding@resend.dev>";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL;

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

function verificationTemplate(name, url) {
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#0a0a0f;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0f;padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#14141e;border:1px solid rgba(255,255,255,.07);border-radius:20px;overflow:hidden;max-width:560px;width:100%;">
        <tr><td style="padding:36px 40px;border-bottom:1px solid rgba(255,255,255,.07);">
          <span style="font-family:Georgia,serif;font-size:24px;font-weight:800;">
            <span style="color:#0ecfbe">LOCAL</span><span style="color:#f5b942">HUB</span>
          </span>
        </td></tr>
        <tr><td style="padding:40px;">
          <h1 style="color:#f8f7f4;font-family:Georgia,serif;font-size:28px;font-weight:800;margin:0 0 12px">Verify your email, ${name.split(" ")[0]} 👋</h1>
          <p style="color:rgba(255,255,255,.55);font-size:15px;line-height:1.7;margin:0 0 32px">Click the button below to verify your email and activate your LocalHub account. This link expires in 24 hours.</p>
          <a href="${url}" style="display:inline-block;background:#0ecfbe;color:#0a0a0f;font-size:15px;font-weight:700;text-decoration:none;border-radius:50px;padding:16px 40px;">Verify Email Address →</a>
          <p style="color:rgba(255,255,255,.28);font-size:12px;margin:32px 0 0;line-height:1.6;">If you didn't create a LocalHub account, ignore this email.</p>
        </td></tr>
        <tr><td style="padding:20px 40px;border-top:1px solid rgba(255,255,255,.07);">
          <p style="color:rgba(255,255,255,.2);font-size:11px;margin:0;font-family:monospace">© 2025 LocalHub · UK 🇬🇧 & Bangladesh 🇧🇩</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function welcomeTemplate(name) {
  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#0a0a0f;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0f;padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#14141e;border:1px solid rgba(255,255,255,.07);border-radius:20px;overflow:hidden;max-width:560px;width:100%;">
        <tr><td style="padding:36px 40px;border-bottom:1px solid rgba(255,255,255,.07);">
          <span style="font-family:Georgia,serif;font-size:24px;font-weight:800;"><span style="color:#0ecfbe">LOCAL</span><span style="color:#f5b942">HUB</span></span>
        </td></tr>
        <tr><td style="padding:40px;">
          <h1 style="color:#f8f7f4;font-family:Georgia,serif;font-size:28px;font-weight:800;margin:0 0 12px">Welcome to LocalHub, ${name.split(" ")[0]}! 🎉</h1>
          <p style="color:rgba(255,255,255,.55);font-size:15px;line-height:1.7;margin:0 0 24px">Your account is ready. Explore local shops, restaurants, and jobs within 10 miles of you.</p>
          <a href="${APP_URL}/app" style="display:inline-block;background:#0ecfbe;color:#0a0a0f;font-size:15px;font-weight:700;text-decoration:none;border-radius:50px;padding:16px 40px;">Open LocalHub →</a>
        </td></tr>
        <tr><td style="padding:20px 40px;border-top:1px solid rgba(255,255,255,.07);"><p style="color:rgba(255,255,255,.2);font-size:11px;margin:0;font-family:monospace">© 2025 LocalHub</p></td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function orderConfirmTemplate(user, order) {
  const cur = order.country === "uk" ? "£" : "৳";
  const itemsHtml = (order.items || []).map(i => `
    <tr>
      <td style="padding:8px 0;color:rgba(255,255,255,.7);font-size:14px;border-bottom:1px solid rgba(255,255,255,.05)">${i.emoji || "📦"} ${i.name} ×${i.qty || 1}</td>
      <td style="padding:8px 0;color:#f8f7f4;font-size:14px;font-weight:600;text-align:right;border-bottom:1px solid rgba(255,255,255,.05)">${cur}${i.price}</td>
    </tr>`).join("");

  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#0a0a0f;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0f;padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#14141e;border:1px solid rgba(255,255,255,.07);border-radius:20px;overflow:hidden;max-width:560px;width:100%;">
        <tr><td style="padding:36px 40px;border-bottom:1px solid rgba(255,255,255,.07);">
          <span style="font-family:Georgia,serif;font-size:24px;font-weight:800;"><span style="color:#0ecfbe">LOCAL</span><span style="color:#f5b942">HUB</span></span>
        </td></tr>
        <tr><td style="padding:40px;">
          <h1 style="color:#0ecfbe;font-family:Georgia,serif;font-size:26px;font-weight:800;margin:0 0 6px">Order Confirmed! 🎉</h1>
          <p style="color:rgba(255,255,255,.4);font-family:monospace;font-size:12px;margin:0 0 28px">${order.id}</p>
          <table width="100%" cellpadding="0" cellspacing="0">${itemsHtml}</table>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;background:rgba(255,255,255,.03);border-radius:12px;padding:16px;">
            <tr><td style="color:rgba(255,255,255,.4);font-size:13px">Subtotal</td><td style="text-align:right;color:#f8f7f4;font-size:13px">${cur}${order.subtotal}</td></tr>
            <tr><td style="color:rgba(255,255,255,.4);font-size:13px;padding-top:8px">Delivery</td><td style="text-align:right;color:#f8f7f4;font-size:13px;padding-top:8px">${cur}${order.deliveryFee}</td></tr>
            <tr><td style="color:#f8f7f4;font-size:16px;font-weight:700;padding-top:12px;border-top:1px solid rgba(255,255,255,.07)">Total</td><td style="text-align:right;color:#0ecfbe;font-size:16px;font-weight:700;padding-top:12px;border-top:1px solid rgba(255,255,255,.07)">${cur}${order.total}</td></tr>
          </table>
          <p style="color:rgba(255,255,255,.55);font-size:14px;margin:24px 0 0;">You earned <strong style="color:#f5b942">⭐ ${order.pointsEarned} loyalty points</strong>!</p>
        </td></tr>
        <tr><td style="padding:20px 40px;border-top:1px solid rgba(255,255,255,.07);"><p style="color:rgba(255,255,255,.2);font-size:11px;margin:0;font-family:monospace">© 2025 LocalHub</p></td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export async function sendVerificationEmail(user, token) {
  const url = `${APP_URL}/api/auth/verify-email?token=${token}`;
  return send({
    to: user.email,
    subject: "Verify your LocalHub email address",
    html: verificationTemplate(user.name, url),
    text: `Hi ${user.name}, verify your email: ${url}`,
  });
}

export async function sendWelcomeEmail(user) {
  return send({
    to: user.email,
    subject: "Welcome to LocalHub 🎉",
    html: welcomeTemplate(user.name),
    text: `Welcome, ${user.name}! Your LocalHub account is ready. Visit: ${APP_URL}/app`,
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
