
import type { Database } from '@/integrations/supabase/types';

// Re-export types from Supabase
export type DbTables = Database['public']['Tables'];

// Access request types
export type AccessRequest = DbTables['access_requests']['Row'];
export type NewAccessRequest = DbTables['access_requests']['Insert'];

// Project types
export type Project = DbTables['projects']['Row'];
export type NewProject = DbTables['projects']['Insert'];

// Image types
export type Image = DbTables['images']['Row'];
export type NewImage = DbTables['images']['Insert'];

// Profile types
export type Profile = DbTables['profiles']['Row'];
export type UpdateProfile = DbTables['profiles']['Update'];

// Segmentation types (can be extended as needed)
export interface PolygonData {
  id: string;
  points: Array<{x: number, y: number}>;
  type: string;
  class: string;
}

export interface SegmentationData {
  polygons: PolygonData[];
  imageSrc?: string;
  imageWidth?: number;
  imageHeight?: number;
}

// ProjectImage type for use across components
export interface ProjectImage {
  id: string;
  name: string;
  url: string;
  createdAt: Date;
  updatedAt: Date;
  segmentationStatus: 'pending' | 'processing' | 'completed' | 'failed';
  segmentationResult?: SegmentationData;
}
