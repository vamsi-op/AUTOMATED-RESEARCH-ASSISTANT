FROM python:3.11-slim

WORKDIR /app

# System dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential curl libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Install CPU-only torch first (largest dep, benefits from layer caching)
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir \
        --extra-index-url https://download.pytorch.org/whl/cpu \
        "torch>=2.6.0"

# Install remaining dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download the embedding model during build so it never blocks at runtime
# HF_HOME set so model is cached in a known writable location
ENV HF_HOME=/app/.cache/huggingface
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2')"

# Copy application
COPY app/ ./app/
COPY main.py .
COPY frontend/ ./frontend/
COPY website/ ./website/
COPY scripts/ ./scripts/

# Create writable directories
RUN mkdir -p data/uploads data/processed logs .cache/huggingface

# HF Spaces requires user 1000
RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app
USER appuser

# HF Spaces uses port 7860; Railway/local uses $PORT or 8000
EXPOSE 7860

CMD uvicorn app.main:app --host 0.0.0.0 --port 7860 --workers 1

# cache-bust: 20260615-1328