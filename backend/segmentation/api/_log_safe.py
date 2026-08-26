"""One way to put an untrusted value into a log line (CWE-117).

A log file is parsed line by line, by humans and by whatever ships it. Any
value that reaches a log record from outside this process -- an uploaded
filename, a form field, the text of an exception raised by a library over
attacker-supplied bytes -- can contain a newline, and a newline is a *record
separator*. One CR/LF in a filename is one forged log line: an attacker writes
their own timestamp, level and message and it is indistinguishable from ours.
Carriage return alone is worse in a terminal, where it overwrites the line that
was already printed.

WHERE THIS SITS RELATIVE TO ``_NoCRLFLogFilter`` (api/main.py). That filter is
the backstop and stays the primary defence: it is attached to the ROOT
HANDLERS, so it catches every record from every module -- including the call
sites nobody remembered to scrub. It has two limits. It is a *runtime* object,
so no static analysis can see it, which is why ``py/log-injection`` stays open
on call sites it already protects (``tests/test_log_forging_filter.py`` is the
only thing tying that alert and that defence together). And it looks for CR and
LF only, so an ESC or a NUL still reaches the terminal. ``scrub`` closes both
gaps at the call site: it puts the sanitisation *on the value*, where an
analyser and a reader can both see it, and it covers the remaining control
characters.

It escapes the way the filter escapes -- CR to a literal backslash-r, LF to a
literal backslash-n -- so a value sanitised here and a value caught by the
backstop render identically, and neither loses the evidence that a newline was
attempted.

``scrub`` exists as one function rather than a ``.replace()`` at each call site
so that the definition of "safe to log" is one thing to read, one thing to test
and one thing to change -- and so a grep for it lists every place a tainted
value reaches a logger.

What it does NOT do: escape for HTML, or redact anything sensitive. It makes a
value safe to put on ONE log line; that is all.
"""

from __future__ import annotations

import re

# Every C0 control character plus DEL, and the C1 range that terminals also act
# on. Tab is deliberately excluded: it is not a record separator and it is what
# aligns tabular debug output.
_UNSAFE = re.compile(r"[\x00-\x08\x0a-\x1f\x7f-\x9f]")

# Rendered forms for the two that matter, matching api.main's _NoCRLFLogFilter.
# Anything else becomes a \xNN escape, which is unambiguous and stays on one
# line. These values are two characters each: a backslash and a letter.
_NAMED = {"\r": "\\r", "\n": "\\n"}

# A single field should never be able to push the rest of a line off the screen
# (or fill a disk). 512 characters is far more than any name, channel or
# exception summary this project logs and still bounds one field's contribution.
_MAX_LEN = 512


def _escape(match: "re.Match[str]") -> str:
    ch = match.group(0)
    return _NAMED.get(ch) or f"\\x{ord(ch):02x}"


def scrub(value: object) -> str:
    r"""Render ``value`` as a single-line, control-character-free log token.

    Accepts anything: non-strings are ``str()``-ed first, so a number, a shape
    tuple or an exception object can be passed straight through without the
    call site having to decide. Always returns a ``str``, so call sites use
    ``%s`` for every scrubbed argument -- pre-format numbers (``f"{x:.5g}"``)
    before scrubbing if the log line wants a particular precision.

    These examples are the specification, and ``python -m doctest _log_safe.py``
    is what checks it. Each pins a different part of the implementation, so
    weakening any of them shows up here rather than in a log file.

    An ordinary value is untouched:

    >>> scrub("well_A1.nd2")
    'well_A1.nd2'

    A newline -- the character that forges a log RECORD -- is escaped rather
    than dropped, so the operator still sees what was attempted, and the forged
    text stays on the line it was smuggled into:

    >>> scrub("ok\r\n2026-01-01 ERROR forged line")
    'ok\\r\\n2026-01-01 ERROR forged line'

    So does every other C0 control and DEL (here NUL, ESC and BEL), which
    cannot forge a record but can repaint or hide part of the line:

    >>> scrub("a\x00b\x1bc\x07d")
    'a\\x00b\\x1bc\\x07d'

    Tab survives, because it separates columns rather than records:

    >>> scrub("a\tb")
    'a\tb'

    Non-strings are accepted so a call site never has to str() first:

    >>> scrub(7), scrub((3, 4)), scrub(None)
    ('7', '(3, 4)', 'None')

    And one field cannot swamp the line:

    >>> len(scrub("x" * 10_000))
    526
    """
    text = value if isinstance(value, str) else str(value)
    # The two explicit replaces are covered by the character class below and so
    # are functionally redundant. They are written out anyway because "replace
    # CR and LF with str.replace" is the shape static analysers recognise as
    # the fix for CWE-117; the regex then covers the control characters they do
    # not look for. Removing them silently costs the recognition, not the
    # safety.
    text = text.replace("\r", "\\r").replace("\n", "\\n")
    text = _UNSAFE.sub(_escape, text)
    if len(text) > _MAX_LEN:
        text = text[:_MAX_LEN] + "...[truncated]"
    return text
