const API_BASE = '';

function formatSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function uploadFileWithProgress(file, onProgress) {
    return new Promise((resolve, reject) => {
        const formData = new FormData();
        formData.append('file', file);

        const xhr = new XMLHttpRequest();

        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
                const progress = Math.round((e.loaded / e.total) * 100);
                onProgress(progress);
            }
        };

        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                try {
                    const data = JSON.parse(xhr.responseText);
                    resolve(data);
                } catch {
                    resolve({ message: 'Uploaded successfully' });
                }
            } else {
                try {
                    const data = JSON.parse(xhr.responseText);
                    reject(new Error(data.error || 'Upload failed'));
                } catch {
                    reject(new Error('Upload failed'));
                }
            }
        };

        xhr.onerror = () => reject(new Error('Network error'));
        xhr.upload.onabort = () => reject(new Error('Upload cancelled'));

        xhr.open('POST', `${API_BASE}/upload`);
        xhr.send(formData);
    });
}

async function uploadSingleFile(file, updateProgress, onComplete, onError) {
    try {
        const data = await uploadFileWithProgress(file, (progress) => {
            updateProgress('uploading', progress);
        });

        updateProgress('done', 100);
        onComplete(data);
    } catch (error) {
        updateProgress('error', 0, error.message);
        onError(error);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    const selectedFiles = document.getElementById('selectedFiles');
    const fileList = document.getElementById('fileList');
    const uploadBtn = document.getElementById('uploadBtn');
    const alertBox = document.getElementById('alert');
    const filesList = document.getElementById('filesList');

    let filesToUpload = [];

    dropZone.addEventListener('click', () => fileInput.click());

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(event => {
        dropZone.addEventListener(event, e => {
            e.preventDefault();
            e.stopPropagation();
        });
    });

    dropZone.addEventListener('dragover', () => {
        dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', e => {
        dropZone.classList.remove('dragover');
        handleFiles(e.dataTransfer.files);
    });

    fileInput.addEventListener('change', e => {
        handleFiles(e.target.files);
        fileInput.value = '';
    });

    function handleFiles(files) {
        const newFiles = Array.from(files).filter(f => f.size > 0);
        newFiles.forEach(f => { f.status = 'pending'; });
        filesToUpload = [...filesToUpload, ...newFiles];
        renderSelectedFiles();
    }

    function renderSelectedFiles() {
        if (filesToUpload.length === 0) {
            selectedFiles.classList.remove('active');
            uploadBtn.disabled = true;
            return;
        }

        selectedFiles.classList.add('active');
        uploadBtn.disabled = false;

        fileList.innerHTML = filesToUpload.map((file, index) => {
            const f = filesToUpload[index];
            const status = f.status || 'pending';
            const progress = f.progress || 0;
            const error = f.error || '';
            const safeName = escapeHtml(file.name);
            const safeError = escapeHtml(error);

            if (status === 'pending') {
                return `
                    <li data-index="${index}">
                        <div class="file-info">
                            <div class="file-icon">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                                    <polyline points="14 2 14 8 20 8"></polyline>
                                </svg>
                            </div>
                            <span>${safeName}</span>
                        </div>
                        <span class="remove" data-index="${index}">&times;</span>
                    </li>
                `;
            } else if (status === 'done') {
                return `
                    <li class="file-done" data-index="${index}">
                        <div class="file-info">
                            <div class="file-icon">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                                    <polyline points="14 2 14 8 20 8"></polyline>
                                </svg>
                            </div>
                            <span>${safeName}</span>
                        </div>
                        <span class="status-done">✓ Done</span>
                    </li>
                `;
            } else if (status === 'error') {
                return `
                    <li class="file-error" data-index="${index}">
                        <div class="file-info">
                            <div class="file-icon">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                                    <polyline points="14 2 14 8 20 8"></polyline>
                                </svg>
                            </div>
                            <div class="file-details">
                                <span>${safeName}</span>
                                <span class="error-msg">${safeError}</span>
                            </div>
                        </div>
                        <span class="retry" data-index="${index}">↻ Retry</span>
                    </li>
                `;
            } else {
                return `
                    <li class="file-uploading" data-index="${index}">
                        <div class="file-info">
                            <div class="file-icon">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                                    <polyline points="14 2 14 8 20 8"></polyline>
                                </svg>
                            </div>
                            <span>${safeName}</span>
                        </div>
                        <div class="progress-container">
                            <div class="progress-bar">
                                <div class="progress-fill" style="width: ${progress}%"></div>
                            </div>
                            <span class="progress-text">${progress}% - Uploading...</span>
                        </div>
                    </li>
                `;
            }
        }).join('');

        document.querySelectorAll('.remove').forEach(btn => {
            btn.addEventListener('click', e => {
                const index = parseInt(e.target.dataset.index);
                filesToUpload.splice(index, 1);
                renderSelectedFiles();
            });
        });

        document.querySelectorAll('.retry').forEach(btn => {
            btn.addEventListener('click', e => {
                const index = parseInt(e.target.dataset.index);
                filesToUpload[index].status = 'pending';
                filesToUpload[index].progress = 0;
                filesToUpload[index].error = '';
                renderSelectedFiles();
            });
        });
    }

    function updateProgressInDOM(index, progress) {
        const li = document.querySelector(`#fileList li[data-index="${index}"]`);
        if (!li) return;
        const fill = li.querySelector('.progress-fill');
        const text = li.querySelector('.progress-text');
        if (fill) fill.style.width = `${progress}%`;
        if (text) text.textContent = `${progress}% - Uploading...`;
    }

    uploadBtn.addEventListener('click', async () => {
        const pendingFiles = filesToUpload.filter(f => f.status === 'pending');
        if (pendingFiles.length === 0) return;

        uploadBtn.disabled = true;
        uploadBtn.classList.add('loading');
        uploadBtn.querySelector('.spinner').classList.add('active');
        uploadBtn.querySelector('span').textContent = 'Uploading...';

        const errors = [];
        const uploaded = [];

        for (const file of pendingFiles) {
            const index = filesToUpload.indexOf(file);

            await new Promise((resolve) => {
                uploadSingleFile(
                    file,
                    (status, progress, error) => {
                        const prevStatus = filesToUpload[index].status;
                        filesToUpload[index].status = status;
                        filesToUpload[index].progress = progress;
                        if (error) filesToUpload[index].error = error;
                        if (status === 'uploading' && prevStatus === 'uploading') {
                            updateProgressInDOM(index, progress);
                        } else {
                            renderSelectedFiles();
                        }
                    },
                    (data) => {
                        uploaded.push(data.message || file.name);
                        resolve();
                    },
                    (error) => {
                        errors.push(`${file.name}: ${error.message}`);
                        resolve();
                    }
                );
            });
        }

        filesToUpload = filesToUpload.filter(f => f.status !== 'done');
        renderSelectedFiles();

        if (errors.length > 0) {
            showAlert('error', errors.join('; '));
        }
        if (uploaded.length > 0) {
            showAlert('success', `Files uploaded: ${uploaded.join(', ')}`);
            await loadFiles();
        }

        uploadBtn.disabled = false;
        uploadBtn.classList.remove('loading');
        uploadBtn.querySelector('.spinner').classList.remove('active');
        uploadBtn.querySelector('span').textContent = 'Upload Files';
    });

    function showAlert(type, message) {
        alertBox.className = `alert ${type} active`;
        alertBox.textContent = message;
        setTimeout(() => alertBox.classList.remove('active'), 4000);
    }

    async function loadFiles() {
        try {
            const response = await fetch(`${API_BASE}/files`);
            const files = await response.json();

            if (files.length === 0) {
                filesList.innerHTML = `
                    <div class="empty-state">
                        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                        </svg>
                        <p>No files uploaded yet</p>
                    </div>
                `;
                return;
            }

            filesList.innerHTML = files.map(file => `
                <li>
                    <div class="file-info">
                        <span class="file-name">${escapeHtml(file.name)}</span>
                        <span class="file-size">${formatSize(file.size)}</span>
                    </div>
                    <a href="${API_BASE}/uploads/${encodeURIComponent(file.name)}" class="download-btn" download>
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                            <polyline points="7 10 12 15 17 10"></polyline>
                            <line x1="12" y1="15" x2="12" y2="3"></line>
                        </svg>
                        Download
                    </a>
                </li>
            `).join('');
        } catch (error) {
            console.error('Failed to load files:', error);
            filesList.innerHTML = `
                <div class="empty-state">
                    <p>Failed to load files</p>
                </div>
            `;
        }
    }

    loadFiles();
});