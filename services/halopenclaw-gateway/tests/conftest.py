"""Shared pytest bootstrap for the halopenclaw-gateway suite.

Ensures the gateway package root is on ``sys.path`` regardless of the
invocation CWD so tests can do ``from agents._protocol import ...``
without relying on pytest's rootdir inference.
"""
from __future__ import annotations

import sys
from pathlib import Path

_GATEWAY = Path(__file__).resolve().parent.parent
if str(_GATEWAY) not in sys.path:
    sys.path.insert(0, str(_GATEWAY))
