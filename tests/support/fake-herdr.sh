#!/bin/sh
# Test double for the herdr CLI: logs argv to $FAKE_HERDR_LOG, prints
# $FAKE_HERDR_OUT on stdout and $FAKE_HERDR_ERR on stderr.
printf '%s\n' "$*" >> "$FAKE_HERDR_LOG"
printf '%s' "$FAKE_HERDR_OUT"
printf '%s' "${FAKE_HERDR_ERR:-}" >&2
exit "${FAKE_HERDR_EXIT:-0}"
