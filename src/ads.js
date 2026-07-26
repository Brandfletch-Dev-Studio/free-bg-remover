// Ad configuration — synced via Supabase (global for ALL users)
import { supabase } from './lib/supabase.js';

export const DEFAULT_CONFIG = {
  enabled: true,
  popunder: {
    enabled: true,
    src: 'https://pl30548466.effectivecpmnetwork.com/0c/2e/ae/0c2eae789ccc8896f9b7947f69e23c10.js',
  },
  nativeBanner: {
    enabled: true,
    src: 'https://pl30548467.effectivecpmnetwork.com/4b3b32e7fb3861304ce6e105fbcbb60a/invoke.js',
    containerId: 'container-4b3b32e7fb3861304ce6e105fbcbb60a',
  },
  guestLimit: 3,
};

let cachedConfig = null;
let fetchPromise = null;

export async function fetchAdConfig() {
  if (cachedConfig) return cachedConfig;
  if (fetchPromise) return fetchPromise;

  fetchPromise = (async () => {
    try {
      const { data, error } = await supabase
        .from('site_settings')
        .select('config')
        .eq('id', 1)
        .single();

      if (error || !data?.config) throw error || new Error('No config');
      cachedConfig = { ...DEFAULT_CONFIG, ...data.config };
      return cachedConfig;
    } catch (err) {
      console.warn('Ad config fetch failed, using defaults', err);
      cachedConfig = DEFAULT_CONFIG;
      return cachedConfig;
    }
  })();

  return fetchPromise;
}

export async function saveAdConfigRemote(newConfig) {
  const { error } = await supabase
    .from('site_settings')
    .update({ config: newConfig, updated_at: new Date().toISOString() })
    .eq('id', 1);
  if (error) throw error;
  cachedConfig = newConfig;
  return newConfig;
}

function injectScript(src, id) {
  if (document.getElementById(id)) return;
  const s = document.createElement('script');
  s.id = id;
  s.src = src;
  s.async = true;
  s.setAttribute('data-cfasync', 'false');
  document.body.appendChild(s);
}

function removeScript(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

// Initialize ads — called after React renders the container div
export function initAds(config) {
  if (!config) return;

  // Clean up
  removeScript('adsterra-popunder');
  removeScript('adsterra-native');

  if (!config.enabled) return;

  // Popunder — loads immediately (triggers on user clicks)
  if (config.popunder?.enabled && config.popunder?.src) {
    injectScript(config.popunder.src, 'adsterra-popunder');
  }

  // Native banner — wait for the container div to exist in DOM, then load script
  if (config.nativeBanner?.enabled && config.nativeBanner?.src) {
    const containerId = config.nativeBanner.containerId;

    // Wait for the div to be in the DOM (React renders async)
    const tryInject = (retries = 10) => {
      const div = document.getElementById(containerId);
      if (div) {
        // Div exists — inject the script
        injectScript(config.nativeBanner.src, 'adsterra-native');
      } else if (retries > 0) {
        // Retry after a short delay (React might not have rendered yet)
        setTimeout(() => tryInject(retries - 1), 100);
      }
    };
    tryInject();
  }
}

// Guest usage tracking (local, per browser)
const USAGE_KEY = 'quickcut-guest-usage';

export function getGuestUsage() {
  try { return parseInt(localStorage.getItem(USAGE_KEY) || '0', 10); } catch { return 0; }
}

export function incrementGuestUsage() {
  const current = getGuestUsage();
  localStorage.setItem(USAGE_KEY, String(current + 1));
  return current + 1;
}

export function resetGuestUsage() {
  localStorage.removeItem(USAGE_KEY);
}

export function canGuestProcess(config) {
  return getGuestUsage() < (config?.guestLimit ?? 3);
}
