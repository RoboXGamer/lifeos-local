import { z } from "zod";

export type IconName =
  | "inbox"
  | "grid"
  | "calendar"
  | "tag"
  | "chart"
  | "settings"
  | "edit"
  | "graduation"
  | "cart"
  | "bulb"
  | "monitor"
  | "book"
  | "dumbbell"
  | "plane"
  | "checkSquare"
  | "briefcase"
  | "folder"
  | "user"
  | "heart"
  | "heartPulse"
  | "leaf"
  | "mountain"
  | "search"
  | "filter"
  | "share"
  | "users"
  | "star"
  | "flag"
  | "clock"
  | "chevronDown"
  | "chevronRight"
  | "archive"
  | "trash"
  | "currency"
  | "expense"
  | "payment"
  | "description"
  | "more"
  | "list"
  | "plus"
  | "command"
  | "sparkle"
  | "close";

const timestampSchema = z.iso.datetime();

export const waitlistEntrySchema = z.object({
  name: z.string().trim().min(2, "Please enter your name.").max(80),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Please enter a valid email address."),
  createdAt: timestampSchema,
});
