const COMPRESSED_EXTENSIONS = ['.gz', '.zip', '.bz2', '.7z', '.rar'];

function isCompressedFile(filename) {
    const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
    return COMPRESSED_EXTENSIONS.includes(ext);
}

async function compressFile(file) {
    const compressedStream = file.stream().pipeThrough(
        new CompressionStream('gzip')
    );
    const compressedResponse = new Response(compressedStream);
    return compressedResponse.blob();
}

async function uploadSingleFile(file, alertBox, loadFiles, showAlert) {
    const originalName = file.name;
    const shouldCompress = !isCompressedFile(originalName);

    let body;
    let headers = {};

    if (shouldCompress) {
        const compressed = await compressFile(file);
        headers = {
            'X-Compressed': 'gzip',
            'X-Filename': originalName
        };
        body = compressed;
    } else {
        const formData = new FormData();
        formData.append('file', file);
        body = formData;
    }

    const response = await fetch('/upload', {
        method: 'POST',
        headers,
        body: body
    });

    return response;
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

        fileList.innerHTML = filesToUpload.map((file, index) => `
            <li>
                <div class="file-info">
                    <div class="file-icon">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                            <polyline points="14 2 14 8 20 8"></polyline>
                        </svg>
                    </div>
                    <span>${file.name}</span>
                </div>
                <span class="remove" data-index="${index}">&times;</span>
            </li>
        `).join('');

        document.querySelectorAll('.remove').forEach(btn => {
            btn.addEventListener('click', e => {
                const index = parseInt(e.target.dataset.index);
                filesToUpload.splice(index, 1);
                renderSelectedFiles();
            });
        });
    }

    function formatSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    uploadBtn.addEventListener('click', async () => {
        if (filesToUpload.length === 0) return;

        uploadBtn.disabled = true;
        uploadBtn.classList.add('loading');
        uploadBtn.querySelector('.spinner').classList.add('active');
        uploadBtn.querySelector('span').textContent = 'Uploading...';

        const errors = [];
        const uploaded = [];

        for (const file of filesToUpload) {
            try {
                const response = await uploadSingleFile(file, alertBox, loadFiles, showAlert);
                const data = await response.json();

                if (response.ok) {
                    uploaded.push(data.message);
                } else {
                    errors.push(data.error || `Failed to upload ${file.name}`);
                }
            } catch (error) {
                errors.push(`Error uploading ${file.name}: ${error.message}`);
            }
        }

        if (errors.length > 0) {
            showAlert('error', errors.join('; '));
        } else if (uploaded.length > 0) {
            showAlert('success', uploaded.join('; '));
            filesToUpload = [];
            renderSelectedFiles();
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
            const response = await fetch('/files');
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
                    <span class="file-name">${file.name}</span>
                    <span class="file-size">${formatSize(file.size)}</span>
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