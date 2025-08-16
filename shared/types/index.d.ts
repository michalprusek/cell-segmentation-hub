/**
 * Sdílené typy mezi frontend a backend
 */
export interface User {
    id: string;
    email: string;
    emailVerified: boolean;
    createdAt: Date;
    updatedAt: Date;
    profile?: UserProfile;
}
export interface UserProfile {
    id: string;
    userId: string;
    username?: string;
    avatarUrl?: string;
    preferredModel: string;
    modelThreshold: number;
    preferredLang: string;
    preferredTheme: string;
    bio?: string;
}
export interface LoginRequest {
    email: string;
    password: string;
}
export interface RegisterRequest {
    email: string;
    password: string;
    username?: string;
}
export interface AuthResponse {
    user: User;
    accessToken: string;
    refreshToken: string;
}
export interface ResetPasswordRequest {
    email: string;
}
export interface ConfirmResetPasswordRequest {
    token: string;
    password: string;
}
export interface Project {
    id: string;
    title: string;
    description?: string;
    userId: string;
    createdAt: Date;
    updatedAt: Date;
    imageCount?: number;
    thumbnail?: string;
}
export interface CreateProjectRequest {
    title: string;
    description?: string;
}
export interface UpdateProjectRequest {
    title?: string;
    description?: string;
}
export interface ProjectImage {
    id: string;
    name: string;
    originalPath: string;
    thumbnailPath?: string;
    projectId: string;
    segmentationStatus: 'pending' | 'processing' | 'completed' | 'failed';
    createdAt: Date;
    updatedAt: Date;
    segmentation?: Segmentation;
    url?: string;
    thumbnailUrl?: string;
}
export interface Point {
    x: number;
    y: number;
}
export interface PolygonData {
    id: string;
    points: Point[];
    type: 'external' | 'internal';
    class: string;
}
export interface Segmentation {
    id: string;
    imageId: string;
    polygons: PolygonData[];
    model: string;
    threshold: number;
    createdAt: Date;
    updatedAt: Date;
    metrics?: SpheroidMetric[];
}
export interface SegmentationRequest {
    imageId: string;
    model?: string;
    threshold?: number;
}
export interface SpheroidMetric {
    imageId: string;
    imageName: string;
    contourNumber: number;
    area: number;
    perimeter: number;
    circularity: number;
    compactness: number;
    convexity: number;
    equivalentDiameter: number;
    aspectRatio: number;
    feretDiameterMax: number;
    feretDiameterMaxOrthogonal: number;
    feretDiameterMin: number;
    lengthMajorDiameter: number;
    lengthMinorDiameter: number;
    solidity: number;
    sphericity: number;
}
export interface ApiResponse<T = any> {
    success: boolean;
    data?: T;
    error?: string;
    message?: string;
}
export interface PaginatedResponse<T> extends ApiResponse<T[]> {
    data: T[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
    };
}
export interface ApiError {
    code: string;
    message: string;
    details?: any;
}
export interface UploadResponse {
    filename: string;
    originalName: string;
    size: number;
    mimetype: string;
    path: string;
    url: string;
}
export interface ExportRequest {
    projectId: string;
    imageIds?: string[];
    format: 'coco' | 'excel';
    includeMetrics?: boolean;
}
export interface CocoExport {
    info: {
        description: string;
        version: string;
        year: number;
        date_created: string;
    };
    licenses: any[];
    images: any[];
    annotations: any[];
    categories: any[];
}
export interface UserSettings {
    preferredModel: string;
    modelThreshold: number;
    preferredLang: string;
    preferredTheme: string;
    emailNotifications: boolean;
}
export interface UpdateSettingsRequest extends Partial<UserSettings> {
}
export declare const SEGMENTATION_MODELS: {
    readonly hrnet: {
        readonly id: "hrnet";
        readonly name: "HRNetV2";
        readonly description: "High-Resolution Network for semantic segmentation";
        readonly defaultThreshold: 0.5;
    };
    readonly resunet_advanced: {
        readonly id: "resunet_advanced";
        readonly name: "ResUNet Advanced";
        readonly description: "Advanced ResUNet with attention mechanisms";
        readonly defaultThreshold: 0.6;
    };
    readonly resunet_small: {
        readonly id: "resunet_small";
        readonly name: "ResUNet Small";
        readonly description: "Efficient ResUNet for fast segmentation";
        readonly defaultThreshold: 0.7;
    };
};
export type SegmentationModelId = keyof typeof SEGMENTATION_MODELS;
//# sourceMappingURL=index.d.ts.map