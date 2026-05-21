// pages/api/auth/refresh.js
import { rotateRefreshToken, setRefreshCookie } from "../../../lib/auth";
import { ok, err, methodNotAllowed } from "../../../lib/apiHelpers";

export default async function handler(req, res) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
  const cookies = req.headers.cookie || "";
  const match = cookies.match(/refreshToken=([^;]+)/);
  const token = match?.[1];
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
