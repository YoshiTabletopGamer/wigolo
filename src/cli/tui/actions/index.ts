/**
 * Actions layer — public API for the headless surface and the SettingsHome
 * action screens.
 *
 * Every export here is a pure-ish async function with no Ink/React dependency.
 * Components call these functions and render the returned state; all business
 * logic lives here so it can be tested headlessly and reused by the plain CLI.
 *
 * Exported actions:
 *   detectSystem       — system requirements check
 *   writeMcpConfig     — write MCP config entries with per-item results
 *   storeProviderKey   — store a provider API key securely
 *   readProviderKey    — read masked provider key + location
 *   deleteProviderKey  — delete a stored provider key
 *   listConfiguredProviders — list providers with stored keys
 *   maskValue          — mask a key value for display
 *   PICKER_PROVIDERS   — ordered provider list for TUI picker
 *   verifyEndToEnd     — end-to-end capability smoke + MCP-wiring check
 *   computeStorage     — per-component storage sizes + hogs sorted desc
 *   getCacheStatsAction — entry counts + size via public cache API
 *   cleanupComponent   — remove targeted component's files, report freed bytes
 *   exportConfig       — serialize settings to a portable file (secrets excluded)
 *   importConfig       — validate + apply a config export file
 *   uninstall          — remove data dir + unwire agent MCP configs
 */

export { detectSystem } from './detect-system.js';
export type { SystemInfo } from './detect-system.js';

export { writeMcpConfig } from './write-config.js';
export type { WriteMcpConfigOptions, WriteMcpConfigResult } from './write-config.js';

export { applyHeadlessSet } from './headless-set.js';
export type {
  ApplyHeadlessSetOpts,
  HeadlessSetResult,
  HeadlessSetStatus,
} from './headless-set.js';

export type { WriteResult, WriteStatus } from './types.js';

// SP4: provider key management
export {
  storeProviderKey,
  readProviderKey,
  deleteProviderKey,
  listConfiguredProviders,
  saveProviderSelection,
  maskValue,
  PICKER_PROVIDERS,
} from './provider-keys.js';
export type {
  StoreKeyResult,
  ReadKeyResult as ProviderKeyReadResult,
  DeleteKeyResult,
  ProviderListEntry,
  ProviderKeyOpts,
  PickableProvider,
  SaveProviderResult,
} from './provider-keys.js';

// SP6: end-to-end verification
export { verifyEndToEnd, buildDefaultDeps, formatVerifyResultPlain, checkMcpWiringForAgent } from './verify-e2e.js';
export type {
  CapabilityName,
  CapabilityStatus,
  CapabilityResult,
  McpWiringResult,
  VerifyEndToEndResult,
  VerifyEndToEndDeps,
  McpWiringCheckInput,
} from './verify-e2e.js';

// SP5: storage dashboard + config export/import + uninstall
export { computeStorage } from './compute-storage.js';
export type { StorageResult, ComponentStorageItem } from './compute-storage.js';

export { getCacheStatsAction } from './cache-stats.js';
export type { CacheStatsResult } from './cache-stats.js';

export { cleanupComponent } from './cleanup.js';
export type { CleanupResult, CleanableComponentId } from './cleanup.js';

export { exportConfig, importConfig } from './export-import-config.js';
export type { ExportConfigResult, ImportConfigResult } from './export-import-config.js';

export { uninstall } from './uninstall.js';
export type { UninstallResult, UninstallOptions, AgentUninstallResult } from './uninstall.js';
