export interface SourceSnapshot {
  id: string;
  path: string;
  kind: 'documentation' | 'configuration' | 'test' | 'implementation';
  sha256: string;
  bytes: number;
  lineCount: number;
  content: string;
}

export interface SourceBundle {
  schemaVersion: 1;
  bundleId: string;
  projectName: string;
  root: string;
  createdAt: string;
  git: { commit: string | null; dirty: boolean | null } | null;
  scope: {
    discovery: 'git' | 'directory';
    selection: 'automatic' | 'explicit';
    inventoryCount: number;
    maxFiles: number;
    maxTotalBytes: number;
    maxFileBytes: number;
  };
  sources: SourceSnapshot[];
  omitted: { path: string; reason: string }[];
}

export interface CollectOptions {
  include?: string[];
  maxFiles?: number;
  maxTotalBytes?: number;
  maxFileBytes?: number;
}

export interface DshReadiness {
  runtime: 'dsh';
  status: 'not-executed';
  checks: {
    id: string;
    status: 'observed' | 'not-observed' | 'unverified';
    description: string;
    sources: string[];
  }[];
}
