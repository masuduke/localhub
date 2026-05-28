import { requireAuth } from "../../../lib/auth";
import { ok, err, methodNotAllowed } from "../../../lib/apiHelpers";
import { assertUploadAllowed, createR2Key, createUploadPresign, getR2PublicUrl } from "../../../lib/r2";

export default async function handler(req, res) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);

  try {
    const user = requireAuth(req);
    const { filename, contentType, contentLength, uploadType } = req.body || {};

    const folder = assertUploadAllowed({ uploadType, contentType, contentLength });
    if (folder === "product-images" && !["vendor", "admin"].includes(user.role)) {
      return err(res, "Only vendors and admins can upload product images", 403);
    }

    const key = createR2Key({ uploadType, filename, userId: user.sub });
    const uploadUrl = await createUploadPresign({ key, contentType });
    const publicUrl = getR2PublicUrl(key);

    return ok(res, { uploadUrl, publicUrl, key, expiresIn: 300 });
  } catch (e) {
    return err(res, e.message, e.status || 500);
  }
}
