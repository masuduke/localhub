import { prisma } from "../../../lib/prisma";
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
        include: { vendor: { select: { name: true, status: true } } },
      }),
      prisma.product.count({ where }),
    ]);
    return ok(res, { products, total, page: Number(page || 1) });
  }

  if (req.method === "POST") {
    try {
      const payload = requireAuth(req);
      if (!["vendor", "admin"].includes(payload.role)) return err(res, "Forbidden", 403);
      const vendor = await prisma.vendor.findUnique({ where: { userId: payload.sub } });
      if (!vendor) return err(res, "Vendor profile not found", 404);
      const { name, price, emoji, color, category, sizes, stock, description } = req.body;
      if (!name || !price || !category) return err(res, "name, price, category required", 422);
      const product = await prisma.product.create({
        data: {
          vendorId: vendor.id,
          country: vendor.country,
          name, price: Number(price), emoji, color, category,
          sizes: Array.isArray(sizes) ? sizes : [],
          stock: Number(stock || 0),
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
