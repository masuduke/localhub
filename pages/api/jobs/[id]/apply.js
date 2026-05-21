import { prisma } from "../../../../lib/prisma";
import { requireAuth } from "../../../../lib/auth";
import { ok, err, methodNotAllowed } from "../../../../lib/apiHelpers";

export default async function handler(req, res) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
  try {
    const payload = requireAuth(req);
    const { id } = req.query;
    const { name, email, coverLetter, cvUrl } = req.body;
    const job = await prisma.job.findUnique({ where: { id } });
    if (!job || !job.isActive) return err(res, "Job not found or closed", 404);
    const application = await prisma.jobApplication.upsert({
      where: { jobId_applicantId: { jobId: id, applicantId: payload.sub } },
      create: { jobId: id, applicantId: payload.sub, name, email, coverLetter, cvUrl },
      update: { name, email, coverLetter, cvUrl },
    });
    return ok(res, { application }, 201);
  } catch (e) {
    return err(res, e.message, e.status || 400);
  }
}
