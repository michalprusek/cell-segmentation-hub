/** A single Automated Essays run (batch microtubule assay of a .nd2 folder). */
export interface EssayJob {
  id: string;
  name: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  progress: number;
  fileCount: number;
  mtCount: number;
  device?: string | null;
  resultZipKey?: string | null;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
}

/** Optional module options the user can tune before running. */
export interface EssayJobOptions {
  threshold?: number;
  mtWidth?: number;
  bgGap?: number;
  bgWidth?: number;
  tirfName?: string;
  solutionName?: string;
  limitWells?: number;
  noOverlays?: boolean;
  noJson?: boolean;
}
