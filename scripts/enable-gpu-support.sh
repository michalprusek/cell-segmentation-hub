#!/bin/bash

# Script to enable GPU support for ML services
# Note: This requires NVIDIA Docker runtime properly configured

echo "🚀 Enabling GPU support for SpheroSeg ML services..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if NVIDIA Docker is available
if ! docker info | grep -q nvidia; then
    echo -e "${RED}❌ NVIDIA Docker runtime not found!${NC}"
    echo "Please install nvidia-container-toolkit first:"
    echo "  curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg"
    echo "  curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list"
    echo "  sudo apt-get update && sudo apt-get install -y nvidia-container-toolkit"
    echo "  sudo systemctl restart docker"
    exit 1
fi

echo -e "${GREEN}✅ NVIDIA Docker runtime found${NC}"

# Check GPU availability
if ! lspci | grep -qi nvidia; then
    echo -e "${RED}❌ No NVIDIA GPU detected on this system${NC}"
    exit 1
fi

GPU_INFO=$(lspci | grep -i nvidia | head -1)
echo -e "${GREEN}✅ GPU detected: ${GPU_INFO}${NC}"

# Create GPU-enabled override file for green environment
cat > docker-compose.green.gpu.yml <<EOF
# GPU Override for Green Environment
services:
  green-ml:
    runtime: nvidia
    environment:
      - NVIDIA_VISIBLE_DEVICES=all
      - NVIDIA_DRIVER_CAPABILITIES=compute,utility
      - CUDA_VISIBLE_DEVICES=0
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
EOF

echo -e "${YELLOW}📝 Created GPU override file: docker-compose.green.gpu.yml${NC}"

# Detect active environment
if docker ps | grep -q green-ml; then
    ACTIVE_ENV="green"
    echo -e "${GREEN}✅ Green environment is active${NC}"
elif docker ps | grep -q staging-ml; then
    ACTIVE_ENV="staging"
    echo -e "${GREEN}✅ Staging environment is active${NC}"
else
    echo -e "${RED}❌ No ML service is currently running${NC}"
    exit 1
fi

echo ""
echo "To enable GPU support, run:"
echo -e "${YELLOW}docker compose -f docker-compose.$ACTIVE_ENV.yml -f docker-compose.$ACTIVE_ENV.gpu.yml up -d${NC}"
echo ""
echo "To test GPU detection after restart:"
echo -e "${YELLOW}docker exec $ACTIVE_ENV-ml python -c \"import torch; print(f'CUDA available: {torch.cuda.is_available()}')\"${NC}"
echo ""
echo "⚠️  Note: Due to NVIDIA driver/library mismatch on this server,"
echo "    GPU support may require additional configuration or driver update."
echo "    Current driver: 570.86.15"