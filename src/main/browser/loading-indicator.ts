import { WebContentsView } from 'electron';
import { securePreferences } from '../security/policy';

export const loadingIndicatorSize = 56;

// A separate view keeps the indicator above the page and out of its DOM.
export function createLoadingIndicator() {
  const view = new WebContentsView({
    webPreferences: {
      ...securePreferences,
      partition: 'perun-loading-indicator',
      javascript: false,
    },
  });
  view.setVisible(false);
  view.setBackgroundColor('#00000000');
  const html = `<!doctype html>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>Loading</title>
<style>
  body {
    margin: 0; height: 100vh; display: grid; place-items: center;
    border-radius: 50%; background: #202124;
  }
  div {
    width: 28px; height: 28px; border: 4px solid #62666d;
    border-top-color: #fff; border-radius: 50%;
    animation: spin .8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { div { animation: none; } }
</style>
<div role="progressbar" aria-label="Loading"></div>`;
  void view.webContents
    .loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    .catch(() => view.setVisible(false));
  return view;
}
