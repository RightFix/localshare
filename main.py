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
    files = request.files.getlist("file")
    uploaded = []
    for file in files:
        if file and file.filename:
            file.save(os.path.join(UPLOAD_FOLDER, file.filename))
            uploaded.append(file.filename)
    if uploaded:
        return redirect(
            url_for(
                "index", success=f"Files uploaded successfully: {', '.join(uploaded)}"
            )
        )
    return redirect(url_for("index"))


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
