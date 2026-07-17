const API_BASE = '';
let ws = null;
let sessionToken = null;
let selectedFiles = [];
let currentPath = '';

function formatSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i];
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showAlert(type, message) {
    const alert = document.getElementById('alert');
    alert.className = `alert ${type} show`;
    alert.textContent = message;
    setTimeout(() => { alert.className = 'alert'; }, 4000);
}

function showView(viewId) {
    document.getElementById('waiting').style.display = 'none';
    document.getElementById('denied').style.display = 'none';
    document.getElementById('menu').style.display = 'none';
    document.getElementById('uploadView').style.display = 'none';
    document.getElementById('filesView').style.display = 'none';
    document.getElementById(viewId).style.display = 'block';
}

async function checkStatus() {
    try {
        const res = await fetch(`${API_BASE}/api/status`);
        const data = await res.json();
        if (data.status === 'approved') {
            sessionToken = data.session_id;
            showView('menu');
        } else if (data.status === 'denied') {
            document.getElementById('denied').style.display = 'block';
        } else {
            document.getElementById('waiting').style.display = 'block';
        }
    } catch {
        document.getElementById('waiting').style.display = 'block';
    }
}

function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}/ws/client`);
    ws.onopen = () => console.log('WS connected');
    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.action === 'approved') {
            sessionToken = data.token;
            document.cookie = `session_id=${data.token}; path=/; SameSite=Lax`;
            showView('menu');
        } else if (data.action === 'rejected') {
            document.getElementById('denied').style.display = 'block';
        }
    };
    ws.onclose = () => setTimeout(connectWebSocket, 3000);
    ws.onerror = () => {};
}

function initUI() {
    document.getElementById('uploadBtn').addEventListener('click', () => showView('uploadView'));
    document.getElementById('browseBtn').addEventListener('click', async () => {
        currentPath = '';
        showView('filesView');
        await loadFiles();
    });
    document.getElementById('backFromUpload').addEventListener('click', () => showView('menu'));
    document.getElementById('backFromFiles').addEventListener('click', () => showView('menu'));

    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        handleFiles(e.dataTransfer.files);
    });
    fileInput.addEventListener('change', (e) => {
        handleFiles(e.target.files);
        fileInput.value = '';
    });

    document.getElementById('uploadBtn2').addEventListener('click', uploadFiles);
}

function handleFiles(files) {
    selectedFiles = Array.from(files).filter(f => f.size > 0);
    renderSelectedFiles();
}

function renderSelectedFiles() {
    const list = document.getElementById('selectedFiles');
    const btn = document.getElementById('uploadBtn2');
    if (selectedFiles.length === 0) {
        list.innerHTML = '';
        btn.disabled = true;
        return;
    }
    btn.disabled = false;
    list.innerHTML = selectedFiles.map((f, i) => `
        <li data-index="${i}">
            <div class="file-item-row">
                <div class="info">
                    <div class="file-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                            <polyline points="14 2 14 8 20 8"/>
                        </svg>
                    </div>
                    <div>
                        <div class="name">${escapeHtml(f.name)}</div>
                        <div class="size">${formatSize(f.size)}</div>
                    </div>
                </div>
                <button class="remove" data-index="${i}">&times;</button>
            </div>
            <div class="progress-container" style="display:none">
                <progress class="progress-bar" value="0" max="100"></progress>
                <span class="progress-text">0%</span>
            </div>
        </li>
    `).join('');
    list.querySelectorAll('.remove').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const idx = parseInt(e.target.dataset.index);
            selectedFiles.splice(idx, 1);
            renderSelectedFiles();
        });
    });
}

function uploadFileWithProgress(file, index) {
    return new Promise((resolve) => {
        const li = document.querySelector(`#selectedFiles li[data-index="${index}"]`);
        if (!li) { resolve(false); return; }

        const progressContainer = li.querySelector('.progress-container');
        const progressBar = li.querySelector('.progress-bar');
        const progressText = li.querySelector('.progress-text');
        const removeBtn = li.querySelector('.remove');

        progressContainer.style.display = 'flex';
        removeBtn.style.display = 'none';
        progressBar.value = 0;
        progressText.textContent = '0%';

        const formData = new FormData();
        formData.append('file', file);

        const xhr = new XMLHttpRequest();

        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
                const pct = Math.round((e.loaded / e.total) * 100);
                progressBar.value = pct;
                progressText.textContent = pct + '%';
            }
        };

        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                progressBar.value = 100;
                progressText.textContent = '✓ Done';
                resolve(true);
            } else {
                progressText.textContent = '✗ Failed';
                resolve(false);
            }
        };

        xhr.onerror = () => {
            progressText.textContent = '✗ Failed';
            resolve(false);
        };

        xhr.open('POST', `${API_BASE}/api/upload`);
        xhr.setRequestHeader('X-Session-Token', sessionToken);
        xhr.send(formData);
    });
}

async function uploadFiles() {
    if (selectedFiles.length === 0) return;
    const btn = document.getElementById('uploadBtn2');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="width:16px;height:16px;border-width:2px;"></span> Uploading...';

    let uploaded = 0, errors = 0;
    const files = [...selectedFiles];
    for (let i = 0; i < files.length; i++) {
        const ok = await uploadFileWithProgress(files[i], i);
        if (ok) uploaded++; else errors++;
    }

    if (errors > 0) showAlert('error', `${errors} file(s) failed to upload`);
    if (uploaded > 0) showAlert('success', `${uploaded} file(s) uploaded successfully`);

    selectedFiles = [];
    renderSelectedFiles();
    btn.disabled = false;
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Upload Files';
}

function renderBreadcrumb() {
    const breadcrumb = document.getElementById('breadcrumb');
    const parts = currentPath ? currentPath.split('/') : [];
    let html = '<span class="breadcrumb-item clickable" data-path="">Shared</span>';
    let path = '';
    for (const part of parts) {
        path += (path ? '/' : '') + part;
        html += '<span class="breadcrumb-sep">/</span>';
        html += `<span class="breadcrumb-item clickable" data-path="${escapeHtml(path)}">${escapeHtml(part)}</span>`;
    }
    breadcrumb.innerHTML = html;
    breadcrumb.querySelectorAll('.clickable').forEach(item => {
        item.addEventListener('click', () => {
            currentPath = item.dataset.path;
            loadFiles();
        });
    });
}

async function loadFiles() {
    const list = document.getElementById('filesList');
    const pathParam = currentPath ? `?path=${encodeURIComponent(currentPath)}` : '';
    try {
        const res = await fetch(`${API_BASE}/api/files${pathParam}`, {
            headers: { 'X-Session-Token': sessionToken }
        });
        const files = await res.json();
        renderBreadcrumb();
        if (!Array.isArray(files) || files.length === 0) {
            list.innerHTML = '<li class="empty-state">No files in this folder</li>';
            return;
        }
        list.innerHTML = files.map(f => {
            if (f.isDirectory) {
                return `<li data-path="${escapeHtml(f.path)}">
                    <div class="file-info">
                        <div class="file-icon folder">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                            </svg>
                        </div>
                        <div class="details">
                            <div class="filename">${escapeHtml(f.name)}</div>
                        </div>
                    </div>
                </li>`;
            }
            return `<li>
                <div class="file-info">
                    <div class="file-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                            <polyline points="14 2 14 8 20 8"/>
                        </svg>
                    </div>
                    <div class="details">
                        <div class="filename">${escapeHtml(f.name)}</div>
                        <div class="filesize">${formatSize(f.size)}</div>
                    </div>
                </div>
                <a href="${API_BASE}/api/files/${encodeURIComponent(f.path)}" 
                   class="download-btn" download>Download</a>
            </li>`;
        }).join('');
        list.querySelectorAll('li[data-path]').forEach(li => {
            li.addEventListener('click', () => {
                currentPath = li.dataset.path;
                loadFiles();
            });
        });
    } catch {
        list.innerHTML = '<li class="empty-state">Failed to load files</li>';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    initUI();
    checkStatus();
    connectWebSocket();
});