/**
 * TitleBlockRenderer — Blueprint 07 section 3 / R6.2.
 *
 * Renders a title-block SVG template into a React element, substituting
 * {{field_name}} tokens with values from props.fields. The SVG is
 * inlined via dangerouslySetInnerHTML — this is safe because the
 * template string is a vetted package-local asset, not user input,
 * and the field values are first XML-escaped.
 *
 * v1 ships with a single template (halofire.standard). Additional
 * firms can register templates by adding entries to TEMPLATE_REGISTRY.
 */

import * as React from 'react'
import {
  HALOFIRE_STANDARD_SVG,
  HALOFIRE_STANDARD_TEMPLATE_ID,
} from '../../../../halofire-catalog/title-blocks/halofire-standard-svg'

export interface TitleBlockRendererProps {
  /** e.g. 'halofire.standard' */
  templateId: string
  /** Substituted into {{key}} tokens. Missing keys render as an em-dash. */
  fields: Record<string, string>
  /** Paper size in millimetres, e.g. [914, 610] for Arch D landscape. */
  paperSizeMm: [number, number]
  /** Optional className for the wrapping div. */
  className?: string
}

const TEMPLATE_REGISTRY: Record<string, string> = {
  [HALOFIRE_STANDARD_TEMPLATE_ID]: HALOFIRE_STANDARD_SVG,
}

const MISSING_FIELD_GLYPH = '\u2014'

/** XML-escape a field value before injecting into the SVG string. */
function escapeXml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** Collect every {{token}} that appears in the template. */
function collectTokens(template: string): Set<string> {
  const tokens = new Set<string>()
  const re = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g
  let match: RegExpExecArray | null
  while ((match = re.exec(template)) !== null) tokens.add(match[1]!)
  return tokens
}

/** Substitute tokens and patch the viewBox to the requested paper size. */
export function renderTitleBlockSvg(
  template: string,
  fields: Record<string, string>,
  paperSizeMm: [number, number],
): string {
  const [w, h] = paperSizeMm
  let out = template.replace(
    /viewBox="[^"]*"/,
    `viewBox="0 0 ${w} ${h}"`,
  )

  const tokens = collectTokens(out)
  for (const key of tokens) {
    const raw = fields[key]
    const value = raw === undefined || raw === '' ? MISSING_FIELD_GLYPH : raw
    const safe = escapeXml(value)
    out = out.split(`{{${key}}}`).join(safe)
  }
  return out
}

export function TitleBlockRenderer(
  props: TitleBlockRendererProps,
): JSX.Element {
  const { templateId, fields, paperSizeMm, className } = props

  const svg = React.useMemo(() => {
    const template = TEMPLATE_REGISTRY[templateId]
    if (!template) {
      const [w, h] = paperSizeMm
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}mm" height="${h}mm"><!-- unknown template: ${escapeXml(templateId)} --></svg>`
    }
    return renderTitleBlockSvg(template, fields, paperSizeMm)
  }, [templateId, fields, paperSizeMm])

  return (
    <div
      role="img"
      aria-label={`Title block (${templateId})`}
      data-testid="halofire-title-block"
      data-template-id={templateId}
      className={className}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}

export default TitleBlockRenderer
