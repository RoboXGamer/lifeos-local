// Copied verbatim from the web app (convex/lib/validation.ts). Pure TS, no deps.

export function isValidUsername(value: string): boolean {
  const username = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9_]{2,29}$/.test(username);
}

export function cleanUsername(value: string): string {
  const username = value.trim().toLowerCase();
  if (!isValidUsername(username)) {
    throw new Error(
      "Username must be 3–30 lowercase letters, numbers, or _ and cannot be reserved.",
    );
  }
  return username;
}

export function cleanName(value: string, label: string, maximum = 80): string {
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length < 1 || name.length > maximum) {
    throw new Error(`${label} must be between 1 and ${maximum} characters.`);
  }
  return name;
}

export function cleanDescription(
  value: string | undefined,
): string | undefined {
  const description = value?.trim();
  if (!description) return undefined;
  if (description.length > 5000) {
    throw new Error("Description must be 5,000 characters or fewer.");
  }
  return description;
}

export function cleanColor(value: string): string {
  const color = value.trim().toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(color)) {
    throw new Error("Choose a valid six-digit color.");
  }
  return color;
}

export function cleanIcon(value: string): string {
  const icon = value.trim();
  if (!/^[a-z][a-zA-Z0-9]*$/.test(icon) || icon.length > 40) {
    throw new Error("Choose a valid Area icon.");
  }
  return icon;
}

export function cleanTitle(value: string): string {
  return cleanName(value, "Item title", 240);
}

export function cleanDueDate(
  value: string | null | undefined,
): string | undefined {
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Choose a valid due date.");
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(date.valueOf()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new Error("Choose a valid due date.");
  }
  return value;
}

export function cleanAmount(
  value: number | null | undefined,
): number | undefined {
  if (value == null) return undefined;
  if (!Number.isFinite(value) || value < 0 || value > 1_000_000_000_000) {
    throw new Error("Amount must be a positive number.");
  }
  return Math.round(value * 100) / 100;
}

export function cleanTagName(value: string): {
  name: string;
  normalizedName: string;
} {
  const name = value.trim().replace(/^#+/, "").replace(/\s+/g, " ");
  const normalizedName = name.toLowerCase();
  if (
    normalizedName.length < 1 ||
    normalizedName.length > 40 ||
    !/^[a-z0-9][a-z0-9 _-]*$/.test(normalizedName)
  ) {
    throw new Error(
      "Tags must be 1–40 characters using letters, numbers, spaces, _ or -.",
    );
  }
  return { name, normalizedName };
}
