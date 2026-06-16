function reportSource(explicit) {
  if (explicit !== undefined) return explicit;
  return globalThis.window?.__hfPhase3?.report ?? null;
}

function bomSource(explicit) {
  if (explicit !== undefined) return explicit;
  return globalThis.window?.__hfBomTakeoff ?? null;
}

export function getNfpaReport(report) {
  const current = reportSource(report);
  if (!current || current.hasSummary !== true || !current.summary) {
    return {
      status: 'pending',
      summary: 'Awaiting hydraulic solve',
      detail: 'Solve hydraulics to build the NFPA calculation report.',
    };
  }
  const summary = current.summary;
  const demandText = `${summary.demandGpm} gpm @ ${summary.requiredPsi} psi`;
  const supplyText = summary.availablePsi == null ? 'no supply' : `${summary.availablePsi} psi supply`;
  const status = summary.demandMet == null ? 'ready' : (summary.demandMet ? 'met' : 'short');
  const statusText = summary.demandMet == null ? 'Ready' : (summary.demandMet ? 'Demand met' : 'Demand short');
  return {
    status,
    summary: statusText,
    detail: `${demandText} · ${supplyText}`,
  };
}

export function getBom(takeoff) {
  const current = bomSource(takeoff);
  if (!current) {
    return {
      status: 'pending',
      summary: 'Awaiting live takeoff',
      detail: 'Generate a layout to derive the current BOM summary.',
    };
  }
  return {
    status: 'ready',
    summary: `${current.heads} heads · ${current.pipeFt} ft pipe`,
    detail: `${current.fittings} fittings · ${current.couplings} couplings · ${current.hangers} hangers`,
  };
}
