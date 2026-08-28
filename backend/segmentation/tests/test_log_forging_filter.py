"""The CR/LF log filter is the whole CWE-117 defence, and nothing guarded it.

`api.main` installs `_NoCRLFLogFilter` on the ROOT HANDLERS so that records
propagated from every child module logger (`api.frap_targets`, `api.routes`,
...) pass through it. Nothing in the suite checked that, which
means the protection could be removed — or quietly bypassed by reconfiguring
logging — with no test going red.

CodeQL cannot see it either: it reports `py/log-injection` at the call sites
because a runtime logging filter is invisible to its data-flow analysis. So the
alerts stay open while the defence is real, and the defence could disappear
while the alerts stay unchanged. These tests are the only thing that ties the
two together.
"""

import logging

import pytest


class _Capture(logging.Handler):
    def __init__(self) -> None:
        super().__init__()
        self.messages: list[str] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.messages.append(self.format(record))


@pytest.fixture()
def root_filters():
    """The filters api.main attached to the root handlers."""
    import api.main  # noqa: F401  -- import installs the filter

    handlers = logging.getLogger().handlers
    assert handlers, "root logger has no handlers; the filter has nowhere to live"
    filters = [f for h in handlers for f in h.filters]
    assert filters, "no filter on any root handler — CWE-117 defence is gone"
    return filters


def _log_through(root_filters, logger: logging.Logger, template: str, *args) -> str:
    capture = _Capture()
    capture.setFormatter(logging.Formatter("%(message)s"))
    for f in root_filters:
        capture.addFilter(f)
    root = logging.getLogger()
    root.addHandler(capture)
    try:
        logger.warning(template, *args)
    finally:
        root.removeHandler(capture)
    assert capture.messages, "record did not reach the root handlers"
    return capture.messages[-1]


@pytest.mark.parametrize(
    "module",
    ["api.frap_targets", "api.routes"],
)
def test_child_module_loggers_cannot_forge_a_log_line(root_filters, module):
    """A newline in an interpolated value must not become a new log record."""
    import importlib

    mod = importlib.import_module(module)
    forged = "benign\r\n2026-01-01 CRITICAL forged entry"
    out = _log_through(root_filters, mod.logger, "prefix: %s", forged)

    assert "\n" not in out and "\r" not in out, (
        f"{module} can forge log lines: {out!r}"
    )
    # Escaped, not dropped — the operator still sees what was attempted.
    assert "\\r\\n" in out
    assert "forged entry" in out


def test_the_filter_is_on_the_handlers_not_the_root_logger(root_filters):
    """Records from child loggers bypass the root LOGGER's filters entirely.

    Putting the filter on `logging.getLogger()` instead of on its handlers looks
    equivalent and silently protects nothing, which is why api.main says so at
    the attachment site.
    """
    import api.main  # noqa: F401

    root = logging.getLogger()
    on_handlers = [f for h in root.handlers for f in h.filters]
    assert on_handlers, "filter must live on the handlers"


def test_a_clean_message_is_left_alone(root_filters):
    """The filter must not mangle ordinary messages."""
    logger = logging.getLogger("api.frap_targets")
    out = _log_through(root_filters, logger, "%d spots in %.2fs", 7, 1.5)
    assert out == "7 spots in 1.50s"
