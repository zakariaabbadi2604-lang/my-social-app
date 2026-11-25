import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  reauthenticateWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  type User,
} from 'firebase/auth';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

export const DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
];

export const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
void testConnection();

function createDriveProvider(emailHint?: string | null, forceAccountSelect = false) {
  const p = new GoogleAuthProvider();
  for (const scope of DRIVE_SCOPES) {
    p.addScope(scope);
  }
  const customParams: Record<string, string> = {};
  if (emailHint) {
    customParams.login_hint = emailHint;
  }
  if (forceAccountSelect) {
    customParams.prompt = 'select_account';
  }
  if (Object.keys(customParams).length > 0) {
    p.setCustomParameters(customParams);
  }
  return p;
}

// Keep OAuth access token strictly in memory (never localStorage or sessionStorage).
let cachedAccessToken: string | null = null;

interface GisTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

interface GisTokenClient {
  requestAccessToken: (overrideConfig?: { prompt?: string; hint?: string }) => void;
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            hint?: string;
            prompt?: string;
            callback: (response: GisTokenResponse) => void;
            error_callback?: (err: { type?: string; message?: string }) => void;
          }) => GisTokenClient;
        };
      };
    };
  }
}

export const initAuth = (
  onUserSignedIn?: (user: User, token: string | null) => void,
  onUserSignedOut?: () => void
) => {
  return onAuthStateChanged(auth, (user: User | null) => {
    if (user) {
      onUserSignedIn?.(user, cachedAccessToken);
    } else {
      cachedAccessToken = null;
      onUserSignedOut?.();
    }
  });
};

export const googleSignIn = async (forceAccountSelect = false): Promise<{
  user: User;
  accessToken: string;
} | null> => {
  const provider = createDriveProvider(auth.currentUser?.email, forceAccountSelect);
  const result = await signInWithPopup(auth, provider);
  const credential = GoogleAuthProvider.credentialFromResult(result);
  if (!credential?.accessToken) {
    throw new Error('Could not obtain Google Drive access token. Please try signing in again.');
  }

  cachedAccessToken = credential.accessToken;
  return { user: result.user, accessToken: cachedAccessToken };
};

function requestGisAccessToken(emailHint?: string | null): Promise<string> {
  return new Promise((resolve, reject) => {
    const oauth2 = window.google?.accounts?.oauth2;
    const clientId = firebaseConfig.oAuthClientId;
    if (!oauth2 || !clientId) {
      reject(new Error('GIS_UNAVAILABLE'));
      return;
    }

    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error('GIS_TIMEOUT'));
      }
    }, 30000);

    try {
      const client = oauth2.initTokenClient({
        client_id: clientId,
        scope: DRIVE_SCOPES.join(' '),
        hint: emailHint || undefined,
        prompt: '',
        callback: (resp) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (resp.error || !resp.access_token) {
            reject(new Error(resp.error_description || resp.error || 'GIS_NO_TOKEN'));
            return;
          }
          cachedAccessToken = resp.access_token;
          resolve(resp.access_token);
        },
        error_callback: (err) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(new Error(err?.message || err?.type || 'GIS_ERROR'));
        },
      });
      client.requestAccessToken({
        prompt: '',
        hint: emailHint || undefined,
      });
    } catch (err) {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(err);
      }
    }
  });
}

/**
 * Obtains a fresh Google Drive OAuth access token for an already signed-in user
 * using login_hint and empty prompt (avoiding account-picker & re-consent when already granted).
 */
export const requestDriveAccessToken = async (
  emailHint?: string | null
): Promise<string> => {
  const hint = emailHint || auth.currentUser?.email || undefined;

  if (typeof window !== 'undefined' && window.google?.accounts?.oauth2 && firebaseConfig.oAuthClientId) {
    try {
      const token = await requestGisAccessToken(hint);
      return token;
    } catch (gisErr) {
      const msg = (gisErr as Error).message || '';
      if (msg.toLowerCase().includes('popup_closed') || msg.toLowerCase().includes('access_denied')) {
        throw new Error('Google Drive connection was cancelled.');
      }
      // Fall back to Firebase popup with login_hint (no prompt=select_account)
    }
  }

  const provider = createDriveProvider(hint, false);
  const result = auth.currentUser
    ? await reauthenticateWithPopup(auth.currentUser, provider)
    : await signInWithPopup(auth, provider);
  const credential = GoogleAuthProvider.credentialFromResult(result);
  if (!credential?.accessToken) {
    throw new Error('Could not connect to Google Drive. Please try again.');
  }
  cachedAccessToken = credential.accessToken;
  return cachedAccessToken;
};

export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken;
};

export const clearAccessToken = () => {
  cachedAccessToken = null;
};

export const logout = async () => {
  cachedAccessToken = null;
  await auth.signOut();
};
