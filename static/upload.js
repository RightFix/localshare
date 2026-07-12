document.addEventListener('DOMContentLoaded', () => {
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    const selectedFiles = document.getElementById('selectedFiles');
    const fileList = document.getElementById('fileList');
    const uploadBtn = document.getElementById('uploadBtn');
    const alert = document.getElementById('alert');
    const filesList = document.getElementById('filesList');
    const refreshBtn = document.getElementById('refreshBtn');

    let filesToUpload = [];

    dropZone.addEventListener('click', () => fileInput.click());

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        handleFiles(e.dataTransfer.files);
    });

    fileInput.addEventListener('change', (e) => {
        handleFiles(e.target.files);
    });

    function handleFiles(files) {
        filesToUpload = Array.from(files);
        renderSelectedFiles();
    }

    function renderSelectedFiles() {
        if (filesToUpload.length === 0) {
            selectedFiles.classList.remove('active');
            return;
        }

        selectedFiles.classList.add('active');
        fileList.innerHTML = filesToUpload.map((file, index) => `
            <li>
                <span>${file.name} (${formatSize(file.size)})</span>
                <span class="remove" data-index="${index}">&times;</span>
            </li>
        `).join('');

        document.querySelectorAll('.remove').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const index = parseInt(e.target.dataset.index);
                filesToUpload.splice(index, 1);
                renderSelectedFiles();
            });
        });
    }

    function formatSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    uploadBtn.addEventListener('click', async () => {
        if (filesToUpload.length === 0) return;

        const formData = new FormData();
        filesToUpload.forEach(file => formData.append('file', file));

        uploadBtn.disabled = true;
        uploadBtn.querySelector('.spinner').classList.add('active');
        uploadBtn.textContent = 'Uploading... ';

        try {
            const response = await fetch('/upload', {
                method: 'POST',
                body: formData
            });

            const data = await response.json();

            if (response.ok) {
                showAlert('success', data.message);
                filesToUpload = [];
                renderSelectedFiles();
                await loadFiles();
            } else {
                showAlert('error', data.error || 'Upload failed');
            }
        } catch (error) {
            showAlert('error', 'An error occurred during upload');
        } finally {
            uploadBtn.disabled = false;
            uploadBtn.querySelector('.spinner').classList.remove('active');
            uploadBtn.textContent = 'Upload Files';
        }
    });

    function showAlert(type, message) {
        alert.className = `alert ${type} active`;
        alert.textContent = message;
        setTimeout(() => alert.classList.remove('active'), 5000);
    }

    async function loadFiles() {
        try {
            const response = await fetch('/files');
            const files = await response.json();

            if (files.length === 0) {
                filesList.innerHTML = '<div class="empty-state">No files uploaded yet</div>';
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
        }
    }

    if (refreshBtn) {
        refreshBtn.addEventListener('click', loadFiles);
    }

    loadFiles();
});