import { FileBrowserRoot } from "./file-browser-root";
import { FileBrowserTabs } from "./file-browser-tabs";
import { FileBrowserExplorer } from "./file-browser-explorer";
import { FileBrowserChanges } from "./file-browser-changes";

interface FileBrowserComponent {
  Root: typeof FileBrowserRoot;
  Tabs: typeof FileBrowserTabs;
  Explorer: typeof FileBrowserExplorer;
  Changes: typeof FileBrowserChanges;
}

export const FileBrowser: FileBrowserComponent = {
  Root: FileBrowserRoot,
  Tabs: FileBrowserTabs,
  Explorer: FileBrowserExplorer,
  Changes: FileBrowserChanges,
} as const;

export { useFileBrowserContext } from "./file-browser-context";
export type { FileBrowserContextValue, FileBrowserSubView } from "./file-browser-context";
