// Oricourt — maquette 3D v0
// Géométrie : relevé IGN LiDAR HD (MNT/MNS/MNH 0,5 m) + BD TOPO V3, extraits par scripts/prep.py.
// Repère local : x = est, y = nord, z = haut (m), origine = haute-cour (340 m NGF).
// Repère three.js : X = x, Y = z, Z = -y.
import * as THREE from 'three';
import { OrbitControls } from './lib/OrbitControls.js';
import { mergeGeometries } from './lib/BufferGeometryUtils.js';
import { INTRO, FIN, PERSONNAGES, ANIMAUX, BETES, FIGURANTS, ROUTINES, MASURES, CENTRE_BROUILLARD, RAYON_BROUILLARD, DEPART } from './jeu_donnees.js';
import { chargerVivants } from './vivants.js';

const $ = (id) => document.getElementById(id);
const etat = (t, p) => { $('c-etat').textContent = t; if (p != null) $('c-barre').style.width = Math.round(p * 100) + '%'; };
const V = (x, y, z) => new THREE.Vector3(x, z, -y);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const DEG = Math.PI / 180;

// ------------------------------------------------------------------ rendu
const canvas = $('scene');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (e) {
  etat("Ce navigateur ne permet pas l'affichage 3D (WebGL indisponible).", 0);
  throw e;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.3, 4000);

// ------------------------------------------------------------------ données
etat('Chargement du relevé LiDAR…', 0.05);
const data = await (await fetch('data/oricourt_data.json')).json();
const T = data.terrain;
const paysage = await (await fetch('data/paysage.json')).json();
const hLoin = new Uint16Array(Uint8Array.from(atob(paysage.hauteurs_b64), (c) => c.charCodeAt(0)).buffer);
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const h16 = new Uint16Array(b64(T.hauteurs_b64).buffer);
const terre8 = b64(T.terre_b64);
etat('Chargement des textures…', 0.25);

const N = T.n, HALF = T.demi_cote, PAS = T.pas;
const planchers = [];   // {c:[x,y], r, z} : sols intérieurs plans
function hauteurSol(x, y) {
  for (const p of planchers) if (Math.hypot(x - p.c[0], y - p.c[1]) < p.r) return p.z;
  return hauteurTerrain(x, y);
}
function hauteurTerrain(x, y) {
  const fx = clamp((x + HALF) / PAS, 0, N - 1.001), fy = clamp((HALF - y) / PAS, 0, N - 1.001);
  const i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j;
  const h = (ii, jj) => T.zmin + h16[jj * N + ii] * T.echelle;
  return lerp(lerp(h(i, j), h(i + 1, j), tx), lerp(h(i, j + 1), h(i + 1, j + 1), tx), ty);
}

// ------------------------------------------------------------------ textures et matières
const chargeur = new THREE.TextureLoader();
const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
let nbTex = 0; const TOTAL_TEX = 15;
function tex(nom, srgb, couverture) {
  return new Promise((ok) => {
    chargeur.load('tex/' + nom + '.webp', (t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(1 / couverture, 1 / couverture);
      t.anisotropy = aniso;
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      nbTex++; etat('Chargement des textures…', 0.25 + 0.55 * nbTex / TOTAL_TEX);
      ok(t);
    }, undefined, () => { nbTex++; ok(null); });
  });
}
const [moA, moN, caA, caN, crA, crN, tuA, tuN, plA, plN, teA, teN, heA, heN, ciel] = await Promise.all([
  tex('moellons_albedo', true, 3), tex('moellons_normal', false, 3),
  tex('calcaire_albedo', true, 3), tex('calcaire_normal', false, 3),
  tex('crepi_albedo', true, 2), tex('crepi_normal', false, 2),
  tex('tuiles_albedo', true, 2), tex('tuiles_normal', false, 2),
  tex('planches_albedo', true, 2), tex('planches_normal', false, 2),
  tex('terre_albedo', true, 2.5), tex('terre_normal', false, 2.5),
  tex('herbe_albedo', true, 2), tex('herbe_normal', false, 2),
  tex('ciel_jour_clair', true, 1),
]);
const [o1A, o1N, o2A, o3A, o4A, o4N, o5A, o5N, o6A, o7A, o8A] = await Promise.all([
  tex('ori01_albedo', true, 3), tex('ori01_normal', false, 3), tex('ori02_albedo', true, 2), tex('ori03_albedo', true, 1), tex('ori04_albedo', true, 2), tex('ori04_normal', false, 2),
  tex('ori05_albedo', true, 4.5), tex('ori05_normal', false, 4.5), tex('ori06_albedo', true, 1), tex('ori07_albedo', true, 2), tex('ori08_albedo', true, 3),
]);
if (o6A) o6A.wrapS = o6A.wrapT = THREE.ClampToEdgeWrapping;
const [feA, hbA, liA, laA, laN] = await Promise.all([
  tex('feuillage', true, 1), tex('herbes', true, 1), tex('lierre', true, 1), tex('lauzes_albedo', true, 2), tex('lauzes_normal', false, 2),
]);
for (const t of [feA, hbA, liA]) if (t) { t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; }
const chargerImage = (f) => new Promise((ok) => chargeur.load(f, (t) => { t.colorSpace = THREE.SRGBColorSpace; ok(t); }, undefined, () => ok(null)));
const [texOrtho, texPano, phGal, phFac] = await Promise.all([chargerImage('tex/ortho_large.jpg'), chargerImage('tex/ciel_panorama.jpg'), chargerImage('tex/photo_galerie.jpg'), chargerImage('tex/photo_facade.jpg')]);
if (texOrtho) texOrtho.anisotropy = aniso;
if (texPano) { texPano.wrapS = THREE.RepeatWrapping; texPano.wrapT = THREE.ClampToEdgeWrapping; texPano.generateMipmaps = false; texPano.minFilter = THREE.LinearFilter; }
etat('Construction de la maquette…', 0.85);

// carte des hauteurs du sol, lue par les matières des murs (patine au pied des murs)
const texSol = new THREE.DataTexture(Float32Array.from(h16, (v) => T.zmin + v * T.echelle), N, N, THREE.RedFormat, THREE.FloatType);
texSol.magFilter = texSol.minFilter = renderer.extensions.has('OES_texture_float_linear') ? THREE.LinearFilter : THREE.NearestFilter;
texSol.needsUpdate = true;
const GLSL_BRUIT = `
  float hsh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float brt(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
    return mix(mix(hsh(i), hsh(i+vec2(1,0)), f.x), mix(hsh(i+vec2(0,1)), hsh(i+vec2(1,1)), f.x), f.y); }
  float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++){ s += a*brt(p); p = p*2.03 + 11.7; a *= 0.5; } return s; }`;
// patine des maçonneries : variations de teinte, coulures, pied de mur sombre et moussu, deux appareils sur les courtines
function patine(mat, seuil) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.texSol = { value: texSol }; sh.uniforms.seuilAppareil = { value: seuil == null ? -99 : seuil };
    sh.uniforms.mapHaut = { value: o2A }; sh.uniforms.mapBande = { value: o3A };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPosMonde;\nvarying vec2 vUvBrut;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vUvBrut = uv;
        #ifdef USE_INSTANCING
          vPosMonde = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        #else
          vPosMonde = (modelMatrix * vec4(transformed, 1.0)).xyz;
        #endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D texSol, mapHaut, mapBande; uniform float seuilAppareil;\nvarying vec3 vPosMonde; varying vec2 vUvBrut;' + GLSL_BRUIT)
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec2 q = vec2(vPosMonde.x + vPosMonde.z, vPosMonde.y);
        float n1 = fbm(q * 0.22), n2 = fbm(vec2(q.x * 1.9, q.y * 0.16) + 31.0);
        vec3 teinte = mix(vec3(0.84, 0.80, 0.72), vec3(1.10, 1.08, 1.03), n1);
        teinte *= mix(0.78, 1.0, smoothstep(0.30, 0.62, n2));
        if (seuilAppareil > -50.0) {
          float dH = vPosMonde.y - seuilAppareil;
          vec3 cHaut = texture2D(mapHaut, vUvBrut / 2.0).rgb;
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuse * cHaut, step(0.0, dH));
          if (abs(dH) < 0.5) diffuseColor.rgb = diffuse * texture2D(mapBande, vec2(vUvBrut.x / 4.0, clamp(dH + 0.5, 0.01, 0.99))).rgb;
        }
        vec2 uvS = vec2((vPosMonde.x + ${HALF}.0) / ${2 * HALF}.0, (vPosMonde.z + ${HALF}.0) / ${2 * HALF}.0);
        float dSol = vPosMonde.y - texture2D(texSol, uvS).r;
        float pied = 1.0 - smoothstep(0.0, 1.6 + n1 * 1.4, dSol);
        teinte = mix(teinte, teinte * vec3(0.58, 0.64, 0.46), pied * 0.6);
        diffuseColor.rgb *= teinte;`);
  };
  return mat;
}


const nScale = new THREE.Vector2(1.25, 1.25);
const M = {
  courtine: new THREE.MeshStandardMaterial({ map: o1A || moA, normalMap: o1N || moN, normalScale: nScale, color: 0xdfe0da, roughness: 0.96 }),
  tour: new THREE.MeshStandardMaterial({ map: o1A || caA, normalMap: o1N || caN, normalScale: nScale, color: 0xdfe0da, roughness: 0.94 }),
  logis: new THREE.MeshStandardMaterial({ map: o2A || moA, normalMap: moN, normalScale: nScale, color: 0xf6ecd8, roughness: 0.95 }),
  village: new THREE.MeshStandardMaterial({ map: crA, normalMap: crN, normalScale: nScale, color: 0xe8dcc6, roughness: 0.97 }),
  tuiles: new THREE.MeshStandardMaterial({ map: o4A || tuA, normalMap: o4N || tuN, normalScale: nScale, color: 0x9d968c, roughness: 0.9, side: THREE.DoubleSide }),
  tuilesVillage: new THREE.MeshStandardMaterial({ map: o4A || tuA, normalMap: o4N || tuN, normalScale: nScale, color: 0xf2d9c8, roughness: 0.9, side: THREE.DoubleSide }),
  bois: new THREE.MeshStandardMaterial({ map: o7A || plA, normalMap: plN, normalScale: nScale, color: 0xd8c8b0, roughness: 0.92 }),
  metal: new THREE.MeshStandardMaterial({ color: 0x55534f, metalness: 0.0, roughness: 0.7, envMapIntensity: 0.4, side: THREE.DoubleSide }),
  lauzes: new THREE.MeshStandardMaterial({ map: laA, normalMap: laN, normalScale: nScale, color: 0xd9d4c8, roughness: 0.95, side: THREE.DoubleSide }),
  trou: new THREE.MeshStandardMaterial({ color: 0x15110c, roughness: 1 }),
  encadrement: new THREE.MeshStandardMaterial({ map: caA, color: 0xfff1d6, roughness: 0.9 }),
  ruine: new THREE.MeshStandardMaterial({ map: caA, normalMap: caN, normalScale: nScale, color: 0xd6d2b0, roughness: 0.98, flatShading: true, side: THREE.DoubleSide }),
};

// matière « photo redressée » : la photographie donne les teintes et les baies réelles, la texture de pierre garde le grain net de près
function matPhoto(tex, L, H, z0) {
  if (!tex) return M.logis;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.repeat.set(1 / L, 1 / H); tex.offset.set(0, -z0 / H); tex.anisotropy = aniso;
  const m = new THREE.MeshStandardMaterial({ map: tex, normalMap: moN, normalScale: new THREE.Vector2(0.7, 0.7), roughness: 0.97, color: 0xfff0d8 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.detail = { value: o2A };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vUvBrut;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvUvBrut = uv;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D detail; varying vec2 vUvBrut;')
      .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb *= 1.08 * mix(vec3(1.0), texture2D(detail, vUvBrut / 2.0).rgb * 1.6, 0.45);');
  };
  return m;
}
patine(M.courtine, 7.6); patine(M.tour, 7.6); patine(M.logis); patine(M.village);

// ------------------------------------------------------------------ ciel, lumière, brouillard
if (ciel) {
  ciel.mapping = THREE.EquirectangularReflectionMapping;
  ciel.repeat.set(1, 1);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromEquirectangular(ciel).texture;
  scene.environmentIntensity = 0.55;
}
scene.background = new THREE.Color(0xc6c4c0);
const DIR_SOLEIL = V(-95, -120, 130).sub(V(4, -12, 0)).normalize();
const matCiel = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { soleil: { value: DIR_SOLEIL }, temps: { value: 0 } },
  vertexShader: `varying vec3 vDir; void main(){ vDir = position; vec4 p = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }`,
  fragmentShader: `uniform vec3 soleil; uniform float temps; uniform sampler2D pano; uniform float brume; varying vec3 vDir;
    void main(){
      vec3 d = normalize(vDir);
      float az = atan(d.z, d.x) / 6.2831853 + 0.5 + temps * 0.0005;
      float el = asin(clamp(d.y, -1.0, 1.0));
      float v = 1.0 - (1.5707963 - el) / 3.14159265 * (2048.0 / 1180.0);
      vec3 col = texture2D(pano, vec2(az, clamp(v, 0.004, 0.996))).rgb * 1.12;
      float cs = max(dot(d, soleil), 0.0);
      col += vec3(1.0, 0.9, 0.72) * pow(cs, 10.0) * 0.16;
      col = mix(col, vec3(0.80, 0.79, 0.84), brume * (1.0 - smoothstep(0.0, 0.55, d.y)));
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
});
matCiel.uniforms.pano = { value: texPano }; matCiel.uniforms.brume = { value: 0 };
const dome = new THREE.Mesh(new THREE.SphereGeometry(100, 48, 24), matCiel);
dome.frustumCulled = false; dome.renderOrder = -10; scene.add(dome);
scene.fog = new THREE.Fog(0xc6c4c0, 300, 1500);
const hemi = new THREE.HemisphereLight(0xdfe3ea, 0x6a6238, 0.85);
scene.add(hemi);
const soleil = new THREE.DirectionalLight(0xfff0d6, 2.3);
soleil.position.copy(V(-95, -120, 130));
soleil.target.position.copy(V(4, -12, 0));
soleil.castShadow = true;
soleil.shadow.mapSize.set(2048, 2048);
const sc = soleil.shadow.camera;
sc.left = -105; sc.right = 105; sc.top = 105; sc.bottom = -105; sc.near = 20; sc.far = 450;
soleil.shadow.bias = -0.0004; soleil.shadow.normalBias = 0.5;
scene.add(soleil, soleil.target);

// ------------------------------------------------------------------ outil de géométrie
class Geo {
  constructor() { this.p = []; this.u = []; this.i = []; }
  // quad p0..p3 (Vector3, sens quelconque) ; n : normale attendue (Vector3)
  quad(p0, p1, p2, p3, t0, t1, t2, t3, n) {
    const a = new THREE.Vector3().subVectors(p1, p0), b = new THREE.Vector3().subVectors(p2, p0);
    const c = new THREE.Vector3().crossVectors(a, b);
    let P = [p0, p1, p2, p3], U = [t0, t1, t2, t3];
    if (n && c.dot(n) < 0) { P = [p0, p3, p2, p1]; U = [t0, t3, t2, t1]; }
    const k = this.p.length / 3;
    for (let q = 0; q < 4; q++) { this.p.push(P[q].x, P[q].y, P[q].z); this.u.push(U[q][0], U[q][1]); }
    this.i.push(k, k + 1, k + 2, k, k + 2, k + 3);
  }
  geometrie() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.setIndex(this.i); g.computeVertexNormals();
    return g;
  }
  vide() { return this.i.length === 0; }
}
function maille(geo, mat, ombre = true) {
  const m = new THREE.Mesh(geo, mat); m.castShadow = ombre; m.receiveShadow = true; return m;
}

// groupes : commun, aujourd'hui seulement, esquisse médiévale seulement
const G = { commun: new THREE.Group(), actuel: new THREE.Group(), medieval: new THREE.Group(), vie: new THREE.Group(), jeu: new THREE.Group() };
scene.add(G.commun, G.actuel, G.medieval, G.vie, G.jeu);
G.vie.visible = false; G.jeu.visible = false;
G.medieval.visible = false;

// ------------------------------------------------------------------ terrain
function construireTerrain() {
  const pos = new Float32Array(N * N * 3), uv = new Float32Array(N * N * 2), terre = new Float32Array(N * N), col = new Float32Array(N * N * 3);
  const bruit = (x, y) => { const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; return s - Math.floor(s); };
  const lisse = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    return lerp(lerp(bruit(xi, yi), bruit(xi + 1, yi), sx), lerp(bruit(xi, yi + 1), bruit(xi + 1, yi + 1), sx), sy);
  };
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i, x = -HALF + i * PAS, y = HALF - j * PAS, z = T.zmin + h16[k] * T.echelle;
    pos[k * 3] = x; pos[k * 3 + 1] = z; pos[k * 3 + 2] = -y;
    uv[k * 2] = x; uv[k * 2 + 1] = y;
    terre[k] = terre8[k] / 255;
    const v = 0.86 + 0.16 * lisse(x / 23, y / 23) + 0.07 * lisse(x / 6.5, y / 6.5);
    col[k * 3] = v * 1.0; col[k * 3 + 1] = v * 1.0; col[k * 3 + 2] = v * 0.93;
  }
  const idx = [];
  for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
    const a = j * N + i, b = a + 1, c = a + N, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('terre', new THREE.BufferAttribute(terre, 1));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({ map: heA, normalMap: heN, normalScale: new THREE.Vector2(0.6, 0.6), vertexColors: true, roughness: 1, color: 0xd9e3b8 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.carteTerre = { value: o8A || teA }; sh.uniforms.carteOrtho = { value: texOrtho };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float terre;\nvarying float vTerre;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvTerre = terre;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D carteTerre, carteOrtho;\nvarying float vTerre;')
      .replace('#include <map_fragment>', `
        vec4 cHerbe = texture2D( map, vMapUv );
        vec4 cTerre = texture2D( carteTerre, vMapUv * 0.667 ) * vec4(1.1, 1.06, 1.0, 1.0);
        diffuseColor *= mix( cHerbe, cTerre, smoothstep(0.15, 0.85, vTerre) );
        vec2 plan = vMapUv * 2.0;
        vec3 cOrtho = texture2D( carteOrtho, (plan + 800.0) / 1600.0 ).rgb * 1.25;
        diffuseColor.rgb = mix( diffuseColor.rgb, cOrtho, smoothstep(112.0, 147.0, max(abs(plan.x), abs(plan.y))) );`);
  };
  const terrain = new THREE.Mesh(g, mat);
  terrain.receiveShadow = true;
  G.commun.add(terrain);

  // jupe verticale sur le pourtour (cache les jointures avec le paysage lointain)
  const jupe = new Geo();
  const bord = [];
  for (let i = 0; i < N; i++) bord.push([i, 0]);
  for (let j = 1; j < N; j++) bord.push([N - 1, j]);
  for (let i = N - 2; i >= 0; i--) bord.push([i, N - 1]);
  for (let j = N - 2; j > 0; j--) bord.push([0, j]);
  bord.push([0, 0]);
  for (let q = 0; q < bord.length - 1; q++) {
    const [i0, j0] = bord[q], [i1, j1] = bord[q + 1];
    const x0 = -HALF + i0, y0 = HALF - j0, x1 = -HALF + i1, y1 = HALF - j1;
    const z0 = T.zmin + h16[j0 * N + i0] * T.echelle, z1 = T.zmin + h16[j1 * N + i1] * T.echelle;
    jupe.quad(V(x0, y0, z0 - 6), V(x1, y1, z1 - 6), V(x1, y1, z1), V(x0, y0, z0), [x0, z0 - 6], [x1, z1 - 6], [x1, z1], [x0, z0], null);
  }
  const mj = new THREE.MeshStandardMaterial({ color: 0x6f7a4a, roughness: 1, side: THREE.DoubleSide });
  G.commun.add(new THREE.Mesh(jupe.geometrie(), mj));

  // paysage lointain (±800 m) : relief IGN au pas de 10 m, habillé de la photographie aérienne
  const n2 = paysage.n, pas2 = paysage.pas, h2 = paysage.demi_cote;
  const p2 = [], u2 = [], i2 = [];
  for (let j = 0; j < n2; j++) for (let i = 0; i < n2; i++) {
    const x = -h2 + i * pas2, y = h2 - j * pas2;
    let z = paysage.zmin + hLoin[j * n2 + i] * paysage.echelle;
    if (Math.abs(x) < HALF - 4 && Math.abs(y) < HALF - 4) z -= 4;
    p2.push(x, z, -y); u2.push(i / (n2 - 1), 1 - j / (n2 - 1));
  }
  for (let j = 0; j < n2 - 1; j++) for (let i = 0; i < n2 - 1; i++) {
    const a = j * n2 + i, b = a + 1, c = a + n2, d = c + 1; i2.push(a, c, b, b, c, d);
  }
  const gl = new THREE.BufferGeometry();
  gl.setAttribute('position', new THREE.Float32BufferAttribute(p2, 3));
  gl.setAttribute('uv', new THREE.Float32BufferAttribute(u2, 2));
  gl.setIndex(i2); gl.computeVertexNormals();
  const ml = new THREE.MeshStandardMaterial({ map: texOrtho, color: 0xffffff, roughness: 1, envMapIntensity: 0.3 });
  const loin = new THREE.Mesh(gl, ml); loin.receiveShadow = false;
  G.commun.add(loin);
}
construireTerrain();

// ------------------------------------------------------------------ bâtiments (murs extrudés + toits relevés au LiDAR)
const CENTRE_HC = [-3, -5];
const TOURELLE = { r: 2.35, apo: 2.35 * Math.cos(Math.PI / 8), d: [-0.5, -0.866] };   // tourelle d'escalier à huit pans, porte au sud-sud-ouest
const obstacles = [];      // polygones 2D pour la visite à pied
const ROLES_TOUR = new Set(['tour_maitresse', 'tour_ouest', 'tourelle_sud_ouest']);
function axePrincipal(b) {
  const r = b.rect; let best = 0, ang = 0;
  for (let k = 0; k < 4; k++) {
    const a = r[k], c = r[(k + 1) % 4], L = Math.hypot(c[0] - a[0], c[1] - a[1]);
    if (L > best) { best = L; ang = Math.atan2(c[1] - a[1], c[0] - a[0]); }
  }
  return ang;
}
const occultants = [];
// galerie du logis Rolin (face sud de l'aile) : trois arches ouvertes, profondeur estimée d'après les photos
const GAL = { B: [6.1, 5.6], A: [15.0, 0.3], prof: 3.4, ep: 0.6, ouv: 2.76, haut: 3.9 };
{ const dx = GAL.A[0] - GAL.B[0], dy = GAL.A[1] - GAL.B[1]; GAL.L = Math.hypot(dx, dy); GAL.t = [dx / GAL.L, dy / GAL.L];
  GAL.n = [GAL.t[1], -GAL.t[0]]; if ((-3 - GAL.B[0]) * GAL.n[0] + (-5 - GAL.B[1]) * GAL.n[1] < 0) GAL.n = [-GAL.n[0], -GAL.n[1]];
  GAL.pt = (s, d) => [GAL.B[0] + GAL.t[0] * s - GAL.n[0] * d, GAL.B[1] + GAL.t[1] * s - GAL.n[1] * d];
  const m = GAL.pt(GAL.L / 2, -1); GAL.sol = hauteurTerrain(m[0], m[1]); GAL.zHaut = GAL.sol + GAL.haut;
  GAL.egout = () => { const b = data.batiments.find((q) => q.role === 'logis_rolin'), e = b.contour.map((p, k) => GAL.sur(p) ? b.egouts[k] : null).filter((v) => v != null).sort((x, y) => x - y); return e.length ? e[Math.floor(e.length / 2)] : GAL.zHaut + 2.3; };
  GAL.sur = (p) => { const u = (p[0] - GAL.B[0]) * GAL.t[0] + (p[1] - GAL.B[1]) * GAL.t[1], v = Math.abs((p[0] - GAL.B[0]) * GAL.n[0] + (p[1] - GAL.B[1]) * GAL.n[1]); return u > -0.3 && u < GAL.L + 0.3 && v < 0.35; }; }
const passages = [];
function construireBatiment(b) {
  const groupe = b.groupe === 'village' ? G.actuel : (ROLES_TOUR.has(b.role) ? G.actuel : G.commun);
  if (b.ruine) {
    // tour ruinée : quatre murs épais au sommet déchiqueté (relevé LiDAR), comblement végétalisé à l'intérieur
    const geo = new Geo();
    for (const cote of b.ruine.cotes) {
      const pts = cote.map((p) => ({ x: p[0], y: p[1], base: p[2], top: p[3] }));
      ruban(pts, b.ruine.epaisseur, (p) => p.top, geo, b.ruine.epaisseur / 2);
    }
    const m = maille(geo.geometrie(), M.tour); groupe.add(m); occultants.push(m);
    const forme = new THREE.Shape(b.ruine.fond_poly.map(([x, y]) => new THREE.Vector2(x, y)));
    const gf = new THREE.ShapeGeometry(forme); gf.rotateX(-Math.PI / 2); gf.translate(0, b.ruine.fond, 0);
    groupe.add(maille(gf, M.ruine));
    obstacles.push({ poly: b.contour, village: false, role: b.role });
    return;
  }
  if (b.role === 'colombier') { construireColombier(b); return; }
  if (b.toit_simple) { construireDeuxPans(b, groupe); return; }
  percer(b, simplifier(b.contour), [...b.egouts].sort((p, q) => p - q)[Math.floor(b.egouts.length * 0.3)]);
  const C = b.contour, E = b.egouts, n = C.length, base = b.sol - 1.5;
  const murs = new Geo(), hauts = new Geo();
  const coupe = b.role === 'tour_maitresse' ? 21.5 : null;     // bardage bois moderne au sommet
  let s = 0;
  for (let k = 0; k < n; k++) {
    const a = C[k], c = C[(k + 1) % n], ea = E[k], ec = E[(k + 1) % n];
    const dx = c[0] - a[0], dy = c[1] - a[1], L = Math.hypot(dx, dy);
    if (L < 1e-3) continue;
    const nrm = new THREE.Vector3(dy, 0, dx);
    if (coupe && ea > coupe && ec > coupe) {
      murs.quad(V(a[0], a[1], base), V(c[0], c[1], base), V(c[0], c[1], coupe), V(a[0], a[1], coupe), [s, base], [s + L, base], [s + L, coupe], [s, coupe], nrm);
      hauts.quad(V(a[0], a[1], coupe), V(c[0], c[1], coupe), V(c[0], c[1], ec), V(a[0], a[1], ea), [s, coupe], [s + L, coupe], [s + L, ec], [s, ea], nrm);
    } else {
      const bas = b.role === 'logis_rolin' && GAL.sur(a) && GAL.sur(c) ? GAL.zHaut : base;
      murs.quad(V(a[0], a[1], bas), V(c[0], c[1], bas), V(c[0], c[1], ec), V(a[0], a[1], ea), [s, bas], [s + L, bas], [s + L, ec], [s, ea], nrm);
    }
    s += L;
  }
  const matMur = b.groupe === 'village' ? M.village : (ROLES_TOUR.has(b.role) ? M.tour : M.logis);
  const mm = maille(murs.geometrie(), matMur); groupe.add(mm); occultants.push(mm);
  if (!hauts.vide()) groupe.add(maille(hauts.geometrie(), M.bois));

  // toit : triangulation des points du MNS
  const ang = axePrincipal(b), ca = Math.cos(ang), sa = Math.sin(ang);
  const P = b.toit_pts, pos = new Float32Array(P.length * 3), uv = new Float32Array(P.length * 2);
  P.forEach(([x, y, z], k) => {
    pos[k * 3] = x; pos[k * 3 + 1] = z; pos[k * 3 + 2] = -y;
    uv[k * 2] = x * ca + y * sa; uv[k * 2 + 1] = -x * sa + y * ca;
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(b.toit_tris.flat()); g.computeVertexNormals();
  let matToit = b.groupe === 'village' ? M.tuilesVillage : M.tuiles;
  if (b.role === 'tour_maitresse') {
    const zt = [...E].sort((p, q) => p - q)[Math.floor(E.length * 0.6)];
    prismeRect(b.rect, zt - 0.6, zt - 0.05, M.bois, groupe);
    pyramide(rectExpanse(b.rect, 0.55), zt - 0.05, 1.1, M.metal, groupe);
    obstacles.push({ poly: C, village: false, role: b.role });
    return;
  }
  if (b.role === 'tour_ouest' || b.role === 'tourelle_sud_ouest') matToit = M.ruine;
  const mt = maille(g, matToit); groupe.add(mt); occultants.push(mt);

  obstacles.push({ poly: C, village: b.groupe === 'village', role: b.role });
}
// --- ouvertures (portes, fenêtres, archères) : positions plausibles, pas encore relevées
const OUV = { commun: [], actuel: [] };
function simplifier(poly) {
  const out = [], n = poly.length;
  for (let k = 0; k < n; k++) {
    const a = poly[(k + n - 1) % n], p = poly[k], c = poly[(k + 1) % n];
    const cr = (p[0] - a[0]) * (c[1] - p[1]) - (p[1] - a[1]) * (c[0] - p[0]);
    const l = Math.hypot(p[0] - a[0], p[1] - a[1]) * Math.hypot(c[0] - p[0], c[1] - p[1]);
    if (Math.abs(cr) > 0.06 * l) out.push(p);
  }
  return out.length >= 3 ? out : poly;
}
// une ouverture : centre bas (x, y, z), tangente t, normale n ; type : 'fenetre' | 'meneau' | 'porte' | 'arc' | 'archere'
const ATLAS_OUV = {     // rectangles de l'atlas ORI-06 (boîte alpha, px sur 2048, origine en haut à gauche)
  meneau: [104, 153, 552, 795], porte: [775, 69, 571, 964], arc: [1454, 156, 557, 894], archere: [317, 1166, 436, 811], fenetre: [1171, 1196, 610, 718],
};
function ouverture(cible, x, y, z, t, n, w, h, type, hImpose) {
  const [px, py, pw, ph] = ATLAS_OUV[type], W = type === 'archere' ? 0.75 : w + 0.3, H = hImpose || W * ph / pw;
  cible.push({ c: V(x + n[0] * 0.05, y + n[1] * 0.05, z + H / 2 - 0.12), ax: V(t[0], t[1], 0).multiplyScalar(W / 2 * (n[0] * t[1] - n[1] * t[0] > 0 ? 1 : -1)).sub(V(0, 0, 0)), ay: new THREE.Vector3(0, H / 2, 0),
    cell: [px / 2048, 1 - (py + ph) / 2048, (px + pw) / 2048, 1 - py / 2048], n: new THREE.Vector3(n[0], 0, -n[1]) });
}
function libre(x, y) {      // le point devant le mur n'est pas dans un autre bâtiment ni contre une courtine
  for (const o of obstacles) if (o.poly && dedansPoly(x, y, o.poly)) return false;
  for (const w of data.murs) for (let k = 0; k < w.pts.length - 1; k++) if (distSeg(x, y, w.pts[k], w.pts[k + 1]) < w.epaisseur / 2 + 0.3) return false;
  return true;
}
function percer(b, poly, zEgout) {
  if (b.role === 'colombier' || b.role === 'appentis' || b.ruine && b.role === 'tourelle_sud_ouest') return;
  const cible = b.groupe === 'village' ? OUV.actuel : OUV.commun;
  let aire = 0; poly.forEach((p, k) => { const c = poly[(k + 1) % poly.length]; aire += p[0] * c[1] - c[0] * p[1]; });
  const sens = aire > 0 ? 1 : -1, tour = ROLES_TOUR.has(b.role), chateau = b.groupe === 'chateau' && !tour;
  let graine = Math.abs(Math.round(poly[0][0] * 31 + poly[0][1] * 17));
  const alea = () => { graine = (graine * 1103515245 + 12345) % 2147483648; return graine / 2147483648; };
  poly.forEach((a, k) => {
    const c = poly[(k + 1) % poly.length], L = Math.hypot(c[0] - a[0], c[1] - a[1]);
    if (L < 2.4) return;
    const t = [(c[0] - a[0]) / L, (c[1] - a[1]) / L], n = [t[1] * sens, -t[0] * sens];
    const versCour = ((CENTRE_HC[0] - (a[0] + c[0]) / 2) * n[0] + (CENTRE_HC[1] - (a[1] + c[1]) / 2) * n[1]) > 0;
    if (tour) {
      for (const dz of [5.5, 11, 16.5]) { const x = (a[0] + c[0]) / 2, y = (a[1] + c[1]) / 2; ouverture(cible, x, y, hauteurTerrain(x + n[0], y + n[1]) + dz, t, n, 0.16, 1.5, 'archere'); }
      if (b.role === 'tour_maitresse' && versCour && L > 8) {
        const x = (a[0] + c[0]) / 2, y = (a[1] + c[1]) / 2, z = hauteurTerrain(x + n[0], y + n[1]) + 8;
        ouverture(cible, x, y, z, t, n, 0.9, 1.9, 'arc');
        const pal = maille(new THREE.BoxGeometry(1.8, 0.14, 1.1), M.bois); pal.position.copy(V(x + n[0] * 0.55, y + n[1] * 0.55, z - 0.07)); pal.rotation.y = Math.atan2(t[1], t[0]); G.commun.add(pal);
      }
      return;
    }
    const pas = chateau ? 3.3 : 3.0, nb = Math.max(1, Math.floor(L / pas));
    for (let i = 0; i < nb; i++) {
      const s = L * (i + 0.5) / nb, x = a[0] + t[0] * s, y = a[1] + t[1] * s;
      if (!libre(x + n[0] * 0.7, y + n[1] * 0.7)) continue;
      const zs = hauteurTerrain(x + n[0] * 0.8, y + n[1] * 0.8), H = zEgout - zs, r = alea();
      if (H < 2.6) continue;
      if (chateau && versCour && b.role === 'logis_rolin') continue;
      if (chateau) {
        if (false) {}
        else if (r < 0.3 && H < 9) ouverture(cible, x, y, zs + 0.02, t, n, 1.1, 2.2, 'arc');
        else if (H < 7.5) ouverture(cible, x, y, zs + 1.3, t, n, 0.7, 1.0, 'fenetre');
        if (H > 6.2) ouverture(cible, x, y, zs + (H > 9 ? Math.min(5.6, H - 4.2) : 3.9), t, n, versCour ? 1.1 : 0.8, 1.7, versCour ? 'meneau' : 'fenetre');
        if (H > 11.5 && r > 0.4) ouverture(cible, x, y, zs + H - 3.3, t, n, 0.8, 1.1, 'fenetre');
      } else {
        if (r < 0.22) ouverture(cible, x, y, zs + 0.02, t, n, 1.0, 2.05, 'porte');
        else if (r < 0.34 && L > 7) ouverture(cible, x, y, zs + 0.02, t, n, 1.8, 2.9, 'arc');
        else ouverture(cible, x, y, zs + 1.0, t, n, 0.9, 1.25, 'fenetre');
        if (H > 5.6 && r > 0.15) ouverture(cible, x, y, zs + 3.6, t, n, 0.9, 1.2, 'fenetre');
      }
    }
  });
}
function construireDeuxPans(b, groupe) {
  const S = b.toit_simple, u = S.u, v = [-u[1], u[0]], base = b.sol - 1.5;
  const pt = (a, c) => [S.c[0] + u[0] * a + v[0] * c, S.c[1] + u[1] * a + v[1] * c];
  const R = [pt(-S.hl, -S.hw), pt(S.hl, -S.hw), pt(S.hl, S.hw), pt(-S.hl, S.hw)];
  percer(b, R, S.ze);
  const murs = new Geo(); let s = 0;
  for (let k = 0; k < 4; k++) {
    const a = R[k], c = R[(k + 1) % 4], L = Math.hypot(c[0] - a[0], c[1] - a[1]), nrm = new THREE.Vector3(c[1] - a[1], 0, c[0] - a[0]);
    murs.quad(V(a[0], a[1], base), V(c[0], c[1], base), V(c[0], c[1], S.ze), V(a[0], a[1], S.ze), [s, base], [s + L, base], [s + L, S.ze], [s, S.ze], nrm);
    if (k % 2 === 1) {       // pignon
      const m = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
      murs.quad(V(a[0], a[1], S.ze), V(c[0], c[1], S.ze), V(m[0], m[1], S.zf), V(m[0], m[1], S.zf), [s, S.ze], [s + L, S.ze], [s + L / 2, S.zf], [s + L / 2, S.zf], nrm);
    }
    s += L;
  }
  const mm = maille(murs.geometrie(), b.groupe === 'village' ? M.village : M.logis); groupe.add(mm); occultants.push(mm);
  const d = 0.45, pente = (S.zf - S.ze) / S.hw, zb = S.ze - d * pente, lp = Math.hypot(S.hw + d, S.zf - zb), toit = new Geo(), hl = S.hl + d;
  for (const sg of [-1, 1]) {
    const e0 = pt(-hl, sg * (S.hw + d)), e1 = pt(hl, sg * (S.hw + d)), f0 = pt(-hl, 0), f1 = pt(hl, 0);
    toit.quad(V(e0[0], e0[1], zb), V(e1[0], e1[1], zb), V(f1[0], f1[1], S.zf), V(f0[0], f0[1], S.zf), [0, 0], [2 * hl, 0], [2 * hl, lp], [0, lp], new THREE.Vector3(0, 1, 0));
  }
  const mt = maille(toit.geometrie(), b.groupe === 'village' ? M.tuilesVillage : M.tuiles); groupe.add(mt); occultants.push(mt);
  obstacles.push({ poly: R, village: b.groupe === 'village', role: b.role });
}
// --- le colombier : tour ronde relevée au LiDAR, visitable (intérieur restitué d'après le type « à pied » et la photo de la charpente)
function texBoulins() {
  const c = document.createElement('canvas'); c.width = c.height = 512; const x = c.getContext('2d');
  x.fillStyle = '#b9a47c'; x.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 2600; i++) { x.fillStyle = `rgba(${90 + Math.random() * 90},${80 + Math.random() * 70},${50 + Math.random() * 50},0.10)`; x.fillRect(Math.random() * 512, Math.random() * 512, 6 + Math.random() * 26, 3 + Math.random() * 10); }
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
    const cx = i * 128 + (j % 2 ? 96 : 32), cy = j * 128 + 64;
    x.fillStyle = '#8f7b57'; x.fillRect(cx - 42, cy + 34, 84, 9);
    const g = x.createRadialGradient(cx, cy + 6, 4, cx, cy, 44); g.addColorStop(0, '#0b0907'); g.addColorStop(0.8, '#1d1711'); g.addColorStop(1, '#5a4a33');
    x.fillStyle = g; x.beginPath(); x.moveTo(cx - 32, cy + 34); x.lineTo(cx - 32, cy - 8); x.quadraticCurveTo(cx, cy - 52, cx + 32, cy - 8); x.lineTo(cx + 32, cy + 34); x.closePath(); x.fill();
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso; return t;
}
const COLOMBIER = {};
function construireColombier(b) {
  const P = b.contour, cx = P.reduce((s, p) => s + p[0], 0) / P.length, cy = P.reduce((s, p) => s + p[1], 0) / P.length;
  const r = P.reduce((s, p) => s + Math.hypot(p[0] - cx, p[1] - cy), 0) / P.length + 0.1, ri = r - 0.9;
  const E = [...b.egouts].sort((p, q) => p - q), zE = E[Math.floor(E.length / 2)], zF = b.faite + 1.0;
  const dir = [-0.42, 0.91], th = Math.atan2(dir[0], -dir[1]), gap = Math.asin(0.6 / ri);     // porte tournée vers le château (hypothèse)
  let zSol = -1e9; for (let a = 0; a < 6.28; a += 0.4) zSol = Math.max(zSol, hauteurTerrain(cx + Math.cos(a) * ri * 0.7, cy + Math.sin(a) * ri * 0.7));
  zSol = Math.max(zSol, hauteurTerrain(cx + dir[0] * (r + 0.5), cy + dir[1] * (r + 0.5))) + 0.04;
  const zP = zSol + 2.0, base = b.sol - 1.5, g = new THREE.Group(); g.position.set(cx, 0, -cy); G.commun.add(g);
  const cyl = (rad, z0, z1, t0, tl, mat, dedans) => {
    const geo = new THREE.CylinderGeometry(rad, rad, z1 - z0, Math.max(6, Math.round(40 * tl / 6.283)), 1, true, t0, tl); geo.translate(0, (z0 + z1) / 2, 0);
    const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * rad * tl, z0 + uv.getY(i) * (z1 - z0));
    const m = maille(geo, mat); if (dedans) m.castShadow = false; g.add(m); return m;
  };
  const matInt = new THREE.MeshStandardMaterial({ map: texBoulins(), roughness: 1, side: THREE.BackSide, color: 0xf2e6cc });
  matInt.map.repeat.set(1 / 1.7, 1 / 1.7);
  const matPierreInt = new THREE.MeshStandardMaterial({ map: moA, color: 0xe6d6b4, roughness: 1, side: THREE.DoubleSide });
  occultants.push(cyl(r, base, zE, th + gap * ri / r, 2 * Math.PI - 2 * gap * ri / r, M.logis));
  cyl(r, zP, zE, th - gap * ri / r, 2 * gap * ri / r, M.logis);
  cyl(ri, zSol + 1.1, zE, th + gap, 2 * Math.PI - 2 * gap, matInt, true);
  cyl(ri, zSol - 0.3, zSol + 1.1, th + gap, 2 * Math.PI - 2 * gap, matPierreInt, true);
  cyl(ri, zP, zE, th - gap, 2 * gap, matPierreInt, true);
  // tableaux et linteau de la porte
  const tb = new Geo(), tg = [-dir[1], dir[0]];
  for (const sg of [-1, 1]) {
    const o = [cx + tg[0] * 0.6 * sg, cy + tg[1] * 0.6 * sg], ci = Math.sqrt(ri * ri - 0.36), co = Math.sqrt(r * r - 0.36);
    tb.quad(V(o[0] + dir[0] * ci, o[1] + dir[1] * ci, zSol - 0.3), V(o[0] + dir[0] * co, o[1] + dir[1] * co, zSol - 0.3), V(o[0] + dir[0] * co, o[1] + dir[1] * co, zP), V(o[0] + dir[0] * ci, o[1] + dir[1] * ci, zP), [0, 0], [0.9, 0], [0.9, 2], [0, 2], new THREE.Vector3(-tg[0] * sg, 0, tg[1] * sg));
  }
  { const ci = Math.sqrt(ri * ri - 0.36), co = Math.sqrt(r * r - 0.36), A = (sg, d) => V(cx + tg[0] * 0.6 * sg + dir[0] * d, cy + tg[1] * 0.6 * sg + dir[1] * d, zP);
    tb.quad(A(-1, ci), A(1, ci), A(1, co), A(-1, co), [0, 0], [1.2, 0], [1.2, 0.9], [0, 0.9], new THREE.Vector3(0, -1, 0)); }
  G.commun.add(maille(tb.geometrie(), matPierreInt));
  // sol, toit, charpente, potence et échelle tournante
  const sol = new THREE.Mesh(new THREE.CircleGeometry(r + 0.05, 40), new THREE.MeshStandardMaterial({ map: teA, color: 0xb9a78c, roughness: 1 }));
  { const uv = sol.geometry.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2 * r, uv.getY(i) * 2 * r); }
  sol.rotation.x = -Math.PI / 2; sol.position.y = zSol; sol.receiveShadow = true; g.add(sol);
  const cone = new THREE.ConeGeometry(r + 0.4, zF - zE + 0.3, 40, 1, true); cone.translate(0, (zF + zE - 0.3) / 2, 0);
  { const uv = cone.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2 * Math.PI * (r + 0.4), uv.getY(i) * 5.5); }
  occultants.push(g.add(maille(cone, M.lauzes)).children.at(-1));
  const coneInt = new THREE.ConeGeometry(r + 0.3, zF - zE + 0.1, 24, 1, true); coneInt.translate(0, (zF + zE - 0.5) / 2, 0);
  { const uv = coneInt.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 30, uv.getY(i) * 5); }
  const matBoisInt = new THREE.MeshStandardMaterial({ map: plA, color: 0x9a7650, roughness: 1, side: THREE.BackSide }); g.add(new THREE.Mesh(coneInt, matBoisInt));
  const bois = (geo, x, y, z, ry = 0, rz = 0) => { const m = maille(geo, M.bois); m.position.set(x, z, -y); m.rotation.set(0, ry, rz); m.castShadow = false; g.add(m); return m; };
  bois(new THREE.CylinderGeometry(0.16, 0.2, zF - 0.4 - zSol, 10), 0, 0, (zF - 0.4 + zSol) / 2);
  for (let k = 0; k < 12; k++) { const a = k * Math.PI / 6, L = Math.hypot(r, zF - zE); const m = bois(new THREE.BoxGeometry(L, 0.12, 0.1), Math.cos(a) * r / 2, -Math.sin(a) * r / 2 * -1, (zE + zF) / 2 - 0.12, a, 0); m.rotation.set(0, a, -Math.atan2(zF - zE, r)); m.position.set(Math.cos(a) * r / 2, (zE + zF) / 2 - 0.12, -Math.sin(a) * r / 2); }
  const pot = new THREE.Group(); pot.rotation.y = 0.9; g.add(pot);
  const pb = (geo, x, z, rz = 0) => { const m = new THREE.Mesh(geo, M.bois); m.position.set(x, z, 0); m.rotation.z = rz; pot.add(m); };
  const hE = zE - 0.6 - (zSol + 0.5), xE = ri - 0.55;
  pb(new THREE.BoxGeometry(xE + 0.2, 0.12, 0.12), xE / 2, zSol + 0.5); pb(new THREE.BoxGeometry(xE + 0.2, 0.12, 0.12), xE / 2, zE - 0.6);
  for (const dz of [-0.22, 0.22]) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.07, hE, 0.07), M.bois); m.position.set(xE, zSol + 0.5 + hE / 2, dz); pot.add(m); }
  for (let z = zSol + 0.85; z < zE - 0.7; z += 0.33) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.48), M.bois); m.position.set(xE, z, 0); pot.add(m); }
  const lampe = new THREE.PointLight(0xffe2b0, 14, 7.5, 1.6); lampe.position.set(0, zSol + 3.2, 0); g.add(lampe);
  planchers.push({ c: [cx, cy], r: r + 0.05, z: zSol });
  obstacles.push({ anneau: { c: [cx, cy], ri, ro: r, dir, demi: 0.6 } });
  Object.assign(COLOMBIER, { c: [cx, cy], r, dir, zSol, potence: pot });
}
data.batiments.forEach(construireBatiment);
// salle voûtée du logis, derrière la galerie (d'après une photo : berceau surbaissé, grande cheminée, bancs)
const SALLE = {};
function construireSalle(sPorte, lp, hp) {
  const { t, n, prof, sol } = GAL, P = GAL.pt, ep = 0.8, d0 = prof + ep, larg = 5.6, d1 = d0 + larg, s0 = 0.9;
  const logis = data.batiments.find((b) => b.role === 'logis_rolin').contour;
  let s1 = 14.5; while (s1 > 9 && !(dedansPoly(...P(s1 + 0.6, d0), logis) && dedansPoly(...P(s1 + 0.6, d1 + 0.6), logis))) s1 -= 0.5;
  let dMax = d1; while (dMax > d0 + 3.5 && !(dedansPoly(...P(s0 - 0.6, dMax + 0.6), logis) && dedansPoly(...P(s1 + 0.6, dMax + 0.6), logis))) dMax -= 0.4;
  const D1 = dMax, W = D1 - d0, zs = sol + 0.06, hn = 1.9, fl = Math.min(2.3, W * 0.42), zc = zs + hn;
  const mat = new THREE.MeshStandardMaterial({ map: o2A || moA, normalMap: moN, normalScale: nScale, color: 0xf3e3c4, roughness: 1, side: THREE.DoubleSide });
  const g = new Geo(), up = new THREE.Vector3(0, 1, 0);
  const q = (a, b, z0, z1, nr) => { const Lq = Math.hypot(b[0] - a[0], b[1] - a[1]); g.quad(V(a[0], a[1], z0), V(b[0], b[1], z0), V(b[0], b[1], z1), V(a[0], a[1], z1), [0, z0], [Lq, z0], [Lq, z1], [0, z1], nr); };
  const nS = new THREE.Vector3(-n[0], 0, n[1]), nN = nS.clone().negate(), tE = new THREE.Vector3(t[0], 0, -t[1]);
  // mur sud (côté galerie) percé de la porte, mur nord, tableaux de la porte
  q(P(s0, d0), P(sPorte - lp, d0), zs - 0.3, zc, nS); q(P(sPorte + lp, d0), P(s1, d0), zs - 0.3, zc, nS); q(P(sPorte - lp, d0), P(sPorte + lp, d0), sol + hp, zc, nS);
  q(P(s0, D1), P(s1, D1), zs - 0.3, zc, nN);
  q(P(sPorte - lp, prof), P(sPorte - lp, d0), sol - 0.3, sol + hp, tE); q(P(sPorte + lp, prof), P(sPorte + lp, d0), sol - 0.3, sol + hp, tE.clone().negate());
  { const a = P(sPorte - lp, prof), b = P(sPorte + lp, prof), c = P(sPorte + lp, d0), d = P(sPorte - lp, d0);
    g.quad(V(a[0], a[1], sol + hp), V(b[0], b[1], sol + hp), V(c[0], c[1], sol + hp), V(d[0], d[1], sol + hp), [0, 0], [1.2, 0], [1.2, ep], [0, ep], up.clone().negate());
    g.quad(V(a[0], a[1], zs - 0.02), V(b[0], b[1], zs - 0.02), V(c[0], c[1], zs - 0.02), V(d[0], d[1], zs - 0.02), [0, 0], [1.2, 0], [1.2, ep], [0, ep], up); }
  // voûte en berceau surbaissé et murs pignons
  const NV = 14, arc = (k) => { const a = Math.PI * k / NV; return [d0 + W / 2 - Math.cos(a) * W / 2, zc + Math.sin(a) * fl]; };
  for (let k = 0; k < NV; k++) {
    const [da, za] = arc(k), [db, zb] = arc(k + 1), A0 = P(s0, da), A1 = P(s1, da), B0 = P(s0, db), B1 = P(s1, db), u0 = k * W * 1.2 / NV, u1 = (k + 1) * W * 1.2 / NV;
    g.quad(V(A0[0], A0[1], za), V(A1[0], A1[1], za), V(B1[0], B1[1], zb), V(B0[0], B0[1], zb), [0, u0], [s1 - s0, u0], [s1 - s0, u1], [0, u1], new THREE.Vector3(0, -1, 0));
    for (const [sx, nr] of [[s0, tE], [s1, tE.clone().negate()]]) { const a0 = P(sx, da), b0 = P(sx, db); g.quad(V(a0[0], a0[1], zc), V(b0[0], b0[1], zc), V(b0[0], b0[1], zb), V(a0[0], a0[1], za), [da, zc], [db, zc], [db, zb], [da, za], nr); }
  }
  q(P(s0, d0), P(s0, D1), zs - 0.3, zc, tE); q(P(s1, d0), P(s1, D1), zs - 0.3, zc, tE.clone().negate());
  const m = maille(g.geometrie(), mat, false); G.commun.add(m);
  const fq = new Geo(), c = [P(s0, d0), P(s1, d0), P(s1, D1), P(s0, D1)];
  fq.quad(V(c[0][0], c[0][1], zs), V(c[1][0], c[1][1], zs), V(c[2][0], c[2][1], zs), V(c[3][0], c[3][1], zs), [0, 0], [s1 - s0, 0], [s1 - s0, W], [0, W], up);
  G.commun.add(maille(fq.geometrie(), new THREE.MeshStandardMaterial({ map: caA, color: 0xcdbfa2, roughness: 1 }), false));
  // mobilier : grande cheminée à hotte contre le mur nord, bancs, lampes
  const gm = new THREE.Group(), o = P((s0 + s1) / 2, d0 + W / 2); gm.position.copy(V(o[0], o[1], zs)); gm.rotation.y = Math.atan2(t[1], t[0]); G.commun.add(gm);
  const pierre = new THREE.MeshStandardMaterial({ map: caA, color: 0xefe2c8, roughness: 0.95 });
  const bx = (w, h, d, x, y, z, mt = pierre) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mt); b.position.set(x, y, z); gm.add(b); return b; };   // x : le long de la salle, z négatif : vers le nord
  const zN = -W / 2, xc = -0.6;
  for (const sx of [-1.15, 1.15]) bx(0.32, 1.75, 0.95, xc + sx, 0.875, zN + 0.48);
  bx(2.9, 0.38, 1.05, xc, 1.94, zN + 0.52); bx(2.3, 1.25, 0.7, xc, 2.75, zN + 0.36);
  bx(1.95, 1.7, 0.05, xc, 0.85, zN + 0.06, new THREE.MeshStandardMaterial({ color: 0x15100c, roughness: 1 }));
  bx(0.9, 0.12, 0.5, xc, 0.1, zN + 0.5, new THREE.MeshStandardMaterial({ color: 0x2a211a, roughness: 1 }));
  for (const [x, w] of [[xc - 3.6, 2.6], [xc + 3.9, 2.4]]) { bx(w, 0.06, 0.38, x, 0.46, zN + 0.3, M.bois); bx(w, 0.5, 0.05, x, 0.78, zN + 0.1, M.bois); for (const dx of [-w / 2 + 0.1, w / 2 - 0.1]) bx(0.06, 0.46, 0.34, x + dx, 0.23, zN + 0.3, M.bois); }
  for (const x of [-(s1 - s0) / 4, (s1 - s0) / 4]) { const l = new THREE.PointLight(0xffd9a0, 22, 11, 1.5); l.position.set(x, hn + fl - 0.5, 0); gm.add(l); }
  // collisions : couloir de la porte, salle, cheminée
  passages.push({ role: 'logis_rolin', poly: [P(sPorte - lp + 0.2, prof - 0.5), P(sPorte + lp - 0.2, prof - 0.5), P(sPorte + lp - 0.2, d0 + 0.5), P(sPorte - lp + 0.2, d0 + 0.5)] });
  passages.push({ role: 'logis_rolin', poly: [P(s0 + 0.35, d0 + 0.35), P(s1 - 0.35, d0 + 0.35), P(s1 - 0.35, D1 - 0.35), P(s0 + 0.35, D1 - 0.35)] });
  const sm = (s0 + s1) / 2 + xc; obstacles.push({ poly: [P(sm - 1.5, D1 - 1.1), P(sm + 1.5, D1 - 1.1), P(sm + 1.5, D1), P(sm - 1.5, D1)], village: false });
  Object.assign(SALLE, { centre: P((s0 + s1) / 2, d0 + W / 2), entree: P(sPorte, d0 + 1.2), long: s1 - s0, larg: W });
}
function construireGalerie(cible) {
  const { L, t, n, prof, ep, ouv, sol, zHaut } = GAL, pile = (L - 3 * ouv) / 4, P = GAL.pt;
  GAL.sArches = [0, 1, 2].map((k) => pile + ouv / 2 + k * (ouv + pile));
  // mur de façade percé de trois arches en plein cintre
  const forme = new THREE.Shape(), bas = sol - 1.5;
  const zTop = Math.max(zHaut + 0.5, GAL.egout());
  forme.moveTo(0, bas); forme.lineTo(L, bas); forme.lineTo(L, zTop); forme.lineTo(0, zTop); forme.lineTo(0, bas);
  for (const sc of GAL.sArches) {
    const tr = new THREE.Path(), r = ouv / 2, pied = sol + 1.5;
    tr.moveTo(sc - r, sol - 0.2); tr.lineTo(sc + r, sol - 0.2); tr.lineTo(sc + r, pied); tr.absellipse(sc, pied, r, 1.02, 0, Math.PI, false, 0); tr.lineTo(sc - r, sol - 0.2);
    forme.holes.push(tr);
  }
  const ge = new THREE.ExtrudeGeometry(forme, { depth: ep, bevelEnabled: false, curveSegments: 14 }); ge.translate(0, 0, -ep / 2);
  const o = P(0, ep / 2 - 0.03), ax = new THREE.Vector3(t[0], 0, -t[1]), ay = new THREE.Vector3(0, 1, 0), az = new THREE.Vector3().crossVectors(ax, ay);
  ge.applyMatrix4(new THREE.Matrix4().makeBasis(ax, ay, az).setPosition(o[0], 0, -o[1]));
  const mf = maille(ge, [matPhoto(phGal, L, 6.2, sol), M.logis]); G.commun.add(mf); occultants.push(mf);
  // fond, côtés, plafond, dallage
  const g = new Geo(), q = (p0, p1, z0, z1, nr) => g.quad(V(p0[0], p0[1], z0), V(p1[0], p1[1], z0), V(p1[0], p1[1], z1), V(p0[0], p0[1], z1), [0, z0], [Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), z0], [Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), z1], [0, z1], nr);
  const sPorte = GAL.sArches[0] - 0.2, lp = 0.62, hp = 2.15, nF = new THREE.Vector3(n[0], 0, -n[1]);
  q(P(0, prof), P(sPorte - lp, prof), sol - 0.4, zHaut, nF); q(P(sPorte + lp, prof), P(L, prof), sol - 0.4, zHaut, nF);
  q(P(sPorte - lp, prof), P(sPorte + lp, prof), sol + hp, zHaut, nF);
  construireSalle(sPorte, lp, hp);
  q(P(0.02, ep), P(0.02, prof), sol - 0.4, zHaut, new THREE.Vector3(t[0], 0, -t[1]));
  q(P(L - 0.02, ep), P(L - 0.02, prof), sol - 0.4, zHaut, new THREE.Vector3(-t[0], 0, t[1]));
  G.commun.add(maille(g.geometrie(), M.logis));
  const pl = new Geo(), c = [P(0, 0), P(L, 0), P(L, prof), P(0, prof)];
  pl.quad(V(c[0][0], c[0][1], zHaut - 0.04), V(c[1][0], c[1][1], zHaut - 0.04), V(c[2][0], c[2][1], zHaut - 0.04), V(c[3][0], c[3][1], zHaut - 0.04), [0, 0], [L, 0], [L, prof], [0, prof], new THREE.Vector3(0, -1, 0));
  G.commun.add(maille(pl.geometrie(), M.bois));
  for (let s = 0.5; s < L; s += 0.9) { const p = P(s, prof / 2 + 0.2), so = maille(new THREE.BoxGeometry(0.16, 0.2, prof - 0.5), M.bois, false); so.position.copy(V(p[0], p[1], zHaut - 0.16)); so.rotation.y = Math.atan2(t[1], t[0]); G.commun.add(so); }
  const dl = new Geo(), d0 = [P(0, -0.25), P(L, -0.25), P(L, prof), P(0, prof)], zMax = (() => { let m = -1e9; for (let u = 0; u <= L; u += 0.5) for (let d = -0.25; d <= prof; d += 0.5) { const p = P(u, d); m = Math.max(m, hauteurTerrain(p[0], p[1])); } return m + 0.05; })(), zd = [zMax, zMax, zMax, zMax];
  dl.quad(V(d0[0][0], d0[0][1], zd[0]), V(d0[1][0], d0[1][1], zd[1]), V(d0[2][0], d0[2][1], zd[2]), V(d0[3][0], d0[3][1], zd[3]), [0, 0], [L, 0], [L, prof], [0, prof], new THREE.Vector3(0, 1, 0));
  const md = maille(dl.geometrie(), new THREE.MeshStandardMaterial({ map: caA, normalMap: caN, color: 0xbdb4a2, roughness: 1 }), false); G.commun.add(md);
  // porte et baie du mur du fond
  const nOut = n, pp = P(GAL.sArches[0] - 0.2, prof), pf = P(GAL.sArches[1] + 0.9, prof);
  ouverture(cible, pf[0], pf[1], sol + 1.25, t, nOut, 0.6, 0, 'fenetre');
  // collisions : passage sous la galerie, piles
  passages.push({ role: 'logis_rolin', poly: [P(0.35, -0.8), P(L - 0.35, -0.8), P(L - 0.35, prof - 0.4), P(0.35, prof - 0.4)] });
  for (let k = 0; k < 4; k++) { const sc = pile / 2 + k * (ouv + pile), h = 0.34; obstacles.push({ poly: [P(sc - h, -0.05), P(sc + h, -0.05), P(sc + h, ep + 0.05), P(sc - h, ep + 0.05)], village: false }); }
}
// --- façades du logis Rolin côté haute-cour, d'après deux photos (vues vers le sud-est et vers le nord-est)
const PUITS = [0, 0];
{
  const cible = OUV.commun;
  const face = (a, b, liste) => {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), t = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    let n = [-t[1], t[0]]; const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if ((CENTRE_HC[0] - m[0]) * n[0] + (CENTRE_HC[1] - m[1]) * n[1] < 0) n = [-n[0], -n[1]];
    for (const [s, dz, w, type, hI] of liste) {
      const x = a[0] + t[0] * s, y = a[1] + t[1] * s;
      ouverture(cible, x, y, hauteurTerrain(x + n[0], y + n[1]) + dz, t, n, w, 0, type, hI);
    }
    return { t, n };
  };
  // aile à galerie (face sud) : trois arches en plein cintre, deux petites baies à l'étage
  const A = [15.0, 0.3], B = [6.1, 5.6];
  const g = face(B, A, []);
  construireGalerie(cible);
  face(B, [8.2, 8.9], [[2.0, 4.2, 0.8, 'fenetre']]);
  // façade en retrait : deux grands arcs surbaissés, trois croisées à meneaux à l'étage
  { // façade en retrait : photographie redressée, plaquée sur les deux pans du mur
    const pts = [A, [12.2, -5.7], [12.0, -7.8]], lr = data.batiments.find((q) => q.role === 'logis_rolin');
    const z0 = hauteurTerrain(A[0] - 1.5, A[1] - 1.5), geoF = new Geo(); let u = 0;
    for (let k = 0; k < 2; k++) {
      const a = pts[k], b = pts[k + 1], Ls = Math.hypot(b[0] - a[0], b[1] - a[1]), tt = [(b[0] - a[0]) / Ls, (b[1] - a[1]) / Ls];
      let nn = [-tt[1], tt[0]]; if ((CENTRE_HC[0] - a[0]) * nn[0] + (CENTRE_HC[1] - a[1]) * nn[1] < 0) nn = [-nn[0], -nn[1]];
      const eg = lr.contour.map((p, i) => distSeg(p[0], p[1], a, b) < 0.4 ? lr.egouts[i] : null).filter((v) => v != null).sort((x, y) => x - y);
      const zt = eg.length ? eg[Math.floor(eg.length / 2)] : z0 + 7.3, o = 0.04;
      geoF.quad(V(a[0] + nn[0] * o, a[1] + nn[1] * o, z0 - 0.3), V(b[0] + nn[0] * o, b[1] + nn[1] * o, z0 - 0.3), V(b[0] + nn[0] * o, b[1] + nn[1] * o, zt), V(a[0] + nn[0] * o, a[1] + nn[1] * o, zt), [u, z0 - 0.3], [u + Ls, z0 - 0.3], [u + Ls, zt], [u, zt], new THREE.Vector3(nn[0], 0, -nn[1]));
      u += Ls;
    }
    const mfac = maille(geoF.geometrie(), matPhoto(phFac, 8.73, 7.3, z0), false); G.commun.add(mfac);
  }
  // pignon sud, près de la porte de la haute-cour
  face([13.6, -12.0], [18.6, -17.4], [[4.2, 5.2, 0.8, 'fenetre'], [3.0, 1.4, 0.6, 'fenetre']]);
  // tourelle d'escalier : porte vers le sud-ouest, petits jours
  { const c = [13.6, -9.6], d = TOURELLE.d, t = [d[1], -d[0]], r = TOURELLE.apo + 0.02;
    const zs = hauteurTerrain(c[0] + d[0] * 3, c[1] + d[1] * 3);
    ouverture(cible, c[0] + d[0] * r, c[1] + d[1] * r, zs + 0.02, t, d, 1.0, 0, 'porte');
    const porte = maille(new THREE.BoxGeometry(0.82, 1.75, 0.06), new THREE.MeshStandardMaterial({ color: 0x7c2f24, roughness: 0.8 }), false);
    porte.position.copy(V(c[0] + d[0] * (r + 0.07), c[1] + d[1] * (r + 0.07), zs + 0.9)); porte.rotation.y = Math.atan2(t[1], t[0]); G.commun.add(porte);
    const d2 = [d[0] * 0.7071 + d[1] * 0.7071, -d[0] * 0.7071 + d[1] * 0.7071], t2 = [d2[1], -d2[0]];
    ouverture(cible, c[0] + d2[0] * r, c[1] + d2[1] * r, zs + 4.6, t2, d2, 0.5, 0, 'fenetre');
    ouverture(cible, c[0] + d[0] * r, c[1] + d[1] * r, zs + 6.6, t, d, 0.5, 0, 'fenetre'); }
  // le puits, sous l'arche est de la galerie : margelle, montants et treuil
  { const [x, y] = GAL.pt(GAL.sArches[2], 1.75), z = hauteurTerrain(x, y) + 0.05;
    PUITS[0] = x; PUITS[1] = y;
    const marg = new THREE.CylinderGeometry(0.85, 0.9, 0.85, 20, 1, true); marg.translate(0, 0.42, 0);
    { const uv = marg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 5.4, uv.getY(i) * 0.85); }
    const mat2 = new THREE.MeshStandardMaterial({ map: o2A || moA, color: 0xe8e0d0, roughness: 1, side: THREE.DoubleSide });
    const gp = new THREE.Group(); gp.position.copy(V(x, y, z)); gp.rotation.y = Math.atan2(g.t[1], g.t[0]); G.commun.add(gp);
    gp.add(maille(marg, mat2));
    const anneau = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.9, 20), mat2); anneau.rotation.x = -Math.PI / 2; anneau.position.y = 0.85; gp.add(anneau);
    const fond = new THREE.Mesh(new THREE.CircleGeometry(0.6, 16), new THREE.MeshBasicMaterial({ color: 0x050505 })); fond.rotation.x = -Math.PI / 2; fond.position.y = 0.3; gp.add(fond);
    // bâti du treuil d'après la photo : grande poutre scellée dans les piédroits, jambes de force, tambour
    const pt = maille(new THREE.BoxGeometry(GAL.ouv + 0.5, 0.2, 0.22), M.bois); pt.position.set(0, 2.0, 1.45); gp.add(pt);
    for (const sx of [-0.8, 0.8]) { const j = maille(new THREE.BoxGeometry(0.1, 0.75, 0.1), M.bois); j.position.set(sx, 1.72, 1.45); j.rotation.z = sx > 0 ? 0.75 : -0.75; gp.add(j); }
    const tr = maille(new THREE.CylinderGeometry(0.13, 0.13, 1.7, 10), M.bois); tr.rotation.z = Math.PI / 2; tr.position.set(0, 1.55, 0.7); gp.add(tr);
    const ch = maille(new THREE.BoxGeometry(0.03, 0.9, 0.03), new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: 0.6 })); ch.position.set(0, 1.1, 0.7); gp.add(ch);
    obstacles.push({ poly: [[x - 0.9, y - 0.9], [x + 0.9, y - 0.9], [x + 0.9, y + 0.9], [x - 0.9, y + 0.9]], village: false }); }
  // restes de hourds sur la tour maîtresse : poutres et poteaux de bois sur les faces
  const tm = data.batiments.find((b) => b.role === 'tour_maitresse');
  if (tm) { const R = tm.rect, cx = R.reduce((q, p) => q + p[0], 0) / 4, cy = R.reduce((q, p) => q + p[1], 0) / 4;
    for (let k = 0; k < 4; k++) {
      const a = R[k], b = R[(k + 1) % 4], L = Math.hypot(b[0] - a[0], b[1] - a[1]), t = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
      let n = [-t[1], t[0]]; if ((a[0] - cx) * n[0] + (a[1] - cy) * n[1] < 0) n = [-n[0], -n[1]];
      const ry = Math.atan2(t[1], t[0]);
      for (const [zb, de, a_] of [[12.6, 0.52, 1.0], [17.6, 0.5, 0.95], [20.9, 0.05, 0.9]]) {
        const pou = maille(new THREE.BoxGeometry(L * a_ * 0.92, 0.16, 0.16), M.bois); pou.position.copy(V(a[0] + t[0] * L / 2 + n[0] * 0.14, a[1] + t[1] * L / 2 + n[1] * 0.14, zb)); pou.rotation.y = ry; G.actuel.add(pou);
        for (let s = L * de + 0.3; s < L - 0.4; s += 0.55) {
          const po = maille(new THREE.BoxGeometry(0.11, 2.5, 0.09), M.bois, false); po.position.copy(V(a[0] + t[0] * s + n[0] * 0.1, a[1] + t[1] * s + n[1] * 0.1, zb + 1.3)); po.rotation.y = ry; G.actuel.add(po);
        }
      }
    } }
}

// ------------------------------------------------------------------ courtines et murs (rubans épais suivant le profil LiDAR)
const segmentsMurs = [];   // pour les collisions : {a, b, demi, porte:[s0,s1] | null, sA}
const COURTINES_HC = new Set(['courtine_ouest', 'courtine_nord_ouest', 'courtine_sud', 'courtine_est_porte']);
const PORTE = { mur: 'mur_7', s: 8.0, largeur: 4.4, ouverture: 2.8, piedroit: 2.6 };

function echantillons(w) {
  const pts = w.pts.map((p) => ({ x: p[0], y: p[1], base: p[2], top: p[3] }));
  let s = 0; pts.forEach((p, k) => { if (k) s += Math.hypot(p.x - pts[k - 1].x, p.y - pts[k - 1].y); p.s = s; });
  return pts;
}
function auPoint(pts, s) {
  for (let k = 1; k < pts.length; k++) if (pts[k].s >= s) {
    const a = pts[k - 1], b = pts[k], t = (s - a.s) / Math.max(1e-6, b.s - a.s);
    return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), base: lerp(a.base, b.base, t), top: lerp(a.top, b.top, t), s };
  }
  return { ...pts[pts.length - 1] };
}
function tranche(pts, s0, s1) {
  const out = [auPoint(pts, s0)];
  pts.forEach((p) => { if (p.s > s0 + 0.05 && p.s < s1 - 0.05) out.push(p); });
  out.push(auPoint(pts, s1));
  return out;
}
function ruban(pts, epaisseur, hautFn, geo, rallonge = 0.5) {
  if (pts.length < 2) return;
  const n = pts.length, demi = epaisseur / 2;
  const P = pts.map((p) => ({ ...p }));
  // rallonge des extrémités pour bien s'ancrer dans les tours et bâtiments
  const d0x = P[1].x - P[0].x, d0y = P[1].y - P[0].y, l0 = Math.hypot(d0x, d0y) || 1;
  P[0] = { ...P[0], x: P[0].x - d0x / l0 * rallonge, y: P[0].y - d0y / l0 * rallonge };
  const d1x = P[n - 1].x - P[n - 2].x, d1y = P[n - 1].y - P[n - 2].y, l1 = Math.hypot(d1x, d1y) || 1;
  P[n - 1] = { ...P[n - 1], x: P[n - 1].x + d1x / l1 * rallonge, y: P[n - 1].y + d1y / l1 * rallonge };
  const nl = P.map((p, k) => {
    const a = P[Math.max(0, k - 1)], c = P[Math.min(n - 1, k + 1)];
    const dx = c.x - a.x, dy = c.y - a.y, L = Math.hypot(dx, dy) || 1;
    return [-dy / L, dx / L];
  });
  const base = Math.min(...P.map((p) => p.base)) - 1.5;
  const L = (k) => [P[k].x + nl[k][0] * demi, P[k].y + nl[k][1] * demi];
  const R = (k) => [P[k].x - nl[k][0] * demi, P[k].y - nl[k][1] * demi];
  let s = 0;
  for (let k = 0; k < n - 1; k++) {
    const ds = Math.hypot(P[k + 1].x - P[k].x, P[k + 1].y - P[k].y);
    const t0 = hautFn(P[k]), t1 = hautFn(P[k + 1]);
    const [lx0, ly0] = L(k), [lx1, ly1] = L(k + 1), [rx0, ry0] = R(k), [rx1, ry1] = R(k + 1);
    const nG = new THREE.Vector3(nl[k][0], 0, -nl[k][1]), nD = nG.clone().negate();
    geo.quad(V(lx0, ly0, base), V(lx1, ly1, base), V(lx1, ly1, t1), V(lx0, ly0, t0), [s, base], [s + ds, base], [s + ds, t1], [s, t0], nG);
    geo.quad(V(rx0, ry0, base), V(rx1, ry1, base), V(rx1, ry1, t1), V(rx0, ry0, t0), [s, base], [s + ds, base], [s + ds, t1], [s, t0], nD);
    geo.quad(V(lx0, ly0, t0), V(rx0, ry0, t0), V(rx1, ry1, t1), V(lx1, ly1, t1), [s, 0], [s, epaisseur], [s + ds, epaisseur], [s + ds, 0], new THREE.Vector3(0, 1, 0));
    s += ds;
  }
  for (const k of [0, n - 1]) {
    const [lx, ly] = L(k), [rx, ry] = R(k), t = hautFn(P[k]);
    const dir = k === 0 ? -1 : 1, kk = k === 0 ? 1 : n - 2;
    const nb = new THREE.Vector3((P[k].x - P[kk].x) * dir * dir, 0, -(P[k].y - P[kk].y));
    geo.quad(V(lx, ly, base), V(rx, ry, base), V(rx, ry, t), V(lx, ly, t), [0, base], [epaisseur, base], [epaisseur, t], [0, t], nb);
  }
}
function arcPorte(pA, pB, epaisseur, sol, haut0, haut1, mat, groupe) {
  // bloc de courtine percé d'un passage voûté en plein cintre
  const dx = pB.x - pA.x, dy = pB.y - pA.y, L = Math.hypot(dx, dy);
  const forme = new THREE.Shape();
  const bas = sol - 1.5;
  forme.moveTo(0, bas); forme.lineTo(L, bas); forme.lineTo(L, haut1); forme.lineTo(0, haut0); forme.lineTo(0, bas);
  const o = PORTE.ouverture, r = o / 2, x0 = (L - o) / 2, pied = sol + PORTE.piedroit;
  const trou = new THREE.Path();
  trou.moveTo(x0, sol - 0.05); trou.lineTo(x0 + o, sol - 0.05); trou.lineTo(x0 + o, pied);
  trou.absarc(x0 + r, pied, r, 0, Math.PI, false);
  trou.lineTo(x0, sol - 0.05);
  forme.holes.push(trou);
  const g = new THREE.ExtrudeGeometry(forme, { depth: epaisseur, bevelEnabled: false, curveSegments: 14 });
  g.translate(0, 0, -epaisseur / 2);
  const ax = new THREE.Vector3(dx / L, 0, -dy / L), ay = new THREE.Vector3(0, 1, 0), az = new THREE.Vector3().crossVectors(ax, ay);
  const m4 = new THREE.Matrix4().makeBasis(ax, ay, az).setPosition(pA.x, 0, -pA.y);
  g.applyMatrix4(m4);
  const mesh = maille(g, mat); groupe.add(mesh);
  return mesh;
}

const merlonsActuel = [];   // (aucun aujourd'hui)
const merlonsMed = [];
function construireMurs(mode) {
  const geo = new Geo();
  const groupe = mode === 'medieval' ? G.medieval : G.actuel;
  for (const w of data.murs) {
    const pts = echantillons(w);
    const hc = COURTINES_HC.has(w.role);
    const hautFn = mode === 'medieval' && hc ? (p) => Math.max(p.top, 10.6) : (p) => p.top;
    const total = pts[pts.length - 1].s;
    let parts = [[0, total]];
    if (w.id === PORTE.mur) {
      const s0 = PORTE.s - PORTE.largeur / 2, s1 = PORTE.s + PORTE.largeur / 2;
      parts = [[0, s0], [s1, total]];
      const pA = auPoint(pts, s0), pB = auPoint(pts, s1), pc = auPoint(pts, PORTE.s);
      const sol = hauteurSol(pc.x, pc.y);
      arcPorte(pA, pB, w.epaisseur, sol, hautFn(pA), hautFn(pB), M.courtine, groupe);
      if (mode === 'actuel') {
        const ux = (pB.x - pA.x) / PORTE.largeur, uy = (pB.y - pA.y) / PORTE.largeur;
        PORTE.centre = [pc.x, pc.y]; PORTE.dir = [ux, uy]; PORTE.sol = sol;
      }
    }
    for (const [s0, s1] of parts) {
      const sub = tranche(pts, s0, s1);
      ruban(sub, w.epaisseur, hautFn, geo, w.id === PORTE.mur && s0 > 0 ? 0.0 : 0.5);
      if (mode === 'actuel') {
        for (let k = 0; k < sub.length - 1; k++) segmentsMurs.push({ a: [sub[k].x, sub[k].y], b: [sub[k + 1].x, sub[k + 1].y], demi: w.epaisseur / 2 });
      }
      if (mode === 'medieval' && hc) {
        // merlons côté extérieur, tous les 2,4 m
        for (let s = s0 + 0.8; s < s1 - 0.6; s += 2.4) {
          const p = auPoint(pts, s), q = auPoint(pts, Math.min(total, s + 0.3));
          const dx = q.x - p.x, dy = q.y - p.y, Ld = Math.hypot(dx, dy) || 1;
          let nx = -dy / Ld, ny = dx / Ld;
          if ((p.x - CENTRE_HC[0]) * nx + (p.y - CENTRE_HC[1]) * ny < 0) { nx = -nx; ny = -ny; }
          const off = w.epaisseur / 2 - 0.32;
          merlonsMed.push({ x: p.x + nx * off, y: p.y + ny * off, z: hautFn(p) + 0.8, ang: Math.atan2(dy, dx) });
        }
      }
    }
  }
  const mm = maille(geo.geometrie(), M.courtine); groupe.add(mm); occultants.push(mm);
}
construireMurs('actuel');
construireMurs('medieval');

// tourelle d'escalier du logis Rolin (cône relevé au LiDAR vers +14 à +15 m)
{
  const [x, y] = [13.6, -9.6], z0 = hauteurSol(x, y) - 1, zE = 10.6, RT = TOURELLE.r, rot = Math.atan2(TOURELLE.d[0], -TOURELLE.d[1]) - Math.PI / 8;
  let fut = new THREE.CylinderGeometry(RT, RT, zE - z0, 8, 1, true); fut.translate(0, (zE + z0) / 2, 0);
  const uv = fut.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2 * Math.PI * RT, uv.getY(i) * (zE - z0));
  fut = fut.toNonIndexed(); fut.rotateY(rot); fut.computeVertexNormals();
  const mf = maille(fut, M.logis); mf.position.set(x, 0, -y); G.commun.add(mf);
  let cone = new THREE.ConeGeometry(RT + 0.4, 4.9, 8, 1, true); cone.translate(0, zE + 2.45, 0);
  const uc = cone.attributes.uv; for (let i = 0; i < uc.count; i++) uc.setXY(i, uc.getX(i) * 2 * Math.PI * (RT + 0.4), uc.getY(i) * 5.4);
  cone = cone.toNonIndexed(); cone.rotateY(rot); cone.computeVertexNormals();
  const mc = maille(cone, M.tuiles); mc.position.set(x, 0, -y); G.commun.add(mc);
}

// petits piliers isolés relevés dans la haute-cour (ruines de la « grande salle » ?)
for (const [x, y, h] of [[-0.5, 10.5, 3.4], [2.5, 8.5, 2.8], [6.0, 6.8, 2.2]]) {
  const z0 = hauteurSol(x, y);
  const g = new THREE.BoxGeometry(0.7, h + 0.6, 0.7);
  const m = maille(g, M.courtine); m.position.copy(V(x, y, z0 + (h - 0.6) / 2)); G.commun.add(m);
  obstacles.push({ poly: [[x - 0.4, y - 0.4], [x + 0.4, y - 0.4], [x + 0.4, y + 0.4], [x - 0.4, y + 0.4]], village: false });
}

// ------------------------------------------------------------------ esquisse médiévale : tours restituées, merlons
function rectExpanse(rect, d) {
  const cx = rect.reduce((s, p) => s + p[0], 0) / 4, cy = rect.reduce((s, p) => s + p[1], 0) / 4;
  return rect.map(([x, y]) => {
    const vx = x - cx, vy = y - cy, L = Math.hypot(vx, vy);
    return [x + vx / L * d * Math.SQRT2, y + vy / L * d * Math.SQRT2];
  });
}
function prismeRect(rect, z0, z1, mat, groupe) {
  const g = new Geo(); let s = 0;
  const ccw = (() => { let a = 0; for (let k = 0; k < 4; k++) { const p = rect[k], q = rect[(k + 1) % 4]; a += p[0] * q[1] - q[0] * p[1]; } return a > 0; })();
  const R = ccw ? rect : [...rect].reverse();
  for (let k = 0; k < 4; k++) {
    const a = R[k], c = R[(k + 1) % 4], L = Math.hypot(c[0] - a[0], c[1] - a[1]);
    g.quad(V(a[0], a[1], z0), V(c[0], c[1], z0), V(c[0], c[1], z1), V(a[0], a[1], z1), [s, z0], [s + L, z0], [s + L, z1], [s, z1], new THREE.Vector3(c[1] - a[1], 0, c[0] - a[0]));
    s += L;
  }
  g.quad(V(R[0][0], R[0][1], z1), V(R[1][0], R[1][1], z1), V(R[2][0], R[2][1], z1), V(R[3][0], R[3][1], z1), R[0], R[1], R[2], R[3], new THREE.Vector3(0, 1, 0));
  g.quad(V(R[0][0], R[0][1], z0), V(R[1][0], R[1][1], z0), V(R[2][0], R[2][1], z0), V(R[3][0], R[3][1], z0), R[0], R[1], R[2], R[3], new THREE.Vector3(0, -1, 0));
  const m = maille(g.geometrie(), mat); groupe.add(m); return m;
}
function pyramide(rect, z0, h, mat, groupe) {
  const cx = rect.reduce((s, p) => s + p[0], 0) / 4, cy = rect.reduce((s, p) => s + p[1], 0) / 4;
  const pos = [], uv = [];
  for (let k = 0; k < 4; k++) {
    const a = rect[k], c = rect[(k + 1) % 4];
    const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
    const mx = (a[0] + c[0]) / 2, my = (a[1] + c[1]) / 2, pente = Math.hypot(Math.hypot(cx - mx, cy - my), h);
    pos.push(a[0], z0, -a[1], c[0], z0, -c[1], cx, z0 + h, -cy);
    uv.push(0, 0, L, 0, L / 2, pente);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  const m = maille(g, mat); groupe.add(m); return m;
}
const tours = Object.fromEntries(data.batiments.filter((b) => ROLES_TOUR.has(b.role)).map((b) => [b.role, b]));
for (const [role, H] of [['tour_maitresse', 23.6], ['tour_ouest', 24.4]]) {
  const b = tours[role]; if (!b) continue;
  prismeRect(b.rect, b.sol - 1.5, H, M.tour, G.medieval);
  // hourds (galerie de bois en surplomb) et toit en pavillon
  prismeRect(rectExpanse(b.rect, 0.85), H - 0.2, H + 2.5, M.bois, G.medieval);
  pyramide(rectExpanse(b.rect, 1.25), H + 2.5, 6.4, M.tuiles, G.medieval);
  obstacles.push({ poly: b.rect, village: false, role, medievalSeulement: true });
}
if (tours.tourelle_sud_ouest) {
  const b = tours.tourelle_sud_ouest, H = 14.8;
  prismeRect(b.rect, b.sol - 1.5, H, M.tour, G.medieval);
  const R = b.rect;
  for (let k = 0; k < 4; k++) {
    const a = R[k], c = R[(k + 1) % 4];
    for (let t = 0.12; t < 0.95; t += 0.29) {
      merlonsMed.push({ x: lerp(a[0], c[0], t), y: lerp(a[1], c[1], t), z: H + 0.8, ang: Math.atan2(c[1] - a[1], c[0] - a[0]) });
    }
  }
}
{
  const g = new THREE.BoxGeometry(1.35, 1.6, 0.62);
  const im = new THREE.InstancedMesh(g, M.courtine, merlonsMed.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc1 = new THREE.Vector3(1, 1, 1);
  merlonsMed.forEach((m, k) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), m.ang);
    m4.compose(V(m.x, m.y, m.z), q, sc1); im.setMatrixAt(k, m4);
  });
  im.castShadow = true; im.receiveShadow = true;
  G.medieval.add(im);
}

// ------------------------------------------------------------------ arbres (maxima locaux du MNH)
function aleaGraine(g) { return () => { g |= 0; g = g + 0x6D2B79F5 | 0; let t = Math.imul(g ^ g >>> 15, 1 | g); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const CELL_FEUILLES = [[0.0312, 0.5312, 0.4688, 0.9688], [0.5312, 0.5312, 0.9688, 0.9688], [0.0312, 0.0312, 0.4688, 0.4688], [0.5312, 0.0312, 0.9688, 0.4688]];
const CELL_HERBES = [[0.0312, 0.7256, 0.4688, 0.9419], [0.5312, 0.7256, 0.9688, 0.9419], [0.0737, 0.3647, 0.4263, 0.6357], [0.5737, 0.3647, 0.9263, 0.6357], [0.0659, 0.0312, 0.4336, 0.3022], [0.5659, 0.0312, 0.9336, 0.3022]];
class Cartes {      // nappes de quads texturés (feuillages, herbes, lierre) fusionnées en un seul maillage
  constructor() { this.p = []; this.u = []; this.n = []; this.c = []; this.i = []; }
  quad(centre, ax, ay, cell, normale, teinte, nBas) {
    const k = this.p.length / 3, [u0, v0, u1, v1] = cell;
    const coins = [[-1, -1, u0, v0], [1, -1, u1, v0], [1, 1, u1, v1], [-1, 1, u0, v1]];
    for (const [sx, sy, uu, vv] of coins) {
      this.p.push(centre.x + ax.x * sx + ay.x * sy, centre.y + ax.y * sx + ay.y * sy, centre.z + ax.z * sx + ay.z * sy);
      this.u.push(uu, vv); const nn = nBas && sy < 0 ? nBas : normale; this.n.push(nn.x, nn.y, nn.z); this.c.push(teinte[0], teinte[1], teinte[2]);
    }
    this.i.push(k, k + 1, k + 2, k, k + 2, k + 3);
  }
  maillage(mat) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.i); return new THREE.Mesh(g, mat);
  }
}
const matFeuilles = new THREE.MeshStandardMaterial({ map: feA, alphaTest: 0.6, side: THREE.DoubleSide, vertexColors: true, roughness: 0.9, envMapIntensity: 0.25, color: 0x8fa56a });
const matHerbes = new THREE.MeshStandardMaterial({ map: hbA, alphaTest: 0.35, side: THREE.DoubleSide, vertexColors: true, roughness: 1, envMapIntensity: 0.3 });
const matLierre = new THREE.MeshStandardMaterial({ map: liA, alphaTest: 0.4, side: THREE.DoubleSide, vertexColors: true, roughness: 0.9, envMapIntensity: 0.4 });
const matOuv = new THREE.MeshStandardMaterial({ map: o6A, alphaTest: 0.5, roughness: 0.95, vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
for (const k of ['commun', 'actuel']) {
  const cartes = new Cartes(); OUV[k].forEach((o) => cartes.quad(o.c, o.ax, o.ay, o.cell, o.n, [1, 1, 1]));
  if (OUV[k].length) { const m = cartes.maillage(matOuv); m.receiveShadow = true; G[k].add(m); }
}
function construireArbres() {
  const R = aleaGraine(1170);
  const tronc = new THREE.CylinderGeometry(0.13, 0.3, 1, 7); tronc.translate(0, 0.5, 0);
  const coeur = new THREE.IcosahedronGeometry(1, 1);
  const matT = new THREE.MeshStandardMaterial({ map: plA, color: 0x6b5a48, roughness: 1 });
  const matC = new THREE.MeshStandardMaterial({ color: 0x25381a, roughness: 1 });
  const lots = { proche: [], loin: [] };
  for (const a of data.arbres) (Math.hypot(a[0] - 2, a[1] + 8) < 75 ? lots.proche : lots.loin).push(a);
  const groupes = { proche: G.actuel, loin: G.commun };
  const up = new THREE.Vector3(0, 1, 0), d = new THREE.Vector3(), ax = new THREE.Vector3(), ay = new THREE.Vector3(), nrm = new THREE.Vector3();
  for (const lot of ['proche', 'loin']) {
    const arbres = lots[lot]; if (!arbres.length) continue;
    const it = new THREE.InstancedMesh(tronc, matT, arbres.length), ic = new THREE.InstancedMesh(coeur, matC, arbres.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), cartes = new Cartes();
    arbres.forEach(([x, y, z, h], k) => {
      const r = clamp(0.3 * h + 0.6, 1.3, 6.2), rv = r * (0.8 + 0.3 * R()), ht = Math.max(0.8, h - rv * 1.7);
      const centre = V(x, y, z + h - rv * 0.95);
      m4.compose(V(x, y, z - 0.3), q.identity(), new THREE.Vector3(1 + h / 16, ht + rv * 0.9, 1 + h / 16)); it.setMatrixAt(k, m4);
      m4.compose(centre, q.identity(), new THREE.Vector3(r * 0.62, rv * 0.68, r * 0.62)); ic.setMatrixAt(k, m4);
      const essence = R() < 0.5 ? [0, 0] : (R() < 0.6 ? [1, 3] : [2, 3]);     // chêne, ou hêtre/charme
      const vert = [0.62 + 0.3 * R(), 0.80 + 0.2 * R(), 0.50 + 0.25 * R()];
      const nb = Math.round(clamp((lot === 'proche' ? 3.6 : 1.6) * r * r * 0.9 + 9, 12, lot === 'proche' ? 64 : 22));
      const taille = clamp(r * (lot === 'proche' ? 0.5 : 0.8), 1.0, 3.4);
      for (let i = 0; i < nb; i++) {
        const th = R() * 6.283, cz = R() * 1.7 - 0.7, sr = Math.sqrt(Math.max(0, 1 - Math.min(1, cz * cz))), f = 0.72 + 0.3 * R();
        d.set(Math.cos(th) * sr, cz > 1 ? 1 : cz, Math.sin(th) * sr).normalize();
        const p = centre.clone().add(new THREE.Vector3(d.x * r * f, d.y * rv * f, d.z * r * f));
        ax.set(R() - 0.5, (R() - 0.5) * 0.7, R() - 0.5).normalize(); ay.crossVectors(d, ax).lerp(new THREE.Vector3(R() - 0.5, R() - 0.5, R() - 0.5), 0.5).normalize();
        ax.crossVectors(ay, d).lerp(ax, 0.4).normalize();
        const s = taille * (0.75 + 0.5 * R()), om = 0.45 + 0.55 * clamp((d.y + 1) / 1.6, 0, 1) * f;
        nrm.copy(d).lerp(up, 0.35).normalize();
        cartes.quad(p, ax.clone().multiplyScalar(s), ay.clone().multiplyScalar(s), CELL_FEUILLES[essence[R() < 0.5 ? 0 : 1]], nrm.clone(), [vert[0] * om, vert[1] * om, vert[2] * om]);
      }
    });
    it.castShadow = ic.castShadow = true; ic.receiveShadow = true;
    const mf = cartes.maillage(matFeuilles); mf.castShadow = false; mf.receiveShadow = true;
    groupes[lot].add(it, ic, mf);
  }
}
construireArbres();

// herbes hautes et fleurs (fossés, talus, pieds de murs), lierre sur les maçonneries
function construireHerbes() {
  const R = aleaGraine(1435), cartes = new Cartes(), up = new THREE.Vector3(0, 1, 0);
  const cour = [[-24, 21], [-25, 8], [-23, -12], [-18, -20], [3, -30], [12, -26], [16, -20], [12, -7], [8, 8], [-2, 15]];
  let pose = 0;
  for (let k = 0; k < 60000 && pose < 6000; k++) {
    const a = R() * 6.283, rr = Math.sqrt(R()) * 95, x = 2 + Math.cos(a) * rr, y = -8 + Math.sin(a) * rr;
    if (Math.abs(x) > HALF - 2 || Math.abs(y) > HALF - 2) continue;
    const i = Math.round(x + HALF), j = Math.round(HALF - y);
    if (terre8[j * N + i] > 60) continue;
    const dansCour = dedansPoly(x, y, cour);
    if (dansCour && R() < 0.93) continue;
    if (!dansCour && rr > 55 && R() < 0.5) continue;
    let dedans = false; for (const o of obstacles) if (o.poly && dedansPoly(x, y, o.poly)) { dedans = true; break; }
    if (dedans || planchers.some((p) => Math.hypot(x - p.c[0], y - p.c[1]) < p.r)) continue;
    const z = hauteurTerrain(x, y), t = R(), cell = CELL_HERBES[t < 0.3 ? 0 : t < 0.55 ? 1 : t < 0.72 ? 2 : t < 0.86 ? 3 : t < 0.93 ? 4 : 5];
    const hh = (dansCour ? 0.3 : 0.45) + R() * 0.5, asp = (cell[2] - cell[0]) / (cell[3] - cell[1]) , th = R() * 3.14;
    const v = 0.8 + 0.3 * R(), teinte = [v * 0.95, v, v * 0.8];
    for (const dth of [0, 1.57]) {
      const ax = new THREE.Vector3(Math.cos(th + dth), 0, Math.sin(th + dth)).multiplyScalar(hh * asp / 2 * 1.3);
      cartes.quad(V(x, y, z + hh / 2 * 1.3 - 0.06), ax, new THREE.Vector3(0, hh / 2 * 1.3, 0), cell, up, teinte);
    }
    pose++;
  }
  const m = cartes.maillage(matHerbes); m.receiveShadow = true; G.commun.add(m);
}
construireHerbes();
function construireLierre() {
  const R = aleaGraine(1984), cartes = new Cartes();
  for (const w of data.murs) {
    const pts = echantillons(w), total = pts[pts.length - 1].s;
    for (let s = 2.5; s < total - 2.5; s += 3.5 + R() * 5) {
      if (R() < 0.35) continue;
      const p = auPoint(pts, s), q2 = auPoint(pts, s + 0.4), dx = q2.x - p.x, dy = q2.y - p.y, L = Math.hypot(dx, dy) || 1;
      const cote = R() < 0.6 ? 1 : -1, nx = -dy / L * cote, ny = dx / L * cote, o = w.epaisseur / 2 + 0.06;
      const x = p.x + nx * o, y = p.y + ny * o, zs = hauteurTerrain(p.x + nx * (o + 0.6), p.y + ny * (o + 0.6));
      const hM = p.top - zs; if (hM < 2.2) continue;
      const hh = Math.min(hM * (0.45 + 0.5 * R()), 7.5), v = 0.75 + 0.3 * R(), miroir = R() < 0.5 ? -1 : 1;
      cartes.quad(V(x, y, zs + hh / 2 - 0.15), V(dx / L, dy / L, 0).multiplyScalar(hh / 2 * miroir).sub(V(0, 0, 0)), new THREE.Vector3(0, hh / 2, 0), [0, 0, 1, 1], new THREE.Vector3(nx, 0.3, -ny).normalize(), [v * 0.9, v, v * 0.85]);
    }
  }
  const m = cartes.maillage(matLierre); m.receiveShadow = true; G.actuel.add(m);
}
construireLierre();

// ------------------------------------------------------------------ lieux (textes tirés des fascicules Oricourt)
const LIEUX = [
  { titre: 'La tour maîtresse', p: [10, -31], h: 28.5, pied: [1, -17, -57],
    texte: ["Haute d'environ 25 m, elle est bâtie à la jonction des deux enceintes : elle surveille les deux cours, les fossés et le domaine. On la dit parfois « donjon », mot à manier avec prudence.",
      "Son entrée était perchée à 8 m du sol et l'on y montait par une échelle amovible. À ce niveau, la salle ne mesure qu'environ 3,50 m de côté, entre des murs d'environ 2,20 m d'épaisseur : une boîte de pierre faite pour tenir, voir, attendre."],
    releve: "Relevé : sommet à +25,9 m au-dessus de la haute-cour (couverture métallique moderne). Emprise ≈ 8,5 × 9,7 m.", source: 'Fascicule 2' },
  { titre: 'La porte de la haute-cour', p: null, h: 6.5, pied: [6, -14, -31],
    texte: ["Un passage dans la courtine relie la basse-cour à la haute-cour. Il était protégé par un pont-levis : même si l'ennemi prend la basse-cour, il doit encore franchir ce seuil. C'est la défense en profondeur : faire payer chaque mètre."],
    releve: "Emplacement de l'arc estimé d'après les photographies : à vérifier pendant la visite.", source: 'Fascicule 2', hypo: true },
  { titre: 'Le logis Rolin et la grande cuisine', p: [20, -4], h: 19.5, pied: [-12, -14, 14],
    texte: ["En 1435, Oricourt est acquis par Nicolas Rolin, chancelier de Bourgogne et fondateur des Hospices de Beaune. Son fils Guillaume en prend possession en 1462 : c'est probablement lui qui fait bâtir ce logis, dont une fenêtre porte un masque de Nicolas Rolin.",
      "La « grande cuisine » et le « logis Rolin » montrent comment un château fort, affaibli par l'arrivée des bouches à feu, devient une résidence : façade gothique, fenêtres à meneaux, tourelle d'escalier."],
    releve: 'Relevé : faîtage à +18 m ; emprise ≈ 456 m².', source: "Fascicules 1 et 3 ; Les Amis d'Oricourt, bulletin 5 ; programme de visite" },
  { titre: 'Le logis nord', p: [-6, 21], h: 14.5, pied: [-8, 0, 84],
    texte: ["Au bord du plateau, le logis nord, dit « tour des latrines », a été restauré (murs, toiture, planchers). En dégageant son sous-sol, on a trouvé des carreaux de poêle dont les pieds ont la forme de tours de château."],
    releve: 'Relevé : faîtage à +13,1 m ; la façade nord descend dans la pente.', source: "Les Amis d'Oricourt, bulletin 25" },
  { titre: 'Bâtiment en ruine et ses piliers (grande salle ?)', p: [2, 10], h: 8, pied: [-2, -2, 71],
    texte: ["Entre le logis nord et la grande cuisine, des murs sans toit et trois piliers isolés. Les sources signalent une grande salle dans la haute-cour : est-ce elle ?"],
    releve: 'Relevé : murs de +5 à +7 m, piliers de 2 à 3,5 m. Identification à confirmer pendant la visite.', source: 'Fascicule 2', hypo: true },
  { titre: 'Le puits, sous la galerie', p: PUITS, h: 6.5, pied: [8.2, -4.2, 42],
    texte: ["Le puits se trouve sous la galerie du logis, à l'abri : margelle de pierre et treuil de bois. Profond d'environ 22 m, il fonctionnait « à monte et descend ».",
      "Avec la citerne, le four, les caves et la boulangerie, il permettait à la haute-cour de tenir un siège même si la basse-cour tombait. Sans eau, pas de siège prolongé."],
    releve: "Placé d'après les photographies, sous l'arche est de la galerie. Profondeur de la galerie estimée à 3,4 m (margelle prise comme échelle) : à mesurer pendant la visite.", source: 'Fascicule 2 ; programme de visite ; photographies' },
  { titre: 'La salle voûtée et sa cheminée', p: SALLE.centre, h: 9.5, pied: [SALLE.entree[0], SALLE.entree[1], Math.atan2(GAL.t[1], GAL.t[0]) / DEG],
    texte: ["Derrière la galerie, une porte donne sur une longue salle couverte d'une voûte de pierre en berceau. Une grande cheminée à hotte occupe un mur : on y cuisinait et on s'y chauffait.",
      "La voûte protège du feu et porte l'étage. Entre par la porte du fond de la galerie, à côté du puits."],
    releve: "Restituée d'après une photographie : dimensions et place de la cheminée estimées, à mesurer pendant la visite.", source: 'Photographie ; programme de visite', hypo: true },
  { titre: 'La tour ouest', p: [-27, 5.5], h: 28.5, pied: [-10, -2, 156],
    texte: ["Seconde grande tour carrée, aujourd'hui ruinée au sommet. Les tours flanquent les courtines : on tire le long du mur pour empêcher l'ennemi d'en approcher le pied.",
      "Les tours carrées sont typiques des premiers châteaux de pierre : plus simples à bâtir que les tours rondes, mais leurs angles résistent moins bien aux projectiles et à la sape."],
    releve: 'Relevé : sommet ruiné, jusqu\'à +26,8 m côté cour, plus bas côté fossé.', source: 'Fascicule 2' },
  { titre: "La tourelle de l'angle sud-ouest", p: [-19.8, -22.6], h: 17.5, pied: [-8, -10, -133],
    texte: ["Une petite tour carrée d'environ 4,8 m de côté ferme l'angle sud-ouest de l'enceinte, entre deux courtines."],
    releve: 'Relevé : environ +15 m, végétation comprise. À identifier pendant la visite.', source: 'Relevé LiDAR', hypo: true },
  { titre: 'Les courtines', p: [-25.4, -9], h: 13, pied: [-14, -8, 180],
    texte: ["Les courtines sont les murs qui relient les tours. En bas, un gros appareil ocre-jaune tiré du fossé, sur 6 à 7 m ; au-dessus, une surélévation d'environ 3 m en pierres plus petites et plus claires, bâtie sur les anciens créneaux encore lisibles dans la maçonnerie."],
    releve: 'Relevé : +10,7 à +11,5 m à l\'ouest ; au sud, une section basse vers +6,3 m.', source: 'Fascicule 2' },
  { titre: 'Le fossé', p: [-40, 0], h: null, pied: [-40, -3, 0],
    texte: ["Creusé dans le calcaire, le fossé est à la fois un obstacle et une carrière : on creuse la défense, et ce qu'on enlève devient muraille.",
      "Les sources parlent localement d'une dizaine de mètres de profondeur et de près de vingt de largeur."],
    releve: 'Relevé : fond à environ 6 à 8 m sous le plateau voisin (comblement au fil des siècles ?).', source: 'Fascicules 1 et 2' },
  { titre: 'La basse-cour', p: [36, -28], h: 3.5, pied: [27, -20, -35],
    texte: ["Première enceinte : granges, écuries, bêtes et récoltes. La basse-cour est le ventre du château ; la haute-cour en est la tête, les tours les yeux, les fossés les dents."],
    releve: "Les bâtiments actuels de la basse-cour n'ont pas encore été datés dans cette maquette.", source: 'Fascicule 2' },
  { titre: 'Le colombier (on peut y entrer)', p: [9.7, -74.3], h: 17.5, pied: [6.4, -66.8, -65],
    texte: ["Un imposant colombier « à pied », hors de l'enceinte, côté village. Le droit de colombier était un privilège seigneurial… et les pigeons pouvaient ravager les semis des paysans.",
      "Entrez : les murs sont tapissés de boulins, les niches où nichaient les pigeons. Au centre, un mât tournant porte une échelle qui permet d'atteindre tous les nids."],
    releve: 'Relevé : diamètre ≈ 8 m, faîte vers +15 m. Intérieur restitué d\'après la photo de la charpente ; emplacement de la porte à vérifier.', source: 'Fascicule 2', hypo: false },
  { titre: 'Le bord du plateau', p: [-20, 42], h: null, pied: [-34, 16, 70],
    texte: ["Au nord, le terrain plonge vers la plaine de Lure : le relief défend ce côté du château et la vue porte loin. Voir, c'est gagner du temps."],
    releve: 'Relevé : de 340 m à 319 m d\'altitude en 50 m de distance.', source: 'Fascicules 1 et 2' },
];
LIEUX[1].p = PORTE.centre;
LIEUX.forEach((l, k) => {
  l.n = k + 1;
  const zSol = hauteurSol(l.p[0], l.p[1]);
  l.z = l.h == null ? zSol + 3.5 : Math.max(l.h, zSol + 2.5);
});

// ------------------------------------------------------------------ interface : marqueurs, liste, fiche
const conteneur = $('marqueurs'), liste = $('liste');
LIEUX.forEach((l) => {
  const d = document.createElement('div'); d.className = 'marqueur';
  d.innerHTML = `<span class="nom">${l.titre}</span><span class="pastille${l.hypo ? ' q' : ''}">${l.n}</span><span class="tige"></span>`;
  d.addEventListener('click', (e) => { e.stopPropagation(); choisir(l); });
  conteneur.appendChild(d); l.el = d;
  const li = document.createElement('li');
  li.innerHTML = `<span class="pastille${l.hypo ? ' q' : ''}">${l.n}</span><span>${l.titre}</span>`;
  li.addEventListener('click', () => choisir(l));
  liste.appendChild(li); l.li = li;
});
let choisi = null;
function choisir(l) {
  choisi = l;
  LIEUX.forEach((x) => x.li.classList.toggle('sel', x === l));
  $('f-titre').textContent = l.titre;
  $('f-texte').innerHTML = l.texte.map((t) => `<p>${t}</p>`).join('') +
    `<p class="releve">${l.releve}</p><p class="source">Source : ${l.source}${l.hypo ? ' · <span class="hypothese">point à vérifier</span>' : ''}</p>`;
  $('fiche').style.display = 'block';
  $('f-aller').style.display = mode === 'pied' ? 'none' : '';
  if (mode === 'survol') volerVers(l);
  else regarderVers(l);
}
$('f-fermer').addEventListener('click', () => { $('fiche').style.display = 'none'; choisi = null; LIEUX.forEach((x) => x.li.classList.remove('sel')); });
$('f-aller').addEventListener('click', () => { if (choisi) { passerEnModePied(); placerMarcheur(choisi.pied); } });

// ------------------------------------------------------------------ modes de navigation
const orbite = new OrbitControls(camera, canvas);
orbite.enableDamping = true; orbite.dampingFactor = 0.08;
orbite.maxPolarAngle = 1.48; orbite.minDistance = 6; orbite.maxDistance = 420;
camera.position.copy(V(-78, -118, 82));
orbite.target.copy(V(6, -12, 6));
orbite.update();

let mode = 'survol';
const marcheur = { x: -2, y: -6, cap: 14 * DEG, site: 0 };
let vol = null;
function volerVers(l) {
  const cible = V(l.p[0], l.p[1], l.z - 4);
  const dir = new THREE.Vector3().subVectors(camera.position, orbite.target); dir.y = 0;
  if (dir.lengthSq() < 1) dir.set(1, 0, 1);
  dir.normalize();
  const dist = l.h != null && l.h > 20 ? 48 : 34;
  const pos = cible.clone().addScaledVector(dir, dist); pos.y = cible.y + dist * 0.55;
  vol = { t: 0, de: camera.position.clone(), a: pos, cDe: orbite.target.clone(), cA: cible };
}
function regarderVers(l) {
  marcheur.cap = Math.atan2(l.p[1] - marcheur.y, l.p[0] - marcheur.x);
  const d = Math.hypot(l.p[0] - marcheur.x, l.p[1] - marcheur.y);
  marcheur.site = clamp(Math.atan2(l.z - 1.65 - hauteurSol(marcheur.x, marcheur.y), d), -1.1, 1.1);
}
function placerMarcheur([x, y, capDeg]) { marcheur.x = x; marcheur.y = y; marcheur.cap = capDeg * DEG; marcheur.site = 0.05; }

const sources = '<br><span style="font-size:11px;opacity:.8">Relevé : IGN, LiDAR HD et BD TOPO (licence ouverte Etalab 2.0) · textures : banque du Studio · textes : fascicules Oricourt.</span>';
const aideSurvol = '<b>Survol</b> · glisser : tourner autour · molette ou pincement : zoom · clic droit ou deux doigts : déplacer. Cliquez un numéro pour lire la fiche du lieu.' + sources;
const aidePied = "<b>Visite à pied</b> · ZQSD / WASD ou flèches : marcher · Maj : courir · glisser la souris : regarder. Sur tablette : manette à gauche, glisser à droite pour regarder." + sources;
function majAide() { $('aide').innerHTML = mode === 'survol' ? aideSurvol : aidePied; }
function passerEnModeSurvol() {
  mode = 'survol'; orbite.enabled = true;
  $('b-survol').classList.add('actif'); $('b-pied').classList.remove('actif');
  $('manette').style.display = 'none';
  const c = V(marcheur.x, marcheur.y, hauteurSol(marcheur.x, marcheur.y));
  orbite.target.copy(c);
  camera.position.copy(c.clone().add(new THREE.Vector3(-30, 32, 40)));
  orbite.update(); majAide();
  if (choisi) $('f-aller').style.display = '';
}
function passerEnModePied() {
  mode = 'pied'; orbite.enabled = false; vol = null;
  $('b-pied').classList.add('actif'); $('b-survol').classList.remove('actif');
  if (matchMedia('(pointer: coarse)').matches) $('manette').style.display = 'block';
  majAide(); $('f-aller').style.display = 'none';
}
$('b-survol').addEventListener('click', passerEnModeSurvol);
$('b-pied').addEventListener('click', () => { if (mode !== 'pied') { placerMarcheur([-12, -14, 14]); passerEnModePied(); } });

let epoque = 'actuel';
const ancien = () => epoque !== 'actuel';
// ---- musique d'ambiance (morceaux d'Aurélien) : jouée dans le passé seulement, baissée pendant un dialogue, coupable
const MUSIQUE = { voulu: true, liste: [], i: 0, volume: 0.32, audio: null, cible: 0, actuel: 0 };
try { MUSIQUE.voulu = localStorage.getItem('oricourt_musique') !== 'non'; } catch (e) { /* stockage indisponible */ }
fetch('musique/musique.json').then((r) => (r.ok ? r.json() : null)).then((j) => { if (j) { MUSIQUE.liste = j.pistes || []; MUSIQUE.volume = j.volume || 0.32; MUSIQUE.i = Math.floor(Math.random() * MUSIQUE.liste.length); } }).catch(() => {});
function musiqueAjuster() {
  const b = document.getElementById('b-musique'); if (b) b.setAttribute('aria-pressed', MUSIQUE.voulu ? 'true' : 'false');
  const joue = MUSIQUE.voulu && epoque !== 'actuel' && MUSIQUE.liste.length;
  MUSIQUE.cible = joue ? MUSIQUE.volume * (JEU.dialogue ? 0.4 : 1) : 0;
  if (joue && !MUSIQUE.audio) {
    const a = new Audio(); a.preload = 'auto'; a.volume = 0;
    a.addEventListener('ended', () => { MUSIQUE.i = (MUSIQUE.i + 1) % MUSIQUE.liste.length; a.src = 'musique/' + MUSIQUE.liste[MUSIQUE.i].fichier; a.play().catch(() => {}); });
    a.src = 'musique/' + MUSIQUE.liste[MUSIQUE.i].fichier; MUSIQUE.audio = a;
  }
  if (joue && MUSIQUE.audio.paused) MUSIQUE.audio.play().catch(() => {});   // refusé tant que l'élève n'a pas cliqué : on réessaie au clic suivant
}
function musiqueMaj(dt) {   // fondu doux vers le volume voulu
  const a = MUSIQUE.audio; if (!a) return;
  const v = a.volume + Math.sign(MUSIQUE.cible - a.volume) * Math.min(Math.abs(MUSIQUE.cible - a.volume), dt * 0.25);
  a.volume = Math.max(0, Math.min(1, v));
  if (MUSIQUE.cible === 0 && a.volume === 0 && !a.paused) a.pause();
}
addEventListener('pointerdown', () => musiqueAjuster(), { passive: true });
addEventListener('keydown', () => musiqueAjuster());

function changerEpoque(e) {
  if (epoque === 'jeu' && e !== 'jeu') quitterJeu();
  epoque = e;
  if (e !== 'actuel' && JEU.chargerVivants) JEU.chargerVivants();
  G.actuel.visible = e === 'actuel'; G.medieval.visible = e !== 'actuel'; G.vie.visible = e !== 'actuel'; G.jeu.visible = e === 'jeu';
  $('b-actuel').classList.toggle('actif', e === 'actuel'); $('b-medieval').classList.toggle('actif', e === 'medieval'); $('b-jeu').classList.toggle('actif', e === 'jeu');
  document.body.classList.toggle('en-jeu', e === 'jeu');
  musiqueAjuster();
  scene.fog.near = e === 'jeu' ? 45 : 300; scene.fog.far = e === 'jeu' ? 230 : 1500; scene.fog.color.set(e === 'jeu' ? 0xcfcbd6 : 0xc6c4c0);
  matCiel.uniforms.brume.value = e === 'jeu' ? 0.85 : 0;
  const bd = $('bandeau');
  if (e === 'medieval') {
    bd.innerHTML = "<span class='hypothese'>Esquisse à valider avec le propriétaire</span> : courtines remises à niveau avec créneaux, hourds et toits restitués sur les tours, maisons modernes masquées, masures et bêtes ajoutées.";
    bd.style.display = 'block';
  } else bd.style.display = 'none';
}
$('b-actuel').addEventListener('click', () => changerEpoque('actuel'));
$('b-medieval').addEventListener('click', () => changerEpoque('medieval'));
$('b-jeu').addEventListener('click', () => lancerJeu());

// ------------------------------------------------------------------ marche : clavier, souris, tactile, collisions
const touches = new Set();
addEventListener('keydown', (e) => { if (JEU.touche(e)) return; if (mode === 'pied') { touches.add(e.code); if (e.code.startsWith('Arrow')) e.preventDefault(); } });
addEventListener('keyup', (e) => touches.delete(e.code));
addEventListener('blur', () => touches.clear());
let glisse = null;
canvas.addEventListener('pointerdown', (e) => {
  if (mode !== 'pied') return;
  if (e.pointerType === 'touch' && e.clientX < innerWidth * 0.42) return;
  glisse = { id: e.pointerId, x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (!glisse || e.pointerId !== glisse.id) return;
  marcheur.cap -= (e.clientX - glisse.x) * 0.0042;
  marcheur.site = clamp(marcheur.site - (e.clientY - glisse.y) * 0.0034, -1.25, 1.25);
  glisse.x = e.clientX; glisse.y = e.clientY;
});
const finGlisse = (e) => { if (glisse && e.pointerId === glisse.id) glisse = null; };
canvas.addEventListener('pointerup', finGlisse); canvas.addEventListener('pointercancel', finGlisse);
const manette = $('manette'), bouton = manette.querySelector('.bouton');
let axeManette = null;
manette.addEventListener('pointerdown', (e) => { manette.setPointerCapture(e.pointerId); bougerManette(e); });
manette.addEventListener('pointermove', (e) => { if (e.buttons || e.pointerType === 'touch') bougerManette(e); });
const relacher = () => { axeManette = null; bouton.style.transform = ''; };
manette.addEventListener('pointerup', relacher); manette.addEventListener('pointercancel', relacher);
function bougerManette(e) {
  const r = manette.getBoundingClientRect();
  let dx = (e.clientX - r.left - r.width / 2) / (r.width / 2), dy = (e.clientY - r.top - r.height / 2) / (r.height / 2);
  const L = Math.hypot(dx, dy); if (L > 1) { dx /= L; dy /= L; }
  axeManette = [dx, -dy]; bouton.style.transform = `translate(${dx * 34}px, ${dy * 34}px)`;
}

function dedansPoly(x, y, poly) {
  let ins = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}
function distSeg(x, y, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
  const t = L2 ? clamp(((x - a[0]) * dx + (y - a[1]) * dy) / L2, 0, 1) : 0;
  return Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy));
}
const MARGE = 0.35;
function bloque(x, y) {
  if (Math.abs(x) > HALF - 2 || Math.abs(y) > HALF - 2) return true;
  if (epoque === 'jeu') {
    if (Math.hypot(x - CENTRE_BROUILLARD[0], y - CENTRE_BROUILLARD[1]) > RAYON_BROUILLARD) { JEU.repousse = 1.2; return true; }
    for (const p of JEU.pnj) if (Math.hypot(x - p.x, y - p.y) < 0.55) return true;
  }
  for (const o of obstacles) {
    if (o.anneau) {
      const A = o.anneau, dx = x - A.c[0], dy = y - A.c[1], d = Math.hypot(dx, dy);
      if (d < 0.5) return true;
      if (d > A.ri - MARGE && d < A.ro + MARGE) {
        const lon = dx * A.dir[0] + dy * A.dir[1], lat = Math.abs(-dx * A.dir[1] + dy * A.dir[0]);
        if (!(lon > 0 && lat < A.demi - 0.22)) return true;
      }
      continue;
    }
    if (o.role && passages.some((p) => p.role === o.role && dedansPoly(x, y, p.poly))) continue;
    if (o.village && ancien()) continue;
    if (o.medievalSeulement && !ancien()) continue;
    if (dedansPoly(x, y, o.poly)) return true;
    for (let i = 0; i < o.poly.length; i++) if (distSeg(x, y, o.poly[i], o.poly[(i + 1) % o.poly.length]) < MARGE) return true;
  }
  for (const s of segmentsMurs) if (distSeg(x, y, s.a, s.b) < s.demi + MARGE) return true;
  return false;
}
function marcher(dt) {
  let av = 0, lat = 0;
  if (touches.has('KeyW') || touches.has('ArrowUp')) av += 1;
  if (touches.has('KeyS') || touches.has('ArrowDown')) av -= 1;
  if (touches.has('KeyA')) lat -= 1;
  if (touches.has('KeyD')) lat += 1;
  if (JEU.dialogue) { av = 0; lat = 0; }
  if (touches.has('ArrowLeft')) marcheur.cap += 1.7 * dt;
  if (touches.has('ArrowRight')) marcheur.cap -= 1.7 * dt;
  if (axeManette) { av += axeManette[1]; lat += axeManette[0]; }
  const L = Math.hypot(av, lat);
  if (L > 0.01) {
    if (L > 1) { av /= L; lat /= L; }
    const v = (touches.has('ShiftLeft') || touches.has('ShiftRight') ? 7.5 : 3.4) * dt;
    const c = Math.cos(marcheur.cap), s = Math.sin(marcheur.cap);
    const dx = (c * av + s * lat) * v, dy = (s * av - c * lat) * v;
    const nx = marcheur.x + dx, ny = marcheur.y + dy;
    const dh = Math.abs(hauteurSol(nx, ny) - hauteurSol(marcheur.x, marcheur.y));
    if (dh < 0.45 || dh / Math.max(1e-3, Math.hypot(dx, dy)) < 1.6) {
      if (!bloque(nx, ny)) { marcheur.x = nx; marcheur.y = ny; }
      else if (!bloque(nx, marcheur.y)) marcheur.x = nx;
      else if (!bloque(marcheur.x, ny)) marcheur.y = ny;
    }
  }
  const z = hauteurSol(marcheur.x, marcheur.y) + 1.65;
  camera.position.copy(V(marcheur.x, marcheur.y, z));
  const cp = Math.cos(marcheur.site);
  camera.lookAt(V(marcheur.x + Math.cos(marcheur.cap) * cp, marcheur.y + Math.sin(marcheur.cap) * cp, z + Math.sin(marcheur.site)));
}

// ------------------------------------------------------------------ boucle
const horloge = new THREE.Clock();
const tmp = new THREE.Vector3(), avant = new THREE.Vector3();
const rayon = new THREE.Raycaster();
let compteur = 0;
function majOcclusion() {
  for (const l of LIEUX) {
    l.cache = false;
    if (mode !== 'pied') continue;
    const cible = V(l.p[0], l.p[1], l.z), d = camera.position.distanceTo(cible);
    rayon.set(camera.position, cible.clone().sub(camera.position).normalize());
    rayon.far = d - 2.5;
    const vis = occultants.filter((m) => m.parent && m.parent.visible);
    l.cache = rayon.intersectObjects(vis, false).length > 0;
  }
}
function majMarqueurs() {
  const w = innerWidth, h = innerHeight;
  if (compteur++ % 12 === 0) majOcclusion();
  for (const l of LIEUX) {
    tmp.copy(V(l.p[0], l.p[1], l.z)).project(camera);
    const d = camera.position.distanceTo(V(l.p[0], l.p[1], l.z));
    const visible = epoque !== 'jeu' && tmp.z < 1 && Math.abs(tmp.x) < 1.1 && Math.abs(tmp.y) < 1.1 && (mode === 'survol' || (d < 90 && !l.cache));
    l.el.style.display = visible ? 'flex' : 'none';
    if (visible) {
      l.el.style.left = ((tmp.x + 1) / 2 * w) + 'px'; l.el.style.top = ((1 - tmp.y) / 2 * h) + 'px';
      l.el.style.opacity = mode === 'pied' ? String(clamp(1.4 - d / 100, 0.35, 1)) : '1';
      l.el.classList.toggle('proche', mode === 'pied' && d < 16);
    }
  }
}
const perf = { n: 0, t: 0, fait: false };
function surveillerPerf(dtBrut) {
  if (perf.fait) return;
  perf.n++; if (perf.n > 30) perf.t += dtBrut;          // on ignore les premières images
  if (perf.n === 150) {
    perf.fait = true;
    const ms = perf.t / 120 * 1000;
    if (ms > 45) {
      renderer.shadowMap.enabled = false; soleil.castShadow = false;
      renderer.setPixelRatio(ms > 90 ? 0.75 : 1);
      scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => { m.needsUpdate = true; }); });
      const bd = $('bandeau'); if (epoque === 'actuel') { bd.textContent = 'Mode allégé activé pour cet appareil (ombres désactivées).'; bd.style.display = 'block'; setTimeout(() => { if (epoque === 'actuel') bd.style.display = 'none'; }, 5000); }
    }
  }
}
function boucle() {
  const dtBrut = horloge.getDelta();
  const dt = Math.min(0.05, dtBrut);
  surveillerPerf(dtBrut);
  if (mode === 'survol') {
    if (vol) {
      vol.t = Math.min(1, vol.t + dt / 1.3); const e = vol.t < 0.5 ? 2 * vol.t * vol.t : 1 - Math.pow(-2 * vol.t + 2, 2) / 2;
      camera.position.lerpVectors(vol.de, vol.a, e); orbite.target.lerpVectors(vol.cDe, vol.cA, e);
      if (vol.t >= 1) vol = null;
    }
    orbite.update();
    const sol = hauteurSol(camera.position.x, -camera.position.z) + 2;
    if (camera.position.y < sol) camera.position.y = sol;
  } else marcher(dt);
  dome.position.copy(camera.position); matCiel.uniforms.temps.value += dt;
  camera.getWorldDirection(avant);
  $('boussole').style.transform = `translateX(-50%) rotate(${-Math.atan2(avant.x, -avant.z)}rad)`;
  majMarqueurs(); JEU.maj(dt); musiqueMaj(dt);
  if (JEU.portrait) JEU.portrait();
  renderer.render(scene, camera);
  requestAnimationFrame(boucle);
}
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});


// ================================================================== vie médiévale et jeu « Oricourt, l'an 1435 »
const JEU = { pnj: [], animaux: [], dialogue: null, repousse: 0, sceaux: {}, vus: {}, t: 0, touche: () => false, maj: () => {} };
{
  const mc = (c, r = 0.9, extra = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: r, ...extra });
  const piece = (g, geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; g.add(m); return m; };
  const dansLePasse = (fn) => { const e0 = epoque; epoque = 'medieval'; try { return fn(); } finally { epoque = e0; } };
  const placeLibre = (x, y) => dansLePasse(() => { for (let r = 0; r < 8; r += 0.6) for (let a = 0; a < 6.28; a += 0.7) { const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r; if (!bloque(px, py) && !bloque(px + 0.5, py) && !bloque(px - 0.5, py) && !bloque(px, py + 0.5) && !bloque(px, py - 0.5)) return [px, py]; } return [x, y]; });

  // ---- masures de torchis et de chaume
  const matChaume = new THREE.MeshStandardMaterial({ map: teA, color: 0xe2c476, roughness: 1, side: THREE.DoubleSide });
  const matTorchis = new THREE.MeshStandardMaterial({ map: crA, color: 0xd8c096, roughness: 1 });
  for (const [x, y, angDeg, L, l] of MASURES) {
    const a = angDeg * DEG, ca = Math.cos(a), sa = Math.sin(a);
    const coin = (lx, lz) => [x + lx * ca + lz * sa, y + lx * sa - lz * ca];
    const poly = [coin(-L / 2, -l / 2), coin(L / 2, -l / 2), coin(L / 2, l / 2), coin(-L / 2, l / 2)];
    const zs = poly.map((p) => hauteurTerrain(p[0], p[1]));
    if (Math.max(...zs) - Math.min(...zs) > 1.3 || dansLePasse(() => poly.some((p) => bloque(p[0], p[1])) || bloque(x, y))) continue;
    const g = new THREE.Group(); g.position.copy(V(x, y, Math.min(...zs) - 0.15)); g.rotation.y = a; G.vie.add(g);
    const hm = 2.0 + (Math.max(...zs) - Math.min(...zs)), hf = hm + l * 0.62;
    const box = new THREE.BoxGeometry(L, hm, l); box.translate(0, hm / 2, 0);
    { const uv = box.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * L, uv.getY(i) * hm); }
    const mb = new THREE.Mesh(box, matTorchis); mb.castShadow = mb.receiveShadow = true; g.add(mb);
    const d = 0.45, zb = hm - d * 0.62 * 2, toit = new Geo(), pig = new Geo();
    for (const sg of [-1, 1]) toit.quad(new THREE.Vector3(-L / 2 - d, zb, sg * (l / 2 + d)), new THREE.Vector3(L / 2 + d, zb, sg * (l / 2 + d)), new THREE.Vector3(L / 2 + d, hf, 0), new THREE.Vector3(-L / 2 - d, hf, 0), [0, 0], [L, 0], [L, 3], [0, 3], new THREE.Vector3(0, 1, 0));
    for (const sg of [-1, 1]) pig.quad(new THREE.Vector3(sg * L / 2, hm, -l / 2), new THREE.Vector3(sg * L / 2, hm, l / 2), new THREE.Vector3(sg * L / 2, hf, 0), new THREE.Vector3(sg * L / 2, hf, 0), [0, 0], [l, 0], [l / 2, 2], [l / 2, 2], new THREE.Vector3(sg, 0, 0));
    const mt = new THREE.Mesh(toit.geometrie(), matChaume); mt.castShadow = true; g.add(mt, new THREE.Mesh(pig.geometrie(), matTorchis));
    piece(g, new THREE.BoxGeometry(0.85, 1.7, 0.06), M.bois, L * 0.18, 0.85 + (Math.max(...zs) - Math.min(...zs)) * 0.5, l / 2 + 0.02);
    for (const sx of [-L / 2, L / 2]) for (const sz of [-l / 2, l / 2]) piece(g, new THREE.BoxGeometry(0.16, hm, 0.16), M.bois, sx, hm / 2, sz);
    obstacles.push({ poly, village: false, medievalSeulement: true });
  }

  // ---- animaux de basse-cour (formes simples)
  function animal(type) {
    const g = new THREE.Group(), blanc = mc(0xe9e4d6), brun = mc(0x9a6a3c), rose = mc(0xd9a39a), noir = mc(0x2a2622), rouge = mc(0xb02a22), jaune = mc(0xd9a52a), gris = mc(0xb8b2a6);
    const sph = (r) => new THREE.SphereGeometry(r, 10, 8);
    if (type === 'poule' || type === 'coq') {
      const c = type === 'coq' ? mc(0x7a3a1c) : (Math.random() < 0.5 ? brun : blanc);
      const b = piece(g, sph(0.15), c, 0, 0.22, 0); b.scale.set(0.85, 0.85, 1.25);
      g.userData.tete = piece(g, sph(0.07), c, 0, 0.36, 0.17);
      piece(g, new THREE.ConeGeometry(0.025, 0.07, 6), jaune, 0, 0.35, 0.25, Math.PI / 2);
      piece(g, new THREE.BoxGeometry(0.02, 0.06, 0.07), rouge, 0, 0.44, 0.17);
      piece(g, new THREE.ConeGeometry(0.09, 0.2, 6), c, 0, 0.3, -0.2, -0.9);
      for (const sx of [-0.05, 0.05]) piece(g, new THREE.CylinderGeometry(0.012, 0.012, 0.12, 5), jaune, sx, 0.06, 0);
      if (type === 'coq') g.scale.setScalar(1.25);
    } else if (type === 'oie') {
      const b = piece(g, sph(0.22), blanc, 0, 0.32, 0); b.scale.set(0.8, 0.8, 1.35);
      piece(g, new THREE.CylinderGeometry(0.04, 0.05, 0.35, 6), blanc, 0, 0.55, 0.24, 0.35);
      g.userData.tete = piece(g, sph(0.065), blanc, 0, 0.73, 0.31);
      piece(g, new THREE.ConeGeometry(0.03, 0.1, 6), mc(0xd9822a), 0, 0.72, 0.4, Math.PI / 2);
      for (const sx of [-0.07, 0.07]) piece(g, new THREE.CylinderGeometry(0.018, 0.018, 0.16, 5), mc(0xd9822a), sx, 0.08, 0);
    } else if (type === 'cochon') {
      const b = piece(g, sph(0.3), rose, 0, 0.42, 0); b.scale.set(0.85, 0.8, 1.5);
      g.userData.tete = piece(g, sph(0.17), rose, 0, 0.45, 0.48);
      piece(g, new THREE.CylinderGeometry(0.07, 0.07, 0.08, 8), mc(0xc98a82), 0, 0.42, 0.65, Math.PI / 2);
      for (const sx of [-0.1, 0.1]) piece(g, new THREE.ConeGeometry(0.05, 0.1, 5), rose, sx, 0.62, 0.45);
      for (const sx of [-0.14, 0.14]) for (const sz of [-0.25, 0.25]) piece(g, new THREE.CylinderGeometry(0.045, 0.04, 0.24, 6), rose, sx, 0.12, sz);
    } else {
      const c = Math.random() < 0.5 ? gris : blanc;
      const b = piece(g, sph(0.26), c, 0, 0.55, 0); b.scale.set(0.75, 0.8, 1.45);
      piece(g, new THREE.CylinderGeometry(0.06, 0.08, 0.3, 6), c, 0, 0.75, 0.33, 0.6);
      g.userData.tete = piece(g, sph(0.1), c, 0, 0.88, 0.44); g.userData.tete.scale.set(0.8, 0.9, 1.3);
      for (const sx of [-0.05, 0.05]) piece(g, new THREE.ConeGeometry(0.02, 0.16, 5), noir, sx, 1.0, 0.4, -0.5);
      piece(g, new THREE.ConeGeometry(0.03, 0.12, 5), c, 0, 0.78, 0.52, Math.PI);
      for (const sx of [-0.1, 0.1]) for (const sz of [-0.25, 0.25]) piece(g, new THREE.CylinderGeometry(0.03, 0.025, 0.4, 6), c, sx, 0.2, sz);
    }
    return g;
  }
  ANIMAUX.forEach(([type, x, y, r], k) => {
    const [px, py] = placeLibre(x, y), g = animal(type); G.vie.add(g);
    JEU.animaux.push({ g, c: [px, py], r, ph: k * 1.7, v: (type === 'cochon' ? 0.12 : 0.22) * (k % 2 ? 1 : -1), type });
  });

  // ---- personnages
  const PEAU = 0xe0b48e;
  function personnage(t) {
    const g = new THREE.Group(), cotte = mc(t.cotte), ch = mc(t.chausses), peau = mc(PEAU, 0.8), co = mc(t.couleurCoiffe || 0x333333, t.coiffe === 'casque' ? 0.4 : 0.9, t.coiffe === 'casque' ? { metalness: 0.6 } : {});
    for (const sx of [-0.1, 0.1]) { piece(g, new THREE.CylinderGeometry(0.075, 0.065, 0.82, 8), ch, sx, 0.41, 0); piece(g, new THREE.BoxGeometry(0.11, 0.07, 0.24), mc(0x3a2a1c), sx, 0.035, 0.05); }
    if (t.longue) piece(g, new THREE.CylinderGeometry(0.19, 0.36, 1.28, 12), cotte, 0, 0.74, 0);
    else { piece(g, new THREE.CylinderGeometry(0.2, 0.31, 0.8, 12), cotte, 0, 0.98, 0); }
    piece(g, new THREE.SphereGeometry(0.2, 12, 8), cotte, 0, 1.33, 0).scale.set(1.25, 0.55, 0.9);
    piece(g, new THREE.TorusGeometry(0.235, 0.022, 6, 16), mc(0x2e2018), 0, 0.98, 0, Math.PI / 2);
    for (const sx of [-1, 1]) { piece(g, new THREE.CylinderGeometry(0.058, 0.05, 0.58, 8), cotte, sx * 0.29, 1.08, 0.02, 0, 0, sx * 0.13); piece(g, new THREE.SphereGeometry(0.055, 8, 6), peau, sx * 0.325, 0.78, 0.03); }
    if (t.tablier) piece(g, new THREE.BoxGeometry(0.3, 0.62, 0.02), mc(t.tablier), 0, 0.8, 0.27, -0.09);
    piece(g, new THREE.CylinderGeometry(0.05, 0.06, 0.08, 8), peau, 0, 1.42, 0);
    const tete = new THREE.Group(); tete.position.set(0, 1.56, 0); g.add(tete); g.userData.tete = tete;
    piece(tete, new THREE.SphereGeometry(0.125, 14, 12), peau, 0, 0, 0).scale.set(0.92, 1.05, 1);
    for (const sx of [-0.045, 0.045]) piece(tete, new THREE.SphereGeometry(0.015, 6, 6), mc(0x1c1612), sx, 0.015, 0.112);
    piece(tete, new THREE.SphereGeometry(0.018, 6, 6), peau, 0, -0.02, 0.125);
    const demi = (r) => new THREE.SphereGeometry(r, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.4);
    if (t.coiffe === 'coiffe') { piece(tete, demi(0.14), co, 0, 0.0, -0.01); piece(tete, new THREE.SphereGeometry(0.11, 10, 8), co, 0, -0.05, -0.07); }
    else if (t.coiffe === 'chaperon') { piece(tete, demi(0.145), co, 0, 0, -0.01); piece(tete, new THREE.ConeGeometry(0.05, 0.4, 8), co, 0, -0.06, -0.2, -2.2); piece(g, new THREE.CylinderGeometry(0.17, 0.3, 0.2, 12), co, 0, 1.36, 0); }
    else if (t.coiffe === 'chapeau') { piece(tete, new THREE.CylinderGeometry(0.27, 0.27, 0.02, 16), co, 0, 0.09, 0); piece(tete, new THREE.CylinderGeometry(0.1, 0.125, 0.11, 12), co, 0, 0.14, 0); }
    else if (t.coiffe === 'casque') { piece(tete, demi(0.15), co, 0, 0.01, 0); piece(tete, new THREE.CylinderGeometry(0.2, 0.21, 0.02, 16), co, 0, 0.03, 0); }
    else if (t.coiffe === 'tonsure') piece(tete, new THREE.TorusGeometry(0.105, 0.035, 6, 16), co, 0, 0.05, -0.01, Math.PI / 2);
    else piece(tete, demi(0.14), co, 0, 0.01, -0.01);
    if (t.arme === 'lance') { piece(g, new THREE.CylinderGeometry(0.018, 0.018, 2.3, 6), M.bois, 0.36, 1.15, 0.05); piece(g, new THREE.ConeGeometry(0.05, 0.3, 6), mc(0x9aa0a6, 0.4, { metalness: 0.7 }), 0.36, 2.45, 0.05); }
    if (t.arme === 'marteau') { piece(g, new THREE.CylinderGeometry(0.015, 0.015, 0.4, 6), M.bois, 0.33, 0.72, 0.1, 1.2); piece(g, new THREE.BoxGeometry(0.07, 0.07, 0.16), mc(0x6a6e72, 0.5, { metalness: 0.6 }), 0.33, 0.8, 0.28); }
    return g;
  }
  const conteneurPnj = $('marqueurs');
  for (const p of PERSONNAGES) {
    let xy = p.pos;
    if (xy === 'galerie') xy = GAL.pt(GAL.sArches[1], 1.9);
    else if (xy === 'porte') { const c = PORTE.centre, d = [c[0] - CENTRE_HC[0], c[1] - CENTRE_HC[1]], L = Math.hypot(d[0], d[1]); xy = [c[0] + d[0] / L * 4 + d[1] / L * 1.6, c[1] + d[1] / L * 4 - d[0] / L * 1.6]; }
    else if (xy === 'colombier') xy = [COLOMBIER.c[0] + COLOMBIER.dir[0] * (COLOMBIER.r + 2.4) - COLOMBIER.dir[1] * 1.7, COLOMBIER.c[1] + COLOMBIER.dir[1] * (COLOMBIER.r + 2.4) + COLOMBIER.dir[0] * 1.7];
    const [x, y] = xy === p.pos || p.pos === 'galerie' ? (p.pos === 'galerie' ? xy : placeLibre(xy[0], xy[1])) : placeLibre(xy[0], xy[1]);
    const g = personnage(p.tenue); g.position.copy(V(x, y, hauteurSol(x, y))); g.rotation.y = Math.random() * 6; G.jeu.add(g);
    const el = document.createElement('div'); el.className = 'marqueur pnj'; el.innerHTML = `<span class="etiq"><b>${p.nom}</b><i>${p.role}</i></span><span class="sceau">?</span>`;
    el.addEventListener('click', (e) => { e.stopPropagation(); if (mode === 'pied' && Math.hypot(marcheur.x - x, marcheur.y - y) < 4.5) ouvrirDialogue(pn); });
    conteneurPnj.appendChild(el);
    const pn = { ...p, x, y, g, el, ph: Math.random() * 6 }; JEU.pnj.push(pn);
  }

  // ---- mur de brouillard magique
  const matBrume = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false, uniforms: { temps: { value: 0 } },
    vertexShader: 'varying vec2 vU; varying float vH; void main(){ vU = uv; vH = position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform float temps; varying vec2 vU; varying float vH;' + GLSL_BRUIT + `
      void main(){ float n = fbm(vec2(vU.x * 60.0 + temps * 0.05, vU.y * 5.0 - temps * 0.08)); float m = fbm(vec2(vU.x * 23.0 - temps * 0.03, vU.y * 2.0 + 9.0));
        float a = smoothstep(0.25, 0.75, n * 0.6 + m * 0.6) * (1.0 - smoothstep(0.55, 1.0, vU.y)) ;
        vec3 c = mix(vec3(0.80, 0.78, 0.90), vec3(0.97, 0.96, 1.0), n);
        gl_FragColor = vec4(c, clamp(a * 1.25 + 0.35 * (1.0 - vU.y), 0.0, 0.96)); }` });
  for (const dr of [5, 13]) { const cyl = new THREE.Mesh(new THREE.CylinderGeometry(RAYON_BROUILLARD + dr, RAYON_BROUILLARD + dr, 75, 72, 1, true), matBrume);
    cyl.position.copy(V(CENTRE_BROUILLARD[0], CENTRE_BROUILLARD[1], 22)); cyl.renderOrder = 5; G.jeu.add(cyl); }

  // ---- interface du jeu
  const CLE = 'oricourt_jeu_1435';
  const sauver = () => { try { localStorage.setItem(CLE, JSON.stringify({ sceaux: JEU.sceaux, vus: JEU.vus })); } catch (e) { /* stockage indisponible */ } };
  try { const d = JSON.parse(localStorage.getItem(CLE) || 'null'); if (d) { JEU.sceaux = d.sceaux || {}; JEU.vus = d.vus || {}; } } catch (e) { /* stockage indisponible */ }
  const nbSceaux = () => PERSONNAGES.filter((p) => JEU.sceaux[p.id]).length;
  const invite = $('invite'), voile = $('voile'), ecran = $('ecran');
  function majCarnet() {
    $('b-carnet').textContent = `Carnet · ${nbSceaux()}/${PERSONNAGES.length} sceaux`;
    $('carnet-liste').innerHTML = PERSONNAGES.map((p) => JEU.sceaux[p.id] ? `<li><b>✦ ${p.nom}</b> — ${p.savoir}</li>` : `<li class="vide">○ ${p.nom}, ${p.role} : à rencontrer</li>`).join('') +
      (nbSceaux() === PERSONNAGES.length ? '<li><b>Tous les sceaux sont réunis : retourne au puits, sous la galerie.</b></li>' : '');
    for (const p of JEU.pnj) { p.el.querySelector('.sceau').textContent = JEU.sceaux[p.id] ? '✦' : '?'; p.el.classList.toggle('fait', !!JEU.sceaux[p.id]); }
  }
  function ecranTexte(o, suite) {
    ecran.innerHTML = `<div class="boite"><h2>${o.titre}</h2>${o.texte.map((t) => `<p>${t}</p>`).join('')}<button id="ecran-ok">${o.bouton}</button></div>`;
    ecran.style.display = 'grid'; JEU.dialogue = { ecran: true };
    $('ecran-ok').addEventListener('click', () => { ecran.style.display = 'none'; JEU.dialogue = null; suite && suite(); });
  }
  // ---- fenêtre centrale de dialogue (reprise de « La Stase », Studio de vie J68 : visages face à face, échange qui défile,
  //      choix numérotés 1 à 9, « Autre réplique… », Échap pour partir ; cadres et bandeau dessinés par Codex)
  const D = { fond: $('dlg-fond'), fen: $('dlg'), hist: $('dlg-historique'), rep: $('dlg-replique'), issue: $('dlg-issue'), choix: $('dlg-choix'),
    nom: $('dlg-nom'), role: $('dlg-role'), att: $('dlg-attitude'), rel: $('dlg-relation'), moi: $('dlg-moi'), lui: $('dlg-lui') };
  const ATT = { indifferent: ['indifférent', 'te regarde avec méfiance'], amical: ['amical', 'te parle volontiers'], serviable: ['serviable', 't\'apprécie : tu as son sceau'] };
  const attitudeDe = (p) => JEU.sceaux[p.id] ? 'serviable' : (p.sujets.some((x, k) => JEU.vus[p.id + k]) ? 'amical' : 'indifferent');
  const sansAccents = (t) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const VIDES = new Set(['quoi', 'quel', 'quell', 'comme', 'pourq', 'est-c', 'cette', 'votre', 'notre', 'avec', 'dans', 'pour', 'sont', 'ceux']);
  const mots = (t) => new Set(sansAccents(t).split(/[^a-z]+/).filter((m) => m.length >= 4).map((m) => m.slice(0, 5)).filter((m) => !VIDES.has(m)));   // racines de 5 lettres : « manger » rejoint « mange »
  function silhouette(cv) {
    const c = cv.getContext('2d'), w = cv.width, h = cv.height, g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#6b5636'); g.addColorStop(1, '#2e2416'); c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.fillStyle = 'rgba(20,14,8,0.78)'; c.beginPath(); c.arc(w / 2, h * 0.38, w * 0.2, 0, 6.3); c.fill();
    c.beginPath(); c.moveTo(w * 0.12, h); c.quadraticCurveTo(w * 0.16, h * 0.62, w / 2, h * 0.6); c.quadraticCurveTo(w * 0.84, h * 0.62, w * 0.88, h); c.fill();
    c.fillStyle = 'rgba(242,230,196,0.85)'; c.font = `600 ${Math.round(w * 0.11)}px Cormorant Garamond, Georgia, serif`; c.textAlign = 'center'; c.fillText('?', w / 2, h * 0.43);
  }
  silhouette(D.moi);
  // portraits peints par Codex (commande ORI-P01) : s'ils sont livrés (portraits/portraits.json), ils remplacent le visage 3D ;
  // sinon le cadre montre le personnage rendu en direct. « neutre » tant qu'il est indifférent, « amical » ensuite.
  const PORTRAITS = { liste: null, images: new Map() };
  PORTRAITS.pret = fetch('portraits/portraits.json').then((r) => (r.ok ? r.json() : null)).catch(() => null).then((j) => {
    PORTRAITS.liste = j && j.portraits ? j.portraits : {};
    if (PORTRAITS.liste.voyageur) imagePortrait('voyageur').then((im) => im && peindre(D.moi, im));
  });
  async function imagePortrait(cle) {
    await PORTRAITS.pret;
    const f = PORTRAITS.liste[cle];
    if (!f) return Promise.resolve(null);
    if (!PORTRAITS.images.has(cle)) PORTRAITS.images.set(cle, new Promise((ok) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => ok(null); im.src = 'portraits/' + f; }));
    return PORTRAITS.images.get(cle);
  }
  function peindre(cv, im) {   // remplissage « cover », cadré sur le haut de l'image (le visage)
    const c = cv.getContext('2d'), k = Math.max(cv.width / im.naturalWidth, cv.height / im.naturalHeight), w = im.naturalWidth * k, h = im.naturalHeight * k;
    c.clearRect(0, 0, cv.width, cv.height); c.drawImage(im, (cv.width - w) / 2, Math.min(0, (cv.height - h) * 0.25), w, h);
  }
  async function portraitPeint(p, at) {
    const J = JEU.dialogue, voulu = at === 'indifferent' ? 'neutre' : 'amical';
    const im = (await imagePortrait(p.id + '_' + voulu)) || (await imagePortrait(p.id + '_neutre'));
    if (!im || JEU.dialogue !== J) return;
    J.peint = true; peindre(D.lui, im);
  }
  function ligne(qui, texte, classe = '') { const li = document.createElement('li'); li.className = 'dlg-l ' + classe; li.innerHTML = qui ? `<span class="qui">${qui} :</span> ${texte}` : texte; D.hist.appendChild(li); }
  function rendre(p, { dit = null, narr = null, issue = null, choix = [] }) {
    const J = JEU.dialogue;
    if (J.dernier) ligne(J.dernier.qui, J.dernier.texte, J.dernier.classe);
    D.hist.hidden = !D.hist.children.length; D.hist.scrollTop = D.hist.scrollHeight;
    D.rep.innerHTML = (narr ? `<p class="dlg-narr">${narr}</p>` : '') + (dit ? `<p class="dlg-dit"><span class="qui">${p.nom} :</span> « ${dit} »</p>` : '');
    J.dernier = dit ? { qui: p.nom, texte: '« ' + dit + ' »' } : (narr ? { qui: null, texte: narr, classe: 'narr' } : null);
    D.issue.hidden = !issue; D.issue.textContent = issue || '';
    const at = attitudeDe(p); D.att.textContent = ATT[at][0]; D.att.dataset.attitude = at; D.rel.textContent = ATT[at][1];
    if (J.attitude !== at) { J.attitude = at; portraitPeint(p, at); }
    poserChoix(choix);
    J.tour = dit ? 'pnj' : 'moi';
  }
  function poserChoix(choix) {
    D.choix.innerHTML = ''; JEU.dialogue.options = choix;
    choix.forEach((o, k) => {
      const li = document.createElement('li'), b = document.createElement('button');
      b.className = 'dlg-option ' + (o.classe || ''); b.innerHTML = `<span class="dlg-num">${k + 1}.</span><span class="dlg-texte">${o.texte}</span>`;
      b.addEventListener('click', () => choisir(k)); li.appendChild(b); D.choix.appendChild(li);
    });
  }
  function choisir(k) {
    const J = JEU.dialogue; if (!J || !J.options || !J.options[k]) return;
    const o = J.options[k];
    if (o.dire) { if (J.dernier) ligne(J.dernier.qui, J.dernier.texte, J.dernier.classe); J.dernier = { qui: 'Toi', texte: o.dire, classe: 'moi' }; }
    o.action();
  }
  function fermerDialogue() { D.fond.style.display = 'none'; D.fen.style.display = 'none'; document.documentElement.classList.remove('dialogue-ouvert'); JEU.dialogue = null; musiqueAjuster(); }
  function choixDeBase(p) {
    const c = p.sujets.map((s2, k) => ({ texte: (JEU.vus[p.id + k] ? '✓ ' : '') + s2.q, dire: s2.q, action: () => { JEU.vus[p.id + k] = 1; sauver(); rendre(p, { dit: s2.r, choix: choixDeBase(p) }); } }));
    if (!JEU.sceaux[p.id]) c.push({ texte: '<span class="dlg-comp">[Épreuve du sceau]</span> Répondre à sa question', classe: 'guide', dire: 'Je suis prêt à répondre à ta question.', action: () => poserQuestion(p) });
    c.push({ texte: 'Autre réplique…', classe: 'dlg-autre-replique', action: () => replique(p) });
    c.push({ texte: 'Partir', classe: 'rapide', dire: 'Au revoir.', action: fermerDialogue });
    return c;
  }
  function poserQuestion(p) {
    rendre(p, { dit: 'Voyons si tu as bien écouté. ' + p.question.texte, choix: [
      ...p.question.choix.map((c, k) => ({ texte: c, dire: c, action: () => (k === p.question.bonne ? gagner(p) : rater(p)) })),
      { texte: 'Je préfère d\'abord l\'écouter', classe: 'rapide', dire: 'Attends, je voudrais d\'abord t\'écouter.', action: () => rendre(p, { dit: 'Comme tu voudras. Que veux-tu savoir ?', choix: choixDeBase(p) }) }] });
  }
  function gagner(p) {
    JEU.sceaux[p.id] = 1; sauver(); majCarnet();
    rendre(p, { dit: 'Bien répondu ! Voici mon sceau, voyageur.', narr: p.question.explication, issue: `✦ Sceau de ${p.nom} obtenu (${nbSceaux()}/${PERSONNAGES.length})`, choix: [
      { texte: nbSceaux() === PERSONNAGES.length ? 'Retourner au puits' : 'Continuer à parler', classe: 'guide', action: () => { if (nbSceaux() === PERSONNAGES.length) { fermerDialogue(); annoncer('Tu as les neuf sceaux ! Retourne au puits, sous la galerie de la haute-cour.'); } else rendre(p, { dit: 'Autre chose ?', choix: choixDeBase(p) }); } },
      { texte: 'Partir', classe: 'rapide', dire: 'Merci, au revoir.', action: fermerDialogue }] });
    VIV.geste(p.id, 'oui');
  }
  function rater(p) {
    rendre(p, { dit: 'Hum… non, ce n\'est pas cela. Écoute encore ce que j\'ai à te dire, puis reviens me voir.', issue: 'Épreuve du sceau : manquée', choix: choixDeBase(p) });
    VIV.geste(p.id, 'non');
  }
  function replique(p) {
    D.choix.innerHTML = `<li><form class="dlg-libre-form"><textarea id="dlg-texte" rows="2" placeholder="Écris ce que tu veux lui dire ou lui demander…"></textarea><div class="dlg-libre-actions"><button type="submit" class="dlg-option guide">Dire</button><button type="button" class="dlg-option rapide" id="dlg-annuler">Annuler</button></div></form></li>`;
    JEU.dialogue.options = null;
    const f = D.choix.querySelector('form'), ta = $('dlg-texte'); ta.focus();
    $('dlg-annuler').addEventListener('click', () => poserChoix(choixDeBase(p)));
    ta.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); f.requestSubmit(); } else if (e.key === 'Escape') poserChoix(choixDeBase(p)); });
    f.addEventListener('submit', (e) => {
      e.preventDefault(); const t = ta.value.trim(); if (!t) return;
      if (JEU.dialogue.dernier) ligne(JEU.dialogue.dernier.qui, JEU.dialogue.dernier.texte, JEU.dialogue.dernier.classe);
      JEU.dialogue.dernier = { qui: 'Toi', texte: t, classe: 'moi' };
      const m = mots(t); let best = -1, score = 0;
      p.sujets.forEach((s2, k) => { let n = 0; for (const x of mots(s2.q)) if (m.has(x)) n += 3; for (const x of mots(s2.r)) if (m.has(x)) n += 1; if (n > score) { score = n; best = k; } });
      const st = sansAccents(t);
      if (best >= 0 && score >= 1) { JEU.vus[p.id + best] = 1; sauver(); rendre(p, { dit: p.sujets[best].r, choix: choixDeBase(p) }); }
      else if (/sceau|question|epreuve|pret/.test(st) && !JEU.sceaux[p.id]) poserQuestion(p);
      else if (/bonjour|salut|bonsoir|coucou/.test(st)) rendre(p, { dit: 'Le bonjour à toi aussi, voyageur. Que veux-tu savoir ?', choix: choixDeBase(p) });
      else if (/merci/.test(st)) rendre(p, { dit: 'Il n\'y a pas de quoi. Que Dieu te garde.', choix: choixDeBase(p) });
      else rendre(p, { dit: 'Je ne comprends pas bien tes manières de parler, voyageur. Demande-moi plutôt : ' + p.sujets.map((x) => '« ' + x.q + ' »').join(', ') + '.', choix: choixDeBase(p) });
    });
  }
  function ouvrirDialogue(p) {
    JEU.dialogue = { p, dernier: null, portrait: 0 }; touches.clear(); invite.style.display = 'none';
    D.hist.innerHTML = ''; D.nom.textContent = p.nom; D.role.textContent = p.role;
    { const c = D.lui.getContext('2d'); c.fillStyle = '#2a2016'; c.fillRect(0, 0, D.lui.width, D.lui.height); }   // pas de visage du dialogue précédent
    imagePortrait(p.id + '_amical');   // préchargé : il remplace « neutre » dès que l'attitude change
    D.fond.style.display = 'block'; D.fen.style.display = 'flex'; document.documentElement.classList.add('dialogue-ouvert');
    rendre(p, { dit: p.accueil, choix: choixDeBase(p) });
    VIV.geste(p.id, 'saluer'); musiqueAjuster();
  }
  D.fond.addEventListener('click', fermerDialogue);
  $('dlg-partir').addEventListener('click', fermerDialogue);
  let finAnnonce = 0;
  function annoncer(t) { const bd = $('bandeau'); bd.textContent = t; bd.style.display = 'block'; finAnnonce = JEU.t + 6; }
  window.lancerJeuInterne = () => {
    changerEpoque('jeu'); placerMarcheur(DEPART); passerEnModePied(); majCarnet(); $('fiche').style.display = 'none';
    if (nbSceaux() === 0) ecranTexte(INTRO); else annoncer(`Te revoilà en 1435 : ${nbSceaux()} sceau(x) sur ${PERSONNAGES.length}. Ton carnet te dit qui il reste à rencontrer.`);
  };
  window.quitterJeuInterne = () => { fermerDialogue(); ecran.style.display = 'none'; invite.style.display = 'none'; voile.style.opacity = 0; $('carnet').style.display = 'none'; };
  $('b-musique').addEventListener('click', () => { MUSIQUE.voulu = !MUSIQUE.voulu; try { localStorage.setItem('oricourt_musique', MUSIQUE.voulu ? 'oui' : 'non'); } catch (e) { /* rien */ } musiqueAjuster(); });
  $('b-carnet').addEventListener('click', () => { const c = $('carnet'); c.style.display = c.style.display === 'block' ? 'none' : 'block'; });
  $('carnet-fermer').addEventListener('click', () => { $('carnet').style.display = 'none'; });
  $('carnet-zero').addEventListener('click', () => { JEU.sceaux = {}; JEU.vus = {}; sauver(); majCarnet(); });
  let cible = null;
  const agir = () => { if (!cible || JEU.dialogue) return; if (cible === 'puits') ecranTexte(FIN, () => { changerEpoque('actuel'); annoncer('Bienvenue de retour au XXIe siècle. Ton carnet garde tout ce que tu as appris.'); }); else ouvrirDialogue(cible); };
  invite.addEventListener('click', agir);
  JEU.touche = (e) => {
    if (epoque !== 'jeu') return false;
    if (JEU.dialogue) {
      if (JEU.dialogue.ecran) return true;
      if (e.code === 'Escape') fermerDialogue();
      else if (/^(Digit|Numpad)[1-9]$/.test(e.code) && document.activeElement.tagName !== 'TEXTAREA') choisir(+e.code.slice(-1) - 1);
      return true;
    }
    if (e.code === 'KeyE' || e.code === 'Enter') { agir(); return true; }
    return false;
  };
  // ---- habitants et bêtes animés du Studio (chargés à la première visite du passé)
  const VIV = { etat: 'attente', module: null, geste(id, it) { const h = this.module && this.module.trouver(id); if (h) h.gesticuler(it); } };
  JEU.VIV = VIV;
  const groupeBetes = new THREE.Group(); G.vie.add(groupeBetes);
  const figurants = FIGURANTS.map((f) => { const [x, y] = placeLibre(f.pos[0], f.pos[1]); const g = new THREE.Group(); g.position.copy(V(x, y, hauteurSol(x, y))); g.rotation.y = Math.random() * 6; G.vie.add(g); return { ...f, g }; });
  // routines : postes résolus sur le terrain (place libre, trajet droit sans obstacle), meubles et ouvrages posés
  const groupeMeubles = new THREE.Group(); G.vie.add(groupeMeubles);
  const matBois = new THREE.MeshStandardMaterial({ color: 0x6e5236, roughness: 0.9 }), matPierre = new THREE.MeshStandardMaterial({ color: 0xc9b48a, roughness: 0.95 }), matFer = new THREE.MeshStandardMaterial({ color: 0x3c3a38, roughness: 0.5, metalness: 0.7 });
  function meuble(type, x, y, cap) {
    const g = new THREE.Group(), b = (w, h, d, m, px = 0, py = 0, pz = 0) => { const k = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); k.position.set(px, py, pz); k.castShadow = k.receiveShadow = true; g.add(k); };
    if (type === 'banc') { b(1.2, 0.07, 0.34, matBois, 0, 0.44, 0); for (const sx of [-0.5, 0.5]) b(0.07, 0.42, 0.28, matBois, sx, 0.21, 0); }
    else if (type === 'bloc') { b(0.62, 0.42, 0.42, matPierre, 0, 0.21, 0); b(0.5, 0.32, 0.36, matPierre, 0.85, 0.16, 0.25); }
    else if (type === 'enclume') { b(0.36, 0.5, 0.36, matBois, 0, 0.25, 0); b(0.42, 0.12, 0.16, matFer, 0, 0.56, 0); b(0.22, 0.06, 0.1, matFer, 0.28, 0.58, 0); }
    g.position.copy(V(x, y, hauteurSol(x, y))); g.rotation.y = cap; groupeMeubles.add(g);
  }
  const libreSur = (a, b) => dansLePasse(() => { const L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.ceil(L / 0.4); for (let i = 1; i < n; i++) { if (Math.min(i, n - i) * L / n < 0.5) continue; const x = a[0] + (b[0] - a[0]) * i / n, y = a[1] + (b[1] - a[1]) * i / n; if (bloque(x, y)) return false; } return true; });
  const capVers = (dx, dy) => Math.atan2(dx, -dy);
  function routineDe(id, base) {
    const R = ROUTINES[id]; if (!R) return null;
    const postes = [];
    for (const s of R.postes) {
      const prec = postes.length ? postes[postes.length - 1] : null;
      let xy = null;
      if (s.a === 'base') xy = base;
      else if (s.a && s.a.arche != null) xy = GAL.pt(GAL.sArches[Math.min(s.a.arche, GAL.sArches.length - 1)], s.a.d ?? 1.9);
      else if (s.a === 'puits') { const d = [base[0] - PUITS[0], base[1] - PUITS[1]], L = Math.hypot(d[0], d[1]) || 1; xy = [PUITS[0] + d[0] / L * 1.3, PUITS[1] + d[1] / L * 1.3]; }
      else if (Array.isArray(s.a)) for (const o of [s.a, ...(s.ou || []), [-s.a[0], s.a[1]], [s.a[0], -s.a[1]], [-s.a[0], -s.a[1]]]) {   // place voulue, sinon d'autres côtés
        const c = placeLibre(base[0] + o[0], base[1] + o[1]);
        if (!dansLePasse(() => bloque(c[0], c[1])) && (!prec || libreSur([prec.x, prec.y], c)) && libreSur(c, postes.length ? [postes[0].x, postes[0].y] : base)) { xy = c; break; }
      }
      if (!xy || (prec && !libreSur([prec.x, prec.y], xy))) continue;
      let cap = null, cible = null;
      if (s.vers === 'puits') cible = PUITS;
      else if (s.vers === 'colombier') cible = COLOMBIER.c;
      else if (Array.isArray(s.vers)) cible = [xy[0] + s.vers[0], xy[1] + s.vers[1]];
      if (cible) cap = capVers(cible[0] - xy[0], cible[1] - xy[1]);
      if (s.objet) {
        if (cap == null) cap = (Math.random() - 0.5) * 6;
        const f = [Math.sin(cap), -Math.cos(cap)];            // devant lui (repère de la carte)
        if (s.objet === 'banc') meuble('banc', xy[0] - f[0] * 0.12, xy[1] - f[1] * 0.12, cap);
        else meuble(s.objet, xy[0] + f[0] * 0.78, xy[1] + f[1] * 0.78, cap);
      }
      postes.push({ ...s, x: xy[0], y: xy[1], cap });
    }
    if (postes.length > 1 && !libreSur([postes[postes.length - 1].x, postes[postes.length - 1].y], [postes[0].x, postes[0].y])) postes.length = 1;
    return { trajet: R.trajet || 'marcher', postes };
  }
  JEU.chargerVivants = () => {
    if (VIV.etat !== 'attente') return; VIV.etat = 'charge';
    annoncer('Les habitants de 1435 arrivent…');
    const habitants = [
      ...JEU.pnj.map((p) => ({ id: p.id, desc: { ...p.studio, objetMarche: (ROUTINES[p.id] || {}).objetMarche }, act: p.activite, objet: p.g, routine: routineDe(p.id, [p.x, p.y]) })),
      ...figurants.map((f) => ({ id: f.id, desc: f.studio, act: f.activite, objet: f.g, routine: f.activite.marche ? null : routineDe(f.id, [f.g.position.x, -f.g.position.z]) })),
    ];
    JEU.routines = Object.fromEntries(habitants.map((h) => [h.id, h.routine]));
    chargerVivants({ groupeBetes, betes: BETES, habitants, sol: (x, y) => hauteurSol(x, y), libre: (x, y) => dansLePasse(() => !bloque(x, y)) && !planchers.some((p) => Math.hypot(x - p.c[0], y - p.c[1]) < p.r + 0.5) })
      .then((m) => {
        VIV.module = m; VIV.etat = 'pret';
        for (const a of JEU.animaux) a.g.visible = false;
        for (const h of m.habitants) { const p = JEU.pnj.find((q) => q.id === h.id); if (p) { p.g.children.forEach((c) => { if (c !== h.racine) c.visible = false; }); p.studio3d = h; } }
        annoncer('Les habitants et les bêtes du château sont arrivés.');
      })
      .catch((e) => { console.warn('vivants', e); VIV.etat = 'echec'; });
  };
  const v3 = new THREE.Vector3();
  JEU.maj = (dt) => {
    JEU.t += dt; matBrume.uniforms.temps.value = JEU.t;
    if (finAnnonce && JEU.t > finAnnonce) { finAnnonce = 0; if (epoque !== 'medieval') $('bandeau').style.display = 'none'; }
    if (!ancien()) { for (const p of JEU.pnj) p.el.style.display = 'none'; return; }
    if (VIV.module) {
      VIV.module.maj(dt, JEU.dialogue && JEU.dialogue.p ? { id: JEU.dialogue.p.id, tour: JEU.dialogue.tour } : null, mode === 'pied' ? marcheur : null);
      for (const p of JEU.pnj) if (p.studio3d && p.studio3d.routine) { p.x = p.studio3d.x; p.y = p.studio3d.y; }
    }
    else for (const a of JEU.animaux) {
      const th = a.ph + JEU.t * a.v, r = a.r * (0.55 + 0.45 * Math.sin(JEU.t * 0.13 + a.ph * 2)), x = a.c[0] + Math.cos(th) * r, y = a.c[1] + Math.sin(th) * r;
      a.g.position.copy(V(x, y, hauteurTerrain(x, y))); a.g.rotation.y = Math.atan2(-Math.sin(th) * Math.sign(a.v), -Math.cos(th) * Math.sign(a.v)) ;
      if (a.g.userData.tete && (a.type === 'poule' || a.type === 'coq')) a.g.userData.tete.position.y = 0.36 - Math.max(0, Math.sin(JEU.t * 2.2 + a.ph * 5)) * 0.2;
    }
    if (VIV.module) {   // regard : les habitants proches suivent le voyageur des yeux et de la tête (vie du Studio)
      for (const H of VIV.module.habitants) {
        H.objet.getWorldPosition(v3); const d = Math.hypot(marcheur.x - v3.x, marcheur.y + v3.z);
        const parle = JEU.dialogue && JEU.dialogue.p && JEU.dialogue.p.id === H.id;
        VIV.module.regarder(H.id, mode === 'pied' && (d < 7 || parle) ? camera.position : null);
      }
    }
    if (epoque !== 'jeu') { for (const p of JEU.pnj) p.el.style.display = 'none'; return; }
    let proche = null, dMin = 3.4;
    for (const p of JEU.pnj) {
      const d = Math.hypot(marcheur.x - p.x, marcheur.y - p.y);
      if (!p.studio3d) { p.g.userData.tete.rotation.x = Math.sin(JEU.t * 0.9 + p.ph) * 0.05; p.g.position.y = hauteurSol(p.x, p.y) + Math.abs(Math.sin(JEU.t * 1.1 + p.ph)) * 0.012; }
      if (mode === 'pied' && (p.studio3d ? (d < 2.4 || (JEU.dialogue && JEU.dialogue.p === p)) : d < 9)) { const cibleRot = Math.atan2(marcheur.x - p.x, -(marcheur.y - p.y) * -1 * -1); let dr = cibleRot - p.g.rotation.y; dr = Math.atan2(Math.sin(dr), Math.cos(dr)); p.g.rotation.y += dr * Math.min(1, dt * 4); }
      if (mode === 'pied' && d < dMin) { dMin = d; proche = p; }
      v3.copy(V(p.x, p.y, hauteurSol(p.x, p.y) + 2.15)).project(camera);
      const vis = v3.z < 1 && Math.abs(v3.x) < 1.05 && Math.abs(v3.y) < 1.05 && camera.position.distanceTo(p.g.position) < (mode === 'pied' ? 38 : 400);
      p.el.style.display = vis ? 'flex' : 'none';
      if (vis) { p.el.style.left = ((v3.x + 1) / 2 * innerWidth) + 'px'; p.el.style.top = ((1 - v3.y) / 2 * innerHeight) + 'px'; p.el.classList.toggle('pres', d < 9); }
    }
    cible = proche;
    if (mode === 'pied' && nbSceaux() === PERSONNAGES.length && Math.hypot(marcheur.x - PUITS[0], marcheur.y - PUITS[1]) < 3.2) cible = 'puits';
    if (cible && !JEU.dialogue) { invite.textContent = cible === 'puits' ? 'E · Se pencher au-dessus du puits' : `E · Parler à ${cible.nom}`; invite.style.display = 'block'; } else invite.style.display = 'none';
    const dB = Math.hypot(marcheur.x - CENTRE_BROUILLARD[0], marcheur.y - CENTRE_BROUILLARD[1]);
    voile.style.opacity = mode === 'pied' ? clamp((dB - (RAYON_BROUILLARD - 16)) / 16, 0, 0.92) : 0;
    if (JEU.repousse > 0) { JEU.repousse -= dt; if (!finAnnonce) annoncer('Le brouillard se referme devant toi et te repousse doucement vers le château…'); }
  };
  // portrait vivant : rendu de la tête du personnage dans un coin du canevas, copié dans le cadre, avant le rendu de la scène
  const camPortrait = new THREE.PerspectiveCamera(24, D.lui.width / D.lui.height, 0.05, 60), ctxLui = D.lui.getContext('2d'), tmpP = new THREE.Vector3(), tmpF = new THREE.Vector3();
  JEU.portrait = () => {
    const J = JEU.dialogue; if (!J || !J.p || J.peint) return;
    J.portrait -= 1; if (J.portrait > 0) return; J.portrait = 3;
    const p = J.p, h = p.studio3d;
    if (h) { h.os.get('Head').getWorldPosition(tmpP); tmpP.y += 0.1; } else { p.g.userData.tete.getWorldPosition(tmpP); tmpP.y += 0.03; }
    p.g.getWorldDirection(tmpF); tmpF.y = 0; tmpF.normalize();
    camPortrait.position.copy(tmpP).addScaledVector(tmpF, 0.95).add(new THREE.Vector3(0, 0.04, 0)); camPortrait.lookAt(tmpP.x, tmpP.y - 0.06, tmpP.z);
    const w = D.lui.width, hh = D.lui.height, pr = renderer.getPixelRatio(), H = renderer.domElement.height;
    renderer.setScissorTest(true); renderer.setScissor(0, 0, w / pr, hh / pr); renderer.setViewport(0, 0, w / pr, hh / pr);
    const su = renderer.shadowMap.autoUpdate; renderer.shadowMap.autoUpdate = false;
    renderer.render(scene, camPortrait);
    renderer.shadowMap.autoUpdate = su;
    ctxLui.drawImage(renderer.domElement, 0, H - hh, w, hh, 0, 0, w, hh);
    renderer.setScissorTest(false); renderer.setViewport(0, 0, innerWidth, innerHeight);
  };
  majCarnet();
}
function lancerJeu() { window.lancerJeuInterne(); }
function quitterJeu() { window.quitterJeuInterne(); }

// accès direct par ancre (#visite, #moyen-age, #jeu) et API de test
window.oricourt = { MUSIQUE, renderer, scene, camera, orbite, G, LIEUX, choisir, changerEpoque, passerEnModePied, passerEnModeSurvol, placerMarcheur, marcheur, hauteurSol, data, bloque, marcher, touches, JEU, lancerJeu, THREE };
if (location.hash === '#moyen-age') changerEpoque('medieval');
if (location.hash === '#jeu') lancerJeu();
if (location.hash === '#visite') { placerMarcheur([-12, -14, 14]); passerEnModePied(); }
majAide();
etat('Prêt', 1);
$('chargement').style.display = 'none';
requestAnimationFrame(boucle);
