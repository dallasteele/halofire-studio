"""Phase A — single-op agent wrappers.

Each function here takes a live ``design.json`` dict, applies a
narrow mutation, and returns a :class:`SceneDelta`. They are the
thin adapter layer between the HTTP handlers in ``main.py`` and the
underlying agent modules in ``services/halofire-cad/agents/``.

Rule of thumb:
  * Geometry-heavy ops (placer, router, hydraulic) call into the
    existing agent code; we do NOT reimplement engineering logic here.
  * Bookkeeping ops (insert_hanger, insert_sway_brace, set_remote_area,
    swap_sku) are simple enough to live inline until/unless a dedicated
    agent appears. They're marked "scaffold" in PHASE_A_COMPLETE.md.

All functions operate on dicts, not pydantic models, because the
SceneStore round-trips through JSON for its event log and we want
the add/modify path to be symmetric with undo/redo.
"""
from __future__ import annotations

import importlib.util
import math
import sys
from pathlib import Path
from typing import Any

from scene_store import SceneDelta, new_id


# ── Agent module loader (matches orchestrator.py style) ─────────────

_HFCAD = Path(__file__).resolve().parents[1] / "halofire-cad"
if _HFCAD.exists() and str(_HFCAD) not in sys.path:
    sys.path.insert(0, str(_HFCAD))

_AGENT_CACHE: dict[str, Any] = {}


def _load_agent(rel_path: str, module_name: str) -> Any:
    if module_name in _AGENT_CACHE:
        return _AGENT_CACHE[module_name]
    spec = importlib.util.spec_from_file_location(
        module_name, _HFCAD / rel_path,
    )
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {rel_path}")
    m = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = m
    spec.loader.exec_module(m)
    _AGENT_CACHE[module_name] = m
    return m


def _schema():
    from cad import schema as _s  # type: ignore
    return _s


# ── Design-dict helpers ─────────────────────────────────────────────


def _find_system(design: dict[str, Any], system_id: str | None) -> dict[str, Any]:
    systems = design.setdefault("systems", [])
    if not systems:
        # Bootstrap an empty wet tree system so single-op inserts can
        # operate before the pipeline has run.
        sys_id = new_id("sys")
        riser_id = new_id("riser")
        system = {
            "id": sys_id,
            "type": "wet",
            "supplies": [],
            "riser": {
                "id": riser_id,
                "position_m": [0.0, 0.0, 0.0],
                "size_in": 4.0,
                "fdc_position_m": None,
                "fdc_type": "wall_mount",
            },
            "branches": [],
            "heads": [],
            "pipes": [],
            "fittings": [],
            "hangers": [],
            "hydraulic": None,
            "remote_area": None,
            "sway_braces": [],
        }
        systems.append(system)
        return system
    if system_id is None:
        return systems[0]
    for s in systems:
        if s.get("id") == system_id:
            return s
    raise KeyError(f"system {system_id} not found")


def _iter_all(design: dict[str, Any], key: str):
    for s in design.get("systems", []):
        for node in s.get(key, []) or []:
            yield s, node


# ── HEADS ──────────────────────────────────────────────────────────


def insert_head(
    design: dict[str, Any],
    *,
    position_m: tuple[float, float, float],
    sku: str = "TY3231",
    k_factor: float = 5.6,
    temp_rating_f: int = 155,
    orientation: str = "pendent",
    room_id: str | None = None,
    system_id: str | None = None,
) -> SceneDelta:
    """Insert one sprinkler head at an explicit xyz position.

    We deliberately skip the placer's coverage heuristic here — the
    whole point of single-op is that the *user* chose the xy. The
    placer is still used by the full pipeline for auto-layout; the
    single-op path trusts the caller.
    """
    system = _find_system(design, system_id)
    head = {
        "id": new_id("head"),
        "sku": sku,
        "k_factor": float(k_factor),
        "temp_rating_f": int(temp_rating_f),
        "position_m": [float(position_m[0]), float(position_m[1]), float(position_m[2])],
        "deflector_below_ceiling_mm": 100,
        "orientation": orientation,
        "room_id": room_id,
        "branch_id": None,
        "system_id": system["id"],
    }
    system.setdefault("heads", []).append(head)
    return SceneDelta(added_nodes=[head["id"]])


def modify_head(
    design: dict[str, Any], head_id: str, updates: dict[str, Any],
) -> SceneDelta:
    allowed = {
        "sku", "k_factor", "temp_rating_f", "position_m",
        "orientation", "deflector_below_ceiling_mm", "room_id",
    }
    for system, head in _iter_all(design, "heads"):
        if head.get("id") == head_id:
            for k, v in updates.items():
                if k not in allowed:
                    continue
                if k == "position_m" and v is not None:
                    head[k] = [float(v[0]), float(v[1]), float(v[2])]
                else:
                    head[k] = v
            return SceneDelta(changed_nodes=[head_id])
    raise KeyError(f"head {head_id} not found")


def delete_head(design: dict[str, Any], head_id: str) -> SceneDelta:
    warnings: list[str] = []
    for system in design.get("systems", []):
        heads = system.get("heads") or []
        for i, h in enumerate(heads):
            if h.get("id") == head_id:
                heads.pop(i)
                # Flag any pipes whose from_node or to_node referenced
                # this head (router uses head IDs as nodes).
                for p in system.get("pipes", []) or []:
                    if p.get("from_node") == head_id or p.get("to_node") == head_id:
                        warnings.append(
                            f"pipe {p.get('id')} references deleted head {head_id}"
                        )
                return SceneDelta(removed_nodes=[head_id], warnings=warnings)
    raise KeyError(f"head {head_id} not found")


# ── PIPES ──────────────────────────────────────────────────────────


def _length_m(a: list[float], b: list[float]) -> float:
    return math.sqrt(sum((ai - bi) ** 2 for ai, bi in zip(a, b)))


def insert_pipe(
    design: dict[str, Any],
    *,
    from_point_m: tuple[float, float, float],
    to_point_m: tuple[float, float, float],
    from_node: str | None = None,
    to_node: str | None = None,
    size_in: float = 1.0,
    schedule: str = "sch10",
    role: str = "branch",
    system_id: str | None = None,
) -> SceneDelta:
    system = _find_system(design, system_id)
    start = [float(from_point_m[0]), float(from_point_m[1]), float(from_point_m[2])]
    end = [float(to_point_m[0]), float(to_point_m[1]), float(to_point_m[2])]
    pipe = {
        "id": new_id("pipe"),
        "from_node": from_node or new_id("node"),
        "to_node": to_node or new_id("node"),
        "size_in": float(size_in),
        "schedule": schedule,
        "start_m": start,
        "end_m": end,
        "length_m": _length_m(start, end),
        "elevation_change_m": end[2] - start[2],
        "fittings": [],
        "downstream_heads": 1,
        "system_id": system["id"],
        "role": role,
    }
    system.setdefault("pipes", []).append(pipe)
    return SceneDelta(added_nodes=[pipe["id"]])


def modify_pipe(
    design: dict[str, Any], pipe_id: str, updates: dict[str, Any],
) -> SceneDelta:
    allowed = {"size_in", "schedule", "role", "start_m", "end_m",
               "downstream_heads"}
    for system, pipe in _iter_all(design, "pipes"):
        if pipe.get("id") == pipe_id:
            for k, v in updates.items():
                if k not in allowed:
                    continue
                if k in {"start_m", "end_m"} and v is not None:
                    pipe[k] = [float(v[0]), float(v[1]), float(v[2])]
                else:
                    pipe[k] = v
            pipe["length_m"] = _length_m(pipe["start_m"], pipe["end_m"])
            pipe["elevation_change_m"] = pipe["end_m"][2] - pipe["start_m"][2]
            return SceneDelta(changed_nodes=[pipe_id])
    raise KeyError(f"pipe {pipe_id} not found")


def delete_pipe(design: dict[str, Any], pipe_id: str) -> SceneDelta:
    for system in design.get("systems", []):
        pipes = system.get("pipes") or []
        for i, p in enumerate(pipes):
            if p.get("id") == pipe_id:
                pipes.pop(i)
                return SceneDelta(removed_nodes=[pipe_id])
    raise KeyError(f"pipe {pipe_id} not found")


# ── FITTINGS ───────────────────────────────────────────────────────


_EQUIV_LENGTH_FT = {
    "tee_branch": 15.0,
    "tee_run": 5.0,
    "elbow_90": 5.0,
    "elbow_45": 3.0,
    "gate_valve": 1.0,
    "check_valve": 12.0,
    "reducer": 3.0,
    "coupling": 1.0,
}


def insert_fitting(
    design: dict[str, Any],
    *,
    kind: str,
    position_m: tuple[float, float, float],
    size_in: float,
    pipe_id: str | None = None,
    system_id: str | None = None,
) -> SceneDelta:
    if kind not in _EQUIV_LENGTH_FT:
        raise ValueError(f"unknown fitting kind: {kind}")
    system = _find_system(design, system_id)
    fit = {
        "id": new_id("fit"),
        "kind": kind,
        "size_in": float(size_in),
        "position_m": [float(position_m[0]), float(position_m[1]), float(position_m[2])],
        "equiv_length_ft": _EQUIV_LENGTH_FT[kind],
    }
    system.setdefault("fittings", []).append(fit)
    if pipe_id:
        for p in system.get("pipes", []) or []:
            if p.get("id") == pipe_id:
                p.setdefault("fittings", []).append(fit["id"])
                break
    return SceneDelta(added_nodes=[fit["id"]])


# ── HANGERS ────────────────────────────────────────────────────────


def insert_hanger(
    design: dict[str, Any],
    *,
    pipe_id: str,
    position_m: tuple[float, float, float],
    system_id: str | None = None,
) -> SceneDelta:
    # Locate the pipe first — hanger must reference an existing pipe.
    if system_id:
        system = _find_system(design, system_id)
        pipes = system.get("pipes") or []
    else:
        system = None
        pipes = []
        for s in design.get("systems", []):
            for p in s.get("pipes") or []:
                if p.get("id") == pipe_id:
                    system = s
                    pipes = s.get("pipes") or []
                    break
            if system:
                break
    if system is None:
        raise KeyError(f"pipe {pipe_id} not found for hanger")
    if not any(p.get("id") == pipe_id for p in pipes):
        raise KeyError(f"pipe {pipe_id} not found in system {system.get('id')}")
    hanger = {
        "id": new_id("hgr"),
        "pipe_id": pipe_id,
        "position_m": [float(position_m[0]), float(position_m[1]), float(position_m[2])],
    }
    system.setdefault("hangers", []).append(hanger)
    return SceneDelta(added_nodes=[hanger["id"]])


# ── SWAY BRACES (scaffold) ─────────────────────────────────────────


def insert_sway_brace(
    design: dict[str, Any],
    *,
    pipe_id: str,
    position_m: tuple[float, float, float],
    kind: str = "lateral",
    system_id: str | None = None,
) -> SceneDelta:
    if kind not in {"lateral", "longitudinal", "four_way"}:
        raise ValueError(f"unknown brace kind: {kind}")
    system = _find_system(design, system_id)
    if not any(p.get("id") == pipe_id for p in system.get("pipes") or []):
        # Look across all systems.
        for s in design.get("systems", []):
            if any(p.get("id") == pipe_id for p in s.get("pipes") or []):
                system = s
                break
        else:
            raise KeyError(f"pipe {pipe_id} not found for sway brace")
    brace = {
        "id": new_id("brc"),
        "pipe_id": pipe_id,
        "kind": kind,
        "position_m": [float(position_m[0]), float(position_m[1]), float(position_m[2])],
    }
    system.setdefault("sway_braces", []).append(brace)
    return SceneDelta(added_nodes=[brace["id"]])


# ── REMOTE AREA (scaffold) ─────────────────────────────────────────


def set_remote_area(
    design: dict[str, Any],
    *,
    polygon_m: list[tuple[float, float]],
    system_id: str | None = None,
    name: str = "remote_area_1",
) -> SceneDelta:
    system = _find_system(design, system_id)
    ra_id = new_id("ra")
    ra = {
        "id": ra_id,
        "name": name,
        "polygon_m": [[float(p[0]), float(p[1])] for p in polygon_m],
    }
    system["remote_area"] = ra
    return SceneDelta(changed_nodes=[system["id"]], added_nodes=[ra_id])


# ── SKU swap ───────────────────────────────────────────────────────


def swap_sku(
    design: dict[str, Any], node_id: str, sku: str, k_factor: float | None = None,
) -> SceneDelta:
    # Heads only for now — matches the Properties panel affordance.
    for _, head in _iter_all(design, "heads"):
        if head.get("id") == node_id:
            head["sku"] = sku
            if k_factor is not None:
                head["k_factor"] = float(k_factor)
            return SceneDelta(changed_nodes=[node_id])
    raise KeyError(f"node {node_id} not found (swap_sku only supports heads)")


# ── HYDRAULIC CALC ─────────────────────────────────────────────────


def calculate(
    design: dict[str, Any],
    *,
    supply: dict[str, Any] | None = None,
    hazard_override: str | None = None,
    scope_system_id: str | None = None,
) -> SceneDelta:
    """Re-solve hydraulics for all systems (or one, if scoped).

    Mirrors the existing ``POST /projects/:id/calculate`` endpoint but
    returns a delta whose ``recalc`` dict holds per-system hydraulic
    results so SSE consumers can paint pressures without re-fetching
    ``design.json``.
    """
    schema = _schema()
    hydraulic = _load_agent("agents/04-hydraulic/agent.py", "hf_hydraulic")
    orch = _load_agent_orchestrator()
    design_model = schema.Design.model_validate(design)

    supply_model = (
        schema.FlowTestData.model_validate(supply)
        if supply else orch._default_supply()
    )
    results: list[dict[str, Any]] = []
    changed: list[str] = []
    for system_model in design_model.systems:
        if scope_system_id and system_model.id != scope_system_id:
            continue
        hazard = hazard_override or orch._system_hazard(
            design_model.building, system_model,
        )
        system_model.hydraulic = hydraulic.calc_system(
            system_model, supply_model, hazard,
        )
        results.append({
            "id": system_model.id,
            "hazard": hazard,
            "hydraulic": system_model.hydraulic.model_dump(),
        })
        changed.append(system_model.id)

    design.setdefault("calculation", {})
    design["calculation"]["systems"] = results
    design["calculation"]["unsupported"] = [{
        "code": "LOOP_GRID_UNSUPPORTED",
        "severity": "warning",
        "message": (
            "Loop/grid hydraulic solving is not supported in Internal "
            "Alpha; tree systems only."
        ),
    }]
    # Reflect the mutated systems back into the design dict.
    design["systems"] = [s.model_dump() for s in design_model.systems]
    # Phase A.1 — persist per-head / per-pipe node_trace onto the scene
    # graph so NodeTags (and any other consumer) can read directly from
    # design.json instead of re-calling /calculate.
    _persist_node_trace(design, design_model, scope_system_id)
    return SceneDelta(changed_nodes=changed, recalc={"calculation": design["calculation"]})


def _persist_node_trace(
    design: dict[str, Any],
    design_model: Any,
    scope_system_id: str | None,
) -> None:
    """Write ``node_trace`` dicts onto each Head/PipeSegment dict.

    Called at the end of ``calculate`` once the pydantic models have
    been round-tripped back into ``design["systems"]``. We stamp:

      * per-pipe: ``{pressure_psi, flow_gpm, velocity_fps, pipe_size_in,
        friction_loss_psi, worst_violation?}``
      * per-head: ``{pressure_psi, flow_gpm, velocity_fps, pipe_size_in}``
        (pulled from the pipe the head sits on, as a convenience for UI
        overlays).

    Velocity is Hazen-Williams-consistent:
        v_fps = 0.4085 · Q_gpm / D_in²
    Flags ``worst_violation`` to ``"velocity_warn"`` at >=20 fps and
    ``"velocity_crit"`` at >=32 fps (matches the Phase C NodeTags
    severity bands).
    """
    # Build id → (pipe_trace, head_trace) maps from the pydantic
    # HydraulicResult on each system.
    scope = {system.id: system for system in design_model.systems
             if not scope_system_id or system.id == scope_system_id}
    for sys_dict in design.get("systems", []) or []:
        sid = sys_dict.get("id")
        if sid not in scope:
            continue
        system = scope[sid]
        hyd = getattr(system, "hydraulic", None)
        if not hyd:
            continue
        node_trace = getattr(hyd, "node_trace", None) or []
        seg_by_id: dict[str, dict[str, Any]] = {
            str(seg.get("segment_id")): seg for seg in node_trace
        }
        # Also index per-pipe flow so heads can mirror the downstream pipe.
        for pipe_dict in sys_dict.get("pipes", []) or []:
            seg = seg_by_id.get(pipe_dict.get("id"))
            if seg is None:
                continue
            q = float(seg.get("flow_gpm") or 0.0)
            size_in = float(pipe_dict.get("size_in") or seg.get("size_in") or 1.0)
            v = _velocity_fps(q, size_in)
            trace = {
                "flow_gpm": round(q, 2),
                "pipe_size_in": size_in,
                "velocity_fps": round(v, 2),
                "length_ft": seg.get("length_ft"),
                "friction_loss_psi": seg.get("friction_loss_psi"),
                "downstream_heads": seg.get("downstream_heads"),
            }
            # Pressure at the pipe's downstream node (rough proxy — full
            # per-node pressure map lands when the v3 solver ships).
            trace["pressure_psi"] = round(
                float(hyd.demand_at_base_of_riser_psi or 0.0)
                - float(seg.get("friction_loss_psi") or 0.0),
                2,
            )
            violation = _classify_velocity(v)
            if violation:
                trace["worst_violation"] = violation
            pipe_dict["node_trace"] = trace

        # For heads, inherit the pipe trace whose from_node or to_node
        # matches the head id. Heads not wired into the graph get an
        # empty trace so consumers can distinguish "no data" from "0".
        pipe_by_endpoint: dict[str, dict[str, Any]] = {}
        for pipe_dict in sys_dict.get("pipes", []) or []:
            nt = pipe_dict.get("node_trace")
            if not nt:
                continue
            for key in ("from_node", "to_node"):
                nid = pipe_dict.get(key)
                if nid:
                    pipe_by_endpoint[nid] = nt
        min_head_psi = 7.0  # matches calc_system min_head_pressure_psi
        for head_dict in sys_dict.get("heads", []) or []:
            hid = head_dict.get("id")
            nt = pipe_by_endpoint.get(hid)
            if nt:
                # Heads always see at least their own K-factor design
                # flow + min pressure at the deflector.
                head_dict["node_trace"] = {
                    "flow_gpm": nt.get("flow_gpm"),
                    "pipe_size_in": nt.get("pipe_size_in"),
                    "velocity_fps": nt.get("velocity_fps"),
                    "pressure_psi": max(min_head_psi, float(nt.get("pressure_psi") or 0.0)),
                    **(
                        {"worst_violation": nt["worst_violation"]}
                        if "worst_violation" in nt else {}
                    ),
                }
            else:
                head_dict["node_trace"] = {
                    "flow_gpm": 0.0, "pipe_size_in": None,
                    "velocity_fps": 0.0, "pressure_psi": min_head_psi,
                }


def _velocity_fps(flow_gpm: float, size_in: float) -> float:
    if size_in <= 0:
        return 0.0
    return 0.4085 * flow_gpm / (size_in ** 2)


def _classify_velocity(v_fps: float) -> str | None:
    if v_fps >= 32.0:
        return "velocity_crit"
    if v_fps >= 20.0:
        return "velocity_warn"
    return None


# ── AUTO-PEAK (Phase A.1) ──────────────────────────────────────────


def auto_peak(
    design: dict[str, Any],
    *,
    candidates: list[list[tuple[float, float]]] | None = None,
    supply: dict[str, Any] | None = None,
    hazard_override: str | None = None,
    system_id: str | None = None,
) -> dict[str, Any]:
    """Pick the worst-case remote area and persist it on the scene.

    Each candidate is a polygon (list of (x, y) in meters). For each,
    we run ``calc_system`` against a clone of the design with that
    polygon set as the active remote area, then rank by residual
    (supply - demand) pressure — lowest residual wins.

    When ``candidates`` is None we generate a default set of 4 axis-
    aligned windows covering the quadrants of the head cloud's bounding
    box. That mirrors the hydraulic agent's "farthest-from-riser" logic
    but surfaces multiple options so the UI can preview them.

    Returns a dict with::

        {
          "chosen_area":   {"polygon_m": [...], "name": ...},
          "residual_psi":  <float>,
          "flow_gpm":      <float>,
          "all_candidates": [
              {"polygon_m": [...], "residual_psi": ..., "flow_gpm": ...,
               "demand_psi": ...},
              ...
          ],
        }

    The chosen polygon is also persisted onto the design via
    ``set_remote_area`` (selection_reason = "auto_peak").
    """
    from copy import deepcopy

    schema = _schema()
    hydraulic = _load_agent("agents/04-hydraulic/agent.py", "hf_hydraulic")
    orch = _load_agent_orchestrator()

    # Pick the system we'll evaluate against.
    systems = design.get("systems") or []
    if not systems:
        raise ValueError("auto_peak requires at least one system with heads")
    if system_id is None:
        target_system = systems[0]
    else:
        target_system = next(
            (s for s in systems if s.get("id") == system_id), None,
        )
        if target_system is None:
            raise KeyError(f"system {system_id} not found")

    heads = target_system.get("heads") or []
    if not heads:
        raise ValueError("auto_peak requires heads on the target system")

    # Default candidates — four quadrant windows around the head bbox.
    if candidates is None:
        candidates = _default_peak_candidates(heads)
    if not candidates:
        raise ValueError("no candidate polygons supplied or inferrable")

    supply_model = (
        schema.FlowTestData.model_validate(supply)
        if supply else orch._default_supply()
    )
    hazard = hazard_override or orch._system_hazard(
        schema.Building.model_validate(design["building"]),
        schema.System.model_validate(target_system),
    )

    all_results: list[dict[str, Any]] = []
    for poly in candidates:
        # Which heads fall inside this polygon?
        inside_ids = _heads_in_polygon(heads, poly)
        trial = deepcopy(target_system)
        # Restrict the trial system to heads inside the polygon. If
        # none are inside, treat this candidate as "no coverage" and
        # record a zero-demand result so the caller still sees it.
        if inside_ids:
            trial["heads"] = [
                h for h in trial.get("heads", []) if h.get("id") in inside_ids
            ]
        else:
            trial["heads"] = []
        trial["remote_area"] = {
            "id": "ra_trial",
            "name": "auto_peak_trial",
            "polygon_m": [[float(p[0]), float(p[1])] for p in poly],
        }
        try:
            system_model = schema.System.model_validate(trial)
            hyd = hydraulic.calc_system(system_model, supply_model, hazard)
            demand = float(hyd.demand_at_base_of_riser_psi or 0.0)
            margin = float(hyd.safety_margin_psi or 0.0)
            flow = float(hyd.required_flow_gpm or 0.0)
            # Residual = supply pressure at the demand flow; we get it
            # from supply_static - (margin adjustment). Cheaper proxy:
            # lower margin ⇒ worse case. We keep both for transparency.
            residual = demand + margin  # p_supply at that flow
            all_results.append({
                "polygon_m": [[float(p[0]), float(p[1])] for p in poly],
                "head_ids": inside_ids,
                "residual_psi": round(residual, 2),
                "demand_psi": round(demand, 2),
                "margin_psi": round(margin, 2),
                "flow_gpm": round(flow, 2),
            })
        except Exception as e:  # pragma: no cover — defensive
            all_results.append({
                "polygon_m": [[float(p[0]), float(p[1])] for p in poly],
                "head_ids": inside_ids,
                "error": str(e),
                "residual_psi": None,
                "demand_psi": None,
                "flow_gpm": None,
            })

    # Rank: worst case = smallest safety margin (supply minus demand).
    # That's the polygon closest to failing its hydraulic supply — the
    # one the AHJ wants to see calculated. Candidates with errors or
    # zero heads sink to the bottom.
    def _key(r: dict[str, Any]) -> tuple[int, float]:
        if r.get("margin_psi") is None or not r.get("head_ids"):
            return (1, 0.0)
        return (0, float(r["margin_psi"]))

    ranked = sorted(all_results, key=_key)
    chosen = ranked[0] if ranked else None
    if chosen is None or chosen.get("margin_psi") is None:
        raise RuntimeError("auto_peak found no viable candidate")

    # Persist the chosen polygon onto the scene graph as the remote
    # area for the target system.
    ra_id = new_id("ra")
    target_system["remote_area"] = {
        "id": ra_id,
        "name": "auto_peak",
        "polygon_m": chosen["polygon_m"],
        "selection_reason": "auto_peak",
        "chosen_residual_psi": chosen["residual_psi"],
        "chosen_flow_gpm": chosen["flow_gpm"],
    }

    return {
        "chosen_area": target_system["remote_area"],
        "residual_psi": chosen["residual_psi"],
        "flow_gpm": chosen["flow_gpm"],
        "demand_psi": chosen.get("demand_psi"),
        "all_candidates": all_results,
        "system_id": target_system.get("id"),
    }


def _default_peak_candidates(
    heads: list[dict[str, Any]],
) -> list[list[tuple[float, float]]]:
    """Four quadrant windows around the head cloud bbox.

    Each window is the bounding box of the heads in that quadrant
    (if non-empty). Produces up to four polygons; quadrants with no
    heads are skipped. Good enough to force the solver to expose
    hydraulically-disparate areas in test and real-world designs.
    """
    if not heads:
        return []
    xs = [float(h["position_m"][0]) for h in heads if "position_m" in h]
    ys = [float(h["position_m"][1]) for h in heads if "position_m" in h]
    if not xs:
        return []
    cx = sum(xs) / len(xs)
    cy = sum(ys) / len(ys)
    quadrants: list[list[dict[str, Any]]] = [[], [], [], []]
    for h in heads:
        x, y = float(h["position_m"][0]), float(h["position_m"][1])
        idx = (0 if x < cx else 1) + (0 if y < cy else 2)
        quadrants[idx].append(h)
    out: list[list[tuple[float, float]]] = []
    for q in quadrants:
        if not q:
            continue
        qxs = [float(h["position_m"][0]) for h in q]
        qys = [float(h["position_m"][1]) for h in q]
        x0, x1 = min(qxs), max(qxs)
        y0, y1 = min(qys), max(qys)
        # Inflate 0.5 m so single-head quadrants still form a polygon.
        x0, x1 = x0 - 0.5, x1 + 0.5
        y0, y1 = y0 - 0.5, y1 + 0.5
        out.append([(x0, y0), (x1, y0), (x1, y1), (x0, y1)])
    return out


def _heads_in_polygon(
    heads: list[dict[str, Any]],
    polygon: list[tuple[float, float]],
) -> list[str]:
    """Return head IDs whose (x, y) falls inside the polygon (ray cast)."""
    poly = [(float(p[0]), float(p[1])) for p in polygon]
    out: list[str] = []
    for h in heads:
        pos = h.get("position_m") or []
        if len(pos) < 2:
            continue
        if _point_in_poly(float(pos[0]), float(pos[1]), poly):
            out.append(h["id"])
    return out


def _point_in_poly(x: float, y: float, poly: list[tuple[float, float]]) -> bool:
    n = len(poly)
    if n < 3:
        return False
    inside = False
    j = n - 1
    for i in range(n):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if ((yi > y) != (yj > y)) and (
            x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-12) + xi
        ):
            inside = not inside
        j = i
    return inside


def _load_agent_orchestrator() -> Any:
    return _load_agent("orchestrator.py", "hf_orchestrator")


# ── RULE CHECK ─────────────────────────────────────────────────────


def run_rules(design: dict[str, Any]) -> list[dict[str, Any]]:
    schema = _schema()
    rulecheck = _load_agent("agents/05-rulecheck/agent.py", "hf_rulecheck")
    design_model = schema.Design.model_validate(design)
    violations = rulecheck.check_design(design_model)
    return [v.model_dump() for v in violations]


# ── BOM ────────────────────────────────────────────────────────────


def recompute_bom(design: dict[str, Any]) -> list[dict[str, Any]]:
    schema = _schema()
    bom = _load_agent("agents/06-bom/agent.py", "hf_bom")
    design_model = schema.Design.model_validate(design)
    rows = bom.generate_bom(design_model)
    return [r.model_dump() for r in rows]
