import React, { useState } from 'react';
import { CheckCircle2, Loader2, ShieldAlert, Webhook, KeyRound } from 'lucide-react';
import { fetchApiJson } from '../lib/apiClient';
import type { PlatformKey, PublishingChannelsConfig } from '../types';

interface ChannelsSettingsViewProps {
  channels: PublishingChannelsConfig;
  accessToken: string | null;
  onChange: (next: PublishingChannelsConfig) => void;
}

export const ChannelsSettingsView: React.FC<ChannelsSettingsViewProps> = ({
  channels,
  accessToken,
  onChange,
}) => {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const handleTestWebhook = async () => {
    if (!channels.unifiedWebhookUrl.trim()) return;
    setTesting(true);
    setTestResult(null);
    try {
      const { ok, data } = await fetchApiJson<{ ok?: boolean; status?: number; error?: string }>(
        '/api/channels/test-webhook',
        accessToken,
        {
          method: 'POST',
          body: JSON.stringify({
            webhookUrl: channels.unifiedWebhookUrl.trim(),
            secretHeader: channels.webhookSecretHeader.trim(),
          }),
        }
      );
      if (!ok) {
        throw new Error(data.error || 'Webhook test failed.');
      }
      setTestResult({
        ok: Boolean(data.ok),
        message: data.ok
          ? `Webhook responded with HTTP ${data.status}. Sample payload sent! In Make, open Instagram to select video.streamUrl.`
          : `Webhook returned HTTP ${data.status}. Check your automation endpoint.`,
      });
    } catch (err) {
      setTestResult({
        ok: false,
        message: (err as Error).message,
      });
    } finally {
      setTesting(false);
    }
  };

  const handleWebhookChange = (val: string) => {
    const next = { ...channels, unifiedWebhookUrl: val };
    onChange(next);
    try {
      localStorage.setItem('drivecast_channels_config', JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  const updatePlatformWebhook = (platform: PlatformKey, url: string) => {
    onChange({
      ...channels,
      platformWebhooks: {
        ...channels.platformWebhooks,
        [platform]: url,
      },
    });
  };

  const updateDirect = (field: keyof PublishingChannelsConfig['direct'], value: string) => {
    onChange({
      ...channels,
      direct: {
        ...channels.direct,
        [field]: value,
      },
    });
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Publishing Channels & Automation</h2>
          <p className="mt-1 text-sm text-slate-500">
            Choose how DriveCast delivers prepared posts and signed video streams to Instagram, Facebook, Pinterest, TikTok, and YouTube Shorts.
          </p>
        </div>

        <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => onChange({ ...channels, mode: 'webhook' })}
            className={`inline-flex items-center gap-2 rounded-md px-3.5 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
              channels.mode === 'webhook'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Webhook className="h-3.5 w-3.5" />
            Automation Webhook
          </button>
          <button
            type="button"
            onClick={() => onChange({ ...channels, mode: 'direct' })}
            className={`inline-flex items-center gap-2 rounded-md px-3.5 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
              channels.mode === 'direct'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <KeyRound className="h-3.5 w-3.5" />
            Direct Platform APIs
          </button>
        </div>
      </div>

      {channels.mode === 'webhook' ? (
        <div className="space-y-6">
          <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-5 space-y-2.5">
            <h3 className="text-sm font-semibold text-slate-900">
              How to Connect Instagram, Facebook, Pinterest, TikTok &amp; YouTube Shorts (Easiest Method)
            </h3>
            <ol className="list-decimal pl-4 space-y-1.5 text-xs text-slate-700 leading-relaxed">
              <li>
                Create a free account on <strong>Make.com</strong>, <strong>Zapier</strong>, or <strong>n8n</strong> and start a new workflow with a <strong>Webhooks → Custom Webhook</strong> trigger.
              </li>
              <li>
                Copy the generated <code className="font-mono text-slate-900">https://...</code> webhook URL and paste it into <strong>Unified Webhook URL</strong> below, then click <strong>Send Test Ping</strong>.
              </li>
              <li>
                In your Make/Zapier scenario, log into your <strong>Instagram Business</strong>, <strong>Facebook Page</strong>, <strong>Pinterest</strong>, <strong>TikTok</strong>, and <strong>YouTube</strong> accounts normally (no developer app review needed).
              </li>
              <li>
                Map <code className="font-mono text-slate-900">video.streamUrl</code> for the MP4 video and each platform&apos;s generated caption/title (<code className="font-mono text-slate-900">posts.instagram</code>, <code className="font-mono text-slate-900">posts.facebook</code>, <code className="font-mono text-slate-900">posts.pinterest</code>, <code className="font-mono text-slate-900">posts.tiktok</code>, <code className="font-mono text-slate-900">posts.youtube</code>).
              </li>
            </ol>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                Unified Automation Webhook (Make, Zapier, n8n, or Buffer)
              </h3>
              <p className="mt-1 text-xs text-slate-500 leading-relaxed">
                Send every video&apos;s signed stream URL and all 5 platform posts to a single HTTPS webhook router, which distributes them to Instagram, Facebook, Pinterest, TikTok, and YouTube Shorts.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <label className="mb-1.5 block text-xs font-medium text-slate-700">
                  Unified Webhook URL (HTTPS)
                </label>
                <input
                  type="url"
                  value={channels.unifiedWebhookUrl}
                  onChange={(e) => handleWebhookChange(e.target.value)}
                  placeholder="https://hook.eu2.make.com/..."
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-700">
                  Optional Secret Header
                </label>
                <input
                  type="password"
                  value={channels.webhookSecretHeader}
                  onChange={(e) => onChange({ ...channels, webhookSecretHeader: e.target.value })}
                  placeholder="X-DriveCast-Secret"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="button"
                disabled={testing || !channels.unifiedWebhookUrl.trim() || !accessToken}
                onClick={handleTestWebhook}
                className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
              >
                {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Send Test Ping
              </button>

              {testResult && (
                <div
                  className={`inline-flex items-center gap-1.5 text-xs font-medium ${
                    testResult.ok ? 'text-emerald-700' : 'text-red-700'
                  }`}
                >
                  {testResult.ok ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <ShieldAlert className="h-4 w-4" />
                  )}
                  <span>{testResult.message}</span>
                </div>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                Or Per-Platform Webhook Overrides
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                Optional: set separate webhook URLs for each social platform. Leave blank to fall back to the unified webhook above.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {(['instagram', 'facebook', 'pinterest', 'tiktok', 'youtube'] as PlatformKey[]).map((platform) => (
                <div key={platform}>
                  <label className="mb-1.5 block text-xs font-medium capitalize text-slate-700">
                    {platform === 'youtube' ? 'YouTube Shorts' : platform} Webhook URL
                  </label>
                  <input
                    type="url"
                    value={channels.platformWebhooks[platform]}
                    onChange={(e) => updatePlatformWebhook(platform, e.target.value)}
                    placeholder={`https://... (${platform === 'youtube' ? 'youtube shorts' : platform})`}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-900 p-5 text-slate-100">
            <p className="text-xs font-semibold text-slate-300">
              Payload Delivered to Your Webhook
            </p>
            <pre className="mt-2 overflow-x-auto font-mono text-xs leading-relaxed text-slate-200">
{`{
  "event": "drivecast_publish_bundle",
  "platforms": ["instagram", "facebook", "pinterest", "tiktok", "youtube"],
  "video": {
    "id": "1AbC...",
    "name": "reel_01.mp4",
    "streamUrl": "https://.../api/media/stream/<30m-signed-token>"
  },
  "posts": {
    "instagram": { "caption": "...", "hashtags": [...] },
    "facebook":  { "headline": "...", "postText": "..." },
    "pinterest": { "pinTitle": "...", "pinDescription": "...", "suggestedBoard": "..." },
    "tiktok":    { "caption": "...", "onScreenHook": "...", "hashtags": [...] },
    "youtube":   { "title": "... #Shorts", "description": "...", "tags": [...], "hashtags": [...] }
  }
}`}
            </pre>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">
              Meta Graph API (Instagram & Facebook)
            </h3>
            <p className="text-xs text-slate-500">
              Uses Meta Graph API v21.0 to publish Reels to Instagram Business and videos to your Facebook Page.
            </p>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">
                Meta Page / User Access Token
              </label>
              <input
                type="password"
                value={channels.direct.metaAccessToken}
                onChange={(e) => updateDirect('metaAccessToken', e.target.value)}
                placeholder="EAAG..."
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">
                Instagram Business Account ID
              </label>
              <input
                type="text"
                value={channels.direct.instagramAccountId}
                onChange={(e) => updateDirect('instagramAccountId', e.target.value)}
                placeholder="178414..."
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">
                Facebook Page ID
              </label>
              <input
                type="text"
                value={channels.direct.facebookPageId}
                onChange={(e) => updateDirect('facebookPageId', e.target.value)}
                placeholder="104829..."
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none"
              />
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
              <h3 className="text-sm font-semibold text-slate-900">Pinterest API v5</h3>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">
                  Pinterest OAuth Access Token
                </label>
                <input
                  type="password"
                  value={channels.direct.pinterestAccessToken}
                  onChange={(e) => updateDirect('pinterestAccessToken', e.target.value)}
                  placeholder="pina_..."
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">
                  Target Board ID
                </label>
                <input
                  type="text"
                  value={channels.direct.pinterestBoardId}
                  onChange={(e) => updateDirect('pinterestBoardId', e.target.value)}
                  placeholder="984210..."
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none"
                />
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
              <h3 className="text-sm font-semibold text-slate-900">TikTok Content Posting API v2</h3>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">
                  TikTok User Access Token
                </label>
                <input
                  type="password"
                  value={channels.direct.tiktokAccessToken}
                  onChange={(e) => updateDirect('tiktokAccessToken', e.target.value)}
                  placeholder="act...."
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none"
                />
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
              <h3 className="text-sm font-semibold text-slate-900">YouTube Data API v3 (Shorts)</h3>
              <p className="text-xs text-slate-500">
                Requires an OAuth token with <code className="font-mono">youtube.upload</code> scope, or use Automation Webhook above.
              </p>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">
                  YouTube OAuth Access Token
                </label>
                <input
                  type="password"
                  value={channels.direct.youtubeAccessToken}
                  onChange={(e) => updateDirect('youtubeAccessToken', e.target.value)}
                  placeholder="ya29...."
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none"
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
