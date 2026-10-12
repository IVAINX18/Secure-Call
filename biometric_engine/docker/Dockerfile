# Multi-stage build for the biometric engine API.
# Business modules (app.main) arrive in Fase 2; until then this file is
# validated by build only, the CMD is not executed.

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

COPY --from=builder /install /usr/local

WORKDIR /app
COPY app/ ./app/

RUN useradd --create-home --shell /bin/false appuser \
    && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
