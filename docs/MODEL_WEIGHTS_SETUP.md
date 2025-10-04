# Model Weights Setup Guide

This guide explains how to obtain model weights for the Cell Segmentation Hub ML service.

## Overview

The ML service requires three pre-trained deep learning models (~1.8 GB total):

- **HRNet** (755 MB) - High-resolution network for fast segmentation
- **CBAM-ResUNet** (597 MB) - Advanced model with attention mechanisms
- **U-Net SpheroHQ** (410 MB) - Optimized for SpheroHQ dataset

## Automatic Download (Recommended)

**Just run `make dev` and weights download automatically!**

```bash
# Clone repository
git clone https://github.com/your-org/cell-segmentation-hub.git
cd cell-segmentation-hub

# Start services - weights download automatically from Google Drive
make dev
```

On first start, the ML service will:

1. Check if weights exist
2. Download missing weights from Google Drive (~1.8 GB)
3. Verify file sizes
4. Start the service

**First startup takes 5-10 minutes** depending on your internet connection.

## Manual Download

If you prefer to download weights manually:

### Option 1: Google Drive (Web Browser)

1. **Visit the weights folder**: [Google Drive - SpheroSeg Weights](https://drive.google.com/drive/folders/1LwtiNkRabNw1c8V9kiEotdupO2HoaJzk?usp=drive_link)

2. **Download all three files**:
   - `hrnet_best_model.pth` (755 MB)
   - `cbam_resunet_new.pth` (597 MB)
   - `unet_spherohq_best.pth` (410 MB)

3. **Place in weights directory**:

   ```bash
   mkdir -p backend/segmentation/weights
   mv ~/Downloads/*.pth backend/segmentation/weights/
   ```

4. **Verify**:

   ```bash
   make check-weights
   ```

5. **Start services**:
   ```bash
   make dev
   ```

### Option 2: Command Line with gdown

```bash
# Install gdown (Python tool for Google Drive downloads)
pip install gdown

# Download weights (will be configured once you upload files)
cd backend/segmentation/weights

# Download each file (URLs will be updated after you upload)
# gdown --id FILE_ID_1 -O hrnet_best_model.pth
# gdown --id FILE_ID_2 -O cbam_resunet_new.pth
# gdown --id FILE_ID_3 -O unet_spherohq_best.pth
```

### Option 3: Use Existing Weights

If you already have the weight files:

```bash
# Copy to correct location
mkdir -p backend/segmentation/weights
cp /path/to/your/weights/*.pth backend/segmentation/weights/

# Verify
make check-weights

# Start
make dev
```

## Verification

Check if weights are present and valid:

```bash
# Quick check
make check-weights

# Detailed info
make weights-info

# Expected output:
# ✅ Model weights found
# backend/segmentation/weights: 1.8G
```

Expected files:

```
backend/segmentation/weights/
├── hrnet_best_model.pth          (755 MB)
├── cbam_resunet_new.pth          (597 MB)
└── unet_spherohq_best.pth        (410 MB)
```

## Troubleshooting

### Download Failed

**Error**: `Failed to download weights from Google Drive`

**Solutions**:

1. Check internet connection
2. Verify Google Drive folder is publicly accessible
3. Try manual download from browser
4. Check available disk space (need ~2 GB free)

### Container Fails to Start

**Error**: `ML service initialization failed`

**Check logs**:

```bash
make logs-ml
```

**Common issues**:

1. **Weights missing**: Download manually or wait for automatic download
2. **Wrong file size**: Delete and re-download
3. **Permissions**: Ensure files are readable
   ```bash
   chmod 644 backend/segmentation/weights/*.pth
   ```

### Slow Download

**First startup takes 5-10 minutes** to download 1.8 GB.

To monitor progress:

```bash
# Watch logs in real-time
make logs-ml -f
```

You'll see:

```
📥 Downloading hrnet_best_model.pth...
[==========] 45.2% (340.5/755.0 MB)
```

## Advanced Options

### Skip Automatic Download

If you want to provide weights manually:

```bash
# Set environment variable to skip auto-download
export SKIP_WEIGHT_DOWNLOAD=true

# Place weights manually
mkdir -p backend/segmentation/weights
cp /path/to/*.pth backend/segmentation/weights/

# Start services
make dev
```

### Download Weights Before Starting

```bash
# Pre-download using the download script
cd backend/segmentation
python scripts/download_weights.py

# Then start normally
cd ../..
make dev
```

### Use Alternative Storage

To use your own storage (S3, Hugging Face, etc.), edit:

```bash
nano backend/segmentation/scripts/download_weights.py
```

Update the `WEIGHTS_CONFIG` URLs to point to your storage.

## Storage Location

### In Docker Container

- Path: `/app/weights/`
- Mounted from: `./backend/segmentation/weights/`
- Type: Volume mount (persists between restarts)

### On Host System

- Path: `backend/segmentation/weights/`
- Ignored by Git: Yes (`.gitignore` includes `*.pth`)

## Best Practices

### For Development

- ✅ Use automatic download on first start
- ✅ Keep weights out of Git (already configured)
- ✅ Share Google Drive link with team members

### For Teams

- ✅ One person downloads, others copy from shared location
- ✅ Document which version of weights matches which code version
- ✅ Keep backup of production weights

### For Production

- ✅ Pre-download weights before deployment
- ✅ Use read-only volume mounts
- ✅ Keep backups
- ✅ Monitor file integrity

## FAQ

**Q: Do I need to download weights every time?**
A: No! Weights are stored in `backend/segmentation/weights/` and persist between container restarts.

**Q: Can I use my own trained models?**
A: Yes! Place your `.pth` files in `backend/segmentation/weights/` with the expected filenames.

**Q: How much disk space do I need?**
A: ~2 GB for weights + ~5 GB for Docker images = ~7 GB total.

**Q: Can I use CPU-only mode?**
A: Yes, set `ENABLE_GPU=false` in `.env`. Inference will be slower but works fine.

**Q: Where can I get the latest weights?**
A: Download from the [Google Drive folder](https://drive.google.com/drive/folders/1LwtiNkRabNw1c8V9kiEotdupO2HoaJzk?usp=drive_link) or contact spheroseg@utia.cas.cz

**Q: Can I update weights without rebuilding?**
A: Yes! Just replace files in `backend/segmentation/weights/` and restart:

```bash
make restart
```

## Support

For issues or questions:

- Check logs: `make logs-ml`
- Verify weights: `make check-weights`
- Google Drive: [Download Weights](https://drive.google.com/drive/folders/1LwtiNkRabNw1c8V9kiEotdupO2HoaJzk?usp=drive_link)
- Contact: spheroseg@utia.cas.cz
- Project page: https://staff.utia.cas.cz/novozada/spheroseg/
