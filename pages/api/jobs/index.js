import { prisma } from "../../../lib/prisma";
import { requireAuth } from "../../../lib/auth";
import { ok, err, methodNotAllowed, paginate } from "../../../lib/apiHelpers";

export default async function handler(req, res) {
  if (req.method === "GET") {
    const { country, categoryId, search, urgent, page, limit } = req.query;
    const where = {
      isActive: true,
      expiresAt: { gt: new Date() },
      ...(country && { country }),
      ...(categoryId && { categoryId: Number(categoryId) }),
      ...(urgent && { isUrgent: urgent === "true" }),
      ...(search && { OR: [{ title: { contains: search, mode: "insensitive" } }, { company: { contains: search, mode: "insensitive" } }] }),
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
      const expiresAt = new Date(Date.now() + Number(weeks) * 7 * 24 * 60 * 60 * 1000);
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
