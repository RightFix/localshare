# LocalShare

Simple file sharing over local network.

This repository was created from the need to transfer files from my Windows PC to Ubuntu. Everyone is welcome to join in the fun.

## Description

LocalShare is a lightweight file transfer tool designed to quickly share files between devices on the same network. It provides a simple one-way connection to upload files from any device directly to your PC.

## Features

- Multi-file upload support
- Gzip compression during transfer for faster uploads
- Auto-increment handling for duplicate filenames
- Modern drag-and-drop web interface
- Network accessible (works from any device on the same WiFi)
- Decompression endpoint for compressed files

## Requirements

- Python 3.12+
- Flask

## Installation

Using uv (recommended):

```bash
uv sync
```

Or using pip:

```bash
pip install flask
```

## Usage

1. Run the server:

```bash
python main.py
```

2. Access the web interface from any device on your network:

```
http://<YOUR-PC-IP>:5000
```

3. Select and upload files from your device

The uploaded files will be saved in the `upload/` folder.

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Web interface |
| `/upload` | POST | Upload files (supports gzip compressed) |
| `/files` | GET | List all uploaded files |
| `/decompress/<filename>` | POST | Decompress a gzip file |

### Upload Examples

Using curl:

```bash
# Regular upload
curl -X POST -F "file=@myfile.txt" http://localhost:5000/upload

# Compressed upload
gzip -c myfile.txt | curl -X POST -H "X-Compressed: gzip" -H "X-Filename: myfile.txt" --data-binary @- http://localhost:5000/upload
```

### Decompress Example

```bash
curl -X POST http://localhost:5000/decompress/myfile.txt.gz
```

## Changelog

### v0.1.0 - 2025-07-12

- Initial release
- Basic file upload functionality
- Multi-file support
- Modern UI with drag & drop
- Gzip compression during upload
- Auto-increment for duplicate files
- Decompression endpoint

## License

MIT License

## Contributing

欢迎大家参与 - Everyone is welcome to join in the fun! Feel free to fork, submit issues, and make pull requests.