"""Generate latest.json from the signed installer pairs in one GitHub release."""

import base64
import json
import subprocess
import sys
from pathlib import Path

# Each installed copy looks up `{os}-{arch}-{installer}`, then `{os}-{arch}`. The universal app
# runs its native slice, so both macOS architectures point to the one archive.
PLATFORMS = {
    ".app.tar.gz": (
        "darwin-aarch64", "darwin-aarch64-app", "darwin-x86_64", "darwin-x86_64-app",
    ),
    ".AppImage": ("linux-x86_64", "linux-x86_64-appimage"),
    ".deb": ("linux-x86_64-deb",),
    ".rpm": ("linux-x86_64-rpm",),
    ".msi": ("windows-x86_64", "windows-x86_64-msi"),
    "-setup.exe": ("windows-x86_64-nsis",),
}
# Installed by hand only, as the README says: no update entry, but the release needs one.
FIRST_INSTALL = (".dmg",)


def read_signature(asset):
    data = subprocess.check_output([
        "gh", "api", "-H", "Accept: application/octet-stream", asset["url"],
    ])
    signature = data.decode("ascii").strip()
    if not base64.b64decode(signature, validate=True).startswith(b"untrusted comment:"):
        raise ValueError(f"Invalid updater signature in {asset['name']}")
    return signature


def only_installer(assets, suffix):
    matches = [name for name in assets if name.endswith(suffix)]
    if len(matches) != 1:
        raise ValueError(f"Expected one uploaded {suffix} installer, found {matches}")
    return matches[0]


def manifest(release, tag):
    if not release["draft"] or release["tag_name"] != tag or not tag.startswith("v"):
        raise ValueError(f"Expected the draft for {tag}")

    assets = {
        asset["name"]: asset for asset in release["assets"]
        if asset["state"] == "uploaded" and asset["size"] > 0
    }
    for suffix in FIRST_INSTALL:
        only_installer(assets, suffix)
    platforms = {}
    for suffix, keys in PLATFORMS.items():
        name = only_installer(assets, suffix)
        signature = assets.get(name + ".sig")
        if signature is None:
            raise ValueError(f"Missing uploaded signature for {name}")
        url = assets[name]["url"]
        if not url or not url.startswith("https://"):
            raise ValueError(f"Missing HTTPS download URL for {name}")
        entry = {"url": url, "signature": read_signature(signature)}
        platforms.update(dict.fromkeys(keys, entry))

    return {
        "version": tag[1:],
        "notes": release["body"] or "",
        "pub_date": release["created_at"],
        "platforms": platforms,
    }


if __name__ == "__main__":
    draft = json.loads(Path(sys.argv[1]).read_text())
    print(json.dumps(manifest(draft, sys.argv[2]), indent=2))
