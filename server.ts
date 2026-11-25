import 'dotenv/config';
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import express from 'express';
import type { Request, Response } from 'express';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

const PORT = Number(process.env.PORT || 3000);
const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const MAX_VIDEO_ANALYZE_BYTES = 20 * 1024 * 1024; // 20 MB cap for deep video mode

type PlatformKey = 'instagram' | 'facebook' | 'pinterest' | 'tiktok' | 'youtube';

interface MediaTokenEntry {
  fileId: string;
  accessToken: string;
  mimeType: string;
  fileName: string;
  fileSize?: number;
  kind: 'video' | 'thumb';
  thumbnailLink?: string;
  expiresAt: number;
}

const mediaTokenStore = new Map<string, MediaTokenEntry>();

// Periodic cleanup of expired short-lived media/thumb tokens
setInterval(() => {
  const now = Date.now();
  for (const [token, entry] of mediaTokenStore.entries()) {
    if (entry.expiresAt <= now) {
      mediaTokenStore.delete(token);
    }
  }
}, 5 * 60 * 1000).unref();

function mintMediaToken(entry: Omit<MediaTokenEntry, 'expiresAt'>, ttlMs: number): string {
  const token = crypto.randomBytes(24).toString('hex');
  mediaTokenStore.set(token, {
    ...entry,
    expiresAt: Date.now() + ttlMs,
  });
  return token;
}

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured on the server.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      apiVersion: 'v1beta',
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function extractBearerToken(req: Request): string | null {
  const customHeader = req.headers['x-drive-access-token'];
  if (typeof customHeader === 'string' && customHeader.trim().length > 10) {
    return customHeader.trim();
  }
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.slice(7).trim();
  return token.length > 10 ? token : null;
}

function isValidDriveId(id: string): boolean {
  return id === 'root' || /^[a-zA-Z0-9_-]{4,128}$/.test(id);
}

function parseFolderIdInput(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const folderUrlMatch = trimmed.match(/\/folders\/([a-zA-Z0-9_-]{4,128})/);
  if (folderUrlMatch) return folderUrlMatch[1];
  const idParamMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]{4,128})/);
  if (idParamMatch) return idParamMatch[1];
  if (isValidDriveId(trimmed)) return trimmed;
  return null;
}

function getRequestOrigin(req?: Request): string | null {
  if (!req) return null;
  const forwardedProto = req.headers['x-forwarded-proto'];
  const proto =
    typeof forwardedProto === 'string' && forwardedProto.trim()
      ? forwardedProto.split(',')[0].trim()
      : req.protocol || 'https';
  const forwardedHost = req.headers['x-forwarded-host'];
  const host =
    typeof forwardedHost === 'string' && forwardedHost.trim()
      ? forwardedHost.split(',')[0].trim()
      : req.get('host');
  if (!host) return null;
  return `${proto}://${host}`.replace(/\/+$/, '');
}

function getAppBaseUrl(req?: Request): string {
  const publicOverride = (process.env.PUBLIC_APP_URL || '').trim().replace(/\/+$/, '');
  if (publicOverride && /^https?:\/\//i.test(publicOverride)) {
    return publicOverride;
  }

  const reqOrigin = getRequestOrigin(req);
  const configured = (process.env.APP_URL || '').trim().replace(/\/+$/, '');
  if (configured && /^https?:\/\//i.test(configured)) {
    const isPrivateDevUrl = /^https?:\/\/ais-dev-/i.test(configured);
    const reqIsPublic = reqOrigin && !/^https?:\/\/ais-dev-/i.test(reqOrigin);
    if (!isPrivateDevUrl || !reqIsPublic) {
      return configured;
    }
  }

  if (reqOrigin) {
    return reqOrigin;
  }
  return `http://localhost:${PORT}`;
}

function isPrivateOrReservedIp(ip: string): boolean {
  const version = net.isIP(ip);
  if (version === 4) {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true;
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }
  if (version === 6) {
    const normalized = ip.toLowerCase();
    if (normalized === '::' || normalized === '::1') return true;
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
    if (normalized.startsWith('fe80')) return true;
    if (normalized.startsWith('::ffff:')) {
      const mapped = normalized.slice(7);
      if (net.isIPv4(mapped)) return isPrivateOrReservedIp(mapped);
    }
    return false;
  }
  return true;
}

async function assertSafeExternalWebhookUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error('Invalid webhook URL format.');
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('Webhook URL must use HTTPS.');
  }

  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.localhost')
  ) {
    throw new Error('Local or internal webhook hostnames are not allowed.');
  }

  if (net.isIP(host)) {
    if (isPrivateOrReservedIp(host)) {
      throw new Error('Private or loopback IP addresses are not allowed for webhooks.');
    }
    return parsed;
  }

  const addresses = await dns.lookup(host, { all: true });
  if (!addresses.length) {
    throw new Error('Webhook hostname could not be resolved.');
  }
  for (const addr of addresses) {
    if (isPrivateOrReservedIp(addr.address)) {
      throw new Error('Webhook resolves to a restricted network address.');
    }
  }
  return parsed;
}

async function driveJsonFetch(url: string, accessToken: string) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const apiMessage =
      (data as { error?: { message?: string } })?.error?.message ||
      `Google Drive API returned status ${response.status}`;
    const err = new Error(apiMessage) as Error & { status?: number };
    err.status = response.status;
    throw err;
  }
  return data;
}

function getExtensionFromMime(mimeType: string, fileName: string): string {
  const ext = path.extname(fileName);
  if (ext && ext.length <= 6) return ext;
  if (mimeType.includes('quicktime')) return '.mov';
  if (mimeType.includes('webm')) return '.webm';
  return '.mp4';
}

const POSTS_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    detectedTopic: {
      type: Type.STRING,
      description: 'Concise 1-sentence summary of what happens in the video.',
    },
    hookAngle: {
      type: Type.STRING,
      description: 'Core viral hook or storytelling angle extracted from the video.',
    },
    instagram: {
      type: Type.OBJECT,
      properties: {
        caption: { type: Type.STRING, description: 'Hook-first Instagram Reels caption with clean line breaks.' },
        hashtags: { type: Type.ARRAY, items: { type: Type.STRING } },
        coverHeadline: { type: Type.STRING, description: 'Short 3-6 word Reels cover text.' },
        bestTimeHint: { type: Type.STRING, description: 'Recommended posting window.' },
        formatNote: { type: Type.STRING, description: 'Reels / aspect ratio note.' },
      },
      required: ['caption', 'hashtags', 'coverHeadline', 'bestTimeHint', 'formatNote'],
    },
    facebook: {
      type: Type.OBJECT,
      properties: {
        headline: { type: Type.STRING, description: 'Video title for Facebook.' },
        postText: { type: Type.STRING, description: 'Share-friendly Facebook narrative copy.' },
        engagementQuestion: { type: Type.STRING, description: 'Comment-driving question.' },
        hashtags: { type: Type.ARRAY, items: { type: Type.STRING } },
        bestTimeHint: { type: Type.STRING },
      },
      required: ['headline', 'postText', 'engagementQuestion', 'hashtags', 'bestTimeHint'],
    },
    pinterest: {
      type: Type.OBJECT,
      properties: {
        pinTitle: { type: Type.STRING, description: 'SEO-optimized Pin title under 100 characters.' },
        pinDescription: { type: Type.STRING, description: 'Keyword-rich Pin description under 500 characters.' },
        suggestedBoard: { type: Type.STRING, description: 'Suggested Pinterest board name.' },
        keywords: { type: Type.ARRAY, items: { type: Type.STRING } },
        altText: { type: Type.STRING, description: 'Accessible descriptive alt text.' },
      },
      required: ['pinTitle', 'pinDescription', 'suggestedBoard', 'keywords', 'altText'],
    },
    tiktok: {
      type: Type.OBJECT,
      properties: {
        caption: { type: Type.STRING, description: 'Punchy TikTok caption.' },
        onScreenHook: { type: Type.STRING, description: 'Opening 3-second text overlay hook.' },
        hashtags: { type: Type.ARRAY, items: { type: Type.STRING } },
        soundOrPacingTip: { type: Type.STRING, description: 'Pacing or audio tip for TikTok.' },
      },
      required: ['caption', 'onScreenHook', 'hashtags', 'soundOrPacingTip'],
    },
    youtube: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING, description: 'Catchy YouTube Shorts title under 100 chars including #Shorts.' },
        description: { type: Type.STRING, description: 'YouTube Shorts description with value summary, Play Store link, and CTA.' },
        tags: { type: Type.ARRAY, items: { type: Type.STRING }, description: '8-15 YouTube search keyword tags.' },
        hashtags: { type: Type.ARRAY, items: { type: Type.STRING }, description: '3-5 hashtags starting with # including #Shorts.' },
        pinnedComment: { type: Type.STRING, description: 'Engaging pinned first comment driving downloads or discussion.' },
      },
      required: ['title', 'description', 'tags', 'hashtags', 'pinnedComment'],
    },
  },
  required: ['detectedTopic', 'hookAngle', 'instagram', 'facebook', 'pinterest', 'tiktok', 'youtube'],
};

async function startServer() {
  const app = express();
  app.set('trust proxy', true);
  app.use(express.json({ limit: '4mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  // List folders in Google Drive
  app.get('/api/drive/folders', async (req: Request, res: Response) => {
    try {
      const accessToken = extractBearerToken(req);
      if (!accessToken) {
        res.status(401).json({ error: 'Google Drive sign-in is required.' });
        return;
      }

      const parentId = typeof req.query.parentId === 'string' && req.query.parentId ? req.query.parentId : 'root';
      if (!isValidDriveId(parentId)) {
        res.status(400).json({ error: 'Invalid parent folder ID.' });
        return;
      }

      const search = typeof req.query.q === 'string' ? req.query.q.trim() : '';
      let query = "mimeType = 'application/vnd.google-apps.folder' and trashed = false";
      if (search) {
        const escaped = search.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        query += ` and name contains '${escaped}'`;
      } else {
        query += ` and '${parentId}' in parents`;
      }

      const params = new URLSearchParams({
        q: query,
        fields: 'files(id,name,modifiedTime)',
        orderBy: 'folder,name',
        pageSize: '60',
        includeItemsFromAllDrives: 'true',
        supportsAllDrives: 'true',
      });

      const data = await driveJsonFetch(`${DRIVE_API_BASE}/files?${params.toString()}`, accessToken);
      res.json({ folders: (data as { files?: unknown[] }).files || [] });
    } catch (err) {
      const e = err as Error & { status?: number };
      res.status(e.status || 500).json({ error: e.message || 'Failed to list Drive folders.' });
    }
  });

  // Resolve folder metadata and list all video files inside the selected folder
  app.get('/api/drive/folder-videos', async (req: Request, res: Response) => {
    try {
      const accessToken = extractBearerToken(req);
      if (!accessToken) {
        res.status(401).json({ error: 'Google Drive sign-in is required.' });
        return;
      }

      const rawFolderInput = typeof req.query.folderId === 'string' ? req.query.folderId : '';
      const folderId = parseFolderIdInput(rawFolderInput);
      if (!folderId) {
        res.status(400).json({ error: 'Please provide a valid Google Drive folder link or folder ID.' });
        return;
      }

      let folderName = 'My Drive';
      if (folderId !== 'root') {
        const metaParams = new URLSearchParams({
          fields: 'id,name,mimeType',
          supportsAllDrives: 'true',
        });
        const folderMeta = (await driveJsonFetch(
          `${DRIVE_API_BASE}/files/${encodeURIComponent(folderId)}?${metaParams.toString()}`,
          accessToken
        )) as { id: string; name: string; mimeType: string };
        if (folderMeta.mimeType !== 'application/vnd.google-apps.folder') {
          res.status(400).json({ error: 'The provided ID is not a Google Drive folder.' });
          return;
        }
        folderName = folderMeta.name;
      }

      const query = `'${folderId}' in parents and mimeType contains 'video/' and trashed = false`;
      const listParams = new URLSearchParams({
        q: query,
        fields: 'files(id,name,mimeType,size,createdTime,modifiedTime,thumbnailLink,webViewLink,videoMediaMetadata(width,height,durationMillis))',
        orderBy: 'createdTime desc',
        pageSize: '100',
        includeItemsFromAllDrives: 'true',
        supportsAllDrives: 'true',
      });

      const listData = (await driveJsonFetch(
        `${DRIVE_API_BASE}/files?${listParams.toString()}`,
        accessToken
      )) as {
        files?: Array<{
          id: string;
          name: string;
          mimeType: string;
          size?: string;
          createdTime?: string;
          modifiedTime?: string;
          thumbnailLink?: string;
          webViewLink?: string;
          videoMediaMetadata?: {
            width?: number;
            height?: number;
            durationMillis?: string;
          };
        }>;
      };

      const videos = (listData.files || []).map((file) => {
        let thumbUrl: string | undefined;
        if (file.thumbnailLink) {
          const thumbToken = mintMediaToken(
            {
              fileId: file.id,
              accessToken,
              mimeType: 'image/jpeg',
              fileName: `${file.name}.jpg`,
              kind: 'thumb',
              thumbnailLink: file.thumbnailLink,
            },
            60 * 60 * 1000
          );
          thumbUrl = `/api/drive/thumb/${thumbToken}`;
        }

        return {
          id: file.id,
          name: file.name,
          mimeType: file.mimeType,
          size: Number(file.size || 0),
          createdTime: file.createdTime,
          modifiedTime: file.modifiedTime,
          webViewLink: file.webViewLink,
          thumbUrl,
          durationMillis: file.videoMediaMetadata?.durationMillis
            ? Number(file.videoMediaMetadata.durationMillis)
            : undefined,
          width: file.videoMediaMetadata?.width,
          height: file.videoMediaMetadata?.height,
        };
      });

      res.json({
        folder: { id: folderId, name: folderName },
        videos,
      });
    } catch (err) {
      const e = err as Error & { status?: number };
      res.status(e.status || 500).json({ error: e.message || 'Failed to read Drive folder.' });
    }
  });

  // Public token-signed thumbnail proxy (no login or cookie required)
  app.get('/api/drive/thumb/:token', async (req: Request, res: Response) => {
    try {
      const token = String(req.params.token || '');
      const entry = mediaTokenStore.get(token);
      if (!entry || entry.kind !== 'thumb' || entry.expiresAt <= Date.now()) {
        res.status(404).end();
        return;
      }

      let thumbnailLink = entry.thumbnailLink;
      if (!thumbnailLink) {
        const metaParams = new URLSearchParams({
          fields: 'thumbnailLink',
          supportsAllDrives: 'true',
        });
        const meta = (await driveJsonFetch(
          `${DRIVE_API_BASE}/files/${encodeURIComponent(entry.fileId)}?${metaParams.toString()}`,
          entry.accessToken
        )) as { thumbnailLink?: string };
        thumbnailLink = meta.thumbnailLink;
        if (thumbnailLink) {
          entry.thumbnailLink = thumbnailLink;
        }
      }

      if (!thumbnailLink) {
        res.status(404).end();
        return;
      }

      const upstream = await fetch(thumbnailLink, {
        headers: { Authorization: `Bearer ${entry.accessToken}` },
      });
      if (!upstream.ok) {
        res.status(upstream.status).end();
        return;
      }

      const upstreamType = (upstream.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      const contentType = upstreamType.startsWith('image/') ? upstreamType : 'image/jpeg';
      const buf = Buffer.from(await upstream.arrayBuffer());
      const total = buf.byteLength;

      res.setHeader('Content-Type', contentType);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'public, max-age=1800');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

      const rangeHeader = typeof req.headers.range === 'string' ? req.headers.range.trim() : '';
      if (rangeHeader && total > 0) {
        const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/i);
        if (match) {
          const start = match[1] ? Number(match[1]) : Math.max(0, total - Number(match[2] || 0));
          const end = match[1] && match[2] ? Math.min(total - 1, Number(match[2])) : total - 1;
          if (Number.isFinite(start) && Number.isFinite(end) && start >= 0 && start <= end && start < total) {
            const slice = buf.subarray(start, end + 1);
            res.status(206);
            res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
            res.setHeader('Content-Length', String(slice.byteLength));
            if (req.method === 'HEAD') {
              res.end();
              return;
            }
            res.send(slice);
            return;
          }
          res.status(416);
          res.setHeader('Content-Range', `bytes */${total}`);
          res.end();
          return;
        }
      }

      res.status(200);
      res.setHeader('Content-Length', String(total));
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      res.send(buf);
    } catch {
      res.status(502).end();
    }
  });

  // Short-lived signed media proxy so Make / Zapier / n8n / Meta / Pinterest / TikTok can pull the raw video without login/cookies
  app.get('/api/media/stream/:token', async (req: Request, res: Response) => {
    try {
      const token = String(req.params.token || '');
      const entry = mediaTokenStore.get(token);
      if (!entry || entry.kind !== 'video' || entry.expiresAt <= Date.now()) {
        res.status(404).json({ error: 'Media stream link expired or invalid.' });
        return;
      }

      const driveMediaUrl = `${DRIVE_API_BASE}/files/${encodeURIComponent(entry.fileId)}?alt=media&supportsAllDrives=true`;
      const rangeHeader = typeof req.headers.range === 'string' ? req.headers.range.trim() : '';

      if (req.method === 'HEAD') {
        const headHeaders: Record<string, string> = {
          Authorization: `Bearer ${entry.accessToken}`,
        };
        if (rangeHeader) headHeaders.Range = rangeHeader;

        const upstreamHead = await fetch(driveMediaUrl, {
          method: 'HEAD',
          headers: headHeaders,
        });

        let resolvedLength = upstreamHead.headers.get('content-length');
        let resolvedType = (upstreamHead.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        const contentRange = upstreamHead.headers.get('content-range');

        if (!upstreamHead.ok || !resolvedLength) {
          const metaParams = new URLSearchParams({
            fields: 'size,mimeType',
            supportsAllDrives: 'true',
          });
          const meta = (await driveJsonFetch(
            `${DRIVE_API_BASE}/files/${encodeURIComponent(entry.fileId)}?${metaParams.toString()}`,
            entry.accessToken
          )) as { size?: string; mimeType?: string };
          if (!resolvedLength && meta.size) {
            resolvedLength = String(meta.size);
          }
          if (!resolvedType && meta.mimeType) {
            resolvedType = meta.mimeType.toLowerCase();
          }
        }

        const contentType = resolvedType.startsWith('video/')
          ? resolvedType
          : entry.mimeType && entry.mimeType.startsWith('video/')
            ? entry.mimeType
            : 'video/mp4';

        res.status(upstreamHead.status === 206 ? 206 : 200);
        res.setHeader('Content-Type', contentType);
        res.setHeader('Accept-Ranges', 'bytes');
        if (resolvedLength) {
          res.setHeader('Content-Length', resolvedLength);
        } else if (entry.fileSize) {
          res.setHeader('Content-Length', String(entry.fileSize));
        }
        if (contentRange) {
          res.setHeader('Content-Range', contentRange);
        }
        const safeFilename = entry.fileName.replace(/["\r\n]/g, '_');
        res.setHeader('Content-Disposition', `inline; filename="${safeFilename}"`);
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        res.setHeader('Cache-Control', 'no-store');
        res.end();
        return;
      }

      const headers: Record<string, string> = {
        Authorization: `Bearer ${entry.accessToken}`,
      };
      if (rangeHeader) {
        headers.Range = rangeHeader;
      }

      const upstream = await fetch(driveMediaUrl, { headers });

      if (upstream.status === 416) {
        res.status(416);
        res.setHeader('Accept-Ranges', 'bytes');
        const contentRange = upstream.headers.get('content-range');
        if (contentRange) {
          res.setHeader('Content-Range', contentRange);
        } else if (entry.fileSize) {
          res.setHeader('Content-Range', `bytes */${entry.fileSize}`);
        }
        res.end();
        return;
      }

      if (!upstream.ok || !upstream.body) {
        res.status(upstream.status || 502).json({ error: 'Failed to stream video from Google Drive.' });
        return;
      }

      const upstreamType = (upstream.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      const contentType = upstreamType.startsWith('video/')
        ? upstreamType
        : entry.mimeType && entry.mimeType.startsWith('video/')
          ? entry.mimeType
          : 'video/mp4';

      res.status(upstream.status);
      res.setHeader('Content-Type', contentType);
      res.setHeader('Accept-Ranges', 'bytes');

      let contentLength = upstream.headers.get('content-length');
      if (!contentLength && upstream.status === 200) {
        if (entry.fileSize) {
          contentLength = String(entry.fileSize);
        } else {
          try {
            const metaParams = new URLSearchParams({
              fields: 'size',
              supportsAllDrives: 'true',
            });
            const meta = (await driveJsonFetch(
              `${DRIVE_API_BASE}/files/${encodeURIComponent(entry.fileId)}?${metaParams.toString()}`,
              entry.accessToken
            )) as { size?: string };
            if (meta.size) {
              contentLength = String(meta.size);
              entry.fileSize = Number(meta.size) || undefined;
            }
          } catch {
            // Proceed with streaming if size lookup fails
          }
        }
      }
      if (contentLength) {
        res.setHeader('Content-Length', contentLength);
      }

      const contentRange = upstream.headers.get('content-range');
      if (contentRange) {
        res.setHeader('Content-Range', contentRange);
      }

      const safeFilename = entry.fileName.replace(/["\r\n]/g, '_');
      res.setHeader('Content-Disposition', `inline; filename="${safeFilename}"`);
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.setHeader('Cache-Control', 'no-store');

      await pipeline(Readable.fromWeb(upstream.body as never), res);
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({ error: (err as Error).message || 'Stream error' });
      }
    }
  });

  // Generate tailored 4-platform social posts for a Drive video using Gemini 4 Hydrogen
  app.post('/api/videos/generate-posts', async (req: Request, res: Response) => {
    let tempFilePath: string | null = null;
    let uploadedGeminiFileName: string | null = null;
    let ai: GoogleGenAI | null = null;

    try {
      const accessToken = extractBearerToken(req);
      if (!accessToken) {
        res.status(401).json({ error: 'Google Drive sign-in is required.' });
        return;
      }

      const {
        fileId,
        fileName,
        mimeType,
        size,
        durationMillis,
        width,
        height,
        language = 'English',
        tone = 'Energetic & Viral',
        brandHandle = '',
        callToAction = '',
        targetAudience = '',
        appStoreUrl = '',
        appName = '',
        analysisDepth = 'fast',
      } = req.body || {};

      if (typeof fileId !== 'string' || !isValidDriveId(fileId) || fileId === 'root') {
        res.status(400).json({ error: 'Invalid video file ID.' });
        return;
      }

      ai = getAiClient();
      const safeName = typeof fileName === 'string' && fileName ? fileName : 'video.mp4';
      const safeMime = typeof mimeType === 'string' && mimeType.startsWith('video/') ? mimeType : 'video/mp4';
      const fileSizeBytes = Number(size || 0);
      const durationSec = durationMillis ? Math.round(Number(durationMillis) / 1000) : null;
      const cleanAppUrl = typeof appStoreUrl === 'string' && /^https?:\/\//i.test(appStoreUrl.trim()) ? appStoreUrl.trim() : '';
      const cleanAppName = typeof appName === 'string' ? appName.trim() : '';

      const promptText = `You are an expert social media strategist and mobile app marketing copywriter.
Analyze this video and generate ready-to-publish, platform-native posts for ALL FIVE platforms: Instagram, Facebook, Pinterest, TikTok, and YouTube Shorts.

Video details:
- File name: ${safeName}
- Duration: ${durationSec !== null ? `${durationSec} seconds` : 'unknown'}
- Resolution: ${width && height ? `${width}x${height}` : 'unknown'}

Creator & App brief:
- App Name: ${cleanAppName || 'Not specified'}
- Google Play Store / App Link: ${cleanAppUrl || 'Not specified'}
- Post Language: ${language} (Note: If "Moroccan Darija", write natural, authentic Moroccan Darija mixed smoothly with popular social expressions as Moroccan creators write on Instagram/TikTok/YouTube Shorts; keep hashtags relevant and high-reach).
- Tone & Style: ${tone}
- Brand / Creator Handle: ${brandHandle || 'Not specified'}
- Call To Action: ${callToAction || 'Download the app on Google Play'}
- Target Audience: ${targetAudience || 'Android mobile users & social media audience'}

Requirements per platform:
1. Instagram: Scroll-stopping hook in the first line, engaging story/value body highlighting the app, clear Play Store download CTA (e.g., link in bio / search on Google Play), clean spacing, and 12-18 relevant hashtags.
2. Facebook: Conversational, share-worthy narrative with a clear headline, an engagement question to spark comments, plus 3-5 hashtags.${cleanAppUrl ? ` Include this exact Google Play download link naturally in the postText: ${cleanAppUrl}` : ''}
3. Pinterest: Search-friendly Pin Title (<= 100 chars), keyword-rich Pin Description (<= 500 chars) encouraging users to get the app on Google Play, suggested Board name, 6-10 SEO keywords, and descriptive altText.
4. TikTok: Short punchy caption encouraging viewers to check the app on Google Play / link in bio, strong 3-second onScreenHook text overlay, 5-8 trending/niche hashtags, and soundOrPacingTip.
5. YouTube Shorts: High-CTR Shorts title (<= 100 chars, ending with #Shorts), SEO-rich Shorts description${cleanAppUrl ? ` including this exact download link: ${cleanAppUrl}` : ' with clear Play Store CTA'}, 8-15 relevant search tags (without #), 3-5 hashtags (including #Shorts), and a pinnedComment ready to pin under the Short.`;

      let analysisMode: 'full_video' | 'frame_and_metadata' = 'frame_and_metadata';
      const contentParts: Array<Record<string, unknown>> = [];

      // Optional deep video multimodal analysis via Gemini Files API (strictly bounded to 20s)
      if (analysisDepth === 'deep' && fileSizeBytes > 0 && fileSizeBytes <= MAX_VIDEO_ANALYZE_BYTES) {
        try {
          const mediaResp = await fetch(
            `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
            {
              headers: { Authorization: `Bearer ${accessToken}` },
              signal: AbortSignal.timeout(15000),
            }
          );

          if (mediaResp.ok && mediaResp.body) {
            const ext = getExtensionFromMime(safeMime, safeName);
            tempFilePath = path.join(os.tmpdir(), `drivecast-${crypto.randomUUID()}${ext}`);
            await pipeline(Readable.fromWeb(mediaResp.body as never), fs.createWriteStream(tempFilePath));

            const uploaded = await ai.files.upload({
              file: tempFilePath,
              config: {
                mimeType: safeMime,
                displayName: safeName,
              },
            });

            if (uploaded.name && uploaded.uri) {
              uploadedGeminiFileName = uploaded.name;
              let fileState = uploaded.state;
              const deadline = Date.now() + 20000;
              while (fileState === 'PROCESSING' && Date.now() < deadline) {
                await new Promise((resolve) => setTimeout(resolve, 1200));
                const check = await ai.files.get({ name: uploaded.name });
                fileState = check.state;
              }
              if (fileState === 'ACTIVE') {
                contentParts.push({
                  fileData: {
                    fileUri: uploaded.uri,
                    mimeType: uploaded.mimeType || safeMime,
                  },
                });
                analysisMode = 'full_video';
              }
            }
          }
        } catch (videoErr) {
          console.warn('Deep video upload fallback to thumbnail/metadata:', (videoErr as Error).message);
        }
      }

      // Fast frame + metadata analysis (default ~2-4s, or automatic fallback)
      if (contentParts.length === 0) {
        try {
          const metaParams = new URLSearchParams({
            fields: 'thumbnailLink',
            supportsAllDrives: 'true',
          });
          const meta = (await driveJsonFetch(
            `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?${metaParams.toString()}`,
            accessToken
          )) as { thumbnailLink?: string };

          if (meta.thumbnailLink) {
            const hiResThumb = meta.thumbnailLink.replace(/=s\d+$/, '=s1024');
            let thumbResp = await fetch(hiResThumb, {
              headers: { Authorization: `Bearer ${accessToken}` },
              signal: AbortSignal.timeout(8000),
            });
            if (!thumbResp.ok && hiResThumb !== meta.thumbnailLink) {
              thumbResp = await fetch(meta.thumbnailLink, {
                headers: { Authorization: `Bearer ${accessToken}` },
                signal: AbortSignal.timeout(8000),
              });
            }
            if (thumbResp.ok) {
              const thumbBuf = Buffer.from(await thumbResp.arrayBuffer());
              const thumbMime = thumbResp.headers.get('content-type') || 'image/jpeg';
              contentParts.push({
                inlineData: {
                  mimeType: thumbMime,
                  data: thumbBuf.toString('base64'),
                },
              });
            }
          }
        } catch {
          // Proceed with metadata-only if thumbnail is unavailable
        }
      }

      contentParts.push({ text: promptText });

      const modelAttempts: Array<{ model: string; useLowThinking: boolean; delayMs: number }> = [
        { model: 'gemini-2.5-flash', useLowThinking: false, delayMs: 0 },
        { model: 'gemini-4-hydrogen', useLowThinking: true, delayMs: 1000 },
        { model: 'gemini-3.1-flash-lite', useLowThinking: false, delayMs: 1500 },
        { model: 'gemini-2.5-flash', useLowThinking: false, delayMs: 2000 },
      ];

      let responseText: string | undefined;
      let lastModelErr: unknown = null;

      for (const attempt of modelAttempts) {
        if (attempt.delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, attempt.delayMs));
        }
        try {
          const response = await ai.models.generateContent({
            model: attempt.model,
            contents: { parts: contentParts as never },
            config: {
              ...(attempt.useLowThinking
                ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
                : {}),
              responseMimeType: 'application/json',
              responseSchema: POSTS_RESPONSE_SCHEMA,
            },
          });
          responseText = response.text;
          break;
        } catch (modelErr) {
          lastModelErr = modelErr;
          const msg = String((modelErr as Error)?.message || '');
          const isTransient =
            msg.includes('503') ||
            msg.includes('UNAVAILABLE') ||
            msg.includes('high demand') ||
            msg.includes('429') ||
            msg.includes('500');
          if (!isTransient) {
            throw modelErr;
          }
        }
      }

      if (!responseText) {
        throw lastModelErr || new Error('The AI service is temporarily busy. Please try again in a moment.');
      }

      const rawJson = (responseText || '{}').trim();
      const parsed = JSON.parse(rawJson);

      res.json({
        ...parsed,
        appStoreUrl: cleanAppUrl || undefined,
        pinterest: {
          ...(parsed.pinterest || {}),
          destinationLink: cleanAppUrl || '',
        },
        youtube: {
          ...(parsed.youtube || {}),
          privacyStatus: 'public',
        },
        analysisMode,
        generatedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error('Generate posts error:', err);
      let friendlyMsg = (err as Error).message || 'Failed to generate social media posts.';
      try {
        const parsedErr = JSON.parse(friendlyMsg);
        if (parsedErr?.error?.message) {
          friendlyMsg = parsedErr.error.message;
        }
      } catch {
        // Keep plain string message
      }
      res.status(500).json({
        error: friendlyMsg,
      });
    } finally {
      if (tempFilePath) {
        fs.promises.unlink(tempFilePath).catch(() => {});
      }
      if (ai && uploadedGeminiFileName) {
        ai.files.delete({ name: uploadedGeminiFileName }).catch(() => {});
      }
    }
  });

  // Test a user's automation webhook URL
  app.post('/api/channels/test-webhook', async (req: Request, res: Response) => {
    try {
      const accessToken = extractBearerToken(req);
      if (!accessToken) {
        res.status(401).json({ error: 'Google Drive sign-in is required.' });
        return;
      }
      const { webhookUrl, secretHeader } = req.body || {};
      if (typeof webhookUrl !== 'string' || !webhookUrl.trim()) {
        res.status(400).json({ error: 'Webhook URL is required.' });
        return;
      }

      const safeUrl = await assertSafeExternalWebhookUrl(webhookUrl);
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': 'DriveCast-Studio/1.0',
      };
      if (typeof secretHeader === 'string' && secretHeader.trim()) {
        headers['X-DriveCast-Secret'] = secretHeader.trim();
      }

      const sampleMediaToken = mintMediaToken(
        {
          fileId: 'sample_test_reel',
          accessToken,
          mimeType: 'video/mp4',
          fileName: 'technopamine_sample_reel.mp4',
          kind: 'video',
        },
        30 * 60 * 1000
      );
      const sampleStreamUrl = `${getAppBaseUrl(req)}/api/media/stream/${sampleMediaToken}`;

      const upstream = await fetch(safeUrl.toString(), {
        method: 'POST',
        headers,
        redirect: 'error',
        body: JSON.stringify({
          event: 'drivecast_webhook_test',
          sentAt: new Date().toISOString(),
          platforms: ['instagram', 'facebook', 'pinterest', 'tiktok', 'youtube'],
          video: {
            id: 'sample_test_reel',
            name: 'technopamine_sample_reel.mp4',
            mimeType: 'video/mp4',
            size: '12400000',
            durationMillis: 24000,
            width: 1080,
            height: 1920,
            streamUrl: sampleStreamUrl,
            thumbnailUrl: sampleStreamUrl,
            coverImageUrl: sampleStreamUrl,
            streamExpiresInMinutes: 30,
          },
          posts: {
            instagram: {
              caption: 'Check out this new reel! 🔥 Follow @technopamine for more. #viral #reels #technopamine',
              hashtags: ['#viral', '#reels', '#technopamine', '#trending'],
            },
            facebook: {
              headline: 'Technopamine Reel',
              postText: 'Check out this new video from Technopamine! Follow our page for daily updates.',
            },
            pinterest: {
              pinTitle: 'Technopamine Video Guide',
              pinDescription: 'Quick video tips and breakdown by Technopamine.',
              suggestedBoard: 'Technopamine',
            },
            tiktok: {
              caption: 'Wait till the end! 🚀 @technopamine #fyp #viral #trending',
              onScreenHook: 'Wait till the end',
              hashtags: ['#fyp', '#viral', '#technopamine'],
            },
            youtube: {
              title: 'Technopamine Quick Tips #Shorts',
              description: 'Watch this quick short to see how it works! Subscribe to Technopamine for daily videos. #Shorts',
              tags: ['shorts', 'tech', 'technopamine'],
              hashtags: ['#Shorts', '#technopamine'],
            },
          },
        }),
      });

      const text = await upstream.text().catch(() => '');
      res.json({
        ok: upstream.ok,
        status: upstream.status,
        responsePreview: text.slice(0, 240),
      });
    } catch (err) {
      res.status(400).json({ error: (err as Error).message || 'Webhook test failed.' });
    }
  });

  // Deliver prepared posts + signed video stream URL to configured platforms or automation webhooks
  app.post('/api/publish/deliver', async (req: Request, res: Response) => {
    try {
      const accessToken = extractBearerToken(req);
      if (!accessToken) {
        res.status(401).json({ error: 'Google Drive sign-in is required.' });
        return;
      }

      const { video, posts, platforms, channels } = req.body || {};
      if (!video?.id || !isValidDriveId(video.id) || !posts || !Array.isArray(platforms)) {
        res.status(400).json({ error: 'Missing video, posts, or target platforms.' });
        return;
      }

      const targetPlatforms = platforms.filter((p): p is PlatformKey =>
        ['instagram', 'facebook', 'pinterest', 'tiktok', 'youtube'].includes(p)
      );

      if (targetPlatforms.length === 0) {
        res.status(400).json({ error: 'Select at least one platform to deliver.' });
        return;
      }

      // Mint a 30-minute signed media proxy URL so Make / Zapier / n8n / Meta / Pinterest / TikTok can pull the raw video
      const baseUrl = getAppBaseUrl(req);
      const parsedFileSize = Number(video.size || 0);
      const mediaToken = mintMediaToken(
        {
          fileId: video.id,
          accessToken,
          mimeType: video.mimeType || 'video/mp4',
          fileName: video.name || 'video.mp4',
          fileSize: Number.isFinite(parsedFileSize) && parsedFileSize > 0 ? parsedFileSize : undefined,
          kind: 'video',
        },
        30 * 60 * 1000
      );
      const streamUrl = `${baseUrl}/api/media/stream/${mediaToken}`;
      let thumbnailUrl: string | undefined;
      if (
        video.thumbnailLink ||
        (typeof video.thumbUrl === 'string' && video.thumbUrl.startsWith('/api/drive/thumb/'))
      ) {
        const thumbToken = mintMediaToken(
          {
            fileId: video.id,
            accessToken,
            mimeType: 'image/jpeg',
            fileName: 'thumbnail.jpg',
            kind: 'thumb',
            thumbnailLink: typeof video.thumbnailLink === 'string' ? video.thumbnailLink : undefined,
          },
          30 * 60 * 1000
        );
        thumbnailUrl = `${baseUrl}/api/drive/thumb/${thumbToken}`;
      } else if (typeof video.thumbUrl === 'string' && video.thumbUrl.trim()) {
        thumbnailUrl = video.thumbUrl.startsWith('http')
          ? video.thumbUrl
          : `${baseUrl}${video.thumbUrl.startsWith('/') ? '' : '/'}${video.thumbUrl}`;
      }

      const videoPayload = {
        id: video.id,
        name: video.name,
        mimeType: video.mimeType,
        size: video.size,
        durationMillis: video.durationMillis,
        width: video.width,
        height: video.height,
        driveWebViewLink: video.webViewLink,
        streamUrl,
        thumbnailUrl: thumbnailUrl || streamUrl,
        coverImageUrl: thumbnailUrl || streamUrl,
        streamExpiresInMinutes: 30,
      };

      const mode = channels?.mode === 'direct' ? 'direct' : 'webhook';
      const results: Array<{
        platform: PlatformKey;
        status: 'delivered' | 'failed' | 'unconfigured';
        method: 'webhook' | 'direct_api' | 'none';
        httpStatus?: number;
        externalId?: string;
        message: string;
        deliveredAt: string;
      }> = [];

      if (mode === 'webhook') {
        const unifiedUrl = typeof channels?.unifiedWebhookUrl === 'string' ? channels.unifiedWebhookUrl.trim() : '';
        const secretHeader = typeof channels?.webhookSecretHeader === 'string' ? channels.webhookSecretHeader.trim() : '';
        const perPlatformWebhooks = channels?.platformWebhooks || {};

        // If a unified webhook is provided and no per-platform override is set for a platform,
        // check if we can send a single unified bundle or per-platform calls.
        const platformsUsingUnified: PlatformKey[] = [];

        for (const platform of targetPlatforms) {
          const specificUrl = typeof perPlatformWebhooks[platform] === 'string' ? perPlatformWebhooks[platform].trim() : '';
          if (specificUrl) {
            try {
              const safeUrl = await assertSafeExternalWebhookUrl(specificUrl);
              const headers: Record<string, string> = {
                'Content-Type': 'application/json',
                'User-Agent': 'DriveCast-Studio/1.0',
              };
              if (secretHeader) headers['X-DriveCast-Secret'] = secretHeader;

              const resp = await fetch(safeUrl.toString(), {
                method: 'POST',
                headers,
                redirect: 'error',
                body: JSON.stringify({
                  event: 'drivecast_publish_post',
                  platform,
                  appStoreUrl: posts.appStoreUrl || posts.pinterest?.destinationLink || undefined,
                  video: videoPayload,
                  post: posts[platform],
                  triggeredAt: new Date().toISOString(),
                }),
              });

              results.push({
                platform,
                status: resp.ok ? 'delivered' : 'failed',
                method: 'webhook',
                httpStatus: resp.status,
                message: resp.ok
                  ? `Delivered ${platform} post & video stream to platform webhook (HTTP ${resp.status}).`
                  : `Webhook returned HTTP ${resp.status}.`,
                deliveredAt: new Date().toISOString(),
              });
            } catch (err) {
              results.push({
                platform,
                status: 'failed',
                method: 'webhook',
                message: (err as Error).message || 'Webhook delivery failed.',
                deliveredAt: new Date().toISOString(),
              });
            }
          } else if (unifiedUrl) {
            platformsUsingUnified.push(platform);
          } else {
            results.push({
              platform,
              status: 'unconfigured',
              method: 'none',
              message: `No webhook URL configured for ${platform}. Open Publishing Channels to add one.`,
              deliveredAt: new Date().toISOString(),
            });
          }
        }

        if (platformsUsingUnified.length > 0 && unifiedUrl) {
          try {
            const safeUrl = await assertSafeExternalWebhookUrl(unifiedUrl);
            const headers: Record<string, string> = {
              'Content-Type': 'application/json',
              'User-Agent': 'DriveCast-Studio/1.0',
            };
            if (secretHeader) headers['X-DriveCast-Secret'] = secretHeader;

            const selectedPosts: Record<string, unknown> = {};
            for (const p of platformsUsingUnified) {
              selectedPosts[p] = posts[p];
            }

            const resp = await fetch(safeUrl.toString(), {
              method: 'POST',
              headers,
              redirect: 'error',
              body: JSON.stringify({
                event: 'drivecast_publish_bundle',
                platforms: platformsUsingUnified,
                appStoreUrl: posts.appStoreUrl || posts.pinterest?.destinationLink || undefined,
                video: videoPayload,
                posts: selectedPosts,
                triggeredAt: new Date().toISOString(),
              }),
            });

            for (const p of platformsUsingUnified) {
              results.push({
                platform: p,
                status: resp.ok ? 'delivered' : 'failed',
                method: 'webhook',
                httpStatus: resp.status,
                message: resp.ok
                  ? `Delivered to unified automation webhook (HTTP ${resp.status}).`
                  : `Unified webhook returned HTTP ${resp.status}.`,
                deliveredAt: new Date().toISOString(),
              });
            }
          } catch (err) {
            for (const p of platformsUsingUnified) {
              results.push({
                platform: p,
                status: 'failed',
                method: 'webhook',
                message: (err as Error).message || 'Unified webhook delivery failed.',
                deliveredAt: new Date().toISOString(),
              });
            }
          }
        }
      } else {
        // Direct platform API mode
        const direct = channels?.direct || {};
        const metaToken = typeof direct.metaAccessToken === 'string' ? direct.metaAccessToken.trim() : '';

        for (const platform of targetPlatforms) {
          const nowIso = new Date().toISOString();

          if (platform === 'facebook') {
            const pageId = typeof direct.facebookPageId === 'string' ? direct.facebookPageId.trim() : '';
            if (!metaToken || !pageId) {
              results.push({
                platform,
                status: 'unconfigured',
                method: 'none',
                message: 'Facebook Page ID and Meta Access Token are required for direct API publishing.',
                deliveredAt: nowIso,
              });
              continue;
            }
            try {
              const fbPost = posts.facebook;
              const description = `${fbPost.postText}\n\n${fbPost.engagementQuestion}\n\n${(fbPost.hashtags || []).join(' ')}`.trim();
              const fbResp = await fetch(
                `https://graph.facebook.com/v21.0/${encodeURIComponent(pageId)}/videos`,
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    file_url: streamUrl,
                    title: fbPost.headline,
                    description,
                    access_token: metaToken,
                  }),
                }
              );
              const fbJson = (await fbResp.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
              results.push({
                platform,
                status: fbResp.ok ? 'delivered' : 'failed',
                method: 'direct_api',
                httpStatus: fbResp.status,
                externalId: fbJson.id,
                message: fbResp.ok
                  ? `Published to Facebook Page (Video ID: ${fbJson.id || 'created'}).`
                  : fbJson.error?.message || `Facebook API error (HTTP ${fbResp.status}).`,
                deliveredAt: nowIso,
              });
            } catch (err) {
              results.push({
                platform,
                status: 'failed',
                method: 'direct_api',
                message: (err as Error).message,
                deliveredAt: nowIso,
              });
            }
          } else if (platform === 'instagram') {
            const igId = typeof direct.instagramAccountId === 'string' ? direct.instagramAccountId.trim() : '';
            if (!metaToken || !igId) {
              results.push({
                platform,
                status: 'unconfigured',
                method: 'none',
                message: 'Instagram Business Account ID and Meta Access Token are required.',
                deliveredAt: nowIso,
              });
              continue;
            }
            try {
              const igPost = posts.instagram;
              const caption = `${igPost.caption}\n\n${(igPost.hashtags || []).join(' ')}`.trim();
              const createResp = await fetch(
                `https://graph.facebook.com/v21.0/${encodeURIComponent(igId)}/media`,
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    media_type: 'REELS',
                    video_url: streamUrl,
                    caption,
                    access_token: metaToken,
                  }),
                }
              );
              const createJson = (await createResp.json().catch(() => ({}))) as {
                id?: string;
                error?: { message?: string };
              };

              if (!createResp.ok || !createJson.id) {
                results.push({
                  platform,
                  status: 'failed',
                  method: 'direct_api',
                  httpStatus: createResp.status,
                  message: createJson.error?.message || `Instagram container creation failed (HTTP ${createResp.status}).`,
                  deliveredAt: nowIso,
                });
                continue;
              }

              const pubResp = await fetch(
                `https://graph.facebook.com/v21.0/${encodeURIComponent(igId)}/media_publish`,
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    creation_id: createJson.id,
                    access_token: metaToken,
                  }),
                }
              );
              const pubJson = (await pubResp.json().catch(() => ({}))) as {
                id?: string;
                error?: { message?: string };
              };

              results.push({
                platform,
                status: pubResp.ok ? 'delivered' : 'failed',
                method: 'direct_api',
                httpStatus: pubResp.status,
                externalId: pubJson.id || createJson.id,
                message: pubResp.ok
                  ? `Published Instagram Reel (Media ID: ${pubJson.id}).`
                  : pubJson.error?.message || `Instagram container created (${createJson.id}); publish returned HTTP ${pubResp.status}.`,
                deliveredAt: nowIso,
              });
            } catch (err) {
              results.push({
                platform,
                status: 'failed',
                method: 'direct_api',
                message: (err as Error).message,
                deliveredAt: nowIso,
              });
            }
          } else if (platform === 'pinterest') {
            const pToken = typeof direct.pinterestAccessToken === 'string' ? direct.pinterestAccessToken.trim() : '';
            const boardId = typeof direct.pinterestBoardId === 'string' ? direct.pinterestBoardId.trim() : '';
            if (!pToken || !boardId) {
              results.push({
                platform,
                status: 'unconfigured',
                method: 'none',
                message: 'Pinterest Access Token and Board ID are required.',
                deliveredAt: nowIso,
              });
              continue;
            }
            try {
              const pinPost = posts.pinterest;
              const regResp = await fetch('https://api.pinterest.com/v5/media', {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${pToken}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ media_type: 'video' }),
              });
              const regJson = (await regResp.json().catch(() => ({}))) as {
                media_id?: string;
                message?: string;
              };
              if (!regResp.ok || !regJson.media_id) {
                results.push({
                  platform,
                  status: 'failed',
                  method: 'direct_api',
                  httpStatus: regResp.status,
                  message: regJson.message || `Pinterest media registration failed (HTTP ${regResp.status}).`,
                  deliveredAt: nowIso,
                });
                continue;
              }
              const pinLink =
                typeof pinPost.destinationLink === 'string' && /^https?:\/\//i.test(pinPost.destinationLink.trim())
                  ? pinPost.destinationLink.trim()
                  : typeof posts.appStoreUrl === 'string' && /^https?:\/\//i.test(posts.appStoreUrl.trim())
                    ? posts.appStoreUrl.trim()
                    : undefined;

              const pinResp = await fetch('https://api.pinterest.com/v5/pins', {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${pToken}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  board_id: boardId,
                  title: pinPost.pinTitle?.slice(0, 100),
                  description: pinPost.pinDescription?.slice(0, 500),
                  alt_text: pinPost.altText?.slice(0, 500),
                  ...(pinLink ? { link: pinLink } : {}),
                  media_source: {
                    source_type: 'video_id',
                    media_id: regJson.media_id,
                    is_standard: true,
                  },
                }),
              });
              const pinJson = (await pinResp.json().catch(() => ({}))) as { id?: string; message?: string };
              results.push({
                platform,
                status: pinResp.ok ? 'delivered' : 'failed',
                method: 'direct_api',
                httpStatus: pinResp.status,
                externalId: pinJson.id,
                message: pinResp.ok
                  ? `Created Pinterest Video Pin (ID: ${pinJson.id}).`
                  : pinJson.message || `Pinterest API error (HTTP ${pinResp.status}).`,
                deliveredAt: nowIso,
              });
            } catch (err) {
              results.push({
                platform,
                status: 'failed',
                method: 'direct_api',
                message: (err as Error).message,
                deliveredAt: nowIso,
              });
            }
          } else if (platform === 'tiktok') {
            const ttToken = typeof direct.tiktokAccessToken === 'string' ? direct.tiktokAccessToken.trim() : '';
            if (!ttToken) {
              results.push({
                platform,
                status: 'unconfigured',
                method: 'none',
                message: 'TikTok Access Token is required for direct TikTok Content Posting API.',
                deliveredAt: nowIso,
              });
              continue;
            }
            try {
              const ttPost = posts.tiktok;
              const title = `${ttPost.caption} ${(ttPost.hashtags || []).join(' ')}`.trim().slice(0, 2200);
              const ttResp = await fetch('https://open.tiktokapis.com/v2/post/publish/video/init/', {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${ttToken}`,
                  'Content-Type': 'application/json; charset=UTF-8',
                },
                body: JSON.stringify({
                  post_info: {
                    title,
                    privacy_level: 'SELF_ONLY',
                  },
                  source_info: {
                    source: 'PULL_FROM_URL',
                    video_url: streamUrl,
                  },
                }),
              });
              const ttJson = (await ttResp.json().catch(() => ({}))) as {
                data?: { publish_id?: string };
                error?: { message?: string };
              };
              results.push({
                platform,
                status: ttResp.ok ? 'delivered' : 'failed',
                method: 'direct_api',
                httpStatus: ttResp.status,
                externalId: ttJson.data?.publish_id,
                message: ttResp.ok
                  ? `Sent to TikTok Inbox/Drafts (Publish ID: ${ttJson.data?.publish_id || 'ok'}).`
                  : ttJson.error?.message || `TikTok API error (HTTP ${ttResp.status}).`,
                deliveredAt: nowIso,
              });
            } catch (err) {
              results.push({
                platform,
                status: 'failed',
                method: 'direct_api',
                message: (err as Error).message,
                deliveredAt: nowIso,
              });
            }
          } else if (platform === 'youtube') {
            const ytToken = typeof direct.youtubeAccessToken === 'string' ? direct.youtubeAccessToken.trim() : '';
            if (!ytToken) {
              results.push({
                platform,
                status: 'unconfigured',
                method: 'none',
                message: 'YouTube OAuth Access Token (youtube.upload scope) or a Make/Zapier/n8n Webhook is required to upload Shorts.',
                deliveredAt: nowIso,
              });
              continue;
            }
            try {
              const ytPost = posts.youtube || {
                title: video.name,
                description: posts.detectedTopic || '',
                tags: [],
                hashtags: ['#Shorts'],
                pinnedComment: '',
                privacyStatus: 'public',
              };
              const ytTitle = (ytPost.title || video.name).slice(0, 100);
              const ytHashtags = (ytPost.hashtags || []).join(' ');
              const ytDescription = `${ytPost.description || ''}${
                ytHashtags ? `\n\n${ytHashtags}` : ''
              }`.trim().slice(0, 5000);

              const initResp = await fetch(
                'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
                {
                  method: 'POST',
                  headers: {
                    Authorization: `Bearer ${ytToken}`,
                    'Content-Type': 'application/json; charset=UTF-8',
                    'X-Upload-Content-Type': video.mimeType || 'video/mp4',
                  },
                  body: JSON.stringify({
                    snippet: {
                      title: ytTitle,
                      description: ytDescription,
                      tags: (ytPost.tags || []).slice(0, 30),
                      categoryId: '22',
                    },
                    status: {
                      privacyStatus: ytPost.privacyStatus || 'public',
                      selfDeclaredMadeForKids: false,
                    },
                  }),
                }
              );

              if (!initResp.ok) {
                const initErr = (await initResp.json().catch(() => ({}))) as { error?: { message?: string } };
                results.push({
                  platform,
                  status: 'failed',
                  method: 'direct_api',
                  httpStatus: initResp.status,
                  message: initErr.error?.message || `YouTube upload init failed (HTTP ${initResp.status}).`,
                  deliveredAt: nowIso,
                });
                continue;
              }

              const uploadLocation = initResp.headers.get('location') || '';
              if (!uploadLocation.startsWith('https://www.googleapis.com/')) {
                results.push({
                  platform,
                  status: 'failed',
                  method: 'direct_api',
                  message: 'YouTube did not return a valid resumable upload URL.',
                  deliveredAt: nowIso,
                });
                continue;
              }

              const driveVideoResp = await fetch(
                `${DRIVE_API_BASE}/files/${encodeURIComponent(video.id)}?alt=media&supportsAllDrives=true`,
                {
                  headers: { Authorization: `Bearer ${accessToken}` },
                  signal: AbortSignal.timeout(60000),
                }
              );
              if (!driveVideoResp.ok || !driveVideoResp.body) {
                results.push({
                  platform,
                  status: 'failed',
                  method: 'direct_api',
                  httpStatus: driveVideoResp.status,
                  message: 'Could not read video stream from Google Drive for YouTube upload.',
                  deliveredAt: nowIso,
                });
                continue;
              }

              const videoBuf = Buffer.from(await driveVideoResp.arrayBuffer());
              const uploadResp = await fetch(uploadLocation, {
                method: 'PUT',
                headers: {
                  'Content-Type': video.mimeType || 'video/mp4',
                  'Content-Length': String(videoBuf.byteLength),
                },
                body: videoBuf,
              });
              const uploadJson = (await uploadResp.json().catch(() => ({}))) as {
                id?: string;
                error?: { message?: string };
              };

              results.push({
                platform,
                status: uploadResp.ok ? 'delivered' : 'failed',
                method: 'direct_api',
                httpStatus: uploadResp.status,
                externalId: uploadJson.id,
                message: uploadResp.ok
                  ? `Uploaded YouTube Short (ID: ${uploadJson.id || 'ok'} · https://youtube.com/shorts/${uploadJson.id || ''}).`
                  : uploadJson.error?.message || `YouTube upload error (HTTP ${uploadResp.status}).`,
                deliveredAt: nowIso,
              });
            } catch (err) {
              results.push({
                platform,
                status: 'failed',
                method: 'direct_api',
                message: (err as Error).message,
                deliveredAt: nowIso,
              });
            }
          }
        }
      }

      res.json({
        streamUrl,
        results,
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message || 'Delivery failed.' });
    }
  });

  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`DriveCast Studio server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
