import * as THREE from 'three';
import { RAY_DEFINITIONS, type RayReading } from './sensors';

/** Debug drawing only. Hiding this never disables the sensor calculations. */
export class SensorOverlay {
  readonly group = new THREE.Group();
  private solid = new THREE.BufferGeometry();
  private remainder = new THREE.BufferGeometry();
  private dots = new THREE.BufferGeometry();
  private labels: THREE.Sprite[] = [];

  constructor(scene: THREE.Scene) {
    const count = RAY_DEFINITIONS.length;
    const colors = RAY_DEFINITIONS.flatMap(ray => {
      const c = new THREE.Color(ray.bank === 'front' ? '#e2ff86' : '#84dcff');
      return [...c.toArray(), ...c.toArray()];
    });
    for (const geometry of [this.solid, this.remainder]) {
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 6), 3).setUsage(THREE.DynamicDrawUsage));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    }
    this.remainder.setAttribute('lineDistance', new THREE.BufferAttribute(new Float32Array(count * 2), 1).setUsage(THREE.DynamicDrawUsage));
    const faint = new THREE.LineSegments(this.remainder, new THREE.LineDashedMaterial({ vertexColors: true, transparent: true, opacity: .4, dashSize: .5, gapSize: .45, depthTest: false, depthWrite: false }));
    const lines = new THREE.LineSegments(this.solid, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, depthWrite: false }));
    this.dots.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage));
    this.dots.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const dots = new THREE.Points(this.dots, new THREE.PointsMaterial({ vertexColors: true, size: 6, sizeAttenuation: false, depthTest: false, depthWrite: false }));
    for (const [i, object] of [faint, lines, dots].entries()) {
      object.frustumCulled = false;
      object.renderOrder = 50 + i;
      this.group.add(object);
    }
    for (const ray of RAY_DEFINITIONS) {
      const canvas = document.createElement('canvas');
      canvas.width = 80; canvas.height = 44;
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#162720'; context.fillRect(0, 0, 80, 44);
      context.fillStyle = ray.bank === 'front' ? '#e2ff86' : '#84dcff';
      context.font = 'bold 28px monospace'; context.textAlign = 'center';
      context.fillText(ray.id, 40, 32);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, depthWrite: false }));
      label.scale.set(2.8, 1.54, 1); label.renderOrder = 53;
      this.labels.push(label); this.group.add(label);
    }
    scene.add(this.group);
  }

  update(readings: readonly RayReading[]) {
    const solid = this.solid.getAttribute('position');
    const remainder = this.remainder.getAttribute('position');
    const dashes = this.remainder.getAttribute('lineDistance');
    const dots = this.dots.getAttribute('position');
    const colors = this.dots.getAttribute('color');
    readings.forEach((ray, i) => {
      solid.setXYZ(i * 2, ray.origin.x, 1.7, ray.origin.z);
      solid.setXYZ(i * 2 + 1, ray.end.x, 1.7, ray.end.z);
      remainder.setXYZ(i * 2, ray.end.x, 1.7, ray.end.z);
      remainder.setXYZ(i * 2 + 1, ray.limit.x, 1.7, ray.limit.z);
      dashes.setX(i * 2, 0); dashes.setX(i * 2 + 1, ray.maxRange - ray.distance);
      dots.setXYZ(i, ray.end.x, 1.8, ray.end.z);
      const color = new THREE.Color(ray.hit ? '#ffffff' : '#87948a');
      colors.setXYZ(i, color.r, color.g, color.b);
      // Put IDs at fixed range tips; their positions do not jump with edge hits.
      this.labels[i].position.set(ray.limit.x, 2, ray.limit.z - .85);
    });
    for (const attribute of [solid, remainder, dashes, dots, colors]) attribute.needsUpdate = true;
  }

  dispose() {
    this.group.removeFromParent();
    this.group.traverse(object => {
      if (object instanceof THREE.LineSegments || object instanceof THREE.Points) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach(material => material.dispose());
      } else if (object instanceof THREE.Sprite) {
        object.material.map?.dispose(); object.material.dispose();
      }
    });
  }
}
