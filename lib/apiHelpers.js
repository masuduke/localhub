export function ok(res, data, status = 200) {
  return res.status(status).json({ success: true, data });
}

export function err(res, message, status = 400, details = null) {
  return res.status(status).json({ success: false, error: message, ...(details && { details }) });
}

export function methodNotAllowed(res, allowed = ["GET", "POST"]) {
  res.setHeader("Allow", allowed);
  return err(res, "Method not allowed", 405);
}

export function paginate(query, { page = 1, limit = 20 } = {}) {
  const take = Math.min(Number(limit), 100);
  const skip = (Math.max(Number(page), 1) - 1) * take;
  return { ...query, take, skip };
}
