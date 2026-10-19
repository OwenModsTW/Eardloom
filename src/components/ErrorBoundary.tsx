import { Component, type ReactNode } from "react";

/**
 * Keeps one broken page from blanking the whole window: shows what went wrong and a way
 * out. `resetKey` clears the error when the author goes somewhere else.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey: string; onHome: () => void }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("Page failed to draw", error);
  }

  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="page page-error" role="alert">
        <h1>This page couldn't be shown</h1>
        <p>Something went wrong while drawing it. Your work is saved; nothing was lost.</p>
        <pre>{this.state.error.message}</pre>
        <button className="primary" onClick={this.props.onHome}>
          Back to home
        </button>
      </div>
    );
  }
}
