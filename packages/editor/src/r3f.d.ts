/**
 * Local React Three Fiber JSX intrinsic declarations for the editor package.
 *
 * Bun's isolated workspace resolution can keep R3F's JSX augmentation from
 * reaching this package during `tsc --noEmit`. Keep this broad and local so
 * editor tools can typecheck their Three primitives without coupling to a
 * specific @types/three patch version.
 */

export {}

interface ThreeJSXElements {
  group: any
  scene: any
  mesh: any
  instancedMesh: any
  line: any
  lineSegments: any
  lineLoop: any
  points: any
  primitive: any
  boxGeometry: any
  planeGeometry: any
  circleGeometry: any
  cylinderGeometry: any
  sphereGeometry: any
  extrudeGeometry: any
  shapeGeometry: any
  bufferGeometry: any
  edgesGeometry: any
  ringGeometry: any
  bufferAttribute: any
  instancedBufferAttribute: any
  meshStandardMaterial: any
  meshBasicMaterial: any
  meshPhongMaterial: any
  meshLambertMaterial: any
  meshPhysicalMaterial: any
  meshNormalMaterial: any
  shadowMaterial: any
  lineBasicMaterial: any
  lineBasicNodeMaterial: any
  lineDashedMaterial: any
  pointsMaterial: any
  shaderMaterial: any
  rawShaderMaterial: any
  spriteMaterial: any
  ambientLight: any
  directionalLight: any
  pointLight: any
  spotLight: any
  hemisphereLight: any
  rectAreaLight: any
  perspectiveCamera: any
  orthographicCamera: any
  gridHelper: any
  axesHelper: any
  arrowHelper: any
  sprite: any
  lOD: any
  fog: any
  color: any
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements extends ThreeJSXElements {}
  }
}

declare module 'react/jsx-runtime' {
  namespace JSX {
    interface IntrinsicElements extends ThreeJSXElements {}
  }
}

declare module 'react/jsx-dev-runtime' {
  namespace JSX {
    interface IntrinsicElements extends ThreeJSXElements {}
  }
}
