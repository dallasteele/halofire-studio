// HaloFire CAD — connectivity re-export. The Port / Method / PortRole model and
// the adapter mate-ability logic live in the studio app (the single source of
// truth, with its own honesty/test discipline). CAD mirrors it here as a thin
// re-export so model.ts and any network tooling import ONE Port type — the CAD
// network and the catalog connectivity can never drift apart.
//
// Do NOT redefine Port here. If the connectivity model changes, it changes in
// studio/src/lib/connectivity.ts and both apps follow.

export {
  ADAPTERS,
  METHODS,
  PORT_ROLES,
  arePortsCompatible,
  checkPorts,
  connectableSizesFor,
  findAdapter,
  rolesOppose,
  type Adapter,
  type CompatibilityResult,
  type Method,
  type Port,
  type PortRole,
} from '../../../studio/src/lib/connectivity';
