import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  AlertCircle,
  BookmarkCheck,
  CheckCircle2,
  Clock,
  Download,
  FileSpreadsheet,
  FileText,
  Film,
  FolderOpen,
  History,
  LayoutGrid,
  Loader2,
  LogOut,
  Menu,
  PenSquare,
  Radio,
  RefreshCw,
  Search,
  Send,
  Settings2,
  Sparkles,
  X,
} from 'lucide-react';
import {
  initAuth,
  googleSignIn,
  logout,
  clearAccessToken,
  requestDriveAccessToken,
} from './lib/firebaseAuth';
import { fetchApiJson } from './lib/apiClient';
import {
  loadUserPreferences,
  saveDeliveryLogRecord,
  saveUserPreferences,
  subscribeDeliveryLogs,
  subscribeFolderLookups,
  upsertFolderLookup,
} from './lib/firestorePosts';
import {
  exportPostsAsExcel,
  exportPostsAsPdf,
  exportPostsAsTxt,
} from './lib/exportPosts';
import { GoogleSignInButton } from './components/GoogleSignInButton';
import { FolderBrowserModal } from './components/FolderBrowserModal';
import { PostStudioEditor, formatBytes, formatDuration } from './components/PostStudioEditor';
import { ChannelsSettingsView } from './components/ChannelsSettingsView';
import { SavedResultsView } from './components/SavedResultsView';
import type {
  DeliveryLogEntry,
  DriveFolder,
  DriveVideo,
  GeneratedSocialPosts,
  GenerationSettings,
  PlatformKey,
  PublishingChannelsConfig,
  SavedFolderLookup,
  VideoQueueItem,
} from './types';

type ActiveSection = 'queue' | 'studio' | 'saved' | 'channels' | 'history';
type StatusFilter = 'all' | 'unprocessed' | 'ready' | 'delivered';

const DEFAULT_GENERATION_SETTINGS: GenerationSettings = {
  language: 'English',
  tone: 'Energetic & Viral',
  brandHandle: '',
  callToAction: 'Download the app on Google Play',
  targetAudience: '',
  appStoreUrl: '',
  appName: '',
  analysisDepth: 'fast',
};

const CHANNELS_STORAGE_KEY = 'drivecast_channels_config';
const KNOWN_DEFAULT_WEBHOOK = 'https://hook.us2.make.com/gpxe7k6975si8eqblswnlpkirvr5f39i';

const DEFAULT_CHANNELS: PublishingChannelsConfig = {
  mode: 'webhook',
  unifiedWebhookUrl: KNOWN_DEFAULT_WEBHOOK,
  webhookSecretHeader: '',
  platformWebhooks: {
    instagram: '',
    facebook: '',
    pinterest: '',
    tiktok: '',
    youtube: '',
  },
  direct: {
    metaAccessToken: '',
    instagramAccountId: '',
    facebookPageId: '',
    pinterestAccessToken: '',
    pinterestBoardId: '',
    tiktokAccessToken: '',
    youtubeAccessToken: '',
  },
};

function loadInitialChannels(): PublishingChannelsConfig {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(CHANNELS_STORAGE_KEY) : null;
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        ...DEFAULT_CHANNELS,
        ...parsed,
        unifiedWebhookUrl:
          typeof parsed.unifiedWebhookUrl === 'string' && parsed.unifiedWebhookUrl.trim()
            ? parsed.unifiedWebhookUrl.trim()
            : KNOWN_DEFAULT_WEBHOOK,
        platformWebhooks: {
          ...DEFAULT_CHANNELS.platformWebhooks,
          ...(parsed.platformWebhooks || {}),
        },
        direct: {
          ...DEFAULT_CHANNELS.direct,
          ...(parsed.direct || {}),
        },
      };
    }
  } catch (e) {
    console.error('Failed to parse channels from localStorage', e);
  }
  return DEFAULT_CHANNELS;
}

const ALL_PLATFORMS_SELECTED: Record<PlatformKey, boolean> = {
  instagram: true,
  facebook: true,
  pinterest: true,
  tiktok: true,
  youtube: true,
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [needsAuth, setNeedsAuth] = useState<boolean>(true);
  const [authReady, setAuthReady] = useState<boolean>(false);
  const [isLoggingIn, setIsLoggingIn] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [activeSection, setActiveSection] = useState<ActiveSection>('queue');
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);

  const [folderModalOpen, setFolderModalOpen] = useState<boolean>(false);
  const [folderLinkInput, setFolderLinkInput] = useState<string>('');
  const [activeFolder, setActiveFolder] = useState<DriveFolder | null>(null);
  const [syncingFolder, setSyncingFolder] = useState<boolean>(false);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  const [queue, setQueue] = useState<VideoQueueItem[]>([]);
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const [generationSettings, setGenerationSettings] = useState<GenerationSettings>(
    DEFAULT_GENERATION_SETTINGS
  );
  const [channels, setChannels] = useState<PublishingChannelsConfig>(loadInitialChannels);

  useEffect(() => {
    try {
      localStorage.setItem(CHANNELS_STORAGE_KEY, JSON.stringify(channels));
    } catch (e) {
      console.error('Failed to save channels to localStorage', e);
    }
  }, [channels]);
  const [deliveryLogs, setDeliveryLogs] = useState<DeliveryLogEntry[]>([]);

  const [autoWatchEnabled, setAutoWatchEnabled] = useState<boolean>(false);
  const [batchRunning, setBatchRunning] = useState<boolean>(false);
  const [savedLookups, setSavedLookups] = useState<SavedFolderLookup[]>(() => {
    try {
      const raw = typeof window !== 'undefined' ? localStorage.getItem('drivecast_folders_cache') : null;
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      if (savedLookups.length > 0) {
        localStorage.setItem('drivecast_folders_cache', JSON.stringify(savedLookups));
      }
    } catch {
      // ignore
    }
  }, [savedLookups]);
  const [prefsReady, setPrefsReady] = useState<boolean>(false);
  const [bannerNotice, setBannerNotice] = useState<{
    type: 'info' | 'success' | 'error';
    text: string;
  } | null>(null);

  const queueRef = useRef<VideoQueueItem[]>([]);
  queueRef.current = queue;

  const activeFolderRef = useRef<DriveFolder | null>(null);
  activeFolderRef.current = activeFolder;

  const lastSyncedPrefsJsonRef = useRef<string>('');
  const autoWatchBusyRef = useRef<boolean>(false);
  const accessTokenRef = useRef<string | null>(null);
  accessTokenRef.current = accessToken;

  useEffect(() => {
    const unsubscribe = initAuth(
      (authedUser, token) => {
        setUser(authedUser);
        if (token) setAccessToken(token);
        setNeedsAuth(false);
        setAuthReady(true);
      },
      () => {
        setUser(null);
        setAccessToken(null);
        setNeedsAuth(true);
        setAuthReady(true);
      }
    );
    return () => unsubscribe();
  }, []);

  // Subscribe to folder lookups, delivery logs, and restore saved preferences + last folder on sign-in
  useEffect(() => {
    if (!authReady || !user) {
      setSavedLookups([]);
      setDeliveryLogs([]);
      setPrefsReady(false);
      lastSyncedPrefsJsonRef.current = '';
      return;
    }

    let cancelled = false;
    const unsubLookups = subscribeFolderLookups(user.uid, (lookups) => {
      setSavedLookups(lookups);
    });
    const unsubLogs = subscribeDeliveryLogs(user.uid, (logs) => {
      setDeliveryLogs(logs);
    });

    (async () => {
      try {
        const prefs = await loadUserPreferences(user.uid);
        if (cancelled) return;

        let nextSettings = DEFAULT_GENERATION_SETTINGS;

        if (prefs) {
          nextSettings = { ...DEFAULT_GENERATION_SETTINGS, ...prefs.settings };
          setGenerationSettings(nextSettings);

          if (prefs.lastFolder && !activeFolderRef.current) {
            setFolderLinkInput(prefs.lastFolder.id);
          }
        }

        lastSyncedPrefsJsonRef.current = JSON.stringify({
          settings: nextSettings,
          lastFolder: activeFolderRef.current,
        });
      } catch (err) {
        if (!cancelled) {
          setBannerNotice({
            type: 'error',
            text: `Could not restore saved preferences: ${(err as Error).message}`,
          });
        }
      } finally {
        if (!cancelled) {
          setPrefsReady(true);
        }
      }
    })();

    return () => {
      cancelled = true;
      unsubLookups();
      unsubLogs();
    };
  }, [authReady, user]);

  // Auto-save Creator Brief settings & active folder to Firestore
  useEffect(() => {
    if (!user || !prefsReady) return;
    const serialized = JSON.stringify({
      settings: generationSettings,
      lastFolder: activeFolder,
    });
    if (serialized === lastSyncedPrefsJsonRef.current) return;

    const timer = setTimeout(() => {
      saveUserPreferences(user, generationSettings, activeFolder)
        .then(() => {
          lastSyncedPrefsJsonRef.current = serialized;
        })
        .catch((err) => {
          setBannerNotice({
            type: 'error',
            text: `Could not save settings to history: ${(err as Error).message}`,
          });
        });
    }, 800);

    return () => clearTimeout(timer);
  }, [user, prefsReady, generationSettings, activeFolder]);

  const handleLogin = async () => {
    setIsLoggingIn(true);
    setAuthError(null);
    try {
      const result = await googleSignIn();
      if (result) {
        setUser(result.user);
        setAccessToken(result.accessToken);
        setNeedsAuth(false);
      }
    } catch (err) {
      setAuthError((err as Error).message || 'Google sign-in did not complete.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const ensureDriveToken = useCallback(async (): Promise<string> => {
    if (accessTokenRef.current) {
      return accessTokenRef.current;
    }
    const freshToken = await requestDriveAccessToken(user?.email);
    accessTokenRef.current = freshToken;
    setAccessToken(freshToken);
    return freshToken;
  }, [user?.email]);

  const handleOpenFolderModal = useCallback(async () => {
    setFolderModalOpen(true);
    if (!accessTokenRef.current) {
      try {
        await ensureDriveToken();
      } catch {
        // Modal handles manual reconnect prompt cleanly if popup was dismissed
      }
    }
  }, [ensureDriveToken]);

  const handleLogout = async () => {
    setAutoWatchEnabled(false);
    await logout();
    setUser(null);
    setAccessToken(null);
    setNeedsAuth(true);
    setActiveFolder(null);
    setQueue([]);
    setSelectedVideoId(null);
  };

  const hasAnyConfiguredDestination = useMemo(() => {
    if (channels.mode === 'webhook') {
      if (channels.unifiedWebhookUrl.trim()) return true;
      return Object.values(channels.platformWebhooks).some((u) => u.trim().length > 0);
    }
    const d = channels.direct;
    return Boolean(
      (d.metaAccessToken && (d.instagramAccountId || d.facebookPageId)) ||
        (d.pinterestAccessToken && d.pinterestBoardId) ||
        d.tiktokAccessToken ||
        d.youtubeAccessToken
    );
  }, [channels]);

  const loadDriveFolder = useCallback(
    async (folderIdOrUrl: string): Promise<DriveVideo[]> => {
      setSyncingFolder(true);
      setFolderError(null);
      try {
        let token = await ensureDriveToken();
        const params = new URLSearchParams({ folderId: folderIdOrUrl.trim() });
        let response = await fetchApiJson<{
          folder: DriveFolder;
          videos?: DriveVideo[];
          error?: string;
        }>(`/api/drive/folder-videos?${params.toString()}`, token);

        if (response.status === 401) {
          clearAccessToken();
          accessTokenRef.current = null;
          setAccessToken(null);
          token = await requestDriveAccessToken(user?.email);
          accessTokenRef.current = token;
          setAccessToken(token);
          response = await fetchApiJson<{
            folder: DriveFolder;
            videos?: DriveVideo[];
            error?: string;
          }>(`/api/drive/folder-videos?${params.toString()}`, token);
        }

        const { ok, data } = response;
        if (!ok) {
          throw new Error(data.error || 'Could not load folder videos.');
        }

        const folder: DriveFolder = data.folder;
        const videos: DriveVideo[] = data.videos || [];

        setActiveFolder(folder);
        setFolderLinkInput(folder.id);
        setLastSyncedAt(new Date().toISOString());

        const existingMap = new Map<string, VideoQueueItem>();
        for (const item of queueRef.current) {
          existingMap.set(item.video.id, item);
        }

        const newlyDiscovered: DriveVideo[] = [];
        const mergedQueue: VideoQueueItem[] = videos.map((video) => {
          const existing = existingMap.get(video.id);
          if (existing) {
            return {
              ...existing,
              video,
            };
          }
          newlyDiscovered.push(video);
          return {
            video,
            status: 'unprocessed',
            selectedPlatforms: { ...ALL_PLATFORMS_SELECTED },
          };
        });

        setQueue(mergedQueue);
        if (mergedQueue.length > 0 && !selectedVideoId) {
          setSelectedVideoId(mergedQueue[0].video.id);
        }

        if (user) {
          upsertFolderLookup(
            user,
            folder,
            {
              videoCount: videos.length,
              savedPostCount: mergedQueue.filter((q) => Boolean(q.posts)).length,
            },
            generationSettings
          ).catch(() => {});
        }

        setBannerNotice({
          type: 'success',
          text: `Loaded ${videos.length} video${videos.length === 1 ? '' : 's'} from "${folder.name}".`,
        });

        return newlyDiscovered;
      } catch (err) {
        const msg = (err as Error).message;
        setFolderError(msg);
        throw err;
      } finally {
        setSyncingFolder(false);
      }
    },
    [selectedVideoId, user, generationSettings, ensureDriveToken]
  );

  const generatePostsForVideo = useCallback(
    async (videoId: string): Promise<GeneratedSocialPosts | null> => {
      const targetItem = queueRef.current.find((q) => q.video.id === videoId);
      if (!targetItem) return null;

      setQueue((prev) =>
        prev.map((q) =>
          q.video.id === videoId ? { ...q, status: 'generating', errorMessage: undefined } : q
        )
      );

      try {
        let token = await ensureDriveToken();
        let response = await fetchApiJson<GeneratedSocialPosts & { error?: string }>(
          '/api/videos/generate-posts',
          token,
          {
            method: 'POST',
            body: JSON.stringify({
              fileId: targetItem.video.id,
              fileName: targetItem.video.name,
              mimeType: targetItem.video.mimeType,
              size: targetItem.video.size,
              durationMillis: targetItem.video.durationMillis,
              width: targetItem.video.width,
              height: targetItem.video.height,
              ...generationSettings,
            }),
          }
        );

        if (response.status === 401) {
          clearAccessToken();
          accessTokenRef.current = null;
          setAccessToken(null);
          token = await requestDriveAccessToken(user?.email);
          accessTokenRef.current = token;
          setAccessToken(token);
          response = await fetchApiJson<GeneratedSocialPosts & { error?: string }>(
            '/api/videos/generate-posts',
            token,
            {
              method: 'POST',
              body: JSON.stringify({
                fileId: targetItem.video.id,
                fileName: targetItem.video.name,
                mimeType: targetItem.video.mimeType,
                size: targetItem.video.size,
                durationMillis: targetItem.video.durationMillis,
                width: targetItem.video.width,
                height: targetItem.video.height,
                ...generationSettings,
              }),
            }
          );
        }

        const { ok, data } = response;
        if (!ok) {
          throw new Error(data.error || 'Failed to generate posts for this video.');
        }

        const posts = data as GeneratedSocialPosts;
        setQueue((prev) =>
          prev.map((q) =>
            q.video.id === videoId ? { ...q, status: 'ready', posts, errorMessage: undefined } : q
          )
        );

        setBannerNotice({
          type: 'success',
          text: `Posts prepared for "${targetItem.video.name}".`,
        });

        return posts;
      } catch (err) {
        const message = (err as Error).message;
        setQueue((prev) =>
          prev.map((q) =>
            q.video.id === videoId ? { ...q, status: 'error', errorMessage: message } : q
          )
        );
        return null;
      }
    },
    [generationSettings, user, ensureDriveToken]
  );

  const deliverVideoPosts = useCallback(
    async (
      videoId: string,
      triggeredBy: 'manual' | 'auto_watch' = 'manual',
      overridePosts?: GeneratedSocialPosts
    ) => {
      const item = queueRef.current.find((q) => q.video.id === videoId);
      const postsToSend = overridePosts || item?.posts;
      if (!item || !postsToSend) return;

      const selectedPlatforms = (Object.keys(item.selectedPlatforms) as PlatformKey[]).filter(
        (p) => item.selectedPlatforms[p]
      );
      if (selectedPlatforms.length === 0) return;

      setQueue((prev) =>
        prev.map((q) =>
          q.video.id === videoId ? { ...q, status: 'delivering', errorMessage: undefined } : q
        )
      );

      try {
        const token = await ensureDriveToken();
        const { ok, data } = await fetchApiJson<{
          results?: DeliveryLogEntry['results'];
          error?: string;
        }>('/api/publish/deliver', token, {
          method: 'POST',
          body: JSON.stringify({
            video: item.video,
            posts: postsToSend,
            platforms: selectedPlatforms,
            channels,
          }),
        });

        if (!ok) {
          throw new Error(data.error || 'Delivery request failed.');
        }

        const results = (data.results || []) as DeliveryLogEntry['results'];
        const deliveredCount = results.filter((r) => r.status === 'delivered').length;
        const failedCount = results.filter((r) => r.status === 'failed').length;

        const nextStatus =
          deliveredCount === results.length
            ? 'delivered'
            : deliveredCount > 0
              ? 'partial'
              : failedCount > 0
                ? 'error'
                : 'ready';

        setQueue((prev) =>
          prev.map((q) =>
            q.video.id === videoId
              ? {
                  ...q,
                  status: nextStatus,
                  lastDelivery: results,
                  errorMessage:
                    deliveredCount === 0 && failedCount === 0
                      ? 'Configure a Webhook or Direct API in Publishing Channels to deliver posts.'
                      : undefined,
                }
              : q
          )
        );

        const logEntry: DeliveryLogEntry = {
          id: `${videoId}-${Date.now()}`,
          folderId: activeFolderRef.current?.id,
          folderName: activeFolderRef.current?.name,
          videoId: item.video.id,
          videoName: item.video.name,
          triggeredBy,
          timestamp: new Date().toISOString(),
          results,
        };
        if (user) {
          saveDeliveryLogRecord(user, logEntry).catch((err) => {
            setBannerNotice({
              type: 'error',
              text: `Delivery ran, but saving Delivery History failed: ${(err as Error).message}`,
            });
          });
        } else {
          setDeliveryLogs((prev) => [logEntry, ...prev]);
        }

        if (deliveredCount > 0) {
          setBannerNotice({
            type: 'success',
            text: `Delivered "${item.video.name}" to ${deliveredCount} platform${deliveredCount > 1 ? 's' : ''}.`,
          });
        } else if (failedCount > 0) {
          setBannerNotice({
            type: 'error',
            text: `Delivery failed for "${item.video.name}". Check Delivery History for details.`,
          });
        } else {
          setBannerNotice({
            type: 'info',
            text: 'No publishing destination configured yet. Open Publishing Channels to connect Make/Zapier/n8n or direct APIs.',
          });
        }
      } catch (err) {
        const message = (err as Error).message;
        setQueue((prev) =>
          prev.map((q) =>
            q.video.id === videoId ? { ...q, status: 'error', errorMessage: message } : q
          )
        );
      }
    },
    [channels, ensureDriveToken]
  );

  // Auto-Watch polling loop: checks the Drive folder every 60s for new videos, generates 4 posts, and delivers automatically
  useEffect(() => {
    if (!autoWatchEnabled || !activeFolder || !accessToken) return;

    const runAutoWatchCycle = async () => {
      if (autoWatchBusyRef.current) return;
      autoWatchBusyRef.current = true;
      try {
        const newVideos = await loadDriveFolder(activeFolder.id);
        for (const vid of newVideos) {
          const generated = await generatePostsForVideo(vid.id);
          if (generated && hasAnyConfiguredDestination) {
            await deliverVideoPosts(vid.id, 'auto_watch', generated);
          }
        }
      } catch {
        // Folder sync error already stored in folderError
      } finally {
        autoWatchBusyRef.current = false;
      }
    };

    const intervalId = setInterval(runAutoWatchCycle, 60000);
    return () => clearInterval(intervalId);
  }, [
    autoWatchEnabled,
    activeFolder,
    accessToken,
    hasAnyConfiguredDestination,
    loadDriveFolder,
    generatePostsForVideo,
    deliverVideoPosts,
  ]);

  const handlePrepareAllUnprocessed = async () => {
    const targets = queue.filter((q) => q.status === 'unprocessed' || q.status === 'error');
    if (targets.length === 0) return;
    setBatchRunning(true);
    try {
      for (const item of targets) {
        await generatePostsForVideo(item.video.id);
      }
    } finally {
      setBatchRunning(false);
    }
  };

  const handleDeliverAllReady = async () => {
    const targets = queue.filter((q) => q.posts && (q.status === 'ready' || q.status === 'partial'));
    if (targets.length === 0) return;
    setBatchRunning(true);
    try {
      for (const item of targets) {
        await deliverVideoPosts(item.video.id, 'manual');
      }
    } finally {
      setBatchRunning(false);
    }
  };

  const handleUpdatePosts = (videoId: string, updated: GeneratedSocialPosts) => {
    setQueue((prev) =>
      prev.map((q) => (q.video.id === videoId ? { ...q, posts: updated } : q))
    );
  };

  const handleTogglePlatform = (videoId: string, platform: PlatformKey) => {
    setQueue((prev) =>
      prev.map((q) =>
        q.video.id === videoId
          ? {
              ...q,
              selectedPlatforms: {
                ...q.selectedPlatforms,
                [platform]: !q.selectedPlatforms[platform],
              },
            }
          : q
      )
    );
  };

  const filteredQueue = useMemo(() => {
    return queue.filter((item) => {
      const matchesSearch = item.video.name
        .toLowerCase()
        .includes(searchTerm.trim().toLowerCase());
      if (!matchesSearch) return false;
      if (statusFilter === 'all') return true;
      if (statusFilter === 'unprocessed') {
        return item.status === 'unprocessed' || item.status === 'generating' || item.status === 'error';
      }
      if (statusFilter === 'ready') return item.status === 'ready';
      if (statusFilter === 'delivered') {
        return item.status === 'delivered' || item.status === 'partial';
      }
      return true;
    });
  }, [queue, searchTerm, statusFilter]);

  const selectedItem = useMemo(
    () => queue.find((q) => q.video.id === selectedVideoId) || queue[0] || null,
    [queue, selectedVideoId]
  );

  const counts = useMemo(() => {
    return {
      total: queue.length,
      ready: queue.filter((q) => Boolean(q.posts)).length,
      delivered: queue.filter((q) => q.status === 'delivered').length,
    };
  }, [queue]);

  // Sign-In Screen only when no Firebase user is signed in on this device (one-time login)
  if (!authReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
      </div>
    );
  }

  if (needsAuth || !user) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col">
        <header className="flex h-16 items-center justify-between gap-8 border-b border-slate-200 bg-white px-6 lg:px-10">
          <span className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
            DriveCast Studio
          </span>
          <div className="flex items-center gap-3 shrink-0">
            <GoogleSignInButton onClick={handleLogin} disabled={isLoggingIn} />
          </div>
        </header>

        <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-6 py-16">
          <div className="grid grid-cols-1 gap-12 lg:grid-cols-12 lg:items-center">
            <div className="space-y-6 lg:col-span-7">
              <h1
                className="font-display text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl"
                style={{ textWrap: 'balance' }}
              >
                Turn any Google Drive video folder into multi-platform posts automatically.
              </h1>
              <p className="max-w-xl text-base leading-relaxed text-slate-600">
                Connect your Gmail Google Drive account, select a folder of videos, and let DriveCast analyze each clip to generate tailored posts for Instagram, Facebook, Pinterest, TikTok, and YouTube Shorts—ready for automatic publishing.
              </p>

              {authError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {authError}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-4 pt-2">
                <GoogleSignInButton
                  onClick={handleLogin}
                  disabled={isLoggingIn}
                  label={isLoggingIn ? 'Connecting Google Drive...' : 'Sign in with Google'}
                />
                <span className="text-xs text-slate-500">
                  Read-only Drive access · Your videos stay in your Drive
                </span>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-6 lg:col-span-5 space-y-5">
              <h2 className="text-sm font-semibold text-slate-900">Automated Workflow</h2>
              <div className="divide-y divide-slate-100">
                <div className="pb-4">
                  <p className="text-xs font-mono text-blue-600">01. Connect Folder</p>
                  <p className="mt-1 text-sm font-medium text-slate-900">
                    Pick any folder from your Google Drive
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Browse subfolders or paste a Drive folder link. Enable Auto-Watch to detect newly uploaded videos.
                  </p>
                </div>
                <div className="py-4">
                  <p className="text-xs font-mono text-blue-600">02. AI Post Studio</p>
                  <p className="mt-1 text-sm font-medium text-slate-900">
                    Bespoke copy for all 5 platforms
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Generates Instagram Reels captions, Facebook storytelling posts, Pinterest SEO pins, TikTok hooks, and YouTube Shorts titles/descriptions in English, Darija, French, Arabic, or Spanish.
                  </p>
                </div>
                <div className="pt-4">
                  <p className="text-xs font-mono text-blue-600">03. Auto-Deliver</p>
                  <p className="mt-1 text-sm font-medium text-slate-900">
                    Publish via Webhooks or Direct APIs
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Sends a signed direct video stream URL and all 5 platform posts to Make, Zapier, n8n, or Meta, Pinterest, TikTok, and YouTube APIs.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900">
      {/* Mobile Sidebar Backdrop */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Left Workspace Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-slate-200 bg-white transition-transform duration-200 lg:static lg:translate-x-0 ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-16 items-center justify-between border-b border-slate-200 px-5">
          <span className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap">
            DriveCast Studio
          </span>
          <button
            type="button"
            onClick={() => setMobileMenuOpen(false)}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 lg:hidden"
            aria-label="Close navigation"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {[
            { id: 'queue' as const, label: 'Folder Queue', icon: LayoutGrid, count: counts.total },
            { id: 'studio' as const, label: 'Post Studio', icon: PenSquare },
            { id: 'saved' as const, label: 'Folder History', icon: BookmarkCheck, count: savedLookups.length },
            { id: 'channels' as const, label: 'Publishing Channels', icon: Settings2 },
            { id: 'history' as const, label: 'Delivery History', icon: History, count: deliveryLogs.length },
          ].map((navItem) => {
            const Icon = navItem.icon;
            const active = activeSection === navItem.id;
            return (
              <button
                key={navItem.id}
                type="button"
                onClick={() => {
                  setActiveSection(navItem.id);
                  setMobileMenuOpen(false);
                }}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{navItem.label}</span>
                </span>
                {typeof navItem.count === 'number' && navItem.count > 0 && (
                  <span
                    className={`font-mono text-xs tabular-nums ${
                      active ? 'text-slate-300' : 'text-slate-400'
                    }`}
                  >
                    {navItem.count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Active Folder & Auto-Watch Controls */}
        <div className="border-t border-slate-200 p-4 space-y-3">
          <div>
            <p className="text-xs font-medium text-slate-500">Watched Drive Folder</p>
            <p className="mt-1 truncate text-sm font-semibold text-slate-900">
              {activeFolder ? activeFolder.name : 'No folder selected'}
            </p>
            {lastSyncedAt && (
              <p className="mt-0.5 text-xs text-slate-400 tabular-nums">
                Synced {new Date(lastSyncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={() => void handleOpenFolderModal()}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50 whitespace-nowrap"
          >
            <FolderOpen className="h-3.5 w-3.5 text-blue-600" />
            {activeFolder ? 'Change Folder' : 'Select Drive Folder'}
          </button>

          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-1.5 text-xs text-slate-700">
              <Radio className={`h-3.5 w-3.5 ${autoWatchEnabled ? 'text-emerald-600' : 'text-slate-400'}`} />
              <span>Auto-Watch (60s)</span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={autoWatchEnabled}
              disabled={!activeFolder}
              onClick={() => setAutoWatchEnabled((v) => !v)}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                autoWatchEnabled ? 'bg-blue-600' : 'bg-slate-300'
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                  autoWatchEnabled ? 'translate-x-4.5' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>

        {/* Account footer */}
        <div className="border-t border-slate-200 px-4 py-3 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-slate-900">
              {user?.displayName || 'Google Account'}
            </p>
            <p className="truncate text-xs text-slate-500">{user?.email}</p>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 shrink-0"
            title="Sign out"
            aria-label="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </aside>

      {/* Main Content Shell */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top Bar Contract: Breadcrumb on left, primary actions on right */}
        <header className="flex h-16 items-center justify-between gap-6 border-b border-slate-200 bg-white px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2 text-sm text-slate-500 truncate">
              <span className="font-medium text-slate-900 capitalize">
                {activeSection === 'queue'
                  ? 'Folder Queue'
                  : activeSection === 'studio'
                    ? 'Post Studio'
                    : activeSection === 'saved'
                      ? 'Folder History'
                      : activeSection === 'channels'
                        ? 'Publishing Channels'
                        : 'Delivery History'}
              </span>
              {activeFolder && (
                <>
                  <span aria-hidden="true">/</span>
                  <span className="truncate text-slate-600">{activeFolder.name}</span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {activeFolder ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setActiveFolder(null);
                    setQueue([]);
                    setSelectedVideoId(null);
                    setFolderLinkInput('');
                    setActiveSection('queue');
                  }}
                  className="hidden sm:inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                >
                  New Execution
                </button>
                <button
                  type="button"
                  disabled={syncingFolder}
                  onClick={() => loadDriveFolder(activeFolder.id).catch(() => {})}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${syncingFolder ? 'animate-spin' : ''}`} />
                  {syncingFolder ? 'Syncing...' : 'Sync Folder'}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => void handleOpenFolderModal()}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-700 whitespace-nowrap shrink-0"
              >
                <FolderOpen className="h-3.5 w-3.5" />
                Connect Folder
              </button>
            )}
          </div>
        </header>

        {/* Main Viewport */}
        <main className="min-w-0 flex-1 overflow-x-hidden p-4 sm:p-6 lg:p-8">
          {bannerNotice && (
            <div
              className={`mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm ${
                bannerNotice.type === 'success'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : bannerNotice.type === 'error'
                    ? 'border-red-200 bg-red-50 text-red-800'
                    : 'border-blue-200 bg-blue-50 text-blue-800'
              }`}
            >
              <span className="min-w-0 break-words">{bannerNotice.text}</span>
              <div className="flex items-center gap-3 shrink-0">
                {bannerNotice.type === 'info' && (
                  <button
                    type="button"
                    onClick={() => {
                      setActiveSection('channels');
                      setBannerNotice(null);
                    }}
                    className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 whitespace-nowrap"
                  >
                    Open Channels
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setBannerNotice(null)}
                  className="text-xs font-medium underline underline-offset-2 shrink-0"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {activeSection === 'queue' && (
            <div className="mx-auto max-w-6xl space-y-6">
              {/* Folder Link Bar + Metrics Strip */}
              <div className="grid grid-cols-1 gap-4 rounded-xl border border-slate-200 bg-white p-5 lg:grid-cols-12 lg:items-center">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (folderLinkInput.trim()) {
                      loadDriveFolder(folderLinkInput).catch(() => {});
                    }
                  }}
                  className="flex flex-wrap gap-2 lg:col-span-7"
                >
                  <input
                    type="text"
                    value={folderLinkInput}
                    onChange={(e) => setFolderLinkInput(e.target.value)}
                    placeholder="Paste Google Drive folder URL or ID..."
                    className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={syncingFolder || !folderLinkInput.trim()}
                    className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0"
                  >
                    Load Folder
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleOpenFolderModal()}
                    className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                  >
                    Browse Drive
                  </button>
                </form>

                <div className="grid grid-cols-3 divide-x divide-slate-200 text-center lg:col-span-5">
                  <div className="px-3">
                    <p className="text-xs text-slate-500">Videos</p>
                    <p className="mt-0.5 font-mono text-lg font-semibold text-slate-900 tabular-nums">
                      {counts.total}
                    </p>
                  </div>
                  <div className="px-3">
                    <p className="text-xs text-slate-500">Posts Ready</p>
                    <p className="mt-0.5 font-mono text-lg font-semibold text-slate-900 tabular-nums">
                      {counts.ready}
                    </p>
                  </div>
                  <div className="px-3">
                    <p className="text-xs text-slate-500">Delivered</p>
                    <p className="mt-0.5 font-mono text-lg font-semibold text-emerald-700 tabular-nums">
                      {counts.delivered}
                    </p>
                  </div>
                </div>
              </div>

              {folderError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {folderError}
                </div>
              )}

              {/* Post Generation Preferences */}
              <div className="rounded-xl border border-slate-200 bg-white p-5">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                  <h2 className="text-sm font-semibold text-slate-900">
                    Creator Brief & Language Settings
                  </h2>
                  <span className="text-xs text-slate-500">
                    Applied when generating Instagram, Facebook, Pinterest, TikTok, and YouTube Shorts posts
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">
                      Google Play Store Link
                    </label>
                    <input
                      type="url"
                      value={generationSettings.appStoreUrl}
                      onChange={(e) =>
                        setGenerationSettings((s) => ({ ...s, appStoreUrl: e.target.value }))
                      }
                      placeholder="https://play.google.com/store/apps/details?id=..."
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">
                      App Name (optional)
                    </label>
                    <input
                      type="text"
                      value={generationSettings.appName}
                      onChange={(e) =>
                        setGenerationSettings((s) => ({ ...s, appName: e.target.value }))
                      }
                      placeholder="My Android App"
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">
                      Post Language
                    </label>
                    <select
                      value={generationSettings.language}
                      onChange={(e) =>
                        setGenerationSettings((s) => ({
                          ...s,
                          language: e.target.value as GenerationSettings['language'],
                        }))
                      }
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                    >
                      <option value="English">English</option>
                      <option value="Moroccan Darija">Moroccan Darija</option>
                      <option value="French">French</option>
                      <option value="Arabic">Arabic</option>
                      <option value="Spanish">Spanish</option>
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">
                      Brand Tone
                    </label>
                    <select
                      value={generationSettings.tone}
                      onChange={(e) =>
                        setGenerationSettings((s) => ({
                          ...s,
                          tone: e.target.value as GenerationSettings['tone'],
                        }))
                      }
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                    >
                      <option value="Energetic & Viral">Energetic & Viral</option>
                      <option value="Storytelling & Warm">Storytelling & Warm</option>
                      <option value="Educational & Clear">Educational & Clear</option>
                      <option value="Luxury & Editorial">Luxury & Editorial</option>
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">
                      Analysis Speed
                    </label>
                    <select
                      value={generationSettings.analysisDepth}
                      onChange={(e) =>
                        setGenerationSettings((s) => ({
                          ...s,
                          analysisDepth: e.target.value as GenerationSettings['analysisDepth'],
                        }))
                      }
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                    >
                      <option value="fast">Fast (Frame + Info · ~3s)</option>
                      <option value="deep">Deep (Watch Full Video)</option>
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">
                      Call To Action
                    </label>
                    <input
                      type="text"
                      value={generationSettings.callToAction}
                      onChange={(e) =>
                        setGenerationSettings((s) => ({ ...s, callToAction: e.target.value }))
                      }
                      placeholder="Download on Google Play..."
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* Filter & Batch Action Bar */}
              {queue.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="relative w-64">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder="Filter videos..."
                        className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
                      />
                    </div>

                    <div className="flex items-center gap-1 rounded-lg bg-slate-200/70 p-1">
                      {(
                        [
                          ['all', 'All'],
                          ['unprocessed', 'Needs Posts'],
                          ['ready', 'Ready'],
                          ['delivered', 'Delivered'],
                        ] as const
                      ).map(([val, label]) => (
                        <button
                          key={val}
                          type="button"
                          onClick={() => setStatusFilter(val)}
                          className={`rounded-md px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                            statusFilter === val
                              ? 'bg-white text-slate-900 shadow-sm'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {counts.ready > 0 && (
                      <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5">
                        <span className="text-[11px] font-medium text-slate-500 mr-1 whitespace-nowrap">
                          Export Folder:
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            const readyItems = queue
                              .filter((q): q is VideoQueueItem & { posts: GeneratedSocialPosts } => Boolean(q.posts))
                              .map((q) => ({
                                video: q.video,
                                posts: q.posts,
                                folderName: activeFolder?.name || 'Google Drive Folder',
                              }));
                            exportPostsAsTxt(readyItems, activeFolder?.name || 'Google Drive Folder');
                          }}
                          className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap"
                          title="Download all ready posts as TXT"
                        >
                          <FileText className="h-3.5 w-3.5 text-slate-500" />
                          TXT
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const readyItems = queue
                              .filter((q): q is VideoQueueItem & { posts: GeneratedSocialPosts } => Boolean(q.posts))
                              .map((q) => ({
                                video: q.video,
                                posts: q.posts,
                                folderName: activeFolder?.name || 'Google Drive Folder',
                              }));
                            exportPostsAsExcel(readyItems, activeFolder?.name || 'Google Drive Folder');
                          }}
                          className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap"
                          title="Download all ready posts as Excel (.xlsx)"
                        >
                          <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
                          Excel
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const readyItems = queue
                              .filter((q): q is VideoQueueItem & { posts: GeneratedSocialPosts } => Boolean(q.posts))
                              .map((q) => ({
                                video: q.video,
                                posts: q.posts,
                                folderName: activeFolder?.name || 'Google Drive Folder',
                              }));
                            exportPostsAsPdf(readyItems, activeFolder?.name || 'Google Drive Folder');
                          }}
                          className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap"
                          title="Download all ready posts as PDF"
                        >
                          <Download className="h-3.5 w-3.5 text-blue-600" />
                          PDF
                        </button>
                      </div>
                    )}

                    <button
                      type="button"
                      disabled={
                        batchRunning ||
                        queue.every((q) => q.status !== 'unprocessed' && q.status !== 'error')
                      }
                      onClick={handlePrepareAllUnprocessed}
                      className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-900 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
                    >
                      {batchRunning ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-600" />
                      ) : (
                        <Sparkles className="h-3.5 w-3.5 text-blue-600" />
                      )}
                      Prepare All Videos
                    </button>

                    <button
                      type="button"
                      disabled={
                        batchRunning ||
                        !queue.some((q) => q.posts && (q.status === 'ready' || q.status === 'partial'))
                      }
                      onClick={handleDeliverAllReady}
                      className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap"
                    >
                      <Send className="h-3.5 w-3.5" />
                      Deliver All Ready
                    </button>
                  </div>
                </div>
              )}

              {/* Video Queue List or Saved Archive Home */}
              {!activeFolder ? (
                savedLookups.length > 0 ? (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h2 className="text-base font-semibold text-slate-900">
                          Your Saved Archive ({savedLookups.length} folder{savedLookups.length === 1 ? '' : 's'})
                        </h2>
                        <p className="text-xs text-slate-500">
                          Open a saved folder immediately, export its posts, or sync it for new Drive reels. To start a new execution, paste or browse a folder above.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setActiveSection('saved')}
                        className="text-xs font-medium text-blue-600 hover:text-blue-700 whitespace-nowrap"
                      >
                        Open Full Archive →
                      </button>
                    </div>

                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      {savedLookups.map((lookup) => (
                        <div
                          key={lookup.id}
                          className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <FolderOpen className="h-4 w-4 shrink-0 text-blue-600" />
                              <h3 className="truncate text-sm font-semibold text-slate-900">
                                {lookup.folderName}
                              </h3>
                            </div>
                            <p className="mt-1 text-xs text-slate-500 tabular-nums">
                              {lookup.videoCount} video{lookup.videoCount === 1 ? '' : 's'} ·{' '}
                              {lookup.language} · {new Date(lookup.updatedAtMs).toLocaleDateString()}
                            </p>
                          </div>

                          <button
                            type="button"
                            disabled={syncingFolder}
                            onClick={() => loadDriveFolder(lookup.folderId).catch(() => {})}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap shrink-0"
                          >
                            <RefreshCw className={`h-3 w-3 ${syncingFolder ? 'animate-spin' : ''}`} />
                            Load from Drive
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white px-6 py-20 text-center">
                    <FolderOpen className="h-10 w-10 text-slate-300" />
                    <h3 className="mt-3 text-base font-semibold text-slate-900">
                      Connect a Google Drive folder to get started
                    </h3>
                    <p className="mt-1 max-w-md text-sm text-slate-500">
                      Select any folder containing your video files. DriveCast will scan every video and prepare ready-to-publish posts for Instagram, Facebook, Pinterest, TikTok, and YouTube Shorts.
                    </p>
                    <button
                      type="button"
                      onClick={() => void handleOpenFolderModal()}
                      className="mt-5 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
                    >
                      <FolderOpen className="h-4 w-4" />
                      Browse My Drive Folders
                    </button>
                  </div>
                )
              ) : queue.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-white px-6 py-16 text-center">
                  <Film className="h-10 w-10 text-slate-300" />
                  <h3 className="mt-3 text-base font-semibold text-slate-900">
                    No videos found in "{activeFolder.name}"
                  </h3>
                  <p className="mt-1 max-w-md text-sm text-slate-500">
                    Upload an MP4, MOV, or WebM video to this Google Drive folder and click Sync Folder, or choose another folder.
                  </p>
                </div>
              ) : (
                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                  <table className="w-full border-collapse text-left">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                        <th className="px-4 py-3">Video</th>
                        <th className="hidden px-4 py-3 md:table-cell">Specs</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredQueue.map((item) => {
                        const { video, status, posts, errorMessage } = item;
                        return (
                          <tr key={video.id} className="hover:bg-slate-50/70 transition-colors">
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-3 min-w-0">
                                <div className="h-12 w-20 shrink-0 overflow-hidden rounded-md bg-slate-900 flex items-center justify-center">
                                  {video.thumbUrl ? (
                                    <img
                                      src={video.thumbUrl}
                                      alt={video.name}
                                      referrerPolicy="no-referrer"
                                      className="h-full w-full object-cover"
                                    />
                                  ) : (
                                    <Film className="h-5 w-5 text-slate-400" />
                                  )}
                                </div>
                                <div className="min-w-0">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSelectedVideoId(video.id);
                                      setActiveSection('studio');
                                    }}
                                    className="block max-w-xs truncate text-left text-sm font-medium text-slate-900 hover:text-blue-600"
                                  >
                                    {video.name}
                                  </button>
                                  <p className="mt-0.5 truncate max-w-md text-xs text-slate-500">
                                    {posts
                                      ? posts.detectedTopic
                                      : errorMessage || 'Waiting for AI post generation'}
                                  </p>
                                </div>
                              </div>
                            </td>

                            <td className="hidden px-4 py-3 text-xs text-slate-500 tabular-nums md:table-cell whitespace-nowrap">
                              {formatDuration(video.durationMillis)} ·{' '}
                              {video.width && video.height ? `${video.width}×${video.height}` : 'Video'} ·{' '}
                              {formatBytes(video.size)}
                            </td>

                            <td className="px-4 py-3 whitespace-nowrap">
                              {status === 'generating' && (
                                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700">
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  Preparing...
                                </span>
                              )}
                              {status === 'delivering' && (
                                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700">
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  Delivering...
                                </span>
                              )}
                              {status === 'unprocessed' && (
                                <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                                  <Clock className="h-3.5 w-3.5" />
                                  Needs posts
                                </span>
                              )}
                              {status === 'ready' && (
                                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700">
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                  5 Posts Ready
                                </span>
                              )}
                              {(status === 'delivered' || status === 'partial') && (
                                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                  {status === 'delivered' ? 'Delivered' : 'Partially Delivered'}
                                </span>
                              )}
                              {status === 'error' && (
                                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-700">
                                  <AlertCircle className="h-3.5 w-3.5" />
                                  Attention needed
                                </span>
                              )}
                            </td>

                            <td className="px-4 py-3 text-right whitespace-nowrap">
                              <div className="inline-flex items-center gap-2">
                                {!posts ? (
                                  <button
                                    type="button"
                                    disabled={status === 'generating'}
                                    onClick={() => generatePostsForVideo(video.id)}
                                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-900 hover:bg-slate-50 disabled:opacity-50"
                                  >
                                    Prepare Posts
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    disabled={status === 'delivering'}
                                    onClick={() => deliverVideoPosts(video.id, 'manual')}
                                    className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                                  >
                                    Deliver
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedVideoId(video.id);
                                    setActiveSection('studio');
                                  }}
                                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                                >
                                  Edit Posts
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {activeSection === 'studio' && (
            <div className="mx-auto max-w-6xl space-y-5">
              {queue.length > 1 && (
                <div className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-4 py-3">
                  <span className="text-xs font-medium text-slate-600 whitespace-nowrap">
                    Editing Video:
                  </span>
                  <select
                    value={selectedItem?.video.id || ''}
                    onChange={(e) => {
                      setSelectedVideoId(e.target.value);
                    }}
                    className="min-w-0 flex-1 max-w-md rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-600 focus:outline-none"
                  >
                    {queue.map((q) => (
                      <option key={q.video.id} value={q.video.id}>
                        {q.video.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {selectedItem ? (
                <PostStudioEditor
                  item={selectedItem}
                  folderName={activeFolder?.name || 'Google Drive Folder'}
                  onGeneratePosts={async (id) => {
                    await generatePostsForVideo(id);
                  }}
                  onUpdatePosts={handleUpdatePosts}
                  onTogglePlatform={handleTogglePlatform}
                  onDeliverVideo={(id) => deliverVideoPosts(id, 'manual')}
                  onOpenChannels={() => setActiveSection('channels')}
                />
              ) : (
                <div className="rounded-xl border border-slate-200 bg-white p-16 text-center">
                  <Film className="mx-auto h-9 w-9 text-slate-300" />
                  <h3 className="mt-3 text-base font-semibold text-slate-900">
                    No video selected
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">
                    Load a Google Drive folder from Folder Queue to edit and publish posts.
                  </p>
                  <button
                    type="button"
                    onClick={() => setActiveSection('queue')}
                    className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800"
                  >
                    Go to Folder Queue
                  </button>
                </div>
              )}
            </div>
          )}

          {activeSection === 'saved' && user && (
            <SavedResultsView
              lookups={savedLookups}
              onSyncFolderFromDrive={(folderId) => {
                setActiveSection('queue');
                loadDriveFolder(folderId).catch(() => {});
              }}
            />
          )}

          {activeSection === 'channels' && (
            <ChannelsSettingsView
              channels={channels}
              accessToken={accessToken}
              onChange={setChannels}
            />
          )}

          {activeSection === 'history' && (
            <div className="mx-auto max-w-5xl space-y-4">
              <div className="border-b border-slate-200 pb-4">
                <h2 className="text-xl font-semibold text-slate-900">Delivery History</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Real-time log of posts and video stream URLs sent to your webhooks and platform APIs.
                </p>
              </div>

              {deliveryLogs.length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-white p-16 text-center">
                  <History className="mx-auto h-9 w-9 text-slate-300" />
                  <h3 className="mt-3 text-base font-semibold text-slate-900">
                    No deliveries sent yet
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">
                    Prepare posts for a video and click Deliver to send them to your configured channels.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {deliveryLogs.map((entry) => (
                    <div
                      key={entry.id}
                      className="rounded-xl border border-slate-200 bg-white p-5 space-y-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-900">{entry.videoName}</p>
                          <p className="text-xs text-slate-500 tabular-nums">
                            {entry.folderName ? `${entry.folderName} · ` : ''}
                            {new Date(entry.timestamp).toLocaleString()} ·{' '}
                            {entry.triggeredBy === 'auto_watch' ? 'Auto-Watch' : 'Manual delivery'}
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                        {entry.results.map((r) => (
                          <div key={r.platform} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-semibold capitalize text-slate-900">
                                {r.platform === 'youtube' ? 'YouTube Shorts' : r.platform}
                              </span>
                              <span
                                className={`font-medium ${
                                  r.status === 'delivered'
                                    ? 'text-emerald-700'
                                    : r.status === 'failed'
                                      ? 'text-red-700'
                                      : 'text-amber-700'
                                }`}
                              >
                                {r.status === 'delivered'
                                  ? 'Delivered'
                                  : r.status === 'failed'
                                    ? 'Failed'
                                    : 'Unconfigured'}
                              </span>
                            </div>
                            <p className="mt-1.5 text-xs text-slate-600 leading-relaxed">
                              {r.message}
                            </p>
                            {r.externalId && (
                              <p className="mt-1 font-mono text-[11px] text-slate-500 truncate">
                                ID: {r.externalId}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      <FolderBrowserModal
        isOpen={folderModalOpen}
        accessToken={accessToken}
        onClose={() => setFolderModalOpen(false)}
        onConnectDrive={async () => {
          return await ensureDriveToken();
        }}
        onSelectFolder={async (folderIdOrUrl) => {
          await loadDriveFolder(folderIdOrUrl);
          setActiveSection('queue');
        }}
      />
    </div>
  );
}
