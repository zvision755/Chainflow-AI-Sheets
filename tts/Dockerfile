FROM python:3.12-slim-bookworm@sha256:54c85f3c47607a77f32adec749d3c81d1348bf25833671f512b26a9b6d778cb3 AS build
WORKDIR /app
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked export http_proxy="$HTTP_PROXY" https_proxy="$HTTPS_PROXY" && apt-get -o Acquire::Retries=4 update && apt-get -o Acquire::Retries=4 install -y --no-install-recommends build-essential cmake curl && rm -rf /var/lib/apt/lists/*
RUN python -m venv /app/.venv
ENV PATH=/app/.venv/bin:$PATH
COPY requirements.lock ./
RUN --mount=type=cache,target=/root/.cache/pip pip install --require-hashes -r requirements.lock
COPY download_models.py ./
RUN --mount=type=cache,target=/model-download-cache \
    KOKORO_MODEL_DIR=/model-download-cache python download_models.py && \
    mkdir models && cp /model-download-cache/kokoro-v1.0.onnx /model-download-cache/voices-v1.0.bin models/

FROM python:3.12-slim-bookworm@sha256:54c85f3c47607a77f32adec749d3c81d1348bf25833671f512b26a9b6d778cb3 AS runtime
WORKDIR /app
RUN export http_proxy="$HTTP_PROXY" https_proxy="$HTTPS_PROXY" && apt-get -o Acquire::Retries=4 update && apt-get -o Acquire::Retries=4 install -y --no-install-recommends libgomp1 && rm -rf /var/lib/apt/lists/*
ENV PATH=/app/.venv/bin:$PATH PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    HF_HUB_OFFLINE=1 HF_HUB_DISABLE_TELEMETRY=1 TOKENIZERS_PARALLELISM=false \
    KOKORO_HOST=0.0.0.0 KOKORO_PORT=8880 KOKORO_THREADS=2 HOME=/tmp
RUN groupadd --gid 1000 kokoro && useradd --uid 1000 --gid 1000 --no-create-home kokoro
COPY --from=build /app/.venv ./.venv
COPY --from=build /app/models ./models
COPY service.py ./
USER kokoro
EXPOSE 8880
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8880/health',timeout=3)"
CMD ["python", "service.py"]
