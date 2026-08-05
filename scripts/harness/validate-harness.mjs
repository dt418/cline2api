const ALLOWED_STATUSES = new Set(["not_started", "in_progress", "blocked", "passing"]);

export function validateFeatureList(payload) {
  const errors = [];

  if (!payload || typeof payload !== "object") {
    return { valid: false, errors: ["feature list must be an object"] };
  }

  if (payload.version !== 1) {
    errors.push("feature list version must be 1");
  }

  if (!Array.isArray(payload.features)) {
    errors.push("features must be an array");
    return { valid: false, errors };
  }

  const ids = new Set();
  let inProgressCount = 0;

  for (const feature of payload.features) {
    const id = typeof feature?.id === "string" ? feature.id.trim() : "";
    const status = typeof feature?.status === "string" ? feature.status : "";

    if (!id) {
      errors.push("feature ids are required");
    } else if (ids.has(id)) {
      errors.push(`${id}: duplicate feature id`);
    } else {
      ids.add(id);
    }

    if (!ALLOWED_STATUSES.has(status)) {
      errors.push(`${id || "feature"}: invalid status`);
    }

    if (status === "in_progress") {
      inProgressCount += 1;
    }

    if (
      status === "passing" &&
      (typeof feature.evidence !== "string" || !feature.evidence.trim())
    ) {
      errors.push(`${id || "feature"}: passing features require evidence`);
    }
  }

  if (inProgressCount > 1) {
    errors.push("only one feature may be in_progress");
  }

  return { valid: errors.length === 0, errors };
}
