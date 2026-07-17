const POINT_TOLERANCE_FT = 0.01;
const SYSTEM_TYPES = new Set(['wet', 'dry', 'preaction', 'deluge']);
const PUMP_DECISIONS = new Set(['required', 'not-required', 'unresolved']);

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const finite = (value) => Number.isFinite(Number(value));
const pointReady = (value) => value && finite(value.x) && finite(value.y) && finite(value.z);
const planPoint = (value) => ({ x: Number(value.x), y: Number(value.y) });
const modelPoint = (value) => ({ x: Number(value.x), y: Number(value.y), z: Number(value.z) });

function issue(code, path, message) {
  return { code, path, message };
}

function componentReady(component) {
  return component
    && typeof component.id === 'string'
    && component.id.length > 0
    && pointReady(component.pointFt)
    && component.catalogIdentityReady === true
    && typeof component.sourceRef === 'string'
    && component.sourceRef.length > 0;
}

function validateComponent(component, path, issues, { sizeRequired = false } = {}) {
  if (!component || typeof component.id !== 'string' || !component.id) {
    issues.push(issue('BACKBONE_COMPONENT_ID_REQUIRED', path, `${path} needs a stable component id.`));
    return;
  }
  if (!pointReady(component.pointFt)) {
    issues.push(issue('BACKBONE_COMPONENT_POINT_REQUIRED', `${path}.pointFt`, `${path} needs a finite 3D installation point.`));
  }
  if (sizeRequired && !(Number(component.sizeIn) > 0)) {
    issues.push(issue('BACKBONE_COMPONENT_SIZE_REQUIRED', `${path}.sizeIn`, `${path} needs a positive nominal size.`));
  }
  if (component.catalogIdentityReady !== true || !component.sourceRef) {
    issues.push(issue('BACKBONE_COMPONENT_IDENTITY_REQUIRED', path, `${path} needs a source-bound catalog identity before quote release.`));
  }
}

function validatePath(path, label, issues) {
  if (!Array.isArray(path) || path.length < 2 || path.some((point) => !pointReady(point))) {
    issues.push(issue('BACKBONE_ROUTE_REQUIRED', label, `${label} needs at least two finite 3D points.`));
    return false;
  }
  return true;
}

function routeArtifacts(id, kind, points, ownerSystemId = null) {
  return {
    plan2d: {
      id,
      kind,
      ownerSystemId,
      pointsFt: points.map(planPoint),
    },
    model3d: {
      id,
      kind,
      ownerSystemId,
      pointsFt: points.map(modelPoint),
    },
  };
}

function componentArtifacts(component, kind, ownerSystemId = null) {
  return {
    plan2d: {
      id: component.id,
      kind,
      ownerSystemId,
      pointFt: planPoint(component.pointFt),
      sizeIn: component.sizeIn ?? null,
    },
    model3d: {
      id: component.id,
      kind,
      ownerSystemId,
      pointFt: modelPoint(component.pointFt),
      sizeIn: component.sizeIn ?? null,
    },
  };
}

function pushTakeoff(rows, key, description, quantity, systemIds = []) {
  if (!(quantity > 0)) return;
  rows.push({ key, description, unit: 'EA', quantity, systemIds: [...systemIds] });
}

export function buildSystemBackbone(input) {
  const issues = [];
  const planComponents = [];
  const modelComponents = [];
  const planRoutes = [];
  const modelRoutes = [];
  const takeoff = [];

  if (!input || typeof input !== 'object') {
    return {
      artifactType: 'halofire.system-backbone-design.v1',
      status: 'blocked',
      issues: [issue('BACKBONE_INPUT_REQUIRED', '$', 'A system backbone input is required.')],
      plan2dReady: false,
      model3dReady: false,
      quoteReady: false,
    };
  }

  if (!input.projectId) issues.push(issue('BACKBONE_PROJECT_ID_REQUIRED', 'projectId', 'A project identity is required.'));
  const flowTest = input.waterSupply?.flowTest;
  if (flowTest?.status !== 'current') {
    issues.push(issue('BACKBONE_CURRENT_FLOW_TEST_REQUIRED', 'waterSupply.flowTest', 'Pump and pipe decisions require a current flow test.'));
  } else if (![flowTest.staticPsi, flowTest.residualPsi, flowTest.testFlowGpm].every(finite)) {
    issues.push(issue('BACKBONE_FLOW_TEST_VALUES_REQUIRED', 'waterSupply.flowTest', 'Current flow-test static, residual, and test-flow values are required.'));
  }

  const service = input.service ?? {};
  for (const [name, sizeRequired] of [['entry', true], ['backflow', true], ['fdc', false], ['manifold', true]]) {
    validateComponent(service[name], `service.${name}`, issues, { sizeRequired });
    if (service[name]?.id && pointReady(service[name].pointFt)) {
      const artifacts = componentArtifacts(service[name], name === 'entry' ? 'service-entry' : name);
      planComponents.push(artifacts.plan2d);
      modelComponents.push(artifacts.model3d);
    }
  }

  const pump = input.pump ?? { decision: 'unresolved' };
  if (!PUMP_DECISIONS.has(pump.decision) || pump.decision === 'unresolved') {
    issues.push(issue('BACKBONE_PUMP_DECISION_REQUIRED', 'pump.decision', 'The pump decision must be source-backed as required or not-required.'));
  } else if (pump.decision === 'required') {
    validateComponent(pump, 'pump', issues, { sizeRequired: false });
    if (!(Number(pump.ratedFlowGpm) > 0) || !(Number(pump.ratedPressurePsi) > 0) || !pump.curveSourceRef) {
      issues.push(issue('BACKBONE_PUMP_DUTY_REQUIRED', 'pump', 'A required pump needs rated flow, rated pressure, and a curve source.'));
    }
    if (pump.id && pointReady(pump.pointFt)) {
      const artifacts = componentArtifacts(pump, 'fire-pump');
      planComponents.push(artifacts.plan2d);
      modelComponents.push(artifacts.model3d);
    }
  } else if (!pump.basis) {
    issues.push(issue('BACKBONE_NO_PUMP_BASIS_REQUIRED', 'pump.basis', 'A not-required pump decision needs a hydraulic basis.'));
  }

  const systems = Array.isArray(input.systems) ? input.systems : [];
  if (!systems.length) issues.push(issue('BACKBONE_SYSTEMS_REQUIRED', 'systems', 'At least one designed sprinkler system is required.'));
  const systemIds = systems.map((system) => system?.id).filter(Boolean);
  if (new Set(systemIds).size !== systemIds.length) issues.push(issue('BACKBONE_SYSTEM_IDS_DUPLICATE', 'systems', 'System ids must be unique.'));

  let wetCount = 0;
  let dryCount = 0;
  let preactionCount = 0;
  let delugeCount = 0;
  let auxiliaryDrainCount = 0;

  systems.forEach((system, index) => {
    const base = `systems[${index}]`;
    if (!system?.id) issues.push(issue('BACKBONE_SYSTEM_ID_REQUIRED', `${base}.id`, 'Each system needs a stable id.'));
    if (!SYSTEM_TYPES.has(system?.type)) issues.push(issue('BACKBONE_SYSTEM_TYPE_INVALID', `${base}.type`, 'System type must be wet, dry, preaction, or deluge.'));
    if (!(Number(system?.areaSqft) > 0)) issues.push(issue('BACKBONE_SYSTEM_AREA_REQUIRED', `${base}.areaSqft`, 'Each system needs a positive protected area.'));
    if (system?.type === 'wet') wetCount += 1;
    if (system?.type === 'dry') dryCount += 1;
    if (system?.type === 'preaction') preactionCount += 1;
    if (system?.type === 'deluge') delugeCount += 1;

    validateComponent(system?.riser, `${base}.riser`, issues, { sizeRequired: true });
    validateComponent(system?.controlValve, `${base}.controlValve`, issues, { sizeRequired: true });
    validateComponent(system?.mainDrain, `${base}.mainDrain`, issues, { sizeRequired: true });
    validateComponent(system?.inspectorsTestAndDrain, `${base}.inspectorsTestAndDrain`, issues, { sizeRequired: true });

    for (const [component, kind] of [[system?.riser, 'riser'], [system?.controlValve, `${system?.type ?? 'unknown'}-control-valve`], [system?.mainDrain, 'main-drain'], [system?.inspectorsTestAndDrain, 'inspectors-test-and-drain']]) {
      if (component?.id && pointReady(component.pointFt)) {
        const artifacts = componentArtifacts(component, kind, system?.id ?? null);
        planComponents.push(artifacts.plan2d);
        modelComponents.push(artifacts.model3d);
      }
    }

    if (validatePath(system?.feedPathFt, `${base}.feedPathFt`, issues)) {
      const start = system.feedPathFt[0];
      const end = system.feedPathFt.at(-1);
      if (pointReady(service.manifold?.pointFt) && distance(start, service.manifold.pointFt) > POINT_TOLERANCE_FT) {
        issues.push(issue('BACKBONE_FEED_MANIFOLD_MISMATCH', `${base}.feedPathFt[0]`, 'System feed must start at the service manifold datum.'));
      }
      if (pointReady(system.riser?.pointFt) && distance(end, system.riser.pointFt) > POINT_TOLERANCE_FT) {
        issues.push(issue('BACKBONE_FEED_RISER_MISMATCH', `${base}.feedPathFt`, 'System feed must end at the riser datum.'));
      }
      const artifacts = routeArtifacts(`${system.id}:feed`, 'system-feed', system.feedPathFt, system.id);
      planRoutes.push(artifacts.plan2d);
      modelRoutes.push(artifacts.model3d);
    }

    if (validatePath(system?.drainage?.mainDrainPathFt, `${base}.drainage.mainDrainPathFt`, issues)) {
      const artifacts = routeArtifacts(`${system.id}:main-drain-route`, 'main-drain-route', system.drainage.mainDrainPathFt, system.id);
      planRoutes.push(artifacts.plan2d);
      modelRoutes.push(artifacts.model3d);
    }
    if (['dry', 'preaction'].includes(system?.type) && system?.drainage?.allPipeDrainsToRiser !== true) {
      issues.push(issue('BACKBONE_DRY_DRAIN_TO_RISER_REQUIRED', `${base}.drainage.allPipeDrainsToRiser`, 'Dry and preaction piping must have an explicit drain-to-riser design.'));
    }

    const auxiliaryDrains = Array.isArray(system?.auxiliaryDrains) ? system.auxiliaryDrains : [];
    const auxiliaryById = new Map(auxiliaryDrains.map((drain) => [drain.id, drain]));
    auxiliaryDrainCount += auxiliaryDrains.length;
    auxiliaryDrains.forEach((drain, drainIndex) => {
      validateComponent(drain, `${base}.auxiliaryDrains[${drainIndex}]`, issues, { sizeRequired: true });
      if (!pointReady(drain?.outletPointFt)) issues.push(issue('BACKBONE_DRAIN_OUTLET_REQUIRED', `${base}.auxiliaryDrains[${drainIndex}].outletPointFt`, 'Auxiliary drain outlet geometry is required.'));
      if (drain?.id && pointReady(drain.pointFt)) {
        const component = componentArtifacts(drain, 'auxiliary-drain', system.id);
        planComponents.push(component.plan2d);
        modelComponents.push(component.model3d);
        if (pointReady(drain.outletPointFt)) {
          const route = routeArtifacts(`${drain.id}:route`, 'auxiliary-drain-route', [drain.pointFt, drain.outletPointFt], system.id);
          planRoutes.push(route.plan2d);
          modelRoutes.push(route.model3d);
        }
      }
    });

    const basins = Array.isArray(system?.drainage?.trappedBasins) ? system.drainage.trappedBasins : [];
    basins.forEach((basin, basinIndex) => {
      const basinPath = `${base}.drainage.trappedBasins[${basinIndex}]`;
      if (!(Number(basin?.volumeGallons) >= 0) || !pointReady(basin?.lowPointFt)) {
        issues.push(issue('BACKBONE_DRAIN_BASIN_INVALID', basinPath, 'Each trapped basin needs a volume and 3D low point.'));
        return;
      }
      if (Number(basin.volumeGallons) > 5 && basin.disposition !== 'auxiliary-drain') {
        issues.push(issue('BACKBONE_AUX_DRAIN_REQUIRED', basinPath, 'A trapped volume over 5 gallons needs an auxiliary-drain disposition.'));
      }
      if (basin.disposition === 'auxiliary-drain' && !auxiliaryById.has(basin.drainId)) {
        issues.push(issue('BACKBONE_AUX_DRAIN_ID_MISSING', `${basinPath}.drainId`, 'The basin must reference a designed auxiliary drain.'));
      }
      if (!['main-drain', 'auxiliary-drain'].includes(basin.disposition)) {
        issues.push(issue('BACKBONE_DRAIN_DISPOSITION_REQUIRED', `${basinPath}.disposition`, 'Every trapped basin needs an explicit main- or auxiliary-drain disposition.'));
      }
    });
  });

  const systemIdList = systems.map((system) => system.id).filter(Boolean);
  pushTakeoff(takeoff, 'backflow_preventer', 'Backflow preventer assembly', service.backflow ? 1 : 0);
  pushTakeoff(takeoff, 'fdc', 'Fire department connection (FDC)', service.fdc ? 1 : 0);
  pushTakeoff(takeoff, 'service_manifold', 'Riser manifold assembly', service.manifold ? 1 : 0, systemIdList);
  pushTakeoff(takeoff, 'alarm_check_valve', 'Wet-system alarm / check valve assembly', wetCount, systems.filter((system) => system.type === 'wet').map((system) => system.id));
  pushTakeoff(takeoff, 'dry_pipe_valve', 'Dry-pipe valve assembly', dryCount, systems.filter((system) => system.type === 'dry').map((system) => system.id));
  pushTakeoff(takeoff, 'preaction_valve', 'Preaction valve assembly', preactionCount, systems.filter((system) => system.type === 'preaction').map((system) => system.id));
  pushTakeoff(takeoff, 'deluge_valve', 'Deluge valve assembly', delugeCount, systems.filter((system) => system.type === 'deluge').map((system) => system.id));
  pushTakeoff(takeoff, 'riser_trim', 'Riser trim + gauges (set)', systems.length, systemIdList);
  pushTakeoff(takeoff, 'inspectors_test_and_drain', "Inspector's test & drain", systems.length, systemIdList);
  pushTakeoff(takeoff, 'main_drain', 'Main drain', systems.length, systemIdList);
  pushTakeoff(takeoff, 'auxiliary_drain', 'Auxiliary drain assembly', auxiliaryDrainCount, systemIdList);
  pushTakeoff(takeoff, 'fire_pump', 'Fire pump + controller', pump.decision === 'required' ? 1 : 0, systemIdList);

  const planIds = [...planComponents, ...planRoutes].map((item) => item.id).sort();
  const modelIds = [...modelComponents, ...modelRoutes].map((item) => item.id).sort();
  if (JSON.stringify(planIds) !== JSON.stringify(modelIds)) {
    issues.push(issue('BACKBONE_2D_3D_IDENTITY_MISMATCH', 'artifacts', '2D and 3D backbone identities must match exactly.'));
  }

  const geometryCodes = new Set([
    'BACKBONE_COMPONENT_POINT_REQUIRED', 'BACKBONE_ROUTE_REQUIRED', 'BACKBONE_FEED_MANIFOLD_MISMATCH',
    'BACKBONE_FEED_RISER_MISMATCH', 'BACKBONE_DRAIN_OUTLET_REQUIRED', 'BACKBONE_2D_3D_IDENTITY_MISMATCH',
  ]);
  const geometryReady = !issues.some((entry) => geometryCodes.has(entry.code));
  const status = issues.length ? 'blocked' : 'passed';
  return {
    artifactType: 'halofire.system-backbone-design.v1',
    projectId: input.projectId ?? null,
    status,
    issues,
    plan2d: { components: planComponents, routes: planRoutes },
    model3d: { components: modelComponents, routes: modelRoutes },
    takeoff: { systemComponents: takeoff },
    counts: {
      systems: systems.length,
      risers: systems.filter((system) => componentReady(system.riser)).length,
      mainDrains: systems.filter((system) => componentReady(system.mainDrain)).length,
      auxiliaryDrains: auxiliaryDrainCount,
      pumps: pump.decision === 'required' ? 1 : 0,
    },
    plan2dReady: geometryReady && planIds.length > 0,
    model3dReady: geometryReady && modelIds.length > 0,
    identityParityReady: JSON.stringify(planIds) === JSON.stringify(modelIds),
    quoteReady: status === 'passed',
  };
}

export default { buildSystemBackbone };
