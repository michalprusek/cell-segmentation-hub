# Test build for ML service with test dependencies
FROM python:3.11-slim AS test

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements
COPY backend/segmentation/requirements.txt ./requirements.txt

# Install Python dependencies including test dependencies
RUN pip install --no-cache-dir -r requirements.txt && \
    pip install --no-cache-dir pytest pytest-asyncio pytest-cov httpx

# Copy ML service code
COPY backend/segmentation .

# Create test results directory
RUN mkdir -p test-results coverage

# Set environment variables
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV ENVIRONMENT=test

EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Default command (can be overridden)
CMD ["python", "-m", "pytest", "tests/", "-v", "--tb=short"]