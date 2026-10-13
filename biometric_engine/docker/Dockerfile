# Fase 9: validated end-to-end with Docker 26.1.5 (image builds, 3 services
# Up/healthy, containerized enroll->verify green). Compose/Dockerfile are
# runtime-agnostic (podman works too).
#
# Multi-stage build for the biometric engine API.
# Runtime needs libGL + glib for opencv/mediapipe wheels on python:3.11-slim.

FROM python:3.11-slim AS builder

# Build dependencies for packages with native extensions
# (onnxruntime, insightface, mediapipe pull prebuilt wheels, but keep
# the toolchain for any source fallback).
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential cmake \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build
COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

FROM python:3.11-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# OpenCV / MediaPipe native deps (ImportError: libGL.so.1 / libglib without them;
# MediaPipe Tasks vision needs EGL/GLES too: OSError libEGL.so.1 otherwise).
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 libegl1 libgles2 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /install /usr/local

WORKDIR /app
COPY app/ ./app/
COPY alembic.ini ./
COPY docker/entrypoint.sh ./docker/entrypoint.sh
RUN chmod +x ./docker/entrypoint.sh

RUN useradd --create-home --shell /bin/false appuser \
    && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

ENTRYPOINT ["./docker/entrypoint.sh"]
