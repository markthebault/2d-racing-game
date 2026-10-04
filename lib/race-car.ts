import * as THREE from 'three';

/** Flat mesh children keep the same model usable by the 50-car instanced fleet. */
export function buildRaceCar(car: THREE.Group) {
  const paint = new THREE.MeshStandardMaterial({
    color: '#ed503d',
    roughness: 0.4,
    metalness: 0.15,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: '#182126',
    roughness: 0.9,
  });
  const stripe = new THREE.MeshStandardMaterial({
    color: '#fff1cf',
    roughness: 0.65,
  });
  const metal = new THREE.MeshStandardMaterial({
    color: '#85929a',
    roughness: 0.4,
    metalness: 0.6,
  });
  const add = (
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
  ) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    car.add(mesh);
    return mesh;
  };
  const box = (
    w: number,
    h: number,
    d: number,
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
  ) => add(new THREE.BoxGeometry(w, h, d), material, x, y, z);
  const body = new THREE.Shape();
  body.moveTo(-1.55, -0.52);
  body.lineTo(0.3, -0.56);
  body.lineTo(2, -0.18);
  body.lineTo(2, 0.18);
  body.lineTo(0.3, 0.56);
  body.lineTo(-1.55, 0.52);
  body.closePath();
  const geometry = new THREE.ExtrudeGeometry(body, {
    depth: 0.42,
    bevelEnabled: true,
    bevelSize: 0.08,
    bevelThickness: 0.08,
    bevelSegments: 1,
    steps: 1,
  });
  geometry.rotateX(-Math.PI / 2);
  add(geometry, paint, 0, 0.38, 0);
  box(1.6, 0.48, 0.36, paint, -0.65, 0.92, 0);
  for (const side of [-1, 1]) {
    box(1.65, 0.4, 0.35, paint, -0.45, 0.52, side * 0.72);
    box(0.5, 0.15, 0.3, dark, 0.4, 0.65, side * 0.73);
    box(0.22, 0.32, 0.12, paint, 1.68, 0.34, side * 1.02);
    box(0.25, 0.3, 0.12, paint, -1.64, 1.02, side * 0.86);
  }
  // Open cockpit, helmet, roll hoop and a cream center stripe.
  box(0.62, 0.1, 0.55, dark, -0.08, 0.91, 0);
  add(new THREE.SphereGeometry(0.21, 12, 8), stripe, -0.18, 1.08, 0);
  const hoop = add(
    new THREE.TorusGeometry(0.28, 0.045, 6, 12, Math.PI),
    dark,
    -0.55,
    1.02,
    0,
  );
  hoop.rotation.y = Math.PI / 2;
  box(1.38, 0.025, 0.12, stripe, 1.03, 0.88, 0);
  box(0.85, 0.025, 0.12, stripe, -1, 1.18, 0);
  box(0.36, 0.12, 2.1, paint, 1.72, 0.25, 0);
  box(0.12, 0.07, 1.95, dark, 1.9, 0.24, 0);
  box(0.45, 0.12, 1.85, paint, -1.65, 1.08, 0);
  box(0.1, 0.08, 1.7, stripe, -1.83, 1.16, 0);
  for (const x of [-1.12, 1.08])
    for (const side of [-1, 1]) {
      const wheel = add(
        new THREE.CylinderGeometry(0.43, 0.43, 0.36, 14),
        dark,
        x,
        0.44,
        side * 1.02,
      );
      wheel.rotation.x = Math.PI / 2;
      const hub = add(
        new THREE.CylinderGeometry(0.22, 0.22, 0.025, 12),
        metal,
        x,
        0.44,
        side * 1.21,
      );
      hub.rotation.x = Math.PI / 2;
      add(
        new THREE.TorusGeometry(0.31, 0.025, 4, 14),
        paint,
        x,
        0.44,
        side * 1.22,
      );
      box(0.13, 0.11, 0.7, dark, x, 0.43, side * 0.55);
    }
}
