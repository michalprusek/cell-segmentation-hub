#!/usr/bin/env python3
"""
Model Weight Download Script for SpheroSeg
Downloads model weights from Google Drive with resume capability and integrity verification
"""
import os
import sys
import hashlib
import argparse
from pathlib import Path
from typing import Dict, Optional
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

        # Session for cookies
        session_cookies = {}

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


def download_file(url: str, dest: Path, expected_size: int, model_name: str) -> bool:
    """
    Download a file with resume capability
    Returns True if successful, False otherwise
    """
    try:
        # Check if file already exists
        if dest.exists():
            existing_size = dest.stat().st_size
            if existing_size == expected_size:
                print(f"  ✓ {model_name}: Already downloaded ({existing_size / (1024*1024):.1f} MB)")
                return True
            elif existing_size > expected_size:
                print(f"  ⚠️  {model_name}: File size mismatch, re-downloading...")
                dest.unlink()

        # Create request with resume support
        headers = {}
        start_pos = 0

        if dest.exists():
            start_pos = dest.stat().st_size
            headers['Range'] = f'bytes={start_pos}-'
            print(f"  📥 {model_name}: Resuming from {start_pos / (1024*1024):.1f} MB...")
        else:
            print(f"  📥 {model_name}: Starting download...")

        request = urllib.request.Request(url, headers=headers)

        # Open connection
        with urllib.request.urlopen(request, timeout=30) as response:
            # Open file in append mode if resuming, write mode otherwise
            mode = 'ab' if start_pos > 0 else 'wb'

            # Create progress reporter
            remaining_size = expected_size - start_pos
            progress = ProgressReporter(expected_size, model_name)
            progress.downloaded = start_pos

            with open(dest, mode) as f:
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
        gdrive_id = config.get("gdrive_id", "")
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