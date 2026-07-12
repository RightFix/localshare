import os
from flask import Flask, request, render_template, redirect, url_for

app = Flask(__name__)
UPLOAD_FOLDER = "upload"
os.makedirs(UPLOAD_FOLDER, exist_ok=True)


@app.route("/")
def index():
    success = request.args.get("success", "")
    files = sorted(os.listdir(UPLOAD_FOLDER))
    return render_template("index.html", success=success, files=files)


@app.route("/upload", methods=["POST"])
def upload():
    file = request.files.get("file")
    if file and file.filename:
        file.save(os.path.join(UPLOAD_FOLDER, file.filename))
        return redirect(
            url_for("index", success=f"File '{file.filename}' uploaded successfully!")
        )
    return redirect(url_for("index"))


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
