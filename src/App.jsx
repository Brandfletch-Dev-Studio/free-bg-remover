import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from './lib/supabase.js';
import { removeBackground, preload } from '@imgly/background-removal';
import {
  fetchAdConfig, saveAdConfigRemote, initAds,
  getGuestUsage, incrementGuestUsage, canGuestProcess,
  resetGuestUsage, DEFAULT_CONFIG,
} from './ads.js';

const ADMIN_EMAIL = 'arthurchibondoacademy@gmail.com';

// Use the smallest model — 6MB vs 24MB for fp16
const MODEL = 'isnet_quint8';

export default function App() {
  const [user, setUser] = useState(null);
  const [authMode, setAuthMode] = useState('signin');
  const [authForm, setAuthForm] = useState({ email: '', password: '' });
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authReason, setAuthReason] = useState('');

  const [file, setFile] = useState(null);
  const [originalUrl, setOriginalUrl] = useState(null);
  const [resultUrl, setResultUrl] = useState(null);
  const [resultBlob, setResultBlob] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [progressText, setProgressText] = useState('');
  const [progressPct, setProgressPct] = useState(0);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const dropRef = useRef(null);

  const [modelStatus, setModelStatus] = useState('idle');
  const [modelProgress, setModelProgress] = useState(0);

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  const [dlOpen, setDlOpen] = useState(false);
  const dlRef = useRef(null);

  const [showApkPrompt, setShowApkPrompt] = useState(false);
  const [showAdSettings, setShowAdSettings] = useState(false);
  const [adConfig, setAdConfig] = useState(DEFAULT_CONFIG);
  const [adConfigLoaded, setAdConfigLoaded] = useState(false);
  const [savingAds, setSavingAds] = useState(false);
  const [guestUsage, setGuestUsage] = useState(getGuestUsage());
  const [showLimitModal, setShowLimitModal] = useState(false);

  const isAdmin = user?.email?.toLowerCase() === ADMIN_EMAIL;

  // --- Auth state ---
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        resetGuestUsage();
        setGuestUsage(0);
      }
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  // --- Close dropdowns on outside click ---
  useEffect(() => {
    function handleClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
      if (dlRef.current && !dlRef.current.contains(e.target)) setDlOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // --- Preload AI model IMMEDIATELY on mount ---
  useEffect(() => {
    let cancelled = false;
    if (modelStatus !== 'idle') return;
    setModelStatus('loading');
    setProgressText('Loading AI model (6MB)...');

    preload({
      model: MODEL,
      progress: (key, current, total) => {
        if (cancelled) return;
        const pct = total > 0 ? Math.round((current / total) * 100) : 0;
        setModelProgress(pct);
        if (key && key.includes('fetch')) {
          setProgressText(`Downloading AI model... ${pct}%`);
        }
      },
    })
      .then(() => {
        if (cancelled) return;
        setModelStatus('ready');
        setModelProgress(100);
        setProgressText('');
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('Model preload failed:', err);
        setModelStatus('idle');
        setProgressText('');
      });

    return () => { cancelled = true; };
  }, [modelStatus]);

  // --- Fetch ad config from Supabase (global for all users) ---
  useEffect(() => {
    fetchAdConfig().then((config) => {
      setAdConfig(config);
      setAdConfigLoaded(true);
    });
  }, []);

  // --- Init ads after div is rendered ---
  useEffect(() => {
    if (adConfigLoaded && adConfig?.enabled) {
      requestAnimationFrame(() => initAds(adConfig));
    }
  }, [adConfigLoaded, adConfig]);

  // --- APK prompt after 30s ---
  useEffect(() => {
    const dismissed = sessionStorage.getItem('apk-dismissed');
    if (dismissed) return;
    const timer = setTimeout(() => setShowApkPrompt(true), 30000);
    return () => clearTimeout(timer);
  }, []);

  function dismissApkPrompt() {
    setShowApkPrompt(false);
    sessionStorage.setItem('apk-dismissed', '1');
  }

  async function handleAuth(e) {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError('');
    const { email, password } = authForm;
    try {
      if (authMode === 'signup') {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setAuthError('Check your email for a confirmation link!');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err) {
      setAuthError(err.message);
    } finally {
      setAuthLoading(false);
    }
  }

  useEffect(() => {
    if (user && showAuthModal) {
      setShowAuthModal(false);
      setAuthError('');
      setAuthForm({ email: '', password: '' });
    }
  }, [user, showAuthModal]);

  async function handleSignOut() {
    await supabase.auth.signOut();
    setFile(null); setOriginalUrl(null); setResultUrl(null); setResultBlob(null);
    setMenuOpen(false);
    setGuestUsage(0);
  }

  async function handleFile(selectedFile) {
    if (!selectedFile || !selectedFile.type.startsWith('image/')) {
      setError('Please select an image file.');
      return;
    }
    if (!user && !canGuestProcess(adConfig)) {
      setShowLimitModal(true);
      return;
    }
    setError('');
    setResultUrl(null);
    setFile(selectedFile);
    setOriginalUrl(URL.createObjectURL(selectedFile));
    await processImage(selectedFile);
    if (!user) {
      const newCount = incrementGuestUsage();
      setGuestUsage(newCount);
    }
  }

  const processImage = useCallback(async (imgFile) => {
    setProcessing(true);
    setError('');
    const startTime = Date.now();
    try {
      if (modelStatus !== 'ready') {
        setProgressText('Loading AI model...');
        setProgressPct(20);
      } else {
        setProgressText('Processing image...');
        setProgressPct(40);
      }
      const result = await removeBackground(imgFile, {
        model: MODEL,
        output: { format: 'image/png', quality: 'medium' },
        progress: (key, current, total) => {
          const pct = Math.round((current / total) * 100);
          if (key.includes('fetch') || key.includes('compute:fetch')) {
            setProgressText(`Downloading model... ${pct}%`);
            setProgressPct(Math.min(pct * 0.4, 40));
          } else if (key.includes('compute')) {
            setProgressText(`Removing background... ${pct}%`);
            setProgressPct(40 + Math.round(pct * 0.6));
          }
        },
      });
      setModelStatus('ready');
      const url = URL.createObjectURL(result);
      setResultUrl(url);
      setResultBlob(result);
      setProgressText(`Done in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
      setProgressPct(100);
      supabase.from('bg_remover_jobs').insert({
        user_email: user?.email || 'anonymous',
        file_size_bytes: imgFile.size,
        processing_time_ms: Date.now() - startTime,
        status: 'completed',
      }).then(() => {});
    } catch (err) {
      setError(err.message || 'Failed to process image.');
    } finally {
      setProcessing(false);
    }
  }, [modelStatus, user]);

  function reset() {
    setFile(null); setOriginalUrl(null); setResultUrl(null); setResultBlob(null);
    setError(''); setProgressText(''); setProgressPct(0); setDlOpen(false);
  }

  function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    handleFile(e.dataTransfer.files[0]);
  }

  function gateDownload(action) {
    if (!user) {
      setAuthReason('Sign up to download your result — it\'s free!');
      setShowAuthModal(true);
      setDlOpen(false);
      return;
    }
    action();
  }

  async function downloadTransparent() {
    if (!resultBlob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(resultBlob);
    a.download = 'background-removed.png';
    a.click();
    setDlOpen(false);
  }

  async function downloadWithBg(bgColor, format = 'jpeg') {
    if (!resultUrl) return;
    const img = new Image();
    img.src = resultUrl;
    await new Promise((r) => { img.onload = r; });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    const ext = format === 'jpeg' ? 'jpg' : 'png';
    canvas.toBlob((blob) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `background-removed.${ext}`;
      a.click();
    }, `image/${format}`, 0.95);
    setDlOpen(false);
  }

  async function updateAdConfig(newConfig) {
    setAdConfig(newConfig);
    initAds(newConfig);
    if (isAdmin) {
      setSavingAds(true);
      try {
        await saveAdConfigRemote(newConfig);
      } catch (err) {
        alert('Failed to save: ' + err.message);
      } finally {
        setSavingAds(false);
      }
    }
  }

  const initials = user?.email ? user.email.charAt(0).toUpperCase() : '?';
  const remainingFree = adConfig.guestLimit - guestUsage;

  // ============ AUTH MODAL ============
  const authModal = showAuthModal && !user ? (
    <div className="modal-overlay" onClick={(e) => { if (e.target.classList.contains('modal-overlay')) setShowAuthModal(false); }}>
      <div className="modal-card">
        <button className="modal-close" onClick={() => setShowAuthModal(false)}>✕</button>
        <h2 className="modal-title">Create a free account</h2>
        <p className="modal-sub">{authReason || 'Sign up to download — it\'s free forever.'}</p>
        <div className="auth-tabs">
          <button className={authMode === 'signin' ? 'active' : ''} onClick={() => setAuthMode('signin')}>Sign In</button>
          <button className={authMode === 'signup' ? 'active' : ''} onClick={() => setAuthMode('signup')}>Sign Up</button>
        </div>
        <form onSubmit={handleAuth} className="auth-form">
          <input type="email" placeholder="Email" required value={authForm.email} onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })} />
          <input type="password" placeholder="Password (min 6 chars)" required minLength="6" value={authForm.password} onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })} />
          {authError && <p className="auth-error">{authError}</p>}
          <button type="submit" className="btn btn-primary" disabled={authLoading}>
            {authLoading ? 'Please wait…' : authMode === 'signup' ? 'Create Free Account' : 'Sign In'}
          </button>
        </form>
        <p className="auth-foot">No credit card needed.</p>
      </div>
    </div>
  ) : null;

  // ============ LIMIT MODAL ============
  const limitModal = showLimitModal && !user ? (
    <div className="modal-overlay" onClick={(e) => { if (e.target.classList.contains('modal-overlay')) setShowLimitModal(false); }}>
      <div className="modal-card">
        <h2 className="modal-title">You've used all {adConfig.guestLimit} free images!</h2>
        <p className="modal-sub">Create a free account for unlimited background removals.</p>
        <div className="auth-tabs">
          <button className={authMode === 'signin' ? 'active' : ''} onClick={() => setAuthMode('signin')}>Sign In</button>
          <button className={authMode === 'signup' ? 'active' : ''} onClick={() => setAuthMode('signup')}>Sign Up</button>
        </div>
        <form onSubmit={handleAuth} className="auth-form">
          <input type="email" placeholder="Email" required value={authForm.email} onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })} />
          <input type="password" placeholder="Password (min 6 chars)" required minLength="6" value={authForm.password} onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })} />
          {authError && <p className="auth-error">{authError}</p>}
          <button type="submit" className="btn btn-primary" disabled={authLoading}>
            {authLoading ? 'Please wait…' : authMode === 'signup' ? 'Create Free Account' : 'Sign In'}
          </button>
        </form>
        <p className="auth-foot">No credit card needed. Unlimited usage.</p>
      </div>
    </div>
  ) : null;

  // ============ AD SETTINGS PANEL ============
  const adSettings = showAdSettings ? (
    <div className="modal-overlay" onClick={(e) => { if (e.target.classList.contains('modal-overlay')) setShowAdSettings(false); }}>
      <div className="modal-card" style={{ maxWidth: 480, textAlign: 'left' }}>
        <button className="modal-close" onClick={() => setShowAdSettings(false)}>✕</button>
        <h2 className="modal-title" style={{ textAlign: 'center' }}>Ad Settings</h2>
        <p className="modal-sub" style={{ textAlign: 'center' }}>Changes apply to ALL users globally.</p>
        {savingAds && <p style={{ textAlign: 'center', color: 'var(--primary)', fontSize: '0.85rem', marginBottom: 12 }}>Saving to server…</p>}

        <div className="ad-toggle-row">
          <div><span className="ad-toggle-label">All Ads</span><span className="ad-toggle-desc">Master switch</span></div>
          <button className={adConfig.enabled ? 'toggle on' : 'toggle'} onClick={() => updateAdConfig({ ...adConfig, enabled: !adConfig.enabled })}><span className="toggle-knob" /></button>
        </div>
        <hr className="dropdown-sep" />

        <div className="ad-toggle-row">
          <div><span className="ad-toggle-label">Popunder</span><span className="ad-toggle-desc">Ad opens on user click</span></div>
          <button className={adConfig.popunder?.enabled ? 'toggle on' : 'toggle'} onClick={() => updateAdConfig({ ...adConfig, popunder: { ...adConfig.popunder, enabled: !adConfig.popunder?.enabled } })}><span className="toggle-knob" /></button>
        </div>
        {adConfig.popunder?.enabled && (
          <input className="ad-input" type="text" value={adConfig.popunder?.src || ''} onChange={(e) => updateAdConfig({ ...adConfig, popunder: { ...adConfig.popunder, src: e.target.value } })} placeholder="Popunder script URL" />
        )}
        <hr className="dropdown-sep" />

        <div className="ad-toggle-row">
          <div><span className="ad-toggle-label">Native Banner</span><span className="ad-toggle-desc">Visible banner ad</span></div>
          <button className={adConfig.nativeBanner?.enabled ? 'toggle on' : 'toggle'} onClick={() => updateAdConfig({ ...adConfig, nativeBanner: { ...adConfig.nativeBanner, enabled: !adConfig.nativeBanner?.enabled } })}><span className="toggle-knob" /></button>
        </div>
        {adConfig.nativeBanner?.enabled && (
          <>
            <input className="ad-input" type="text" value={adConfig.nativeBanner?.src || ''} onChange={(e) => updateAdConfig({ ...adConfig, nativeBanner: { ...adConfig.nativeBanner, src: e.target.value } })} placeholder="Native banner script URL" />
            <input className="ad-input" type="text" value={adConfig.nativeBanner?.containerId || ''} onChange={(e) => updateAdConfig({ ...adConfig, nativeBanner: { ...adConfig.nativeBanner, containerId: e.target.value } })} placeholder="Container div ID (from Adsterra)" />
          </>
        )}
        <hr className="dropdown-sep" />

        <div className="ad-toggle-row">
          <div><span className="ad-toggle-label">Guest Free Limit</span><span className="ad-toggle-desc">Images before signup required</span></div>
          <input type="number" min="0" max="20" value={adConfig.guestLimit} onChange={(e) => updateAdConfig({ ...adConfig, guestLimit: parseInt(e.target.value) || 3 })} className="ad-number" style={{ width: 60 }} />
        </div>

        <div style={{ marginTop: 20, textAlign: 'center' }}>
          <button className="btn btn-primary btn-sm" onClick={() => setShowAdSettings(false)}>Done</button>
        </div>
      </div>
    </div>
  ) : null;

  // ============ APK BANNER ============
  const apkPrompt = showApkPrompt ? (
    <div className="apk-banner">
      <div className="apk-content">
        <div className="apk-icon"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="5" y="2" width="14" height="20" rx="2" ry="2" /><line x1="12" y1="18" x2="12" y2="18" /></svg></div>
        <div className="apk-text"><p className="apk-title">Install QuickCut</p><p className="apk-desc">Add to your home screen for instant access</p></div>
        <div className="apk-actions">
          <button className="btn btn-primary btn-sm" onClick={() => { dismissApkPrompt(); alert('To install:\n\n• Android: Chrome menu → "Install app"\n• iPhone: Safari Share → "Add to Home Screen"'); }}>Install</button>
          <button className="apk-dismiss" onClick={dismissApkPrompt}>Later</button>
        </div>
      </div>
    </div>
  ) : null;

  // ============ MAIN APP ============
  return (
    <div className="app">
      <header className="topbar">
        <div className="logo">QuickCut</div>
        <div className="topbar-right">
          {modelStatus === 'loading' && (
            <span className="badge badge-loading"><span className="dot-pulse" /> AI {modelProgress}%</span>
          )}
          {modelStatus === 'ready' && <span className="badge badge-ready">✓ AI ready</span>}
          {user ? (
            <div className="profile-menu" ref={menuRef}>
              <button className="avatar-btn" onClick={() => setMenuOpen(!menuOpen)}>
                <span className="avatar">{initials}</span>
              </button>
              {menuOpen && (
                <div className="dropdown">
                  <div className="dropdown-header">
                    <span className="avatar avatar-lg">{initials}</span>
                    <div><p className="dropdown-email">{user.email}</p><p className="dropdown-sub">{isAdmin ? 'Admin' : 'Free plan'}</p></div>
                  </div>
                  <hr className="dropdown-sep" />
                  {isAdmin && (
                    <button className="dropdown-item" onClick={() => { setShowAdSettings(true); setMenuOpen(false); }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                      Ad Settings
                    </button>
                  )}
                  <button className="dropdown-item" onClick={handleSignOut}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                    Sign Out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button className="btn btn-outline btn-sm" onClick={() => { setAuthReason(''); setShowAuthModal(true); }}>Sign In</button>
          )}
        </div>
      </header>

      {apkPrompt}

      <main className="hero">
        <h1>Remove Image Backgrounds</h1>
        <p className="hero-sub">100% free. AI-powered. Runs in your browser.</p>

        {/* Model loading bar — visible to all users while model downloads */}
        {modelStatus === 'loading' && (
          <div className="model-loading-bar">
            <p>Preparing AI model... {modelProgress}%</p>
            <div className="progress-bar" style={{ maxWidth: 300, margin: '8px auto 0' }}>
              <div className="progress-fill" style={{ width: `${modelProgress}%` }} />
            </div>
          </div>
        )}

        {/* Guest usage indicator */}
        {!user && remainingFree > 0 && remainingFree <= adConfig.guestLimit && modelStatus === 'ready' && (
          <p className="guest-count">{remainingFree} free {remainingFree === 1 ? 'image' : 'images'} left — <span className="signup-link" onClick={() => { setAuthReason('Sign up for unlimited free usage!'); setShowAuthModal(true); }}>sign up for unlimited</span></p>
        )}

        {!file && !processing && (
          <div className="drop-zone" ref={dropRef}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => document.getElementById('fileInput').click()}
            style={{ borderColor: dragOver ? 'var(--primary)' : 'var(--border)', opacity: modelStatus === 'loading' ? 0.6 : 1 }}
          >
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            <p>Drop image here or <span className="browse">browse</span></p>
            {modelStatus === 'ready' && <span className="ready-hint">AI ready — instant processing</span>}
            {modelStatus === 'loading' && <span className="loading-hint">Preparing AI model... {modelProgress}%</span>}
            <input type="file" id="fileInput" accept="image/*" hidden onChange={(e) => handleFile(e.target.files[0])} />
          </div>
        )}

        {processing && (
          <div className="progress">
            <div className="spinner" />
            <p>{progressText}</p>
            {progressPct > 0 && <div className="progress-bar"><div className="progress-fill" style={{ width: `${progressPct}%` }} /></div>}
          </div>
        )}

        {error && (
          <div className="error-box"><p>{error}</p><button className="btn btn-outline btn-sm" onClick={reset}>Try Again</button></div>
        )}

        {resultUrl && originalUrl && !processing && (
          <div className="result">
            <div className="preview-grid">
              <div className="preview-card"><p className="label">Original</p><img src={originalUrl} alt="Original" /></div>
              <div className="preview-card"><p className="label">Background Removed</p><div className="checker"><img src={resultUrl} alt="Result" /></div></div>
            </div>
            <p className="timing">{progressText}</p>
            {!user && (
              <div className="signup-hint"><span>Sign up to download your result — it's free!</span></div>
            )}
            <div className="actions">
              <div className="dl-menu" ref={dlRef}>
                <button className="btn btn-primary" onClick={() => setDlOpen(!dlOpen)}>Download <span className="chevron">▾</span></button>
                {dlOpen && (
                  <div className="dl-dropdown">
                    <button className="dl-item" onClick={() => gateDownload(downloadTransparent)}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" stroke-dasharray="4 4"/><path d="M3 3l18 18"/></svg>
                      <div><span className="dl-label">Transparent PNG</span><span className="dl-sub">No background</span></div>
                    </button>
                    <button className="dl-item" onClick={() => gateDownload(() => downloadWithBg('#ffffff', 'jpeg'))}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" fill="#fff" stroke="currentColor"/></svg>
                      <div><span className="dl-label">White background</span><span className="dl-sub">JPG format</span></div>
                    </button>
                    <button className="dl-item" onClick={() => gateDownload(() => downloadWithBg('#000000', 'jpeg'))}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" fill="#000"/></svg>
                      <div><span className="dl-label">Black background</span><span className="dl-sub">JPG format</span></div>
                    </button>
                    <button className="dl-item" onClick={() => gateDownload(() => downloadWithBg('#6c63ff', 'jpeg'))}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" fill="#6c63ff"/></svg>
                      <div><span className="dl-label">Purple background</span><span className="dl-sub">JPG format</span></div>
                    </button>
                  </div>
                )}
              </div>
              <button className="btn btn-outline" onClick={reset}>Remove Another</button>
            </div>
          </div>
        )}
      </main>

      {/* Adsterra Native Banner — single placement with EXACT container ID */}
      {adConfig.enabled && adConfig.nativeBanner?.enabled && adConfigLoaded && (
        <div className="ad-placement">
          <div id={adConfig.nativeBanner.containerId} className="adsterra-native"></div>
        </div>
      )}

      {authModal}
      {limitModal}
      {adSettings}
    </div>
  );
}
