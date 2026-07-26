// Ad configuration — controllable from admin panel
// Stored in localStorage for instant updates without redeploy

const DEFAULT_CONFIG = {
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
  // How many free images before requiring signup
  guestLimit: 3,
};

const STORAGE_KEY = 'quickcut-ad-config';

export function getAdConfig() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return { ...DEFAULT_CONFIG, ...JSON.parse(stored) };
  } catch {}
  return DEFAULT_CONFIG;
}

export function saveAdConfig(config) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function resetAdConfig() {
  localStorage.removeItem(STORAGE_KEY);
}

// Inject a script into the page
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

// Initialize ads based on config
export function initAds(config = getAdConfig()) {
  if (!config.enabled) {
    removeScript('adsterra-popunder');
    removeScript('adsterra-native');
    return;
  }

  // Popunder
  if (config.popunder?.enabled && config.popunder?.src) {
    injectScript(config.popunder.src, 'adsterra-popunder');
  } else {
    removeScript('adsterra-popunder');
  }

  // Native banner — needs both script + container div
  if (config.nativeBanner?.enabled && config.nativeBanner?.src) {
    // Create container divs if not present
    document.querySelectorAll('[data-ad-slot]').forEach((slot) => {
      const container = slot.querySelector('.adsterra-container');
      if (!container) {
        const div = document.createElement('div');
        div.id = config.nativeBanner.containerId + '-' + slot.dataset.adSlot;
        div.className = 'adsterra-container';
        slot.appendChild(div);
      }
    });
    injectScript(config.nativeBanner.src, 'adsterra-native');
  } else {
    removeScript('adsterra-native');
  }
}

// Guest usage tracking
const USAGE_KEY = 'quickcut-guest-usage';

export function getGuestUsage() {
  try {
    return parseInt(localStorage.getItem(USAGE_KEY) || '0', 10);
  } catch {
    return 0;
  }
}

export function incrementGuestUsage() {
  const current = getGuestUsage();
  localStorage.setItem(USAGE_KEY, String(current + 1));
  return current + 1;
}

export function resetGuestUsage() {
  localStorage.removeItem(USAGE_KEY);
}

export function canGuestProcess(config = getAdConfig()) {
  return getGuestUsage() < config.guestLimit;
}
