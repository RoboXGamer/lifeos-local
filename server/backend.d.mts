import type { DbState } from '../src/local/store';
export function initialize(): Promise<void>;
export function snapshot(): Promise<DbState>;
export function query(name: string, args: any): Promise<any>;
type Update = { epoch: string; revision: number; state: DbState };
export function mutate(name: string, args: unknown): Promise<Update & { result: unknown }>;
export function watch(signal?: AbortSignal): AsyncGenerator<Update>;
