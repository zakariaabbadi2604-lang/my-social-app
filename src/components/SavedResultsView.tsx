import React, { useState } from 'react';
import {
  FolderOpen,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import { deleteFolderLookup } from '../lib/firestorePosts';
import type { SavedFolderLookup } from '../types';

interface SavedResultsViewProps {
  lookups: SavedFolderLookup[];
  onSyncFolderFromDrive: (folderId: string) => void;
}

export const SavedResultsView: React.FC<SavedResultsViewProps> = ({
  lookups,
  onSyncFolderFromDrive,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [busyActionId, setBusyActionId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleDeleteLookup = async (lookup: SavedFolderLookup) => {
    setBusyActionId(`del-${lookup.id}`);
    setErrorMsg(null);
    try {
      await deleteFolderLookup(lookup.id);
    } catch (err) {
      setErrorMsg((err as Error).message || 'Failed to delete saved folder entry.');
    } finally {
      setBusyActionId(null);
    }
  };

  const filteredLookups = lookups.filter((l) => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return true;
    return (
      l.folderName.toLowerCase().includes(q) ||
      l.appName.toLowerCase().includes(q) ||
      l.language.toLowerCase().includes(q)
    );
  });

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Folder History</h2>
          <p className="mt-1 text-sm text-slate-500">
            Quick shortcuts to Google Drive folders you have loaded. Generated posts are kept in your active session queue ready for editing and delivery.
          </p>
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search by folder name..."
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-xs text-slate-900 focus:border-blue-600 focus:outline-none"
          />
        </div>
      </div>

      {errorMsg && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 break-words">
          {errorMsg}
        </div>
      )}

      {filteredLookups.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-14 text-center">
          <FolderOpen className="mx-auto h-9 w-9 text-slate-300" />
          <h3 className="mt-3 text-base font-semibold text-slate-900">
            {lookups.length === 0 ? 'No saved folders yet' : 'No matching folders found'}
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            {lookups.length === 0
              ? 'Load a Google Drive folder from Folder Queue to list it here for one-click syncing.'
              : 'Try searching with a different Drive folder name.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredLookups.map((lookup) => (
            <div
              key={lookup.id}
              className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-5 py-4"
            >
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <div className="mt-0.5 rounded-lg bg-blue-50 p-2 text-blue-600 shrink-0">
                  <FolderOpen className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-semibold text-slate-900">
                    {lookup.folderName}
                  </h3>
                  <p className="mt-1 text-xs text-slate-500 tabular-nums">
                    {lookup.videoCount} video{lookup.videoCount === 1 ? '' : 's'} in folder ·{' '}
                    {lookup.language} · Last synced {new Date(lookup.updatedAtMs).toLocaleString()}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={busyActionId !== null}
                  onClick={() => onSyncFolderFromDrive(lookup.folderId)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap"
                  title="Load videos from this Google Drive folder"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Load from Drive
                </button>

                <button
                  type="button"
                  disabled={busyActionId !== null}
                  onClick={() => handleDeleteLookup(lookup)}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                  title="Remove folder shortcut"
                  aria-label="Remove folder shortcut"
                >
                  {busyActionId === `del-${lookup.id}` ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
