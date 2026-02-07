import { Component, type ReactNode } from "react";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
    };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    // Log error to console in development
    console.error("Error caught by boundary:", error, errorInfo);

    // Call optional error handler prop
    this.props.onError?.(error, errorInfo);
  }

  handleReset = (): void => {
    this.setState({
      hasError: false,
      error: null,
    });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      // Use custom fallback if provided
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default fallback UI
      return (
        <div className="flex items-center justify-center min-h-screen bg-slate-900 p-4">
          <div className="max-w-md w-full bg-slate-800 border border-slate-600 rounded-lg p-6 shadow-xl">
            <div className="flex items-center gap-3 mb-4">
              <ExclamationTriangleIcon className="w-8 h-8 text-red-500" />
              <h2 className="text-xl font-bold text-slate-200">
                Something went wrong
              </h2>
            </div>

            <p className="text-slate-400 mb-4">
              An unexpected error occurred. The application has encountered a problem.
            </p>

            {this.state.error && (
              <details className="mb-4">
                <summary className="text-sm text-slate-500 cursor-pointer hover:text-slate-400 mb-2">
                  Error details
                </summary>
                <pre className="text-xs text-red-400 bg-slate-900 p-3 rounded border border-slate-700 overflow-x-auto">
                  {this.state.error.toString()}
                  {this.state.error.stack && `\n\n${this.state.error.stack}`}
                </pre>
              </details>
            )}

            <div className="flex gap-3">
              <button
                onClick={this.handleReset}
                className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700 transition-colors"
              >
                Try Again
              </button>
              <button
                onClick={() => window.location.reload()}
                className="flex-1 bg-slate-700 text-slate-200 px-4 py-2 rounded-md text-sm font-medium hover:bg-slate-600 transition-colors"
              >
                Reload Page
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
