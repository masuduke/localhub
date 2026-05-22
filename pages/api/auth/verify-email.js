import { prisma } from "../../../lib/prisma";

export default async function handler(req, res) {
  const { token } = req.query;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;

  if (!token) return res.redirect(`${appUrl}?verify=invalid`);

  const record = await prisma.platformConfig.findUnique({ where: { key: `verify:${token}` } });
  if (!record) return res.redirect(`${appUrl}?verify=invalid`);

  const { userId, expires } = JSON.parse(record.value);
  if (new Date(expires) < new Date()) {
    await prisma.platformConfig.delete({ where: { key: `verify:${token}` } }).catch(() => {});
    return res.redirect(`${appUrl}?verify=expired`);
  }

  await Promise.all([
    prisma.user.update({ where: { id: userId }, data: { isEmailVerified: true } }),
    prisma.platformConfig.delete({ where: { key: `verify:${token}` } }),
  ]);

  return res.redirect(`${appUrl}?verify=success`);
}
