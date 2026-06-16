import { hydraulicReport } from './nfpaReport.mjs'

function deepClone(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => deepClone(entry))
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, deepClone(entry)]),
    )
  }

  return value
}

export function submittalSheetData({ project, bom, hydraulics }) {
  const projectClone = deepClone(project)
  const bomClone = deepClone(bom)
  const hydraulicsClone = deepClone(hydraulics)

  return {
    project: projectClone,
    bom: bomClone,
    hydraulics: {
      ...hydraulicsClone,
      report: hydraulicReport(hydraulicsClone),
    },
  }
}
