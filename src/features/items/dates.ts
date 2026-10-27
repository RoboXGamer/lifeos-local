export function localDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function dateFromKey(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function longDateLabel(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(dateFromKey(value));
}

export function compactDateLabel(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(dateFromKey(value));
}

export function monthRange(date: Date): {
  fromDate: string;
  toDate: string;
} {
  return {
    fromDate: localDateKey(new Date(date.getFullYear(), date.getMonth(), 1)),
    toDate: localDateKey(new Date(date.getFullYear(), date.getMonth() + 1, 0)),
  };
}
