import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type ProceduralModelOptions = {
  wireframe?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;
  textureSize?: number;
  textureAnisotropy?: number;
  qualityPriority?: 'reference-fidelity' | 'balanced';
};

export type ProceduralModelRuntime = {
  nodes: Record<string, THREE.Object3D>;
  meshes: Record<string, THREE.Mesh>;
  sockets: Record<string, THREE.Object3D>;
  colliders: Record<string, unknown>;
  destructionGroups: Record<string, THREE.Object3D[]>;
};

type SculptMaterialSpec = Record<string, any>;

// Plan 1.3 F.6 — sweep a thin 2D cross-section along a 3D spine so a curved
// form (hooked blade, handle) reads correctly from EVERY camera angle, not just
// the reference angle a flat extrude happens to match. Uses ExtrudeGeometry's
// native extrudePath; bevelEnabled: false keeps sharp tips (same rule as F.5).
function buildCurveSweepGeometry(
  sweep: { spine: [number, number, number][]; crossSection: { points: [number, number][] }; closed?: boolean },
): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  const cs = sweep.crossSection.points;
  if (cs.length > 0) {
    shape.moveTo(cs[0][0], cs[0][1]);
    for (let i = 1; i < cs.length; i += 1) shape.lineTo(cs[i][0], cs[i][1]);
    shape.closePath();
  }
  const spine = sweep.spine.map(([x, y, z]) => new THREE.Vector3(x, y, z));
  const path = new THREE.CatmullRomCurve3(spine, sweep.closed ?? false);
  return new THREE.ExtrudeGeometry(shape, {
    extrudePath: path,
    steps: Math.max(24, spine.length * 8),
    bevelEnabled: false,
  });
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function readLayerNumber(value: unknown, keys: string[], fallback: number): number {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of keys) {
      if (typeof record[key] === 'number') return record[key] as number;
    }
  }
  return fallback;
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = /^#[0-9a-f]{3}$/i.test(hex)
    ? '#' + hex.slice(1).split('').map((part) => part + part).join('')
    : hex;
  const value = /^#[0-9a-f]{6}$/i.test(normalized) ? Number.parseInt(normalized.slice(1), 16) : 0x8a7a5f;
  return [clampAlbedoChannel((value >> 16) & 255), clampAlbedoChannel((value >> 8) & 255), clampAlbedoChannel(value & 255)];
}

function materialPalette(spec: SculptMaterialSpec): string[] {
  const palette = spec.colorVariation?.palette;
  if (Array.isArray(palette) && palette.length > 0) return palette.filter((value) => typeof value === 'string');
  const secondary = spec.albedo?.secondary;
  const colors = [spec.baseColor ?? spec.color ?? spec.albedo?.dominant, ...(Array.isArray(secondary) ? secondary : [])];
  return colors.filter((value): value is string => typeof value === 'string' && value.startsWith('#'));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampAlbedoChannel(value: number): number {
  return Math.max(30, Math.min(240, Math.round(value)));
}

function clampPbrF0(value: number): number {
  return Math.max(0.02, Math.min(1, value));
}

function clampPbrIor(value: number): number {
  return Math.max(1, Math.min(2.5, value));
}

function clampPbrMetalness(value: number): number {
  return value >= 0.5 ? 1 : 0;
}

function clampedAlbedoColor(spec: SculptMaterialSpec): THREE.Color {
  const source = typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F';
  const [red, green, blue] = hexToRgb(source);
  return new THREE.Color(red / 255, green / 255, blue / 255);
}

function smoothCurve(value: number): number {
  return value * value * (3 - 2 * value);
}

function periodicHash(x: number, y: number, seed: number, periodX: number, periodY: number): number {
  const wrappedX = ((x % periodX) + periodX) % periodX;
  const wrappedY = ((y % periodY) + periodY) % periodY;
  let value = Math.imul(wrappedX + seed * 17, 374761393) ^ Math.imul(wrappedY + seed * 31, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function periodicValueNoise(u: number, v: number, seed: number, periodX: number, periodY: number): number {
  const x = u * periodX;
  const y = v * periodY;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothCurve(x - x0);
  const ty = smoothCurve(y - y0);
  const a = periodicHash(x0, y0, seed, periodX, periodY);
  const b = periodicHash(x0 + 1, y0, seed, periodX, periodY);
  const c = periodicHash(x0, y0 + 1, seed, periodX, periodY);
  const d = periodicHash(x0 + 1, y0 + 1, seed, periodX, periodY);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, tx), THREE.MathUtils.lerp(c, d, tx), ty);
}

type SurfaceBand = {
  frequency: number;
  amplitude: number;
  stretchX: number;
  stretchY: number;
  ridge: boolean;
};

function surfaceBands(spec: SculptMaterialSpec): SurfaceBand[] {
  const source = Array.isArray(spec.surfaceFrequencyBands) ? spec.surfaceFrequencyBands : [];
  const parsed = source.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return [];
    const band = item as Record<string, unknown>;
    const frequency = typeof band.frequency === 'number' ? band.frequency : 0;
    const amplitude = typeof band.amplitude === 'number' ? band.amplitude : 0;
    if (frequency <= 0 || amplitude <= 0) return [];
    const stretch = Array.isArray(band.stretch) ? band.stretch : [1, 1];
    const description = `${String(band.pattern ?? '')} ${String(band.role ?? '')}`.toLowerCase();
    return [{
      frequency,
      amplitude,
      stretchX: typeof stretch[0] === 'number' ? Math.max(0.1, stretch[0]) : 1,
      stretchY: typeof stretch[1] === 'number' ? Math.max(0.1, stretch[1]) : 1,
      ridge: /(ridge|groove|grain|fiber|striated|crack)/.test(description),
    }];
  });
  return parsed.length > 0 ? parsed : [
    { frequency: 2, amplitude: 0.42, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 12, amplitude: 0.22, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 56, amplitude: 0.08, stretchX: 1, stretchY: 1, ridge: false },
  ];
}

function sampleSurface(u: number, v: number, bands: SurfaceBand[], seed: number): number {
  let value = 0;
  let weight = 0;
  for (let index = 0; index < bands.length; index += 1) {
    const band = bands[index];
    const periodX = Math.max(1, Math.round(band.frequency * band.stretchX));
    const periodY = Math.max(1, Math.round(band.frequency * band.stretchY));
    let sample = periodicValueNoise(u, v, seed + index * 1013, periodX, periodY);
    if (band.ridge) sample = 1 - Math.abs(sample * 2 - 1);
    value += sample * band.amplitude;
    weight += band.amplitude;
  }
  return weight > 0 ? clamp01(value / weight) : 0.5;
}

function mixPalette(colors: [number, number, number][], value: number): [number, number, number] {
  if (colors.length === 1) return colors[0];
  const scaled = clamp01(value) * (colors.length - 1);
  const index = Math.min(colors.length - 2, Math.floor(scaled));
  const mix = scaled - index;
  const a = colors[index];
  const b = colors[index + 1];
  return [
    Math.round(THREE.MathUtils.lerp(a[0], b[0], mix)),
    Math.round(THREE.MathUtils.lerp(a[1], b[1], mix)),
    Math.round(THREE.MathUtils.lerp(a[2], b[2], mix)),
  ];
}

type ColorGradientStop = { offset: number; color: string };
type ColorGradientSpec = {
  type: 'linear' | 'radial';
  axis: [number, number];
  stops: ColorGradientStop[];
};

function parseRgba(value: string): [number, number, number] {
  const match = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(value);
  if (!match) return [138, 122, 95];
  return [clampAlbedoChannel(Number(match[1])), clampAlbedoChannel(Number(match[2])), clampAlbedoChannel(Number(match[3]))];
}

// Analytical per-pixel gradient sample. The extraction schema's colorGradient carries
// exact rgba(...) stop colors (see extract_part_color_recipe.py), so this samples the
// same trend directly in JS math rather than round-tripping through a Canvas 2D
// createLinearGradient/createRadialGradient object — same visual result, and it composes
// directly with the existing noise/height-correlated colorVariation blend below.
function sampleColorGradient(gradient: ColorGradientSpec, u: number, v: number): [number, number, number] {
  const stops = gradient.stops.length >= 2 ? gradient.stops : [{ offset: 0, color: 'rgba(138,122,95,1)' }, { offset: 1, color: 'rgba(138,122,95,1)' }];
  let t: number;
  if (gradient.type === 'radial') {
    const [cx, cy] = gradient.axis;
    const dx = u - cx;
    const dy = v - cy;
    const maxRadius = Math.max(0.001, Math.hypot(Math.max(cx, 1 - cx), Math.max(cy, 1 - cy)));
    t = clamp01(Math.hypot(dx, dy) / maxRadius);
  } else {
    const [ax, ay] = gradient.axis;
    const projection = (u - 0.5) * ax + (v - 0.5) * ay;
    const maxProjection = 0.5 * (Math.abs(ax) + Math.abs(ay)) || 0.5;
    t = clamp01(projection / maxProjection + 0.5);
  }
  const scaled = t * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.max(0, Math.floor(scaled)));
  const mix = scaled - index;
  const a = parseRgba(stops[index].color);
  const b = parseRgba(stops[index + 1].color);
  return [
    THREE.MathUtils.lerp(a[0], b[0], mix),
    THREE.MathUtils.lerp(a[1], b[1], mix),
    THREE.MathUtils.lerp(a[2], b[2], mix),
  ];
}

function writePixel(data: Uint8ClampedArray, offset: number, red: number, green: number, blue: number): void {
  data[offset] = Math.max(0, Math.min(255, Math.round(red)));
  data[offset + 1] = Math.max(0, Math.min(255, Math.round(green)));
  data[offset + 2] = Math.max(0, Math.min(255, Math.round(blue)));
  data[offset + 3] = 255;
}

function makeCanvas(size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function createMapTexture(
  canvas: HTMLCanvasElement,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [2, 2];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 2,
    typeof repeat[1] === 'number' ? repeat[1] : 2,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

type ProceduralTextureSet = {
  albedo: THREE.Texture;
  roughness: THREE.Texture;
  height: THREE.Texture;
  normal: THREE.Texture;
  ao: THREE.Texture;
  source: 'reference-pixel-extraction' | 'procedural';
};

function referenceMapUrl(spec: SculptMaterialSpec, channel: string): string | null {
  const reference = spec.referencePbr;
  if (!reference || typeof reference !== 'object') return null;
  if (reference.usable === false) return null;
  const confidence = typeof reference.confidence === 'number'
    ? reference.confidence
    : (typeof reference.estimatedFidelity === 'number' ? reference.estimatedFidelity : 0);
  const threshold = typeof reference.targetThreshold === 'number' ? reference.targetThreshold : 0.7;
  if (confidence < threshold) return null;
  const maps = reference.maps;
  if (!maps || typeof maps !== 'object') return null;
  const map = (maps as Record<string, unknown>)[channel];
  if (!map || typeof map !== 'object') return null;
  const record = map as Record<string, unknown>;
  const url = typeof record.url === 'string' && record.url.trim() ? record.url : record.path;
  return typeof url === 'string' && url.trim() ? url : null;
}

function createLoadedMapTexture(
  url: string,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.Texture {
  const texture = new THREE.TextureLoader().load(url);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [1, 1];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 1,
    typeof repeat[1] === 'number' ? repeat[1] : 1,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

function makeReferenceTextureSet(spec: SculptMaterialSpec, options: ProceduralModelOptions): ProceduralTextureSet | null {
  const albedo = referenceMapUrl(spec, 'albedo');
  const roughness = referenceMapUrl(spec, 'roughness');
  const height = referenceMapUrl(spec, 'height');
  const normal = referenceMapUrl(spec, 'normal');
  const ao = referenceMapUrl(spec, 'ao');
  if (!albedo || !roughness || !height || !normal || !ao) return null;
  return {
    albedo: createLoadedMapTexture(albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createLoadedMapTexture(roughness, THREE.NoColorSpace, spec, options),
    height: createLoadedMapTexture(height, THREE.NoColorSpace, spec, options),
    normal: createLoadedMapTexture(normal, THREE.NoColorSpace, spec, options),
    ao: createLoadedMapTexture(ao, THREE.NoColorSpace, spec, options),
    source: 'reference-pixel-extraction',
  };
}

function makeProceduralTextureSet(
  id: string,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): ProceduralTextureSet | null {
  if (typeof document === 'undefined') return null;
  const qualityFirst = (options.qualityPriority ?? 'reference-fidelity') === 'reference-fidelity';
  const requested = options.textureSize ?? spec.textureResolution;
  const requestedSize = typeof requested === 'number' && Number.isFinite(requested)
    ? requested
    : (qualityFirst ? 1024 : 512);
  const size = Math.max(256, Math.min(2048, 2 ** Math.round(Math.log2(requestedSize))));
  const canvases = {
    albedo: makeCanvas(size),
    roughness: makeCanvas(size),
    height: makeCanvas(size),
    normal: makeCanvas(size),
    ao: makeCanvas(size),
  };
  const contexts = {
    albedo: canvases.albedo.getContext('2d'),
    roughness: canvases.roughness.getContext('2d'),
    height: canvases.height.getContext('2d'),
    normal: canvases.normal.getContext('2d'),
    ao: canvases.ao.getContext('2d'),
  };
  if (!contexts.albedo || !contexts.roughness || !contexts.height || !contexts.normal || !contexts.ao) return null;
  const images = {
    albedo: contexts.albedo.createImageData(size, size),
    roughness: contexts.roughness.createImageData(size, size),
    height: contexts.height.createImageData(size, size),
    normal: contexts.normal.createImageData(size, size),
    ao: contexts.ao.createImageData(size, size),
  };
  const seed = hashString(id);
  const bands = surfaceBands(spec);
  const heightField = new Float32Array(size * size);
  const roughnessField = new Float32Array(size * size);
  const palette = materialPalette(spec);
  const fallback = typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F';
  const colors = (palette.length >= 2 ? palette : [fallback, '#6E614B', '#A08F70']).map(hexToRgb);
  const baseRoughness = clamp01(readLayerNumber(spec.roughness, ['base'], 0.76));
  const roughnessVariation = clamp01(readLayerNumber(spec.roughness, ['variation'], 0.18));
  const colorAmplitude = clamp01(readLayerNumber(spec.colorVariation, ['amplitude', 'variation'], 0.18));
  const heightCorrelation = clamp01(readLayerNumber(spec.colorVariation, ['heightCorrelation'], 0.3));
  const colorGradient: ColorGradientSpec | undefined = spec.colorGradient;
  for (let y = 0; y < size; y += 1) {
    const v = y / size;
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const index = y * size + x;
      const height = sampleSurface(u, v, bands, seed + 101);
      const roughNoise = sampleSurface(u, v, bands, seed + 7001);
      const colorNoise = sampleSurface(u, v, bands, seed + 15013);
      heightField[index] = height;
      roughnessField[index] = clamp01(baseRoughness + (roughNoise - 0.5) * roughnessVariation * 2);
      let color: [number, number, number];
      if (colorGradient) {
        // Evidence-derived spatial gradient (Plan 1.3 Workstream C) takes priority
        // over the noise-based palette blend below — it is a measured trend, not a guess.
        color = sampleColorGradient(colorGradient, u, v);
      } else {
        const paletteValue = clamp01(
          0.5 + (colorNoise - 0.5) * colorAmplitude * 2 + (height - 0.5) * heightCorrelation
        );
        color = mixPalette(colors, paletteValue);
      }
      writePixel(images.albedo.data, index * 4, color[0], color[1], color[2]);
    }
  }
  const normalStrength = Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35));
  const aoStrength = clamp01(readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35));
  for (let y = 0; y < size; y += 1) {
    const up = ((y - 1 + size) % size) * size;
    const down = ((y + 1) % size) * size;
    for (let x = 0; x < size; x += 1) {
      const left = (x - 1 + size) % size;
      const right = (x + 1) % size;
      const index = y * size + x;
      const center = heightField[index];
      const dx = (heightField[y * size + right] - heightField[y * size + left]) * normalStrength * 6;
      const dy = (heightField[down + x] - heightField[up + x]) * normalStrength * 6;
      const inverseLength = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const normalX = -dx * inverseLength;
      const normalY = -dy * inverseLength;
      const normalZ = inverseLength;
      const neighborAverage = (
        heightField[y * size + left] + heightField[y * size + right]
        + heightField[up + x] + heightField[down + x]
      ) * 0.25;
      const cavity = Math.max(0, neighborAverage - center);
      const ao = clamp01(1 - aoStrength * (cavity * 12 + (1 - center) * 0.16));
      const offset = index * 4;
      const heightByte = center * 255;
      const roughnessByte = roughnessField[index] * 255;
      writePixel(images.height.data, offset, heightByte, heightByte, heightByte);
      writePixel(images.roughness.data, offset, roughnessByte, roughnessByte, roughnessByte);
      writePixel(
        images.normal.data, offset,
        (normalX * 0.5 + 0.5) * 255,
        (normalY * 0.5 + 0.5) * 255,
        (normalZ * 0.5 + 0.5) * 255,
      );
      writePixel(images.ao.data, offset, ao * 255, ao * 255, ao * 255);
    }
  }
  contexts.albedo.putImageData(images.albedo, 0, 0);
  contexts.roughness.putImageData(images.roughness, 0, 0);
  contexts.height.putImageData(images.height, 0, 0);
  contexts.normal.putImageData(images.normal, 0, 0);
  contexts.ao.putImageData(images.ao, 0, 0);
  return {
    albedo: createMapTexture(canvases.albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createMapTexture(canvases.roughness, THREE.NoColorSpace, spec, options),
    height: createMapTexture(canvases.height, THREE.NoColorSpace, spec, options),
    normal: createMapTexture(canvases.normal, THREE.NoColorSpace, spec, options),
    ao: createMapTexture(canvases.ao, THREE.NoColorSpace, spec, options),
    source: 'procedural',
  };
}

function createSculptMaterial(id: string, spec: SculptMaterialSpec, options: ProceduralModelOptions, denseComponent = false): THREE.MeshPhysicalMaterial {
  const textures = makeReferenceTextureSet(spec, options) ?? makeProceduralTextureSet(id, spec, options);
  const material = new THREE.MeshPhysicalMaterial({
    color: textures ? 0xffffff : clampedAlbedoColor(spec),
    roughness: textures ? 1 : clamp01(readLayerNumber(spec.roughness, ['base'], 0.76)),
    metalness: clampPbrMetalness(readLayerNumber(spec.metalness, ['base'], 0.0)),
    clearcoat: clamp01(readLayerNumber(spec.clearcoat, ['base', 'amount'], 0)),
    clearcoatRoughness: clamp01(readLayerNumber(spec.clearcoatRoughness, ['base'], 0.25)),
    transmission: clamp01(readLayerNumber(spec.transmission, ['base', 'amount'], 0)),
    ior: clampPbrIor(readLayerNumber(spec.ior, ['base', 'value'], 1.5)),
    thickness: Math.max(0, readLayerNumber(spec.thickness, ['base', 'amount'], 0)),
    attenuationDistance: Math.max(0.001, readLayerNumber(spec.attenuationDistance, ['base', 'value'], Infinity)),
    attenuationColor: new THREE.Color(typeof spec.attenuationColor === 'string' ? spec.attenuationColor : '#ffffff'),
    sheen: clamp01(readLayerNumber(spec.sheen, ['base', 'amount'], 0)),
    sheenColor: new THREE.Color(typeof spec.sheenColor === 'string' ? spec.sheenColor : '#ffffff'),
    sheenRoughness: clamp01(readLayerNumber(spec.sheenRoughness, ['base'], 1.0)),
    iridescence: clamp01(readLayerNumber(spec.iridescence, ['base', 'amount'], 0)),
    iridescenceIOR: clampPbrIor(readLayerNumber(spec.iridescenceIOR, ['base', 'value'], 1.3)),
    anisotropy: clamp01(readLayerNumber(spec.anisotropy, ['base', 'amount'], 0)),
    anisotropyRotation: readLayerNumber(spec.anisotropy, ['rotation'], 0),
    specularIntensity: clampPbrF0(readLayerNumber(spec.specularF0 ?? spec.f0 ?? spec.specularIntensity, ['base', 'value'], 1.0)),
    specularColor: new THREE.Color(typeof spec.specularColor === 'string' ? spec.specularColor : '#ffffff'),
    emissive: new THREE.Color(typeof spec.emissive === 'string' ? spec.emissive : '#000000'),
    emissiveIntensity: Math.max(0, readLayerNumber(spec.emissiveIntensity, ['base'], 1.0)),
    opacity: clamp01(readLayerNumber(spec.opacity, ['base'], 1)),
    transparent: readLayerNumber(spec.transmission, ['base', 'amount'], 0) > 0 || readLayerNumber(spec.opacity, ['base'], 1) < 1,
    alphaTest: Math.max(0, readLayerNumber(spec.alpha, ['cutoff', 'alphaTest'], 0)),
    wireframe: options.wireframe ?? false,
    side: spec.doubleSided === true ? THREE.DoubleSide : THREE.FrontSide,
    flatShading: spec.flatShading === true,
  });
  if (textures) {
    material.map = textures.albedo;
    material.roughnessMap = textures.roughness;
    material.normalMap = textures.normal;
    material.normalScale.setScalar(Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35)));
    material.aoMap = textures.ao;
    material.aoMap.channel = 0;
    material.aoMapIntensity = readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35);
    const denseMesh = denseComponent || spec.denseMesh === true || spec.geometryDensity === 'dense' || spec.topologyClass === 'dense';
    const bumpScale = Math.max(0, readLayerNumber(spec.bump, ['amplitude', 'strength'], 0));
    const effectiveBumpScale = denseMesh ? Math.max(0.05, bumpScale) : bumpScale;
    if (effectiveBumpScale > 0) {
      material.bumpMap = textures.height;
      material.bumpScale = effectiveBumpScale;
    }
    const displacementScale = Math.max(0, readLayerNumber(spec.displacement, ['amplitude', 'strength'], 0));
    const effectiveDisplacementScale = denseMesh ? Math.max(0.005, displacementScale) : displacementScale;
    if (effectiveDisplacementScale > 0) {
      material.displacementMap = textures.height;
      material.displacementScale = effectiveDisplacementScale;
      material.displacementBias = -effectiveDisplacementScale * 0.5;
    }
  }
  material.envMapIntensity = readLayerNumber(spec, ['envMapIntensity'], 0.8);
  material.userData.sculptMaterial = spec;
  material.userData.proceduralMapsIndependent = true;
  material.userData.pbrConstraints = { albedoRange: [30, 240], binaryMetalness: true, f0Range: [0.02, 1], iorRange: [1, 2.5] };
  material.userData.pbrTextureSource = textures?.source ?? 'flat-fallback';
  material.userData.referencePbr = spec.referencePbr ?? null;
  material.userData.referenceMaterialId = spec.referenceMaterialId ?? spec.materialReference?.profileId ?? null;
  material.userData.materialEvidence = spec.materialEvidence ?? null;
  material.userData.validationViews = spec.materialReference?.validationViews ?? [];
  material.needsUpdate = true;
  return material;
}

type AttachmentEndpoint = {
  start: THREE.Vector3;
  midpoint: THREE.Vector3;
  quaternion: THREE.Quaternion;
  length: number;
  baseRadius: number;
  endRadius: number;
};

function readVector3(value: unknown, fallback: [number, number, number]): THREE.Vector3 {
  if (Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === 'number')) {
    return new THREE.Vector3(value[0], value[1], value[2]);
  }
  return new THREE.Vector3(fallback[0], fallback[1], fallback[2]);
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function makeAttachmentEndpoint(attachment: unknown): AttachmentEndpoint | null {
  if (!attachment || typeof attachment !== 'object') return null;
  const record = attachment as Record<string, unknown>;
  const start = readVector3(record.localStart, [0, 0, 0]);
  const end = readVector3(record.localEnd, [0, 1, 0]);
  const delta = end.clone().sub(start);
  const length = delta.length();
  if (length <= 0.0001) return null;
  const direction = delta.clone().normalize();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
  const baseRadius = Math.max(0.005, readNumber(record.baseRadius, 0.06));
  const endRadius = Math.max(0.003, readNumber(record.endRadius, baseRadius * 0.55));
  return {
    start,
    midpoint: delta.multiplyScalar(0.5),
    quaternion,
    length,
    baseRadius,
    endRadius,
  };
}

// Generated from ObjectSculptSpec target: Classic 911 Style Coupe
// Sculpt build pass: blockout
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
export function createClassic911StyleCoupeModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "Classic 911 Style Coupe";
  root.userData.reconstructionEvidence = {"itemFamily": null, "subtype": null, "componentAdapter": null, "route": null, "exactnessTier": null, "referenceCamera": {"solved": false, "fovDegrees": 38, "aspect": 1, "orientation": {"yaw": -35, "pitch": -12, "roll": 0}, "positionHint": [3.6, 2.1, 4.5], "note": "Reference is a stylized perspective concept; use camera matching for comparison only. Photo projection is intentionally skipped."}, "approximationNotes": []};
  root.userData.materialPipeline = {"schemaVersion": 1, "status": "proceed", "registry": "/private/tmp/img2threejs.Yr4879/repo/docs/materials/material-reference.json", "analysisArtifact": "/Users/ugshanyu/usion-racing/docs/img2threejs/classic-911/material-analysis.json", "targetThreshold": 0.7, "unresolvedNotObservedMaterials": [], "regions": [{"componentId": "body-shell", "regionId": "red-body-paint", "specMaterialId": "body-paint", "profileId": "coating.painted-metal", "status": "proceed"}, {"componentId": "glazing", "regionId": "smoked-window-glass", "specMaterialId": "window-glass", "profileId": "glass.clear", "status": "proceed"}, {"componentId": "wheels", "regionId": "tire-rubber", "specMaterialId": "tire-rubber", "profileId": "rubber.matte", "status": "proceed"}, {"componentId": "wheels", "regionId": "silver-wheel-metal", "specMaterialId": "wheel-metal", "profileId": "metal.aluminum", "status": "proceed"}], "controlledViewsRequired": ["albedo-unlit", "backlight-transmission", "environment-reflection", "grazing", "neutral-studio", "reference-beauty"]};
  root.userData.materialReferenceRegistry = "/private/tmp/img2threejs.Yr4879/repo/docs/materials/material-reference.json";

  const materialMap: Record<string, THREE.Material> = {};
  materialMap["body-paint"] = createSculptMaterial(
    "body-paint",
    {"id": "body-paint", "name": "Clear-coated red body paint", "type": "physical", "shaderModel": "MeshPhysicalMaterial", "baseColor": "#E3261F", "color": "#E3261F", "albedo": {"dominant": "#E3261F", "secondary": ["#A90F12"], "samplingNotes": "Sampled and cross-checked from the four admitted concept views; studio highlights are not baked into albedo."}, "colorVariation": {"palette": ["#E3261F", "#A90F12"], "pattern": "low-amplitude procedural variation", "amplitude": 0.025, "heightCorrelation": 0}, "textureResolution": 1024, "textureProjection": {"mode": "object-space procedural", "repeat": [1, 1], "anisotropy": 8, "texelDensityIntent": "Stable object-space density; no image projection or lighting bake."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 1, "amplitude": 0.02, "role": "broad value variation without changing identity color"}, {"id": "meso", "frequency": 12, "amplitude": 0.02, "role": "molded, brushed, or coated surface breakup"}, {"id": "micro", "frequency": 64, "amplitude": 0.012, "role": "grazing-angle highlight breakup"}], "roughness": {"base": 0.45, "variation": 0.07, "map": "independent-procedural-roughness-field"}, "metalness": {"base": 0.0, "variation": 0}, "normal": {"pattern": "independent-fine-surface-field", "strength": 0.035, "scale": 48, "space": "tangent"}, "bump": {"pattern": "independent-height-field", "amplitude": 0.003, "scale": 36}, "displacement": {"pattern": "none", "amplitude": 0, "scale": 1, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.22, "contactShadowBias": 0.32, "notes": "Independent cavity and contact response at seams and intersections."}, "wear": {"edgeWear": 0, "scratches": [], "chips": []}, "dirt": {"amount": 0, "cavityBias": 0, "color": "#1A1614"}, "localOverrides": [{"id": "highlight-clearcoat", "region": "hood, fenders, roof, and door shoulders", "roughness": 0.18, "clearcoat": 0.92, "evidenceRefs": ["front-three-quarter", "side"]}], "shaderNotes": ["Independent albedo, roughness, normal/height, and AO responses.", "Geometry carries all silhouette-defining relief."], "notes": "Values are reference-derived art-direction estimates for a real-time low-poly game asset.", "clearcoat": {"base": 0.75, "variation": 0.0}, "clearcoatRoughness": {"base": 0.12, "variation": 0.0}, "referenceMaterialId": "coating.painted-metal", "materialFamily": "coating", "materialSubtype": "paint-over-metal", "materialFinish": "gloss-or-satin", "materialReference": {"registry": "/private/tmp/img2threejs.Yr4879/repo/docs/materials/material-reference.json", "profileId": "coating.painted-metal", "method": "family-subtype-finish", "confidence": 0.866, "sourceRefs": ["three.mesh-physical", "gltf.2", "khronos.gltf-pbr", "adobe.pbr-guide-1", "adobe.pbr-guide-2"], "requiredMaps": ["map", "roughnessMap"], "optionalMaps": ["normalMap", "clearcoatMap", "clearcoatRoughnessMap", "metalnessMap"], "validationViews": ["albedo-unlit", "neutral-studio", "grazing", "environment-reflection", "reference-beauty"]}, "ior": {"base": 1.5, "variation": 0.0}, "referencePbr": {"version": "1.0", "sourceImage": "/Users/ugshanyu/usion-racing/docs/img2threejs/classic-911/material-evidence/00-red-body-paint.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.866, "estimatedFidelity": 0.866, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "/Users/ugshanyu/usion-racing/docs/img2threejs/classic-911/material-evidence/pbr-00-red-body-paint/body-paint_albedo.png", "url": "body-paint_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "/Users/ugshanyu/usion-racing/docs/img2threejs/classic-911/material-evidence/pbr-00-red-body-paint/body-paint_roughness.png", "url": "body-paint_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "/Users/ugshanyu/usion-racing/docs/img2threejs/classic-911/material-evidence/pbr-00-red-body-paint/body-paint_height.png", "url": "body-paint_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "/Users/ugshanyu/usion-racing/docs/img2threejs/classic-911/material-evidence/pbr-00-red-body-paint/body-paint_normal.png", "url": "body-paint_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "/Users/ugshanyu/usion-racing/docs/img2threejs/classic-911/material-evidence/pbr-00-red-body-paint/body-paint_ao.png", "url": "body-paint_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 245, "sourceHeight": 128, "mapSize": 512, "cropBBoxPixels": {"x": 0, "y": 0, "width": 245, "height": 128}, "mask": {"backgroundColor": "#DE3230", "backgroundNoise": 182.275, "transparentPixelFraction": 0.0, "foregroundCoverage": 0.7994}, "mapStats": {"valueRange": 0.3092, "heightP90Gradient": 0.1122, "roughnessBase": 0.697, "roughnessVariation": 0.173, "normalStrength": 0.288, "blurRadius": 10}, "palette": ["#DF312E", "#E34746", "#AC1917", "#291715", "#EAD7BC"]}, "warnings": []}, "textureAnalysis": {"finishClass": "painted-metal", "recipe": {"metalness": 0.0, "roughness": 0.5, "clearcoat": 1.0, "clearcoatRoughness": 0.05, "transmission": 0.0, "ior": 1.5, "envMapIntensity": 1.0, "anisotropy": 0.0, "procedural": "flat-clearcoat"}, "palette": ["#DE5F5D", "#D53734", "#B53634", "#B6766D", "#A82F2D"], "paletteHueRisk": [], "gradientAxis": "horizontal", "stats": {"meanLum": 108.1, "meanSaturation": 0.596, "gradientStrength": 0.249, "mottle": 0.029, "streakRatio": 0.96, "hueSpread": 0.016, "specularFraction": 0.037}}, "materialEvidence": {"componentId": "body-shell", "regionId": "red-body-paint", "crop": {"path": "/Users/ugshanyu/usion-racing/docs/img2threejs/classic-911/material-evidence/00-red-body-paint.png", "bbox": {"x": 150, "y": 285, "width": 245, "height": 128}, "sourceWidth": 627, "sourceHeight": 627, "loaderWarnings": [], "coverage": 0.0798}, "observations": ["chromatic base-colour response", "strong image-space gradient; verify it is material pattern, not lighting", "single-image PBR inference requires controlled render validation"], "hypothesis": {"componentId": "body-shell", "regionId": "red-body-paint", "materialId": null, "family": "coating", "subtype": "paint-over-metal", "finish": "gloss-or-satin", "aliases": [], "confidence": 0.866, "source": "four admitted concept views"}, "alternatives": []}},
    options
  );
  materialMap["window-glass"] = createSculptMaterial(
    "window-glass",
    {"id": "window-glass", "name": "Smoked window glass", "type": "physical", "shaderModel": "MeshPhysicalMaterial", "baseColor": "#172027", "color": "#172027", "albedo": {"dominant": "#172027", "secondary": ["#080C10"], "samplingNotes": "Sampled and cross-checked from the four admitted concept views; studio highlights are not baked into albedo."}, "colorVariation": {"palette": ["#172027", "#080C10"], "pattern": "low-amplitude procedural variation", "amplitude": 0.04, "heightCorrelation": 0}, "textureResolution": 1024, "textureProjection": {"mode": "object-space procedural", "repeat": [1, 1], "anisotropy": 8, "texelDensityIntent": "Stable object-space density; no image projection or lighting bake."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 1, "amplitude": 0.04, "role": "broad value variation without changing identity color"}, {"id": "meso", "frequency": 12, "amplitude": 0.02, "role": "molded, brushed, or coated surface breakup"}, {"id": "micro", "frequency": 64, "amplitude": 0.012, "role": "grazing-angle highlight breakup"}], "roughness": {"base": 0.05, "variation": 0.03, "map": "independent-procedural-roughness-field"}, "metalness": {"base": 0.0, "variation": 0}, "normal": {"pattern": "independent-fine-surface-field", "strength": 0.035, "scale": 48, "space": "tangent"}, "bump": {"pattern": "independent-height-field", "amplitude": 0.003, "scale": 36}, "displacement": {"pattern": "none", "amplitude": 0, "scale": 1, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.22, "contactShadowBias": 0.32, "notes": "Independent cavity and contact response at seams and intersections."}, "wear": {"edgeWear": 0, "scratches": [], "chips": []}, "dirt": {"amount": 0, "cavityBias": 0, "color": "#1A1614"}, "localOverrides": [{"id": "smoked-tint", "region": "all glazing", "roughness": 0.12, "opacity": 0.88, "evidenceRefs": ["front-three-quarter", "front", "rear-three-quarter"]}], "shaderNotes": ["Independent albedo, roughness, normal/height, and AO responses.", "Geometry carries all silhouette-defining relief."], "notes": "Values are reference-derived art-direction estimates for a real-time low-poly game asset.", "transmission": {"base": 1.0, "variation": 0.0}, "opacity": 0.88, "transparent": true, "doubleSided": true, "referenceMaterialId": "glass.clear", "materialFamily": "glass", "materialSubtype": "clear", "materialFinish": "polished", "materialReference": {"registry": "/private/tmp/img2threejs.Yr4879/repo/docs/materials/material-reference.json", "profileId": "glass.clear", "method": "family-subtype-finish", "confidence": 0.82, "sourceRefs": ["three.mesh-physical", "three.pmrem", "gltf.2", "khronos.transmission", "khronos.volume", "google.filament-pbr"], "requiredMaps": ["roughnessMap", "thicknessMap"], "optionalMaps": ["map", "normalMap", "transmissionMap"], "validationViews": ["neutral-studio", "environment-reflection", "backlight-transmission", "reference-beauty"]}, "ior": {"base": 1.5, "variation": 0.0}, "referencePbr": {"version": "1.0", "sourceImage": "/Users/ugshanyu/usion-racing/docs/img2threejs/classic-911/material-evidence/01-smoked-window-glass.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.909, "estimatedFidelity": 0.909, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "/Users/ugshanyu/usion-racing/docs/img2threejs/classic-911/material-evidence/pbr-01-smoked-window-glass/window-glass_albedo.png", "url": "window-glass_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "/Users/ugshanyu/usion-racing/docs/img2threejs/classic-911/material-evidence/pbr-01-smoked-window-glass/window-glass_roughness.png", "url": "window-glass_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "/Users/ugshanyu/usion-racing/docs/img2threejs/classic-911/material-evidence/pbr-01-smoked-window-glass/window-glass_height.png", "url": "window-glass_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "/Users/ugshanyu/usion-racing/docs/img2threejs/classic-911/material-evidence/pbr-01-smoked-window-glass/window-glass_normal.png", "url": "window-glass_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "/Users/ugshanyu/usion-racing/docs/img2threejs/classic-911/material-evidence/pbr-01-smoked-window-glass/window-glass_ao.png", "url": "window-glass_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 210, "sourceHeight": 132, "mapSize": 512, "cropBBoxPixels": {"x": 0, "y": 24, "width": 210, "height": 108}, "mask": {"backgroundColor": "#DEDAD7", "backgroundNoise": 289.354, "transparentPixelFraction": 0.0, "foregroundCoverage": 0.2242}, "mapStats": {"valueRange": 0.5034, "heightP90Gradient": 0.08087, "roughnessBase": 0.68, "roughnessVariation": 0.134, "normalStrength": 0.251, "blurRadius": 10}, "palette": ["#EC4E4B", "#DD2925", "#231F1D", "#9A1C19", "#E97C79"]}, "warnings": []}, "textureAnalysis": {"finishClass": "painted-metal", "recipe": {"metalness": 0.0, "roughness": 0.5, "clearcoat": 1.0, "clearcoatRoughness": 0.05, "transmission": 0.0, "ior": 1.5, "envMapIntensity": 1.0, "anisotropy": 0.0, "procedural": "flat-clearcoat"}, "palette": ["#DEBFBA", "#4D3736", "#645959", "#463C3C", "#A12320"], "paletteHueRisk": [], "gradientAxis": "vertical", "stats": {"meanLum": 79.7, "meanSaturation": 0.2, "gradientStrength": 0.615, "mottle": 0.033, "streakRatio": 0.86, "hueSpread": 0.064, "specularFraction": 0.0}}, "materialEvidence": {"componentId": "glazing", "regionId": "smoked-window-glass", "crop": {"path": "/Users/ugshanyu/usion-racing/docs/img2threejs/classic-911/material-evidence/01-smoked-window-glass.png", "bbox": {"x": 280, "y": 185, "width": 210, "height": 132}, "sourceWidth": 627, "sourceHeight": 627, "loaderWarnings": [], "coverage": 0.0705}, "observations": ["chromatic base-colour response", "strong image-space gradient; verify it is material pattern, not lighting", "single-image PBR inference requires controlled render validation"], "hypothesis": {"componentId": "glazing", "regionId": "smoked-window-glass", "materialId": null, "family": "glass", "subtype": "clear", "finish": "polished", "aliases": [], "confidence": 0.82, "source": "four admitted concept views"}, "alternatives": []}, "needsEnvironment": true},
    options
  );
  materialMap["tire-rubber"] = createSculptMaterial(
    "tire-rubber",
    {"id": "tire-rubber", "name": "Matte tire rubber", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#111315", "color": "#111315", "albedo": {"dominant": "#111315", "secondary": ["#262728"], "samplingNotes": "Sampled and cross-checked from the four admitted concept views; studio highlights are not baked into albedo."}, "colorVariation": {"palette": ["#111315", "#262728"], "pattern": "low-amplitude procedural variation", "amplitude": 0.04, "heightCorrelation": 0}, "textureResolution": 1024, "textureProjection": {"mode": "object-space procedural", "repeat": [1, 1], "anisotropy": 8, "texelDensityIntent": "Stable object-space density; no image projection or lighting bake."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 1, "amplitude": 0.04, "role": "broad value variation without changing identity color"}, {"id": "meso", "frequency": 12, "amplitude": 0.08, "role": "molded, brushed, or coated surface breakup"}, {"id": "micro", "frequency": 64, "amplitude": 0.045, "role": "grazing-angle highlight breakup"}], "roughness": {"base": 0.88, "variation": 0.08, "map": "independent-procedural-roughness-field"}, "metalness": {"base": 0.0, "variation": 0}, "normal": {"pattern": "molded-rubber-micrograin", "strength": 0.16, "scale": 48, "space": "tangent"}, "bump": {"pattern": "independent-height-field", "amplitude": 0.018, "scale": 36}, "displacement": {"pattern": "none", "amplitude": 0, "scale": 1, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.22, "contactShadowBias": 0.32, "notes": "Independent cavity and contact response at seams and intersections."}, "wear": {"edgeWear": 0, "scratches": [], "chips": []}, "dirt": {"amount": 0, "cavityBias": 0, "color": "#1A1614"}, "localOverrides": [], "shaderNotes": ["Independent albedo, roughness, normal/height, and AO responses.", "Geometry carries all silhouette-defining relief."], "notes": "Values are reference-derived art-direction estimates for a real-time low-poly game asset.", "referenceMaterialId": "rubber.matte", "materialFamily": "rubber", "materialSubtype": "generic-elastomer", "materialFinish": "matte", "materialReference": {"registry": "/private/tmp/img2threejs.Yr4879/repo/docs/materials/material-reference.json", "profileId": "rubber.matte", "method": "family-subtype-finish", "confidence": 0.836, "sourceRefs": ["three.mesh-standard", "adobe.pbr-guide-1", "google.filament-pbr", "mit.material-recognition"], "requiredMaps": ["map", "roughnessMap", "normalMap"], "optionalMaps": ["aoMap"], "validationViews": ["albedo-unlit", "neutral-studio", "grazing", "reference-beauty"]}, "ior": {"base": 1.48, "variation": 0.0}, "referencePbr": {"version": "1.0", "sourceImage": "/Users/ugshanyu/usion-racing/docs/img2threejs/classic-911/material-evidence/02-tire-rubber.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.836, "estimatedFidelity": 0.836, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "/Users/ugshanyu/usion-racing/docs/img2threejs/classic-911/material-evidence/pbr-02-tire-rubber/tire-rubber_albedo.png", "url": "tire-rubber_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "/Users/ugshanyu/usion-racing/docs/img2threejs/classic-911/material-evidence/pbr-02-tire-rubber/tire-rubber_roughness.png", "url": "tire-rubber_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "/Users/ugshanyu/usion-racing/docs/img2threejs/classic-911/material-evidence/pbr-02-tire-rubber/tire-rubber_height.png", "url": "tire-rubber_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "/Users/ugshanyu/usion-racing/docs/img2threejs/classic-911/material-evidence/pbr-02-tire-rubber/tire-rubber_normal.png", "url": "tire-rubber_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "/Users/ugshanyu/usion-racing/docs/img2threejs/classic-911/material-evidence/pbr-02-tire-rubber/tire-rubber_ao.png", "url": "tire-rubber_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 100, "sourceHeight": 102, "mapSize": 512, "cropBBoxPixels": {"x": 0, "y": 0, "width": 100, "height": 99}, "mask": {"backgroundColor": "#D2CCC8", "backgroundNoise": 281.777, "transparentPixelFraction": 0.0, "foregroundCoverage": 0.1076}, "mapStats": {"valueRange": 0.1861, "heightP90Gradient": 0.03547, "roughnessBase": 0.68, "roughnessVariation": 0.05, "normalStrength": 0.198, "blurRadius": 10}, "palette": ["#080705", "#040302", "#13110E", "#231815", "#A91511"]}, "warnings": ["low value range weakens height/roughness inference"]}, "textureAnalysis": {"finishClass": "worn-composite", "recipe": {"metalness": 0.0, "roughness": 0.9, "clearcoat": 0.0, "clearcoatRoughness": 0.0, "transmission": 0.0, "ior": 1.5, "envMapIntensity": 0.5, "anisotropy": 0.0, "procedural": "mottle"}, "palette": ["#5B322F", "#32312E", "#5D5B58", "#73706D", "#53524F"], "paletteHueRisk": [], "gradientAxis": "horizontal", "stats": {"meanLum": 81.5, "meanSaturation": 0.106, "gradientStrength": 0.289, "mottle": 0.062, "streakRatio": 0.94, "hueSpread": 0.184, "specularFraction": 0.0}}, "materialEvidence": {"componentId": "wheels", "regionId": "tire-rubber", "crop": {"path": "/Users/ugshanyu/usion-racing/docs/img2threejs/classic-911/material-evidence/02-tire-rubber.png", "bbox": {"x": 95, "y": 326, "width": 100, "height": 102}, "sourceWidth": 627, "sourceHeight": 627, "loaderWarnings": [], "coverage": 0.0259}, "observations": ["near-neutral colour response", "visible meso/micro variation", "strong image-space gradient; verify it is material pattern, not lighting", "single-image PBR inference requires controlled render validation"], "hypothesis": {"componentId": "wheels", "regionId": "tire-rubber", "materialId": null, "family": "rubber", "subtype": "generic-elastomer", "finish": "matte", "aliases": [], "confidence": 0.836, "source": "admitted side view"}, "alternatives": []}},
    options
  );
  materialMap["wheel-metal"] = createSculptMaterial(
    "wheel-metal",
    {"id": "wheel-metal", "name": "Satin five-spoke wheel metal", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#B7BCC1", "color": "#B7BCC1", "albedo": {"dominant": "#B7BCC1", "secondary": ["#5C646C"], "samplingNotes": "Sampled and cross-checked from the four admitted concept views; studio highlights are not baked into albedo."}, "colorVariation": {"palette": ["#B7BCC1", "#5C646C"], "pattern": "low-amplitude procedural variation", "amplitude": 0.04, "heightCorrelation": 0}, "textureResolution": 1024, "textureProjection": {"mode": "object-space procedural", "repeat": [1, 1], "anisotropy": 8, "texelDensityIntent": "Stable object-space density; no image projection or lighting bake."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 1, "amplitude": 0.04, "role": "broad value variation without changing identity color"}, {"id": "meso", "frequency": 12, "amplitude": 0.02, "role": "molded, brushed, or coated surface breakup"}, {"id": "micro", "frequency": 64, "amplitude": 0.012, "role": "grazing-angle highlight breakup"}], "roughness": {"base": 0.3, "variation": 0.08, "map": "independent-procedural-roughness-field"}, "metalness": {"base": 1.0, "variation": 0}, "normal": {"pattern": "independent-fine-surface-field", "strength": 0.035, "scale": 48, "space": "tangent"}, "bump": {"pattern": "independent-height-field", "amplitude": 0.003, "scale": 36}, "displacement": {"pattern": "none", "amplitude": 0, "scale": 1, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.22, "contactShadowBias": 0.32, "notes": "Independent cavity and contact response at seams and intersections."}, "wear": {"edgeWear": 0, "scratches": [], "chips": []}, "dirt": {"amount": 0, "cavityBias": 0, "color": "#1A1614"}, "localOverrides": [], "shaderNotes": ["Independent albedo, roughness, normal/height, and AO responses.", "Geometry carries all silhouette-defining relief."], "notes": "Values are reference-derived art-direction estimates for a real-time low-poly game asset.", "referenceMaterialId": "metal.aluminum", "materialFamily": "metal", "materialSubtype": "aluminum", "materialFinish": "satin", "materialReference": {"registry": "/private/tmp/img2threejs.Yr4879/repo/docs/materials/material-reference.json", "profileId": "metal.aluminum", "method": "family-subtype-finish", "confidence": 0.9, "sourceRefs": ["three.mesh-standard", "three.pmrem", "gltf.2", "khronos.gltf-pbr", "adobe.pbr-guide-2", "google.filament-pbr"], "requiredMaps": ["map", "roughnessMap"], "optionalMaps": ["normalMap", "anisotropyMap"], "validationViews": ["neutral-studio", "environment-reflection", "grazing"]}, "anisotropy": {"base": 0.2, "variation": 0.0}, "referencePbr": {"version": "1.0", "sourceImage": "/Users/ugshanyu/usion-racing/docs/img2threejs/classic-911/material-evidence/03-silver-wheel-metal.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.909, "estimatedFidelity": 0.909, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "/Users/ugshanyu/usion-racing/docs/img2threejs/classic-911/material-evidence/pbr-03-silver-wheel-metal/wheel-metal_albedo.png", "url": "wheel-metal_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "/Users/ugshanyu/usion-racing/docs/img2threejs/classic-911/material-evidence/pbr-03-silver-wheel-metal/wheel-metal_roughness.png", "url": "wheel-metal_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "/Users/ugshanyu/usion-racing/docs/img2threejs/classic-911/material-evidence/pbr-03-silver-wheel-metal/wheel-metal_height.png", "url": "wheel-metal_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "/Users/ugshanyu/usion-racing/docs/img2threejs/classic-911/material-evidence/pbr-03-silver-wheel-metal/wheel-metal_normal.png", "url": "wheel-metal_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "/Users/ugshanyu/usion-racing/docs/img2threejs/classic-911/material-evidence/pbr-03-silver-wheel-metal/wheel-metal_ao.png", "url": "wheel-metal_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 58, "sourceHeight": 58, "mapSize": 512, "cropBBoxPixels": {"x": 3, "y": 0, "width": 55, "height": 58}, "mask": {"backgroundColor": "#43413D", "backgroundNoise": 50.892, "transparentPixelFraction": 0.0, "foregroundCoverage": 0.4777}, "mapStats": {"valueRange": 0.7011, "heightP90Gradient": 0.07735, "roughnessBase": 0.699, "roughnessVariation": 0.132, "normalStrength": 0.247, "blurRadius": 10}, "palette": ["#A29E9A", "#918E8A", "#B3B0AC", "#13110F", "#CFCDC9"]}, "warnings": []}, "textureAnalysis": {"finishClass": "worn-composite", "recipe": {"metalness": 0.0, "roughness": 0.9, "clearcoat": 0.0, "clearcoatRoughness": 0.0, "transmission": 0.0, "ior": 1.5, "envMapIntensity": 0.5, "anisotropy": 0.0, "procedural": "mottle"}, "palette": ["#8C8A88", "#85837F", "#72706D", "#3F3E3B", "#363533"], "paletteHueRisk": [], "gradientAxis": "vertical", "stats": {"meanLum": 106.0, "meanSaturation": 0.073, "gradientStrength": 0.392, "mottle": 0.053, "streakRatio": 0.93, "hueSpread": 0.154, "specularFraction": 0.0}}, "materialEvidence": {"componentId": "wheels", "regionId": "silver-wheel-metal", "crop": {"path": "/Users/ugshanyu/usion-racing/docs/img2threejs/classic-911/material-evidence/03-silver-wheel-metal.png", "bbox": {"x": 118, "y": 349, "width": 58, "height": 58}, "sourceWidth": 627, "sourceHeight": 627, "loaderWarnings": [], "coverage": 0.0086}, "observations": ["near-neutral colour response", "visible meso/micro variation", "strong image-space gradient; verify it is material pattern, not lighting", "single-image PBR inference requires controlled render validation"], "hypothesis": {"componentId": "wheels", "regionId": "silver-wheel-metal", "materialId": null, "family": "metal", "subtype": "aluminum", "finish": "satin", "aliases": [], "confidence": 0.9, "source": "admitted side view"}, "alternatives": []}, "needsEnvironment": true},
    options
  );
  materialMap["black-trim"] = createSculptMaterial(
    "black-trim",
    {"id": "black-trim", "name": "Black impact trim", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#151719", "color": "#151719", "albedo": {"dominant": "#151719", "secondary": ["#2D2F31"], "samplingNotes": "Sampled and cross-checked from the four admitted concept views; studio highlights are not baked into albedo."}, "colorVariation": {"palette": ["#151719", "#2D2F31"], "pattern": "low-amplitude procedural variation", "amplitude": 0.04, "heightCorrelation": 0}, "textureResolution": 1024, "textureProjection": {"mode": "object-space procedural", "repeat": [1, 1], "anisotropy": 8, "texelDensityIntent": "Stable object-space density; no image projection or lighting bake."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 1, "amplitude": 0.04, "role": "broad value variation without changing identity color"}, {"id": "meso", "frequency": 12, "amplitude": 0.02, "role": "molded, brushed, or coated surface breakup"}, {"id": "micro", "frequency": 64, "amplitude": 0.012, "role": "grazing-angle highlight breakup"}], "roughness": {"base": 0.7, "variation": 0.05, "map": "independent-procedural-roughness-field"}, "metalness": {"base": 0, "variation": 0}, "normal": {"pattern": "independent-fine-surface-field", "strength": 0.035, "scale": 48, "space": "tangent"}, "bump": {"pattern": "independent-height-field", "amplitude": 0.003, "scale": 36}, "displacement": {"pattern": "none", "amplitude": 0, "scale": 1, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.22, "contactShadowBias": 0.32, "notes": "Independent cavity and contact response at seams and intersections."}, "wear": {"edgeWear": 0, "scratches": [], "chips": []}, "dirt": {"amount": 0, "cavityBias": 0, "color": "#1A1614"}, "localOverrides": [], "shaderNotes": ["Independent albedo, roughness, normal/height, and AO responses.", "Geometry carries all silhouette-defining relief."], "notes": "Values are reference-derived art-direction estimates for a real-time low-poly game asset.", "qualityTier": "utility"},
    options
  );
  materialMap["headlamp-lens"] = createSculptMaterial(
    "headlamp-lens",
    {"id": "headlamp-lens", "name": "Ivory headlamp lenses", "type": "physical", "shaderModel": "MeshPhysicalMaterial", "baseColor": "#FFF6CF", "color": "#FFF6CF", "albedo": {"dominant": "#FFF6CF", "secondary": ["#FFD87C"], "samplingNotes": "Sampled and cross-checked from the four admitted concept views; studio highlights are not baked into albedo."}, "colorVariation": {"palette": ["#FFF6CF", "#FFD87C"], "pattern": "low-amplitude procedural variation", "amplitude": 0.04, "heightCorrelation": 0}, "textureResolution": 1024, "textureProjection": {"mode": "object-space procedural", "repeat": [1, 1], "anisotropy": 8, "texelDensityIntent": "Stable object-space density; no image projection or lighting bake."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 1, "amplitude": 0.04, "role": "broad value variation without changing identity color"}, {"id": "meso", "frequency": 12, "amplitude": 0.02, "role": "molded, brushed, or coated surface breakup"}, {"id": "micro", "frequency": 64, "amplitude": 0.012, "role": "grazing-angle highlight breakup"}], "roughness": {"base": 0.18, "variation": 0.03, "map": "independent-procedural-roughness-field"}, "metalness": {"base": 0, "variation": 0}, "normal": {"pattern": "independent-fine-surface-field", "strength": 0.035, "scale": 48, "space": "tangent"}, "bump": {"pattern": "independent-height-field", "amplitude": 0.003, "scale": 36}, "displacement": {"pattern": "none", "amplitude": 0, "scale": 1, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.22, "contactShadowBias": 0.32, "notes": "Independent cavity and contact response at seams and intersections."}, "wear": {"edgeWear": 0, "scratches": [], "chips": []}, "dirt": {"amount": 0, "cavityBias": 0, "color": "#1A1614"}, "localOverrides": [], "shaderNotes": ["Independent albedo, roughness, normal/height, and AO responses.", "Geometry carries all silhouette-defining relief."], "notes": "Values are reference-derived art-direction estimates for a real-time low-poly game asset.", "qualityTier": "utility", "emissive": "#FFD87C", "emissiveIntensity": 0.45, "transparent": true, "opacity": 0.96},
    options
  );
  materialMap["amber-lens"] = createSculptMaterial(
    "amber-lens",
    {"id": "amber-lens", "name": "Amber indicator lenses", "type": "physical", "shaderModel": "MeshPhysicalMaterial", "baseColor": "#FF8D10", "color": "#FF8D10", "albedo": {"dominant": "#FF8D10", "secondary": ["#7A2600"], "samplingNotes": "Sampled and cross-checked from the four admitted concept views; studio highlights are not baked into albedo."}, "colorVariation": {"palette": ["#FF8D10", "#7A2600"], "pattern": "low-amplitude procedural variation", "amplitude": 0.04, "heightCorrelation": 0}, "textureResolution": 1024, "textureProjection": {"mode": "object-space procedural", "repeat": [1, 1], "anisotropy": 8, "texelDensityIntent": "Stable object-space density; no image projection or lighting bake."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 1, "amplitude": 0.04, "role": "broad value variation without changing identity color"}, {"id": "meso", "frequency": 12, "amplitude": 0.02, "role": "molded, brushed, or coated surface breakup"}, {"id": "micro", "frequency": 64, "amplitude": 0.012, "role": "grazing-angle highlight breakup"}], "roughness": {"base": 0.28, "variation": 0.04, "map": "independent-procedural-roughness-field"}, "metalness": {"base": 0, "variation": 0}, "normal": {"pattern": "independent-fine-surface-field", "strength": 0.035, "scale": 48, "space": "tangent"}, "bump": {"pattern": "independent-height-field", "amplitude": 0.003, "scale": 36}, "displacement": {"pattern": "none", "amplitude": 0, "scale": 1, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.22, "contactShadowBias": 0.32, "notes": "Independent cavity and contact response at seams and intersections."}, "wear": {"edgeWear": 0, "scratches": [], "chips": []}, "dirt": {"amount": 0, "cavityBias": 0, "color": "#1A1614"}, "localOverrides": [], "shaderNotes": ["Independent albedo, roughness, normal/height, and AO responses.", "Geometry carries all silhouette-defining relief."], "notes": "Values are reference-derived art-direction estimates for a real-time low-poly game asset.", "qualityTier": "utility", "emissive": "#7A2600", "emissiveIntensity": 0.28, "transparent": true, "opacity": 0.96},
    options
  );
  materialMap["tail-lens"] = createSculptMaterial(
    "tail-lens",
    {"id": "tail-lens", "name": "Dark red tail-lamp lenses", "type": "physical", "shaderModel": "MeshPhysicalMaterial", "baseColor": "#8C0908", "color": "#8C0908", "albedo": {"dominant": "#8C0908", "secondary": ["#3A0000"], "samplingNotes": "Sampled and cross-checked from the four admitted concept views; studio highlights are not baked into albedo."}, "colorVariation": {"palette": ["#8C0908", "#3A0000"], "pattern": "low-amplitude procedural variation", "amplitude": 0.04, "heightCorrelation": 0}, "textureResolution": 1024, "textureProjection": {"mode": "object-space procedural", "repeat": [1, 1], "anisotropy": 8, "texelDensityIntent": "Stable object-space density; no image projection or lighting bake."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 1, "amplitude": 0.04, "role": "broad value variation without changing identity color"}, {"id": "meso", "frequency": 12, "amplitude": 0.02, "role": "molded, brushed, or coated surface breakup"}, {"id": "micro", "frequency": 64, "amplitude": 0.012, "role": "grazing-angle highlight breakup"}], "roughness": {"base": 0.3, "variation": 0.04, "map": "independent-procedural-roughness-field"}, "metalness": {"base": 0, "variation": 0}, "normal": {"pattern": "independent-fine-surface-field", "strength": 0.035, "scale": 48, "space": "tangent"}, "bump": {"pattern": "independent-height-field", "amplitude": 0.003, "scale": 36}, "displacement": {"pattern": "none", "amplitude": 0, "scale": 1, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.22, "contactShadowBias": 0.32, "notes": "Independent cavity and contact response at seams and intersections."}, "wear": {"edgeWear": 0, "scratches": [], "chips": []}, "dirt": {"amount": 0, "cavityBias": 0, "color": "#1A1614"}, "localOverrides": [], "shaderNotes": ["Independent albedo, roughness, normal/height, and AO responses.", "Geometry carries all silhouette-defining relief."], "notes": "Values are reference-derived art-direction estimates for a real-time low-poly game asset.", "qualityTier": "utility", "emissive": "#5A0000", "emissiveIntensity": 0.28, "transparent": true, "opacity": 0.96},
    options
  );

  const nodes: Record<string, THREE.Object3D> = { root };
  const meshes: Record<string, THREE.Mesh> = {};
  const sockets: Record<string, THREE.Object3D> = {};
  const colliders: Record<string, unknown> = {};
  const destructionGroups: Record<string, THREE.Object3D[]> = {};

  const attachment_root_0 = null;
  const endpoint_root_0 = makeAttachmentEndpoint(attachment_root_0);
  const node_root_0 = new THREE.Group();
  node_root_0.name = "Classic 911 Style Coupe Root__pivot";
  node_root_0.scale.set(1, 1, 1);
  if (endpoint_root_0) {
    node_root_0.position.copy(endpoint_root_0.start);
    node_root_0.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_root_0.position.set(0.0, 0.0, 0.0);
    node_root_0.rotation.set(0.0, 0.0, 0.0);
  }
  node_root_0.userData.sculptComponent = {"id": "root", "name": "Classic 911 Style Coupe Root", "level": "macro", "role": "root", "importance": 1, "confidence": 0.9, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "The game asset needs one stable transform root even though the visible car is assembled from named body, glazing, lighting, trim, and wheel branches.", "geometryDescriptor": {"topologyIntent": "Reference-shaped real-time geometry with stable named surfaces.", "edgeTreatment": {"type": "small chamfer where visible", "bevelRadius": 0.015, "segments": 2}, "deformationStack": [], "uvStrategy": "object-space procedural coordinates; no photographic projection", "normalStrategy": "indexed vertex normals with deliberate faceted low-poly transitions"}, "parent": null, "attachment": null, "dimensions": {"width": 1.48, "height": 0.78, "depth": 3, "units": "game-model", "confidence": 0.88}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "body-mount", "localPosition": [0, 0.32, 0], "localRotation": [0, 0, 0]}, {"id": "front-axle", "localPosition": [0, 0.28, 0.82], "localRotation": [0, 0, 0]}, {"id": "rear-axle", "localPosition": [0, 0.28, -0.82], "localRotation": [0, 0, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.48, 0.78, 3], "isTrigger": false, "notes": "Simplified runtime proxy; the game continues to use its local sphere physics body."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "black-trim"}}, "material": "black-trim", "materialLayers": ["black-trim"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(21, 23, 25, 1)", "secondaryAlbedo": "rgba(45, 47, 49, 1)", "materialClass": "plastic", "materialClassConfidence": 0.92, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(21, 23, 25, 1)"}, {"position": 1, "color": "rgba(45, 47, 49, 1)"}]}, "evidenceRefs": ["front-three-quarter", "side", "front", "rear-three-quarter"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["stable-game-root", "body-and-wheel-pivot-hierarchy"], "surfaceDetail": {"macroRoughness": 0.03, "microRoughness": 0.04, "bumpAmplitude": 0.003, "normalPattern": "independent material microstructure", "displacementPattern": "none", "occlusionPattern": "cavity and contact only", "edgeWearPattern": "none", "notes": "Reference is a clean stylized concept."}, "evidenceRefs": ["front-three-quarter", "side", "front", "rear-three-quarter"], "details": ["stable-game-root", "body-and-wheel-pivot-hierarchy"], "fidelityTier": "blockout"};
  node_root_0.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "body-mount", "localPosition": [0, 0.32, 0], "localRotation": [0, 0, 0]}, {"id": "front-axle", "localPosition": [0, 0.28, 0.82], "localRotation": [0, 0, 0]}, {"id": "rear-axle", "localPosition": [0, 0.28, -0.82], "localRotation": [0, 0, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.48, 0.78, 3], "isTrigger": false, "notes": "Simplified runtime proxy; the game continues to use its local sphere physics body."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "black-trim"}};
  (nodes["root"] ?? root).add(node_root_0);
  nodes["root"] = node_root_0;
  const mesh_root_0Geometry = endpoint_root_0
    ? new THREE.CylinderGeometry(endpoint_root_0.endRadius, endpoint_root_0.baseRadius, endpoint_root_0.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_root_0) {
    mesh_root_0Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_root_0 = new THREE.Mesh(
    mesh_root_0Geometry,
    materialMap["black-trim"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_root_0.name = "Classic 911 Style Coupe Root";
  if (endpoint_root_0) {
    mesh_root_0.position.copy(endpoint_root_0.midpoint);
    mesh_root_0.quaternion.copy(endpoint_root_0.quaternion);
  }
  mesh_root_0.castShadow = options.castShadow ?? true;
  mesh_root_0.receiveShadow = options.receiveShadow ?? true;
  mesh_root_0.userData.sculptComponent = {"id": "root", "name": "Classic 911 Style Coupe Root", "level": "macro", "role": "root", "importance": 1, "confidence": 0.9, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "The game asset needs one stable transform root even though the visible car is assembled from named body, glazing, lighting, trim, and wheel branches.", "geometryDescriptor": {"topologyIntent": "Reference-shaped real-time geometry with stable named surfaces.", "edgeTreatment": {"type": "small chamfer where visible", "bevelRadius": 0.015, "segments": 2}, "deformationStack": [], "uvStrategy": "object-space procedural coordinates; no photographic projection", "normalStrategy": "indexed vertex normals with deliberate faceted low-poly transitions"}, "parent": null, "attachment": null, "dimensions": {"width": 1.48, "height": 0.78, "depth": 3, "units": "game-model", "confidence": 0.88}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "body-mount", "localPosition": [0, 0.32, 0], "localRotation": [0, 0, 0]}, {"id": "front-axle", "localPosition": [0, 0.28, 0.82], "localRotation": [0, 0, 0]}, {"id": "rear-axle", "localPosition": [0, 0.28, -0.82], "localRotation": [0, 0, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.48, 0.78, 3], "isTrigger": false, "notes": "Simplified runtime proxy; the game continues to use its local sphere physics body."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "black-trim"}}, "material": "black-trim", "materialLayers": ["black-trim"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(21, 23, 25, 1)", "secondaryAlbedo": "rgba(45, 47, 49, 1)", "materialClass": "plastic", "materialClassConfidence": 0.92, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(21, 23, 25, 1)"}, {"position": 1, "color": "rgba(45, 47, 49, 1)"}]}, "evidenceRefs": ["front-three-quarter", "side", "front", "rear-three-quarter"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["stable-game-root", "body-and-wheel-pivot-hierarchy"], "surfaceDetail": {"macroRoughness": 0.03, "microRoughness": 0.04, "bumpAmplitude": 0.003, "normalPattern": "independent material microstructure", "displacementPattern": "none", "occlusionPattern": "cavity and contact only", "edgeWearPattern": "none", "notes": "Reference is a clean stylized concept."}, "evidenceRefs": ["front-three-quarter", "side", "front", "rear-three-quarter"], "details": ["stable-game-root", "body-and-wheel-pivot-hierarchy"], "fidelityTier": "blockout"};
  node_root_0.add(mesh_root_0);
  meshes["root"] = mesh_root_0;
  colliders["root"] = {"type": "box", "offset": [0, 0, 0], "scale": [1.48, 0.78, 3], "isTrigger": false, "notes": "Simplified runtime proxy; the game continues to use its local sphere physics body."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_root_0);
  const socket_root_body_mount_0 = new THREE.Object3D();
  socket_root_body_mount_0.name = "body-mount";
  socket_root_body_mount_0.position.set(0.0, 0.32, 0.0);
  socket_root_body_mount_0.rotation.set(0.0, 0.0, 0.0);
  socket_root_body_mount_0.userData.socket = {"id": "body-mount", "localPosition": [0, 0.32, 0], "localRotation": [0, 0, 0]};
  node_root_0.add(socket_root_body_mount_0);
  sockets["root:body-mount"] = socket_root_body_mount_0;
  const socket_root_front_axle_1 = new THREE.Object3D();
  socket_root_front_axle_1.name = "front-axle";
  socket_root_front_axle_1.position.set(0.0, 0.28, 0.82);
  socket_root_front_axle_1.rotation.set(0.0, 0.0, 0.0);
  socket_root_front_axle_1.userData.socket = {"id": "front-axle", "localPosition": [0, 0.28, 0.82], "localRotation": [0, 0, 0]};
  node_root_0.add(socket_root_front_axle_1);
  sockets["root:front-axle"] = socket_root_front_axle_1;
  const socket_root_rear_axle_2 = new THREE.Object3D();
  socket_root_rear_axle_2.name = "rear-axle";
  socket_root_rear_axle_2.position.set(0.0, 0.28, -0.82);
  socket_root_rear_axle_2.rotation.set(0.0, 0.0, 0.0);
  socket_root_rear_axle_2.userData.socket = {"id": "rear-axle", "localPosition": [0, 0.28, -0.82], "localRotation": [0, 0, 0]};
  node_root_0.add(socket_root_rear_axle_2);
  sockets["root:rear-axle"] = socket_root_rear_axle_2;

  const attachment_body_shell_1 = {"parentId": "root", "parentSocket": "root-surface", "localStart": [0, 0.34, 0], "localEnd": [0, 0.38, 0], "contactType": "embedded-or-bolted", "overlap": 0.025, "gapTolerance": 0.008, "evidenceRefs": ["front-three-quarter", "side", "front", "rear-three-quarter"]};
  const endpoint_body_shell_1 = makeAttachmentEndpoint(attachment_body_shell_1);
  const node_body_shell_1 = new THREE.Group();
  node_body_shell_1.name = "Variable-section Unibody Shell__pivot";
  node_body_shell_1.scale.set(1, 1, 1);
  if (endpoint_body_shell_1) {
    node_body_shell_1.position.copy(endpoint_body_shell_1.start);
    node_body_shell_1.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_body_shell_1.position.set(0.0, 0.34, 0.0);
    node_body_shell_1.rotation.set(0.0, 0.0, 0.0);
  }
  node_body_shell_1.userData.sculptComponent = {"id": "body-shell", "name": "Variable-section Unibody Shell", "level": "macro", "role": "body", "importance": 1, "confidence": 0.9, "primitive": "curve-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "All admitted views show one continuous compound painted body with changing width, hood valley, raised fender crowns, and fastback rear quarters; stacked boxes cannot preserve those transitions.", "geometryDescriptor": {"topologyIntent": "Dense longitudinal station loft with variable half-width, sill height, shoulder height, hood crown, and rear falloff; side faces are omitted inside both wheel openings and capped with painted arch lips.", "edgeTreatment": {"type": "small chamfer where visible", "bevelRadius": 0.015, "segments": 2}, "deformationStack": ["side-profile stations from admitted side view", "front-width stations from admitted front view", "faceted shoulder and hood valley planes", "boolean-like wheel-arch negative spaces"], "uvStrategy": "object-space procedural coordinates; no photographic projection", "normalStrategy": "indexed vertex normals with deliberate faceted low-poly transitions"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-surface", "localStart": [0, 0.34, 0], "localEnd": [0, 0.38, 0], "contactType": "embedded-or-bolted", "overlap": 0.025, "gapTolerance": 0.008, "evidenceRefs": ["front-three-quarter", "side", "front", "rear-three-quarter"]}, "dimensions": {"width": 1.43, "height": 0.58, "depth": 2.92, "units": "game-model", "confidence": 0.88}, "transform": {"position": [0, 0.34, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "body", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.43, 0.58, 2.92], "isTrigger": false, "notes": "Simplified runtime proxy; the game continues to use its local sphere physics body."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "black-trim"}}, "material": "body-paint", "materialLayers": ["body-paint"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(227, 38, 31, 1)", "secondaryAlbedo": "rgba(169, 15, 18, 1)", "materialClass": "plastic", "materialClassConfidence": 0.88, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(227, 38, 31, 1)"}, {"position": 1, "color": "rgba(169, 15, 18, 1)"}]}, "evidenceRefs": ["front-three-quarter", "side", "front", "rear-three-quarter"]}, "deformations": ["side-profile stations from admitted side view", "front-width stations from admitted front view", "faceted shoulder and hood valley planes", "boolean-like wheel-arch negative spaces"], "joints": [], "seams": [], "localFeatures": ["hood-center-valley", "front-wheel-arch", "rear-wheel-arch", "raised-fender-crowns", "fastback-rear-shoulders"], "surfaceDetail": {"macroRoughness": 0.03, "microRoughness": 0.04, "bumpAmplitude": 0.003, "normalPattern": "independent material microstructure", "displacementPattern": "none", "occlusionPattern": "cavity and contact only", "edgeWearPattern": "none", "notes": "Reference is a clean stylized concept."}, "evidenceRefs": ["front-three-quarter", "side", "front", "rear-three-quarter"], "details": ["hood-center-valley", "front-wheel-arch", "rear-wheel-arch", "raised-fender-crowns", "fastback-rear-shoulders"], "fidelityTier": "blockout", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "body-paint"}, "materialRegions": [{"regionId": "red-body-paint", "materialId": "body-paint", "profileId": "coating.painted-metal", "crop": {"path": "/Users/ugshanyu/usion-racing/docs/img2threejs/classic-911/material-evidence/00-red-body-paint.png", "bbox": {"x": 150, "y": 285, "width": 245, "height": 128}, "sourceWidth": 627, "sourceHeight": 627, "loaderWarnings": [], "coverage": 0.0798}}]};
  node_body_shell_1.userData.actionProfile = {"animationRole": "body", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.43, 0.58, 2.92], "isTrigger": false, "notes": "Simplified runtime proxy; the game continues to use its local sphere physics body."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "black-trim"}};
  (nodes["root"] ?? root).add(node_body_shell_1);
  nodes["body-shell"] = node_body_shell_1;
  const mesh_body_shell_1Geometry = endpoint_body_shell_1
    ? new THREE.CylinderGeometry(endpoint_body_shell_1.endRadius, endpoint_body_shell_1.baseRadius, endpoint_body_shell_1.length, 16, 6)
    : buildCurveSweepGeometry({"spine": [[-0.5, -0.4, 0.0], [-0.1, 0.1, 0.0], [0.3, 0.2, 0.0], [0.6, -0.1, 0.0]], "crossSection": {"points": [[-0.04, -0.02], [0.04, -0.02], [0.04, 0.02], [-0.04, 0.02]]}, "closed": false});
  if (!endpoint_body_shell_1) {
    mesh_body_shell_1Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_body_shell_1 = new THREE.Mesh(
    mesh_body_shell_1Geometry,
    materialMap["body-paint"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_body_shell_1.name = "Variable-section Unibody Shell";
  if (endpoint_body_shell_1) {
    mesh_body_shell_1.position.copy(endpoint_body_shell_1.midpoint);
    mesh_body_shell_1.quaternion.copy(endpoint_body_shell_1.quaternion);
  }
  mesh_body_shell_1.castShadow = options.castShadow ?? true;
  mesh_body_shell_1.receiveShadow = options.receiveShadow ?? true;
  mesh_body_shell_1.userData.sculptComponent = {"id": "body-shell", "name": "Variable-section Unibody Shell", "level": "macro", "role": "body", "importance": 1, "confidence": 0.9, "primitive": "curve-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "All admitted views show one continuous compound painted body with changing width, hood valley, raised fender crowns, and fastback rear quarters; stacked boxes cannot preserve those transitions.", "geometryDescriptor": {"topologyIntent": "Dense longitudinal station loft with variable half-width, sill height, shoulder height, hood crown, and rear falloff; side faces are omitted inside both wheel openings and capped with painted arch lips.", "edgeTreatment": {"type": "small chamfer where visible", "bevelRadius": 0.015, "segments": 2}, "deformationStack": ["side-profile stations from admitted side view", "front-width stations from admitted front view", "faceted shoulder and hood valley planes", "boolean-like wheel-arch negative spaces"], "uvStrategy": "object-space procedural coordinates; no photographic projection", "normalStrategy": "indexed vertex normals with deliberate faceted low-poly transitions"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-surface", "localStart": [0, 0.34, 0], "localEnd": [0, 0.38, 0], "contactType": "embedded-or-bolted", "overlap": 0.025, "gapTolerance": 0.008, "evidenceRefs": ["front-three-quarter", "side", "front", "rear-three-quarter"]}, "dimensions": {"width": 1.43, "height": 0.58, "depth": 2.92, "units": "game-model", "confidence": 0.88}, "transform": {"position": [0, 0.34, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "body", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.43, 0.58, 2.92], "isTrigger": false, "notes": "Simplified runtime proxy; the game continues to use its local sphere physics body."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "body", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "black-trim"}}, "material": "body-paint", "materialLayers": ["body-paint"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(227, 38, 31, 1)", "secondaryAlbedo": "rgba(169, 15, 18, 1)", "materialClass": "plastic", "materialClassConfidence": 0.88, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(227, 38, 31, 1)"}, {"position": 1, "color": "rgba(169, 15, 18, 1)"}]}, "evidenceRefs": ["front-three-quarter", "side", "front", "rear-three-quarter"]}, "deformations": ["side-profile stations from admitted side view", "front-width stations from admitted front view", "faceted shoulder and hood valley planes", "boolean-like wheel-arch negative spaces"], "joints": [], "seams": [], "localFeatures": ["hood-center-valley", "front-wheel-arch", "rear-wheel-arch", "raised-fender-crowns", "fastback-rear-shoulders"], "surfaceDetail": {"macroRoughness": 0.03, "microRoughness": 0.04, "bumpAmplitude": 0.003, "normalPattern": "independent material microstructure", "displacementPattern": "none", "occlusionPattern": "cavity and contact only", "edgeWearPattern": "none", "notes": "Reference is a clean stylized concept."}, "evidenceRefs": ["front-three-quarter", "side", "front", "rear-three-quarter"], "details": ["hood-center-valley", "front-wheel-arch", "rear-wheel-arch", "raised-fender-crowns", "fastback-rear-shoulders"], "fidelityTier": "blockout", "uvContract": {"status": "unwrapped", "strategy": "generated procedural coordinates", "materialId": "body-paint"}, "materialRegions": [{"regionId": "red-body-paint", "materialId": "body-paint", "profileId": "coating.painted-metal", "crop": {"path": "/Users/ugshanyu/usion-racing/docs/img2threejs/classic-911/material-evidence/00-red-body-paint.png", "bbox": {"x": 150, "y": 285, "width": 245, "height": 128}, "sourceWidth": 627, "sourceHeight": 627, "loaderWarnings": [], "coverage": 0.0798}}]};
  node_body_shell_1.add(mesh_body_shell_1);
  meshes["body-shell"] = mesh_body_shell_1;
  colliders["body-shell"] = {"type": "box", "offset": [0, 0, 0], "scale": [1.43, 0.58, 2.92], "isTrigger": false, "notes": "Simplified runtime proxy; the game continues to use its local sphere physics body."};
  destructionGroups["body"] ??= [];
  destructionGroups["body"].push(node_body_shell_1);

  const attachment_cabin_shell_2 = {"parentId": "body-shell", "parentSocket": "body-shell-surface", "localStart": [0, 0.65, -0.18], "localEnd": [0, 0.6900000000000001, -0.18], "contactType": "embedded-or-bolted", "overlap": 0.025, "gapTolerance": 0.008, "evidenceRefs": ["front-three-quarter", "side", "front", "rear-three-quarter"]};
  const endpoint_cabin_shell_2 = makeAttachmentEndpoint(attachment_cabin_shell_2);
  const node_cabin_shell_2 = new THREE.Group();
  node_cabin_shell_2.name = "Fastback Roof and Pillar Shell__pivot";
  node_cabin_shell_2.scale.set(1, 1, 1);
  if (endpoint_cabin_shell_2) {
    node_cabin_shell_2.position.copy(endpoint_cabin_shell_2.start);
    node_cabin_shell_2.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_cabin_shell_2.position.set(0.0, 0.65, -0.18);
    node_cabin_shell_2.rotation.set(0.0, 0.0, 0.0);
  }
  node_cabin_shell_2.userData.sculptComponent = {"id": "cabin-shell", "name": "Fastback Roof and Pillar Shell", "level": "macro", "role": "cabin", "importance": 1, "confidence": 0.9, "primitive": "curve-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "The roof, pillars, and rear deck follow a continuous arched coupe envelope visible across all views, with a wide windshield and tapering rear quarter.", "geometryDescriptor": {"topologyIntent": "Variable-width roof loft with separate inset glazing surfaces and explicit A/B/C pillar bands.", "edgeTreatment": {"type": "small chamfer where visible", "bevelRadius": 0.015, "segments": 2}, "deformationStack": ["windshield rake", "flat roof crown", "fastback falloff", "rear-quarter taper"], "uvStrategy": "object-space procedural coordinates; no photographic projection", "normalStrategy": "indexed vertex normals with deliberate faceted low-poly transitions"}, "parent": "body-shell", "attachment": {"parentId": "body-shell", "parentSocket": "body-shell-surface", "localStart": [0, 0.65, -0.18], "localEnd": [0, 0.6900000000000001, -0.18], "contactType": "embedded-or-bolted", "overlap": 0.025, "gapTolerance": 0.008, "evidenceRefs": ["front-three-quarter", "side", "front", "rear-three-quarter"]}, "dimensions": {"width": 1.08, "height": 0.62, "depth": 1.66, "units": "game-model", "confidence": 0.88}, "transform": {"position": [0, 0.65, -0.18], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "cabin", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.08, 0.62, 1.66], "isTrigger": false, "notes": "Simplified runtime proxy; the game continues to use its local sphere physics body."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "cabin", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "black-trim"}}, "material": "body-paint", "materialLayers": ["body-paint"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(227, 38, 31, 1)", "secondaryAlbedo": "rgba(169, 15, 18, 1)", "materialClass": "plastic", "materialClassConfidence": 0.88, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(227, 38, 31, 1)"}, {"position": 1, "color": "rgba(169, 15, 18, 1)"}]}, "evidenceRefs": ["front-three-quarter", "side", "front", "rear-three-quarter"]}, "deformations": ["windshield rake", "flat roof crown", "fastback falloff", "rear-quarter taper"], "joints": [], "seams": [], "localFeatures": ["upright-a-pillars", "near-flat-roof-crown", "continuous-fastback-arc", "painted-b-and-c-pillars"], "surfaceDetail": {"macroRoughness": 0.03, "microRoughness": 0.04, "bumpAmplitude": 0.003, "normalPattern": "independent material microstructure", "displacementPattern": "none", "occlusionPattern": "cavity and contact only", "edgeWearPattern": "none", "notes": "Reference is a clean stylized concept."}, "evidenceRefs": ["front-three-quarter", "side", "front", "rear-three-quarter"], "details": ["upright-a-pillars", "near-flat-roof-crown", "continuous-fastback-arc", "painted-b-and-c-pillars"], "fidelityTier": "blockout"};
  node_cabin_shell_2.userData.actionProfile = {"animationRole": "cabin", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.08, 0.62, 1.66], "isTrigger": false, "notes": "Simplified runtime proxy; the game continues to use its local sphere physics body."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "cabin", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "black-trim"}};
  (nodes["body-shell"] ?? root).add(node_cabin_shell_2);
  nodes["cabin-shell"] = node_cabin_shell_2;
  const mesh_cabin_shell_2Geometry = endpoint_cabin_shell_2
    ? new THREE.CylinderGeometry(endpoint_cabin_shell_2.endRadius, endpoint_cabin_shell_2.baseRadius, endpoint_cabin_shell_2.length, 16, 6)
    : buildCurveSweepGeometry({"spine": [[-0.5, -0.4, 0.0], [-0.1, 0.1, 0.0], [0.3, 0.2, 0.0], [0.6, -0.1, 0.0]], "crossSection": {"points": [[-0.04, -0.02], [0.04, -0.02], [0.04, 0.02], [-0.04, 0.02]]}, "closed": false});
  if (!endpoint_cabin_shell_2) {
    mesh_cabin_shell_2Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_cabin_shell_2 = new THREE.Mesh(
    mesh_cabin_shell_2Geometry,
    materialMap["body-paint"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_cabin_shell_2.name = "Fastback Roof and Pillar Shell";
  if (endpoint_cabin_shell_2) {
    mesh_cabin_shell_2.position.copy(endpoint_cabin_shell_2.midpoint);
    mesh_cabin_shell_2.quaternion.copy(endpoint_cabin_shell_2.quaternion);
  }
  mesh_cabin_shell_2.castShadow = options.castShadow ?? true;
  mesh_cabin_shell_2.receiveShadow = options.receiveShadow ?? true;
  mesh_cabin_shell_2.userData.sculptComponent = {"id": "cabin-shell", "name": "Fastback Roof and Pillar Shell", "level": "macro", "role": "cabin", "importance": 1, "confidence": 0.9, "primitive": "curve-sweep", "topologyClass": "continuous-sculpt", "topologyRationale": "The roof, pillars, and rear deck follow a continuous arched coupe envelope visible across all views, with a wide windshield and tapering rear quarter.", "geometryDescriptor": {"topologyIntent": "Variable-width roof loft with separate inset glazing surfaces and explicit A/B/C pillar bands.", "edgeTreatment": {"type": "small chamfer where visible", "bevelRadius": 0.015, "segments": 2}, "deformationStack": ["windshield rake", "flat roof crown", "fastback falloff", "rear-quarter taper"], "uvStrategy": "object-space procedural coordinates; no photographic projection", "normalStrategy": "indexed vertex normals with deliberate faceted low-poly transitions"}, "parent": "body-shell", "attachment": {"parentId": "body-shell", "parentSocket": "body-shell-surface", "localStart": [0, 0.65, -0.18], "localEnd": [0, 0.6900000000000001, -0.18], "contactType": "embedded-or-bolted", "overlap": 0.025, "gapTolerance": 0.008, "evidenceRefs": ["front-three-quarter", "side", "front", "rear-three-quarter"]}, "dimensions": {"width": 1.08, "height": 0.62, "depth": 1.66, "units": "game-model", "confidence": 0.88}, "transform": {"position": [0, 0.65, -0.18], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "cabin", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.08, 0.62, 1.66], "isTrigger": false, "notes": "Simplified runtime proxy; the game continues to use its local sphere physics body."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "cabin", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "black-trim"}}, "material": "body-paint", "materialLayers": ["body-paint"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(227, 38, 31, 1)", "secondaryAlbedo": "rgba(169, 15, 18, 1)", "materialClass": "plastic", "materialClassConfidence": 0.88, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(227, 38, 31, 1)"}, {"position": 1, "color": "rgba(169, 15, 18, 1)"}]}, "evidenceRefs": ["front-three-quarter", "side", "front", "rear-three-quarter"]}, "deformations": ["windshield rake", "flat roof crown", "fastback falloff", "rear-quarter taper"], "joints": [], "seams": [], "localFeatures": ["upright-a-pillars", "near-flat-roof-crown", "continuous-fastback-arc", "painted-b-and-c-pillars"], "surfaceDetail": {"macroRoughness": 0.03, "microRoughness": 0.04, "bumpAmplitude": 0.003, "normalPattern": "independent material microstructure", "displacementPattern": "none", "occlusionPattern": "cavity and contact only", "edgeWearPattern": "none", "notes": "Reference is a clean stylized concept."}, "evidenceRefs": ["front-three-quarter", "side", "front", "rear-three-quarter"], "details": ["upright-a-pillars", "near-flat-roof-crown", "continuous-fastback-arc", "painted-b-and-c-pillars"], "fidelityTier": "blockout"};
  node_cabin_shell_2.add(mesh_cabin_shell_2);
  meshes["cabin-shell"] = mesh_cabin_shell_2;
  colliders["cabin-shell"] = {"type": "box", "offset": [0, 0, 0], "scale": [1.08, 0.62, 1.66], "isTrigger": false, "notes": "Simplified runtime proxy; the game continues to use its local sphere physics body."};
  destructionGroups["cabin"] ??= [];
  destructionGroups["cabin"].push(node_cabin_shell_2);

  const attachment_rolling_system_3 = {"parentId": "root", "parentSocket": "root-surface", "localStart": [0, 0.28, 0], "localEnd": [0, 0.32, 0], "contactType": "embedded-or-bolted", "overlap": 0.025, "gapTolerance": 0.008, "evidenceRefs": ["front-three-quarter", "side", "front", "rear-three-quarter"]};
  const endpoint_rolling_system_3 = makeAttachmentEndpoint(attachment_rolling_system_3);
  const node_rolling_system_3 = new THREE.Group();
  node_rolling_system_3.name = "Four-wheel Rolling System__pivot";
  node_rolling_system_3.scale.set(1, 1, 1);
  if (endpoint_rolling_system_3) {
    node_rolling_system_3.position.copy(endpoint_rolling_system_3.start);
    node_rolling_system_3.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_rolling_system_3.position.set(0.0, 0.28, 0.0);
    node_rolling_system_3.rotation.set(0.0, 0.0, 0.0);
  }
  node_rolling_system_3.userData.sculptComponent = {"id": "rolling-system", "name": "Four-wheel Rolling System", "level": "macro", "role": "wheel-system", "importance": 1, "confidence": 0.9, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Four wheels share proportions and materials but must remain independent pivot groups for spin and steering.", "geometryDescriptor": {"topologyIntent": "Reference-shaped real-time geometry with stable named surfaces.", "edgeTreatment": {"type": "small chamfer where visible", "bevelRadius": 0.015, "segments": 2}, "deformationStack": [], "uvStrategy": "object-space procedural coordinates; no photographic projection", "normalStrategy": "indexed vertex normals with deliberate faceted low-poly transitions"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-surface", "localStart": [0, 0.28, 0], "localEnd": [0, 0.32, 0], "contactType": "embedded-or-bolted", "overlap": 0.025, "gapTolerance": 0.008, "evidenceRefs": ["front-three-quarter", "side", "front", "rear-three-quarter"]}, "dimensions": {"width": 1.5, "height": 0.52, "depth": 2.02, "units": "game-model", "confidence": 0.88}, "transform": {"position": [0, 0.28, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "wheel-system", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "wheel-front-left", "localPosition": [0.66, 0, 0.82], "localRotation": [0, 0, 0]}, {"id": "wheel-front-right", "localPosition": [-0.66, 0, 0.82], "localRotation": [0, 0, 0]}, {"id": "wheel-rear-left", "localPosition": [0.66, 0, -0.82], "localRotation": [0, 0, 0]}, {"id": "wheel-rear-right", "localPosition": [-0.66, 0, -0.82], "localRotation": [0, 0, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.5, 0.52, 2.02], "isTrigger": false, "notes": "Simplified runtime proxy; the game continues to use its local sphere physics body."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wheel-system", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "black-trim"}}, "material": "black-trim", "materialLayers": ["black-trim"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(21, 23, 25, 1)", "secondaryAlbedo": "rgba(45, 47, 49, 1)", "materialClass": "plastic", "materialClassConfidence": 0.92, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(21, 23, 25, 1)"}, {"position": 1, "color": "rgba(45, 47, 49, 1)"}]}, "evidenceRefs": ["front-three-quarter", "side", "front", "rear-three-quarter"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["front-and-rear-axle-centers", "independent-wheel-pivots"], "surfaceDetail": {"macroRoughness": 0.03, "microRoughness": 0.04, "bumpAmplitude": 0.003, "normalPattern": "independent material microstructure", "displacementPattern": "none", "occlusionPattern": "cavity and contact only", "edgeWearPattern": "none", "notes": "Reference is a clean stylized concept."}, "evidenceRefs": ["side", "front", "front-three-quarter"], "details": ["front-and-rear-axle-centers", "independent-wheel-pivots"], "fidelityTier": "blockout"};
  node_rolling_system_3.userData.actionProfile = {"animationRole": "wheel-system", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "wheel-front-left", "localPosition": [0.66, 0, 0.82], "localRotation": [0, 0, 0]}, {"id": "wheel-front-right", "localPosition": [-0.66, 0, 0.82], "localRotation": [0, 0, 0]}, {"id": "wheel-rear-left", "localPosition": [0.66, 0, -0.82], "localRotation": [0, 0, 0]}, {"id": "wheel-rear-right", "localPosition": [-0.66, 0, -0.82], "localRotation": [0, 0, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.5, 0.52, 2.02], "isTrigger": false, "notes": "Simplified runtime proxy; the game continues to use its local sphere physics body."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wheel-system", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "black-trim"}};
  (nodes["root"] ?? root).add(node_rolling_system_3);
  nodes["rolling-system"] = node_rolling_system_3;
  const mesh_rolling_system_3Geometry = endpoint_rolling_system_3
    ? new THREE.CylinderGeometry(endpoint_rolling_system_3.endRadius, endpoint_rolling_system_3.baseRadius, endpoint_rolling_system_3.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_rolling_system_3) {
    mesh_rolling_system_3Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_rolling_system_3 = new THREE.Mesh(
    mesh_rolling_system_3Geometry,
    materialMap["black-trim"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_rolling_system_3.name = "Four-wheel Rolling System";
  if (endpoint_rolling_system_3) {
    mesh_rolling_system_3.position.copy(endpoint_rolling_system_3.midpoint);
    mesh_rolling_system_3.quaternion.copy(endpoint_rolling_system_3.quaternion);
  }
  mesh_rolling_system_3.castShadow = options.castShadow ?? true;
  mesh_rolling_system_3.receiveShadow = options.receiveShadow ?? true;
  mesh_rolling_system_3.userData.sculptComponent = {"id": "rolling-system", "name": "Four-wheel Rolling System", "level": "macro", "role": "wheel-system", "importance": 1, "confidence": 0.9, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Four wheels share proportions and materials but must remain independent pivot groups for spin and steering.", "geometryDescriptor": {"topologyIntent": "Reference-shaped real-time geometry with stable named surfaces.", "edgeTreatment": {"type": "small chamfer where visible", "bevelRadius": 0.015, "segments": 2}, "deformationStack": [], "uvStrategy": "object-space procedural coordinates; no photographic projection", "normalStrategy": "indexed vertex normals with deliberate faceted low-poly transitions"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "root-surface", "localStart": [0, 0.28, 0], "localEnd": [0, 0.32, 0], "contactType": "embedded-or-bolted", "overlap": 0.025, "gapTolerance": 0.008, "evidenceRefs": ["front-three-quarter", "side", "front", "rear-three-quarter"]}, "dimensions": {"width": 1.5, "height": 0.52, "depth": 2.02, "units": "game-model", "confidence": 0.88}, "transform": {"position": [0, 0.28, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "wheel-system", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.95}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "wheel-front-left", "localPosition": [0.66, 0, 0.82], "localRotation": [0, 0, 0]}, {"id": "wheel-front-right", "localPosition": [-0.66, 0, 0.82], "localRotation": [0, 0, 0]}, {"id": "wheel-rear-left", "localPosition": [0.66, 0, -0.82], "localRotation": [0, 0, 0]}, {"id": "wheel-rear-right", "localPosition": [-0.66, 0, -0.82], "localRotation": [0, 0, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1.5, 0.52, 2.02], "isTrigger": false, "notes": "Simplified runtime proxy; the game continues to use its local sphere physics body."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "wheel-system", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "black-trim"}}, "material": "black-trim", "materialLayers": ["black-trim"], "colorMaterialRecipe": {"dominantAlbedo": "rgba(21, 23, 25, 1)", "secondaryAlbedo": "rgba(45, 47, 49, 1)", "materialClass": "plastic", "materialClassConfidence": 0.92, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(21, 23, 25, 1)"}, {"position": 1, "color": "rgba(45, 47, 49, 1)"}]}, "evidenceRefs": ["front-three-quarter", "side", "front", "rear-three-quarter"]}, "deformations": [], "joints": [], "seams": [], "localFeatures": ["front-and-rear-axle-centers", "independent-wheel-pivots"], "surfaceDetail": {"macroRoughness": 0.03, "microRoughness": 0.04, "bumpAmplitude": 0.003, "normalPattern": "independent material microstructure", "displacementPattern": "none", "occlusionPattern": "cavity and contact only", "edgeWearPattern": "none", "notes": "Reference is a clean stylized concept."}, "evidenceRefs": ["side", "front", "front-three-quarter"], "details": ["front-and-rear-axle-centers", "independent-wheel-pivots"], "fidelityTier": "blockout"};
  node_rolling_system_3.add(mesh_rolling_system_3);
  meshes["rolling-system"] = mesh_rolling_system_3;
  colliders["rolling-system"] = {"type": "box", "offset": [0, 0, 0], "scale": [1.5, 0.52, 2.02], "isTrigger": false, "notes": "Simplified runtime proxy; the game continues to use its local sphere physics body."};
  destructionGroups["wheel-system"] ??= [];
  destructionGroups["wheel-system"].push(node_rolling_system_3);
  const socket_rolling_system_wheel_front_left_0 = new THREE.Object3D();
  socket_rolling_system_wheel_front_left_0.name = "wheel-front-left";
  socket_rolling_system_wheel_front_left_0.position.set(0.66, 0.0, 0.82);
  socket_rolling_system_wheel_front_left_0.rotation.set(0.0, 0.0, 0.0);
  socket_rolling_system_wheel_front_left_0.userData.socket = {"id": "wheel-front-left", "localPosition": [0.66, 0, 0.82], "localRotation": [0, 0, 0]};
  node_rolling_system_3.add(socket_rolling_system_wheel_front_left_0);
  sockets["rolling-system:wheel-front-left"] = socket_rolling_system_wheel_front_left_0;
  const socket_rolling_system_wheel_front_right_1 = new THREE.Object3D();
  socket_rolling_system_wheel_front_right_1.name = "wheel-front-right";
  socket_rolling_system_wheel_front_right_1.position.set(-0.66, 0.0, 0.82);
  socket_rolling_system_wheel_front_right_1.rotation.set(0.0, 0.0, 0.0);
  socket_rolling_system_wheel_front_right_1.userData.socket = {"id": "wheel-front-right", "localPosition": [-0.66, 0, 0.82], "localRotation": [0, 0, 0]};
  node_rolling_system_3.add(socket_rolling_system_wheel_front_right_1);
  sockets["rolling-system:wheel-front-right"] = socket_rolling_system_wheel_front_right_1;
  const socket_rolling_system_wheel_rear_left_2 = new THREE.Object3D();
  socket_rolling_system_wheel_rear_left_2.name = "wheel-rear-left";
  socket_rolling_system_wheel_rear_left_2.position.set(0.66, 0.0, -0.82);
  socket_rolling_system_wheel_rear_left_2.rotation.set(0.0, 0.0, 0.0);
  socket_rolling_system_wheel_rear_left_2.userData.socket = {"id": "wheel-rear-left", "localPosition": [0.66, 0, -0.82], "localRotation": [0, 0, 0]};
  node_rolling_system_3.add(socket_rolling_system_wheel_rear_left_2);
  sockets["rolling-system:wheel-rear-left"] = socket_rolling_system_wheel_rear_left_2;
  const socket_rolling_system_wheel_rear_right_3 = new THREE.Object3D();
  socket_rolling_system_wheel_rear_right_3.name = "wheel-rear-right";
  socket_rolling_system_wheel_rear_right_3.position.set(-0.66, 0.0, -0.82);
  socket_rolling_system_wheel_rear_right_3.rotation.set(0.0, 0.0, 0.0);
  socket_rolling_system_wheel_rear_right_3.userData.socket = {"id": "wheel-rear-right", "localPosition": [-0.66, 0, -0.82], "localRotation": [0, 0, 0]};
  node_rolling_system_3.add(socket_rolling_system_wheel_rear_right_3);
  sockets["rolling-system:wheel-rear-right"] = socket_rolling_system_wheel_rear_right_3;

  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;
  root.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  root.userData.actionReadiness = {
    note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
  };
  return root;
}

export function createClassic911StyleCoupeLookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = "Classic 911 Style Coupe look-dev lights";
  const hemi = new THREE.HemisphereLight(
    mode === 'reference' ? 0xfff0d6 : 0xf2f4ff,
    0x363b42,
    mode === 'grazing' ? 0.28 : mode === 'reference' ? 0.72 : 0.85,
  );
  lights.add(hemi);
  const key = new THREE.DirectionalLight(
    mode === 'reference' ? 0xffcf8a : 0xfff4e8,
    mode === 'grazing' ? 4.2 : mode === 'reference' ? 2.6 : 2.15,
  );
  if (mode === 'grazing') key.position.set(7.5, 1.1, 4.0);
  else if (mode === 'reference') key.position.set(-4.5, 7.5, 5.0);
  else key.position.set(-4.0, 6.0, 5.5);
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);
  key.shadow.bias = -0.00025;
  key.shadow.normalBias = 0.018;
  key.shadow.radius = 7;
  key.shadow.blurSamples = 24;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 30;
  key.shadow.camera.left = -2.6;
  key.shadow.camera.right = 2.6;
  key.shadow.camera.top = 2.6;
  key.shadow.camera.bottom = -2.6;
  key.shadow.camera.updateProjectionMatrix();
  lights.add(key);
  const fill = new THREE.DirectionalLight(0xa8c4ff, mode === 'grazing' ? 0.12 : 0.42);
  fill.position.set(4.0, 3.0, 3.5);
  lights.add(fill);
  const rim = new THREE.DirectionalLight(0xfff1c4, mode === 'grazing' ? 0.28 : 0.85);
  rim.position.set(0.5, 4.5, -6.0);
  lights.add(rim);
  lights.userData.reviewMode = mode;
  lights.userData.lightingFromPhoto = ["Key light: large soft studio source above camera-left/front, neutral white, intensity about 3.0; preserve broad clearcoat highlights without baking them into albedo.", "Fill and environment: low-contrast neutral studio environment with soft camera-right fill, ACES filmic tone mapping, exposure 1.0, warm light-gray background.", "Rim and ground: soft rear/upper rim to separate the roof and quarter panels, plus blurred contact shadow and ambient occlusion directly under all four tires."];
  lights.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  return lights;
}

// PBR materials (clearcoat/iridescence/transmission/anisotropy) need an environment
// map to visually behave as intended — call this once per renderer and assign the
// result to scene.environment before rendering. No external HDR asset required.
export function createClassic911StyleCoupeEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  return texture;
}

// Plan 1.3 §3.2 — auto-framing by bounding box. The Divine Eye can only compare a
// render to the reference if the object is FRAMED consistently (an object framed
// differently scores as wrong even when its shape is right). This positions the camera
// deterministically from the object's bounding box so it fills the frame at a stable
// margin, and sets near/far to the object scale. Call after adding the model to the
// scene, and again on resize (after updating camera.aspect).
export function frameClassic911StyleCoupeCamera(
  camera: THREE.PerspectiveCamera,
  object: THREE.Object3D,
  options: { margin?: number; azimuthDeg?: number; elevationDeg?: number } = {},
): void {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const margin = options.margin ?? 1.15;
  const maxDim = Math.max(size.x, size.y, size.z) * margin;
  const fov = (camera.fov * Math.PI) / 180;
  // distance so the largest object dimension fits vertically in the frame
  const distance = (maxDim / 2) / Math.tan(fov / 2);
  const az = ((options.azimuthDeg ?? 0) * Math.PI) / 180;
  const el = ((options.elevationDeg ?? 0) * Math.PI) / 180;
  const dir = new THREE.Vector3(
    Math.sin(az) * Math.cos(el),
    Math.sin(el),
    Math.cos(az) * Math.cos(el),
  );
  camera.position.copy(center).addScaledVector(dir, distance);
  camera.near = Math.max(0.01, distance - maxDim);
  camera.far = distance + maxDim * 2;
  camera.lookAt(center);
  camera.updateProjectionMatrix();
}

// Plan 1.3 §3.2c — PRESENTATION composer (DOF + bloom). CRITICAL (R-POSTFX): this is
// for the showcase/hero render ONLY. The Divine Eye's EVALUATION render MUST use a
// plain renderer with NO composer — bloom blows highlights and DOF blurs edges, which
// would corrupt the deterministic IoU/DCD/edge/blowout signals. Enable dof/bloom ONLY
// when the reference photo actually exhibits them (detect_reference_effects.py authorizes).
export function createClassic911StyleCoupePresentationComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  options: { dof?: boolean; bloom?: boolean; bloomStrength?: number; dofFocus?: number; dofAperture?: number } = {},
): EffectComposer {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  if (options.dof) {
    composer.addPass(new BokehPass(scene, camera, {
      focus: options.dofFocus ?? 10.0,
      aperture: options.dofAperture ?? 0.0002,
      maxblur: 0.01,
    }));
  }
  if (options.bloom) {
    const size = new THREE.Vector2();
    renderer.getSize(size);
    composer.addPass(new UnrealBloomPass(size, options.bloomStrength ?? 0.4, 0.4, 0.85));
  }
  return composer;
}

export function configureClassic911StyleCoupeRenderer(renderer: THREE.WebGLRenderer): void {
  // Load-bearing for view-dependent finishes (anodized / Doppler): without ACES + sRGB
  // the environment reflection reads flat/washed instead of a believable metal response.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

export function createClassic911StyleCoupeInspectControls(
  camera: THREE.Camera,
  domElement: HTMLElement,
): OrbitControls {
  // View-dependent finishes only read correctly once the user orbits — their color
  // comes from the environment reflection, not albedo, so free rotation matters here.
  const controls = new OrbitControls(camera, domElement);
  controls.enableDamping = true;
  controls.minDistance = 1.0;
  controls.maxDistance = 8.0;
  controls.autoRotate = false;
  return controls;
}
