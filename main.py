import gzip
import os
from flask import Flask, request, render_template, jsonify, send_file

app = Flask(__name__)
UPLOAD_FOLDER = "upload"
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

COMPRESSED_EXTENSIONS = {".gz", ".zip", ".bz2", ".7z", ".rar"}


@app.route("/")
def index():
    return render_template("index.html")


def get_unique_filename(filename):
    base, ext = os.path.splitext(filename)
    filepath = os.path.join(UPLOAD_FOLDER, filename)

    if not os.path.exists(filepath):
        return filename

    existing_files = os.listdir(UPLOAD_FOLDER)
    prefix = f"{base}_"
    max_counter = 0

    for f in existing_files:
        if f.startswith(prefix) and f.endswith(ext):
            try:
                counter = int(f[len(prefix) : -len(ext)])
                if counter > max_counter:
                    max_counter = counter
            except ValueError:
                continue

    return f"{base}_{max_counter + 1}{ext}"


def decompress_gzip(data):
    try:
        return gzip.decompress(data)
    except Exception:
        return None


@app.route("/upload", methods=["POST"])
def upload():
    files = request.files.getlist("file")
    uploaded = []
    errors = []

    for file in files:
        if file and file.filename:
            compression_type = request.headers.get("X-Compressed")
            original_filename = request.headers.get("X-Filename", file.filename)

            base, ext = os.path.splitext(original_filename)
            if ext.lower() in COMPRESSED_EXTENSIONS:
                unique_name = get_unique_filename(original_filename)
                file.save(os.path.join(UPLOAD_FOLDER, unique_name))
                uploaded.append(unique_name)
                continue

            if compression_type == "gzip":
                compressed_data = file.read()
                decompressed_data = decompress_gzip(compressed_data)

                if decompressed_data is None:
                    errors.append(
                        f"{original_filename}: Invalid or corrupted gzip data"
                    )
                    continue

                unique_name = get_unique_filename(original_filename)
                filepath = os.path.join(UPLOAD_FOLDER, unique_name)
                with open(filepath, "wb") as f:
                    f.write(decompressed_data)
                uploaded.append(unique_name)
            else:
                unique_name = get_unique_filename(original_filename)
                file.save(os.path.join(UPLOAD_FOLDER, unique_name))
                uploaded.append(unique_name)

    if errors:
        return jsonify({"error": "; ".join(errors)}), 400

    if uploaded:
        return jsonify({"message": f"Files uploaded: {', '.join(uploaded)}"}), 200

    return jsonify({"error": "No files uploaded"}), 400


@app.route("/decompress/<filename>", methods=["POST"])
def decompress_file(filename):
    filepath = os.path.join(UPLOAD_FOLDER, filename)

    if not os.path.exists(filepath):
        return jsonify({"error": "File not found"}), 404

    try:
        with open(filepath, "rb") as f:
            data = f.read()

        decompressed = gzip.decompress(data)

        base, ext = os.path.splitext(filename)
        if ext.lower() == ".gz":
            new_filename = base
        else:
            new_filename = f"{filename}.decompressed"

        new_filepath = os.path.join(UPLOAD_FOLDER, new_filename)
        counter = 1
        while os.path.exists(new_filepath):
            new_filename = f"{base}.decompressed_{counter}"
            new_filepath = os.path.join(UPLOAD_FOLDER, new_filename)
            counter += 1

        with open(new_filepath, "wb") as f:
            f.write(decompressed)

        return jsonify({"message": f"File decompressed to: {new_filename}"}), 200

    except Exception as e:
        return jsonify({"error": f"Decompression failed: {str(e)}"}), 400


@app.route("/files")
def files():
    file_list = []
    with os.scandir(UPLOAD_FOLDER) as entries:
        for entry in entries:
            if entry.is_file():
                file_list.append({"name": entry.name, "size": entry.stat().st_size})
    file_list.sort(key=lambda x: x["name"])
    return jsonify(file_list)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
