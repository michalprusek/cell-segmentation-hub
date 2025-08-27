# Use PyTorch base image with CUDA support
FROM pytorch/pytorch:2.3.1-cuda12.1-cudnn8-runtime

# Set working directory
WORKDIR /app

# Install system dependencies (Python is already included in PyTorch image)
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    g++ \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libgomp1 \
    libgl1 \
    libfontconfig1 \
    libxrender1 \
    libxtst6 \
    libxi6 \
    curl \
    dumb-init \
    ca-certificates \
    gosu \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd -r appuser && useradd -r -g appuser appuser

# Copy requirements first for better caching
COPY requirements.txt .

# Upgrade pip and install Python dependencies (exclude PyTorch to preserve CUDA version)
RUN python -m pip install --no-cache-dir --upgrade pip && \
    grep -v "^torch\|^torchvision" requirements.txt > requirements_no_torch.txt && \
    python -m pip install --no-cache-dir -r requirements_no_torch.txt && \
    rm requirements_no_torch.txt

# Copy application code
COPY . .

# Create weights directory
RUN mkdir -p weights

# Create proper entrypoint script for GPU
COPY <<'EOF' /entrypoint.sh
#!/bin/sh
# Fix permissions for mounted volumes at runtime
chown -R appuser:appuser /app/weights

# Log GPU availability
echo "Checking GPU availability..."
python -c "import torch; print(f'CUDA available: {torch.cuda.is_available()}'); print(f'CUDA device: {torch.cuda.get_device_name(0) if torch.cuda.is_available() else \"No GPU\"}')"

# Handle conditional reload logic
if [ "$FASTAPI_RELOAD" = "true" ]; then
    exec gosu appuser uvicorn api.main:app --host 0.0.0.0 --port 8000 --reload
else
    exec gosu appuser "$@"
fi
EOF

RUN chmod +x /entrypoint.sh && chown root:root /entrypoint.sh

# Verify gosu installation
RUN gosu nobody true

# Set initial permissions
RUN chown -R appuser:appuser /app

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Start FastAPI server with proper signal handling
ENTRYPOINT ["dumb-init", "--", "/entrypoint.sh"]
CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000"]