import os
from flask import Flask, request, render_template, jsonify

app = Flask(__name__)
UPLOAD_FOLDER = "upload"
os.makedirs(UPLOAD_FOLDER, exist_ok=True)


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


@app.route("/upload", methods=["POST"])
def upload():
    files = request.files.getlist("file")
    uploaded = []
    for file in files:
        if file and file.filename:
            unique_name = get_unique_filename(file.filename)
            file.save(os.path.join(UPLOAD_FOLDER, unique_name))
            uploaded.append(unique_name)
    if uploaded:
        return jsonify({"message": f"Files uploaded: {', '.join(uploaded)}"}), 200
    return jsonify({"error": "No files uploaded"}), 400


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
