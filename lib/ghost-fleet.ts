import * as THREE from 'three';
import type { FleetFrame } from './rl/batch';

/** One instanced draw per car part, sharing geometry with the player's car. */
export class GhostFleet {
  group = new THREE.Group();
  private parts: { mesh: THREE.InstancedMesh; local: THREE.Matrix4 }[] = [];
  private transform = new THREE.Object3D();
  constructor(car: THREE.Group, scene: THREE.Scene) {
    car.children.forEach(part => {
      if (!(part instanceof THREE.Mesh)) return;
      part.updateMatrix();
      const material = part.material.clone() as THREE.MeshStandardMaterial;
      material.transparent = true; material.opacity = .75;
      const mesh = new THREE.InstancedMesh(part.geometry, material, 50);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.frustumCulled = false;
      this.parts.push({ mesh, local: part.matrix.clone() }); this.group.add(mesh);
    });
    this.group.visible = false; scene.add(this.group);
  }
  show(frame: FleetFrame | null) {
    this.group.visible = !!frame;
    if (!frame) return;
    const matrix = new THREE.Matrix4(), color = new THREE.Color();
    for (const { mesh, local } of this.parts) {
      mesh.count = frame.poses.length;
      frame.poses.forEach((pose, i) => {
        this.transform.position.set(pose.x, .015 * i, pose.z); this.transform.rotation.y = -pose.heading; this.transform.updateMatrix();
        mesh.setMatrixAt(i, matrix.multiplyMatrices(this.transform.matrix, local));
        mesh.setColorAt(i, color.set(pose.done ? pose.completed ? '#daf58c' : '#777f86' : '#ffffff'));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
  dispose() { this.group.removeFromParent(); for (const { mesh } of this.parts) { (mesh.material as THREE.Material).dispose(); mesh.dispose(); } }
}
