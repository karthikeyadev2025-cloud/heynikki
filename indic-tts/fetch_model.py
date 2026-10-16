"""Copy the five files the server needs out of an Indic-TTS release zip.

The archive is untrusted input. Nothing is extracted by the archive's own
path names (so a "../" entry or an absolute path cannot land anywhere), only
whitelisted entries are read, each is written under a fixed name into a
directory that must start empty, and every file has a size ceiling. Nothing
from the archive is executed.

    python3 -I fetch_model.py <te.zip> <empty-dest-dir>
"""
import json
import os
import shutil
import sys
import zipfile

WANT = {  # archive suffix -> fixed destination path
    "/fastpitch/best_model.pth": "fastpitch/best_model.pth",
    "/fastpitch/config.json": "fastpitch/config.json",
    "/fastpitch/speakers.pth": "fastpitch/speakers.pth",
    "/hifigan/best_model.pth": "hifigan/best_model.pth",
    "/hifigan/config.json": "hifigan/config.json",
}
MAX_BYTES = 1_500_000_000


def main(src: str, dest: str) -> None:
    if os.path.exists(dest) and os.listdir(dest):
        sys.exit(f"{dest} is not empty")
    with zipfile.ZipFile(src) as zf:
        names = [i for i in zf.infolist() if not i.is_dir()]
        for suffix, out in WANT.items():
            hits = [i for i in names if i.filename.endswith(suffix)]
            if len(hits) != 1:
                sys.exit(f"expected exactly one *{suffix}, found {[h.filename for h in hits]}")
            info = hits[0]
            if info.file_size > MAX_BYTES:
                sys.exit(f"{info.filename} is {info.file_size} bytes — refusing")
            path = os.path.join(dest, out)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with zf.open(info) as r, open(path, "xb") as w:
                shutil.copyfileobj(r, w, 1 << 20)
            print(f"{info.filename} -> {out} ({info.file_size} bytes)")
    # The released config still points at the trainer's own path
    # ("models/v1/te/fastpitch/speakers.pth"), and Coqui opens that path
    # rather than the speakers file it is handed. Rewrite it to where the
    # file now is. Data only: the JSON is parsed and re-dumped, never run.
    cfg_path = os.path.join(dest, "fastpitch/config.json")
    with open(cfg_path, encoding="utf-8") as f:
        cfg = json.load(f)
    spk = os.path.join(os.path.abspath(dest), "fastpitch/speakers.pth")
    cfg["speakers_file"] = spk
    cfg.setdefault("model_args", {})["speakers_file"] = spk
    with open(cfg_path, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=1)
    for out in WANT.values():
        os.chmod(os.path.join(dest, out), 0o444)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
