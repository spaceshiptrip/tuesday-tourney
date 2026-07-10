// Paste your deployed Apps Script web app URL here after setup
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxm-K55RR7MVzgErkm6xMhK-b0jUr0WHRqZy_G7NbbkBqkYzydNSa76zz3fwPEfDCfQ/exec';

const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const previewSection = document.getElementById('preview-section');
const previewImg = document.getElementById('preview-img');
const uploadBtn = document.getElementById('upload-btn');
const clearBtn = document.getElementById('clear-btn');
const statusEl = document.getElementById('status');
const statusIcon = document.getElementById('status-icon');
const statusMessage = document.getElementById('status-message');
const resultsEl = document.getElementById('results');
const resultsTeam = document.getElementById('results-team');
const resultsDate = document.getElementById('results-date');
const resultsBody = document.getElementById('results-body');
const uploadAnotherBtn = document.getElementById('upload-another-btn');

let selectedFile = null;

// Drag and drop
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) setFile(file);
});

fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) setFile(fileInput.files[0]);
});

clearBtn.addEventListener('click', reset);
uploadAnotherBtn.addEventListener('click', reset);

uploadBtn.addEventListener('click', async () => {
  if (!selectedFile) return;

  if (APPS_SCRIPT_URL === 'YOUR_APPS_SCRIPT_URL_HERE') {
    showStatus('error', '⚙️ Apps Script URL not configured yet — see setup instructions in PLAN.md.');
    return;
  }

  uploadBtn.disabled = true;
  showStatus('loading', 'Reading scores from image...');

  try {
    const base64 = await fileToBase64(selectedFile);
    const imageData = base64.split(',')[1]; // strip data URL prefix

    const response = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      // text/plain avoids CORS preflight while Apps Script can still read the body
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ image: imageData, mimeType: selectedFile.type || 'image/jpeg' }),
    });

    const data = await response.json();

    if (data.error) {
      showStatus('error', data.error);
    } else {
      showResults(data);
    }
  } catch (err) {
    showStatus('error', 'Upload failed — ' + err.message);
  } finally {
    uploadBtn.disabled = false;
  }
});

function setFile(file) {
  selectedFile = file;
  const reader = new FileReader();
  reader.onload = (e) => {
    previewImg.src = e.target.result;
    previewSection.hidden = false;
    dropZone.hidden = true;
    hideStatus();
    resultsEl.hidden = true;
  };
  reader.readAsDataURL(file);
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function reset() {
  selectedFile = null;
  fileInput.value = '';
  previewImg.src = '';
  previewSection.hidden = true;
  dropZone.hidden = false;
  hideStatus();
  resultsEl.hidden = true;
}

function showStatus(type, message) {
  statusEl.hidden = false;
  statusEl.className = type;
  statusIcon.textContent = type === 'loading' ? '⏳' : '✗';
  statusMessage.textContent = message;
}

function hideStatus() {
  statusEl.hidden = true;
  statusEl.className = '';
}

function showResults(data) {
  hideStatus();
  resultsTeam.textContent = data.team || 'Team';
  resultsDate.textContent = 'Recorded ' + data.date;
  resultsBody.innerHTML = '';

  (data.rows || []).forEach((row) => {
    const tr = document.createElement('tr');
    if (row.type !== 'player') tr.classList.add('summary-row');
    tr.innerHTML = `
      <td>${row.player}</td>
      <td>${row.game1}</td>
      <td>${row.game2}</td>
      <td>${row.game3}</td>
      <td>${row.series}</td>
    `;
    resultsBody.appendChild(tr);
  });

  previewSection.hidden = true;
  resultsEl.hidden = false;
}
