import React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'An unexpected application error occurred.',
    };
  }

  render() {
    if (this.state.hasError) {
      let displayMessage = this.state.message;
      try {
        const parsed = JSON.parse(this.state.message) as { error?: string; operationType?: string };
        if (parsed && parsed.error) {
          displayMessage = `Database ${parsed.operationType || 'operation'} failed: ${parsed.error}`;
        }
      } catch {
        // Not a JSON FirestoreErrorInfo string
      }

      return (
        <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
          <div className="w-full max-w-md rounded-xl border border-red-200 bg-white p-6 space-y-4 shadow-sm">
            <div className="flex items-center gap-2.5 text-red-700">
              <AlertCircle className="h-5 w-5 shrink-0" />
              <h1 className="text-base font-semibold">Something went wrong</h1>
            </div>
            <p className="break-words text-sm text-slate-600 leading-relaxed">{displayMessage}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
