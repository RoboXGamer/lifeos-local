import { getRequestEvent } from '@solidjs/web';
import { live } from '@solidjs/web/server-functions';
import type { DbState } from './store';

export type StateUpdate = { epoch: string; revision: number; state: DbState };

export const watchState = live(async function* (): AsyncGenerator<StateUpdate> {
  'use server';
  const backend = await import('../../server/backend.mjs');
  yield* backend.watch(getRequestEvent()?.request.signal);
});

export async function callMutation(name: string, args: unknown): Promise<StateUpdate & { result: unknown }> {
  'use server';
  const backend = await import('../../server/backend.mjs');
  return backend.mutate(name, args);
}

export async function getStartupStatus(): Promise<import('../../server/startup.mjs').StartupStatus> {
  'use server';
  const startup = await import('../../server/startup.mjs');
  return startup.startupStatus();
}

export async function configureStartup(enabled: boolean): Promise<import('../../server/startup.mjs').StartupStatus> {
  'use server';
  const startup = await import('../../server/startup.mjs');
  return startup.configureStartup(enabled);
}
