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
  /**
   * Whether the uploaded .nd2 files are still on the server, so the run can be
   * repeated without uploading them again.
   *
   * Answered by the backend from the DISK, not derived from `status`: the input
   * is only kept for a run that did not finish cleanly, and even then only for a
   * retention window. A button driven by status alone would offer a re-run that
   * fails the moment it is clicked.
   */
  canRerun?: boolean;
}

/** Optional module options the user can tune before running. */
export interface EssayJobOptions {
  threshold?: number;
  mtWidth?: number;
  /**
   * Background-ring reach as a multiple of mtWidth (2 = out to 10 px for a
   * 5 px band). Mirrors `margin_multiplier` in the shared measurement
   * (backend/segmentation/models/mt_measure.py), which the project export
   * uses too. Replaced bgGap/bgWidth on 2026-08-13 along with the
   * gap-plus-width ring they described.
   */
  bgMargin?: number;
  /**
   * Substring naming the channel each role uses. Separate flags because the
   * module segments IRM and measures intensities on TIRF; see EssayJobOptions
   * in backend/src/services/essaysService.ts.
   */
  irmName?: string;
  tirfName?: string;
  solutionName?: string;
  limitWells?: number;
  noOverlays?: boolean;
  noJson?: boolean;
}
