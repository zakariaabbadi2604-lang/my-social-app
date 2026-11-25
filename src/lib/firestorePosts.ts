import type { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { auth, db } from './firebaseAuth';
import type {
  DeliveryLogEntry,
  DriveFolder,
  GenerationSettings,
  SavedFolderLookup,
} from '../types';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

function sanitizeId(raw: string): string {
  const cleaned = String(raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_');
  return (cleaned || 'item').slice(0, 120);
}

export function makeLookupId(uid: string, folderId: string): string {
  const uidPart = sanitizeId(uid).slice(0, 24);
  const folderPart = sanitizeId(folderId).slice(0, 96);
  return `${uidPart}_${folderPart}`.slice(0, 128);
}

function clampStr(val: unknown, maxLen: number, fallback = ''): string {
  const str = typeof val === 'string' ? val : val == null ? fallback : String(val);
  return str.slice(0, maxLen);
}

function clampInt(val: unknown, min: number, max: number): number {
  const n = Math.round(Number(val) || 0);
  return Math.min(max, Math.max(min, n));
}

function toMillis(ts: unknown): number {
  if (ts instanceof Timestamp) return ts.toMillis();
  if (
    ts &&
    typeof ts === 'object' &&
    'toMillis' in ts &&
    typeof (ts as { toMillis: unknown }).toMillis === 'function'
  ) {
    return (ts as { toMillis: () => number }).toMillis();
  }
  return Date.now();
}

export async function upsertFolderLookup(
  user: User,
  folder: DriveFolder,
  counts: { videoCount: number; savedPostCount?: number },
  settings: GenerationSettings
): Promise<string> {
  const lookupId = makeLookupId(user.uid, folder.id);
  const path = `folderLookups/${lookupId}`;
  const ref = doc(db, 'folderLookups', lookupId);

  let existingSnap;
  try {
    existingSnap = await getDoc(ref);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }

  const folderName =
    clampStr(folder.name, 200, 'Google Drive Folder').trim() || 'Google Drive Folder';
  const language = clampStr(settings.language, 40, 'English').trim() || 'English';
  const appName = clampStr(settings.appName, 120);
  const appStoreUrl = clampStr(settings.appStoreUrl, 500);
  const videoCount = clampInt(counts.videoCount, 0, 10000);

  if (!existingSnap.exists()) {
    const savedPostCount = clampInt(counts.savedPostCount ?? 0, 0, 10000);
    try {
      await setDoc(ref, {
        ownerId: sanitizeId(user.uid),
        folderId: sanitizeId(folder.id),
        folderName,
        videoCount,
        savedPostCount,
        language,
        appName,
        appStoreUrl,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  } else {
    const existingData = existingSnap.data();
    const savedPostCount = clampInt(
      counts.savedPostCount ?? existingData?.savedPostCount ?? 0,
      0,
      10000
    );
    try {
      await updateDoc(ref, {
        folderName,
        videoCount,
        savedPostCount,
        language,
        appName,
        appStoreUrl,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  }

  return lookupId;
}

export function subscribeFolderLookups(
  uid: string,
  onData: (lookups: SavedFolderLookup[]) => void
): () => void {
  const path = 'folderLookups';
  const q = query(collection(db, 'folderLookups'), where('ownerId', '==', uid));

  return onSnapshot(
    q,
    (snapshot) => {
      const items: SavedFolderLookup[] = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          ownerId: String(data.ownerId || uid),
          folderId: String(data.folderId || ''),
          folderName: String(data.folderName || 'Google Drive Folder'),
          videoCount: Number(data.videoCount || 0),
          savedPostCount: Number(data.savedPostCount || 0),
          language: String(data.language || 'English'),
          appName: String(data.appName || ''),
          appStoreUrl: String(data.appStoreUrl || ''),
          createdAtMs: toMillis(data.createdAt),
          updatedAtMs: toMillis(data.updatedAt),
        };
      });
      items.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
      onData(items);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export async function deleteFolderLookup(lookupId: string): Promise<void> {
  const lookupPath = `folderLookups/${lookupId}`;
  try {
    await deleteDoc(doc(db, 'folderLookups', lookupId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, lookupPath);
  }
}

export async function saveDeliveryLogRecord(
  user: User,
  entry: DeliveryLogEntry
): Promise<void> {
  const logId = sanitizeId(entry.id || `${entry.videoId}_${Date.now()}`);
  const path = `deliveryLogs/${logId}`;
  const ref = doc(db, 'deliveryLogs', logId);
  const safeResults = (entry.results || []).slice(0, 5).map((r) => ({
    platform: r.platform,
    status: r.status,
    method: r.method,
    httpStatus: typeof r.httpStatus === 'number' ? r.httpStatus : 0,
    externalId: clampStr(r.externalId, 200),
    message: clampStr(r.message, 500),
    deliveredAt: clampStr(r.deliveredAt, 64),
  }));

  if (safeResults.length === 0) return;

  try {
    await setDoc(ref, {
      ownerId: sanitizeId(user.uid),
      folderId: sanitizeId(entry.folderId || 'drive_folder'),
      folderName:
        clampStr(entry.folderName, 200, 'Google Drive Folder').trim() || 'Google Drive Folder',
      videoId: sanitizeId(entry.videoId),
      videoName: clampStr(entry.videoName, 260, 'video.mp4').trim() || 'video.mp4',
      triggeredBy: entry.triggeredBy === 'auto_watch' ? 'auto_watch' : 'manual',
      timestamp: clampStr(entry.timestamp, 64, new Date().toISOString()),
      results: safeResults,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export function subscribeDeliveryLogs(
  uid: string,
  onData: (logs: DeliveryLogEntry[]) => void
): () => void {
  const path = 'deliveryLogs';
  const q = query(collection(db, 'deliveryLogs'), where('ownerId', '==', uid));

  return onSnapshot(
    q,
    (snapshot) => {
      const logs: DeliveryLogEntry[] = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          folderId: data.folderId ? String(data.folderId) : undefined,
          folderName: data.folderName ? String(data.folderName) : undefined,
          videoId: String(data.videoId || ''),
          videoName: String(data.videoName || 'video.mp4'),
          triggeredBy: data.triggeredBy === 'auto_watch' ? 'auto_watch' : 'manual',
          timestamp: String(data.timestamp || new Date().toISOString()),
          results: Array.isArray(data.results) ? data.results : [],
        };
      });
      logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      onData(logs);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export async function saveUserPreferences(
  user: User,
  settings: GenerationSettings,
  lastFolder: DriveFolder | null
): Promise<void> {
  const userId = sanitizeId(user.uid);
  const path = `userPreferences/${userId}`;
  const ref = doc(db, 'userPreferences', userId);

  let snap;
  try {
    snap = await getDoc(ref);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }

  const payload = {
    language: clampStr(settings.language, 40, 'English') || 'English',
    tone: clampStr(settings.tone, 60, 'Energetic & Viral') || 'Energetic & Viral',
    brandHandle: clampStr(settings.brandHandle, 120),
    callToAction: clampStr(settings.callToAction, 250),
    targetAudience: clampStr(settings.targetAudience, 250),
    appStoreUrl: clampStr(settings.appStoreUrl, 500),
    appName: clampStr(settings.appName, 120),
    analysisDepth: settings.analysisDepth === 'deep' ? ('deep' as const) : ('fast' as const),
    lastFolderId: lastFolder ? sanitizeId(lastFolder.id) : '',
    lastFolderName: lastFolder ? clampStr(lastFolder.name, 200) : '',
  };

  if (!snap.exists()) {
    try {
      await setDoc(ref, {
        ownerId: userId,
        ...payload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  } else {
    try {
      await updateDoc(ref, {
        ...payload,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  }
}

export async function loadUserPreferences(uid: string): Promise<{
  settings: Partial<GenerationSettings>;
  lastFolder: DriveFolder | null;
} | null> {
  const userId = sanitizeId(uid);
  const path = `userPreferences/${userId}`;
  try {
    const snap = await getDoc(doc(db, 'userPreferences', userId));
    if (!snap.exists()) return null;
    const data = snap.data();
    const lastFolderId = String(data.lastFolderId || '').trim();
    const lastFolderName = String(data.lastFolderName || '').trim();
    return {
      settings: {
        language: (data.language as GenerationSettings['language']) || 'English',
        tone: (data.tone as GenerationSettings['tone']) || 'Energetic & Viral',
        brandHandle: String(data.brandHandle || ''),
        callToAction: String(data.callToAction || ''),
        targetAudience: String(data.targetAudience || ''),
        appStoreUrl: String(data.appStoreUrl || ''),
        appName: String(data.appName || ''),
        analysisDepth: data.analysisDepth === 'deep' ? 'deep' : 'fast',
      },
      lastFolder:
        lastFolderId && lastFolderName
          ? { id: lastFolderId, name: lastFolderName }
          : null,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}
