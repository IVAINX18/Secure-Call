"""Prometheus metrics singletons for the biometric engine."""

from prometheus_client import Counter, Histogram

# Total HTTP requests, labelled by method/path/status code.
REQUESTS_TOTAL = Counter(
    "requests_total",
    "Total HTTP requests handled",
    ["method", "path", "status"],
)

# Request latency in seconds, labelled by method/path.
REQUEST_DURATION_SECONDS = Histogram(
    "request_duration_seconds",
    "HTTP request latency in seconds",
    ["method", "path"],
)
