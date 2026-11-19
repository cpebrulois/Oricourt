// Objets du jeu « Oricourt, l'an 1435 » : trésors cachés et objets à expertiser (formes simples, à l'échelle, en mètres).
// Chaque fabrique renvoie un groupe posé au sol en (0, 0, 0), axe Y vers le haut.
import * as THREE from 'three';

const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, ...o });
const M = {
  bois: mat(0x6b4a2f), boisClair: mat(0x9a7a52), fer: mat(0x4a4c50, { metalness: 0.7, roughness: 0.45 }),
  cuir: mat(0x7a5030), osier: mat(0x9a7743, { side: THREE.DoubleSide }), pierre: mat(0x9c968a, { roughness: 0.95 }),
  lin: mat(0xd8cdb4), terre: mat(0x4e3b2a, { roughness: 1 }), paille: mat(0xd6b25c),
};

function groupe() {
  const g = new THREE.Group();
  g.p = (geo, mt, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, mt); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; m.receiveShadow = true; g.add(m); return m; };
  return g;
}
const boite = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const boule = (r, ws = 10, hs = 8) => new THREE.SphereGeometry(r, ws, hs);
const cyl = (r1, r2, h, n = 12, ouvert = false) => new THREE.CylinderGeometry(r1, r2, h, n, 1, ouvert);
const alea = (k) => { const x = Math.sin(k * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

function panier(g, y = 0) {
  g.p(cyl(0.2, 0.15, 0.18, 16, true), M.osier, 0, y + 0.09, 0);
  g.p(new THREE.CircleGeometry(0.15, 16), M.osier, 0, y + 0.005, 0, -Math.PI / 2);
  g.p(new THREE.TorusGeometry(0.2, 0.012, 5, 20), mat(0x7d5d33), 0, y + 0.18, 0, Math.PI / 2);
}
function plateauMerelles() {
  const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d');
  x.fillStyle = '#9c968a'; x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 900; i++) { x.fillStyle = `rgba(${60 + alea(i) * 60},${58 + alea(i + 3) * 50},${50 + alea(i + 7) * 40},0.25)`; x.fillRect(alea(i + 1) * 256, alea(i + 2) * 256, 3, 3); }
  x.strokeStyle = '#4a453d'; x.lineWidth = 5;
  for (const r of [100, 68, 36]) x.strokeRect(128 - r, 128 - r, 2 * r, 2 * r);
  x.beginPath(); for (const [a, b] of [[[128, 28], [128, 92]], [[128, 164], [128, 228]], [[28, 128], [92, 128]], [[164, 128], [228, 128]]]) { x.moveTo(...a); x.lineTo(...b); } x.stroke();
  x.fillStyle = '#3d3830'; for (const r of [100, 68, 36]) for (const [dx, dy] of [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]]) { x.beginPath(); x.arc(128 + dx * r, 128 + dy * r, 5, 0, 7); x.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function fabriquer(forme) {
  const g = groupe();
  switch (forme) {
    case 'coffre': {
      g.p(boite(0.9, 0.42, 0.5), M.bois, 0, 0.21, 0);
      g.p(boite(0.94, 0.12, 0.54), M.bois, 0, 0.48, 0);
      for (const x of [-0.3, 0.3]) { g.p(boite(0.06, 0.56, 0.56), M.fer, x, 0.28, 0); }
      g.p(boite(0.1, 0.12, 0.02), M.fer, 0, 0.38, 0.26);
      break;
    }
    case 'bourse': {
      g.p(new THREE.CircleGeometry(0.4, 18), M.terre, 0, 0.012, 0, -Math.PI / 2);
      const b = g.p(boule(0.09), M.cuir, 0, 0.07, 0); b.scale.set(1, 0.8, 1);
      g.p(cyl(0.03, 0.045, 0.05, 8), M.cuir, 0, 0.15, 0);
      g.p(new THREE.TorusGeometry(0.034, 0.006, 4, 12), mat(0x3a2a1a), 0, 0.15, 0, Math.PI / 2);
      for (let k = 0; k < 3; k++) g.p(cyl(0.018, 0.018, 0.004, 12), mat(0xbfc2c4, { metalness: 0.8, roughness: 0.35 }), 0.14 + k * 0.03, 0.016 + k * 0.004, 0.05 - k * 0.02);
      break;
    }
    case 'ecritoire': {
      for (const [x, z] of [[-0.18, -0.12], [0.18, -0.12], [-0.18, 0.12], [0.18, 0.12]]) g.p(cyl(0.02, 0.02, 0.45, 6), M.bois, x, 0.225, z);
      g.p(boite(0.48, 0.04, 0.34), M.boisClair, 0, 0.47, 0, 0.12);
      g.p(boite(0.3, 0.004, 0.22), M.lin, 0.02, 0.495, 0.01, 0.12);
      g.p(new THREE.ConeGeometry(0.03, 0.14, 10), mat(0x2b2620), -0.16, 0.56, -0.08, Math.PI);
      const plume = g.p(new THREE.PlaneGeometry(0.04, 0.28), mat(0xf2efe6, { side: THREE.DoubleSide }), -0.13, 0.66, -0.07, 0, 0, 0.5);
      plume.castShadow = false;
      break;
    }
    case 'merelles': {
      const m = [mat(0x8f897d, { roughness: 0.95 }), mat(0x8f897d), new THREE.MeshStandardMaterial({ map: plateauMerelles(), roughness: 0.9 }), mat(0x8f897d), mat(0x8f897d), mat(0x8f897d)];
      const k = new THREE.Mesh(boite(0.75, 0.5, 0.75), m); k.position.y = 0.25; k.castShadow = k.receiveShadow = true; g.add(k);
      break;
    }
    case 'fer': {
      // billot de maréchal-ferrant : un fer posé dessus, un autre pendu au poteau, des clous
      g.p(cyl(0.24, 0.27, 0.55, 14), M.bois, 0, 0.275, 0);
      const f1 = g.p(new THREE.TorusGeometry(0.085, 0.017, 6, 16, Math.PI * 1.45), M.fer, 0.02, 0.565, 0.02, -Math.PI / 2, 0, 0.6); f1.scale.set(1, 1.15, 0.6);
      for (let k = 0; k < 5; k++) g.p(boite(0.008, 0.06, 0.008), M.fer, -0.12 + k * 0.03, 0.556, -0.12, Math.PI / 2, 0, k);
      g.p(boite(0.14, 1.2, 0.14), M.bois, 0.42, 0.6, 0);
      for (const sz of [-1, 1]) { const f2 = g.p(new THREE.TorusGeometry(0.085, 0.017, 6, 16, Math.PI * 1.45), M.fer, 0.42, 0.95, sz * 0.085, 0, 0, Math.PI / 2 - Math.PI * 0.22); f2.scale.set(1, 1.15, 0.6); }
      break;
    }
    case 'carreau': {
      const c = new THREE.Group(); c.position.set(0, 0.16, 0); c.rotation.set(0.45, 0, 0.25); g.add(c);
      const p = (geo, mt, y) => { const m = new THREE.Mesh(geo, mt); m.position.y = y; m.castShadow = true; c.add(m); };
      p(cyl(0.009, 0.009, 0.36, 6), M.boisClair, 0);
      p(new THREE.ConeGeometry(0.018, 0.06, 4), M.fer, -0.2); c.children[1].rotation.x = Math.PI;
      for (let k = 0; k < 2; k++) { const e = new THREE.Mesh(new THREE.PlaneGeometry(0.04, 0.07), mat(0x8a7a62, { side: THREE.DoubleSide })); e.position.y = 0.14; e.rotation.y = k * Math.PI / 2; c.add(e); }
      g.p(new THREE.CircleGeometry(0.12, 12), M.terre, 0, 0.01, 0, -Math.PI / 2);
      break;
    }
    case 'simples': {
      g.p(boite(0.6, 0.18, 0.45), M.pierre, 0, 0.09, 0);
      const s = g.p(boule(0.08), M.lin, -0.12, 0.24, 0); s.scale.set(1, 1.2, 1);
      g.p(cyl(0.025, 0.04, 0.05, 8), M.lin, -0.12, 0.34, 0);
      for (let k = 0; k < 7; k++) g.p(cyl(0.005, 0.005, 0.26, 4), mat(k % 2 ? 0x7d8a52 : 0x96a066), 0.1 + alea(k) * 0.06, 0.2, -0.05 + alea(k + 9) * 0.1, 0, 0, Math.PI / 2 + (alea(k + 4) - 0.5) * 0.3);
      g.p(new THREE.TorusGeometry(0.025, 0.006, 4, 10), mat(0x8a6a3a), 0.12, 0.2, 0, 0, Math.PI / 2, 0);
      break;
    }
    case 'tranchoir': {
      for (const [x, z] of [[-0.3, -0.2], [0.3, -0.2], [-0.3, 0.2], [0.3, 0.2]]) g.p(boite(0.06, 0.72, 0.06), M.bois, x, 0.36, z);
      g.p(boite(0.8, 0.05, 0.55), M.boisClair, 0, 0.745, 0);
      g.p(cyl(0.15, 0.15, 0.045, 18), mat(0xc79a5a), 0, 0.795, 0);
      g.p(cyl(0.13, 0.13, 0.003, 18), mat(0x8a4a22), 0, 0.82, 0);
      g.p(boite(0.2, 0.012, 0.025), mat(0xbfc2c4, { metalness: 0.7, roughness: 0.35 }), 0.24, 0.776, 0.08, 0, 0.4, 0);
      break;
    }
    case 'patates': {
      for (const [w, d, x, z] of [[0.6, 0.02, 0, -0.2], [0.6, 0.02, 0, 0.2], [0.02, 0.4, -0.3, 0], [0.02, 0.4, 0.3, 0]]) g.p(boite(w, 0.2, d), M.boisClair, x, 0.12, z);
      g.p(boite(0.6, 0.02, 0.4), M.boisClair, 0, 0.03, 0);
      for (let k = 0; k < 16; k++) { const b = g.p(boule(0.055, 8, 6), mat(0xa47a48), -0.22 + (k % 4) * 0.145 + alea(k) * 0.03, 0.14 + alea(k + 1) * 0.05, -0.13 + Math.floor(k / 4) * 0.085, alea(k + 2), alea(k + 3), 0); b.scale.set(1.25, 0.85, 1); }
      break;
    }
    case 'mais': {
      g.p(boite(0.5, 0.35, 0.4), M.bois, 0, 0.175, 0);
      for (let k = 0; k < 4; k++) {
        const e = new THREE.Group(); e.position.set(-0.15 + k * 0.1, 0.38, -0.05 + alea(k) * 0.1); e.rotation.set(Math.PI / 2, 0, 0.3 * (alea(k + 5) - 0.5)); g.add(e);
        const c = new THREE.Mesh(cyl(0.032, 0.022, 0.22, 10), mat(0xe8b830, { roughness: 0.6 })); c.castShadow = true; e.add(c);
        for (const s of [-1, 1]) { const f = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.26), mat(0xa9b862, { side: THREE.DoubleSide })); f.position.set(s * 0.03, 0.05, 0); f.rotation.z = s * 0.35; e.add(f); }
      }
      break;
    }
    case 'tomates': {
      for (const [x, z] of [[-0.2, -0.16], [0.2, -0.16], [-0.2, 0.16], [0.2, 0.16]]) g.p(boite(0.05, 0.5, 0.05), M.bois, x, 0.25, z);
      g.p(boite(0.5, 0.04, 0.42), M.boisClair, 0, 0.52, 0);
      panier(g, 0.54);
      for (let k = 0; k < 9; k++) g.p(boule(0.045, 10, 8), mat(0xc8281c, { roughness: 0.4 }), -0.1 + (k % 3) * 0.1 + alea(k) * 0.02, 0.69 + alea(k + 1) * 0.04, -0.1 + Math.floor(k / 3) * 0.1);
      break;
    }
    case 'citrouille': {
      const geo = boule(0.32, 32, 18), pos = geo.attributes.position, v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i); const a = Math.atan2(v.z, v.x), r = 1 - 0.06 * Math.abs(Math.cos(a * 5)); pos.setXYZ(i, v.x * r, v.y * 0.72, v.z * r); }
      geo.computeVertexNormals();
      g.p(geo, mat(0xe0741c, { roughness: 0.55 }), 0, 0.23, 0);
      g.p(cyl(0.025, 0.035, 0.12, 6), mat(0x5a6a2a), 0, 0.5, 0, 0.2, 0, 0.15);
      break;
    }
    case 'conserve': {
      g.p(boite(0.45, 0.3, 0.4), M.pierre, 0, 0.15, 0);
      g.p(cyl(0.05, 0.05, 0.11, 18), mat(0xc4c8cc, { metalness: 0.85, roughness: 0.3 }), 0, 0.355, 0);
      g.p(cyl(0.0505, 0.0505, 0.07, 18, true), mat(0xc23b2a, { roughness: 0.5, side: THREE.DoubleSide }), 0, 0.355, 0);
      g.p(cyl(0.0507, 0.0507, 0.02, 18, true), mat(0xf0d24a, { roughness: 0.5, side: THREE.DoubleSide }), 0, 0.36, 0);
      break;
    }
    case 'choux': {
      panier(g);
      for (let k = 0; k < 3; k++) { const c = g.p(boule(0.08, 12, 10), mat(0x7a9a52), -0.08 + k * 0.08, 0.18, -0.04 + alea(k) * 0.08); c.scale.set(1, 0.85, 1); }
      for (let k = 0; k < 4; k++) g.p(boule(0.045, 10, 8), mat(k % 2 ? 0xe8dfe6 : 0xb07aa8), -0.1 + k * 0.07, 0.14, 0.1);
      break;
    }
    case 'quenouille': {
      g.p(boite(0.4, 0.4, 0.3), M.bois, 0, 0.2, 0);
      const q = new THREE.Group(); q.position.set(0.12, 0.4, 0); q.rotation.z = 0.25; g.add(q);
      const t = new THREE.Mesh(cyl(0.012, 0.015, 1.0, 6), M.boisClair); t.position.y = 0.5; t.castShadow = true; q.add(t);
      const l = new THREE.Mesh(boule(0.09, 10, 8), mat(0xeee7d6)); l.position.y = 0.88; l.scale.set(1, 1.6, 1); l.castShadow = true; q.add(l);
      g.p(cyl(0.006, 0.006, 0.3, 6), M.boisClair, -0.08, 0.41, 0.05, 0, 0, Math.PI / 2);
      g.p(boule(0.025, 8, 6), M.boisClair, -0.15, 0.41, 0.05);
      break;
    }
    case 'faucille': {
      for (let k = 0; k < 18; k++) g.p(cyl(0.008, 0.008, 0.9, 4), M.paille, (alea(k) - 0.5) * 0.12, 0.13, (alea(k + 2) - 0.5) * 0.12 + (k / 18 - 0.5) * 0.05, Math.PI / 2 + (alea(k + 4) - 0.5) * 0.08, 0, 0);
      g.p(new THREE.TorusGeometry(0.08, 0.02, 5, 16), mat(0xc9a64a), 0, 0.13, 0, 0, 0, 0).scale.set(1, 1, 0.3);
      const f = new THREE.Group(); f.position.set(0.05, 0.27, 0); g.add(f);
      const lame = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.012, 3, 20, Math.PI * 1.2), mat(0x8c9094, { metalness: 0.7, roughness: 0.4 })); lame.rotation.x = Math.PI / 2; lame.scale.set(1, 1, 0.25); lame.castShadow = true; f.add(lame);
      const m = new THREE.Mesh(cyl(0.016, 0.016, 0.14, 6), M.bois); m.position.set(0.17, 0, -0.06); m.rotation.x = Math.PI / 2; f.add(m);
      break;
    }
    default: g.p(boite(0.3, 0.3, 0.3), M.bois, 0, 0.15, 0);
  }
  return g;
}

/** Petite étincelle qui scintille au-dessus d'un trésor (visible de près, pour attirer l'œil sans le désigner de loin). */
export function etincelle() {
  const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
  const gr = x.createRadialGradient(32, 32, 0, 32, 32, 30); gr.addColorStop(0, 'rgba(255,248,215,1)'); gr.addColorStop(0.25, 'rgba(255,225,140,0.7)'); gr.addColorStop(1, 'rgba(255,210,120,0)');
  x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
  x.strokeStyle = 'rgba(255,250,230,0.9)'; x.lineWidth = 2; x.beginPath(); x.moveTo(32, 4); x.lineTo(32, 60); x.moveTo(4, 32); x.lineTo(60, 32); x.stroke();
  const t = new THREE.CanvasTexture(c);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  s.scale.set(0.35, 0.35, 0.35); s.renderOrder = 6;
  return s;
}
