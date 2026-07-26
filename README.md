# Free Background Remover

100% free. No signup. No paywall. No subscriptions.

Removes image backgrounds entirely in your browser using [@imgly/background-removal](https://github.com/imgly/background-removal-js) — an AI model that runs client-side via WebAssembly. Your images never leave your device.

## Features
- ✅ Completely free, forever
- ✅ No account required
- ✅ Runs in the browser (no server processing)
- ✅ Download as PNG with transparent background
- ✅ Drag and drop support

## Tech
- Vite
- [@imgly/background-removal](https://www.npmjs.com/package/@imgly/background-removal) (WASM-based AI, no API key needed)

## Run locally
```bash
npm install
npm run dev
```

## Deploy to Vercel
Works on Vercel, Netlify, or any static host. The `vite.config.js` sets the required `Cross-Origin-Opener-Policy` headers for SharedArrayBuffer support.
