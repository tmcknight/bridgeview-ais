import { Component, ReactNode } from "react";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";

interface ComponentErrorBoundaryProps {
  children: ReactNode;
  componentName: string;
}

interface ComponentErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Smaller error boundary for individual components.
 * Shows an inline error message instead of taking over the whole screen.
 */
class ComponentErrorBoundary extends Component<
  ComponentErrorBoundaryProps,
  ComponentErrorBoundaryState
> {
  constructor(props: ComponentErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
    };
  }

  static getDerivedStateFromError(error: Error): ComponentErrorBoundaryState {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error(
      `Error in ${this.props.componentName}:`,
      error,
      errorInfo
    );
  }

  handleReset = (): void => {
    this.setState({
      hasError: false,
      error: null,
    });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center h-full bg-slate-900/50 p-4">
          <div className="max-w-sm w-full bg-slate-800 border border-slate-600 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <ExclamationTriangleIcon className="w-5 h-5 text-yellow-500 shrink-0" />
              <h3 className="text-sm font-semibold text-slate-200">
                {this.props.componentName} Error
              </h3>
            </div>

            <p className="text-xs text-slate-400 mb-3">
              This component encountered an error and couldn't render.
            </p>

            {this.state.error && (
              <details className="mb-3">
                <summary className="text-xs text-slate-500 cursor-pointer hover:text-slate-400 mb-1">
                  Details
                </summary>
                <pre className="text-xs text-red-400 bg-slate-900 p-2 rounded border border-slate-700 overflow-x-auto max-h-32 overflow-y-auto">
                  {this.state.error.toString()}
                </pre>
              </details>
            )}

            <button
              onClick={this.handleReset}
              className="w-full bg-blue-600 text-white px-3 py-1.5 rounded text-xs font-medium hover:bg-blue-700 transition-colors"
            >
              Try Again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ComponentErrorBoundary;
