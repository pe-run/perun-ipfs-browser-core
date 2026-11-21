import type { Session, WebContents } from 'electron';
import { parseAddress } from '../../shared/address';
import { requestRedirect } from '../ipfs/request-address';
export const securePreferences = {
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
  webSecurity: true,
} as const;
const localNavigations = new Map<number, URL>();

export function isAuthorizedLocalNavigation(id: number, url: string) {
  const allowed = localNavigations.get(id);
  if (!allowed) return false;
  const target = new URL(url);
  target.hash = '';
  if (target.href === allowed.href) return true;
  const directory = new URL(allowed);
  if (!directory.pathname.endsWith('/')) directory.pathname += '/';
  return target.href === directory.href;
}

export async function loadLocalURL(contents: WebContents, url: string) {
  const target = new URL(url);
  target.hash = '';
  const id = contents.id;
  localNavigations.set(id, target);
  try {
    await contents.loadURL(url);
  } finally {
    if (localNavigations.get(id) === target) localNavigations.delete(id);
  }
}

export function secureSession(session: Session) {
  session.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  session.setPermissionCheckHandler(() => false);
  session.setDevicePermissionHandler(() => false);
  session.webRequest.onBeforeRequest((details, callback) => {
    const protocol = new URL(details.url).protocol;
    try {
      if (protocol === 'file:') {
        parseAddress(details.url);
        const source = details.referrer || details.frame?.url;
        const initiator = details.initiatorOrigin;
        const fromFile =
          source?.startsWith('file:') &&
          (!initiator || initiator === 'null' || initiator.startsWith('file:'));
        const browserNavigation =
          details.resourceType === 'mainFrame' &&
          !initiator &&
          (!details.referrer ||
            isAuthorizedLocalNavigation(
              details.webContentsId ?? -1,
              details.url,
            ));
        return callback({ cancel: !fromFile && !browserNavigation });
      }
      const documentURL = [
        details.frame?.url,
        details.referrer,
        details.webContents?.getURL(),
      ].find((url) => url?.startsWith('p2p://shared/'));
      const redirectURL = requestRedirect(details.url, documentURL);
      if (redirectURL) return callback({ redirectURL });
    } catch {
      return callback({ cancel: true });
    }
    callback({
      cancel: ![
        'http:',
        'https:',
        'p2p:',
        'data:',
        'blob:',
        'devtools:',
        'ws:',
        'wss:',
      ].includes(protocol),
    });
  });
}
