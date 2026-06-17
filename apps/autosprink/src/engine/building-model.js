import { z } from 'zod';

const PROVENANCE_SOURCES = [
  'plan-extract',
  'structure-from-plan',
  'door-extractor',
  'zone-classifier',
  'sam3',
  'manual',
];

const POINT_SCHEMA = z.tuple([z.number().finite(), z.number().finite()]);

const ProvenanceSchema = z.object({
  source: z.enum(PROVENANCE_SOURCES),
  confidence: z.number().min(0).max(1),
  needsVerification: z.boolean(),
}).strict();

const ShellSchema = z.object({
  outline: z.array(POINT_SCHEMA),
  heightFt: z.number().finite().nonnegative(),
  provenance: ProvenanceSchema,
}).strict();

const WallRunSchema = z.object({
  id: z.string().min(1),
  a: POINT_SCHEMA,
  b: POINT_SCHEMA,
  thicknessFt: z.number().finite().positive(),
  heightFt: z.number().finite().positive(),
  zoneId: z.string().min(1).optional(),
  provenance: ProvenanceSchema,
}).strict();

const ColumnSchema = z.object({
  id: z.string().min(1),
  x: z.number().finite(),
  y: z.number().finite(),
  sizeFt: z.number().finite().positive(),
  gridLabel: z.string().min(1).optional(),
  provenance: ProvenanceSchema,
}).strict();

const DoorSchema = z.object({
  id: z.string().min(1),
  wallId: z.string().min(1),
  position: POINT_SCHEMA,
  widthFt: z.number().finite().positive(),
  swingDir: z.enum(['in', 'out']),
  hingeSide: z.enum(['left', 'right']),
  provenance: ProvenanceSchema,
}).strict();

const OpeningSchema = z.object({
  id: z.string().min(1),
  wallId: z.string().min(1),
  position: POINT_SCHEMA,
  widthFt: z.number().finite().positive(),
  heightFt: z.number().finite().positive(),
  kind: z.enum(['window', 'pass-through']),
  provenance: ProvenanceSchema,
}).strict();

const RoomSchema = z.object({
  id: z.string().min(1),
  polygon: z.array(POINT_SCHEMA),
  kind: z.string().min(1),
  label: z.string().min(1).optional(),
  areaSqft: z.number().finite().nonnegative(),
  zoneId: z.string().min(1).optional(),
  provenance: ProvenanceSchema,
}).strict();

const ZoneSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['parking', 'lobby', 'unit', 'corridor', 'stair', 'mech', 'storage', 'restroom', 'other']),
  polygon: z.array(POINT_SCHEMA),
  provenance: ProvenanceSchema,
}).strict();

const StairSchema = z.object({
  id: z.string().min(1),
  polygon: z.array(POINT_SCHEMA),
  kind: z.enum(['open', 'enclosed']),
  floors: z.number().int().positive(),
  provenance: ProvenanceSchema,
}).strict();

const MetaSchema = z.object({
  sourceSheet: z.string(),
  scaleFtPerUnit: z.number().finite().positive(),
  scaleText: z.string(),
  generatedAt: z.string(),
}).strict();

const ELEMENT_KEYS = ['shell', 'walls', 'columns', 'doors', 'openings', 'rooms', 'zones', 'stairs'];

function addIssue(ctx, path, message) {
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path,
    message,
  });
}

export const BuildingModelSchema = z.object({
  shell: ShellSchema,
  walls: z.array(WallRunSchema),
  columns: z.array(ColumnSchema),
  doors: z.array(DoorSchema),
  openings: z.array(OpeningSchema),
  rooms: z.array(RoomSchema),
  zones: z.array(ZoneSchema),
  stairs: z.array(StairSchema),
  meta: MetaSchema,
}).strict().superRefine((model, ctx) => {
  for (const key of ELEMENT_KEYS) {
    const value = model[key];
    if (Array.isArray(value)) {
      value.forEach((element, index) => {
        if (!element || typeof element !== 'object' || !('provenance' in element)) {
          addIssue(ctx, [key, index, 'provenance'], `${key}[${index}] is missing provenance`);
        }
      });
      continue;
    }
    if (!value || typeof value !== 'object' || !('provenance' in value)) {
      addIssue(ctx, [key, 'provenance'], `${key} is missing provenance`);
    }
  }

  const wallIds = new Set(model.walls.map((wall) => wall.id));
  model.doors.forEach((door, index) => {
    if (!wallIds.has(door.wallId)) {
      addIssue(ctx, ['doors', index, 'wallId'], `Door ${door.id} references unknown wallId ${door.wallId}`);
    }
  });
  model.openings.forEach((opening, index) => {
    if (!wallIds.has(opening.wallId)) {
      addIssue(ctx, ['openings', index, 'wallId'], `Opening ${opening.id} references unknown wallId ${opening.wallId}`);
    }
  });

  if (model.zones.length > 0) {
    const zoneIds = new Set(model.zones.map((zone) => zone.id));
    model.rooms.forEach((room, index) => {
      if (!room.zoneId) {
        addIssue(ctx, ['rooms', index, 'zoneId'], `Room ${room.id} must reference a zone when zones are present`);
      } else if (!zoneIds.has(room.zoneId)) {
        addIssue(ctx, ['rooms', index, 'zoneId'], `Room ${room.id} references unknown zoneId ${room.zoneId}`);
      }
    });
  }
});

const DEFAULT_PROVENANCE = Object.freeze({
  source: 'manual',
  confidence: 0,
  needsVerification: true,
});

const DEFAULT_BUILDING_MODEL = Object.freeze({
  shell: {
    outline: [],
    heightFt: 0,
    provenance: DEFAULT_PROVENANCE,
  },
  walls: [],
  columns: [],
  doors: [],
  openings: [],
  rooms: [],
  zones: [],
  stairs: [],
  meta: {
    sourceSheet: '',
    scaleFtPerUnit: 1,
    scaleText: '',
    generatedAt: '',
  },
});

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (isPlainObject(value)) {
    const out = {};
    for (const [key, child] of Object.entries(value)) out[key] = cloneValue(child);
    return out;
  }
  return value;
}

function mergeArrayById(base, patch) {
  const seeded = Array.isArray(base) ? base.map(cloneValue) : [];
  const indexById = new Map();
  seeded.forEach((item, index) => {
    if (isPlainObject(item) && typeof item.id === 'string' && item.id.length > 0) {
      indexById.set(item.id, index);
    }
  });
  for (const item of patch) {
    if (isPlainObject(item) && typeof item.id === 'string' && indexById.has(item.id)) {
      const index = indexById.get(item.id);
      seeded[index] = mergeValues(seeded[index], item);
    } else {
      seeded.push(cloneValue(item));
      if (isPlainObject(item) && typeof item.id === 'string' && item.id.length > 0) {
        indexById.set(item.id, seeded.length - 1);
      }
    }
  }
  return seeded;
}

function mergeValues(base, patch) {
  if (patch === undefined) return cloneValue(base);
  if (Array.isArray(base) && Array.isArray(patch)) return mergeArrayById(base, patch);
  if (isPlainObject(base) && isPlainObject(patch)) {
    const out = cloneValue(base);
    for (const [key, value] of Object.entries(patch)) {
      out[key] = key in out ? mergeValues(out[key], value) : cloneValue(value);
    }
    return out;
  }
  return cloneValue(patch);
}

export function validateBuildingModel(model) {
  return BuildingModelSchema.parse(model);
}

export function createBuildingModel(seed = {}) {
  return validateBuildingModel(mergeValues(DEFAULT_BUILDING_MODEL, seed));
}

export function mergeIntoModel(model, patch = {}) {
  return validateBuildingModel(mergeValues(validateBuildingModel(model), patch));
}

export function normalizeBuilding() {
  throw new Error('normalizeBuilding was replaced by createBuildingModel/validateBuildingModel for the canonical BuildingModel schema');
}

export function buildingFromFloorPlan() {
  throw new Error('buildingFromFloorPlan was removed from building-model.js; write canonical BuildingModel data instead');
}
