import type { SkillsShInstall } from "./ai-config";

export type PiResourceKind = "extension" | "skill";
export type PiResourceSourceKind =
  | "package"
  | "local"
  | "terminal"
  | "skills-sh";

export interface PiResourceDiagnostic {
  type: "info" | "warning" | "error";
  message: string;
  path?: string;
}

export interface PiPackageResourceSummary {
  extensions: number;
  skills: number;
}

export interface PiPackageResource {
  source: string;
  enabled: boolean;
  installed: boolean;
  installedPath?: string;
  version?: string;
  resources: PiPackageResourceSummary;
  diagnostics: PiResourceDiagnostic[];
}

export interface PiExtensionResource {
  id: string;
  kind: "extension";
  name: string;
  path: string;
  source: string;
  sourceKind: PiResourceSourceKind;
  packageSource?: string;
  packageInstalledPath?: string;
  version?: string;
  enabled: boolean;
  diagnostics: PiResourceDiagnostic[];
}

export interface PiSkillResource {
  id: string;
  kind: "skill";
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  source: string;
  sourceKind: PiResourceSourceKind;
  packageSource?: string;
  packageInstalledPath?: string;
  version?: string;
  enabled: boolean;
  /** null means available to every context profile. */
  profileIds: string[] | null;
  diagnostics: PiResourceDiagnostic[];
}

export interface PiResourcePathSummary {
  path: string;
  kind: PiResourceKind;
  sourceKind: PiResourceSourceKind;
  enabled: boolean;
  resourceCount: number;
  diagnostics: PiResourceDiagnostic[];
}

export interface PiResourcesSnapshot {
  packages: PiPackageResource[];
  extensions: PiExtensionResource[];
  skills: PiSkillResource[];
  paths: PiResourcePathSummary[];
  diagnostics: PiResourceDiagnostic[];
  skillsShInstalls: SkillsShInstall[];
  generatedAt: number;
}

export type PiResourceProgressAction =
  | "install"
  | "remove"
  | "update"
  | "clone"
  | "pull";

export interface PiResourceProgressEvent {
  type: "start" | "progress" | "complete" | "error";
  action: PiResourceProgressAction;
  source: string;
  message?: string;
}

export interface PiExtensionCatalogItem {
  name: string;
  source: string;
  description: string;
  author?: string;
  version?: string;
  downloads: number;
  packageUrl: string;
  npmUrl?: string;
  repositoryUrl?: string;
}

export interface PiPackagePreview {
  source: string;
  name: string;
  version?: string;
  description?: string;
  author?: string;
  license?: string;
  homepage?: string;
  repositoryUrl?: string;
  extensions: string[];
  skills: string[];
}

export interface SkillsShCatalogItem {
  id: string;
  name: string;
  source: string;
  installs: number;
  installsLabel: string;
  url: string;
}

export interface SkillsShListResult {
  source: string;
  skills: Array<{ name: string; description?: string }>;
  output: string;
  stderr?: string;
}

export interface SkillsShCommandResult {
  installId?: string;
  root?: string;
  skillPath?: string;
  stdout: string;
  stderr: string;
}
