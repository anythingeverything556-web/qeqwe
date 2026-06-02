import { StrictMode, Component } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

// Version stamp — check browser console to verify which version is running
console.log('[CHATGBT] Build v3.2 — detectedLocale scope fix + language passthrough');

// Global unhandled error/rejection handlers — prevents "big log error" crashes
window.addEventListener('unhandledrejection', (event) => {
  const msg = event.reason?.message || event.reason?.toString?.() || 'Unknown async error';
  // Suppress common non-critical errors that spam the console
  if (msg.includes('NotAllowedError') || msg.includes('autoplay') || msg.includes('play() failed')) {
    console.warn('[CHATGBT] Suppressed non-critical audio error:', msg);
    event.preventDefault(); // Prevent default console error
    return;
  }
  console.error('[CHATGBT] Unhandled promise rejection:', event.reason);
});

window.addEventListener('error', (event) => {
  // Ignore script loading errors from extensions
  if (event.message && (event.message.includes('chrome-extension') || event.message.includes('moz-extension'))) {
    return;
  }
  console.error('[CHATGBT] Uncaught error:', event.error || event.message);
});

// Error Boundary — catches React render crashes, shows recovery UI
// instead of the dreaded blank white screen.
// Special handling for localStorage QuotaExceededError — the most common crash.
interface EBS { hasError: boolean; error: string; }
class ErrorBoundary extends Component<{ children: React.ReactNode }, EBS> {
  state: EBS = { hasError: false, error: '' };
  static getDerivedStateFromError(error: Error) { return { hasError: true, error: error.message || 'Unknown error' }; }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Log the error with stack trace for debugging
    console.error('[ErrorBoundary] React render crash:', error, info.componentStack);
  }
  render() {
    if (this.state.hasError) {
      const isQuotaError = this.state.error.includes('quota') || this.state.error.includes('QuotaExceeded') || this.state.error.includes('exceeded the quota');
      return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#faf9f6', padding: 24 }}>
          <div style={{ maxWidth: 520, textAlign: 'center', fontFamily: 'system-ui, sans-serif' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: '#1c1a17', marginBottom: 8 }}>Something went wrong</h1>
            <p style={{ fontSize: 13, color: '#78716c', marginBottom: 16, lineHeight: 1.6 }}>
              {isQuotaError
                ? 'The app ran out of local storage space. Your cloud data is safe on the server — just clear the local cache and reload.'
                : 'The app crashed. This is usually caused by corrupted local data. Try clearing app data and reloading.'}
            </p>
            {isQuotaError && (
              <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 12, padding: 12, marginBottom: 12, fontSize: 12, color: '#1e40af', textAlign: 'center' }}>
                ✅ Your sounds and settings are safely stored on the cloud server. Only the local browser cache needs to be cleared.
              </div>
            )}
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 12, padding: 12, marginBottom: 16, fontSize: 11, fontFamily: 'monospace', color: '#991b1b', textAlign: 'left', wordBreak: 'break-all', maxHeight: 120, overflow: 'auto' }}>
              {this.state.error}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
              {isQuotaError ? (
                <>
                  <button onClick={() => { try { localStorage.removeItem('custom_sounds'); localStorage.removeItem('sound_url_cache'); localStorage.removeItem('sound_volumes'); localStorage.removeItem('hidden_sounds'); localStorage.removeItem('chatter_voices'); localStorage.removeItem('cpresets'); localStorage.removeItem('favs'); localStorage.removeItem('mappings'); localStorage.removeItem('aliases'); } catch {} window.location.reload(); }} style={{ padding: '10px 20px', background: '#2563eb', color: 'white', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                    Clear Local Cache &amp; Reload
                  </button>
                  <button onClick={() => window.location.reload()} style={{ padding: '10px 20px', background: '#1c1a17', color: 'white', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                    Just Reload
                  </button>
                </>
              ) : (
                <>
                  <button onClick={() => { try { localStorage.removeItem('hidden_sounds'); localStorage.removeItem('custom_sounds'); localStorage.removeItem('sound_volumes'); localStorage.removeItem('sound_url_cache'); } catch {} window.location.reload(); }} style={{ padding: '10px 20px', background: '#dc2626', color: 'white', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                    Clear Sound Data &amp; Reload
                  </button>
                  <button onClick={() => window.location.reload()} style={{ padding: '10px 20px', background: '#1c1a17', color: 'white', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                    Just Reload
                  </button>
                  <button onClick={() => { try { localStorage.clear(); } catch {} window.location.reload(); }} style={{ padding: '10px 20px', background: '#78716c', color: 'white', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                    Factory Reset
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
