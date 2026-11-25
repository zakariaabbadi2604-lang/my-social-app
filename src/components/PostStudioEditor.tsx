import React, { useState } from 'react';
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Film,
  Loader2,
  RefreshCw,
  Send,
  Sparkles,
} from 'lucide-react';
import {
  exportPostsAsExcel,
  exportPostsAsPdf,
  exportPostsAsTxt,
} from '../lib/exportPosts';
import type { GeneratedSocialPosts, PlatformKey, VideoQueueItem } from '../types';

interface PostStudioEditorProps {
  item: VideoQueueItem;
  folderName?: string;
  onGeneratePosts: (videoId: string) => Promise<void>;
  onUpdatePosts: (videoId: string, updated: GeneratedSocialPosts) => void;
  onTogglePlatform: (videoId: string, platform: PlatformKey) => void;
  onDeliverVideo: (videoId: string) => Promise<void>;
  onOpenChannels: () => void;
}

const PLATFORMS: Array<{ key: PlatformKey; label: string; limit: number }> = [
  { key: 'instagram', label: 'Instagram', limit: 2200 },
  { key: 'facebook', label: 'Facebook', limit: 63206 },
  { key: 'pinterest', label: 'Pinterest', limit: 500 },
  { key: 'tiktok', label: 'TikTok', limit: 2200 },
  { key: 'youtube', label: 'YouTube Shorts', limit: 5000 },
];

export function formatDuration(ms?: number): string {
  if (!ms || ms <= 0) return 'Unknown length';
  const totalSec = Math.round(ms / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '—';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

export const PostStudioEditor: React.FC<PostStudioEditorProps> = ({
  item,
  folderName = 'Google Drive Folder',
  onGeneratePosts,
  onUpdatePosts,
  onTogglePlatform,
  onDeliverVideo,
  onOpenChannels,
}) => {
  const [activeTab, setActiveTab] = useState<PlatformKey>('instagram');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [thumbError, setThumbError] = useState(false);

  const { video, posts, status, selectedPlatforms, lastDelivery, errorMessage } = item;
  const isBusy = status === 'generating' || status === 'delivering';

  const copyText = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1800);
    } catch {
      // Clipboard fallback ignored
    }
  };

  const selectedCount = Object.values(selectedPlatforms).filter(Boolean).length;

  const updateHashtags = (platform: 'instagram' | 'facebook' | 'tiktok', raw: string) => {
    if (!posts) return;
    const tags = raw
      .split(/[\s,]+/)
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => (t.startsWith('#') ? t : `#${t}`));
    onUpdatePosts(video.id, {
      ...posts,
      [platform]: {
        ...posts[platform],
        hashtags: tags,
      },
    });
  };

  const currentYouTube = posts?.youtube || {
    title: '',
    description: '',
    tags: [],
    hashtags: ['#Shorts'],
    pinnedComment: '',
    privacyStatus: 'public' as const,
  };

  const updateYouTube = (patch: Partial<typeof currentYouTube>) => {
    if (!posts) return;
    onUpdatePosts(video.id, {
      ...posts,
      youtube: {
        ...currentYouTube,
        ...patch,
      },
    });
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-start">
      {/* Left column: Video details + delivery control */}
      <div className="min-w-0 space-y-4 lg:col-span-4">
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="relative aspect-video w-full bg-slate-900">
            {video.thumbUrl && !thumbError ? (
              <img
                src={video.thumbUrl}
                alt={video.name}
                referrerPolicy="no-referrer"
                onError={() => setThumbError(true)}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-slate-800 to-slate-950 text-slate-400">
                <Film className="h-9 w-9 text-slate-500" />
                <span className="mt-2 max-w-[80%] truncate text-xs text-slate-400">{video.name}</span>
              </div>
            )}
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-4 py-3">
              <p className="truncate text-sm font-semibold text-white">{video.name}</p>
              <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-200 tabular-nums">
                <span>{formatDuration(video.durationMillis)}</span>
                <span aria-hidden="true">·</span>
                <span>{video.width && video.height ? `${video.width}×${video.height}` : 'Video'}</span>
                <span aria-hidden="true">·</span>
                <span>{formatBytes(video.size)}</span>
              </div>
            </div>
          </div>

          <div className="space-y-4 p-4">
            {posts ? (
              <div className="space-y-2 border-b border-slate-100 pb-4">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>AI Video Analysis</span>
                  <span className="font-mono">
                    {posts.analysisMode === 'full_video' ? 'Full video' : 'Frame + metadata'}
                  </span>
                </div>
                <p className="break-words text-sm font-medium text-slate-900 leading-snug">
                  {posts.detectedTopic}
                </p>
                <p className="break-words text-xs text-slate-600 leading-relaxed">
                  Hook angle: {posts.hookAngle}
                </p>
                {posts.appStoreUrl && (
                  <p className="truncate text-xs text-blue-700">
                    App link: {posts.appStoreUrl}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-xs text-slate-500 leading-relaxed border-b border-slate-100 pb-4">
                Generate tailored posts for Instagram, Facebook, Pinterest, TikTok, and YouTube Shorts directly from this Drive video.
              </p>
            )}

            <div>
              <p className="mb-2 text-xs font-medium text-slate-700">Target Platforms</p>
              <div className="grid grid-cols-2 gap-2">
                {PLATFORMS.map((p) => {
                  const checked = selectedPlatforms[p.key];
                  return (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => onTogglePlatform(video.id, p.key)}
                      className={`flex items-center justify-between rounded-lg border px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
                        p.key === 'youtube' ? 'col-span-2' : ''
                      } ${
                        checked
                          ? 'border-blue-600 bg-blue-50/70 text-blue-700'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <span>{p.label}</span>
                      {checked && <Check className="h-3.5 w-3.5" />}
                    </button>
                  );
                })}
              </div>
            </div>

            {errorMessage && (
              <div className="space-y-2 break-words overflow-hidden rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700">
                <p>{errorMessage}</p>
                {errorMessage.toLowerCase().includes('publishing channels') && (
                  <button
                    type="button"
                    onClick={onOpenChannels}
                    className="inline-flex items-center rounded-md bg-red-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-800 whitespace-nowrap"
                  >
                    Open Publishing Channels
                  </button>
                )}
              </div>
            )}

            <div className="flex flex-col gap-2 pt-1">
              <button
                type="button"
                disabled={isBusy}
                onClick={() => onGeneratePosts(video.id)}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-900 transition-colors hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
              >
                {status === 'generating' ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                    Analyzing & Writing Posts...
                  </>
                ) : posts ? (
                  <>
                    <RefreshCw className="h-4 w-4 text-slate-600" />
                    Regenerate All 5 Posts
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4 text-blue-600" />
                    Prepare 5-Platform Posts
                  </>
                )}
              </button>

              <button
                type="button"
                disabled={!posts || isBusy || selectedCount === 0}
                onClick={() => onDeliverVideo(video.id)}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap"
              >
                {status === 'delivering' ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Delivering to {selectedCount} Platforms...
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4" />
                    Deliver to {selectedCount} Selected
                  </>
                )}
              </button>

              {posts && (
                <div className="space-y-2 border-t border-slate-100 pt-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-slate-600">Download This Reel's Posts</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        exportPostsAsTxt(
                          [{ video, posts, folderName }],
                          folderName,
                          `${folderName}_${video.name}`
                        )
                      }
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                    >
                      <FileText className="h-3.5 w-3.5 text-slate-500" />
                      TXT
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        exportPostsAsExcel(
                          [{ video, posts, folderName }],
                          folderName,
                          `${folderName}_${video.name}`
                        )
                      }
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                    >
                      <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
                      Excel
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        exportPostsAsPdf(
                          [{ video, posts, folderName }],
                          folderName,
                          `${folderName}_${video.name}`
                        )
                      }
                      className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                    >
                      <Download className="h-3.5 w-3.5 text-blue-600" />
                      PDF
                    </button>
                  </div>
                </div>
              )}

              {video.webViewLink && (
                <a
                  href={video.webViewLink}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-900"
                >
                  Open original file in Drive
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
          </div>
        </div>

        {lastDelivery && lastDelivery.length > 0 && (
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="text-xs font-semibold text-slate-900">Latest Delivery Status</h3>
            <ul className="mt-2.5 divide-y divide-slate-100">
              {lastDelivery.map((res) => (
                <li key={res.platform} className="py-2 first:pt-0 last:pb-0">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium capitalize text-slate-800">{res.platform}</span>
                    <span
                      className={`font-medium ${
                        res.status === 'delivered'
                          ? 'text-emerald-700'
                          : res.status === 'failed'
                            ? 'text-red-700'
                            : 'text-amber-700'
                      }`}
                    >
                      {res.status === 'delivered'
                        ? 'Delivered'
                        : res.status === 'failed'
                          ? 'Failed'
                          : 'Needs setup'}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500 leading-relaxed">{res.message}</p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Right column: Platform Tabs & Live Post Editor */}
      <div className="min-w-0 lg:col-span-8">
        <div className="rounded-xl border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3">
            <div className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1">
              {PLATFORMS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => setActiveTab(p.key)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    activeTab === p.key
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {posts && (
              <div className="flex flex-wrap items-center gap-3 text-xs tabular-nums">
                <span className="text-slate-500">
                  Generated {new Date(posts.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            )}
          </div>

          {!posts ? (
            <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
              <Sparkles className="h-9 w-9 text-slate-300" />
              <h3 className="mt-3 text-base font-semibold text-slate-900">
                Ready to prepare social posts
              </h3>
              <p className="mt-1 max-w-md text-sm text-slate-500">
                Click "Prepare 5-Platform Posts" to analyze this video and craft native copy, hooks, and hashtags for Instagram, Facebook, Pinterest, TikTok, and YouTube Shorts.
              </p>
              <button
                type="button"
                disabled={isBusy}
                onClick={() => onGeneratePosts(video.id)}
                className="mt-5 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {status === 'generating' ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Preparing Posts...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    Prepare 5-Platform Posts
                  </>
                )}
              </button>
            </div>
          ) : (
            <div className="p-6 space-y-5">
              {activeTab === 'instagram' && (
                <>
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-base font-semibold text-slate-900">Instagram Reels Post</h3>
                      <p className="text-xs text-slate-500">
                        {posts.instagram.formatNote} · Suggested time: {posts.instagram.bestTimeHint}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        copyText(
                          'ig',
                          `${posts.instagram.caption}\n\n${posts.instagram.hashtags.join(' ')}`
                        )
                      }
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                    >
                      {copiedKey === 'ig' ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                      {copiedKey === 'ig' ? 'Copied' : 'Copy Post'}
                    </button>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-700">
                      Cover Frame Headline
                    </label>
                    <input
                      type="text"
                      value={posts.instagram.coverHeadline}
                      onChange={(e) =>
                        onUpdatePosts(video.id, {
                          ...posts,
                          instagram: { ...posts.instagram, coverHeadline: e.target.value },
                        })
                      }
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                    />
                  </div>

                  <div>
                    <div className="mb-1.5 flex items-center justify-between">
                      <label className="text-xs font-medium text-slate-700">Caption</label>
                      <span className="text-xs text-slate-400 tabular-nums">
                        {posts.instagram.caption.length} / 2,200
                      </span>
                    </div>
                    <textarea
                      rows={7}
                      value={posts.instagram.caption}
                      onChange={(e) =>
                        onUpdatePosts(video.id, {
                          ...posts,
                          instagram: { ...posts.instagram, caption: e.target.value },
                        })
                      }
                      className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm leading-relaxed text-slate-900 focus:border-blue-600 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-700">
                      Hashtags (space separated)
                    </label>
                    <textarea
                      rows={2}
                      value={posts.instagram.hashtags.join(' ')}
                      onChange={(e) => updateHashtags('instagram', e.target.value)}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs text-slate-700 focus:border-blue-600 focus:outline-none"
                    />
                  </div>
                </>
              )}

              {activeTab === 'facebook' && (
                <>
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-base font-semibold text-slate-900">Facebook Page Video Post</h3>
                      <p className="text-xs text-slate-500">
                        Suggested time: {posts.facebook.bestTimeHint}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        copyText(
                          'fb',
                          `${posts.facebook.headline}\n\n${posts.facebook.postText}\n\n${posts.facebook.engagementQuestion}\n\n${posts.facebook.hashtags.join(' ')}`
                        )
                      }
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                    >
                      {copiedKey === 'fb' ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                      {copiedKey === 'fb' ? 'Copied' : 'Copy Post'}
                    </button>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-700">
                      Video Title / Headline
                    </label>
                    <input
                      type="text"
                      value={posts.facebook.headline}
                      onChange={(e) =>
                        onUpdatePosts(video.id, {
                          ...posts,
                          facebook: { ...posts.facebook, headline: e.target.value },
                        })
                      }
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-700">
                      Post Narrative
                    </label>
                    <textarea
                      rows={6}
                      value={posts.facebook.postText}
                      onChange={(e) =>
                        onUpdatePosts(video.id, {
                          ...posts,
                          facebook: { ...posts.facebook, postText: e.target.value },
                        })
                      }
                      className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm leading-relaxed text-slate-900 focus:border-blue-600 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-700">
                      Comment Engagement Question
                    </label>
                    <input
                      type="text"
                      value={posts.facebook.engagementQuestion}
                      onChange={(e) =>
                        onUpdatePosts(video.id, {
                          ...posts,
                          facebook: { ...posts.facebook, engagementQuestion: e.target.value },
                        })
                      }
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-700">
                      Hashtags
                    </label>
                    <input
                      type="text"
                      value={posts.facebook.hashtags.join(' ')}
                      onChange={(e) => updateHashtags('facebook', e.target.value)}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs text-slate-700 focus:border-blue-600 focus:outline-none"
                    />
                  </div>
                </>
              )}

              {activeTab === 'pinterest' && (
                <>
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-base font-semibold text-slate-900">Pinterest Video Pin</h3>
                      <p className="text-xs text-slate-500">
                        Suggested board: {posts.pinterest.suggestedBoard}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        copyText(
                          'pin',
                          `${posts.pinterest.pinTitle}\n\n${posts.pinterest.pinDescription}`
                        )
                      }
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                    >
                      {copiedKey === 'pin' ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                      {copiedKey === 'pin' ? 'Copied' : 'Copy Pin'}
                    </button>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <div className="mb-1.5 flex items-center justify-between">
                        <label className="text-xs font-medium text-slate-700">Pin Title</label>
                        <span className="text-xs text-slate-400 tabular-nums">
                          {posts.pinterest.pinTitle.length} / 100
                        </span>
                      </div>
                      <input
                        type="text"
                        value={posts.pinterest.pinTitle}
                        onChange={(e) =>
                          onUpdatePosts(video.id, {
                            ...posts,
                            pinterest: { ...posts.pinterest, pinTitle: e.target.value },
                          })
                        }
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-slate-700">
                        Suggested Board
                      </label>
                      <input
                        type="text"
                        value={posts.pinterest.suggestedBoard}
                        onChange={(e) =>
                          onUpdatePosts(video.id, {
                            ...posts,
                            pinterest: { ...posts.pinterest, suggestedBoard: e.target.value },
                          })
                        }
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <div className="mb-1.5 flex items-center justify-between">
                      <label className="text-xs font-medium text-slate-700">SEO Description</label>
                      <span className="text-xs text-slate-400 tabular-nums">
                        {posts.pinterest.pinDescription.length} / 500
                      </span>
                    </div>
                    <textarea
                      rows={5}
                      value={posts.pinterest.pinDescription}
                      onChange={(e) =>
                        onUpdatePosts(video.id, {
                          ...posts,
                          pinterest: { ...posts.pinterest, pinDescription: e.target.value },
                        })
                      }
                      className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm leading-relaxed text-slate-900 focus:border-blue-600 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-700">
                      Destination Link (Google Play Store URL)
                    </label>
                    <input
                      type="url"
                      value={posts.pinterest.destinationLink || ''}
                      onChange={(e) =>
                        onUpdatePosts(video.id, {
                          ...posts,
                          pinterest: { ...posts.pinterest, destinationLink: e.target.value },
                        })
                      }
                      placeholder="https://play.google.com/store/apps/details?id=..."
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-700">Alt Text</label>
                    <input
                      type="text"
                      value={posts.pinterest.altText}
                      onChange={(e) =>
                        onUpdatePosts(video.id, {
                          ...posts,
                          pinterest: { ...posts.pinterest, altText: e.target.value },
                        })
                      }
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                    />
                  </div>

                  <div className="text-xs text-slate-500">
                    Keywords: {posts.pinterest.keywords.join(' · ')}
                  </div>
                </>
              )}

              {activeTab === 'tiktok' && (
                <>
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-base font-semibold text-slate-900">TikTok Video Post</h3>
                      <p className="text-xs text-slate-500">
                        Pacing tip: {posts.tiktok.soundOrPacingTip}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        copyText(
                          'tt',
                          `${posts.tiktok.caption} ${posts.tiktok.hashtags.join(' ')}`
                        )
                      }
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                    >
                      {copiedKey === 'tt' ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                      {copiedKey === 'tt' ? 'Copied' : 'Copy Post'}
                    </button>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-700">
                      On-Screen Opening Hook (0–3s overlay)
                    </label>
                    <input
                      type="text"
                      value={posts.tiktok.onScreenHook}
                      onChange={(e) =>
                        onUpdatePosts(video.id, {
                          ...posts,
                          tiktok: { ...posts.tiktok, onScreenHook: e.target.value },
                        })
                      }
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-900 focus:border-blue-600 focus:outline-none"
                    />
                  </div>

                  <div>
                    <div className="mb-1.5 flex items-center justify-between">
                      <label className="text-xs font-medium text-slate-700">TikTok Caption</label>
                      <span className="text-xs text-slate-400 tabular-nums">
                        {posts.tiktok.caption.length} / 2,200
                      </span>
                    </div>
                    <textarea
                      rows={5}
                      value={posts.tiktok.caption}
                      onChange={(e) =>
                        onUpdatePosts(video.id, {
                          ...posts,
                          tiktok: { ...posts.tiktok, caption: e.target.value },
                        })
                      }
                      className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm leading-relaxed text-slate-900 focus:border-blue-600 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-700">
                      TikTok Hashtags
                    </label>
                    <input
                      type="text"
                      value={posts.tiktok.hashtags.join(' ')}
                      onChange={(e) => updateHashtags('tiktok', e.target.value)}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs text-slate-700 focus:border-blue-600 focus:outline-none"
                    />
                  </div>
                </>
              )}

              {activeTab === 'youtube' && (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-base font-semibold text-slate-900">YouTube Shorts</h3>
                      <p className="text-xs text-slate-500">
                        Vertical 9:16 Short · Title includes #Shorts for Shorts shelf discovery
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        copyText(
                          'yt',
                          `${currentYouTube.title}\n\n${currentYouTube.description}\n\n${currentYouTube.hashtags.join(' ')}`
                        )
                      }
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                    >
                      {copiedKey === 'yt' ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                      {copiedKey === 'yt' ? 'Copied' : 'Copy Short'}
                    </button>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <div className="sm:col-span-2">
                      <div className="mb-1.5 flex items-center justify-between">
                        <label className="text-xs font-medium text-slate-700">Shorts Title</label>
                        <span className="text-xs text-slate-400 tabular-nums">
                          {currentYouTube.title.length} / 100
                        </span>
                      </div>
                      <input
                        type="text"
                        value={currentYouTube.title}
                        onChange={(e) => updateYouTube({ title: e.target.value })}
                        placeholder="Catchy title ending with #Shorts"
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-900 focus:border-blue-600 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-slate-700">
                        Visibility
                      </label>
                      <select
                        value={currentYouTube.privacyStatus}
                        onChange={(e) =>
                          updateYouTube({
                            privacyStatus: e.target.value as 'public' | 'unlisted' | 'private',
                          })
                        }
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                      >
                        <option value="public">Public</option>
                        <option value="unlisted">Unlisted</option>
                        <option value="private">Private (Draft)</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <div className="mb-1.5 flex items-center justify-between">
                      <label className="text-xs font-medium text-slate-700">Description</label>
                      <span className="text-xs text-slate-400 tabular-nums">
                        {currentYouTube.description.length} / 5,000
                      </span>
                    </div>
                    <textarea
                      rows={5}
                      value={currentYouTube.description}
                      onChange={(e) => updateYouTube({ description: e.target.value })}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm leading-relaxed text-slate-900 focus:border-blue-600 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-slate-700">
                      Pinned First Comment
                    </label>
                    <input
                      type="text"
                      value={currentYouTube.pinnedComment}
                      onChange={(e) => updateYouTube({ pinnedComment: e.target.value })}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-slate-700">
                        YouTube Hashtags
                      </label>
                      <input
                        type="text"
                        value={currentYouTube.hashtags.join(' ')}
                        onChange={(e) =>
                          updateYouTube({
                            hashtags: e.target.value
                              .split(/[\s,]+/)
                              .map((t) => t.trim())
                              .filter(Boolean)
                              .map((t) => (t.startsWith('#') ? t : `#${t}`)),
                          })
                        }
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs text-slate-700 focus:border-blue-600 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-slate-700">
                        Search Tags (comma separated)
                      </label>
                      <input
                        type="text"
                        value={currentYouTube.tags.join(', ')}
                        onChange={(e) =>
                          updateYouTube({
                            tags: e.target.value
                              .split(',')
                              .map((t) => t.trim())
                              .filter(Boolean),
                          })
                        }
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-700 focus:border-blue-600 focus:outline-none"
                      />
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
