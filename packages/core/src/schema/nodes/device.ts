/**
 * DeviceNode — first-class Pascal node for fire-protection devices
 * (flow switches, tamper switches, pressure/temperature switches,
 * pressure gauges, water-motor gongs, test-and-drain assemblies).
 *
 * Fork addition (HaloFire Studio). Pascal systems dispatch on
 * `type === 'device'` — they no longer need to inspect `asset.tags`
 * to infer intent.
 *
 * `attaches_to` + `attaches_to_id` wire the device to the pipe,
 * valve, riser, or wall it rides on. `supervised` drives the alarm
 * panel supervision graph; `conduit_run_id` ties the device to its
 * electrical run so the fire-alarm integrator can trace signals.
 *
 * See blueprint 04 §6.
 */
import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

export const DeviceNode = BaseNode.extend({
  id: objectId('device'),
  type: nodeType('device'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),

  sku: z.string(),
  kind: z.enum([
    'flow_switch_paddle',
    'flow_switch_vane',
    'tamper_switch_osy',
    'tamper_switch_pivy',
    'pressure_switch',
    'pressure_gauge',
    'temperature_switch',
    'water_motor_gong',
    'test_and_drain',
  ]),

  attaches_to: z.enum(['pipe', 'valve', 'riser', 'wall']),
  attaches_to_id: z.string().optional(),

  supervised: z.boolean().default(true),
  conduit_run_id: z.string().optional(),   // fire alarm electrical
}).describe(dedent`
  DeviceNode — first-class fire-protection device (switches, gauges,
  test-and-drain).

  Discriminator: type === 'device'. Wired to its host via
  attaches_to/attaches_to_id; supervised flag drives the alarm panel
  supervision graph.
`)

export type DeviceNode = z.infer<typeof DeviceNode>
