export interface StartupStatus { available: boolean; enabled: boolean; reason?: string }
export interface StartupOptions { platform?: string; executable?: string; startupDirectory?: string; appData?: string }
export function startupStatus(options?: StartupOptions): StartupStatus;
export function configureStartup(enabled: boolean, options?: StartupOptions): StartupStatus;
