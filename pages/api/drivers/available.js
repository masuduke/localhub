import { prisma } from "../../../lib/prisma";
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
    where: { country, isOnline: true, status: "active" },
    include: { user: { select: { name: true, avatar: true } } },
  });

  const quoted = drivers
    .filter((d) => d.lastLat && d.lastLng && d.pricingMaxDist >= distance)
    .map((d) => {
      const quote = +(Math.max(d.pricingMin, d.pricingBase + distance * d.pricingPerUnit) * parcelMult).toFixed(2);
      const eta = Math.round((distance / (country === "uk" ? 12 : 19)) * 60 + 4);
      return {
        id: d.id, name: d.user.name, avatar: d.user.avatar,
        vehicle: d.vehicle, rating: d.rating, totalTrips: d.totalTrips,
        quote, eta, distance,
      };
    })
    .sort((a, b) => a.quote - b.quote)
    .slice(0, 5);

  return ok(res, { drivers: quoted, distance, unit: country === "uk" ? "miles" : "km" });
}
