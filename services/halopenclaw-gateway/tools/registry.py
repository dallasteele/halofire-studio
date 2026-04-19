"""Tool registry for the halopenclaw gateway.

Mirrors the OpenClaw pattern used for Unreal Engine tools: each tool is
a class with name + description + input schema + invoke(args) → str.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Awaitable, Callable


@dataclass
class Tool:
    name: str
    description: str
    input_schema: dict[str, Any]
    invoke: Callable[[dict[str, Any]], Awaitable[str]]


TOOLS: dict[str, Tool] = {}


def register(tool: Tool) -> None:
    TOOLS[tool.name] = tool


# Eager-load all tool modules so they register themselves on import.
# The imports below are side-effecting.
from . import validate_nfpa13 as _v  # noqa: E402,F401
from . import ingest_pdf as _i  # noqa: E402,F401
from . import place_head as _p  # noqa: E402,F401
from . import route_pipe as _r  # noqa: E402,F401
from . import calc_hydraulic as _c  # noqa: E402,F401
from . import export_pdf as _e  # noqa: E402,F401
from . import ai_intake as _ai  # noqa: E402,F401
from . import ai_pipeline as _aip  # noqa: E402,F401
from . import ai_quickbid as _aiq  # noqa: E402,F401
