import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import type { DriveVideo, GeneratedSocialPosts } from '../types';

export interface ExportablePostItem {
  video: DriveVideo;
  posts: GeneratedSocialPosts;
  folderName?: string;
}

function sanitizeFileName(name: string): string {
  return (
    name
      .trim()
      .replace(/[^a-zA-Z0-9_\-\u0600-\u06FF ]+/g, '_')
      .replace(/\s+/g, '_')
      .slice(0, 80) || 'drivecast_posts'
  );
}

function formatDurationLabel(ms?: number): string {
  if (!ms || ms <= 0) return 'Unknown';
  const totalSec = Math.round(ms / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatSizeLabel(bytes?: number): string {
  if (!bytes || bytes <= 0) return '—';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function exportPostsAsTxt(
  items: ExportablePostItem[],
  folderName: string,
  filePrefix?: string
) {
  if (items.length === 0) return;

  const lines: string[] = [];
  lines.push('====================================================================');
  lines.push('DRIVECAST STUDIO — GENERATED SOCIAL MEDIA POSTS');
  lines.push('====================================================================');
  lines.push(`Drive Folder : ${folderName}`);
  lines.push(`Exported At  : ${new Date().toLocaleString()}`);
  lines.push(`Videos Count : ${items.length}`);
  lines.push('');

  items.forEach((item, index) => {
    const { video, posts } = item;
    const itemFolder = item.folderName || folderName;
    lines.push('--------------------------------------------------------------------');
    lines.push(`VIDEO #${index + 1}: ${video.name}`);
    lines.push(`Folder   : ${itemFolder}`);
    lines.push(
      `Specs    : ${formatDurationLabel(video.durationMillis)} | ${
        video.width && video.height ? `${video.width}x${video.height}` : 'Video'
      } | ${formatSizeLabel(video.size)}`
    );
    if (posts.appStoreUrl) {
      lines.push(`App Link : ${posts.appStoreUrl}`);
    }
    lines.push(`Topic    : ${posts.detectedTopic}`);
    lines.push(`Hook     : ${posts.hookAngle}`);
    lines.push('');

    lines.push('[1. INSTAGRAM REELS]');
    lines.push(`Cover Headline : ${posts.instagram.coverHeadline}`);
    lines.push(`Best Time      : ${posts.instagram.bestTimeHint} (${posts.instagram.formatNote})`);
    lines.push('Caption:');
    lines.push(posts.instagram.caption);
    lines.push(`Hashtags: ${posts.instagram.hashtags.join(' ')}`);
    lines.push('');

    lines.push('[2. FACEBOOK VIDEO POST]');
    lines.push(`Headline : ${posts.facebook.headline}`);
    lines.push(`Best Time: ${posts.facebook.bestTimeHint}`);
    lines.push('Post Text:');
    lines.push(posts.facebook.postText);
    lines.push(`Engagement Question: ${posts.facebook.engagementQuestion}`);
    lines.push(`Hashtags: ${posts.facebook.hashtags.join(' ')}`);
    lines.push('');

    lines.push('[3. PINTEREST VIDEO PIN]');
    lines.push(`Pin Title       : ${posts.pinterest.pinTitle}`);
    lines.push(`Suggested Board : ${posts.pinterest.suggestedBoard}`);
    if (posts.pinterest.destinationLink) {
      lines.push(`Destination Link: ${posts.pinterest.destinationLink}`);
    }
    lines.push('Description:');
    lines.push(posts.pinterest.pinDescription);
    lines.push(`Keywords: ${posts.pinterest.keywords.join(', ')}`);
    lines.push(`Alt Text: ${posts.pinterest.altText}`);
    lines.push('');

    lines.push('[4. TIKTOK VIDEO POST]');
    lines.push(`On-Screen Hook : ${posts.tiktok.onScreenHook}`);
    lines.push(`Pacing Tip     : ${posts.tiktok.soundOrPacingTip}`);
    lines.push('Caption:');
    lines.push(posts.tiktok.caption);
    lines.push(`Hashtags: ${posts.tiktok.hashtags.join(' ')}`);
    lines.push('');

    if (posts.youtube) {
      lines.push('[5. YOUTUBE SHORTS]');
      lines.push(`Title          : ${posts.youtube.title}`);
      lines.push(`Privacy        : ${posts.youtube.privacyStatus || 'public'}`);
      lines.push('Description:');
      lines.push(posts.youtube.description);
      lines.push(`Hashtags: ${posts.youtube.hashtags.join(' ')}`);
      lines.push(`Tags: ${posts.youtube.tags.join(', ')}`);
      if (posts.youtube.pinnedComment) {
        lines.push(`Pinned Comment: ${posts.youtube.pinnedComment}`);
      }
      lines.push('');
    }
  });

  const content = '\uFEFF' + lines.join('\n');
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const baseName = sanitizeFileName(filePrefix || folderName);
  triggerBlobDownload(blob, `${baseName}_posts.txt`);
}

export function exportPostsAsExcel(
  items: ExportablePostItem[],
  folderName: string,
  filePrefix?: string
) {
  if (items.length === 0) return;

  const rows = items.map((item) => {
    const { video, posts } = item;
    return {
      'Drive Folder Name': item.folderName || folderName,
      'Video File Name': video.name,
      Duration: formatDurationLabel(video.durationMillis),
      Resolution: video.width && video.height ? `${video.width}x${video.height}` : 'Video',
      Size: formatSizeLabel(video.size),
      'Detected Topic': posts.detectedTopic,
      'Hook Angle': posts.hookAngle,
      'Play Store / App Link': posts.appStoreUrl || posts.pinterest.destinationLink || '',
      'Instagram Cover Headline': posts.instagram.coverHeadline,
      'Instagram Caption': posts.instagram.caption,
      'Instagram Hashtags': posts.instagram.hashtags.join(' '),
      'Instagram Best Time': posts.instagram.bestTimeHint,
      'Facebook Headline': posts.facebook.headline,
      'Facebook Post Text': posts.facebook.postText,
      'Facebook Engagement Question': posts.facebook.engagementQuestion,
      'Facebook Hashtags': posts.facebook.hashtags.join(' '),
      'Pinterest Pin Title': posts.pinterest.pinTitle,
      'Pinterest Board': posts.pinterest.suggestedBoard,
      'Pinterest Description': posts.pinterest.pinDescription,
      'Pinterest Destination Link': posts.pinterest.destinationLink || '',
      'Pinterest Keywords': posts.pinterest.keywords.join(', '),
      'Pinterest Alt Text': posts.pinterest.altText,
      'TikTok On-Screen Hook': posts.tiktok.onScreenHook,
      'TikTok Caption': posts.tiktok.caption,
      'TikTok Hashtags': posts.tiktok.hashtags.join(' '),
      'TikTok Pacing Tip': posts.tiktok.soundOrPacingTip,
      'YouTube Shorts Title': posts.youtube?.title || '',
      'YouTube Shorts Description': posts.youtube?.description || '',
      'YouTube Shorts Hashtags': (posts.youtube?.hashtags || []).join(' '),
      'YouTube Shorts Tags': (posts.youtube?.tags || []).join(', '),
      'YouTube Pinned Comment': posts.youtube?.pinnedComment || '',
      'Generated At': posts.generatedAt,
    };
  });

  const worksheet = XLSX.utils.json_to_sheet(rows);
  worksheet['!cols'] = [
    { wch: 24 },
    { wch: 24 },
    { wch: 10 },
    { wch: 12 },
    { wch: 10 },
    { wch: 34 },
    { wch: 30 },
    { wch: 34 },
    { wch: 26 },
    { wch: 48 },
    { wch: 30 },
    { wch: 18 },
    { wch: 28 },
    { wch: 48 },
    { wch: 30 },
    { wch: 28 },
    { wch: 28 },
    { wch: 22 },
    { wch: 42 },
    { wch: 34 },
    { wch: 28 },
    { wch: 30 },
    { wch: 28 },
    { wch: 44 },
    { wch: 30 },
    { wch: 28 },
    { wch: 34 },
    { wch: 46 },
    { wch: 28 },
    { wch: 34 },
    { wch: 34 },
    { wch: 24 },
  ];

  const summarySheet = XLSX.utils.json_to_sheet([
    {
      'Drive Folder Name': folderName,
      'Total Videos Exported': items.length,
      'Exported At': new Date().toLocaleString(),
    },
  ]);
  summarySheet['!cols'] = [{ wch: 30 }, { wch: 22 }, { wch: 26 }];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Generated Posts');
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Folder Summary');

  const arrayBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([arrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const baseName = sanitizeFileName(filePrefix || folderName);
  triggerBlobDownload(blob, `${baseName}_posts.xlsx`);
}

function containsArabic(text: string): boolean {
  return /[\u0600-\u06FF]/.test(text);
}

function wrapCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const paragraphs = (text || '').split(/\r?\n/);
  const result: string[] = [];

  for (const para of paragraphs) {
    if (!para.trim()) {
      result.push('');
      continue;
    }
    const words = para.split(/\s+/);
    let currentLine = '';

    for (const word of words) {
      const candidate = currentLine ? `${currentLine} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth) {
        currentLine = candidate;
      } else {
        if (currentLine) {
          result.push(currentLine);
          currentLine = '';
        }
        if (ctx.measureText(word).width <= maxWidth) {
          currentLine = word;
        } else {
          // Break very long URL/token cleanly
          let chunk = '';
          for (const ch of word) {
            if (ctx.measureText(chunk + ch).width > maxWidth) {
              if (chunk) result.push(chunk);
              chunk = ch;
            } else {
              chunk += ch;
            }
          }
          currentLine = chunk;
        }
      }
    }
    if (currentLine) {
      result.push(currentLine);
    }
  }

  return result;
}

export function exportPostsAsPdf(
  items: ExportablePostItem[],
  folderName: string,
  filePrefix?: string
) {
  if (items.length === 0) return;

  const PAGE_W = 1190;
  const PAGE_H = 1684;
  const MARGIN_X = 72;
  const MARGIN_TOP = 72;
  const MARGIN_BOTTOM = 84;
  const CONTENT_W = PAGE_W - MARGIN_X * 2;

  const pages: HTMLCanvasElement[] = [];

  const createPage = () => {
    const canvas = document.createElement('canvas');
    canvas.width = PAGE_W;
    canvas.height = PAGE_H;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, PAGE_W, PAGE_H);
    pages.push(canvas);
    return { canvas, ctx, y: MARGIN_TOP };
  };

  let page = createPage();

  const ensureSpace = (neededHeight: number) => {
    if (page.y + neededHeight > PAGE_H - MARGIN_BOTTOM) {
      page = createPage();
    }
  };

  const drawTextLines = (
    text: string,
    opts: {
      font: string;
      color: string;
      lineHeight: number;
      indent?: number;
      maxWidth?: number;
    }
  ) => {
    const indent = opts.indent ?? 0;
    const maxW = (opts.maxWidth ?? CONTENT_W) - indent;
    page.ctx.font = opts.font;
    const lines = wrapCanvasText(page.ctx, text, maxW);

    for (const line of lines) {
      ensureSpace(opts.lineHeight);
      page.ctx.font = opts.font;
      page.ctx.fillStyle = opts.color;

      if (line.trim() && containsArabic(line)) {
        page.ctx.save();
        page.ctx.direction = 'rtl';
        page.ctx.textAlign = 'right';
        page.ctx.fillText(line, MARGIN_X + CONTENT_W, page.y);
        page.ctx.restore();
      } else {
        page.ctx.save();
        page.ctx.direction = 'ltr';
        page.ctx.textAlign = 'left';
        page.ctx.fillText(line, MARGIN_X + indent, page.y);
        page.ctx.restore();
      }
      page.y += opts.lineHeight;
    }
  };

  const drawDivider = (gapBefore = 8, gapAfter = 18) => {
    page.y += gapBefore;
    ensureSpace(20);
    page.ctx.strokeStyle = '#E2E8F0';
    page.ctx.lineWidth = 2;
    page.ctx.beginPath();
    page.ctx.moveTo(MARGIN_X, page.y);
    page.ctx.lineTo(MARGIN_X + CONTENT_W, page.y);
    page.ctx.stroke();
    page.y += gapAfter;
  };

  // Document Header
  drawTextLines('DriveCast Studio — Generated Social Posts', {
    font: 'bold 34px system-ui, -apple-system, "Segoe UI", sans-serif',
    color: '#0F172A',
    lineHeight: 44,
  });
  drawTextLines(`Google Drive Folder: ${folderName}`, {
    font: 'bold 22px system-ui, -apple-system, "Segoe UI", sans-serif',
    color: '#1D4ED8',
    lineHeight: 32,
  });
  drawTextLines(
    `Exported ${new Date().toLocaleString()}  ·  ${items.length} video${items.length > 1 ? 's' : ''}`,
    {
      font: '18px system-ui, -apple-system, "Segoe UI", sans-serif',
      color: '#64748B',
      lineHeight: 28,
    }
  );
  drawDivider(12, 24);

  items.forEach((item, idx) => {
    const { video, posts } = item;
    if (idx > 0) {
      page = createPage();
    }

    // Video Header Banner
    ensureSpace(120);
    page.ctx.fillStyle = '#F8FAFC';
    page.ctx.strokeStyle = '#E2E8F0';
    page.ctx.lineWidth = 2;
    page.ctx.fillRect(MARGIN_X, page.y - 24, CONTENT_W, 92);
    page.ctx.strokeRect(MARGIN_X, page.y - 24, CONTENT_W, 92);

    page.ctx.font = 'bold 24px system-ui, -apple-system, "Segoe UI", sans-serif';
    page.ctx.fillStyle = '#0F172A';
    page.ctx.fillText(`Reel #${idx + 1}: ${video.name}`.slice(0, 72), MARGIN_X + 20, page.y + 8);

    page.ctx.font = '18px system-ui, -apple-system, "Segoe UI", sans-serif';
    page.ctx.fillStyle = '#475569';
    page.ctx.fillText(
      `Folder: ${item.folderName || folderName}  ·  ${formatDurationLabel(video.durationMillis)}  ·  ${
        video.width && video.height ? `${video.width}x${video.height}` : 'Video'
      }  ·  ${formatSizeLabel(video.size)}`.slice(0, 95),
      MARGIN_X + 20,
      page.y + 42
    );
    page.y += 96;

    drawTextLines(`Topic: ${posts.detectedTopic}`, {
      font: 'bold 19px system-ui, -apple-system, "Segoe UI", sans-serif',
      color: '#0F172A',
      lineHeight: 28,
    });
    if (posts.hookAngle) {
      drawTextLines(`Hook Angle: ${posts.hookAngle}`, {
        font: '18px system-ui, -apple-system, "Segoe UI", sans-serif',
        color: '#475569',
        lineHeight: 26,
      });
    }
    if (posts.appStoreUrl) {
      drawTextLines(`App Link: ${posts.appStoreUrl}`, {
        font: '18px system-ui, -apple-system, "Segoe UI", sans-serif',
        color: '#1D4ED8',
        lineHeight: 26,
      });
    }
    drawDivider(10, 20);

    const drawPlatformBlock = (
      title: string,
      fields: Array<{ label: string; value: string; mono?: boolean }>
    ) => {
      ensureSpace(70);
      drawTextLines(title, {
        font: 'bold 22px system-ui, -apple-system, "Segoe UI", sans-serif',
        color: '#1E293B',
        lineHeight: 32,
      });
      for (const field of fields) {
        if (!field.value.trim()) continue;
        drawTextLines(`${field.label}:`, {
          font: 'bold 17px system-ui, -apple-system, "Segoe UI", sans-serif',
          color: '#64748B',
          lineHeight: 24,
          indent: 12,
        });
        drawTextLines(field.value, {
          font: field.mono
            ? '17px ui-monospace, SFMono-Regular, Menlo, monospace'
            : '19px system-ui, -apple-system, "Segoe UI", sans-serif',
          color: '#0F172A',
          lineHeight: 27,
          indent: 12,
        });
        page.y += 6;
      }
      drawDivider(6, 18);
    };

    drawPlatformBlock('1. Instagram Reels', [
      { label: 'Cover Headline', value: posts.instagram.coverHeadline },
      { label: 'Caption', value: posts.instagram.caption },
      { label: 'Hashtags', value: posts.instagram.hashtags.join(' '), mono: true },
      { label: 'Timing & Format', value: `${posts.instagram.bestTimeHint} · ${posts.instagram.formatNote}` },
    ]);

    drawPlatformBlock('2. Facebook Video Post', [
      { label: 'Headline', value: posts.facebook.headline },
      { label: 'Post Text', value: posts.facebook.postText },
      { label: 'Engagement Question', value: posts.facebook.engagementQuestion },
      { label: 'Hashtags', value: posts.facebook.hashtags.join(' '), mono: true },
    ]);

    drawPlatformBlock('3. Pinterest Video Pin', [
      { label: 'Pin Title', value: posts.pinterest.pinTitle },
      { label: 'Suggested Board', value: posts.pinterest.suggestedBoard },
      { label: 'Destination Link', value: posts.pinterest.destinationLink || '' },
      { label: 'Description', value: posts.pinterest.pinDescription },
      { label: 'Keywords', value: posts.pinterest.keywords.join(', ') },
    ]);

    drawPlatformBlock('4. TikTok Video Post', [
      { label: 'On-Screen Hook', value: posts.tiktok.onScreenHook },
      { label: 'Caption', value: posts.tiktok.caption },
      { label: 'Hashtags', value: posts.tiktok.hashtags.join(' '), mono: true },
      { label: 'Pacing Tip', value: posts.tiktok.soundOrPacingTip },
    ]);

    if (posts.youtube) {
      drawPlatformBlock('5. YouTube Shorts', [
        { label: 'Shorts Title', value: posts.youtube.title },
        { label: 'Description', value: posts.youtube.description },
        { label: 'Hashtags', value: posts.youtube.hashtags.join(' '), mono: true },
        { label: 'Search Tags', value: posts.youtube.tags.join(', ') },
        { label: 'Pinned Comment', value: posts.youtube.pinnedComment },
      ]);
    }
  });

  // Add page footers & build PDF
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'a4',
  });

  pages.forEach((canvas, index) => {
    const ctx = canvas.getContext('2d')!;
    ctx.font = '16px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.fillStyle = '#94A3B8';
    ctx.textAlign = 'left';
    ctx.fillText(`DriveCast Studio · ${folderName}`.slice(0, 80), MARGIN_X, PAGE_H - 36);
    ctx.textAlign = 'right';
    ctx.fillText(`Page ${index + 1} of ${pages.length}`, PAGE_W - MARGIN_X, PAGE_H - 36);

    if (index > 0) pdf.addPage();
    const imgData = canvas.toDataURL('image/jpeg', 0.92);
    pdf.addImage(imgData, 'JPEG', 0, 0, 595.28, 841.89);
  });

  const blob = pdf.output('blob');
  const baseName = sanitizeFileName(filePrefix || folderName);
  triggerBlobDownload(blob, `${baseName}_posts.pdf`);
}
