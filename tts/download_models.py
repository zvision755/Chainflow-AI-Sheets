"""Fetch pinned, hash-verified Kokoro assets at build/setup time, never inference."""
import hashlib
from pathlib import Path
import os
import time
import subprocess

ASSETS = {
    "kokoro-v1.0.onnx": "beb0d1848dee9a49da392cc3df26958d46cfa35d321edf434f52949153f0df3a",
    "voices-v1.0.bin": "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d",
}
BASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/"

def digest(path):
    value = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()

def download(directory):
    directory.mkdir(parents=True, exist_ok=True)
    for name, sha in ASSETS.items():
        path = directory / name
        if path.is_file() and digest(path) == sha:
            continue
        partial = path.with_suffix(".part")
        for attempt in range(4):
            try:
                # curl handles HTTP/2 and rejects truncated transfers; urllib can
                # report premature proxy EOF as success on some Mac networks.
                subprocess.run(["curl", "--fail", "--location", "--silent", "--show-error",
                                "--retry", "3", "--retry-all-errors", "--connect-timeout", "15",
                                "--max-time", "300", "--output", str(partial), BASE + name], check=True)
                actual = digest(partial)
                if actual != sha:
                    print('Asset integrity:', name, partial.stat().st_size, actual, flush=True)
                    raise ValueError("Kokoro asset hash mismatch")
                partial.replace(path)
                print("Verified", name, flush=True)
                break
            except Exception as error:
                print('Retry asset', name, type(error).__name__, getattr(error, 'code', ''), flush=True)
                partial.unlink(missing_ok=True)
                if attempt == 3:
                    raise RuntimeError("Cannot download verified Kokoro model; check build proxy") from None
                time.sleep(2 ** attempt)

if __name__ == "__main__":
    download(Path(os.environ.get("KOKORO_MODEL_DIR", Path(__file__).parent / "models")))
