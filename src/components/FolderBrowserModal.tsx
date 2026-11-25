import React, { useEffect, useState } from 'react';
import { ChevronRight, Folder, FolderOpen, Link2, Loader2, Search, X } from 'lucide-react';
import { fetchApiJson } from '../lib/apiClient';
import type { DriveFolder } from '../types';

interface FolderBrowserModalProps {
  isOpen: boolean;
  accessToken: string | null;
  onClose: () => void;
  onSelectFolder: (folderIdOrUrl: string) => Promise<void>;
  onConnectDrive?: () => Promise<string | null>;
}

export const FolderBrowserModal: React.FC<FolderBrowserModalProps> = ({
  isOpen,
  accessToken,
  onClose,
  onSelectFolder,
  onConnectDrive,
}) => {
  const [breadcrumbs, setBreadcrumbs] = useState<Array<{ id: string; name: string }>>([
    { id: 'root', name: 'My Drive' },
  ]);
  const [folders, setFolders] = useState<DriveFolder[]>([]);
  const [loading, setLoading] = useState(false);
  const [connectingDrive, setConnectingDrive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [folderUrlInput, setFolderUrlInput] = useState('');
  const [selecting, setSelecting] = useState(false);

  const currentParent = breadcrumbs[breadcrumbs.length - 1];

  const loadFolders = async (parentId: string, q = '', tokenOverride?: string) => {
    const token = tokenOverride || accessToken;
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ parentId });
      if (q.trim()) params.set('q', q.trim());
      const { ok, data } = await fetchApiJson<{ folders?: DriveFolder[]; error?: string }>(
        `/api/drive/folders?${params.toString()}`,
        token
      );
      if (!ok) {
        throw new Error(data.error || 'Could not load folders from Google Drive.');
      }
      setFolders(data.folders || []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && accessToken) {
      loadFolders(currentParent.id, '');
    }
  }, [isOpen, accessToken, currentParent.id]);

  if (!isOpen) return null;

  const handleOpenFolder = (folder: DriveFolder) => {
    setSearchQuery('');
    setBreadcrumbs((prev) => [...prev, { id: folder.id, name: folder.name }]);
  };

  const handleJumpBreadcrumb = (index: number) => {
    setSearchQuery('');
    setBreadcrumbs((prev) => prev.slice(0, index + 1));
  };

  const handleConfirmFolder = async (folderIdOrUrl: string) => {
    if (!folderIdOrUrl.trim()) return;
    setSelecting(true);
    setError(null);
    try {
      await onSelectFolder(folderIdOrUrl.trim());
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSelecting(false);
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loadFolders(currentParent.id, searchQuery);
  };

  const handleConnectInsideModal = async () => {
    if (!onConnectDrive) return;
    setConnectingDrive(true);
    setError(null);
    try {
      const token = await onConnectDrive();
      if (token) {
        await loadFolders(currentParent.id, searchQuery, token);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setConnectingDrive(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="folder-modal-title"
    >
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h2 id="folder-modal-title" className="text-lg font-semibold text-slate-900">
              Select Google Drive Folder
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Browse your Drive folders or paste a folder link directly.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
            aria-label="Close modal"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="border-b border-slate-200 bg-slate-50 px-6 py-4 space-y-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={folderUrlInput}
                onChange={(e) => setFolderUrlInput(e.target.value)}
                placeholder="Paste Drive folder link or ID (e.g. https://drive.google.com/drive/folders/...)"
                className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
              />
            </div>
            <button
              type="button"
              disabled={selecting || !folderUrlInput.trim()}
              onClick={() => handleConfirmFolder(folderUrlInput)}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              {selecting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Load Link
            </button>
          </div>

          <form onSubmit={handleSearchSubmit} className="flex items-center justify-between gap-3">
            <div className="flex flex-1 items-center gap-1 overflow-x-auto text-xs text-slate-600">
              {breadcrumbs.map((crumb, idx) => (
                <React.Fragment key={crumb.id}>
                  {idx > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />}
                  <button
                    type="button"
                    onClick={() => handleJumpBreadcrumb(idx)}
                    className={`rounded px-1.5 py-1 transition-colors whitespace-nowrap shrink-0 ${
                      idx === breadcrumbs.length - 1
                        ? 'font-semibold text-slate-900'
                        : 'hover:bg-slate-200/70 hover:text-slate-900'
                    }`}
                  >
                    {crumb.name}
                  </button>
                </React.Fragment>
              ))}
            </div>

            <div className="relative w-56 shrink-0">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search folders..."
                className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
              />
            </div>
          </form>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-3">
          {error && (
            <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}

          {!accessToken ? (
            <div className="py-12 text-center space-y-3">
              <FolderOpen className="mx-auto h-8 w-8 text-blue-600" />
              <p className="text-sm font-medium text-slate-800">
                Reconnect Google Drive to browse folders
              </p>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                Your Drive session refreshed on reload. Click below to restore Drive access for your signed-in account, or paste a folder link above.
              </p>
              {onConnectDrive && (
                <button
                  type="button"
                  disabled={connectingDrive}
                  onClick={handleConnectInsideModal}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {connectingDrive ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  {connectingDrive ? 'Connecting...' : 'Connect Google Drive'}
                </button>
              )}
            </div>
          ) : loading ? (
            <div className="flex items-center justify-center py-12 text-sm text-slate-500">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading folders from Google Drive...
            </div>
          ) : folders.length === 0 ? (
            <div className="py-12 text-center">
              <FolderOpen className="mx-auto h-8 w-8 text-slate-300" />
              <p className="mt-2 text-sm font-medium text-slate-700">No subfolders found here</p>
              <p className="mt-1 text-xs text-slate-500">
                You can still select "{currentParent.name}" if your videos are directly inside it.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {folders.map((folder) => (
                <li
                  key={folder.id}
                  className="flex items-center justify-between gap-3 py-2.5 transition-colors hover:bg-slate-50/80 px-2 rounded-lg"
                >
                  <button
                    type="button"
                    onClick={() => handleOpenFolder(folder)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <Folder className="h-4 w-4 shrink-0 text-blue-600" />
                    <span className="truncate text-sm font-medium text-slate-800">
                      {folder.name}
                    </span>
                  </button>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleOpenFolder(folder)}
                      className="rounded-md px-2.5 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-200/70 hover:text-slate-900 whitespace-nowrap"
                    >
                      Open
                    </button>
                    <button
                      type="button"
                      disabled={selecting}
                      onClick={() => handleConfirmFolder(folder.id)}
                      className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-900 transition-colors hover:border-blue-600 hover:text-blue-600 whitespace-nowrap"
                    >
                      Use Folder
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-6 py-3.5">
          <span className="text-xs text-slate-500 truncate max-w-xs">
            Current folder: <strong className="text-slate-800">{currentParent.name}</strong>
          </span>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={selecting}
              onClick={() => handleConfirmFolder(currentParent.id)}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
            >
              {selecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Select "{currentParent.name}"
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
