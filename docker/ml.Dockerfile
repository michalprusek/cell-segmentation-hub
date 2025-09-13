FROM python:3.10-slim

WORKDIR /app

# Install system dependencies including OpenGL for OpenCV and gosu
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
COPY backend/segmentation/requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY backend/segmentation/ .

# Create weights directory
RUN mkdir -p weights

# Create proper entrypoint script
COPY <<'EOF' /entrypoint.sh
#!/bin/sh
# Fix permissions for mounted volumes at runtime
chown -R appuser:appuser /app/weights

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