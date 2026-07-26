import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from './lib/supabase.js';
import { removeBackground, preload } from '@imgly/background-removal';

export default function App() {
  const [user, setUser] = useState(null);
  const [authMode, setAuthMode] = useState('signin');
  const [authForm, setAuthForm] = useState({ email: '', password: '' });
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const [showAuthModal, setShowAuthModal] = useState(false);

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

  // Model preload state
  const [modelStatus, setModelStatus] = useState('idle');
  const [modelProgress, setModelProgress] = useState(0);

  // Profile dropdown
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  // Download dropdown
  const [dlOpen, setDlOpen] = useState(false);
  const dlRef = useRef(null);

  // APK install prompt
  const [showApkPrompt, setShowApkPrompt] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
      if (dlRef.current && !dlRef.current.contains(e.target)) setDlOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Preload the AI model immediately on page load (even for guests)
  useEffect(() => {
    if (modelStatus !== 'idle') return;
    setModelStatus('loading');
    setProgressText('Preparing AI model...');
    preload({
      model: 'isnet_fp16',
      progress: (key, current, total) => {
        const pct = Math.round((current / total) * 100);
        setModelProgress(pct);
        if (pct < 100) setProgressText(`Loading AI model... ${pct}%`);
      },
    })
      .then(() => {
        setModelStatus('ready');
        setModelProgress(100);
        setProgressText('');
      })
      .catch(() => {
        setModelStatus('idle');
        setProgressText('');
      });
  }, [modelStatus]);

  // APK install prompt — show 30s after opening site (if not dismissed before)
  useEffect(() => {
    const dismissed = sessionStorage.getItem('apk-dismissed');
    if (dismissed) return;
    const timer = setTimeout(() => setShowApkPrompt(true), 30000);
    return () => clearTimeout(timer);
  }, []);

  // PWA install prompt capture
  useEffect(() => {
    const handler = (e) => {
      e.preventDefault();
      sessionStorage.setItem('installable', 'true');
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
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

  function handleAuthSuccess() {
    setShowAuthModal(false);
    setAuthError('');
    setAuthForm({ email: '', password: '' });
  }

  // When user state changes, close modal if they're now logged in
  useEffect(() => {
    if (user && showAuthModal) handleAuthSuccess();
  }, [user, showAuthModal]);

  async function handleSignOut() {
    await supabase.auth.signOut();
    setFile(null);
    setOriginalUrl(null);
    setResultUrl(null);
    setResultBlob(null);
    setMenuOpen(false);
  }

  async function handleFile(selectedFile) {
    if (!selectedFile || !selectedFile.type.startsWith('image/')) {
      setError('Please select an image file.');
      return;
    }
    setError('');
    setResultUrl(null);
    setFile(selectedFile);
    setOriginalUrl(URL.createObjectURL(selectedFile));
    await processImage(selectedFile);
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
        model: 'isnet_fp16',
        output: { format: 'image/png' },
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
      const elapsed = Date.now() - startTime;
      setProgressText(`Done in ${(elapsed / 1000).toFixed(1)}s`);
      setProgressPct(100);

      // Track usage (fire-and-forget)
      supabase.from('bg_remover_jobs').insert({
        user_email: user?.email || 'anonymous',
        file_size_bytes: imgFile.size,
        processing_time_ms: elapsed,
        status: 'completed',
      }).then(() => {});
    } catch (err) {
      setError(err.message || 'Failed to process image. Try a smaller image.');
    } finally {
      setProcessing(false);
    }
  }, [modelStatus, user]);

  function reset() {
    setFile(null);
    setOriginalUrl(null);
    setResultUrl(null);
    setResultBlob(null);
    setError('');
    setProgressText('');
    setProgressPct(0);
    setDlOpen(false);
  }

  function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    handleFile(e.dataTransfer.files[0]);
  }

  // Gate download behind auth
  function gateDownload(action) {
    if (!user) {
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

  async function downloadWithBg(bgColor = '#ffffff', format = 'jpeg') {
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
    const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
    const ext = format === 'jpeg' ? 'jpg' : 'png';
    canvas.toBlob((blob) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `background-removed-${ext === 'jpg' ? 'white' : 'transparent'}.${ext}`;
      a.click();
    }, mime, 0.95);
    setDlOpen(false);
  }

  const initials = user?.email ? user.email.charAt(0).toUpperCase() : '?';

  // --- Auth Modal (shown when guest tries to download) ---
  const authModal = showAuthModal && !user ? (
    <div className="modal-overlay" onClick={(e) => { if (e.target.classList.contains('modal-overlay')) setShowAuthModal(false); }}>
      <div className="modal-card">
        <button className="modal-close" onClick={() => setShowAuthModal(false)}>✕</button>
        <h2 className="modal-title">Create a free account to download</h2>
        <p className="modal-sub">Your result is ready! Sign up to download — it's free forever.</p>
        <div className="auth-tabs">
          <button className={authMode === 'signin' ? 'active' : ''} onClick={() => setAuthMode('signin')}>Sign In</button>
          <button className={authMode === 'signup' ? 'active' : ''} onClick={() => setAuthMode('signup')}>Sign Up</button>
        </div>
        <form onSubmit={async (e) => {
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
        }} className="auth-form">
          <input
            type="email"
            placeholder="Email"
            required
            value={authForm.email}
            onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })}
          />
          <input
            type="password"
            placeholder="Password (min 6 chars)"
            required
            minLength="6"
            value={authForm.password}
            onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })}
          />
          {authError && <p className="auth-error">{authError}</p>}
          <button type="submit" className="btn btn-primary" disabled={authLoading}>
            {authLoading ? 'Please wait…' : authMode === 'signup' ? 'Create Free Account' : 'Sign In'}
          </button>
        </form>
        <p className="auth-foot">No credit card needed.</p>
      </div>
    </div>
  ) : null;

  // --- APK Install Prompt ---
  const apkPrompt = showApkPrompt ? (
    <div className="apk-banner">
      <div className="apk-content">
        <div className="apk-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
            <line x1="12" y1="18" x2="12" y2="18" />
          </svg>
        </div>
        <div className="apk-text">
          <p className="apk-title">Install QuickCut</p>
          <p className="apk-desc">Add to your home screen for instant access</p>
        </div>
        <div className="apk-actions">
          <button className="btn btn-primary btn-sm" onClick={async () => {
            dismissApkPrompt();
            // Trigger PWA install if available
            const event = new Event('beforeinstallprompt');
            window.dispatchEvent(event);
            // Fallback: show instructions
            alert(
              'To install QuickCut:\n\n' +
              '• Android: Chrome menu → "Install app" or "Add to Home screen"\n' +
              '• iPhone: Safari Share → "Add to Home Screen"\n\n' +
              'The app works offline after first load!'
            );
          }}>Install</button>
          <button className="apk-dismiss" onClick={dismissApkPrompt}>Later</button>
        </div>
      </div>
    </div>
  ) : null;

  // --- Main app (guests can use it too) ---
  return (
    <div className="app">
      <header className="topbar">
        <div className="logo">QuickCut</div>

        <div className="topbar-right">
          {modelStatus === 'loading' && (
            <span className="badge badge-loading">
              <span className="dot-pulse" /> AI loading {modelProgress}%
            </span>
          )}
          {modelStatus === 'ready' && (
            <span className="badge badge-ready">✓ AI ready</span>
          )}

          {user ? (
            <div className="profile-menu" ref={menuRef}>
              <button className="avatar-btn" onClick={() => setMenuOpen(!menuOpen)}>
                <span className="avatar">{initials}</span>
              </button>
              {menuOpen && (
                <div className="dropdown">
                  <div className="dropdown-header">
                    <span className="avatar avatar-lg">{initials}</span>
                    <div>
                      <p className="dropdown-email">{user.email}</p>
                      <p className="dropdown-sub">Free plan</p>
                    </div>
                  </div>
                  <hr className="dropdown-sep" />
                  <button className="dropdown-item" onClick={handleSignOut}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                      <polyline points="16 17 21 12 16 7" />
                      <line x1="21" y1="12" x2="9" y2="12" />
                    </svg>
                    Sign Out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button className="btn btn-outline btn-sm" onClick={() => setShowAuthModal(true)}>
              Sign In
            </button>
          )}
        </div>
      </header>

      {/* APK install prompt */}
      {apkPrompt}

      {/* Ad slot — top */}
      <div className="ad-slot" id="ad-top">{/* Ad slot */}</div>

      <main className="hero">
        <h1>Remove Image Backgrounds</h1>
        <p className="hero-sub">100% free. AI-powered. Runs in your browser.</p>

        {!file && !processing && (
          <div
            className="drop-zone"
            ref={dropRef}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => document.getElementById('fileInput').click()}
            style={{ borderColor: dragOver ? 'var(--primary)' : 'var(--border)' }}
          >
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <p>Drop image here or <span className="browse">browse</span></p>
            {modelStatus === 'ready' && <span className="ready-hint">AI model ready — instant processing</span>}
            {modelStatus === 'loading' && <span className="loading-hint">Preparing AI model in background...</span>}
            <input type="file" id="fileInput" accept="image/*" hidden onChange={(e) => handleFile(e.target.files[0])} />
          </div>
        )}

        {processing && (
          <div className="progress">
            <div className="spinner" />
            <p>{progressText}</p>
            {progressPct > 0 && (
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${progressPct}%` }} />
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="error-box">
            <p>{error}</p>
            <button className="btn btn-outline btn-sm" onClick={reset}>Try Again</button>
          </div>
        )}

        {resultUrl && originalUrl && !processing && (
          <div className="result">
            <div className="preview-grid">
              <div className="preview-card">
                <p className="label">Original</p>
                <img src={originalUrl} alt="Original" />
              </div>
              <div className="preview-card">
                <p className="label">Background Removed</p>
                <div className="checker">
                  <img src={resultUrl} alt="Result" />
                </div>
              </div>
            </div>
            <p className="timing">{progressText}</p>

            {!user && (
              <div className="signup-hint">
                <span>Sign up to download your result — it's free!</span>
              </div>
            )}

            <div className="actions">
              <div className="dl-menu" ref={dlRef}>
                <button className="btn btn-primary" onClick={() => setDlOpen(!dlOpen)}>
                  Download <span className="chevron">▾</span>
                </button>
                {dlOpen && (
                  <div className="dl-dropdown">
                    <button className="dl-item" onClick={() => gateDownload(downloadTransparent)}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" stroke-dasharray="4 4"/><path d="M3 3l18 18"/></svg>
                      <div>
                        <span className="dl-label">Transparent PNG</span>
                        <span className="dl-sub">No background</span>
                      </div>
                    </button>
                    <button className="dl-item" onClick={() => gateDownload(() => downloadWithBg('#ffffff', 'jpeg'))}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" fill="#fff" stroke="currentColor"/></svg>
                      <div>
                        <span className="dl-label">White background</span>
                        <span className="dl-sub">JPG format</span>
                      </div>
                    </button>
                    <button className="dl-item" onClick={() => gateDownload(() => downloadWithBg('#000000', 'jpeg'))}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" fill="#000"/></svg>
                      <div>
                        <span className="dl-label">Black background</span>
                        <span className="dl-sub">JPG format</span>
                      </div>
                    </button>
                    <button className="dl-item" onClick={() => gateDownload(() => downloadWithBg('#6c63ff', 'jpeg'))}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" fill="#6c63ff"/></svg>
                      <div>
                        <span className="dl-label">Purple background</span>
                        <span className="dl-sub">JPG format</span>
                      </div>
                    </button>
                  </div>
                )}
              </div>

              <button className="btn btn-outline" onClick={reset}>Remove Another</button>
            </div>
          </div>
        )}
      </main>

      {/* Ad slot — bottom */}
      <div className="ad-slot" id="ad-bottom">{/* Ad slot */}</div>

      {/* Auth modal */}
      {authModal}
    </div>
  );
}
