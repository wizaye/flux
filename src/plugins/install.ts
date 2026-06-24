/**
 * Plugin install / uninstall orchestration. Thin wrappers around
 * the Rust IPC commands plus the post-install rescan dance:
 *
 *   1. Call Rust to install/uninstall the bundle on disk.
 *   2. Re-scan the vault to pick up the new/removed plugin.
 *   3. Update the store via `replaceExternals` so the UI snaps to
 *      the new state without a vault reload.
 *
 * Centralising the rescan here means UI components only need to
 * call one function per user gesture instead of remembering to
 * `scanPlugins() + replaceExternals(...)` after every install.
 */
import {
  installPluginFromFolder as ipcInstallFromFolder,
  installPluginFromZip as ipcInstallFromZip,
  uninstallPlugin as ipcUninstall,
  scanPlugins,
  type InstallResult,
} from "@/bindings";
import { usePluginStore } from "@/state/plugin-store";
import { buildExternalEntries } from "./external-loader";

/** Rescan the vault's plugin folder and reconcile the store's
 *  external plugin list. Pure side-effect — returns nothing
 *  because the store IS the source of truth for the UI. */
export async function refreshExternalPlugins(): Promise<void> {
  const scanned = await scanPlugins();
  usePluginStore.getState().replaceExternals(buildExternalEntries(scanned));
}

/** Install a plugin from a user-picked local folder. Used by
 *  Settings → Community plugins → "Install from folder" for plugin
 *  developers + sideloading. */
export async function installFromFolder(src: string): Promise<InstallResult> {
  const result = await ipcInstallFromFolder(src);
  await refreshExternalPlugins();
  return result;
}

/** Install a plugin from a `.zip` archive. The archive's root must
 *  contain `manifest.json` + `dist/index.js`. */
export async function installFromZip(zipPath: string): Promise<InstallResult> {
  const result = await ipcInstallFromZip(zipPath);
  await refreshExternalPlugins();
  return result;
}

/** Uninstall a plugin by id. */
export async function uninstall(id: string): Promise<void> {
  await ipcUninstall(id);
  await refreshExternalPlugins();
}
