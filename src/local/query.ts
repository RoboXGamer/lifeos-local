import { createMemo, createSignal, type Accessor } from "solid-js";

export type MaybeAccessor<T> = T | (() => T);

/** Args are usually a plain object, but call sites pass accessors to stay reactive. */
export function resolveValue<T>(value: MaybeAccessor<T>): T {
  return typeof value === "function" ? (value as () => T)() : value;
}

export interface CreateQueryOptions<T> {
  initialValue?: T;
}

/**
 * A synchronous, reactive read over the local store.
 *
 * The web app's `createQuery(fn, args, {initialValue})` was a thin skin over
 * Convex's async query adapter. Locally the whole database already lives in a
 * reactive store, so the same call shape becomes a memo: it re-runs whenever the
 * store (or the args accessor) changes, and never suspends.
 */
export function createQuery<A, R>(
  read: (args: A) => R,
  args: MaybeAccessor<A | "skip">,
  options?: CreateQueryOptions<R>,
): Accessor<R | undefined> {
  return createMemo(() => {
    const resolved = resolveValue(args);
    if (resolved === "skip") return options?.initialValue;
    return read(resolved as A);
  });
}

export interface LocalMutation<Args extends unknown[], R> {
  (...args: Args): Promise<R>;
  pending: Accessor<boolean>;
}

/**
 * Mutation helper: tracks in-flight calls and normalises thrown values.
 * Every `api.*` mutation writes SQLite and then reloads the store.
 */
export function createMutation<Args extends unknown[], R>(
  run: (...args: Args) => Promise<R>,
): LocalMutation<Args, R> {
  const [pending, setPending] = createSignal(0);
  const call = (...args: Args): Promise<R> => {
    setPending((count) => count + 1);
    return run(...args).finally(() => setPending((count) => count - 1));
  };
  return Object.assign(call, { pending: () => pending() > 0 });
}

export function toError(reason: unknown): Error {
  if (reason instanceof Error) return reason;
  if (typeof reason === "string") return new Error(reason);
  return new Error("Something went wrong.");
}

/**
 * Local app: the database is a file on disk, not a socket.
 * Always report "connected" so offline banners never appear.
 */
export function createConnectionState() {
  return () => ({ isWebSocketConnected: true, hasEverConnected: true });
}
