// Oricourt — habitants et bêtes animés, repris du Studio de vie (D&D « La Stase ») :
//   - animaux : un GLB articulé par espèce, avec ses clips (pas, mange, attente…) et ses robes (studio/animaux/animaux.json) ;
//   - humains : corps de base H01/F01 et pièces de tenue séparées (tunique, chausses, gambison, haubert, surcot…),
//     teintes par masque, zones du corps cachées sous les vêtements (studio/habillage/habillage.json) ;
//   - mouvements : clips de la bibliothèque du Studio reciblés sur le squelette commun (studio/mouvements/mouvements.json),
//     tirés par intention (attendre, parler, guetter, travailler…).
// Les objets de la maquette (figurines de secours) restent en place tant que les modèles ne sont pas chargés.
import * as THREE from 'three';
import { GLTFLoader } from './lib/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from './lib/jsm/libs/meshopt_decoder.module.js';
import { clone as clonerArticule } from './lib/jsm/utils/SkeletonUtils.js';

const BASE = 'studio/';
const chargeur = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const fichiers = new Map();
// les modèles glTF binaires (.glb du Studio) sont rangés en base64 dans des « .modele.json » : l'hébergeur des artefacts
// ne sert ni .glb ni .bin. Le contenu est identique octet pour octet ; three.js le lit avec parseAsync.
const lireModele = async (f) => {
  const j = await (await fetch(BASE + f.replace(/\.glb$/, '.modele.json'))).json(), s = atob(j.glb), o = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) o[i] = s.charCodeAt(i);
  return chargeur.parseAsync(o.buffer, '');
};
const glb = (f) => { if (!fichiers.has(f)) fichiers.set(f, lireModele(f)); return fichiers.get(f); };
const json = async (f) => (await fetch(BASE + f)).json();
const hache = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; } return h; };
const alea = (graine) => { let g = graine >>> 0; return () => { g = (g + 0x6D2B79F5) >>> 0; let t = Math.imul(g ^ (g >>> 15), 1 | g); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

// ------------------------------------------------------------------------------------------------ mouvements
class Mouvements {
  constructor(index) { this.index = index; this.paquets = new Map(); this.parCorps = new Map(); }
  static async charger() { return new Mouvements(await json('mouvements/mouvements.json')); }
  clesDe(intention) { const i = this.index.intentions[intention]; return i ? i.c.filter((c) => this.index.clips[c]) : []; }
  boucle(cle) { const c = this.index.clips[cle]; return !!c && (c.n === 'B' || c.n === 'L'); }
  vitesse(cle) { const c = this.index.clips[cle]; return (c && c.v) || 1; }
  async precharger(intentions) {
    const paquets = new Set();
    for (const it of intentions) for (const c of this.clesDe(it)) paquets.add(this.index.clips[c].p);
    await Promise.all([...paquets].map((p) => this.paquet(p)));
  }
  paquet(p) {
    if (!this.paquets.has(p)) this.paquets.set(p, glb('mouvements/' + this.index.paquets[p].fichier).then((g) => new Map(g.animations.map((a) => [a.name, a]))));
    return this.paquets.get(p);
  }
  /** Le clip `cle` adapté à un corps : trajet du bassin à la hauteur de ses hanches, sans dérive pour les allures en boucle. */
  async clip(cle, corps) {
    const k = corps.id + '|' + cle;
    if (this.parCorps.has(k)) return this.parCorps.get(k);
    const info = this.index.clips[cle];
    if (!info) return null;
    const src = (await this.paquet(info.p)).get(cle);
    if (!src) return null;
    const r0 = this.index.squelette.positions.Hips, h = corps.hanches_pos, kh = h[1] / r0[1];
    const pistes = src.tracks.map((t) => {
      if (t.name !== 'Hips.position') return t;
      const v = Float32Array.from(t.values), n = t.times.length;
      const dx = info.n === 'L' ? v[(n - 1) * 3] - v[0] : 0, dz = info.n === 'L' ? v[(n - 1) * 3 + 2] - v[2] : 0, T = t.times[n - 1] || 1;
      for (let i = 0; i < n; i++) {
        const f = t.times[i] / T;
        v[i * 3] = h[0] + (v[i * 3] - dx * f - r0[0]) * kh;
        v[i * 3 + 1] = h[1] + (v[i * 3 + 1] - r0[1]) * kh;
        v[i * 3 + 2] = h[2] + (v[i * 3 + 2] - dz * f - r0[2]) * kh;
      }
      return new THREE.VectorKeyframeTrack(t.name, t.times, v);
    });
    const c = new THREE.AnimationClip(cle, src.duration, pistes);
    this.parCorps.set(k, c);
    return c;
  }
}

// ------------------------------------------------------------------------------------------------ habillage
const lin = (hex) => new THREE.Color(hex);
function teindre(mat, def, teintes, defauts) {
  const choix = (canal, d) => lin(teintes[(def.teintes || {})[canal]] || defauts[(def.teintes || {})[canal]] || d);
  const u = { uT1: { value: choix('principal', '#7a6a48') }, uT2: { value: choix('secondaire', '#5a4a38') }, uT3: { value: choix('cuir', '#6a4a2a') }, uT4: { value: choix('ornement', '#b8a070') },
    uMasqueCst: { value: new THREE.Vector4(mat.emissive.r, mat.emissive.g, mat.emissive.b, 1) } };
  if (mat.emissiveMap) mat.emissiveMap.colorSpace = THREE.NoColorSpace;
  mat.emissive.setRGB(0, 0, 0); mat.side = THREE.DoubleSide;
  if (def.metal) mat.metalness = Math.min(0.5, def.metal);
  if (def.rugosite) mat.roughness = def.rugosite;
  const acier = def.acier ? lin(teintes.metal || defauts.metal || '#b8b8b8').multiplyScalar(def.acier) : null;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u); if (acier) sh.uniforms.uAcier = { value: acier };
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
uniform vec3 uT1; uniform vec3 uT2; uniform vec3 uT3; uniform vec3 uT4; uniform vec4 uMasqueCst;${acier ? ' uniform vec3 uAcier;' : ''}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
  {
#ifdef USE_EMISSIVEMAP
    vec4 mq = texture2D(emissiveMap, vEmissiveMapUv);
#else
    vec4 mq = uMasqueCst;
#endif
    float orn = clamp((1.0 - mq.a) / 0.85, 0.0, 1.0);
    float s = clamp(mq.r + mq.g + mq.b + orn, 0.0, 1.0);
    ${acier ? 'diffuseColor.rgb = uAcier * (1.0 - s) + diffuseColor.rgb * (uT1 * mq.r + uT2 * mq.g + uT3 * mq.b + uT4 * orn);' : 'diffuseColor.rgb *= vec3(1.0 - s) + uT1 * mq.r + uT2 * mq.g + uT3 * mq.b + uT4 * orn;'}
  }`)
      .replace('#include <emissivemap_fragment>', '');
  };
  mat.customProgramCacheKey = () => 'teinture_oricourt' + (acier ? '_acier' : '');
}
// peau : la carte de base est un masque (R = teint, G = lèvres, B = rougeur, A = 1 − 0,8 × sourcils), teinté comme dans le Studio
// (branche simple de personnages_habillage.js, sans les cartes de détail J63)
const TEINTS = ['#e3bd9c', '#d9b08c', '#cfa07c', '#e8c6a8', '#c08f6b', '#d6a985'];
function peau(mat, masque, teintHex, cheveuxHex) {
  if (mat.map) { mat.map.colorSpace = THREE.NoColorSpace; mat.map.needsUpdate = true; }
  const teint = lin(teintHex), u = { uMasque: { value: masque }, uTeint: { value: teint },
    uLevres: { value: teint.clone().multiply(new THREE.Color(0.74, 0.47, 0.45)) }, uSourcils: { value: lin(cheveuxHex).multiplyScalar(0.75) } };
  mat.metalness = 0; mat.roughness = 0.55;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float _zones; uniform int uMasque; varying float vCache;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCache = (int(_zones + 0.5) & uMasque) != 0 ? 1.0 : 0.0;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vCache; uniform vec3 uTeint; uniform vec3 uLevres; uniform vec3 uSourcils;')
      .replace('#include <map_fragment>', `if (vCache > 0.5) discard;
#ifdef USE_MAP
  vec4 dPeau = texture2D(map, vMapUv);
  vec3 cPeau = uTeint * mix(1.0, dPeau.r, 0.85);
  cPeau = mix(cPeau, cPeau * vec3(1.05, 0.80, 0.76), dPeau.b * 0.35);
  cPeau = mix(cPeau, uLevres, dPeau.g * 0.85);
  cPeau = mix(cPeau, uSourcils, clamp((1.0 - dPeau.a) * 1.5, 0.0, 1.0) * 0.55);
  diffuseColor.rgb = cPeau;
#endif`);
  };
  mat.customProgramCacheKey = () => 'peau_oricourt';
}

// yeux : sclère, iris et pupille dessinés d'après la direction depuis le centre du globe (regard vers +Z, comme au Studio)
const IRIS = ['#5a3a22', '#8a6a2f', '#3f7a4a', '#3e6fa8', '#7b8794', '#5a4630'];
function oeil(m, desc) {
  const b = new THREE.Box3().setFromBufferAttribute(m.geometry.attributes.position), c = b.getCenter(new THREE.Vector3());
  const graine = [...JSON.stringify(desc)].reduce((h, x) => (h * 17 + x.charCodeAt(0)) >>> 0, 3);
  const u = { uCentre: { value: c }, uIris: { value: lin((desc.teintes || {}).yeux || IRIS[graine % IRIS.length]) } };
  const o = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25, metalness: 0, name: 'oeil' });
  o.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vOeil; uniform vec3 uCentre;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvOeil = normalize(position - uCentre);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vOeil; uniform vec3 uIris;')
      .replace('#include <map_fragment>', `{ float a = acos(clamp(vOeil.z, -1.0, 1.0));
  vec3 c = vec3(0.86, 0.83, 0.80) * mix(1.0, 0.82, smoothstep(0.5, 1.3, a));
  c = mix(c, uIris * (0.75 + 0.25 * sin(atan(vOeil.y, vOeil.x) * 23.0)), 1.0 - smoothstep(0.40, 0.44, a));
  c = mix(c, vec3(0.03), 1.0 - smoothstep(0.15, 0.18, a));
  diffuseColor.rgb = c; }`);
  };
  o.customProgramCacheKey = () => 'oeil_oricourt';
  return o;
}

// coiffes et accessoires portés par un os (tête, main) : formes simples, aux couleurs de la tenue
function accessoire(type, couleur) {
  const g = new THREE.Group(), mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, ...o });
  const m = (geo, mt, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => { const k = new THREE.Mesh(geo, mt); k.position.set(x, y, z); k.rotation.set(rx, ry, rz); k.castShadow = true; g.add(k); return k; };
  const calotte = (r, haut = 0.5) => new THREE.SphereGeometry(r, 18, 10, 0, Math.PI * 2, 0, Math.PI * haut);
  // repères (os Head, repos identité ; le groupe est remonté de 6 cm à la pose) : sommet du crâne ≈ 0.22 au-dessus du pivot de la tête
  const bonnetDe = (r, mt, haut = 0.36, y = 0.06) => { const k = m(calotte(r, haut), mt, 0, y, 0.004, -0.32); k.scale.set(0.97, 1.0, 1.1); return k; };
  if (type === 'coiffe') {
    const lin = mat(couleur || 0xeee8d8, { side: THREE.DoubleSide });
    bonnetDe(0.146, lin, 0.42, 0.03);
    m(new THREE.CylinderGeometry(0.122, 0.128, 0.15, 16, 1, true, Math.PI * 0.3, Math.PI * 1.4), lin, 0, 0.0, -0.012, -0.1);
  } else if (type === 'chaperon') {
    bonnetDe(0.134, mat(couleur), 0.4, 0.055);
    m(new THREE.TorusGeometry(0.122, 0.028, 8, 18), mat(couleur), 0, 0.1, -0.012, Math.PI / 2 - 0.32);
    m(new THREE.ConeGeometry(0.035, 0.32, 8), mat(couleur), 0, 0.04, -0.15, -2.5);
  } else if (type === 'chapel') {
    const fer = mat(0x8e9298, { metalness: 0.7, roughness: 0.4 });
    bonnetDe(0.136, fer, 0.4, 0.06);
    m(new THREE.CylinderGeometry(0.2, 0.22, 0.012, 22), fer, 0, 0.11, -0.004, -0.12);
  } else if (type === 'chapeau') {
    const paille = mat(couleur || 0xc9b06a);
    m(new THREE.CylinderGeometry(0.24, 0.25, 0.014, 22), paille, 0, 0.13, -0.005, -0.12);
    m(new THREE.CylinderGeometry(0.09, 0.112, 0.1, 16), paille, 0, 0.18, -0.01, -0.12);
  } else if (type === 'bonnet') {
    bonnetDe(0.132, mat(couleur), 0.4, 0.055);
  } else if (type === 'tonsure') {
    m(new THREE.CircleGeometry(0.045, 16), mat(0xd9ab86), 0, 0.178, -0.03, -Math.PI / 2 + 0.3);
  } else if (type === 'lance') {
    m(new THREE.CylinderGeometry(0.016, 0.016, 2.3, 6), mat(0x6b4a2f), 0, 0.25, 0);
    m(new THREE.ConeGeometry(0.04, 0.28, 6), mat(0x9aa0a6, { metalness: 0.7, roughness: 0.35 }), 0, 1.53, 0);
  } else if (type === 'marteau') {
    m(new THREE.CylinderGeometry(0.014, 0.014, 0.36, 6), mat(0x6b4a2f), 0, 0.08, 0);
    m(new THREE.BoxGeometry(0.06, 0.06, 0.15), mat(0x6a6e72, { metalness: 0.6, roughness: 0.5 }), 0, 0.25, 0);
  } else if (type === 'panier') {
    m(new THREE.CylinderGeometry(0.17, 0.12, 0.16, 12, 1, true), mat(0xa88a52, { side: THREE.DoubleSide }), 0, -0.12, 0.08);
  } else if (type === 'livre') {
    m(new THREE.BoxGeometry(0.16, 0.04, 0.22), mat(0x5a2f22), 0, -0.02, 0.06, 0.3);
  }
  return g;
}

class Habilleur {
  constructor(index, mvt) { this.index = index; this.mvt = mvt; }
  static async charger(mvt) { return new Habilleur(await json('habillage/habillage.json'), mvt); }
  corpsDe(sexe) { return this.index.corps.find((c) => c.sexe === (sexe === 'F' ? 'F' : 'M')); }
  /** Un habitant : corps cloné, pièces liées à son squelette, teintes, coiffe ; retourne {racine, os, corps, mixer}. */
  async habiller(desc) {
    const corps = this.corpsDe(desc.sexe), S = corps.sexe === 'F' ? 'F' : 'H';
    // sous une coiffe, un chaperon, un bonnet ou un chapel, les cheveux sont rentrés : la coupe dépasserait du couvre-chef
    const couvert = (desc.coiffes || []).some((c) => c === 'coiffe');
    const ids = (desc.pieces || []).filter((p) => !(couvert && p.startsWith('coupe_')));
    const [gCorps, ...gPieces] = await Promise.all([glb('habillage/' + corps.fichier), ...ids.map((p) => glb('habillage/' + this.index.pieces[p].fichiers[corps.sexe]))]);
    const racine = clonerArticule(gCorps.scene);
    const os = new Map();
    racine.traverse((o) => { if (o.isBone) os.set(o.name, o); });
    const zones = this.index.zones;
    const masque = ids.reduce((s, p) => (this.index.pieces[p].masque || []).reduce((t, z) => (zones.indexOf(z) >= 0 ? t | (1 << zones.indexOf(z)) : t), s), 0);
    let support = null;
    const graine = [...JSON.stringify(desc)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
    const teintPeau = (desc.teintes || {}).peau || TEINTS[graine % TEINTS.length];
    racine.traverse((o) => {
      if (!o.isSkinnedMesh) return;
      o.castShadow = true; o.receiveShadow = true;
      if (/^oeil/.test(o.material.name || '')) { o.material = oeil(o, desc); return; }
      if (o.geometry.attributes._zones && /^peau/.test(o.material.name || '')) { o.material = o.material.clone(); peau(o.material, masque, teintPeau, (desc.teintes || {}).cheveux || '#4a2f1d'); support = o.parent; }
    });
    const teintes = { ...(desc.teintes || {}) };
    gPieces.forEach((g, i) => {
      const def = this.index.pieces[ids[i]];
      g.scene.traverse((o) => {
        if (!o.isSkinnedMesh) return;
        const m = o.clone();
        m.material = o.material.clone();
        teindre(m.material, def, teintes, this.index.teintes_defaut);
        const sq = new THREE.Skeleton(o.skeleton.bones.map((b) => os.get(b.name) || b), o.skeleton.boneInverses);
        m.bind(sq, o.bindMatrix);
        m.castShadow = true; m.receiveShadow = true;
        (support || racine).add(m);
      });
    });
    const tete = os.get('Head'), mainD = os.get('RightHand');
    for (const a of desc.coiffes || []) { const acc = accessoire(a, desc.couleurCoiffe); acc.position.y = 0.06; if (S === 'F') { acc.scale.setScalar(0.94); acc.position.y = 0.055; } tete.add(acc); }
    if (desc.objet && mainD) { const o = accessoire(desc.objet); o.rotation.set(0, 0, desc.objet === 'lance' ? 0.0 : 0.3); mainD.add(o); }
    racine.scale.setScalar(desc.echelle || 1);
    racine.userData.corps = corps;
    return { racine, os, corps, mixer: new THREE.AnimationMixer(racine) };
  }
}

// ------------------------------------------------------------------------------------------------ un habitant qui vit
class Habitant {
  constructor(h, mvt, act, graine) {
    Object.assign(this, h); this.mvt = mvt; this.act = act; this.R = alea(graine); this.actions = new Map(); this.fond = null; this.geste = null; this.prochain = 3 + this.R() * 6;
    this.mixer.addEventListener('finished', (e) => { if (this.geste && e.action === this.geste) { this.geste = null; if (this.fond) this.fond.reset().fadeIn(0.35).play(); e.action.fadeOut(0.35); } });
  }
  async action(intention) {
    const cles = this.mvt.clesDe(intention);
    if (!cles.length) return null;
    const cle = cles[Math.floor(this.R() * cles.length)], k = cle;
    if (!this.actions.has(k)) {
      const clip = await this.mvt.clip(cle, this.corps);
      if (!clip) return null;
      const a = this.mixer.clipAction(clip);
      if (!this.mvt.boucle(cle)) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
      a.userData = { cle, v: this.mvt.vitesse(cle) };
      this.actions.set(k, a);
    }
    return this.actions.get(k);
  }
  async poser(intention, fondu = 0.45) {
    if (this.intentionFond === intention) return;
    this.intentionFond = intention;
    const a = await this.action(intention);
    if (!a || this.intentionFond !== intention) return;
    const ancien = this.fond; this.fond = a;
    a.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).fadeIn(fondu).play();
    a.time = this.R() * a.getClip().duration;
    if (ancien && ancien !== a) ancien.fadeOut(fondu);
  }
  async gesticuler(intention) {
    if (this.geste) return;
    const a = await this.action(intention);
    if (!a || a === this.fond || this.geste) return;
    this.geste = a; a.reset().fadeIn(0.3).play();
    if (this.fond) this.fond.fadeOut(0.3);
  }
  maj(dt, parle) {
    if (!this.act.marche) {
      const fond = parle ? (parle.tour === 'pnj' ? 'parler' : 'ecouter') : this.act.fond;
      this.poser(fond);
      this.prochain -= dt;
      if (this.prochain <= 0 && !parle) { this.prochain = this.act.periode[0] + this.R() * (this.act.periode[1] - this.act.periode[0]); const g = this.act.gestes; if (g && g.length) this.gesticuler(g[Math.floor(this.R() * g.length)]); }
    }
    this.mixer.update(dt);
  }
}

// ------------------------------------------------------------------------------------------------ bêtes
function robe(mat, r) {
  if (!r || (!r.t2 && r.t.every((v) => Math.abs(v - 1) < 1e-3))) return;
  const U = { uRobe: { value: new THREE.Vector3(...r.t) }, uRobe2: { value: new THREE.Vector3(...(r.t2 || r.t)) }, uPie: { value: new THREE.Vector4(r.pie || 0, r.ech || 1, Math.random() * 50, 0) } };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = 'varying vec3 vRobe;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vRobe = position;');
    sh.fragmentShader = `varying vec3 vRobe; uniform vec3 uRobe; uniform vec3 uRobe2; uniform vec4 uPie;
      float robeH(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      float robeB(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(robeH(i), robeH(i + vec3(1, 0, 0)), f.x), mix(robeH(i + vec3(0, 1, 0)), robeH(i + vec3(1, 1, 0)), f.x), f.y),
                   mix(mix(robeH(i + vec3(0, 0, 1)), robeH(i + vec3(1, 0, 1)), f.x), mix(robeH(i + vec3(0, 1, 1)), robeH(i + vec3(1, 1, 1)), f.x), f.y), f.z); }
      ` + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      { float masque = diffuseColor.a; vec3 teinte = uRobe;
        if (uPie.x > 0.0) { float b = robeB(vRobe * uPie.y + uPie.z) * 0.65 + robeB(vRobe * uPie.y * 2.3 + uPie.z) * 0.35; teinte = mix(uRobe, uRobe2, smoothstep(uPie.x - 0.03, uPie.x + 0.03, b)); }
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * teinte, masque); diffuseColor.a = 1.0; }`);
  };
  mat.customProgramCacheKey = () => 'robe_oricourt';
}

class Bete {
  constructor(esp, info, racine, ctx, c, rayon, graine) {
    this.esp = esp; this.info = info; this.racine = racine; this.ctx = ctx; this.c = c; this.rayon = rayon; this.R = alea(graine);
    this.mixer = new THREE.AnimationMixer(racine); this.clips = new Map(racine.userData.clips.map((a) => [a.name, a]));
    this.x = c[0]; this.y = c[1]; this.cap = this.R() * 6.28; this.etat = 'pause'; this.t = 1 + this.R() * 4; this.courant = null;
    this.jouer(this.R() < 0.5 ? 'mange' : 'attente');
  }
  jouer(nom) {
    const clip = this.clips.get(nom) || this.clips.get('attente');
    if (!clip || (this.courant && this.courant.getClip() === clip)) return;
    const a = this.mixer.clipAction(clip); a.reset().fadeIn(0.3).play(); a.time = this.R() * clip.duration;
    if (this.courant) this.courant.fadeOut(0.3);
    this.courant = a;
  }
  maj(dt) {
    this.t -= dt;
    if (this.etat === 'pause' && this.t <= 0) {
      for (let k = 0; k < 8; k++) {
        const a = this.R() * 6.28, r = this.rayon * Math.sqrt(this.R()), x = this.c[0] + Math.cos(a) * r, y = this.c[1] + Math.sin(a) * r;
        if (!this.ctx.libre(x, y)) continue;
        this.cible = [x, y]; this.etat = 'marche'; this.jouer(this.clips.has('pas') ? 'pas' : 'course'); break;
      }
      if (this.etat === 'pause') this.t = 2;
    } else if (this.etat === 'marche') {
      const dx = this.cible[0] - this.x, dy = this.cible[1] - this.y, d = Math.hypot(dx, dy);
      const v = ((this.info.clips.pas && this.info.clips.pas.vitesse) || 0.5) * (this.racine.scale.x || 1);
      const capVise = Math.atan2(dy, dx); let dc = capVise - this.cap; dc = Math.atan2(Math.sin(dc), Math.cos(dc)); this.cap += dc * Math.min(1, dt * 4);
      const pas = Math.min(d, v * dt * Math.max(0, Math.cos(dc))), nx = this.x + Math.cos(this.cap) * pas, ny = this.y + Math.sin(this.cap) * pas;
      if (d < 0.15 || !this.ctx.libre(nx, ny)) { this.etat = 'pause'; this.t = 3 + this.R() * 7; const r = this.R(); this.jouer(r < 0.55 ? 'mange' : r < 0.85 ? 'attente' : (this.clips.has('couche') ? 'couche' : 'alerte')); }
      else { this.x = nx; this.y = ny; }
    }
    this.racine.position.set(this.x, this.ctx.sol(this.x, this.y), -this.y);
    this.racine.rotation.y = Math.atan2(Math.cos(this.cap), -Math.sin(this.cap));      // le modèle regarde vers +Z
    this.mixer.update(dt);
  }
}

// ------------------------------------------------------------------------------------------------ chargement
/**
 * ctx : { groupeBetes, sol(x,y), libre(x,y), betes: [[espece, x, y, rayon, robe]], habitants: [{id, desc, act, objet (Group où poser le modèle)}] }
 * Retourne { betes, habitants, maj(dt, parlant) }.
 */
export async function chargerVivants(ctx) {
  const mvt = await Mouvements.charger();
  const hab = await Habilleur.charger(mvt);
  const intentions = new Set();
  for (const h of ctx.habitants) { intentions.add(h.act.fond); for (const g of h.act.gestes || []) intentions.add(g); if (h.act.marche) intentions.add(h.act.marche); }
  ['parler', 'ecouter', 'oui', 'saluer'].forEach((i) => intentions.add(i));
  const preMvt = mvt.precharger(intentions);
  const animaux = await json('animaux/animaux.json');
  const betes = [];
  const especes = [...new Set(ctx.betes.map((b) => b[0]))];
  const sources = new Map(await Promise.all(especes.map(async (e) => [e, await glb('animaux/' + animaux.especes[e].fichier)])));
  ctx.betes.forEach(([esp, x, y, r, rb, ech], i) => {
    const g = sources.get(esp), info = animaux.especes[esp];
    const racine = clonerArticule(g.scene);
    racine.userData.clips = g.animations;
    racine.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; if (rb && info.robes[rb]) { o.material = o.material.clone(); robe(o.material, info.robes[rb]); } } });
    racine.scale.setScalar(ech || 1);
    ctx.groupeBetes.add(racine);
    betes.push(new Bete(esp, info, racine, ctx, [x, y], r, hache(esp + i)));
  });
  const habitants = [];
  await Promise.all(ctx.habitants.map(async (h) => {
    try {
      const m = await hab.habiller(h.desc);
      h.objet.add(m.racine);
      const H = new Habitant(m, mvt, h.act, hache(h.id));
      H.id = h.id; H.objet = h.objet; H.marche = h.act.marche ? { chemin: h.act.chemin, i: 0, x: h.act.chemin[0][0], y: h.act.chemin[0][1] } : null;
      habitants.push(H);
    } catch (e) { console.warn('habitant non chargé', h.id, e); }
  }));
  await preMvt;
  for (const H of habitants) if (H.marche) { H.poser(H.act.marche, 0.1); }
  return {
    betes, habitants,
    maj(dt, parlant) {
      for (const b of betes) b.maj(dt);
      for (const H of habitants) {
        if (H.marche) {
          const M = H.marche, c = M.chemin[(M.i + 1) % M.chemin.length], dx = c[0] - M.x, dy = c[1] - M.y, d = Math.hypot(dx, dy);
          const v = (H.fond && H.fond.userData.v) || 1;
          if (d < 0.2) M.i = (M.i + 1) % M.chemin.length;
          else { const p = Math.min(d, v * dt); M.x += dx / d * p; M.y += dy / d * p; }
          H.objet.position.set(M.x, ctx.sol(M.x, M.y), -M.y);
          const vis = Math.atan2(dx, -dy); let dr = vis - H.objet.rotation.y; dr = Math.atan2(Math.sin(dr), Math.cos(dr)); H.objet.rotation.y += dr * Math.min(1, dt * 5);
        }
        H.maj(dt, parlant && parlant.id === H.id ? parlant : null);
      }
    },
    trouver(id) { return habitants.find((h) => h.id === id) || null; },
  };
}
