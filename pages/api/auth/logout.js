import { revokeAllTokens, clearRefreshCookie, requireAuth } from "../../../lib/auth";
import { ok, methodNotAllowed } from "../../../lib/apiHelpers";

export default async function handler(req, res) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
  try {
    const payload = requireAuth(req);
    await revokeAllTokens(payload.sub);
  } catch (_) {}
  clearRefreshCookie(res);
  return ok(res, { message: "Logged out" });
}
