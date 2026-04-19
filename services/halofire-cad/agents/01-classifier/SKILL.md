---
name: halofire-classifier
description: Assign NFPA 13 hazard class (light / ordinary_i / ordinary_ii / extra_i / extra_ii / residential) to every Room in a Building, using occupancy/use-class mapping plus LLM fallback for ambiguous rooms.
inputs: [Building]
outputs: [Building with Room.hazard_class populated]
model: haiku (rule-based), sonnet (LLM fallback), opus (escalation)
---

# Classifier Agent

## Why this matters

Every downstream agent (placer, router, hydraulic) needs correct hazard
classes. NFPA 13 §4.3 defines 6 classes that drive:
- Head spacing (§11.2.3.1) — light=225 sqft, ordinary=130, extra I=100, extra II=90
- Sprinkler K-factor selection (§11.2.6) — light/ord = K5.6; extra = K8.0+
- Pipe sizing (§28.5 pipe-schedule + §28.6 density-area) both key off hazard
- Sprinkler temp rating (§8.3) — kitchen/boiler need intermediate/high

## Algorithm

1. **Normalize use_class** — lowercase, strip punctuation, map
   synonyms (apartment → dwelling_unit, mech → mechanical_room)
2. **Rule-based lookup** in `rules/nfpa13_hazard_map.yaml` — if found,
   return immediately with confidence 1.0
3. **Size heuristics** — a room labeled "storage" is ordinary_ii if
   area > 300 sqft + ceiling > 12 ft, else ordinary_i
4. **Adjacency hints** — a room next to a parking_garage probably IS
   garage (reader misclassified)
5. **Claude Sonnet fallback** — only for rooms with no rule match:
   input = room name + adjacent rooms + area + ceiling height;
   output = hazard class with rationale
6. **Opus escalation** — only when Sonnet returns low confidence
   (<0.7) or when the room is flagged "high-risk" (flammable
   storage, industrial)

## Performance

- Rule-based hits: ~100 μs/room
- Sonnet LLM: ~400 ms/room (only for unclassified)
- Target: 200-room building classified in <30 seconds

## Output

Modifies each Room.hazard_class in place. Writes classifier rationale
to `room.userData.classifier_source` = rule | sonnet | opus.
