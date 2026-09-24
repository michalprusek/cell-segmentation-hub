#!/usr/bin/env python3
"""
Model Weight Download Script for SpheroSeg
Downloads model weights from Google Drive with resume capability and integrity verification
"""
import sys
import hashlib
import argparse
from pathlib import Path
from typing import Optional
import urllib.request
import urllib.error
import re

# Configuration for model weights
# ============================================================================
# WEIGHT SOURCES: Google Drive
# ============================================================================
#
# Weights are hosted on Google Drive for easy access and sharing.
# Public folder: https://drive.google.com/drive/folders/1LwtiNkRabNw1c8V9kiEotdupO2HoaJzk
#
# IMPORTANT: After uploading files, you MUST add file IDs below!
#
# To get file IDs:
# 1. Upload file to the folder above
# 2. Right-click file → Share → Set to "Anyone with the link"
# 3. Copy link and extract ID from URL
#    Example URL: https://drive.google.com/file/d/1ABC123XYZ/view
#    File ID: 1ABC123XYZ
# 4. Replace "YOUR_FILE_ID_HERE" below with actual ID
#
# ============================================================================

# Google Drive folder containing weights
GDRIVE_FOLDER_URL = "https://drive.google.com/drive/folders/1LwtiNkRabNw1c8V9kiEotdupO2HoaJzk"

WEIGHTS_CONFIG = {
    "hrnet": {
        "gdrive_id": "1zFZw0pikJEqkUFH_WGYAYMLPodiuj4-i",
        "filename": "hrnet_best_model.pth",
        "size": 791300849,  # 755 MB
        "sha256": None,  # Optional: Add checksum for verification
    },
    "cbam_resunet": {
        "gdrive_id": "1yu1gWK1l4IyvvYAALPfdOvLclvI8MLWw",
        "filename": "cbam_resunet_new.pth",
        "size": 625096857,  # 597 MB
        "sha256": None,
    },
    "unet_spherohq": {
        "gdrive_id": "14XoSu1uheEalap71-homLUHLA3iKjNfk",
        "filename": "unet_spherohq_best.pth",
        "size": 429175255,  # 410 MB
        "sha256": None,
    },
    # The spheroid-disintegration paper's deposited production replicate
    # prod_s42 (UNet++/EfficientNet-B5, 3 classes), served under the unchanged
    # filename. It is ONE of the paper's five production replicates; the
    # paper's numbers are five-replicate means unless a replicate is named.
    # Not on Google Drive: its home is the paper's weights deposit on Zenodo,
    # which stays a DRAFT (reserved DOI, not downloadable) until the paper is
    # published, so until then it is staged by hand and this entry only
    # VERIFIES it. The sha256 is mandatory here: the checkpoint served before
    # this entry existed (sha256 8b74ae88...) has exactly the same size, so a
    # size check alone cannot tell the two apart.
    "spheroid_disintegration": {
        "gdrive_id": None,
        "filename": "spheroid_disintegration_unetpp_effb5_3class.pth",
        "size": 123609986,  # bytes of the deposited prod_s42.pth (~118 MB)
        "sha256": "d47d28ad338de2e7424969e8da1dc39df2663bcf1777e681647caffa1f49ea15",
        "source": (
            "Zenodo record 10.5281/zenodo.22295117 (spheroid-disintegration "
            "paper, deposited weights, file prod_s42.pth) -- a draft until "
            "publication, so copy prod_s42.pth by hand to this filename and "
            "re-run with --verify-only"
        ),
    },
}


class ProgressReporter:
    """Simple progress reporter for downloads"""

    def __init__(self, total_size: int, name: str):
        self.total_size = total_size
        self.name = name
        self.downloaded = 0

    def update(self, chunk_size: int):
        self.downloaded += chunk_size
        percent = (self.downloaded / self.total_size) * 100 if self.total_size > 0 else 0
        mb_downloaded = self.downloaded / (1024 * 1024)
        mb_total = self.total_size / (1024 * 1024)

        # Simple progress bar
        bar_length = 40
        filled = int(bar_length * percent / 100)
        bar = '=' * filled + '-' * (bar_length - filled)

        print(f'\r{self.name}: [{bar}] {percent:.1f}% ({mb_downloaded:.1f}/{mb_total:.1f} MB)',
              end='', flush=True)

        if self.downloaded >= self.total_size:
            print()  # New line when complete


def calculate_sha256(file_path: Path) -> str:
    """Calculate SHA256 checksum of a file"""
    sha256_hash = hashlib.sha256()
    with open(file_path, "rb") as f:
        for byte_block in iter(lambda: f.read(4096), b""):
            sha256_hash.update(byte_block)
    return sha256_hash.hexdigest()


def verify_checksum(file_path: Path, expected_sha256: Optional[str]) -> bool:
    """Verify file integrity using SHA256 checksum"""
    if expected_sha256 is None:
        print(f"  ⚠️  No checksum provided for {file_path.name}, skipping verification")
        return True

    print(f"  🔍 Verifying checksum for {file_path.name}...")
    actual_sha256 = calculate_sha256(file_path)

    if actual_sha256 == expected_sha256:
        print(f"  ✓ Checksum verified")
        return True
    else:
        print(f"  ✗ Checksum mismatch!")
        print(f"    Expected: {expected_sha256}")
        print(f"    Got:      {actual_sha256}")
        return False


def get_gdrive_download_url(file_id: str) -> str:
    """Convert Google Drive file ID to direct download URL"""
    return f"https://drive.google.com/uc?export=download&id={file_id}"


def download_from_gdrive(file_id: str, dest: Path, expected_size: int, model_name: str) -> bool:
    """
    Download large file from Google Drive with virus scan bypass
    Returns True if successful, False otherwise
    """
    try:
        # Initial URL
        url = get_gdrive_download_url(file_id)

        print(f"  📥 {model_name}: Starting download from Google Drive...")

        # First request to get confirmation token
        request = urllib.request.Request(url)

        with urllib.request.urlopen(request, timeout=30) as response:
            # Check if we got virus scan warning (for large files)
            content = response.read().decode('utf-8', errors='ignore')

            # Look for confirmation token in response
            match = re.search(r'confirm=([0-9A-Za-z_]+)', content)
            if match:
                confirm_token = match.group(1)
                url = f"{url}&confirm={confirm_token}"
                print(f"  🔓 Bypassing virus scan confirmation...")

        # Check if file already exists
        if dest.exists():
            existing_size = dest.stat().st_size
            if existing_size == expected_size:
                print(f"  ✓ {model_name}: Already downloaded ({existing_size / (1024*1024):.1f} MB)")
                return True
            elif existing_size > expected_size:
                print(f"  ⚠️  {model_name}: File size mismatch, re-downloading...")
                dest.unlink()

        # Download with progress
        request = urllib.request.Request(url)

        with urllib.request.urlopen(request, timeout=30) as response:
            # Create progress reporter
            progress = ProgressReporter(expected_size, model_name)

            with open(dest, 'wb') as f:
                while True:
                    chunk = response.read(8192)  # 8KB chunks
                    if not chunk:
                        break
                    f.write(chunk)
                    progress.update(len(chunk))

        # Verify final size
        final_size = dest.stat().st_size
        if final_size != expected_size:
            print(f"  ✗ {model_name}: Size mismatch ({final_size} != {expected_size})")
            return False

        print(f"  ✓ {model_name}: Download complete")
        return True

    except urllib.error.HTTPError as e:
        print(f"  ✗ {model_name}: HTTP error {e.code}: {e.reason}")
        return False
    except urllib.error.URLError as e:
        print(f"  ✗ {model_name}: Connection error: {e.reason}")
        return False
    except Exception as e:
        print(f"  ✗ {model_name}: Unexpected error: {str(e)}")
        return False


def download_all_weights(weights_dir: Path, force: bool = False, verify_only: bool = False) -> bool:
    """
    Download all model weights
    Returns True if all successful, False otherwise
    """
    print("=" * 70)
    print("SpheroSeg Model Weight Manager")
    print("=" * 70)
    print(f"Weights directory: {weights_dir}")
    print(f"Total size: {sum(cfg['size'] for cfg in WEIGHTS_CONFIG.values()) / (1024**3):.2f} GB")
    print()

    # Create weights directory if it doesn't exist
    weights_dir.mkdir(parents=True, exist_ok=True)

    success = True
    for model_name, config in WEIGHTS_CONFIG.items():
        dest_path = weights_dir / config["filename"]

        # Verify-only mode
        if verify_only:
            if dest_path.exists():
                if verify_checksum(dest_path, config["sha256"]):
                    print(f"✓ {model_name}: Valid")
                else:
                    print(f"✗ {model_name}: Invalid checksum")
                    success = False
            else:
                print(f"✗ {model_name}: Missing")
                success = False
            continue

        # Check if file exists and is valid
        if dest_path.exists() and not force:
            existing_size = dest_path.stat().st_size
            if existing_size == config["size"]:
                if config["sha256"]:
                    if verify_checksum(dest_path, config["sha256"]):
                        print(f"✓ {model_name}: Already downloaded and verified")
                        continue
                    else:
                        print(f"⚠️  {model_name}: Checksum mismatch, re-downloading...")
                else:
                    print(f"✓ {model_name}: Already downloaded")
                    continue

        # Check if Google Drive ID is configured
        gdrive_id = config.get("gdrive_id") or ""
        if config.get("source") and not gdrive_id:
            # Not hosted on Google Drive (e.g. a paper's deposit that is still
            # a draft): the file is staged by hand and only verified here.
            print(f"\n{model_name}: no automatic download.")
            print(f"   Source: {config['source']}")
            if dest_path.exists() and dest_path.stat().st_size == config["size"]:
                if verify_checksum(dest_path, config["sha256"]):
                    print(f"   ✓ Staged file verified: {dest_path}")
                    continue
                print(f"   ✗ {dest_path} has the right size but the WRONG checksum "
                      f"-- it is not the pinned checkpoint")
            else:
                print(f"   ✗ {dest_path} missing or of the wrong size "
                      f"(expected {config['size']} bytes)")
            success = False
            continue
        if not gdrive_id or "YOUR_FILE_ID_HERE" in gdrive_id or "REPLACE" in gdrive_id:
            print(f"\n❌ ERROR: {model_name} Google Drive ID not configured!")
            print(f"")
            print(f"📁 Google Drive folder: {GDRIVE_FOLDER_URL}")
            print(f"")
            print(f"To configure automatic download:")
            print(f"  1. Upload {config['filename']} to the folder above")
            print(f"  2. Right-click file → Share → 'Anyone with the link'")
            print(f"  3. Copy link and extract file ID:")
            print(f"     URL: https://drive.google.com/file/d/FILE_ID_HERE/view")
            print(f"  4. Edit: backend/segmentation/scripts/download_weights.py")
            print(f"  5. Replace 'YOUR_FILE_ID_HERE' in '{model_name}' section")
            print(f"")
            print(f"Expected: {config['filename']} ({config['size'] / (1024*1024):.1f} MB)")
            print()

            # Check if file exists locally
            if dest_path.exists():
                existing_size = dest_path.stat().st_size
                print(f"   ✓ File found locally: {dest_path}")
                print(f"   Size: {existing_size / (1024*1024):.1f} MB")
                if existing_size == config["size"]:
                    print(f"   ✓ Size matches, using existing file")
                    continue
                else:
                    print(f"   ⚠️  Size mismatch! Expected {config['size'] / (1024*1024):.1f} MB")
                    success = False
                    continue
            else:
                print(f"   ✗ File not found locally")
                print(f"   Please configure Google Drive ID or download manually")
                success = False
                continue

        # Download from Google Drive
        if download_from_gdrive(config["gdrive_id"], dest_path, config["size"], model_name):
            # Verify checksum if provided
            if config["sha256"]:
                if not verify_checksum(dest_path, config["sha256"]):
                    print(f"  ⚠️  Checksum verification failed for {model_name}")
                    dest_path.unlink()  # Remove corrupted file
                    success = False
        else:
            success = False

    print()
    print("=" * 70)
    if success:
        print("✅ All model weights ready!")
    else:
        print("❌ Some weights failed to download or verify")
    print("=" * 70)

    return success


def main():
    parser = argparse.ArgumentParser(description="Download SpheroSeg model weights")
    parser.add_argument(
        "--weights-dir",
        type=Path,
        default=Path(__file__).parent.parent / "weights",
        help="Directory to store model weights (default: ../weights)"
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Force re-download even if files exist"
    )
    parser.add_argument(
        "--verify-only",
        action="store_true",
        help="Only verify existing weights without downloading"
    )

    args = parser.parse_args()

    success = download_all_weights(args.weights_dir, args.force, args.verify_only)
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()