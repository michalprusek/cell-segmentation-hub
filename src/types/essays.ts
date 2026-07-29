/** A single Automated Essays run (batch microtubule assay of a .nd2 folder). */
export interface EssayJob {
  id: string;
  name: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  progress: number;
  fileCount: number;
  mtCount: number;
  /**
   * What the worker ran on, plus why if it wanted the GPU and did not get it.
   * `cpu-degraded` = the GPU broke, worth telling an admin. `cpu-busy` = the
   * shared card never freed up, nothing to act on. Plain `cpu` = this host has
   * no GPU. See coerceDevice() in backend/src/services/essaysService.ts.
   */
  device?: 'cuda' | 'cpu' | 'cpu-degraded' | 'cpu-busy' | null;
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
