export type PlatformKey = 'instagram' | 'facebook' | 'pinterest' | 'tiktok' | 'youtube';

export interface DriveFolder {
  id: string;
  name: string;
  modifiedTime?: string;
}

export interface DriveVideo {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  createdTime?: string;
  modifiedTime?: string;
  webViewLink?: string;
  thumbUrl?: string;
  durationMillis?: number;
  width?: number;
  height?: number;
}

export interface InstagramPost {
  caption: string;
  hashtags: string[];
  coverHeadline: string;
  bestTimeHint: string;
  formatNote: string;
}

export interface FacebookPost {
  headline: string;
  postText: string;
  engagementQuestion: string;
  hashtags: string[];
  bestTimeHint: string;
}

export interface PinterestPost {
  pinTitle: string;
  pinDescription: string;
  suggestedBoard: string;
  destinationLink?: string;
  keywords: string[];
  altText: string;
}

export interface TikTokPost {
  caption: string;
  onScreenHook: string;
  hashtags: string[];
  soundOrPacingTip: string;
}

export interface YouTubeShortPost {
  title: string;
  description: string;
  tags: string[];
  hashtags: string[];
  pinnedComment: string;
  privacyStatus: 'public' | 'unlisted' | 'private';
}

export interface GeneratedSocialPosts {
  detectedTopic: string;
  hookAngle: string;
  appStoreUrl?: string;
  analysisMode: 'full_video' | 'frame_and_metadata';
  generatedAt: string;
  instagram: InstagramPost;
  facebook: FacebookPost;
  pinterest: PinterestPost;
  tiktok: TikTokPost;
  youtube: YouTubeShortPost;
}

export interface GenerationSettings {
  language: 'English' | 'Moroccan Darija' | 'French' | 'Arabic' | 'Spanish';
  tone: 'Energetic & Viral' | 'Storytelling & Warm' | 'Educational & Clear' | 'Luxury & Editorial';
  brandHandle: string;
  callToAction: string;
  targetAudience: string;
  appStoreUrl: string;
  appName: string;
  analysisDepth: 'fast' | 'deep';
}

export interface PublishingChannelsConfig {
  mode: 'webhook' | 'direct';
  unifiedWebhookUrl: string;
  webhookSecretHeader: string;
  platformWebhooks: Record<PlatformKey, string>;
  direct: {
    metaAccessToken: string;
    instagramAccountId: string;
    facebookPageId: string;
    pinterestAccessToken: string;
    pinterestBoardId: string;
    tiktokAccessToken: string;
    youtubeAccessToken: string;
  };
}

export interface PlatformDeliveryResult {
  platform: PlatformKey;
  status: 'delivered' | 'failed' | 'unconfigured';
  method: 'webhook' | 'direct_api' | 'none';
  httpStatus?: number;
  externalId?: string;
  message: string;
  deliveredAt: string;
}

export interface DeliveryLogEntry {
  id: string;
  folderId?: string;
  folderName?: string;
  videoId: string;
  videoName: string;
  triggeredBy: 'manual' | 'auto_watch';
  timestamp: string;
  results: PlatformDeliveryResult[];
}

export type VideoWorkflowStatus =
  | 'unprocessed'
  | 'generating'
  | 'ready'
  | 'delivering'
  | 'delivered'
  | 'partial'
  | 'error';

export interface VideoQueueItem {
  video: DriveVideo;
  status: VideoWorkflowStatus;
  posts?: GeneratedSocialPosts;
  selectedPlatforms: Record<PlatformKey, boolean>;
  lastDelivery?: PlatformDeliveryResult[];
  errorMessage?: string;
}

export interface SavedFolderLookup {
  id: string;
  ownerId: string;
  folderId: string;
  folderName: string;
  videoCount: number;
  savedPostCount: number;
  language: string;
  appName: string;
  appStoreUrl: string;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface SavedVideoPostRecord {
  id: string;
  ownerId: string;
  lookupId: string;
  folderId: string;
  folderName: string;
  video: DriveVideo;
  posts: GeneratedSocialPosts;
  postStatus: 'unprocessed' | 'ready';
  hasPosts: boolean;
  language: string;
  createdAtMs: number;
  updatedAtMs: number;
}

