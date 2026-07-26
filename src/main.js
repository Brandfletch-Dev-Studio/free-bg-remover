import { removeBackground } from '@imgly/background-removal';

const app = document.getElementById('app');

app.innerHTML = `
  <div class="hero">
    <h1>Free Background Remover</h1>
    <p>100% free. No signup. No paywall. Runs in your browser.</p>
    <div class="drop-zone" id="dropZone">
      <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
      <p>Drop image here or <label for="fileInput" class="browse">browse</label></p>
      <input type="file" id="fileInput" accept="image/*" hidden />
    </div>
    <div class="result" id="result" style="display:none">
      <div class="preview-grid">
        <div class="preview-card">
          <p class="label">Original</p>
          <img id="originalImg" />
        </div>
        <div class="preview-card">
          <p class="label">Background Removed</p>
          <div class="checker">
            <img id="resultImg" />
          </div>
        </div>
      </div>
      <div class="actions">
        <a id="downloadBtn" class="btn" download="background-removed.png">Download PNG (Free)</a>
        <button id="resetBtn" class="btn btn-outline">Remove Another</button>
      </div>
    </div>
    <div class="progress" id="progress" style="display:none">
      <div class="spinner"></div>
      <p id="progressText">Removing background...</p>
    </div>
  </div>
`;

const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const result = document.getElementById('result');
const progress = document.getElementById('progress');
const originalImg = document.getElementById('originalImg');
const resultImg = document.getElementById('resultImg');
const downloadBtn = document.getElementById('downloadBtn');
const resetBtn = document.getElementById('resetBtn');
const progressText = document.getElementById('progressText');

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => { e.preventDefault(); dropZone.classList.remove('drag-over'); handleFile(e.dataTransfer.files[0]); });
fileInput.addEventListener('change', e => handleFile(e.target.files[0]));
resetBtn.addEventListener('click', () => { result.style.display = 'none'; dropZone.style.display = 'flex'; fileInput.value = ''; });

async function handleFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  dropZone.style.display = 'none';
  progress.style.display = 'flex';
  result.style.display = 'none';

  // Show original
  const originalUrl = URL.createObjectURL(file);
  originalImg.src = originalUrl;

  try {
    progressText.textContent = 'Loading AI model (first time may take ~10s)...';
    const blob = await removeBackground(file, {
      progress: (key, current, total) => {
        if (total > 0) {
          const pct = Math.round((current / total) * 100);
          progressText.textContent = `Processing... ${pct}%`;
        }
      }
    });
    const url = URL.createObjectURL(blob);
    resultImg.src = url;
    downloadBtn.href = url;
    progress.style.display = 'none';
    result.style.display = 'block';
  } catch (err) {
    console.error(err);
    progressText.textContent = 'Something went wrong. Try a different image.';
    progress.style.display = 'flex';
  }
}