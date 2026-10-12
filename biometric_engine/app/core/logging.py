"""Structured JSON logging with structlog.

Each log line is JSON with timestamp, level, logger, message and the
request_id bound per-request (see helpers below).
"""

import contextvars
import logging
import sys

import structlog

_request_id_ctx: contextvars.ContextVar[str] = contextvars.ContextVar(
    "request_id", default="-"
)


def bind_request_id(request_id: str) -> None:
    """Bind a request id to the current async context."""
    _request_id_ctx.set(request_id)


def unbind_request_id() -> None:
    """Clear the request id from the current async context."""
    _request_id_ctx.set("-")


def _add_request_id(
    logger: logging.Logger, method_name: str, event_dict: structlog.types.EventDict
) -> structlog.types.EventDict:
    """Inject the current request_id into every log event."""
    event_dict.setdefault("request_id", _request_id_ctx.get())
    return event_dict


_configured = False


def configure_logging(level: str = "INFO") -> structlog.stdlib.BoundLogger:
    """Configure stdlib + structlog for JSON output. Idempotent."""
    global _configured
    numeric_level = getattr(logging, level.upper(), logging.INFO)
    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=numeric_level,
        force=True,
    )
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            _add_request_id,
            structlog.stdlib.filter_by_level,
            structlog.stdlib.add_logger_name,
            structlog.stdlib.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.stdlib.BoundLogger,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )
    _configured = True
    return structlog.get_logger("biometric_engine")


def get_logger(name: str) -> structlog.stdlib.BoundLogger:
    """Return a structlog logger, configuring defaults on first use."""
    if not _configured:
        configure_logging()
    return structlog.get_logger(name)
