/** Build a plain JSON request without losing nulls or silently changing array values. */
export function toTransportValue(value: unknown): unknown {
  const ancestors = new WeakSet<object>();
  const visit = (current: unknown, path: string, inObject: boolean): unknown => {
    if (current === undefined) {
      if (inObject) return undefined;
      throw new Error(`Unsupported undefined value at ${path}.`);
    }
    if (current === null || typeof current === "string" || typeof current === "boolean") return current;
    if (typeof current === "number") {
      if (!Number.isFinite(current) || Object.is(current, -0)) throw new Error(`Unsupported number at ${path}.`);
      return current;
    }
    if (typeof current !== "object") throw new Error(`Unsupported value at ${path}.`);
    if (ancestors.has(current)) throw new Error(`Circular value at ${path}.`);
    const proto = Object.getPrototypeOf(current);
    if (!Array.isArray(current) && proto !== Object.prototype && proto !== null) throw new Error(`Unsupported object at ${path}.`);
    ancestors.add(current);
    try {
      if (Array.isArray(current)) {
        const result: unknown[] = [];
        for (let i = 0; i < current.length; i++) {
          if (!Object.hasOwn(current, i)) throw new Error(`Missing array element at ${path}[${i}].`);
          result.push(visit(current[i], `${path}[${i}]`, false));
        }
        return result;
      }
      const result: Record<string, unknown> = Object.create(null);
      for (const key of Object.keys(current)) {
        const next = visit((current as Record<string, unknown>)[key], `${path}.${key}`, true);
        if (next !== undefined) result[key] = next;
      }
      return result;
    } finally { ancestors.delete(current); }
  };
  return visit(value, "arguments", false);
}
