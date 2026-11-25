import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

const app: FirebaseApp =
  getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);

const provider = new GoogleAuthProvider();
// Minimum required scope for automated Gmail payslip dispatch
provider.addScope('https://www.googleapis.com/auth/gmail.send');
provider.setCustomParameters({ prompt: 'select_account' });

let isSigningIn = false;
// Strictly in-memory OAuth access token caching (never localStorage or sessionStorage)
let cachedGmailAccessToken: string | null = null;
let cachedGoogleUser: User | null = null;

export const initGoogleAuthListener = (
  onConnected?: (user: User, token: string) => void,
  onDisconnected?: () => void
) => {
  return onAuthStateChanged(auth, (user) => {
    cachedGoogleUser = user;
    if (user && cachedGmailAccessToken) {
      onConnected?.(user, cachedGmailAccessToken);
    } else if (!isSigningIn) {
      if (!user) cachedGmailAccessToken = null;
      onDisconnected?.();
    }
  });
};

export const connectGoogleForGmail = async (): Promise<{
  user: User;
  accessToken: string;
}> => {
  isSigningIn = true;
  try {
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Gagal mendapatkan token akses Gmail dari Google Sign-In.');
    }
    cachedGmailAccessToken = credential.accessToken;
    cachedGoogleUser = result.user;
    return { user: result.user, accessToken: cachedGmailAccessToken };
  } finally {
    isSigningIn = false;
  }
};

export const getGmailAccessToken = (): string | null => cachedGmailAccessToken;
export const getConnectedGoogleUser = (): User | null => cachedGoogleUser;

export const disconnectGoogleGmail = async (): Promise<void> => {
  cachedGmailAccessToken = null;
  cachedGoogleUser = null;
  await auth.signOut();
};
