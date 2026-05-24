import { ok, err, methodNotAllowed } from "../../../lib/apiHelpers";

export default async function handler(req, res) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
  try {
    const { imageDataUrl, product, country } = req.body || {};
    if (!imageDataUrl || !product?.name) return err(res, "imageDataUrl and product are required", 422);

    const modelUrl = process.env.TRYON_MODEL_URL;
    if (!modelUrl) {
      return ok(res, {
        resultImageDataUrl: null,
        source: "fallback",
        message: "TRYON_MODEL_URL not configured; use local simulation preview.",
      });
    }

    const upstream = await fetch(modelUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageDataUrl, product, country }),
    });
    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) return err(res, data?.error || "Try-on model endpoint failed", upstream.status);
    if (!data?.resultImageDataUrl) return err(res, "Model endpoint did not return resultImageDataUrl", 502);

    return ok(res, {
      resultImageDataUrl: data.resultImageDataUrl,
      source: "model",
    });
  } catch (e) {
    return err(res, e.message || "Try-on generation error", 500);
  }
}

