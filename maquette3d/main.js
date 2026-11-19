// Oricourt — maquette 3D v0
// Géométrie : relevé IGN LiDAR HD (MNT/MNS/MNH 0,5 m) + BD TOPO V3, extraits par scripts/prep.py.
// Repère local : x = est, y = nord, z = haut (m), origine = haute-cour (340 m NGF).
// Repère three.js : X = x, Y = z, Z = -y.
import * as THREE from 'three';
import { OrbitControls } from './lib/OrbitControls.js';
import { mergeGeometries } from './lib/BufferGeometryUtils.js';
import { INTRO, FIN, PERSONNAGES, ANIMAUX, BETES, FIGURANTS, ROUTINES, MASURES, CENTRE_BROUILLARD, RAYON_BROUILLARD, DEPART, TRESORS, EXPERTISES, BAREME, RANGS, OEUVRE } from './jeu_donnees.js';
import { fabriquer, etincelle } from './objets_jeu.js';
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
const planchers = [];   // {c:[x,y], r, z} ou {poly, z, medieval} : sols intérieurs plans
const ETAGES = [];        // surfaces praticables en hauteur (époque médiévale) : plan, rampe, ruban, vis
const EPOQUE = { ancienne: false };
const surPlancher = (x, y, marge = 0) => planchers.some((p) => (p.poly ? dedansPoly(x, y, p.poly) : Math.hypot(x - p.c[0], y - p.c[1]) < p.r + marge));   // tenu à jour par changerEpoque (utilisable pendant la construction)
function hauteurSol(x, y) {
  for (const p of planchers) if (p.poly ? (!p.medieval || EPOQUE.ancienne) && dedansPoly(x, y, p.poly) : Math.hypot(x - p.c[0], y - p.c[1]) < p.r) return p.z;
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
const hemi = new THREE.HemisphereLight(0xdfe3ea, 0x6a6238, 0.6);
scene.add(hemi);
{ // environnement lumineux (ciel clair au-dessus, sol herbeux au-dessous) : un éclairage diffus plus naturel des pierres
  const env = new THREE.Scene(), g = new THREE.SphereGeometry(10, 32, 16), col = [], pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) { const y = pos.getY(i) / 10, c = y > 0 ? new THREE.Color(0xbfd2ea).lerp(new THREE.Color(0xf4efe4), 1 - y) : new THREE.Color(0x8a8458).lerp(new THREE.Color(0x4e5a2c), -y); col.push(c.r, c.g, c.b); }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  env.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(env, 0.02).texture; scene.environmentIntensity = 0.45; pm.dispose();
}
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
const dansTourelle = (p) => Math.hypot(p[0] - 13.6, p[1] + 9.6) < 2.5;   // la tourelle d'escalier est comprise dans le contour du logis
function construireBatiment(b) {
  const groupe = b.groupe === 'village' || ROLES_TOUR.has(b.role) || b.role === 'logis_rolin' ? G.actuel : G.commun;
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
    if (b.role === 'logis_rolin' && dansTourelle(a) && dansTourelle(c)) { s += L; continue; }
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
  const cible = b.groupe === 'village' || ROLES_TOUR.has(b.role) ? OUV.actuel : OUV.commun;   // les tours de 1435 sont reconstruites : leurs baies d'aujourd'hui n'y sont pas
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
  Object.assign(SALLE, { sol: zs, centre: P((s0 + s1) / 2, d0 + W / 2), entree: P(sPorte, d0 + 1.2), long: s1 - s0, larg: W });
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
    const mfac = maille(geoF.geometrie(), matPhoto(phFac, 8.73, 7.3, z0), false); G.actuel.add(mfac);   // façade du XVe s. finissant : absente en 1435
  }
  // pignon sud, près de la porte de la haute-cour
  face([13.6, -12.0], [18.6, -17.4], [[4.2, 5.2, 0.8, 'fenetre'], [3.0, 1.4, 0.6, 'fenetre']]);
  // tourelle d'escalier : porte vers le sud-ouest, petits jours
  { const c = [13.6, -9.6], d = TOURELLE.d, t = [d[1], -d[0]], r = TOURELLE.apo + 0.02;
    const zs = hauteurTerrain(c[0] + d[0] * 3, c[1] + d[1] * 3);
    // porte ouverte : le vantail est rabattu contre le mur intérieur
    const porte = maille(new THREE.BoxGeometry(0.86, 1.95, 0.06), new THREE.MeshStandardMaterial({ color: 0x7c2f24, roughness: 0.8 }), false);
    const ch = [c[0] + d[0] * (TOURELLE.apo - 0.5) + t[0] * 0.52, c[1] + d[1] * (TOURELLE.apo - 0.5) + t[1] * 0.52];
    porte.position.copy(V(ch[0] - d[0] * 0.45, ch[1] - d[1] * 0.45, zs + 1.0)); porte.rotation.y = Math.atan2(d[1], d[0]); G.commun.add(porte);
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
const RONDES = [];          // courtines de la haute-cour dont le sommet porte un chemin de ronde (passé)
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
        // merlons côté extérieur, tous les 2,4 m, posés sur le parapet (allège d'un mètre)
        for (let s = s0 + 0.8; s < s1 - 0.6; s += 2.4) {
          const p = auPoint(pts, s), q = auPoint(pts, Math.min(total, s + 0.3));
          const dx = q.x - p.x, dy = q.y - p.y, Ld = Math.hypot(dx, dy) || 1;
          let nx = -dy / Ld, ny = dx / Ld;
          if ((p.x - CENTRE_HC[0]) * nx + (p.y - CENTRE_HC[1]) * ny < 0) { nx = -nx; ny = -ny; }
          const off = w.epaisseur / 2 - 0.31;
          merlonsMed.push({ x: p.x + nx * off, y: p.y + ny * off, z: hautFn(p) + 1.7, ang: Math.atan2(dy, dx) });
        }
      }
    }
    if (mode === 'medieval' && hc) RONDES.push({ w, pts, hautFn });
  }
  const mm = maille(geo.geometrie(), M.courtine); groupe.add(mm); occultants.push(mm);
}
construireMurs('actuel');
construireMurs('medieval');

// tourelle d'escalier du logis Rolin (cône relevé au LiDAR vers +14 à +15 m) : huit pans maçonnés, creuse,
// porte ouverte au sud-sud-ouest et passage vers la chapelle (deux pans plus loin)
function tourelleEscalier(zE, hCone, groupe) {
  const c = [13.6, -9.6], z0 = hauteurSol(...c) - 1, RT = TOURELLE.r, ep = 0.45, d = TOURELLE.d, phi0 = Math.atan2(d[1], d[0]);
  const zs = hauteurTerrain(c[0] + d[0] * 3, c[1] + d[1] * 3) + 0.02, am = TOURELLE.apo - ep / 2, hl = TOURELLE.apo * Math.tan(Math.PI / 8);
  for (let k = 0; k < 8; k++) {
    const f = phi0 + k * Math.PI / 4, m = [c[0] + Math.cos(f) * am, c[1] + Math.sin(f) * am], t = [-Math.sin(f), Math.cos(f)];
    const trous = k === 0 ? [{ u: hl, w: 1.0, zb: zs, h: 2.2, arc: true }] : k === 2 ? [{ u: hl, w: 0.95, zb: TOURELLE.zPalier, h: 2.2, arc: true }] : [];
    murPerce([m[0] - t[0] * hl, m[1] - t[1] * hl], [m[0] + t[0] * hl, m[1] + t[1] * hl], ep, z0, zE, trous, M.logis, groupe);
  }
  const rot = Math.atan2(d[0], -d[1]) - Math.PI / 8;
  let cone = new THREE.ConeGeometry(RT + 0.4, hCone, 8, 1, true); cone.translate(0, zE + hCone / 2, 0);
  const uc = cone.attributes.uv; for (let i = 0; i < uc.count; i++) uc.setXY(i, uc.getX(i) * 2 * Math.PI * (RT + 0.4), uc.getY(i) * (hCone + 0.5));
  cone = cone.toNonIndexed(); cone.rotateY(rot); cone.computeVertexNormals();
  const mc = maille(cone, M.tuiles); mc.position.set(c[0], 0, -c[1]); groupe.add(mc);
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
// ================================================================== restitution de 1435 (19 novembre)
// Hypothèses de travail à valider sur place (voir LISEZMOI) : tours creuses, salles au niveau des chemins de ronde,
// escaliers en vis et échelles de meunier ; hourds de bois au sommet des tours et du donjon ; donjon (actuel logis
// Rolin) monté à 20 m ; tourelle sud-ouest à encorbellement et terrasse crénelée ; chapelle ; porte à herse.
const tours = Object.fromEntries(data.batiments.filter((b) => ROLES_TOUR.has(b.role)).map((b) => [b.role, b]));
const RECON = { lumieres: [] };
const axe2 = (a, b) => { const L = Math.hypot(b[0] - a[0], b[1] - a[1]); return { L, t: [(b[0] - a[0]) / L, (b[1] - a[1]) / L] }; };
const centre4 = (R) => [R.reduce((q, p) => q + p[0], 0) / R.length, R.reduce((q, p) => q + p[1], 0) / R.length];

// planches des hourds : lames verticales, joints sombres et fentes de tir
const texHourd = (() => {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256; const x = c.getContext('2d');
  for (let i = 0; i < 8; i++) { const v = 120 + ((i * 37) % 40); x.fillStyle = `rgb(${v},${v * 0.78 | 0},${v * 0.55 | 0})`; x.fillRect(i * 32, 0, 32, 256); x.fillStyle = 'rgba(30,20,12,0.85)'; x.fillRect(i * 32, 0, 2, 256); }
  for (let k = 0; k < 600; k++) { x.fillStyle = `rgba(40,28,16,${0.08 + (k % 5) * 0.03})`; x.fillRect((k * 53) % 256, (k * 97) % 256, 1, 6 + k % 14); }
  x.fillStyle = '#120c07'; x.fillRect(110, 70, 10, 90);   // fente de tir
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso; return t;
})();
M.hourd = new THREE.MeshStandardMaterial({ map: texHourd, roughness: 0.9, color: 0xe6d8c4 });
M.marches = new THREE.MeshStandardMaterial({ map: moA, normalMap: moN, color: 0xd9d2c2, roughness: 0.95 });
M.hourdDos = new THREE.MeshStandardMaterial({ map: texHourd, roughness: 0.9, color: 0x9a8a74, side: THREE.BackSide });
const SALLES_TOURS = [];   // { R, z } : pour raccorder les chemins de ronde au sol des salles

/** Coordonnées de texture « au mètre » (projection selon la normale dominante) pour les géométries assemblées. */
function uvMonde(g) {
  if (g.index) g = g.toNonIndexed();
  g.computeVertexNormals();
  const p = g.attributes.position, n = g.attributes.normal, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    const [u, v] = ay >= ax && ay >= az ? [p.getX(i), p.getZ(i)] : ax >= az ? [p.getZ(i), p.getY(i)] : [p.getX(i), p.getY(i)];
    uv[i * 2] = u; uv[i * 2 + 1] = v;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); return g;
}
/** Mur droit percé (portes, baies) : a → b sur la ligne médiane du mur, de z0 à z1. trous : { u, w, zb, h, arc } */
function murPerce(a, b, ep, z0, z1, trous, mat, groupe, profil = null) {
  const { L, t } = axe2(a, b), forme = new THREE.Shape();
  if (profil) { forme.moveTo(...profil[0]); for (const q of profil.slice(1)) forme.lineTo(...q); forme.lineTo(...profil[0]); }   // profil : [[u, z], ...]
  else { forme.moveTo(0, z0); forme.lineTo(L, z0); forme.lineTo(L, z1); forme.lineTo(0, z1); forme.lineTo(0, z0); }
  for (const T of trous) {
    const tr = new THREE.Path(), x0 = T.u - T.w / 2, x1 = T.u + T.w / 2, zh = T.zb + T.h;
    tr.moveTo(x0, T.zb); tr.lineTo(x1, T.zb);
    if (T.arc) { tr.lineTo(x1, zh - T.w / 2); tr.absarc(T.u, zh - T.w / 2, T.w / 2, 0, Math.PI, false); } else { tr.lineTo(x1, zh); tr.lineTo(x0, zh); }
    tr.lineTo(x0, T.zb); forme.holes.push(tr);
  }
  const g = new THREE.ExtrudeGeometry(forme, { depth: ep, bevelEnabled: false, curveSegments: 10 }); g.translate(0, 0, -ep / 2);
  const ax = new THREE.Vector3(t[0], 0, -t[1]), ay = new THREE.Vector3(0, 1, 0), az = new THREE.Vector3().crossVectors(ax, ay);
  g.applyMatrix4(new THREE.Matrix4().makeBasis(ax, ay, az).setPosition(a[0], 0, -a[1]));
  const m = maille(g, mat); groupe.add(m); occultants.push(m); return m;
}
/** Dalle plane d'un polygone (trous éventuels) à la hauteur z, épaisseur e. */
function dalle(poly, z, e, mat, groupe, trous = []) {
  const f = new THREE.Shape(poly.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const h of trous) f.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
  const g = new THREE.ExtrudeGeometry(f, { depth: e, bevelEnabled: false }); g.rotateX(-Math.PI / 2); g.translate(0, z - e, 0);
  const m = maille(g, mat); groupe.add(m); return m;
}
/** Décalage d'un polygone (coins en onglet) : d > 0 vers l'extérieur. */
function decaler(poly, d) {
  let aire = 0; for (let k = 0; k < poly.length; k++) { const p = poly[k], q = poly[(k + 1) % poly.length]; aire += p[0] * q[1] - q[0] * p[1]; }
  const sg = aire > 0 ? 1 : -1, n = poly.length;
  return poly.map((p, k) => {
    const a = poly[(k - 1 + n) % n], c = poly[(k + 1) % n];
    const t1 = axe2(a, p).t, t2 = axe2(p, c).t, n1 = [t1[1] * sg, -t1[0] * sg], n2 = [t2[1] * sg, -t2[0] * sg];
    const bx = n1[0] + n2[0], by = n1[1] + n2[1], Lb = Math.hypot(bx, by) || 1, cosm = (bx * n1[0] + by * n1[1]) / Lb;
    const f = d / Math.max(0.4, cosm);
    return [p[0] + bx / Lb * f, p[1] + by / Lb * f];
  });
}
/** Croisement d'une ligne brisée avec un polygone : premier point d'entrée et côté traversé. */
function croisement(pts, poly) {
  for (let i = 0; i < pts.length - 1; i++) for (let k = 0; k < poly.length; k++) {
    const p = [pts[i].x, pts[i].y], r = [pts[i + 1].x - p[0], pts[i + 1].y - p[1]], q = poly[k], s2 = [poly[(k + 1) % poly.length][0] - q[0], poly[(k + 1) % poly.length][1] - q[1]];
    const den = r[0] * s2[1] - r[1] * s2[0]; if (Math.abs(den) < 1e-9) continue;
    const t = ((q[0] - p[0]) * s2[1] - (q[1] - p[1]) * s2[0]) / den, u = ((q[0] - p[0]) * r[1] - (q[1] - p[1]) * r[0]) / den;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return { P: [p[0] + r[0] * t, p[1] + r[1] * t], k, u };
  }
  return null;
}
/** Hourds : galerie de bois en surplomb sur consoles, couverte par le toit. poly : couronnement du mur. */
function hourds(poly, z, saillie, groupe) {
  const ext = decaler(poly, saillie), n = poly.length, haut = 2.3;
  for (let k = 0; k < n; k++) {
    const a = poly[k], b = poly[(k + 1) % n], A = ext[k], B = ext[(k + 1) % n], { L, t } = axe2(A, B);
    // paroi de planches
    const g = new Geo();
    g.quad(V(A[0], A[1], z), V(B[0], B[1], z), V(B[0], B[1], z + haut), V(A[0], A[1], z + haut), [0, 0], [L / 2, 0], [L / 2, haut / 2], [0, haut / 2]);
    groupe.add(maille(g.geometrie(), M.hourd));
    const g2 = new Geo(); g2.quad(V(A[0], A[1], z), V(B[0], B[1], z), V(B[0], B[1], z + haut), V(A[0], A[1], z + haut), [0, 0], [L / 2, 0], [L / 2, haut / 2], [0, haut / 2]);
    groupe.add(maille(g2.geometrie(), M.hourdDos));
    // plancher en surplomb et consoles (poutres passant dans les trous de boulins)
    const pl = new Geo(); pl.quad(V(a[0], a[1], z), V(b[0], b[1], z), V(B[0], B[1], z), V(A[0], A[1], z), [0, 0], [L, 0], [L, saillie], [0, saillie], new THREE.Vector3(0, 1, 0));
    groupe.add(maille(pl.geometrie(), M.bois));
    const pl2 = new Geo(); pl2.quad(V(a[0], a[1], z - 0.06), V(b[0], b[1], z - 0.06), V(B[0], B[1], z - 0.06), V(A[0], A[1], z - 0.06), [0, 0], [L, 0], [L, saillie], [0, saillie], new THREE.Vector3(0, -1, 0));
    groupe.add(maille(pl2.geometrie(), M.bois));
    const { L: Lm, t: tm } = axe2(a, b), no0 = [A[0] - a[0], A[1] - a[1]];
    let no = [tm[1], -tm[0]]; if (no[0] * no0[0] + no[1] * no0[1] < 0) no = [-no[0], -no[1]];
    for (let u = 1.05; u < Lm - 0.6; u += 1.1) {   // assommoirs : trappes ouvertes dans le plancher pour tirer et jeter à la verticale du mur
      const q0 = [a[0] + tm[0] * (u - 0.2) + no[0] * 0.25, a[1] + tm[1] * (u - 0.2) + no[1] * 0.25], q1 = [a[0] + tm[0] * (u + 0.2) + no[0] * 0.25, a[1] + tm[1] * (u + 0.2) + no[1] * 0.25];
      const q2 = [q1[0] + no[0] * 0.45, q1[1] + no[1] * 0.45], q3 = [q0[0] + no[0] * 0.45, q0[1] + no[1] * 0.45], ga = new Geo();
      ga.quad(V(q0[0], q0[1], z + 0.012), V(q1[0], q1[1], z + 0.012), V(q2[0], q2[1], z + 0.012), V(q3[0], q3[1], z + 0.012), [0, 0], [1, 0], [1, 1], [0, 1], new THREE.Vector3(0, 1, 0));
      groupe.add(maille(ga.geometrie(), M.trou, false));
    }
    for (let u = 0.5; u < Lm - 0.3; u += 1.1) {
      const c = [a[0] + tm[0] * u + no[0] * (saillie - 0.9) / 2, a[1] + tm[1] * u + no[1] * (saillie - 0.9) / 2];
      const po = maille(new THREE.BoxGeometry(0.2, 0.24, saillie + 0.9), M.bois); po.position.copy(V(c[0], c[1], z - 0.2));
      po.rotation.y = Math.atan2(no[0], -no[1]); groupe.add(po);
    }
  }
  return ext;
}
/** Toit en pavillon sur un polygone quelconque (éventail depuis le centre). */
function pavillon(poly, z0, h, mat, groupe) {
  const c = centre4(poly), pos = [], uv = [];
  for (let k = 0; k < poly.length; k++) {
    const a = poly[k], b = poly[(k + 1) % poly.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]), m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const pente = Math.hypot(Math.hypot(c[0] - m[0], c[1] - m[1]), h);
    pos.push(a[0], z0, -a[1], b[0], z0, -b[1], c[0], z0 + h, -c[1]); uv.push(0, 0, L, 0, L / 2, pente);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals();
  const m = maille(g, mat); groupe.add(m); occultants.push(m); return m;
}
/** Escalier en vis autour d'un noyau : marches de pierre + surface praticable. */
function vis(c, ri, ro, z0, z1, a0, groupe, sens = 1, pas = 2.6, nTour = 16) {
  const h = pas / nTour, n = Math.ceil((z1 - z0) / h), geos = [];
  for (let i = 0; i < n; i++) {
    const th = a0 + sens * (i + 0.5) * 2 * Math.PI / nTour, zt = Math.min(z1, z0 + (i + 1) * h), rm = (ri + ro) / 2;
    const gm = new THREE.BoxGeometry(ro - ri, 0.2, (2 * Math.PI * ro / nTour) * 1.05);
    gm.applyMatrix4(new THREE.Matrix4().makeRotationY(th)); gm.translate(c[0] + Math.cos(th) * rm, zt - 0.1, -(c[1] + Math.sin(th) * rm));
    geos.push(gm);
  }
  const noyau = new THREE.CylinderGeometry(ri, ri, z1 - z0 + 2.2, 10); noyau.translate(c[0], (z0 + z1) / 2 + 1.1, -c[1]); geos.push(noyau);
  groupe.add(maille(uvMonde(mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g)))), M.marches));
  ETAGES.push({ type: 'vis', c, ri: ri + 0.12, ro: ro - 0.12, z0, z1, pas, a0, sens });
}
/** Échelle de meunier (escalier raide de bois) de a (bas) à b (haut). */
function echelle(a, b, z0, z1, larg, groupe) {
  const { L, t } = axe2(a, b), nrm = [-t[1], t[0]], nMarches = Math.max(4, Math.round((z1 - z0) / 0.24)), geos = [];
  for (const sg of [-1, 1]) {
    const lim = new THREE.BoxGeometry(0.07, 0.24, Math.hypot(L, z1 - z0) + 0.2);
    lim.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.atan2(z1 - z0, L)));
    lim.applyMatrix4(new THREE.Matrix4().makeRotationY(Math.atan2(t[0], -t[1])));
    lim.translate((a[0] + b[0]) / 2 + nrm[0] * sg * larg / 2, (z0 + z1) / 2, -((a[1] + b[1]) / 2 + nrm[1] * sg * larg / 2)); geos.push(lim);
  }
  for (let i = 1; i <= nMarches; i++) {
    const f = i / nMarches, m = new THREE.BoxGeometry(larg, 0.05, 0.22);
    m.applyMatrix4(new THREE.Matrix4().makeRotationY(Math.atan2(t[0], -t[1]))); m.translate(a[0] + t[0] * L * f, z0 + (z1 - z0) * f - 0.03, -(a[1] + t[1] * L * f)); geos.push(m);
  }
  groupe.add(maille(mergeGeometries(geos.map((g) => g.index ? g.toNonIndexed() : g)), M.bois));
  const d = larg / 2 + 0.1, e = 0.35;
  ETAGES.push({ type: 'rampe', a, b, z0, z1, poly: [[a[0] - t[0] * e + nrm[0] * d, a[1] - t[1] * e + nrm[1] * d], [b[0] + t[0] * e + nrm[0] * d, b[1] + t[1] * e + nrm[1] * d], [b[0] + t[0] * e - nrm[0] * d, b[1] + t[1] * e - nrm[1] * d], [a[0] - t[0] * e - nrm[0] * d, a[1] - t[1] * e - nrm[1] * d]] });
}
const FLAMMES = [];
const texFlamme = (() => { const c = document.createElement('canvas'); c.width = 64; c.height = 128; const x = c.getContext('2d'), g = x.createRadialGradient(32, 84, 2, 32, 76, 46);
  g.addColorStop(0, 'rgba(255,250,220,1)'); g.addColorStop(0.25, 'rgba(255,200,90,0.95)'); g.addColorStop(0.6, 'rgba(240,110,30,0.45)'); g.addColorStop(1, 'rgba(200,60,10,0)');
  x.fillStyle = g; x.beginPath(); x.moveTo(32, 6); x.bezierCurveTo(58, 60, 56, 120, 32, 122); x.bezierCurveTo(8, 120, 6, 60, 32, 6); x.fill(); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
/** Torche murale : support de fer, manche de bois, flamme vacillante. n : direction (plan) vers l'extérieur du mur. */
function torche(x, y, z, n, groupe = G.medieval) {
  const g = new THREE.Group(); g.position.copy(V(x + n[0] * 0.18, y + n[1] * 0.18, z)); groupe.add(g);
  const manche = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.025, 0.55, 6), M.bois); manche.rotation.set(0, 0, 0); manche.position.y = 0.1; g.add(manche);
  const fer = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.22), new THREE.MeshStandardMaterial({ color: 0x2c2a28, metalness: 0.6, roughness: 0.5 })); fer.rotation.y = Math.atan2(n[0], -n[1]); fer.position.copy(V(-n[0] * 0.1, -n[1] * 0.1, 0)); g.add(fer);
  const f = new THREE.Sprite(new THREE.SpriteMaterial({ map: texFlamme, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })); f.scale.set(0.28, 0.5, 1); f.position.y = 0.55; g.add(f);
  FLAMMES.push({ f, ph: Math.random() * 10 }); return g;
}
function lumiere(x, y, z, I = 7, d = 8) { const l = new THREE.PointLight(0xffd6a0, I, d, 1.6); l.position.copy(V(x, y, z)); G.medieval.add(l); RECON.lumieres.push(l); }
/** Rectangle intérieur, côté k du rectangle r : point à u mètres de r[k] vers r[k+1], à d mètres vers l'intérieur. */
const surCote = (r, k, u, d) => { const a = r[k], b = r[(k + 1) % 4], { t } = axe2(a, b), c = centre4(r); let n = [-t[1], t[0]]; const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; if ((c[0] - m[0]) * n[0] + (c[1] - m[1]) * n[1] < 0) n = [-n[0], -n[1]]; return [a[0] + t[0] * u + n[0] * d, a[1] + t[1] * u + n[1] * d]; };

/**
 * Tour creuse. cfg : { b (bâtiment), ep, zH (haut des murs), salle (z du niveau des chemins de ronde), murs: [ids des
 * courtines qui y aboutissent], porteSol: n° du côté percé d'une porte au sol (ou null), toit, encorbellement }.
 */
function tourCreuse(cfg) {
  const b = cfg.b, R = b.rect, ep = cfg.ep, zBas = b.sol - 1.5, inter = rectExpanse(R, -ep), milieu = rectExpanse(R, -ep / 2), grp = G.medieval;
  const zSol = cfg.porteSol != null ? hauteurTerrain(...surCote(R, cfg.porteSol, axe2(R[cfg.porteSol], R[(cfg.porteSol + 1) % 4]).L / 2, -1.2)) + 0.05 : null;
  // portes au niveau de la salle là où arrivent les chemins de ronde
  const trous = [[], [], [], []], portes = [];
  for (const id of cfg.murs) {
    const w = data.murs.find((q) => q.id === id), pts = echantillons(w), n = pts.length;
    // on prolonge la courtine de 1,5 m à chaque bout : certaines s'arrêtent au ras de la tour
    const bout = (i, j) => { const { t } = axe2([pts[j].x, pts[j].y], [pts[i].x, pts[i].y]); return { ...pts[i], x: pts[i].x + t[0] * 1.5, y: pts[i].y + t[1] * 1.5 }; };
    const q0 = bout(0, 1), q1 = bout(n - 1, n - 2); pts.unshift(q0); pts.push(q1);
    const cr = croisement(pts, R) || croisement([...pts].reverse(), R); if (!cr) continue;
    const { L } = axe2(R[cr.k], R[(cr.k + 1) % 4]), u = cr.u * L;
    trous[cr.k].push({ u, w: 1.0, zb: cfg.salle, h: 2.1, arc: true }); portes.push({ k: cr.k, u });
  }
  if (cfg.porteSol != null) { const L = axe2(R[cfg.porteSol], R[(cfg.porteSol + 1) % 4]).L; trous[cfg.porteSol].push({ u: L / 2, w: 1.1, zb: zSol, h: 2.3, arc: true }); }
  const zEnc = cfg.encorbellement;   // hauteur de l'encorbellement (le haut du mur avance de 0,5 m)
  for (let k = 0; k < 4; k++) {
    const a = milieu[k], c = milieu[(k + 1) % 4], { t } = axe2(a, c), A = [a[0] - t[0] * ep / 2, a[1] - t[1] * ep / 2], C = [c[0] + t[0] * ep / 2, c[1] + t[1] * ep / 2];
    if (zEnc) {
      murPerce(A, C, ep, zBas, zEnc, trous[k].filter((T) => T.zb < zEnc), M.tour, grp);
      const R2 = rectExpanse(R, 0.5), m2 = rectExpanse(R2, -(ep + 0.5) / 2), a2 = m2[k], c2 = m2[(k + 1) % 4], t2 = axe2(a2, c2).t, e2 = ep + 0.5;
      murPerce([a2[0] - t2[0] * e2 / 2, a2[1] - t2[1] * e2 / 2], [c2[0] + t2[0] * e2 / 2, c2[1] + t2[1] * e2 / 2], e2, zEnc + 0.55, cfg.zH, trous[k].filter((T) => T.zb >= zEnc).map((T) => ({ ...T, u: T.u + 0.5 })), M.tour, grp);
    } else murPerce(A, C, ep, zBas, cfg.zH, trous[k], M.tour, grp);
  }
  if (zEnc) {   // corniche de l'encorbellement : trois assises en ressaut, 0,5 m en tout
    for (let i = 0; i < 3; i++) { const Ri = rectExpanse(R, 0.17 * (i + 1)); prismeRect(Ri, zEnc + i * 0.18, zEnc + (i + 1) * 0.18 + 0.01, M.tour, grp); }
  }
  // planchers, salles et passages
  const iSalle = rectExpanse(inter, -0.4);
  if (zSol != null) {
    dalle(inter, zSol, 0.3, M.courtine, grp); planchers.push({ poly: inter, z: zSol, medieval: true });
    const k = cfg.porteSol, L = axe2(R[k], R[(k + 1) % 4]).L;
    passages.push({ role: b.role, medieval: true, poly: [surCote(R, k, L / 2 - 0.45, -1.0), surCote(R, k, L / 2 + 0.45, -1.0), surCote(R, k, L / 2 + 0.45, ep + 0.9), surCote(R, k, L / 2 - 0.45, ep + 0.9)] });
    if (!cfg.visPleine) passages.push({ role: b.role, medieval: true, poly: iSalle });
  }
  // escalier en vis occupant toute la largeur de la tour : il part à côté de la porte du sol, tourne dans le sens des
  // aiguilles d'une montre et débouche dans la salle par une trémie (200°) ; le palier garde les deux portes des courtines
  let ouvertureVis = null, tremie = null, visP = null;
  if (cfg.visPleine) {
    const c = centre4(inter), hx = axe2(inter[0], inter[1]).L / 2, hy = axe2(inter[1], inter[2]).L / 2, ro = Math.min(hx, hy) - 0.06;
    const k = cfg.porteSol, L = axe2(R[k], R[(k + 1) % 4]).L, pd = surCote(R, k, L / 2, 0), phiD = Math.atan2(pd[1] - c[1], pd[0] - c[0]);
    // la première marche est juste à côté de la porte (30° plus loin), la dernière débouche à 80° de part et d'autre :
    // nombre de tours = N + 310/360, et le pas reste d'au moins 3,6 m par tour pour garder 2 m de hauteur sous la trémie
    const H = cfg.salle - zSol, N = Math.max(1, Math.floor(H / 3.6 - 310 / 360)), tours2 = N + 310 / 360, pas = H / tours2;
    const phiFin = phiD + 80 * DEG, a0 = phiFin + tours2 * 2 * Math.PI;
    const secteur = (r) => { const out = [c]; for (let i = 0; i <= 20; i++) { const w = phiFin + 200 * DEG * i / 20; out.push([c[0] + Math.cos(w) * r, c[1] + Math.sin(w) * r]); } return out; };
    ouvertureVis = secteur(ro); tremie = secteur(ro + 0.15);
    visP = { c, ro, a0, pas };
  }
  const trappe = cfg.echelle ? (() => { const { a, b: bb } = cfg.echelle, t = axe2(a, bb).t, n = [-t[1], t[0]], e = 0.55; return [[bb[0] - t[0] * 1.2 + n[0] * e, bb[1] - t[1] * 1.2 + n[1] * e], [bb[0] + t[0] * 0.25 + n[0] * e, bb[1] + t[1] * 0.25 + n[1] * e], [bb[0] + t[0] * 0.25 - n[0] * e, bb[1] + t[1] * 0.25 - n[1] * e], [bb[0] - t[0] * 1.2 - n[0] * e, bb[1] - t[1] * 1.2 - n[1] * e]]; })() : null;
  // montée aux hourds : échelles de meunier en volées alternées le long du grand côté, planchers intermédiaires
  const rectSur = (E, u0, u1, e) => { const t = axe2(E.a, E.b).t, n = [-t[1], t[0]], A = [E.a[0] + t[0] * u0, E.a[1] + t[1] * u0], B = [E.b[0] + t[0] * u1, E.b[1] + t[1] * u1]; return [[A[0] + n[0] * e, A[1] + n[1] * e], [B[0] + n[0] * e, B[1] + n[1] * e], [B[0] - n[0] * e, B[1] - n[1] * e], [A[0] - n[0] * e, A[1] - n[1] * e]]; };
  const volees = [];
  if (cfg.montee) {
    const ci = centre4(inter), A01 = axe2(inter[0], inter[1]), A12 = axe2(inter[1], inter[2]);
    const [uL, lL, uC, lC] = A01.L >= A12.L ? [A01.t, A01.L, A12.t, A12.L] : [A12.t, A12.L, A01.t, A01.L];
    const nF = Math.ceil((cfg.zH - cfg.salle) / 3.8), zs = [...Array(nF + 1)].map((_, k) => cfg.salle + (cfg.zH - cfg.salle) * k / nF), run = lL - 1.4, lat0 = lC / 2 - 0.55;
    // côté de la première volée : hors de la trémie de la vis s'il y en a une
    const horsTremie = (q) => !visP || Math.hypot(q[0] - visP.c[0], q[1] - visP.c[1]) > visP.ro + 0.1 || (() => { let w = Math.atan2(q[1] - visP.c[1], q[0] - visP.c[0]) - (visP.a0 - (cfg.salle - zSol) / visP.pas * 2 * Math.PI); w = ((w % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI); return w > 200 * DEG; })();
    let sg = 1; { const b0 = [ci[0] + uC[0] * lat0, ci[1] + uC[1] * lat0]; if (![-1, 1].every((e) => horsTremie([b0[0] + uL[0] * e * run / 2, b0[1] + uL[1] * e * run / 2]))) sg = -1; }
    for (let k = 0; k < nF; k++) {
      const lat = sg * (k % 2 ? -1 : 1) * lat0, dir = k % 2 ? -1 : 1, b0 = [ci[0] + uC[0] * lat, ci[1] + uC[1] * lat];
      volees.push({ a: [b0[0] - uL[0] * dir * run / 2, b0[1] - uL[1] * dir * run / 2], b: [b0[0] + uL[0] * dir * run / 2, b0[1] + uL[1] * dir * run / 2], z0: zs[k], z1: zs[k + 1] });
    }
  }
  // le pied de l'échelle de meunier n'est pas dans le plancher de la salle (sinon on y resterait)
  const piedEchelle = volees.length ? rectSur(volees[0], 0.15, 0.3, 0.5) : cfg.echelle ? (() => { const { a, b: bb } = cfg.echelle, t = axe2(a, bb).t, n = [-t[1], t[0]], e = 0.5; return [[a[0] + t[0] * 0.15 + n[0] * e, a[1] + t[1] * 0.15 + n[1] * e], [bb[0] + t[0] * 0.3 + n[0] * e, bb[1] + t[1] * 0.3 + n[1] * e], [bb[0] + t[0] * 0.3 - n[0] * e, bb[1] + t[1] * 0.3 - n[1] * e], [a[0] + t[0] * 0.15 - n[0] * e, a[1] + t[1] * 0.15 - n[1] * e]]; })() : null;
  dalle(inter, cfg.salle, 0.35, M.bois, grp, ouvertureVis ? [ouvertureVis] : []);
  ETAGES.push({ type: 'plan', poly: iSalle, z: cfg.salle, trous: [tremie, piedEchelle].filter(Boolean) });
  for (const P of portes) {   // seuils : du chemin de ronde à la salle, à travers le mur (jusqu'au nu intérieur)
    ETAGES.push({ type: 'plan', z: cfg.salle, poly: [surCote(R, P.k, P.u - 0.45, -1.2), surCote(R, P.k, P.u + 0.45, -1.2), surCote(R, P.k, P.u + 0.45, ep + 0.45), surCote(R, P.k, P.u - 0.45, ep + 0.45)], trous: [tremie].filter(Boolean) });
  }
  lumiere(...centre4(inter), cfg.salle + 2.3, 6, 7);
  { const k = cfg.porteSol != null ? (cfg.porteSol + 1) % 4 : 1, L = axe2(R[k], R[(k + 1) % 4]).L, q = surCote(R, k, L / 2, ep + 0.02), ci = centre4(inter), dq = Math.hypot(ci[0] - q[0], ci[1] - q[1]);
    torche(q[0], q[1], cfg.salle + 1.5, [(ci[0] - q[0]) / dq, (ci[1] - q[1]) / dq]); }
  if (visP) vis(visP.c, 0.24, visP.ro, zSol, cfg.salle, visP.a0, grp, -1, visP.pas, 18);
  if (cfg.echelle) { echelle(cfg.echelle.a, cfg.echelle.b, cfg.salle, cfg.echelle.z1, 0.8, grp); }
  if (volees.length) {
    volees.forEach((E, k) => {
      echelle(E.a, E.b, E.z0, E.z1, 0.75, grp);
      const tr = rectSur(E, 0.35, 0.2, 0.55), haut = k === volees.length - 1;
      dalle(inter, E.z1, 0.3, M.bois, grp, [tr]);
      if (haut) {   // plancher des hourds : l'intérieur, le dessus des murs et la galerie de bois en surplomb
        ETAGES.push({ type: 'plan', poly: decaler(R, 1.1 - 0.35), z: E.z1, trous: [tr] });
        // pas de torche ici : le bois des hourds et le feu ne font pas bon ménage
      } else ETAGES.push({ type: 'plan', poly: iSalle, z: E.z1, trous: [tr, rectSur(volees[k + 1], 0.15, 0.3, 0.5)] });
    });
  } else {
    dalle(inter, cfg.plafond || cfg.salle + 3.4, 0.35, M.bois, grp, trappe ? [trappe] : []);
    if (!cfg.plafond) dalle(inter, cfg.zH, 0.3, M.bois, grp);   // plancher des hourds
  }
  SALLES_TOURS.push({ R: rectExpanse(R, 2.2), z: cfg.salle, role: b.role, centre: centre4(inter), vis: visP, echelle: cfg.echelle || null, volees, zSol, porte: zSol != null ? surCote(R, cfg.porteSol, axe2(R[cfg.porteSol], R[(cfg.porteSol + 1) % 4]).L / 2, -1.5) : null });
  obstacles.push({ poly: R, village: false, role: b.role, medievalSeulement: true });
  return { inter, zSol };
}

// ---- les trois tours de l'enceinte de la haute-cour
if (tours.tour_maitresse) {   // entrée perchée : on n'y entre que par les chemins de ronde
  const b = tours.tour_maitresse, zH = 19.4;
  tourCreuse({ b, ep: 2.2, zH, salle: 11.45, murs: ['mur_4', 'mur_7'], porteSol: null, montee: true });
  const ext = hourds(b.rect, zH, 1.1, G.medieval);
  pavillon(decaler(ext, 0.3), zH + 2.3, 4.4, M.tuiles, G.medieval);
}
if (tours.tour_ouest) {
  const b = tours.tour_ouest, R = b.rect, zH = 21.5, inter = rectExpanse(R, -1.9);
  // escalier en vis sur toute la largeur ; porte au sol côté haute-cour (est)
  const kEst = [0, 1, 2, 3].sort((i, j) => { const d = (k) => { const m = [(R[k][0] + R[(k + 1) % 4][0]) / 2, (R[k][1] + R[(k + 1) % 4][1]) / 2]; return Math.hypot(m[0] - CENTRE_HC[0], m[1] - CENTRE_HC[1]); }; return d(i) - d(j); })[0];
  tourCreuse({ b, ep: 1.9, zH, salle: 10.8, murs: ['mur_3', 'mur_8'], porteSol: kEst, visPleine: true, montee: true });
  const ext = hourds(R, zH, 1.1, G.medieval);
  pavillon(decaler(ext, 0.3), zH + 2.3, 5.2, M.tuiles, G.medieval);
}
if (tours.tourelle_sud_ouest) {   // encorbellement en pierre au raccord des maçonneries, terrasse crénelée
  const b = tours.tourelle_sud_ouest, R = b.rect, zH = 14.8, zT = 13.7, inter = rectExpanse(R, -0.9);
  const ci = centre4(inter), a = [ci[0] - 0.5, ci[1] - 1.1], bb = [ci[0] - 0.5, ci[1] + 0.95];
  tourCreuse({ b, ep: 0.9, zH, salle: 11.45, murs: ['mur_3', 'mur_4'], porteSol: null, encorbellement: 7.6, echelle: { a, b: bb, z1: zT }, plafond: zT });
  const haut = rectExpanse(R, 0.5);
  { const t = axe2(a, bb).t, n = [-t[1], t[0]], e = 0.55, tr = [[bb[0] - t[0] * 1.2 + n[0] * e, bb[1] - t[1] * 1.2 + n[1] * e], [bb[0] + t[0] * 0.2 + n[0] * e, bb[1] + t[1] * 0.2 + n[1] * e], [bb[0] + t[0] * 0.2 - n[0] * e, bb[1] + t[1] * 0.2 - n[1] * e], [bb[0] - t[0] * 1.2 - n[0] * e, bb[1] - t[1] * 1.2 - n[1] * e]];
    ETAGES.push({ type: 'plan', poly: rectExpanse(inter, -0.35), z: zT, trous: [tr] }); }   // la trappe n'est pas du plancher : on y redescend par l'échelle
  for (let k = 0; k < 4; k++) {   // merlons de la terrasse, sur le parapet
    const p = haut[k], q = haut[(k + 1) % 4], ang = Math.atan2(q[1] - p[1], q[0] - p[0]), cc = centre4(haut);
    for (let t = 0.14; t < 0.95; t += 0.24) { const x = lerp(p[0], q[0], t), y = lerp(p[1], q[1], t), L = Math.hypot(cc[0] - x, cc[1] - y); merlonsMed.push({ x: x + (cc[0] - x) / L * 0.32, y: y + (cc[1] - y) / L * 0.32, z: zH + 0.7, ang, sx: 0.6 }); }
  }
}

// ---- chemins de ronde : parapet d'un mètre côté extérieur, surface praticable côté intérieur, prolongée dans les tours
{
  const geo = new Geo();
  for (const RD of RONDES) {
    const { w, pts, hautFn } = RD;
    const n = pts.length, ext = [], int = [];
    pts.forEach((p, k) => {
      const a = pts[Math.max(0, k - 1)], c = pts[Math.min(n - 1, k + 1)], { t } = axe2([a.x, a.y], [c.x, c.y]);
      let nx = -t[1], ny = t[0]; if ((p.x - CENTRE_HC[0]) * nx + (p.y - CENTRE_HC[1]) * ny < 0) { nx = -nx; ny = -ny; }
      // le parapet ne descend que de 1,5 m sous le chemin de ronde (sinon il fermait la porte de la haute-cour)
      ext.push({ ...p, x: p.x + nx * (w.epaisseur / 2 - 0.25), y: p.y + ny * (w.epaisseur / 2 - 0.25), base: hautFn(p) });
      int.push({ x: p.x - nx * 0.325, y: p.y - ny * 0.325, z: hautFn(p) });   // milieu de la partie libre, entre parapet et bord côté cour
    });
    ruban(ext, 0.5, (p) => hautFn(p) + 1.0, geo, 0.2);
    // prolongement de la surface jusque dans les salles des tours (1,8 m au-delà des bouts)
    const prol = (A, B) => { const { t } = axe2([B.x, B.y], [A.x, A.y]), q = { x: A.x + t[0] * 1.8, y: A.y + t[1] * 1.8, z: A.z }, S = SALLES_TOURS.find((T) => dedansPoly(q.x, q.y, T.R)); if (S) q.z = S.z; return q; };
    RD.int = int.map((q, k) => ({ ...q, s: pts[k].s })); RD.debut = prol(int[0], int[1]); RD.fin = prol(int[n - 1], int[n - 2]);
    ETAGES.push({ type: 'ruban', demi: Math.max(0.3, (w.epaisseur - 0.95) / 2), pts: [RD.debut, ...int, RD.fin] });
  }
  const m = maille(geo.geometrie(), M.courtine); G.medieval.add(m); occultants.push(m);
}
// ---- escalier droit adossé à la courtine sud : de la haute-cour au chemin de ronde
{
  const R = RONDES.find((q) => q.w.id === 'mur_4');
  if (R) {
    const pts = R.pts, haut = auPoint(pts, 4.0), bas = auPoint(pts, 18.5), { t } = axe2([haut.x, haut.y], [bas.x, bas.y]);
    let n = [-t[1], t[0]]; if ((haut.x - CENTRE_HC[0]) * n[0] + (haut.y - CENTRE_HC[1]) * n[1] > 0) n = [-n[0], -n[1]];   // vers la cour
    const d0 = R.w.epaisseur / 2, larg = 1.3, zHaut = R.hautFn(haut), zBas = hauteurSol(bas.x + n[0] * (d0 + 0.6), bas.y + n[1] * (d0 + 0.6)) + 0.02;
    const L = Math.hypot(bas.x - haut.x, bas.y - haut.y), nM = Math.round((zHaut - zBas) / 0.2), geos = [];
    for (let i = 0; i < nM; i++) {
      const f0 = i / nM, f1 = (i + 1) / nM, zt = zBas + (zHaut - zBas) * f1, u0 = L * (1 - f1), u1 = L * (1 - f0);
      const g = new THREE.BoxGeometry(u1 - u0 + 0.02, zt - zBas + 0.6, larg); g.translate((u0 + u1) / 2, (zt + zBas - 0.6) / 2, 0);
      geos.push(g.index ? g.toNonIndexed() : g);
    }
    const geom = mergeGeometries(geos), ax = new THREE.Vector3(t[0], 0, -t[1]), ay = new THREE.Vector3(0, 1, 0), az = new THREE.Vector3().crossVectors(ax, ay);
    const o = [haut.x + n[0] * (d0 + larg / 2), haut.y + n[1] * (d0 + larg / 2)];
    geom.applyMatrix4(new THREE.Matrix4().makeBasis(ax, ay, az).setPosition(o[0], 0, -o[1]));
    // la face latérale se règle sur le bon côté (az pointe vers la cour ou vers le mur : sans effet, la boîte est symétrique)
    const ms = maille(uvMonde(geom), M.marches); G.medieval.add(ms); occultants.push(ms);
    const A = [bas.x + n[0] * (d0 + larg / 2), bas.y + n[1] * (d0 + larg / 2)], B = [haut.x + n[0] * (d0 + larg / 2), haut.y + n[1] * (d0 + larg / 2)];
    const c = (u, d) => [haut.x + t[0] * u + n[0] * d, haut.y + t[1] * u + n[1] * d];
    ETAGES.push({ type: 'rampe', a: A, b: B, z0: zBas, z1: zHaut, poly: [c(-0.4, d0 - 0.35), c(L + 0.5, d0 - 0.35), c(L + 0.5, d0 + larg - 0.1), c(-0.4, d0 + larg - 0.1)] });
    obstacles.push({ poly: [c(-0.2, d0), c(L - 1.6, d0), c(L - 1.6, d0 + larg), c(-0.2, d0 + larg)], village: false, medievalSeulement: true });
    RECON.escalier = { bas: c(L + 0.9, d0 + larg / 2), haut: c(0.6, d0 + 0.2), zHaut };
  }
}

// ---- le donjon (actuel logis Rolin et grande cuisine) : murs montés à 20 m au-dessus de la haute-cour, hourds, toit
const DONJON = { z: 20.5 };
{
  const b = data.batiments.find((q) => q.role === 'logis_rolin'), C = b.contour, n = C.length, base = b.sol - 1.5, murs = new Geo();
  let s = 0;
  for (let k = 0; k < n; k++) {
    const a = C[k], c = C[(k + 1) % n], L = Math.hypot(c[0] - a[0], c[1] - a[1]); if (L < 1e-3) continue;
    if (dansTourelle(a) && dansTourelle(c)) { s += L; continue; }
    const bas = GAL.sur(a) && GAL.sur(c) ? GAL.zHaut : base;
    murs.quad(V(a[0], a[1], bas), V(c[0], c[1], bas), V(c[0], c[1], DONJON.z), V(a[0], a[1], DONJON.z), [s, bas], [s + L, bas], [s + L, DONJON.z], [s, DONJON.z], new THREE.Vector3(c[1] - a[1], 0, c[0] - a[0]));
    s += L;
  }
  const mm = maille(murs.geometrie(), M.logis); G.medieval.add(mm); occultants.push(mm);
  const couronne = simplifier(C);
  dalle(couronne, DONJON.z, 0.4, M.logis, G.medieval);
  const ext = hourds(couronne, DONJON.z, 1.1, G.medieval);
  pavillon(decaler(ext, 0.35), DONJON.z + 2.3, 5.6, M.tuiles, G.medieval);
}
// repère de la chapelle (s le long du mur sud-ouest du donjon, d vers l'intérieur) et hauteurs des sols :
// le sol du donjon est plus haut que la porte de la tourelle, on y monte par quelques marches de la vis
const CH = (() => {
  const A = [13.6, -12.0], B = [18.6, -17.4], { t } = axe2(A, B);
  let nn = [-t[1], t[0]]; if ((20 - A[0]) * nn[0] + (-2 - A[1]) * nn[1] < 0) nn = [-nn[0], -nn[1]];
  const P = (s2, d) => [A[0] + t[0] * s2 + nn[0] * d, A[1] + t[1] * s2 + nn[1] * d], s0 = 0.6, s1 = 6.6, d0 = 1.0, d1 = 5.0;
  let mx = -99; for (let s2 = s0 - 0.6; s2 <= s1; s2 += 0.4) for (let d = d0; d <= d1; d += 0.4) mx = Math.max(mx, hauteurTerrain(...P(s2, d)));
  const c = [13.6, -9.6], dT = TOURELLE.d;
  return { A, t, nn, P, s0, s1, d0, d1, z: mx + 0.06, zEntree: hauteurTerrain(c[0] + dT[0] * 3, c[1] + dT[1] * 3) + 0.03 };
})();
TOURELLE.zPalier = CH.z;
// tourelle d'escalier : celle d'aujourd'hui, et celle de 1435 montée au-dessus du donjon
tourelleEscalier(10.6, 4.9, G.actuel);
tourelleEscalier(DONJON.z + 2.6, 5.2, G.medieval);

// ---- la chapelle, creusée dans le donjon le long du mur sud-ouest ; on y entre par la tourelle d'escalier
// Environ 6 × 4 m, plafond voûté à 5 m, orientée du nord-ouest (entrée) vers le sud-est (autel).
const CHAPELLE = {};
{
  const { t, P, s0, s1, d0, d1 } = CH, c = [13.6, -9.6], dT = TOURELLE.d, zc = CH.z, zE = CH.zEntree;
  const zm = zc + 3.5, zv = zc + 5.0, gc = G.commun;
  Object.assign(CHAPELLE, { P, s0, s1, d0, d1, z: zc, centre: P((s0 + s1) / 2, (d0 + d1) / 2), autel: P(s1 - 0.9, (d0 + d1) / 2) });
  const enduit = new THREE.MeshStandardMaterial({ map: caA, color: 0xf3eadb, roughness: 0.95, side: THREE.DoubleSide });
  const g = new Geo(), up = new THREE.Vector3(0, 1, 0);
  const q = (p0, p1, z0, z1) => { const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]); g.quad(V(p0[0], p0[1], z0), V(p1[0], p1[1], z0), V(p1[0], p1[1], z1), V(p0[0], p0[1], z1), [0, z0], [L, z0], [L, z1], [0, z1]); };
  q(P(s0, d0), P(s1, d0), zc - 0.1, zm); q(P(s0, d1), P(s1, d1), zc - 0.1, zm); q(P(s1, d0), P(s1, d1), zc - 0.1, zm);
  // mur d'entrée (nord-ouest) percé de la porte venant de la tourelle
  const dp0 = 1.75, dp1 = 2.75, hp = 2.2;
  q(P(s0, d0), P(s0, dp0), zc - 0.1, zm); q(P(s0, dp1), P(s0, d1), zc - 0.1, zm); q(P(s0, dp0), P(s0, dp1), zc + hp, zm);
  // voûte en berceau brisé et tympans
  const NV = 8, arc = (k) => { const f = k / NV, cote = f < 0.5 ? 0 : 1, u = cote ? (f - 0.5) * 2 : f * 2; const a = (Math.PI / 2) * u;
    const d = cote === 0 ? d0 + (d1 - d0) / 2 * (1 - Math.cos(a)) : (d0 + d1) / 2 + (d1 - d0) / 2 * Math.sin(a), z = cote === 0 ? zm + (zv - zm) * Math.sin(a) : zv - (zv - zm) * (1 - Math.cos(a)); return [d, z]; };
  for (let k = 0; k < NV; k++) {
    const [da, za] = arc(k), [db, zb] = arc(k + 1), pa0 = P(s0, da), pb0 = P(s0, db), pa1 = P(s1, da), pb1 = P(s1, db);
    g.quad(V(pa0[0], pa0[1], za), V(pa1[0], pa1[1], za), V(pb1[0], pb1[1], zb), V(pb0[0], pb0[1], zb), [0, k], [6, k], [6, k + 1], [0, k + 1]);
    for (const sx of [s0, s1]) { const m = P(sx, (d0 + d1) / 2), pa = P(sx, da), pb = P(sx, db); g.quad(V(m[0], m[1], zm), V(pa[0], pa[1], za), V(pb[0], pb[1], zb), V(m[0], m[1], zm), [0, 0], [1, 0], [1, 1], [0, 1]); }
  }
  gc.add(maille(g.geometrie(), enduit, false));
  // sol dallé, marche de l'autel, autel, nappe, croix et cierges
  dalle([P(s0, d0), P(s1, d0), P(s1, d1), P(s0, d1)], zc, 0.2, M.courtine, gc);
  const pose = (geo, mat, s2, d, z, ombre = true) => { const m = maille(geo, mat, ombre); const p = P(s2, d); m.position.copy(V(p[0], p[1], z)); m.rotation.y = Math.atan2(t[0], -t[1]) + Math.PI / 2; gc.add(m); return m; };
  const dm = (d0 + d1) / 2;
  pose(new THREE.BoxGeometry(1.7, 0.16, 3.6), M.courtine, s1 - 0.85, dm, zc + 0.08);
  pose(uvMonde(new THREE.BoxGeometry(0.9, 1.0, 1.9)), new THREE.MeshStandardMaterial({ map: moA, normalMap: moN, color: 0xe6dccb, roughness: 0.9 }), s1 - 0.55, dm, zc + 0.16 + 0.5);   // autel de pierre
  pose(new THREE.BoxGeometry(0.95, 0.02, 2.0), new THREE.MeshStandardMaterial({ color: 0xf6f2e8, roughness: 0.8 }), s1 - 0.55, dm, zc + 1.17);
  const or = new THREE.MeshStandardMaterial({ color: 0xc9a043, metalness: 0.8, roughness: 0.3 });
  pose(new THREE.BoxGeometry(0.04, 0.55, 0.04), or, s1 - 0.4, dm, zc + 1.45); pose(new THREE.BoxGeometry(0.04, 0.04, 0.3), or, s1 - 0.4, dm, zc + 1.58);
  for (const dd of [-0.7, 0.7]) {
    pose(new THREE.CylinderGeometry(0.03, 0.03, 0.32, 8), new THREE.MeshStandardMaterial({ color: 0xf2ead6, roughness: 0.6 }), s1 - 0.5, dm + dd, zc + 1.34);
    pose(new THREE.SphereGeometry(0.025, 6, 6), new THREE.MeshBasicMaterial({ color: 0xffd27a }), s1 - 0.5, dm + dd, zc + 1.53, false);
  }
  // mobilier : parement d'autel, dossal et grande croix, prie-Dieu, bénitier, ex-voto accrochés au mur nord-est
  {
    const toile = (dessin, w = 128, h = 128) => { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; dessin(cv.getContext('2d'), w, h); const tx = new THREE.CanvasTexture(cv); tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = aniso; return tx; };
    const etoffe = (fond, galon) => toile((x, w, h) => { x.fillStyle = fond; x.fillRect(0, 0, w, h); x.fillStyle = galon; x.fillRect(0, 6, w, 8); x.fillRect(0, h - 14, w, 8); x.fillRect(w / 2 - 4, 14, 8, h - 28);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { x.beginPath(); x.arc(14 + i * 33, 30 + j * 26, 3, 0, 7); x.fill(); } });
    const plan = (w, h, tx, s2, d, z, faceS) => { const m = pose(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tx, roughness: 0.85, side: THREE.DoubleSide }), s2, d, z, false); return m; };
    // parement (devant d'autel) de velours rouge brodé d'or : arcatures, monogramme du Christ, frange ;
    // dossal de soie verte au motif de grenades (dessin courant des étoffes du XVe siècle)
    const parement = toile((x, w, h) => {
      const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#8a2420'); g.addColorStop(1, '#5e1512'); x.fillStyle = g; x.fillRect(0, 0, w, h);
      for (let k = 0; k < 2500; k++) { x.fillStyle = `rgba(${40 + Math.random() * 40 | 0},0,0,0.08)`; x.fillRect(Math.random() * w, Math.random() * h, 1, 3); }   // poil du velours
      const or = (a) => `rgba(214,170,74,${a})`; x.strokeStyle = or(0.95); x.fillStyle = or(0.95);
      x.lineWidth = 6; x.strokeRect(6, 6, w - 12, h - 30);
      for (let i = 0; i < 5; i++) {   // arcatures gothiques
        const cx = 34 + i * 97, l = 34; x.lineWidth = 3; x.beginPath(); x.moveTo(cx - l, h - 34); x.lineTo(cx - l, 70); x.quadraticCurveTo(cx - l, 30, cx, 22); x.quadraticCurveTo(cx + l, 30, cx + l, 70); x.lineTo(cx + l, h - 34); x.stroke();
        if (i !== 2) { x.beginPath(); x.moveTo(cx, 60); for (let q = 0; q < 6; q++) { const an = q * Math.PI / 3; x.lineTo(cx + Math.cos(an) * 14, 90 + Math.sin(an) * 14); } x.stroke(); x.beginPath(); x.arc(cx, 90, 5, 0, 7); x.fill();
          for (const yy of [140, 175, 205]) { x.beginPath(); x.arc(cx, yy, 4, 0, 7); x.fill(); } }
      }
      x.beginPath(); x.arc(w / 2, 115, 46, 0, 7); x.lineWidth = 4; x.stroke();   // médaillon central : IHS
      x.font = 'bold 40px Georgia, serif'; x.textAlign = 'center'; x.fillText('IHS', w / 2, 130);
      for (let fx = 4; fx < w; fx += 6) { x.fillStyle = or(0.9 - (fx % 12 ? 0.2 : 0)); x.fillRect(fx, h - 24, 3, 20); }   // frange
    }, 512, 256);
    const dossal = toile((x, w, h) => {
      x.fillStyle = '#25412f'; x.fillRect(0, 0, w, h);
      for (let j = 0; j < 3; j++) for (let i = 0; i < 4; i++) {
        const cx = 32 + i * 64 + (j % 2) * 32, cy = 40 + j * 80;
        x.strokeStyle = 'rgba(205,165,80,0.9)'; x.lineWidth = 2.5; x.beginPath(); x.ellipse(cx, cy, 22, 30, 0, 0, 7); x.stroke();
        x.fillStyle = 'rgba(205,165,80,0.85)'; x.beginPath(); x.moveTo(cx, cy - 18); x.bezierCurveTo(cx + 15, cy - 10, cx + 13, cy + 16, cx, cy + 18); x.bezierCurveTo(cx - 13, cy + 16, cx - 15, cy - 10, cx, cy - 18); x.fill();
        x.fillStyle = '#7a2a24'; for (let q = 0; q < 5; q++) { x.beginPath(); x.arc(cx - 6 + (q % 3) * 6, cy - 2 + Math.floor(q / 3) * 8, 2.5, 0, 7); x.fill(); }   // grains de la grenade
      }
      x.fillStyle = 'rgba(205,165,80,0.95)'; x.fillRect(0, 0, w, 8); x.fillRect(0, h - 8, w, 8);
    }, 256, 256);
    pose(new THREE.BoxGeometry(0.015, 0.9, 1.86), new THREE.MeshStandardMaterial({ map: parement, roughness: 0.75 }), s1 - 1.012, dm, zc + 0.16 + 0.47, false);
    { const m = pose(new THREE.BoxGeometry(0.02, 1.25, 2.0), new THREE.MeshStandardMaterial({ map: dossal, roughness: 0.6, metalness: 0.05 }), s1 - 0.02, dm, zc + 1.95, false); }
    // nappe de lin qui retombe sur les côtés, chandeliers de laiton
    const lin = new THREE.MeshStandardMaterial({ color: 0xf4efe2, roughness: 0.85 });
    for (const sd of [-1, 1]) pose(new THREE.BoxGeometry(0.95, 0.5, 0.012), lin, s1 - 0.55, dm + sd * 1.0, zc + 0.95, false);
    const laiton = new THREE.MeshStandardMaterial({ color: 0xb99a4a, metalness: 0.85, roughness: 0.32 });
    for (const dd of [-0.7, 0.7]) { pose(new THREE.CylinderGeometry(0.03, 0.09, 0.08, 12), laiton, s1 - 0.5, dm + dd, zc + 1.21); pose(new THREE.CylinderGeometry(0.018, 0.018, 0.12, 8), laiton, s1 - 0.5, dm + dd, zc + 1.29); }
    // grande croix de bois peint, au-dessus du dossal
    const bois = new THREE.MeshStandardMaterial({ map: M.bois.map, color: 0x6a4a30, roughness: 0.8 });
    pose(new THREE.BoxGeometry(0.1, 2.5, 0.16), bois, s1 - 0.09, dm, zc + 3.15);
    pose(new THREE.BoxGeometry(0.1, 0.16, 1.35), bois, s1 - 0.09, dm, zc + 3.75);
    for (const [z, dd] of [[4.38, 0], [3.75, 0.68], [3.75, -0.68]]) pose(new THREE.BoxGeometry(0.11, 0.2, 0.2), or, s1 - 0.09, dm + dd, zc + z);   // fleurons dorés
    pose(new THREE.BoxGeometry(0.11, 0.2, 0.2), or, s1 - 0.09, dm, zc + 1.95 + 0.04);
    // prie-Dieu de chêne : agenouilloir, montant, accoudoir incliné (tournés vers l'autel)
    const chene = new THREE.MeshStandardMaterial({ map: M.bois.map, color: 0x8a6440, roughness: 0.85 });
    for (const sp of [2.6, 3.9]) for (const dd of [-0.75, 0.75]) {
      pose(new THREE.BoxGeometry(0.32, 0.1, 0.62), chene, sp, dm + dd, zc + 0.05);
      pose(new THREE.BoxGeometry(0.05, 0.86, 0.62), chene, sp + 0.24, dm + dd, zc + 0.43);
      const acc = pose(new THREE.BoxGeometry(0.26, 0.04, 0.66), chene, sp + 0.18, dm + dd, zc + 0.88); acc.rotateZ(0.32);
      for (const sd of [-0.29, 0.29]) pose(new THREE.BoxGeometry(0.3, 0.08, 0.04), chene, sp + 0.05, dm + dd + sd, zc + 0.13);
    }
    // bénitier près de la porte
    const pierre = new THREE.MeshStandardMaterial({ map: moA, color: 0xe2dccd, roughness: 0.9 });
    pose(new THREE.CylinderGeometry(0.07, 0.1, 0.8, 10), pierre, s0 + 0.35, 3.3, zc + 0.4);
    pose(new THREE.CylinderGeometry(0.22, 0.12, 0.16, 14), pierre, s0 + 0.35, 3.3, zc + 0.86);
    pose(new THREE.CircleGeometry(0.18, 14).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x8d9ea6, roughness: 0.1, metalness: 0.2 }), s0 + 0.35, 3.3, zc + 0.93, false);
    // ex-voto : on remercie la Vierge d'une grâce reçue (guérison, accident évité). Au XVe siècle, les plus courants sont de
    // cire, en forme de la partie du corps guérie, suspendus près de l'autel ; quelques petits tableaux peints sur bois.
    const SCENES = ['lit', 'cheval', 'puits', 'incendie'];
    SCENES.forEach((sc, i) => {
      const tx = toile((x, w, h) => {
        // panneau de bois au cadre peint, ciel, sol, la Vierge dans une nuée dorée, le donateur à genoux, la scène, cartouche
        x.fillStyle = ['#8a3a22', '#2f4f6a', '#6a5a2a', '#4a3a5a'][i]; x.fillRect(0, 0, w, h);
        const ciel = x.createLinearGradient(0, 14, 0, h * 0.6); ciel.addColorStop(0, '#6f8fb0'); ciel.addColorStop(1, '#e8dcb8'); x.fillStyle = ciel; x.fillRect(14, 14, w - 28, h - 80);
        x.fillStyle = ['#7d8a52', '#8a7a52', '#6f8a52', '#8a6a4a'][i]; x.fillRect(14, h * 0.55, w - 28, h - 66 - h * 0.55 + 14);
        const g = x.createRadialGradient(w - 64, 58, 4, w - 64, 58, 52); g.addColorStop(0, 'rgba(255,235,160,1)'); g.addColorStop(1, 'rgba(255,235,160,0)'); x.fillStyle = g; x.fillRect(w - 130, 0, 130, 120);
        x.strokeStyle = 'rgba(220,180,80,0.8)'; x.lineWidth = 1.5; for (let q = 0; q < 16; q++) { const an = q * Math.PI / 8; x.beginPath(); x.moveTo(w - 64 + Math.cos(an) * 30, 58 + Math.sin(an) * 30); x.lineTo(w - 64 + Math.cos(an) * 46, 58 + Math.sin(an) * 46); x.stroke(); }
        x.fillStyle = '#f4ecd8'; for (const [ox, oy, r] of [[-26, 80, 16], [0, 86, 18], [24, 80, 15]]) { x.beginPath(); x.arc(w - 64 + ox, oy, r, 0, 7); x.fill(); }
        x.fillStyle = '#28468f'; x.beginPath(); x.moveTo(w - 64, 38); x.quadraticCurveTo(w - 44, 60, w - 46, 82); x.lineTo(w - 82, 82); x.quadraticCurveTo(w - 84, 60, w - 64, 38); x.fill();   // manteau bleu
        x.fillStyle = '#b8323a'; x.fillRect(w - 70, 52, 12, 26);
        x.fillStyle = '#ecc9a2'; x.beginPath(); x.arc(w - 64, 36, 7, 0, 7); x.fill(); x.strokeStyle = '#e0b040'; x.lineWidth = 2.5; x.beginPath(); x.arc(w - 64, 34, 11, 0, 7); x.stroke();
        const gens = (px, py, coul, couche) => { x.fillStyle = coul; if (couche) { x.fillRect(px, py, 34, 9); x.fillStyle = '#ecc9a2'; x.beginPath(); x.arc(px - 3, py + 3, 5, 0, 7); x.fill(); } else { x.fillRect(px - 6, py - 22, 12, 24); x.fillStyle = '#ecc9a2'; x.beginPath(); x.arc(px, py - 27, 5, 0, 7); x.fill(); } };
        if (sc === 'lit') { x.fillStyle = '#5a3a24'; x.fillRect(26, 150, 90, 30); x.fillStyle = '#f2ecdc'; x.fillRect(28, 140, 86, 14); gens(40, 136, '#c8c0b0', true); x.fillStyle = '#7a2a1c'; x.fillRect(26, 108, 8, 72); x.fillRect(110, 108, 8, 72); x.fillRect(26, 104, 92, 8); }
        else if (sc === 'cheval') { x.fillStyle = '#6a4a30'; x.beginPath(); x.ellipse(70, 160, 34, 14, -0.4, 0, 7); x.fill(); x.fillRect(90, 128, 10, 22); x.beginPath(); x.ellipse(98, 124, 12, 7, -0.6, 0, 7); x.fill(); for (const lx of [48, 60, 80, 92]) x.fillRect(lx, 168, 4, 22); gens(40, 196, '#2f5a8a', true); }
        else if (sc === 'puits') { x.fillStyle = '#9a9488'; x.fillRect(46, 140, 54, 40); x.fillStyle = '#3a3630'; x.fillRect(52, 140, 42, 8); x.fillStyle = '#5a3a24'; x.fillRect(48, 96, 5, 46); x.fillRect(93, 96, 5, 46); x.fillRect(46, 94, 54, 5); gens(73, 140, '#b84a2a', false); }
        else { x.fillStyle = '#7a5a3a'; x.fillRect(30, 128, 80, 52); x.fillStyle = '#8a7444'; x.beginPath(); x.moveTo(24, 130); x.lineTo(70, 96); x.lineTo(116, 130); x.fill();
          for (let q = 0; q < 7; q++) { x.fillStyle = q % 2 ? '#f0a020' : '#d04010'; x.beginPath(); x.moveTo(40 + q * 10, 130); x.quadraticCurveTo(46 + q * 10, 100 - (q % 3) * 8, 50 + q * 10, 130); x.fill(); } }
        x.fillStyle = '#5a2a20'; x.beginPath(); x.moveTo(140, 196); x.lineTo(150, 168); x.lineTo(160, 196); x.fill(); x.fillStyle = '#ecc9a2'; x.beginPath(); x.arc(150, 162, 6, 0, 7); x.fill();   // donateur à genoux, mains jointes
        x.strokeStyle = '#ecc9a2'; x.lineWidth = 3; x.beginPath(); x.moveTo(152, 174); x.lineTo(162, 166); x.stroke();
        x.fillStyle = '#efe2bc'; x.fillRect(22, h - 58, w - 44, 40); x.strokeStyle = '#6a4a2a'; x.lineWidth = 2; x.strokeRect(22, h - 58, w - 44, 40);
        x.fillStyle = '#3a2416'; x.font = 'bold 21px Georgia, serif'; x.textAlign = 'center'; x.fillText('EX VOTO', w / 2, h - 34); x.font = 'italic 13px Georgia, serif';
        x.fillText(['grâce reçue', 'sauvé de la chute', 'tiré du puits', 'sauvés du feu'][i], w / 2, h - 21);
        for (let q = 0; q < 220; q++) { x.strokeStyle = 'rgba(60,40,20,0.12)'; x.lineWidth = 1; x.beginPath(); const px = Math.random() * w, py = Math.random() * h; x.moveTo(px, py); x.lineTo(px + (Math.random() - 0.5) * 14, py + (Math.random() - 0.5) * 14); x.stroke(); }   // craquelures
        const vern = x.createRadialGradient(w / 2, h / 2, 40, w / 2, h / 2, w); vern.addColorStop(0, 'rgba(160,120,40,0)'); vern.addColorStop(1, 'rgba(90,60,20,0.35)'); x.fillStyle = vern; x.fillRect(0, 0, w, h);   // vernis jauni
      }, 256, 320);
      plan(0.3, 0.375, tx, 1.75 + i * 0.44, d1 - 0.015, zc + 1.8 + (i % 2) * 0.42, false);
    });
    // ex-voto de cire suspendus à une tringle de fer près de l'autel : jambes, bras, têtes, cœurs, un enfant emmailloté
    const cire = new THREE.MeshStandardMaterial({ color: 0xe9d6a3, roughness: 0.5 });
    const tr = pose(new THREE.CylinderGeometry(0.012, 0.012, 1.5, 6).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2a2826, metalness: 0.6, roughness: 0.5 }), s1 - 1.6, d1 - 0.12, zc + 2.55, false);
    tr.rotation.y += Math.PI / 2;
    const formes = [
      () => { const g = new THREE.CylinderGeometry(0.03, 0.045, 0.32, 8); const p = new THREE.BoxGeometry(0.06, 0.04, 0.12); p.translate(0, -0.17, 0.035); return mergeGeometries([g.toNonIndexed(), p.toNonIndexed()]); },   // jambe
      () => { const g = new THREE.CylinderGeometry(0.025, 0.035, 0.28, 8); const m2 = new THREE.SphereGeometry(0.035, 8, 6); m2.translate(0, -0.16, 0); return mergeGeometries([g.toNonIndexed(), m2.toNonIndexed()]); },   // bras
      () => new THREE.SphereGeometry(0.065, 12, 10).scale(0.85, 1.05, 0.95),   // tête
      () => { const h = new THREE.Shape(); h.moveTo(0, -0.07); h.bezierCurveTo(0.09, 0, 0.06, 0.07, 0, 0.035); h.bezierCurveTo(-0.06, 0.07, -0.09, 0, 0, -0.07); return new THREE.ExtrudeGeometry(h, { depth: 0.025, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.008, bevelSegments: 2 }); },   // cœur
      () => new THREE.CapsuleGeometry(0.045, 0.16, 4, 8),   // enfant emmailloté
    ];
    for (let i = 0; i < 9; i++) {
      const u = s1 - 2.25 + i * 0.16, l = 0.12 + (i % 3) * 0.08, f = formes[i % formes.length]();
      pose(new THREE.CylinderGeometry(0.002, 0.002, l, 3), new THREE.MeshBasicMaterial({ color: 0x4a3a2a }), u, d1 - 0.12, zc + 2.55 - l / 2, false);
      const m = pose(f, cire, u, d1 - 0.12, zc + 2.55 - l - 0.14);
      m.rotation.y += i * 0.7;
    }
  }
  // chevalet de peintre portant « La Vierge du chancelier Rolin » à sa vraie taille (66 × 62 cm), tourné vers l'entrée
  {
    const pos = P(1.55, 4.15), vers = P(s0 + 0.4, 2.25), dx = vers[0] - pos[0], dy = vers[1] - pos[1], g = new THREE.Group();
    g.position.copy(V(pos[0], pos[1], zc)); g.rotation.y = Math.atan2(dx, -dy); G.medieval.add(g);
    const hetre = new THREE.MeshStandardMaterial({ map: M.bois.map, color: 0xa07a50, roughness: 0.8 }), b = (w, h, d, x, y, z, rx = 0, rz = 0) => { const m = maille(new THREE.BoxGeometry(w, h, d), hetre); m.position.set(x, y, z); m.rotation.set(rx, 0, rz); g.add(m); return m; };
    b(0.045, 1.75, 0.045, -0.3, 0.86, 0.05, -0.12, -0.12); b(0.045, 1.75, 0.045, 0.3, 0.86, 0.05, -0.12, 0.12);   // montants avant
    b(0.04, 1.7, 0.04, 0, 0.8, -0.38, 0.28, 0);                                                              // pied arrière
    b(0.72, 0.05, 0.11, 0, 0.83, 0.13); b(0.6, 0.035, 0.035, 0, 1.62, 0.0);                                     // tablette et traverse haute
    const cadre = new THREE.Group(); cadre.position.set(0, 1.2, 0.12); cadre.rotation.x = -0.12; g.add(cadre);
    const or2 = new THREE.MeshStandardMaterial({ color: 0xb58a3a, metalness: 0.6, roughness: 0.4 });
    for (const [w, h, x, y] of [[0.74, 0.06, 0, 0.36], [0.74, 0.06, 0, -0.36], [0.06, 0.78, 0.34, 0], [0.06, 0.78, -0.34, 0]]) { const m = maille(new THREE.BoxGeometry(w, h, 0.04), or2); m.position.set(x, y, 0); cadre.add(m); }
    const tex = chargeur.load('tex/vierge_rolin.jpg'); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = aniso;
    const toile = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.66), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55 })); toile.position.z = 0.012; cadre.add(toile);
    const dos = maille(new THREE.BoxGeometry(0.62, 0.66, 0.02), hetre); dos.position.z = -0.005; cadre.add(dos);
    CHAPELLE.chevalet = pos;
    obstacles.push({ poly: [[pos[0] - 0.35, pos[1] - 0.35], [pos[0] + 0.35, pos[1] - 0.35], [pos[0] + 0.35, pos[1] + 0.35], [pos[0] - 0.35, pos[1] + 0.35]], village: false, medievalSeulement: true });
  }
  // baie en lancette dans le mur sud-ouest (jour lumineux)
  const baie = new THREE.Shape(); baie.moveTo(-0.22, 0); baie.lineTo(0.22, 0); baie.lineTo(0.22, 1.2); baie.quadraticCurveTo(0.22, 1.5, 0, 1.68); baie.quadraticCurveTo(-0.22, 1.5, -0.22, 1.2); baie.lineTo(-0.22, 0);
  const vitrail = (() => { const cv = document.createElement('canvas'); cv.width = 64; cv.height = 128; const x = cv.getContext('2d');
    x.fillStyle = '#e9dfb8'; x.fillRect(0, 0, 64, 128);
    for (let i = 0; i < 40; i++) { x.fillStyle = ['#f3e7c2', '#d9cfa0', '#c9b98a', '#efe2b0'][i % 4]; x.fillRect((i * 23) % 64, (i * 41) % 128, 16, 16); }
    x.strokeStyle = '#4a4238'; x.lineWidth = 2; for (let k = -128; k < 192; k += 16) { x.beginPath(); x.moveTo(k, 0); x.lineTo(k + 128, 128); x.stroke(); x.beginPath(); x.moveTo(k + 128, 0); x.lineTo(k, 128); x.stroke(); }
    const tx = new THREE.CanvasTexture(cv); tx.colorSpace = THREE.SRGBColorSpace; return tx; })();
  const matVitrail = new THREE.MeshBasicMaterial({ map: vitrail, side: THREE.DoubleSide });
  const gBaie = new THREE.ShapeGeometry(baie); { const u = gBaie.attributes.uv, pz = gBaie.attributes.position; for (let i = 0; i < u.count; i++) u.setXY(i, pz.getX(i) / 0.44 + 0.5, pz.getY(i) / 1.68); }
  for (const sb of [2.4, 4.6]) { const m = pose(gBaie, matVitrail, sb, d0 + 0.02, zc + 1.5, false); m.rotation.y += Math.PI / 2; }
  const l = new THREE.PointLight(0xffe2b0, 9, 9, 1.4); const pl = P((s0 + s1) / 2, dm); l.position.copy(V(pl[0], pl[1], zc + 3.6)); gc.add(l);
  // sol de la chapelle, porte et passages ; la tourelle : palier d'entrée, sept marches de la vis, palier haut vers la chapelle
  planchers.push({ poly: [P(s0 - 0.1, d0), P(s1, d0), P(s1, d1), P(s0 - 0.1, d1)], z: zc });
  const phi0 = Math.atan2(dT[1], dT[0]), rI = TOURELLE.apo - 0.45, deg = Math.PI / 180;
  const secteur = (a0, a1, r = rI) => { const out = [c]; const n = Math.max(2, Math.ceil((a1 - a0) / 10)); for (let i = 0; i <= n; i++) { const w = phi0 - (a0 + (a1 - a0) * i / n) * deg; out.push([c[0] + Math.cos(w) * r, c[1] + Math.sin(w) * r]); } return out; };
  const nM = 7, hs = (zc - zE) / nM, zPied = zE - 0.3;
  const marches = [{ poly: secteur(-35, 35), z: zE }];
  for (let i = 1; i <= nM; i++) marches.push({ poly: secteur(35 + (i - 1) * 30, 35 + i * 30), z: zE + i * hs });
  marches.push({ poly: secteur(245, 325), z: zc });
  for (const m of marches) { planchers.push(m); dalle(m.poly, m.z, m.z - zPied, M.courtine, gc); }
  dalle(secteur(0, 360, rI + 0.1), zc + 2.75, 0.25, M.bois, gc);   // plancher de l'étage : la vis continue au-dessus
  const noy = new THREE.CylinderGeometry(0.2, 0.2, zc + 2.6 - zPied, 8); noy.translate(c[0], (zc + 2.6 + zPied) / 2, -c[1]); gc.add(maille(noy, M.courtine));
  obstacles.push({ poly: [...Array(8)].map((_, k) => [c[0] + Math.cos(k * Math.PI / 4) * 0.3, c[1] + Math.sin(k * Math.PI / 4) * 0.3]), village: false });
  const octo = secteur(0, 360);
  const tT = [dT[1], -dT[0]], pT = (u, v) => [c[0] + dT[0] * u + tT[0] * v, c[1] + dT[1] * u + tT[1] * v];
  obstacles.push({ poly: [...Array(8)].map((_, k) => [c[0] + Math.cos(phi0 + k * Math.PI / 4 + Math.PI / 8) * TOURELLE.r, c[1] + Math.sin(phi0 + k * Math.PI / 4 + Math.PI / 8) * TOURELLE.r]), village: false, role: 'tourelle_rolin' });
  passages.push({ role: 'tourelle_rolin', poly: [pT(TOURELLE.apo + 1.0, -0.45), pT(TOURELLE.apo + 1.0, 0.45), pT(0.4, 0.45), pT(0.4, -0.45)] });
  passages.push({ role: 'logis_rolin', poly: [pT(TOURELLE.apo + 1.0, -0.45), pT(TOURELLE.apo + 1.0, 0.45), pT(0.4, 0.45), pT(0.4, -0.45)] });
  passages.push({ role: 'tourelle_rolin', poly: octo }); passages.push({ role: 'logis_rolin', poly: octo });
  const w2 = phi0 + Math.PI / 2, deb = [c[0] + Math.cos(w2) * 0.9, c[1] + Math.sin(w2) * 0.9], fin = P(s0 + 0.6, 2.25), { t: tc } = axe2(deb, fin), pc = [-tc[1] * 0.45, tc[0] * 0.45];
  const porteC = [[deb[0] + pc[0], deb[1] + pc[1]], [fin[0] + pc[0], fin[1] + pc[1]], [fin[0] - pc[0], fin[1] - pc[1]], [deb[0] - pc[0], deb[1] - pc[1]]];
  planchers.push({ poly: porteC, z: zc }); dalle(porteC, zc, 0.3, M.courtine, gc);
  passages.push({ role: 'tourelle_rolin', poly: porteC }); passages.push({ role: 'logis_rolin', poly: porteC });
  passages.push({ role: 'logis_rolin', poly: [P(s0 + 0.3, d0 + 0.35), P(s1 - 0.35, d0 + 0.35), P(s1 - 0.35, d1 - 0.35), P(s0 + 0.3, d1 - 0.35)] });
  obstacles.push({ poly: [P(s1 - 1.15, dm - 1.05), P(s1, dm - 1.05), P(s1, dm + 1.05), P(s1 - 1.15, dm + 1.05)], village: false });
  const surAngle = (a, r) => { const w = phi0 - a * deg; return [c[0] + Math.cos(w) * r, c[1] + Math.sin(w) * r]; };
  Object.assign(CHAPELLE, { entree: [c[0] + dT[0] * (TOURELLE.apo + 1.2), c[1] + dT[1] * (TOURELLE.apo + 1.2)], prier: P(2.2, dm + 0.75) });
  CHAPELLE.viaEntree = [CHAPELLE.entree, surAngle(0, 1.0), ...[70, 130, 190, 245].map((a) => surAngle(a, 1.1)), surAngle(285, 0.95), fin, P(1.6, dm + 0.6)];
}

// ---- porte fortifiée à herse fermant l'angle sud-est de la basse-cour (herse levée : on passe)
const HERSE = {};
{
  const w0 = data.murs.find((q) => q.id === 'mur_0'), w9 = data.murs.find((q) => q.id === 'mur_9');
  const E = w0.pts[w0.pts.length - 1], S = w9.pts[0], mid = [(E[0] + S[0]) / 2, (E[1] + S[1]) / 2], { t } = axe2([E[0], E[1]], [S[0], S[1]]);
  let n = [-t[1], t[0]]; if ((mid[0] - 38) * n[0] + (mid[1] + 30) * n[1] < 0) n = [-n[0], -n[1]];   // vers l'extérieur
  const P = (u, d) => [mid[0] + t[0] * u + n[0] * d, mid[1] + t[1] * u + n[1] * d];
  const zg = hauteurTerrain(...mid) + 0.02, zH = zg + 9.0, Lg = 7.6, dIn = -3.4, dOut = 1.8, ep = 1.1, lp = 3.0, hp = 4.2, grp = G.medieval;
  Object.assign(HERSE, { P, centre: mid, sol: zg });
  // façades extérieure et intérieure percées du passage voûté, côtés pleins
  murPerce(P(-Lg / 2, dOut - ep / 2), P(Lg / 2, dOut - ep / 2), ep, zg - 1.5, zH, [{ u: Lg / 2, w: lp, zb: zg - 0.05, h: hp, arc: true }], M.courtine, grp);
  murPerce(P(-Lg / 2, dIn + ep / 2), P(Lg / 2, dIn + ep / 2), ep, zg - 1.5, zH, [{ u: Lg / 2, w: lp, zb: zg - 0.05, h: hp, arc: true }], M.courtine, grp);
  for (const sg of [-1, 1]) {
    murPerce(P(sg * (Lg / 2 - ep / 2), dIn + ep), P(sg * (Lg / 2 - ep / 2), dOut - ep), ep, zg - 1.5, zH, [], M.courtine, grp);
    murPerce(P(sg * (lp / 2 + 0.4), dIn + ep), P(sg * (lp / 2 + 0.4), dOut - ep), 0.8, zg - 1.5, zg + hp + 0.4, [], M.courtine, grp);   // piédroits du passage
  }
  // voûte du passage, plancher de la chambre de la herse, terrasse et merlons
  const vo = new THREE.CylinderGeometry(lp / 2, lp / 2, (dOut - dIn), 16, 1, true, 0, Math.PI);
  vo.rotateZ(Math.PI / 2); vo.rotateY(Math.atan2(n[1], n[0]));
  const pv = P(0, (dIn + dOut) / 2), mv = maille(vo, new THREE.MeshStandardMaterial({ map: o1A || moA, color: 0xd8d2c4, roughness: 0.95, side: THREE.DoubleSide })); mv.position.copy(V(pv[0], pv[1], zg + hp - lp / 2)); grp.add(mv);
  dalle([P(-Lg / 2, dIn), P(Lg / 2, dIn), P(Lg / 2, dOut), P(-Lg / 2, dOut)], zH, 0.4, M.courtine, grp);
  for (let k = 0; k < 4; k++) {
    const c4 = [P(-Lg / 2, dIn), P(Lg / 2, dIn), P(Lg / 2, dOut), P(-Lg / 2, dOut)], a = c4[k], b = c4[(k + 1) % 4], ang = Math.atan2(b[1] - a[1], b[0] - a[0]), cc = P(0, (dIn + dOut) / 2);
    for (let f = 0.12; f < 0.95; f += (axe2(a, b).L > 6 ? 0.19 : 0.32)) { const x = lerp(a[0], b[0], f), y = lerp(a[1], b[1], f), L = Math.hypot(cc[0] - x, cc[1] - y); merlonsMed.push({ x: x + (cc[0] - x) / L * 0.32, y: y + (cc[1] - y) / L * 0.32, z: zH + 0.7, ang, sx: 0.6 }); }
  }
  for (const sg of [-1, 1]) torche(...P(sg * lp / 2, dIn + 0.7), zg + 2.1, [-sg * t[0], -sg * t[1]]);
  // la herse : grille de chêne ferrée, levée dans sa rainure (pointes visibles sous l'arc)
  const hg = [], fer = new THREE.MeshStandardMaterial({ color: 0x3c3a36, metalness: 0.6, roughness: 0.5 });
  for (let i = 0; i < 7; i++) { const b = new THREE.BoxGeometry(0.12, 4.2, 0.12); b.translate(-lp / 2 + 0.2 + i * (lp - 0.4) / 6, 0, 0); hg.push(b.toNonIndexed()); }
  for (let j = 0; j < 6; j++) { const b = new THREE.BoxGeometry(lp, 0.1, 0.1); b.translate(0, -1.9 + j * 0.75, 0.03); hg.push(b.toNonIndexed()); }
  const herse = maille(mergeGeometries(hg), M.bois);
  const ph = P(0, dOut - ep - 0.25); herse.position.copy(V(ph[0], ph[1], zg + hp + 1.2)); herse.rotation.y = Math.atan2(t[1], t[0]); grp.add(herse);
  const pointes = [];
  for (let i = 0; i < 7; i++) { const c3 = new THREE.ConeGeometry(0.07, 0.3, 4); c3.rotateX(Math.PI); c3.translate(-lp / 2 + 0.2 + i * (lp - 0.4) / 6, -2.25, 0); pointes.push(c3.toNonIndexed()); }
  const mp = maille(mergeGeometries(pointes), fer); mp.position.copy(herse.position); mp.rotation.y = herse.rotation.y; grp.add(mp);
  // collisions : massifs de part et d'autre du passage
  for (const sg of [-1, 1]) obstacles.push({ poly: [P(sg * (lp / 2 + 0.05), dIn), P(sg * Lg / 2, dIn), P(sg * Lg / 2, dOut), P(sg * (lp / 2 + 0.05), dOut)], village: false, medievalSeulement: true });
}

// ---- la grande salle (lieu 5) : restitution probable. Le mur nord (mur_1) et les trois piliers isolés sont relevés ;
// on en fait une salle à deux nefs : les piliers portent une poutre maîtresse, un mur gouttereau ferme le côté de la cour,
// une charpente couverte de tuiles. Hauteurs, portes, fenêtres et cheminée : hypothèses.
const GRANDE_SALLE = {};
{
  const w1 = data.murs.find((q) => q.id === 'mur_1'), A1 = [w1.pts[0][0], w1.pts[0][1]], B1 = [w1.pts[w1.pts.length - 1][0], w1.pts[w1.pts.length - 1][1]];
  const { L: Ls, t } = axe2(A1, B1); let n = [-t[1], t[0]]; if ((2.5 - A1[0]) * n[0] + (8.5 - A1[1]) * n[1] < 0) n = [-n[0], -n[1]];
  const P = (u, d) => [A1[0] + t[0] * u + n[0] * d, A1[1] + t[1] * u + n[1] * d], grp = G.medieval;
  const sE = -0.9, sW = Ls + 1.4, dS = 6.65, epS = 0.9, dRidge = (-0.6 + dS + epS / 2) / 2;
  let zmin = 99, zmax = -99; for (let u = 0; u <= Ls; u += 1) for (const d of [0.8, 3.2, 6.0]) { const z = hauteurTerrain(...P(u, d)); zmin = Math.min(zmin, z); zmax = Math.max(zmax, z); }
  const base = zmin - 1.5, ze = zmax + 6.0, zr = ze + 3.4, toit = (d) => ze + (zr - ze) * (1 - Math.abs(d - dRidge) / (dRidge + 0.6));
  Object.assign(GRANDE_SALLE, { P, Ls, dS, centre: P(Ls / 2, 3.2), sol: zmin });
  // mur nord exhaussé (la courtine relevée s'arrête vers 5,3 m) et mur gouttereau côté cour : une porte, trois fenêtres
  murPerce(P(sE, 0), P(sW, 0), 1.2, base, ze, [{ u: 10.3, w: 0.5, zb: ze - 2.6, h: 1.2, arc: true }], M.courtine, grp);
  const zp = hauteurTerrain(...P(7.2, dS + 0.8)) + 0.02;
  GRANDE_SALLE.porte = P(7.2, dS + 1.2);
  murPerce(P(sE, dS), P(sW, dS), epS, base, ze, [
    { u: 7.2 - sE, w: 1.7, zb: zp, h: 2.9, arc: true },
    ...[2.4, 9.6, 12.4].map((u) => ({ u: u - sE, w: 0.75, zb: ze - 3.4, h: 1.9, arc: true }))], M.courtine, grp);
  // pignon ouest entier ; à l'est, la salle s'appuie sur le donjon : seul le bas du rampant dépasse
  { const a = P(sW - 0.45, -0.6), b = P(sW - 0.45, dS + epS / 2), L = axe2(a, b).L;
    murPerce(a, b, 0.9, 0, 0, [{ u: dRidge + 0.6, w: 0.6, zb: ze - 1.0, h: 1.4, arc: true }], M.courtine, grp, [[0, base], [L, base], [L, ze], [dRidge + 0.6, zr], [0, ze]]); }
  { const d0 = 3.9, a = P(sE + 0.45, d0), b = P(sE + 0.45, dS + epS / 2), L = axe2(a, b).L;
    murPerce(a, b, 0.9, 0, 0, [], M.courtine, grp, [[0, base], [L, base], [L, ze], [0, toit(d0)]]); }
  // toiture à deux pans (débord de 0,5 m), sous-face en planches
  { const g = new Geo(), g2 = new Geo(), dN = -1.1, dSud = dS + epS / 2 + 0.5, zN = toit(dN), zS = toit(dSud), u0 = sE - 0.5, u1 = sW + 0.5;
    for (const [d1, z1] of [[dN, zN], [dSud, zS]]) {
      const a = P(u0, d1), b = P(u1, d1), c = P(u1, dRidge), e = P(u0, dRidge), L = u1 - u0, pente = Math.hypot(d1 - dRidge, z1 - zr);
      const up = new THREE.Vector3(0, 1, 0);
      g.quad(V(a[0], a[1], z1), V(b[0], b[1], z1), V(c[0], c[1], zr), V(e[0], e[1], zr), [0, 0], [L, 0], [L, pente], [0, pente], up);
      g2.quad(V(a[0], a[1], z1 - 0.12), V(b[0], b[1], z1 - 0.12), V(c[0], c[1], zr - 0.12), V(e[0], e[1], zr - 0.12), [0, 0], [L, 0], [L, pente], [0, pente], up.clone().negate());
    }
    const mt = maille(g.geometrie(), M.tuiles); grp.add(mt); occultants.push(mt); grp.add(maille(g2.geometrie(), M.bois)); }
  // piliers relevés en colonnes, poutre maîtresse, entraits et poteaux de charpente
  const piliers = [[6.0, 6.8], [2.5, 8.5], [-0.5, 10.5]].map((p) => { const u = (p[0] - A1[0]) * t[0] + (p[1] - A1[1]) * t[1], d = (p[0] - A1[0]) * n[0] + (p[1] - A1[1]) * n[1]; return { p, u, d }; });
  piliers.push({ u: Ls - 0.4, d: 3.2, p: P(Ls - 0.4, 3.2) });
  const zPoutre = ze - 0.6, chene = new THREE.MeshStandardMaterial({ map: M.bois.map, color: 0x7a5a3a, roughness: 0.85 });
  for (const q of piliers) {
    const z0 = hauteurTerrain(...q.p), col = maille(uvMonde(new THREE.BoxGeometry(0.62, zPoutre - z0 + 0.1, 0.62)), M.courtine); col.position.copy(V(q.p[0], q.p[1], (zPoutre + z0) / 2 - 0.05)); col.rotation.y = Math.atan2(t[1], t[0]); grp.add(col);
    const cap = maille(uvMonde(new THREE.BoxGeometry(0.9, 0.25, 0.9)), M.courtine); cap.position.copy(V(q.p[0], q.p[1], zPoutre - 0.12)); cap.rotation.y = col.rotation.y; grp.add(cap);
    const ent = maille(new THREE.BoxGeometry(0.26, 0.3, dS + 0.2), chene); const m = P(q.u, dS / 2); ent.position.copy(V(m[0], m[1], ze - 0.15)); ent.rotation.y = Math.atan2(n[0], -n[1]); grp.add(ent);
    const po = maille(new THREE.BoxGeometry(0.2, zr - ze - 0.4, 0.2), chene); const r = P(q.u, dRidge); po.position.copy(V(r[0], r[1], (ze + zr) / 2 - 0.2)); grp.add(po);
  }
  { const a = P(0.2, 3.2), b = P(Ls, 3.2), m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], pm = maille(new THREE.BoxGeometry(Ls, 0.34, 0.3), chene); pm.position.copy(V(m[0], m[1], zPoutre + 0.17)); pm.rotation.y = Math.atan2(t[1], t[0]); grp.add(pm); }
  // cheminée adossée au mur nord : jambages, manteau, hotte ; table à tréteaux, bancs, dressoir
  { const u = 9.2, zf = hauteurTerrain(...P(u, 1.2));
    const bloc = (w, h, dd, uu, d, z, mat = M.courtine) => { const m = maille(uvMonde(new THREE.BoxGeometry(w, h, dd)), mat); const q = P(uu, d); m.position.copy(V(q[0], q[1], z)); m.rotation.y = Math.atan2(t[1], t[0]); grp.add(m); return m; };
    bloc(0.3, 1.6, 0.6, u - 0.95, 0.9, zf + 0.8); bloc(0.3, 1.6, 0.6, u + 0.95, 0.9, zf + 0.8); bloc(2.3, 0.3, 0.75, u, 0.95, zf + 1.75);
    const hotte = maille(uvMonde(new THREE.CylinderGeometry(0.35, 1.45, 2.2, 4, 1)), M.courtine); const q = P(u, 0.85); hotte.position.copy(V(q[0], q[1], zf + 3.0)); hotte.rotation.y = Math.atan2(t[1], t[0]) + Math.PI / 4; hotte.scale.set(1, 1, 0.45); grp.add(hotte);
    bloc(1.4, 0.04, 0.5, u, 0.95, zf + 0.03, new THREE.MeshStandardMaterial({ color: 0x2a2420, roughness: 1 }));   // âtre
    for (const [du, dd] of [[-0.3, 0], [0.25, 0.1], [0, -0.1]]) { const b = bloc(0.9, 0.12, 0.12, u + du, 1.0 + dd, zf + 0.12, chene); b.rotation.y += du * 2; }   // bûches
    lumiere(...P(u, 1.6), zf + 0.8, 4, 6); RECON.lumieres[RECON.lumieres.length - 1].color.set(0xff9a50);
    const zt = hauteurTerrain(...P(3.8, 4.6));
    bloc(3.6, 0.08, 0.95, 3.8, 4.6, zt + 0.78, chene);
    for (const du of [-1.4, 1.4]) bloc(0.08, 0.74, 0.8, 3.8 + du, 4.6, zt + 0.38, chene);
    for (const dd of [3.75, 5.45]) bloc(3.2, 0.07, 0.3, 3.8, dd, zt + 0.45, chene);
    for (const dd of [3.75, 5.45]) for (const du of [-1.2, 1.2]) bloc(0.07, 0.42, 0.26, 3.8 + du, dd, zt + 0.21, chene);
    bloc(1.6, 1.5, 0.5, 2.0, 1.0, hauteurTerrain(...P(2.0, 1.0)) + 0.75, chene);   // dressoir contre le mur nord
  }
  for (const du of [-1.4, 1.4]) torche(...P(7.2 + du, dS - epS / 2 - 0.02), zp + 2.0, [-n[0], -n[1]]);
  // collisions : mur gouttereau (sauf la porte) et pignons
  const rectS = (u0, u1, d0, d1) => [P(u0, d0), P(u1, d0), P(u1, d1), P(u0, d1)];
  obstacles.push({ poly: rectS(sE, 7.2 - 0.85, dS - epS / 2, dS + epS / 2), village: false, medievalSeulement: true });
  obstacles.push({ poly: rectS(7.2 + 0.85, sW, dS - epS / 2, dS + epS / 2), village: false, medievalSeulement: true });
  obstacles.push({ poly: rectS(sW - 0.9, sW, -0.6, dS + epS / 2), village: false, medievalSeulement: true });
  obstacles.push({ poly: rectS(sE, sE + 0.9, 3.9, dS + epS / 2), village: false, medievalSeulement: true });
  obstacles.push({ poly: rectS(2.0, 5.6, 4.15, 5.05), village: false, medievalSeulement: true });   // la table
}

{
  const g = new THREE.BoxGeometry(1.35, 1.4, 0.62);
  const im = new THREE.InstancedMesh(g, M.courtine, merlonsMed.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc1 = new THREE.Vector3(1, 1, 1);
  merlonsMed.forEach((m, k) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), m.ang);
    sc1.set(m.sx || 1, 1, 1); m4.compose(V(m.x, m.y, m.z), q, sc1); im.setMatrixAt(k, m4);
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
    if (dedans || surPlancher(x, y)) continue;
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
    texte: ["Entre le logis nord et la grande cuisine, des murs sans toit et trois piliers isolés. Les sources signalent une grande salle dans la haute-cour : est-ce elle ?",
      "En 1435, la maquette propose une restitution : une salle à deux nefs dont les piliers portent la poutre maîtresse, fermée côté cour par un mur percé d'une porte et de fenêtres, chauffée par une cheminée, couverte d'une charpente et de tuiles. C'est une hypothèse, pas un relevé."],
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
const marcheur = { x: -2, y: -6, cap: 14 * DEG, site: 0, z: null, h: 0, vz: 0, saut: false };   // h : hauteur du saut au-dessus de l'appui
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
function placerMarcheur([x, y, capDeg, z]) { marcheur.x = x; marcheur.y = y; marcheur.cap = capDeg * DEG; marcheur.site = 0.05; marcheur.z = z != null ? z : null; }

const sources = '<br><span style="font-size:11px;opacity:.8">Relevé : IGN, LiDAR HD et BD TOPO (licence ouverte Etalab 2.0) · textures : banque du Studio · textes : fascicules Oricourt.</span>';
const aideSurvol = '<b>Survol</b> · glisser : tourner autour · molette ou pincement : zoom · clic droit ou deux doigts : déplacer. Cliquez un numéro pour lire la fiche du lieu.' + sources;
const aidePied = "<b>Visite à pied</b> · ZQSD / WASD ou flèches : marcher · Maj : courir · Espace : sauter · glisser la souris : regarder. Sur tablette : manette à gauche, glisser à droite pour regarder." + sources;
function majAide() { $('aide').innerHTML = mode === 'survol' ? aideSurvol : aidePied; }
function passerEnModeSurvol() {
  mode = 'survol'; orbite.enabled = true;
  camera.near = 0.3; camera.far = 4000; camera.updateProjectionMatrix();
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
  camera.near = 0.06; camera.far = 2500; camera.updateProjectionMatrix();
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
  EPOQUE.ancienne = e !== 'actuel';
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
addEventListener('keydown', (e) => {
  if (JEU.touche(e)) return;
  if (mode === 'pied') { touches.add(e.code); if (e.code.startsWith('Arrow')) e.preventDefault(); if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) marcheur.saut = true; } }
});
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
// ---- étages praticables du passé (19 novembre) : chemins de ronde, salles des tours, escaliers droits et en vis.
// Chaque surface donne la hauteur du sol en (x, y), connaissant la hauteur où l'on se trouve (zRef) pour les vis à
// plusieurs tours. On passe d'une surface à l'autre si les hauteurs se raccordent (moins de 0,5 m d'écart).
function zSurface(S, x, y, zRef) {
  if (S.type === 'plan') return dedansPoly(x, y, S.poly) && !(S.trous && S.trous.some((t) => dedansPoly(x, y, t))) ? S.z : null;
  if (S.type === 'rampe') {
    if (!dedansPoly(x, y, S.poly)) return null;
    const dx = S.b[0] - S.a[0], dy = S.b[1] - S.a[1], L2 = dx * dx + dy * dy, u = clamp(((x - S.a[0]) * dx + (y - S.a[1]) * dy) / L2, 0, 1);
    return lerp(S.z0, S.z1, u);
  }
  if (S.type === 'ruban') {
    let best = null, dmin = S.demi;
    for (let k = 0; k < S.pts.length - 1; k++) {
      const a = S.pts[k], b = S.pts[k + 1], dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
      const t = L2 ? clamp(((x - a.x) * dx + (y - a.y) * dy) / L2, 0, 1) : 0, d = Math.hypot(x - a.x - t * dx, y - a.y - t * dy);
      if (d <= dmin) { dmin = d; best = lerp(a.z, b.z, t); }
    }
    return best;
  }
  if (S.type === 'vis') {
    const dx = x - S.c[0], dy = y - S.c[1], r = Math.hypot(dx, dy);
    if (r < S.ri || r > S.ro) return null;
    let th = (Math.atan2(dy, dx) - S.a0) * S.sens; th = ((th % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const zb = S.z0 + S.pas * th / (2 * Math.PI), k = Math.round((zRef - zb) / S.pas), z = zb + k * S.pas;
    return z < S.z0 - 0.05 || z > S.z1 + 0.05 ? null : Math.min(z, S.z1);
  }
  return null;
}
function etageEn(x, y, zRef) {
  let best = null;
  for (const S of ETAGES) { const z = zSurface(S, x, y, zRef); if (z != null && Math.abs(z - zRef) < 0.5 && (best == null || Math.abs(z - zRef) < Math.abs(best - zRef))) best = z; }
  return best;
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
    if (o.role && passages.some((p) => p.role === o.role && (!p.medieval || ancien()) && dedansPoly(x, y, p.poly))) continue;
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
    if (marcheur.z != null && !ancien()) marcheur.z = null;
    if (marcheur.z != null) {
      // en étage : on ne se déplace que sur une surface praticable à la même hauteur (ou un peu plus haut pendant un saut),
      // ou l'on redescend au sol en bas d'un escalier
      const zAbs = marcheur.z + marcheur.h;
      const essai = (x, y) => {
        const z = etageEn(x, y, zAbs);
        if (z != null) { marcheur.x = x; marcheur.y = y; marcheur.z = z; marcheur.h = Math.max(0, zAbs - z); return true; }
        const zs = hauteurSol(x, y);
        if (Math.abs(zs - zAbs) < 0.5 && !bloque(x, y)) { marcheur.x = x; marcheur.y = y; marcheur.z = null; marcheur.h = Math.max(0, zAbs - zs); return true; }
        return false;
      };
      essai(nx, ny) || essai(nx, marcheur.y) || essai(marcheur.x, ny);
    } else {
      const zSol = hauteurSol(marcheur.x, marcheur.y), zAbs = zSol + marcheur.h, ze = ancien() ? etageEn(nx, ny, zAbs) : null;
      if (ze != null && Math.abs(ze - zAbs) < 0.45) { marcheur.x = nx; marcheur.y = ny; marcheur.z = ze; marcheur.h = Math.max(0, zAbs - ze); }   // on monte sur la première marche
      else {
        const zn = hauteurSol(nx, ny), dh = Math.abs(zn - zSol);
        if (dh < 0.45 || dh / Math.max(1e-3, Math.hypot(dx, dy)) < 1.6 || zn - zAbs < 0.3) {
          const avant = [marcheur.x, marcheur.y];
          if (!bloque(nx, ny)) { marcheur.x = nx; marcheur.y = ny; }
          else if (!bloque(nx, marcheur.y)) marcheur.x = nx;
          else if (!bloque(marcheur.x, ny)) marcheur.y = ny;
          if (marcheur.h > 0 && (marcheur.x !== avant[0] || marcheur.y !== avant[1])) marcheur.h = Math.max(0, zAbs - hauteurSol(marcheur.x, marcheur.y));
        }
      }
    }
  }
  if (marcheur.z != null && !ancien()) marcheur.z = null;
  // saut (barre d'espace) : impulsion de 4 m/s, pesanteur ; on retombe sur l'appui du moment
  if (marcheur.saut) { marcheur.saut = false; if (marcheur.h === 0 && !JEU.dialogue) marcheur.vz = 4.0; }
  if (marcheur.h > 0 || marcheur.vz > 0) { marcheur.h += marcheur.vz * dt; marcheur.vz -= 9.81 * dt; if (marcheur.h <= 0) { marcheur.h = 0; marcheur.vz = 0; } }
  const z = (marcheur.z != null ? marcheur.z : hauteurSol(marcheur.x, marcheur.y)) + marcheur.h + 1.65;
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
  if (G.medieval.visible) { const tt = matCiel.uniforms.temps.value; for (const F of FLAMMES) { const k = 1 + 0.12 * Math.sin(tt * 9 + F.ph) + 0.08 * Math.sin(tt * 23 + F.ph * 3); F.f.scale.set(0.28 * (2 - k), 0.5 * k, 1); } }
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

  // ---- itinéraires à pied des habitants (grille de 0,5 m, voisins à 8 directions, puis lissage en lignes droites)
  function itineraire(a, b) {
    const pas = 0.5, x0 = Math.min(a[0], b[0]) - 25, y0 = Math.min(a[1], b[1]) - 25, nx = Math.ceil((Math.abs(a[0] - b[0]) + 50) / pas), ny = Math.ceil((Math.abs(a[1] - b[1]) + 50) / pas);
    const libre = new Int8Array(nx * ny).fill(-1), ok = (i, j) => { const k = j * nx + i; if (libre[k] < 0) libre[k] = dansLePasse(() => bloque(x0 + i * pas, y0 + j * pas)) ? 0 : 1; return libre[k] === 1; };
    const ia = Math.round((a[0] - x0) / pas), ja = Math.round((a[1] - y0) / pas), ib = Math.round((b[0] - x0) / pas), jb = Math.round((b[1] - y0) / pas);
    const dist = new Float32Array(nx * ny).fill(Infinity), prec = new Int32Array(nx * ny).fill(-1), tas = [];
    const pousser = (f, k) => { tas.push([f, k]); let i = tas.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (tas[p][0] <= tas[i][0]) break; [tas[p], tas[i]] = [tas[i], tas[p]]; i = p; } };
    const tirer = () => { const r = tas[0], d = tas.pop(); if (tas.length) { tas[0] = d; let i = 0; for (;;) { const l = 2 * i + 1, rr = l + 1; let m = i; if (l < tas.length && tas[l][0] < tas[m][0]) m = l; if (rr < tas.length && tas[rr][0] < tas[m][0]) m = rr; if (m === i) break; [tas[m], tas[i]] = [tas[i], tas[m]]; i = m; } } return r; };
    dist[ja * nx + ia] = 0; pousser(0, ja * nx + ia);
    while (tas.length) {
      const [, k] = tirer(), dk = dist[k];
      if (k === jb * nx + ib) break;
      const i = k % nx, j = (k - i) / nx;
      for (const [di, dj, c] of [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]]) {
        const i2 = i + di, j2 = j + dj; if (i2 < 0 || j2 < 0 || i2 >= nx || j2 >= ny) continue;
        const k2 = j2 * nx + i2, d2 = dk + c;
        if (d2 < dist[k2] && (k2 === jb * nx + ib || ok(i2, j2))) { dist[k2] = d2; prec[k2] = k; pousser(d2 + Math.hypot(i2 - ib, j2 - jb), k2); }
      }
    }
    if (prec[jb * nx + ib] < 0) return null;
    const brut = []; for (let k = jb * nx + ib; k >= 0 && k !== ja * nx + ia; k = prec[k]) { const i = k % nx; brut.unshift([x0 + i * pas, y0 + (k - i) / nx * pas]); }
    const out = []; let cur = a;   // lissage : on garde le point le plus lointain visible en ligne droite
    for (let q = 0; q < brut.length;) { let r = brut.length - 1; while (r > q && !libreSur(cur, brut[r])) r--; out.push(brut[r]); cur = brut[r]; q = r + 1; }
    out[out.length - 1] = b; return out;
  }
  // abreuvoir de pierre de la basse-cour (on y mène les bêtes boire)
  const ABREUVOIR = placeLibre(38.5, -24.5);
  { const z = hauteurSol(...ABREUVOIR), g = new THREE.Group(), pierre = new THREE.MeshStandardMaterial({ map: moA, color: 0xcfc6b2, roughness: 0.95 });
    const bac = maille(uvMonde(new THREE.BoxGeometry(1.9, 0.55, 0.7)), pierre); bac.position.y = 0.27; g.add(bac);
    const eau = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.5).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x5d6e66, roughness: 0.15, metalness: 0.1 })); eau.position.y = 0.5; g.add(eau);
    g.position.copy(V(ABREUVOIR[0], ABREUVOIR[1], z)); g.rotation.y = 0.5; G.medieval.add(g);
    obstacles.push({ poly: [-1, 1].flatMap((sx) => [-1, 1].map((sy) => [ABREUVOIR[0] + sx * Math.cos(0.5) * 1.0 + sy * Math.sin(0.5) * 0.4, ABREUVOIR[1] - sx * Math.sin(0.5) * 1.0 + sy * Math.cos(0.5) * 0.4])).sort((p, q) => Math.atan2(p[1] - ABREUVOIR[1], p[0] - ABREUVOIR[0]) - Math.atan2(q[1] - ABREUVOIR[1], q[0] - ABREUVOIR[0])), village: false, medievalSeulement: true }); }
  /** Lieux nommés des routines : [x, y], hauteur d'étage éventuelle, chemin imposé pour y entrer (escaliers, tourelle). */
  const rondeEntre = (id, s0, s1) => { const R = RONDES.find((q) => q.w.id === id); const L = R.int.filter((q) => (s0 < s1 ? q.s >= s0 && q.s <= s1 : q.s <= s0 && q.s >= s1)); if (s0 > s1) L.reverse(); return L.map((q) => [q.x, q.y]); };
  const rondeA = (id, s) => { const R = RONDES.find((q) => q.w.id === id); let best = R.int[0]; for (const q of R.int) if (Math.abs(q.s - s) < Math.abs(best.s - s)) best = q; return best; };
  function lieuRoutine(nom, base, s) {
    const ESC = RECON.escalier, salle = (role) => SALLES_TOURS.find((q) => q.role === role);
    if (nom === 'puits') { const a = (s.angle || 0) * DEG + Math.atan2(base[1] - PUITS[1], base[0] - PUITS[0]); const r = s.rayon || 1.3; return { xy: placeLibre(PUITS[0] + Math.cos(a) * r, PUITS[1] + Math.sin(a) * r) }; }
    if (nom === 'cuisine') return { xy: placeLibre(...SALLE.centre) };
    if (nom === 'abreuvoir') return { xy: placeLibre(ABREUVOIR[0] - 0.9, ABREUVOIR[1] - 0.9), vers: ABREUVOIR };
    if (nom === 'chapelle') { const C = CHAPELLE; return { xy: C.prier, vers: C.autel, entree: C.viaEntree }; }
    if (nom === 'escalier') return { xy: placeLibre(...ESC.bas) };
    if (nom === 'ronde_ouest') {   // milieu de la courtine ouest, par l'escalier, la courtine sud et la salle de la tourelle sud-ouest
      const R3 = RONDES.find((q) => q.w.id === 'mur_3'), L3 = R3.int[R3.int.length - 1].s, p = rondeA('mur_3', L3 * 0.45), R4 = RONDES.find((q) => q.w.id === 'mur_4');
      const via = [ESC.bas, ESC.haut, ...rondeEntre('mur_4', 3.0, 0), [R4.debut.x, R4.debut.y], salle('tourelle_sud_ouest').centre, [R3.fin.x, R3.fin.y], ...rondeEntre('mur_3', L3, L3 * 0.45)];
      return { xy: [p.x, p.y], z: p.z, entree: via, vers: [p.x - (CENTRE_HC[0] - p.x), p.y - (CENTRE_HC[1] - p.y)] };
    }
    if (nom === 'tour_maitresse') { const S = salle('tour_maitresse'); return { xy: S.centre, z: S.z }; }
    if (nom === 'ronde_porte') {   // sur la courtine est, au-dessus de la porte de la haute-cour, depuis la salle de la tour maîtresse
      const R7 = RONDES.find((q) => q.w.id === 'mur_7'), p = rondeA('mur_7', PORTE.s);
      return { xy: [p.x, p.y], z: p.z, entree: [[R7.debut.x, R7.debut.y], ...rondeEntre('mur_7', 0, PORTE.s)], vers: [2 * p.x - CENTRE_HC[0], 2 * p.y - CENTRE_HC[1]] };
    }
    return null;
  }

  // ---- le hameau : masures à pans de bois et torchis, toits de chaume, hors de l'enceinte et à l'écart des chemins
  const toileCanvas = (w, h, dessin) => { const c = document.createElement('canvas'); c.width = w; c.height = h; dessin(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso; return t; };
  const alea = aleaGraine(1435);
  // pans de bois (4 m × 2,2 m) : sablière basse et haute, poteaux tous les mètres, écharpes, torchis ocré et fissuré
  const texPans = [0, 1].map((v) => toileCanvas(512, 282, (x, w, h) => {
    x.fillStyle = v ? '#cbb08a' : '#d6c3a0'; x.fillRect(0, 0, w, h);
    for (let k = 0; k < 2200; k++) { const g = 150 + alea() * 70; x.fillStyle = `rgba(${g},${g * 0.85 | 0},${g * 0.62 | 0},0.35)`; x.fillRect(alea() * w, alea() * h, 2 + alea() * 5, 2 + alea() * 4); }
    x.strokeStyle = 'rgba(90,70,50,0.45)'; x.lineWidth = 1; for (let k = 0; k < 14; k++) { x.beginPath(); let px = alea() * w, py = alea() * h; x.moveTo(px, py); for (let q = 0; q < 5; q++) { px += (alea() - 0.5) * 22; py += alea() * 12; x.lineTo(px, py); } x.stroke(); }
    const bois = (x0, y0, x1, y1, ep) => { x.strokeStyle = '#4e3522'; x.lineWidth = ep; x.beginPath(); x.moveTo(x0, y0); x.lineTo(x1, y1); x.stroke(); x.strokeStyle = 'rgba(30,20,12,0.5)'; x.lineWidth = 1.5; x.beginPath(); x.moveTo(x0 + ep / 2, y0); x.lineTo(x1 + ep / 2, y1); x.stroke(); };
    bois(0, h - 9, w, h - 9, 18); bois(0, 9, w, 9, 18);
    for (let k = 0; k <= 4; k++) bois(k * 128, 0, k * 128, h, 16);
    bois(10, h - 18, 118, 18, 13); bois(266, 18, 374, h - 18, 13);
    if (v) { bois(0, h / 2, 128, h / 2, 11); bois(384, h / 2, 512, h / 2, 11); }
  }));
  // chaume : brins de paille couchés dans le sens de la pente, teinte vieillie, mousse par endroits
  const texChaume = toileCanvas(256, 256, (x, w, h) => {
    x.fillStyle = '#8a7444'; x.fillRect(0, 0, w, h);
    for (let k = 0; k < 5200; k++) { const g = 110 + alea() * 90, px = alea() * w, py = alea() * h; x.strokeStyle = `rgba(${g * 1.05 | 0},${g * 0.88 | 0},${g * 0.52 | 0},0.6)`; x.lineWidth = 1 + alea(); x.beginPath(); x.moveTo(px, py); x.lineTo(px + (alea() - 0.5) * 3, py + 8 + alea() * 14); x.stroke(); }
    for (let k = 0; k < 9; k++) { x.fillStyle = `rgba(70,${90 + alea() * 30 | 0},40,0.28)`; x.beginPath(); x.ellipse(alea() * w, alea() * h, 10 + alea() * 22, 6 + alea() * 12, 0, 0, 7); x.fill(); }
    for (let y = 0; y < h; y += 32) { x.fillStyle = 'rgba(40,30,15,0.22)'; x.fillRect(0, y, w, 3); }
  });
  const texPlanches = toileCanvas(128, 256, (x, w, h) => { for (let k = 0; k < 4; k++) { const g = 95 + alea() * 30; x.fillStyle = `rgb(${g},${g * 0.72 | 0},${g * 0.48 | 0})`; x.fillRect(k * 32, 0, 32, h); x.fillStyle = '#21160c'; x.fillRect(k * 32, 0, 2, h); }
    x.fillStyle = '#2c2a28'; x.fillRect(0, 40, w, 10); x.fillRect(0, 200, w, 10); for (const y of [45, 205]) for (const px of [14, 50, 86, 114]) { x.fillStyle = '#5a5650'; x.beginPath(); x.arc(px, y, 3, 0, 7); x.fill(); } });
  const matPans = texPans.map((t) => new THREE.MeshStandardMaterial({ map: t, roughness: 0.95 }));
  const matChaume = new THREE.MeshStandardMaterial({ map: texChaume, roughness: 1, color: 0xf0e2c0 });
  const matSolin = new THREE.MeshStandardMaterial({ map: moA, color: 0xb9b0a0, roughness: 1 });
  const matPorte = new THREE.MeshStandardMaterial({ map: texPlanches, roughness: 0.9 });
  const matNoir = new THREE.MeshStandardMaterial({ color: 0x14100c, roughness: 1 });
  const surChemin = (x, y) => { const i = Math.round(x + HALF), j = Math.round(HALF - y); return i < 0 || j < 0 || i >= N || j >= N || terre8[j * N + i] > 55; };
  const MAISONS = [];
  // emprise du potager du colombier (environ 20 × 22 m, surtout au nord du colombier) : le hameau s'en écarte
  const JARDIN = { x0: COLOMBIER.c[0] - 10, x1: COLOMBIER.c[0] + 10, y0: COLOMBIER.c[1] - 6, y1: COLOMBIER.c[1] + 16 };
  /** Une masure : solin de pierre, pans de bois hourdés de torchis, pignons, toit de chaume épais, porte de planches,
   *  petite fenêtre à volet, bûcher contre un pignon, parfois un tonneau et un banc. */
  function masure(x, y, ang, L, l, k) {
    const ca = Math.cos(ang), sa = Math.sin(ang), coin = (lx, lz) => [x + lx * ca + lz * sa, y + lx * sa - lz * ca];
    const poly = [coin(-L / 2, -l / 2), coin(L / 2, -l / 2), coin(L / 2, l / 2), coin(-L / 2, l / 2)], zs = poly.map((p) => hauteurTerrain(...p));
    const z0 = Math.min(...zs) - 0.1, dz = Math.max(...zs) - z0, so = 0.45 + dz, hm = 2.2, zt = so + hm, pente = 0.95 + (k % 3) * 0.08, hf = zt + (l / 2 + 0.5) * Math.tan(pente);
    const g = new THREE.Group(); g.position.copy(V(x, y, z0)); g.rotation.y = ang; G.vie.add(g);
    const m = (geo, mat, px, py, pz, ombre = true) => { const o = new THREE.Mesh(geo, mat); o.position.set(px, py, pz); o.castShadow = ombre; o.receiveShadow = true; g.add(o); return o; };
    m(uvMonde(new THREE.BoxGeometry(L + 0.12, so, l + 0.12)), matSolin, 0, so / 2, 0);   // solin
    const murs = new THREE.BoxGeometry(L, hm, l); { const uv = murs.attributes.uv, pz = murs.attributes.position, nz = murs.attributes.normal; for (let i = 0; i < uv.count; i++) { const u = Math.abs(nz.getX(i)) > 0.5 ? pz.getZ(i) : pz.getX(i); uv.setXY(i, (u + 8) / 4, (pz.getY(i) + hm / 2) / hm); } }
    m(murs, matPans[k % 2], 0, so + hm / 2, 0);
    // pignons à pans de bois
    const tri = new THREE.Shape(); tri.moveTo(-l / 2, 0); tri.lineTo(l / 2, 0); tri.lineTo(0, hf - zt); tri.lineTo(-l / 2, 0);
    for (const sx of [-1, 1]) { const gt = new THREE.ShapeGeometry(tri); { const uv = gt.attributes.uv, pz = gt.attributes.position; for (let i = 0; i < uv.count; i++) uv.setXY(i, (pz.getX(i) + 8) / 4, pz.getY(i) / hm); }
      const o = m(gt, new THREE.MeshStandardMaterial({ map: texPans[(k + 1) % 2], roughness: 0.95, side: THREE.DoubleSide }), sx * L / 2, zt, 0); o.rotation.y = sx * Math.PI / 2; }
    // toit de chaume : deux pans épais (débords de 0,5 m), faîtage
    const lp = (l / 2 + 0.55) / Math.cos(pente), ep = 0.32;
    for (const sz of [-1, 1]) {
      const pan = uvMonde(new THREE.BoxGeometry(L + 1.0, ep, lp)), o = m(pan, matChaume, 0, 0, 0);
      o.rotation.x = sz * pente; o.position.set(0, hf - Math.sin(pente) * lp / 2 + 0.05, sz * Math.cos(pente) * lp / 2);
    }
    m(new THREE.CylinderGeometry(0.2, 0.2, L + 1.05, 8).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ map: texChaume, color: 0x9a8a68, roughness: 1 }), 0, hf + 0.1, 0);
    // porte de planches (façade avant, z+), seuil ; fenêtre à volet ouvert sur la même façade
    const dx = -L / 2 + 0.9 + (k % 2) * (L - 1.8 - 0.9);
    m(new THREE.BoxGeometry(0.95, 1.85, 0.06), matPorte, dx, so + 0.92, l / 2 + 0.03);
    m(new THREE.BoxGeometry(1.15, 0.12, 0.14), M.bois, dx, so + 1.9, l / 2 + 0.05);
    m(uvMonde(new THREE.BoxGeometry(1.2, 0.18, 0.5)), matSolin, dx, so - 0.09, l / 2 + 0.25);
    const fx = dx + (dx < 0 ? 1.7 : -1.7);
    m(new THREE.BoxGeometry(0.55, 0.5, 0.04), matNoir, fx, so + 1.35, l / 2 + 0.02, false);
    const volet = m(new THREE.BoxGeometry(0.55, 0.5, 0.04), matPorte, fx + 0.29, so + 1.35, l / 2 + 0.3); volet.rotation.y = -1.25;
    // bûcher contre un pignon, tonneau, banc
    const bx = (k % 2 ? -1 : 1) * (L / 2 + 0.35), buche = new THREE.CylinderGeometry(0.08, 0.08, 0.55, 7).rotateX(Math.PI / 2);
    const im = new THREE.InstancedMesh(buche, new THREE.MeshStandardMaterial({ color: 0x7a5a3a, roughness: 1 }), 30), mm = new THREE.Matrix4();
    let n = 0; for (let r = 0; r < 5; r++) for (let c = 0; c < 6 - (r > 2 ? 1 : 0); c++) { mm.makeTranslation(bx, so - 0.35 + 0.09 + r * 0.155, -l / 2 + 0.5 + c * 0.17 + (r % 2) * 0.08); im.setMatrixAt(n++, mm); }
    im.count = n; im.castShadow = true; g.add(im);
    if (k % 3 !== 1) { const t = m(new THREE.CylinderGeometry(0.3, 0.27, 0.8, 12), new THREE.MeshStandardMaterial({ map: M.bois.map, color: 0x8a6a48, roughness: 0.9 }), dx + (dx < 0 ? -0.95 : 0.95), so - 0.05, l / 2 + 0.55); t.position.y = hauteurTerrain(...coin(dx + (dx < 0 ? -0.95 : 0.95), l / 2 + 0.55)) - z0 + 0.4; }
    if (k % 2 === 0) { const zb = hauteurTerrain(...coin(fx, l / 2 + 0.45)) - z0; m(new THREE.BoxGeometry(1.3, 0.07, 0.3), M.bois, fx, zb + 0.45, l / 2 + 0.45); for (const sx of [-0.5, 0.5]) m(new THREE.BoxGeometry(0.07, 0.45, 0.25), M.bois, fx + sx, zb + 0.22, l / 2 + 0.45); }
    obstacles.push({ poly, village: false, medievalSeulement: true });
    MAISONS.push({ x, y, poly });
  }
  // places du hameau : on cherche autour de chaque point voulu une place plane, hors des chemins, des arbres et des murs
  {
    const arbres = data.arbres.map((a) => [a[0], a[1]]);
    let k = 0;
    for (const [x0, y0, L, l] of MASURES) {
      let fait = false;
      for (let r = 0; r < 12 && !fait; r += 1.5) for (let a = 0; a < 6.28 && !fait; a += 0.6) {
        const x = x0 + Math.cos(a) * r, y = y0 + Math.sin(a) * r;
        // la porte regarde le chemin le plus proche
        let best = null; for (let q = 0; q < 6.28; q += 0.26) for (let d = 3; d < 16; d += 1) if (surChemin(x + Math.cos(q) * d, y + Math.sin(q) * d)) { if (!best || d < best[1]) best = [q, d]; break; }
        const ang = best ? best[0] + Math.PI / 2 : (k * 1.3);
        const ca = Math.cos(ang), sa = Math.sin(ang), co = (lx, lz) => [x + lx * ca + lz * sa, y + lx * sa - lz * ca];
        const ech = []; for (let u = -L / 2 - 1.2; u <= L / 2 + 1.2; u += 1) for (let v = -l / 2 - 1.2; v <= l / 2 + 2.2; v += 1) ech.push(co(u, v));
        const zs = ech.map((p) => hauteurTerrain(...p));
        if (Math.max(...zs) - Math.min(...zs) > 1.1) continue;
        if (ech.some((p) => surChemin(...p) || dansLePasse(() => bloque(...p)))) continue;
        if (arbres.some((t) => Math.hypot(t[0] - x, t[1] - y) < Math.max(L, l) / 2 + 2.2)) continue;
        if (MAISONS.some((h) => Math.hypot(h.x - x, h.y - y) < 9)) continue;
        if (x > JARDIN.x0 - L / 2 - 2 && x < JARDIN.x1 + L / 2 + 2 && y > JARDIN.y0 - L / 2 - 2 && y < JARDIN.y1 + L / 2 + 2) continue;
        if (Math.hypot(x - CENTRE_BROUILLARD[0], y - CENTRE_BROUILLARD[1]) > RAYON_BROUILLARD - 12) continue;
        masure(x, y, ang, L, l, k++); fait = true;
      }
    }
  }
  // ---- le potager du colombier : un grand jardin clos de plessis (environ 18 × 19 m) qui englobe le colombier et
  // s'étend vers le nord ; planches de choux, poireaux, oignons, fèves, pois ramés et simples ; les chemins le traversent
  {
    const C = COLOMBIER, { x0, x1, y0, y1 } = JARDIN, g = new THREE.Group(); G.vie.add(g);
    const arbres = data.arbres.map((t) => [t[0], t[1]]);
    const dansCouloir = (x, y) => { const dx = x - C.c[0], dy = y - C.c[1], lon = dx * C.dir[0] + dy * C.dir[1], lat = Math.abs(-dx * C.dir[1] + dy * C.dir[0]); return lon > 0 && lat < 1.1; };
    const libre = (x, y) => !surChemin(x, y) && Math.hypot(x - C.c[0], y - C.c[1]) > C.r + 1.3 && !dansCouloir(x, y) && !arbres.some((t) => Math.hypot(t[0] - x, t[1] - y) < 1.4) && !dansLePasse(() => bloque(x, y));
    const terre = toileCanvas(128, 128, (x, w, h) => { x.fillStyle = '#4a3624'; x.fillRect(0, 0, w, h); for (let k = 0; k < 900; k++) { const v = 50 + alea() * 50; x.fillStyle = `rgba(${v},${v * 0.75 | 0},${v * 0.5 | 0},0.6)`; x.fillRect(alea() * w, alea() * h, 2, 2); } for (let y = 6; y < h; y += 14) { x.fillStyle = 'rgba(25,18,10,0.45)'; x.fillRect(0, y, w, 3); } });
    const matTerre = new THREE.MeshStandardMaterial({ map: terre, roughness: 1 }), matOsier = new THREE.MeshStandardMaterial({ color: 0x7a6040, roughness: 1 });
    const P = (x, y, dz = 0) => V(x, y, hauteurTerrain(x, y) + dz);
    const listes = { choux: [], poireaux: [], oignons: [], feves: [], rames: [], feuilles: [], simples: [], fleursJ: [], fleursV: [] };
    const CULTURES = ['choux', 'poireaux', 'oignons', 'feves', 'pois', 'simples'];
    let rang = 0;
    for (let y = y0 + 1.2; y < y1 - 0.8; y += 1.6, rang++) {
      const cult = CULTURES[rang % CULTURES.length];
      let deb = null;
      for (let x = x0 + 0.8; x <= x1 - 0.6 + 0.01; x += 0.5) {
        const ok = x <= x1 - 0.6 && libre(x, y) && libre(x, y - 0.5) && libre(x, y + 0.5);
        if (ok && deb == null) deb = x;
        if ((!ok || x - deb >= 4.5) && deb != null) {
          const fin = ok ? x : x - 0.5;
          if (fin - deb >= 1.5) {
            const L = fin - deb, cx = (deb + fin) / 2, sb = new THREE.BoxGeometry(L, 0.22, 1.1); { const uv = sb.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * L / 3, uv.getY(i)); }
            const m = new THREE.Mesh(sb, matTerre); m.position.copy(P(cx, y, 0.02)); m.receiveShadow = true; g.add(m);
            for (const dy of [-0.57, 0.57]) { const o = new THREE.Mesh(new THREE.BoxGeometry(L + 0.1, 0.24, 0.06), matOsier); o.position.copy(P(cx, y + dy, 0.04)); g.add(o); }
            for (let u = deb + 0.25; u < fin - 0.1; u += cult === 'poireaux' || cult === 'oignons' ? 0.22 : cult === 'pois' ? 0.8 : 0.55) {
              const r = alea;
              if (cult === 'choux') for (const dy of [-0.25, 0.25]) listes.choux.push([u, y + dy, 0.2, 0.8 + r() * 0.4]);
              else if (cult === 'poireaux') for (const dy of [-0.3, 0, 0.3]) listes.poireaux.push([u, y + dy, 0.12, 0.8 + r() * 0.4]);
              else if (cult === 'oignons') for (const dy of [-0.3, 0, 0.3]) { listes.oignons.push([u, y + dy, 0.14, 0.8 + r() * 0.3]); listes.poireaux.push([u, y + dy, 0.12, 0.45 + r() * 0.2]); }
              else if (cult === 'feves') for (const dy of [-0.25, 0.25]) listes.feves.push([u, y + dy, 0.3, 0.7 + r() * 0.5]);
              else if (cult === 'pois') { listes.rames.push([u, y, 0.1, 1]); for (let z = 0.4; z < 1.5; z += 0.28) listes.feuilles.push([u + (r() - 0.5) * 0.3, y + (r() - 0.5) * 0.4, z, 0.7 + r() * 0.5]); }
              else { listes.simples.push([u, y + (r() - 0.5) * 0.4, 0.15, 0.7 + r() * 0.7]); if (r() < 0.6) (r() < 0.5 ? listes.fleursJ : listes.fleursV).push([u + 0.2, y + (r() - 0.5) * 0.5, 0.42, 0.8 + r() * 0.5]); }
            }
          }
          deb = ok ? x : null;
        }
      }
    }
    const inst = (geo, mat, liste) => { if (!liste.length) return; const im = new THREE.InstancedMesh(geo, mat, liste.length), mm = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
      liste.forEach(([x, y, dz, sc], i) => { e.set(0, alea() * 6.28, 0); q.setFromEuler(e); mm.compose(P(x, y, dz), q, new THREE.Vector3(sc, sc, sc)); im.setMatrixAt(i, mm); });
      im.castShadow = true; im.receiveShadow = true; g.add(im); };
    inst(new THREE.SphereGeometry(0.2, 9, 7).scale(1, 0.75, 1), new THREE.MeshStandardMaterial({ color: 0x7f9a7a, roughness: 0.75 }), listes.choux);
    inst(new THREE.CylinderGeometry(0.02, 0.025, 0.5, 5).translate(0, 0.25, 0), new THREE.MeshStandardMaterial({ color: 0x5f7f4a, roughness: 0.8 }), listes.poireaux);
    inst(new THREE.SphereGeometry(0.05, 8, 6).scale(1, 0.85, 1), new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.6 }), listes.oignons);
    inst(new THREE.IcosahedronGeometry(0.22, 0).scale(1, 1.5, 1), new THREE.MeshStandardMaterial({ color: 0x55783c, roughness: 0.85, flatShading: true }), listes.feves);
    inst(new THREE.ConeGeometry(0.35, 1.9, 4, 1, true).translate(0, 0.95, 0), new THREE.MeshStandardMaterial({ color: 0x8a7050, roughness: 1, wireframe: true }), listes.rames);
    inst(new THREE.IcosahedronGeometry(0.17, 0), new THREE.MeshStandardMaterial({ color: 0x4f7a34, roughness: 0.85, flatShading: true }), listes.feuilles);
    inst(new THREE.IcosahedronGeometry(0.2, 0).scale(1, 0.7, 1), new THREE.MeshStandardMaterial({ color: 0x6f8a4e, roughness: 0.9, flatShading: true }), listes.simples);
    inst(new THREE.SphereGeometry(0.05, 6, 5), new THREE.MeshStandardMaterial({ color: 0xc9a83a, roughness: 0.7 }), listes.fleursJ);
    inst(new THREE.SphereGeometry(0.05, 6, 5), new THREE.MeshStandardMaterial({ color: 0x8a6ab0, roughness: 0.7 }), listes.fleursV);
    // clôture de plessis, interrompue là où passent les chemins ; une entrée au milieu du côté nord et du côté sud
    const texPlessis = toileCanvas(128, 64, (x, w, h) => { x.fillStyle = '#5a4630'; x.fillRect(0, 0, w, h); for (let y = 2; y < h; y += 7) { x.fillStyle = `rgb(${120 + alea() * 30 | 0},${95 + alea() * 25 | 0},${60 + alea() * 20 | 0})`; for (let px = 0; px < w; px += 16) { x.beginPath(); x.ellipse(px + ((y / 7) % 2) * 8, y + 3, 9, 3.2, 0, 0, 7); x.fill(); } } });
    const matPlessis = new THREE.MeshStandardMaterial({ map: texPlessis, roughness: 1, side: THREE.DoubleSide });
    const geoPiquet = new THREE.CylinderGeometry(0.04, 0.045, 1.05, 5), piquets = [];
    const cote = (A, B, entree) => {
      const L = Math.hypot(B[0] - A[0], B[1] - A[1]), t = [(B[0] - A[0]) / L, (B[1] - A[1]) / L];
      for (let u = 0; u < L - 0.01; u += 1) {
        const u1 = Math.min(L, u + 1), m = [A[0] + t[0] * (u + u1) / 2, A[1] + t[1] * (u + u1) / 2];
        if (entree && Math.abs((u + u1) / 2 - L / 2) < 1.1) continue;
        if (surChemin(...m) || dansLePasse(() => bloque(...m)) || arbres.some((q) => Math.hypot(q[0] - m[0], q[1] - m[1]) < 0.8)) continue;
        const a = [A[0] + t[0] * u, A[1] + t[1] * u], b = [A[0] + t[0] * u1, A[1] + t[1] * u1], za = hauteurTerrain(...a), zb = hauteurTerrain(...b);
        const pl = new THREE.PlaneGeometry(u1 - u, 0.85); { const uv = pl.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (u1 - u), uv.getY(i)); }
        const o = new THREE.Mesh(pl, matPlessis); o.position.copy(V(m[0], m[1], (za + zb) / 2 + 0.45)); o.rotation.y = Math.atan2(t[1], t[0]); o.castShadow = true; g.add(o);
        piquets.push(a, b);
        const n = [-t[1] * 0.15, t[0] * 0.15];
        obstacles.push({ poly: [[a[0] + n[0], a[1] + n[1]], [b[0] + n[0], b[1] + n[1]], [b[0] - n[0], b[1] - n[1]], [a[0] - n[0], a[1] - n[1]]], village: false, medievalSeulement: true });
      }
    };
    cote([x0, y0], [x1, y0], true); cote([x1, y0], [x1, y1], false); cote([x1, y1], [x0, y1], true); cote([x0, y1], [x0, y0], false);
    { const im = new THREE.InstancedMesh(geoPiquet, matOsier, piquets.length), mm = new THREE.Matrix4(); piquets.forEach((q, i) => { mm.makeTranslation(...P(q[0], q[1], 0.5).toArray()); im.setMatrixAt(i, mm); }); im.castShadow = true; g.add(im); }
    JEU.potager = [C.c[0], C.c[1] + 5];
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
  // progression : sceaux, sujets écoutés, épreuves manquées (par habitant et en tout), trésors, expertises (id → juste ?),
  // lieux explorés, félicitations déjà montrées
  const ETAT = ['sceaux', 'vus', 'rates', 'tresors', 'expertises', 'lieux', 'oeuvres'];
  const viderEtat = () => { for (const k of ETAT) JEU[k] = {}; JEU.ratesN = 0; JEU.felicite = false; };
  viderEtat();
  const sauver = () => { try { localStorage.setItem(CLE, JSON.stringify({ ...Object.fromEntries(ETAT.map((k) => [k, JEU[k]])), ratesN: JEU.ratesN, felicite: JEU.felicite })); } catch (e) { /* stockage indisponible */ } };
  try { const d = JSON.parse(localStorage.getItem(CLE) || 'null'); if (d) { for (const k of ETAT) JEU[k] = d[k] || {}; JEU.ratesN = d.ratesN || 0; JEU.felicite = !!d.felicite; } } catch (e) { /* stockage indisponible */ }
  const nbSceaux = () => PERSONNAGES.filter((p) => JEU.sceaux[p.id]).length;
  const invite = $('invite'), voile = $('voile'), ecran = $('ecran');
  // ---- points d'expérience et tableau d'honneur
  const LIEUX_JEU = LIEUX.map((l, i) => i).filter((i) => LIEUX[i].p && Math.hypot(LIEUX[i].p[0] - CENTRE_BROUILLARD[0], LIEUX[i].p[1] - CENTRE_BROUILLARD[1]) < RAYON_BROUILLARD - 4);
  function bilan() {
    const n = nbSceaux(), N = PERSONNAGES.length, B = BAREME;
    const lignes = [
      ['Sceaux obtenus', n, N, B.sceau],
      ['Sceaux gagnés du premier coup', PERSONNAGES.filter((p) => JEU.sceaux[p.id] && !JEU.rates[p.id]).length, N, B.premierCoup],
      ['Savoirs écoutés', PERSONNAGES.reduce((s2, p) => s2 + p.sujets.filter((x, k) => JEU.vus[p.id + k]).length, 0), PERSONNAGES.reduce((s2, p) => s2 + p.sujets.length, 0), B.ecoute],
      ['Trésors découverts', TRESORS.filter((o) => JEU.tresors[o.id]).length, TRESORS.length, B.tresor],
      ['Objets bien expertisés', EXPERTISES.filter((o) => JEU.expertises[o.id] === true).length, EXPERTISES.length, B.expertise],
      ['Lieux explorés', LIEUX_JEU.filter((i) => JEU.lieux[i]).length, LIEUX_JEU.length, B.lieu],
      ['Œuvre d’art comprise', JEU.oeuvres.rolin === true ? 1 : 0, 1, B.oeuvre],
    ];
    const total = lignes.reduce((s2, l) => s2 + l[1] * l[3], 0), max = lignes.reduce((s2, l) => s2 + l[2] * l[3], 0);
    const donnees = n + JEU.ratesN + Object.keys(JEU.expertises).length + Object.keys(JEU.oeuvres).length, justes = n + lignes[4][1] + lignes[6][1];
    const reussite = donnees ? justes / donnees : 0;
    const rang = RANGS.find((r) => total / max >= r[0])[1];
    return { lignes, total, max, reussite, donnees, rang, reste: lignes.slice(3).some((l) => l[1] < l[2]) };
  }
  function tableauHTML() {
    const b = bilan();
    return `<table class="tableau"><thead><tr><th>Épreuve</th><th>Réussi</th><th>Points</th></tr></thead><tbody>` +
      b.lignes.map(([t, n, N, pts]) => `<tr><td>${t}<span class="barre"><i style="width:${Math.round(100 * n / (N || 1))}%"></i></span></td><td>${n} / ${N}</td><td>${n * pts} XP</td></tr>`).join('') +
      `</tbody><tfoot><tr><td>Total</td><td></td><td>${b.total} / ${b.max} XP</td></tr></tfoot></table>` +
      `<p class="rang">Réponses justes : <b>${b.donnees ? Math.round(b.reussite * 100) + ' %' : '—'}</b> · Rang : <b>${b.rang}</b></p>`;
  }
  // carte ouverte : flèches, Page suivante / précédente et Espace font défiler ; Échap ferme la carte quand elle n'a qu'un bouton
  function toucheEcran(e) {
    const bx = ecran.querySelector('.boite'); if (!bx) return;
    const pas = { ArrowDown: 60, ArrowUp: -60, PageDown: bx.clientHeight * 0.85, PageUp: -bx.clientHeight * 0.85, Space: bx.clientHeight * 0.85 }[e.code];
    if (pas) { bx.scrollBy({ top: pas, behavior: 'smooth' }); e.preventDefault(); return; }
    const bt = ecran.querySelectorAll('.actions button');
    if (e.code === 'Escape' && bt.length === 1) bt[0].click();
  }
  ecran.addEventListener('wheel', (e) => { const bx = ecran.querySelector('.boite'); if (bx) { bx.scrollTop += e.deltaY; e.preventDefault(); } }, { passive: false });
  function ecranCarte(titre, html, boutons) {
    ecran.innerHTML = `<div class="boite"><h2>${titre}</h2>${html}<div class="actions">${boutons.map((b2, k) => `<button data-k="${k}" class="${b2.classe || ''}">${b2.texte}</button>`).join('')}</div></div>`;
    ecran.style.display = 'grid'; JEU.dialogue = { ecran: true };
    ecran.querySelectorAll('.actions button').forEach((el) => el.addEventListener('click', () => { ecran.style.display = 'none'; JEU.dialogue = null; const a = boutons[+el.dataset.k].action; a && a(); }));
  }
  function feliciter() {
    JEU.felicite = true; sauver();
    const b = bilan();
    ecranCarte('Félicitations, voyageur !', `<p>Les neuf habitants t'ont confié leur sceau : tu as compris comment vit le château d'Oricourt en 1435.</p>${tableauHTML()}` +
      `<p>${b.reste ? "Le château n'a pas encore livré tous ses secrets. Tu peux continuer à explorer pour gagner des points, puis retourner au puits, sous la galerie de la haute-cour, pour rentrer chez toi." : 'Tu as tout trouvé, bravo ! Retourne au puits, sous la galerie de la haute-cour, pour rentrer chez toi.'}</p>`,
      [{ texte: 'Continuer', action: () => annoncer('Le puits t\'attend sous la galerie de la haute-cour.') }]);
  }
  function majCarnet() {
    const b = bilan();
    $('b-carnet').textContent = `Carnet · ${nbSceaux()}/${PERSONNAGES.length} sceaux · ${b.total} XP`;
    $('carnet-liste').innerHTML = `<li class="xp"><b>${b.total} XP</b> · ${b.rang} <button id="carnet-tableau" class="discret">Tableau des points</button></li>` +
      PERSONNAGES.map((p) => JEU.sceaux[p.id] ? `<li><b>✦ ${p.nom}</b> — ${p.savoir}</li>` : `<li class="vide">○ ${p.nom}, ${p.role} : à rencontrer</li>`).join('') +
      (nbSceaux() === PERSONNAGES.length ? '<li><b>Tous les sceaux sont réunis : retourne au puits, sous la galerie.</b></li>' : '') +
      TRESORS.filter((o) => JEU.tresors[o.id]).map((o) => `<li><b>◆ ${o.nom}</b> — ${o.texte}</li>`).join('') +
      EXPERTISES.filter((o) => o.id in JEU.expertises).map((o) => `<li><b>${JEU.expertises[o.id] ? '✔' : '✘'} ${o.nom}</b> : ${o.ancien ? 'existait bien en 1435' : 'anachronisme'}. ${o.texte}</li>`).join('');
    $('carnet-tableau').addEventListener('click', () => { $('carnet').style.display = 'none'; ecranCarte('Ton tableau des points', tableauHTML(), [{ texte: 'Fermer' }]); });
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
      { texte: nbSceaux() === PERSONNAGES.length ? 'Retourner au puits' : 'Continuer à parler', classe: 'guide', action: () => { if (nbSceaux() === PERSONNAGES.length) { fermerDialogue(); feliciter(); } else rendre(p, { dit: 'Autre chose ?', choix: choixDeBase(p) }); } },
      { texte: 'Partir', classe: 'rapide', dire: 'Merci, au revoir.', action: () => { fermerDialogue(); if (nbSceaux() === PERSONNAGES.length && !JEU.felicite) feliciter(); } }] });
    VIV.geste(p.id, 'oui');
  }
  function rater(p) {
    JEU.rates[p.id] = 1; JEU.ratesN += 1; sauver(); majCarnet();
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
  $('carnet-zero').addEventListener('click', () => { viderEtat(); sauver(); majCarnet(); for (const o of OBJETS) o.maj(); });
  let cible = null;
  const agir = () => {
    if (!cible || JEU.dialogue) return;
    if (cible === 'puits') ecranTexte(FIN, () => ecranCarte("Ton tableau d'honneur", tableauHTML(), [{ texte: "Revenir aujourd'hui", action: () => { changerEpoque('actuel'); annoncer('Bienvenue de retour au XXIe siècle. Ton carnet garde tout ce que tu as appris.'); } }]));
    else if (cible.objet) examiner(cible); else ouvrirDialogue(cible);
  };
  // ---- trésors cachés et objets à expertiser
  const OBJETS = [];
  {
    const ancreDe = (o) => { let a = o.ancre; if (a === 'grande_salle') a = GRANDE_SALLE.P(10.5, 3.6); else if (a === 'salle') a = SALLE.centre; else if (a === 'colombier') a = COLOMBIER.c; else if (a === 'puits') a = PUITS; const d = o.decal || [0, 0]; return [a[0] + d[0], a[1] + d[1]]; };
    const poser = (o, type) => {
      const [x, y] = placeLibre(...ancreDe(o)), g = fabriquer(o.forme);
      const z = o.ancre === 'salle' ? SALLE.sol : hauteurSol(x, y);   // la salle voûtée a son propre sol
      g.position.copy(V(x, y, z)); g.rotation.y = (o.id.length * 1.7) % 6.28; G.jeu.add(g);
      const e = { ...o, objet: type, x, y, g, ph: o.id.length };
      if (type === 'tresor') { e.eclat = etincelle(); e.eclat.position.copy(V(x, y, z + 0.95)); G.jeu.add(e.eclat); }
      e.fait = () => type === 'tresor' ? !!JEU.tresors[o.id] : (o.id in JEU.expertises);
      e.maj = () => { if (e.eclat) e.eclat.visible = !e.fait(); };
      e.maj(); OBJETS.push(e);
    };
    OBJETS.push({ id: 'oeuvre', objet: 'oeuvre', nom: OEUVRE.titre, x: CHAPELLE.chevalet[0], y: CHAPELLE.chevalet[1], ph: 0, fait: () => false, maj() {} });
    for (const o of TRESORS) poser(o, 'tresor');
    for (const o of EXPERTISES) poser(o, 'expertise');
  }
  JEU.objets = OBJETS;
  function examiner(o) {
    if (o.objet === 'oeuvre') {
      const Q = OEUVRE.quiz, enJeu = epoque === 'jeu', repondu = JEU.oeuvres.rolin != null;
      const quiz = () => ecranCarte(OEUVRE.titre, `<p><b>${Q.question}</b></p>`, Q.choix.map((c, k) => ({ texte: c, classe: 'choix', action: () => {
        const juste = k === Q.juste; JEU.oeuvres.rolin = juste; sauver(); majCarnet();
        ecranCarte(OEUVRE.titre, `<p>${juste ? Q.bravo : Q.rate}</p>` + (juste ? `<p class="gain">+${BAREME.oeuvre} XP · Œuvre d’art comprise</p>` : ''), [{ texte: 'Fermer' }]);
      } })));
      ecranCarte(OEUVRE.titre, `<div class="oeuvre"><img src="${OEUVRE.image}" alt="${OEUVRE.titre}"><p class="cartel">${OEUVRE.cartel}</p></div>` +
        OEUVRE.parties.map(([t, p]) => `<h3>${t}</h3><p>${p}</p>`).join('') +
        `<p><a href="${OEUVRE.video}" target="_blank" rel="noopener">▶ Voir la vidéo de la restauration</a></p>` +
        (enJeu && !repondu ? `<p><i>Une question t'attend : as-tu bien regardé le tableau ? (+${BAREME.oeuvre} XP)</i></p>` : ''),
        enJeu && !repondu ? [{ texte: 'Répondre à la question', action: quiz }, { texte: 'Plus tard', classe: 'discret' }] : [{ texte: 'Fermer' }]);
      return;
    }
    if (o.objet === 'tresor') {
      JEU.tresors[o.id] = 1; sauver(); majCarnet(); o.maj();
      const n = TRESORS.filter((t) => JEU.tresors[t.id]).length;
      ecranCarte('Trésor découvert !', `<h3>${o.nom}</h3><p>${o.texte}</p><p class="gain">+${BAREME.tresor} XP · trésor ${n} sur ${TRESORS.length}</p>`, [{ texte: 'Continuer' }]);
      return;
    }
    const verdict = (dit) => {
      const juste = dit === o.ancien; JEU.expertises[o.id] = juste; sauver(); majCarnet(); o.maj();
      ecranCarte(juste ? 'Bien vu !' : 'Raté…', `<h3>${o.nom} : ${o.ancien ? 'il existe bien en 1435' : "c'est un anachronisme"}</h3><p>${o.texte}</p>` +
        `<p class="gain">${juste ? '+' + BAREME.expertise + ' XP' : '0 XP, mais tu le sais maintenant !'}</p>`, [{ texte: 'Continuer' }]);
    };
    ecranCarte('Objet à expertiser', `<h3>${o.nom}</h3><p>Cet objet a-t-il sa place à Oricourt, en l'an 1435 ? Réfléchis bien : tu n'as droit qu'à une réponse.</p>`,
      [{ texte: 'Oui, il existe en 1435', action: () => verdict(true) }, { texte: "Non, c'est un anachronisme !", action: () => verdict(false) }, { texte: 'Plus tard', classe: 'discret' }]);
  }
  invite.addEventListener('click', agir);
  JEU.touche = (e) => {
    if (epoque === 'medieval' && !JEU.dialogue && (e.code === 'KeyE' || e.code === 'Enter') && cible && cible.objet === 'oeuvre') { agir(); return true; }
    if (JEU.dialogue && JEU.dialogue.ecran && epoque !== 'actuel') { toucheEcran(e); return true; }
    if (epoque !== 'jeu') return false;
    if (JEU.dialogue) {
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
      let lieu = null;
      if (s.lieu) { lieu = lieuRoutine(s.lieu, base, s); if (!lieu) continue; xy = lieu.xy; }
      else if (s.a === 'base') xy = base;
      else if (s.a && s.a.arche != null) xy = GAL.pt(GAL.sArches[Math.min(s.a.arche, GAL.sArches.length - 1)], s.a.d ?? 1.9);
      else if (s.a === 'puits') { const d = [base[0] - PUITS[0], base[1] - PUITS[1]], L = Math.hypot(d[0], d[1]) || 1; xy = [PUITS[0] + d[0] / L * 1.3, PUITS[1] + d[1] / L * 1.3]; }
      else if (Array.isArray(s.a)) for (const o of [s.a, ...(s.ou || []), [-s.a[0], s.a[1]], [s.a[0], -s.a[1]], [-s.a[0], -s.a[1]]]) {   // place voulue, sinon d'autres côtés
        const c = placeLibre(base[0] + o[0], base[1] + o[1]);
        if (!dansLePasse(() => bloque(c[0], c[1])) && (!prec || libreSur([prec.x, prec.y], c)) && libreSur(c, postes.length ? [postes[0].x, postes[0].y] : base)) { xy = c; break; }
      }
      if (s.lieu) {
        const cap0 = lieu.vers ? capVers(lieu.vers[0] - xy[0], lieu.vers[1] - xy[1]) : null;
        postes.push({ ...s, x: xy[0], y: xy[1], z: lieu.z ?? null, cap: cap0, entree: lieu.entree || null });
        continue;
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
    if (R.chemins) {
      // chemins entre postes : à l'aller, on suit l'entrée imposée du poste d'arrivée (escalier, tourelle), au retour on la
      // reprend à l'envers ; entre deux, l'itinéraire est calculé au sol
      postes.forEach((P, k) => {
        const Q = postes[(k - 1 + postes.length) % postes.length], via = [];
        const depart = Q.entree ? [...Q.entree].reverse() : [];
        via.push(...depart);
        const de = depart.length ? depart[depart.length - 1] : [Q.x, Q.y], vers = P.entree ? P.entree[0] : [P.x, P.y];
        if (!(Q.z != null && P.z != null)) { const it = itineraire(de, vers); if (it) via.push(...it); }
        if (P.entree) via.push(...P.entree);
        P.via = via;
      });
      return { trajet: R.trajet || 'marcher', postes };
    }
    if (postes.length > 1 && !libreSur([postes[postes.length - 1].x, postes[postes.length - 1].y], [postes[0].x, postes[0].y])) postes.length = 1;
    return { trajet: R.trajet || 'marcher', postes };
  }
  // Personnages Meshy (12 novembre) : un modèle texturé et animé par habitant, dans studio/meshy/. Les habitants habillés
  // du Studio (désactivés le 11 novembre : postures jugées étranges) ne servent plus que si un modèle Meshy manque.
  const MESHY = new Set(['guillemette', 'aubert', 'mahaut', 'etienne', 'perrin', 'girard', 'huguenin', 'jehanne', 'colin',
    'palefrenier', 'jardinier', 'forgeron', 'porteuse', 'sergent']);
  JEU.chargerVivants = () => {
    if (VIV.etat !== 'attente') return; VIV.etat = 'charge';
    annoncer('Les habitants de 1435 arrivent…');
    const habitants = [
      ...JEU.pnj.map((p) => ({ id: p.id, desc: { ...p.studio, objetMarche: (ROUTINES[p.id] || {}).objetMarche }, act: p.activite, objet: p.g, routine: routineDe(p.id, [p.x, p.y]) })),
      ...figurants.map((f) => ({ id: f.id, modele: f.modele, desc: f.studio, act: f.activite, objet: f.g, routine: f.activite.marche ? null : routineDe(f.id, [f.g.position.x, -f.g.position.z]) })),
    ].filter((h) => MESHY.has(h.modele || h.id)).map((h) => ({ ...h, meshy: h.modele || h.id }));
    JEU.routines = Object.fromEntries(habitants.map((h) => [h.id, h.routine]));
    chargerVivants({ groupeBetes, betes: BETES, habitants, sol: (x, y) => hauteurSol(x, y), etage: (x, y, z) => etageEn(x, y, z), libre: (x, y) => dansLePasse(() => !bloque(x, y)) && !surPlancher(x, y, 0.5) })
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
    if (epoque !== 'jeu') {
      for (const p of JEU.pnj) p.el.style.display = 'none';
      // visite de 1435 : seul le tableau du chevalet se regarde avec E
      const oe = OBJETS.find((o) => o.objet === 'oeuvre');
      cible = mode === 'pied' && oe && Math.hypot(marcheur.x - oe.x, marcheur.y - oe.y) < 1.9 ? oe : null;
      if (cible && !JEU.dialogue) { invite.textContent = 'E · Regarder le tableau'; invite.style.display = 'block'; } else invite.style.display = 'none';
      return;
    }
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
    if (mode === 'pied') {
      let dO = 1.9;
      for (const o of OBJETS) {
        const d = Math.hypot(marcheur.x - o.x, marcheur.y - o.y);
        if (o.eclat && o.eclat.visible) { o.eclat.material.opacity = d < 14 ? 0.45 + 0.4 * Math.sin(JEU.t * 3.2 + o.ph) : 0; o.eclat.scale.setScalar(0.3 + 0.08 * Math.sin(JEU.t * 2.1 + o.ph)); }
        if ((epoque === 'jeu' || o.objet === 'oeuvre') && !o.fait() && d < dO && (!proche || d < dMin)) { dO = d; cible = o; }
      }
      for (const i of LIEUX_JEU) if (!JEU.lieux[i] && Math.hypot(marcheur.x - LIEUX[i].p[0], marcheur.y - LIEUX[i].p[1]) < 7) {
        JEU.lieux[i] = 1; sauver(); majCarnet(); annoncer(`Lieu exploré : ${LIEUX[i].titre.replace(/ \(.*\)$/, '')} (+${BAREME.lieu} XP)`);
      }
    }
    if (mode === 'pied' && nbSceaux() === PERSONNAGES.length && Math.hypot(marcheur.x - PUITS[0], marcheur.y - PUITS[1]) < 3.2) cible = 'puits';
    if (cible && !JEU.dialogue) { invite.textContent = cible === 'puits' ? 'E · Se pencher au-dessus du puits' : cible.objet === 'oeuvre' ? 'E · Regarder le tableau' : cible.objet ? 'E · Examiner' : `E · Parler à ${cible.nom}`; invite.style.display = 'block'; } else invite.style.display = 'none';
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
window.oricourt = { marcher, touches, SALLES_TOURS, GRANDE_SALLE, hauteurTerrain, ETAGES, CHAPELLE, HERSE, RECON, DONJON, etageEn, PUITS, COLOMBIER, SALLE, GAL, MUSIQUE, renderer, scene, camera, orbite, G, LIEUX, choisir, changerEpoque, passerEnModePied, passerEnModeSurvol, placerMarcheur, marcheur, hauteurSol, data, bloque, marcher, touches, JEU, lancerJeu, THREE };
if (location.hash === '#moyen-age') changerEpoque('medieval');
if (location.hash === '#jeu') lancerJeu();
if (location.hash === '#visite') { placerMarcheur([-12, -14, 14]); passerEnModePied(); }
majAide();
etat('Prêt', 1);
$('chargement').style.display = 'none';
requestAnimationFrame(boucle);
