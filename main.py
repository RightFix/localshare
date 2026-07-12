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

    counter = 1
    while True:
        new_filename = f"{base}_{counter}{ext}"
        if not os.path.exists(os.path.join(UPLOAD_FOLDER, new_filename)):
            return new_filename
        counter += 1


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
    for filename in sorted(os.listdir(UPLOAD_FOLDER)):
        filepath = os.path.join(UPLOAD_FOLDER, filename)
        if os.path.isfile(filepath):
            file_list.append({"name": filename, "size": os.path.getsize(filepath)})
    return jsonify(file_list)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
