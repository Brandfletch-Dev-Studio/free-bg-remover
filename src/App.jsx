import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from './lib/supabase.js';
import { removeBackground } from '@imgly/background-removal';

export default function App() {
  const [user, setUser] = useState(null);
  const [authMode, setAuthMode] = useState('signin');
  const [authForm, setAuthForm] = useState({ email: '', password: '' });
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');

  const [file, setFile] = useState(null);
  const [originalUrl, setOriginalUrl] = useState(null);
  const [resultUrl, setResultUrl] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [progressText, setProgressText] = useState('');
  const [progressPct, setProgressPct] = useState(0);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [modelLoaded, setModelLoaded] = useState(false);
  const dropRef = useRef(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

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

  async function handleSignOut() {
    await supabase.auth.signOut();
    setFile(null);
    setOriginalUrl(null);
    setResultUrl(null);
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
      if (!modelLoaded) {
        setProgressText('Downloading AI model (one-time, ~24MB)...');
        setProgressPct(15);
      } else {
        setProgressText('Processing image...');
        setProgressPct(50);
      }

      // @imgly/background-removal processes client-side using WASM
      // The model is downloaded from CDN and cached by the browser
      const result = await removeBackground(imgFile, {
        model: 'isnet_fp16',
        output: { format: 'image/png' },
        progress: (key, current, total) => {
          const pct = Math.round((current / total) * 100);
          if (key.includes('fetch')) {
            setProgressText(`Downloading AI model... ${pct}%`);
            setProgressPct(Math.min(pct * 0.4, 40));
          } else if (key.includes('inference')) {
            setProgressText(`Removing background... ${pct}%`);
            setProgressPct(40 + Math.round(pct * 0.6));
          }
        },
      });

      setModelLoaded(true);
      const url = URL.createObjectURL(result);
      setResultUrl(url);
      const elapsed = Date.now() - startTime;
      setProgressText(`Done in ${(elapsed / 1000).toFixed(1)}s`);
      setProgressPct(100);

      // Track usage
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
  }, [modelLoaded, user]);

  function reset() {
    setFile(null);
    setOriginalUrl(null);
    setResultUrl(null);
    setError('');
    setProgressText('');
    setProgressPct(0);
  }

  function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    handleFile(e.dataTransfer.files[0]);
  }

  // --- Auth screen ---
  if (!user) {
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <h1>QuickCut</h1>
          <p className="auth-sub">Free background remover — powered by AI</p>
          <div className="auth-tabs">
            <button className={authMode === 'signin' ? 'active' : ''} onClick={() => setAuthMode('signin')}>Sign In</button>
            <button className={authMode === 'signup' ? 'active' : ''} onClick={() => setAuthMode('signup')}>Sign Up</button>
          </div>
          <form onSubmit={handleAuth} className="auth-form">
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
              {authLoading ? 'Please wait…' : authMode === 'signup' ? 'Create Account' : 'Sign In'}
            </button>
          </form>
          <p className="auth-foot">No credit card needed. Free forever.</p>
        </div>
      </div>
    );
  }

  // --- Main app ---
  return (
    <div className="app">
      <header className="topbar">
        <div className="logo">QuickCut</div>
        <div className="topbar-right">
          <span className="user-email">{user.email}</span>
          <button className="btn btn-outline btn-sm" onClick={handleSignOut}>Sign Out</button>
        </div>
      </header>

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
            {!modelLoaded && (
              <p className="progress-hint">First run downloads the AI model (~24MB, cached for next time)</p>
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
            <div className="actions">
              <a className="btn btn-primary" href={resultUrl} download="background-removed.png">Download PNG</a>
              <button className="btn btn-outline" onClick={reset}>Remove Another</button>
            </div>
          </div>
        )}
      </main>

      {/* Ad slot — bottom */}
      <div className="ad-slot" id="ad-bottom">{/* Ad slot */}</div>
    </div>
  );
}
