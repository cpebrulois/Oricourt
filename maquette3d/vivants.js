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
import { HabillageStudio } from './habillage_studio.js';
import { Vie } from './vie.js';

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
// coiffes et accessoires portés par un os (tête, main) : formes simples, aux couleurs de la tenue
function accessoire(type, couleur) {
  const g = new THREE.Group(), mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, ...o });
  const m = (geo, mt, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => { const k = new THREE.Mesh(geo, mt); k.position.set(x, y, z); k.rotation.set(rx, ry, rz); k.castShadow = true; g.add(k); return k; };
  const calotte = (r, haut = 0.5) => new THREE.SphereGeometry(r, 18, 10, 0, Math.PI * 2, 0, Math.PI * haut);
  // repères (os Head, repos identité ; le groupe est remonté de 6 cm à la pose) : sommet du crâne ≈ 0.22 au-dessus du pivot de la tête
  const bonnetDe = (r, mt, haut = 0.36, y = 0.06, incl = -0.32) => { const k = m(calotte(r, haut), mt, 0, y, 0.004, incl); k.scale.set(0.97, 1.0, 1.1); return k; };
  if (type === 'coiffe') {
    const lin = mat(couleur || 0xeee8d8, { side: THREE.DoubleSide });
    bonnetDe(0.146, lin, 0.46, 0.03, -0.14);
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
  } else if (type === 'seau') {
    const bois = mat(0x7a5a38, { side: THREE.DoubleSide });
    m(new THREE.CylinderGeometry(0.13, 0.11, 0.24, 14, 1, true), bois, 0, -0.28, 0.02);
    m(new THREE.CircleGeometry(0.11, 14), bois, 0, -0.4, 0.02, Math.PI / 2);
    m(new THREE.TorusGeometry(0.1, 0.006, 4, 16, Math.PI), mat(0x55504a, { metalness: 0.5 }), 0, -0.16, 0.02);
  } else if (type === 'livre') {
    m(new THREE.BoxGeometry(0.16, 0.04, 0.22), mat(0x5a2f22), 0, -0.02, 0.06, 0.3);
  }
  return g;
}

// Pièces d'Oricourt → pièces de l'habillage du Studio (cheveux et barbes en cartes, J52-J63)
const COUPES = { coupe_courte: 'coiffure_courte', coupe_mi_longue: 'coiffure_mi_longue', coupe_longue: 'coiffure_longue' };
class Habilleur {
  constructor(hab, mvt) { this.hab = hab; this.mvt = mvt; }
  static async charger(mvt) { return new Habilleur(await HabillageStudio.charger(BASE + 'habillage/'), mvt); }
  /** Un habitant : corps, peau, yeux, cheveux, tenue, robe longue et tablier pour les femmes, coiffe et objet porté. */
  async habiller(desc) {
    const S = desc.sexe === 'F' ? 'F' : 'M', coiffes = desc.coiffes || [];
    const sousCoiffe = coiffes.includes('coiffe');                       // cheveux rentrés sous le couvre-chef de lin
    let coupe = desc.coupe || (desc.pieces || []).map((p) => COUPES[p]).find(Boolean) || null;
    if (coiffes.includes('tonsure')) coupe = 'coiffure_tonsure';
    if (sousCoiffe) coupe = null;
    const barbe = desc.barbe || ((desc.pieces || []).includes('barbe') ? 'barbe_courte' : null);
    const pieces = (desc.pieces || []).filter((p) => !COUPES[p] && p !== 'barbe');
    const graine = hache(JSON.stringify(desc));
    const teintes = { peau: TEINTS[graine % TEINTS.length], ...(desc.teintes || {}) };
    const a = await this.hab.assembler({ id: desc.id, sexe: S, pieces, coupe, barbe, teintes, robe: !!desc.robe, age: desc.age || 0, yeux: desc.yeux || IRIS[(graine >>> 4) % IRIS.length] });
    if (desc.robe) this.hab.robeLongue(a, { ...desc.robe, teintes });
    for (const m of a.maillages) { const n = (m.material && m.material.name) || ''; m.castShadow = n !== 'oeil' && n !== 'cheveux_cartes' && m.userData.piece !== 'sourcils'; m.receiveShadow = true; }
    const tete = a.os.get('Head'), mainD = a.os.get('RightHand');
    for (const c of coiffes) {
      if (c === 'tonsure') continue;
      // pivots du Studio : l'os de la tête est plus haut que sur le corps brut ; les couvre-chefs se posent sur les mèches
      const acc = accessoire(c, desc.couleurCoiffe), dy = { coiffe: 0.012, chaperon: -0.012, bonnet: -0.01, chapel: -0.035, chapeau: -0.035 }[c] ?? 0.0;
      acc.position.y = dy; if (coupe && c !== 'chapeau') acc.scale.setScalar(1.07);
      if (S === 'F') { acc.scale.multiplyScalar(0.94); acc.position.y = dy - 0.005; }
      tete.add(acc);
    }
    if (desc.objet && mainD) { const o = accessoire(desc.objet); o.rotation.set(0, 0, desc.objet === 'lance' ? 0.0 : 0.3); mainD.add(o); }
    let objetMarche = null;
    if (desc.objetMarche && mainD) { objetMarche = accessoire(desc.objetMarche); objetMarche.visible = false; mainD.add(objetMarche); }
    a.racine.scale.setScalar(desc.echelle || 1);
    return { objetMarche, racine: a.racine, os: a.os, corps: a.corps, maillages: a.maillages, mixer: new THREE.AnimationMixer(a.racine), hauteur: (a.corps.taille_m || 1.75) * (desc.echelle || 1) };
  }
}
const TEINTS = ['#e3bd9c', '#d9b08c', '#cfa07c', '#e8c6a8', '#c99d7b', '#d6a985'];
const IRIS = ['#5a3a22', '#8a6a2f', '#3f7a4a', '#3e6fa8', '#7b8794', '#5a4630'];

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
  /** Une image. `parle` : dialogue en cours avec cet habitant ; `arret` : le voyageur est tout près (il s'interrompt). */
  maj(dt, parle, arret) {
    const R = this.routine;
    if (R) this.suivreRoutine(dt, parle, arret);
    else if (!this.act.marche) {
      const fond = parle ? (parle.tour === 'pnj' ? 'parler' : 'ecouter') : this.act.fond;
      this.poser(fond);
      this.prochain -= dt;
      if (this.prochain <= 0 && !parle) { this.prochain = this.act.periode[0] + this.R() * (this.act.periode[1] - this.act.periode[0]); const g = this.act.gestes; if (g && g.length) this.gesticuler(g[Math.floor(this.R() * g.length)]); }
    }
    this.mixer.update(dt);
  }
  /** Routine de métier : des postes (où il travaille, face à son ouvrage) reliés par des trajets à pied ; il s'interrompt
   *  quand le voyageur s'approche ou lui parle, et reprend où il en était. */
  suivreRoutine(dt, parle, arret) {
    const R = this.routine, P = R.postes[R.i];
    if (parle || arret) {
      if (R.etat === 'marche') this.poser('attendre');
      else if (parle) this.poser(/assis/.test(P.fond) ? (parle.tour === 'pnj' ? 'assis_parler' : P.fond) : (parle.tour === 'pnj' ? 'parler' : 'ecouter'));
      else this.poser(P.fond_arret || (/assis/.test(P.fond) ? P.fond : 'attendre'));
      if (this.objetMarche) this.objetMarche.visible = false;
      return;
    }
    if (R.etat === 'poste') {
      this.poser(P.fond);
      this.tourner(P.cap, dt);
      this.prochain -= dt; R.t -= dt;
      if (this.prochain <= 0 && P.gestes && P.gestes.length) { this.prochain = P.periode[0] + this.R() * (P.periode[1] - P.periode[0]); this.gesticuler(P.gestes[Math.floor(this.R() * P.gestes.length)]); }
      if (R.t <= 0 && !this.geste && R.postes.length > 1) { R.i = (R.i + 1) % R.postes.length; R.etat = 'marche'; this.poser(R.postes[R.i].trajet || R.trajet, 0.35); }
    } else {
      const dx = P.x - this.x, dy = P.y - this.y, d = Math.hypot(dx, dy), v = ((this.fond && this.fond.userData.v) || 1) * (this.racine.scale.x || 1);
      if (this.objetMarche) this.objetMarche.visible = !!P.porte;
      if (d < 0.12) { R.etat = 'poste'; R.t = P.duree[0] + this.R() * (P.duree[1] - P.duree[0]); this.prochain = 0.8 + this.R() * 2; if (this.objetMarche) this.objetMarche.visible = false; }
      else { const p = Math.min(d, v * dt); this.x += dx / d * p; this.y += dy / d * p; this.tourner(Math.atan2(dx, -dy), dt * 1.6); }
    }
  }
  tourner(cap, dt) { if (cap == null) return; let dr = cap - this.objet.rotation.y; dr = Math.atan2(Math.sin(dr), Math.cos(dr)); this.objet.rotation.y += dr * Math.min(1, dt * 3.5); }
}
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
export async function chargerVivants(ctx) {
  const mvt = await Mouvements.charger();
  const hab = await Habilleur.charger(mvt);
  const intentions = new Set();
  for (const h of ctx.habitants) {
    intentions.add(h.act.fond); for (const g of h.act.gestes || []) intentions.add(g); if (h.act.marche) intentions.add(h.act.marche);
    if (h.routine) { intentions.add(h.routine.trajet); for (const p of h.routine.postes) { intentions.add(p.fond); if (p.trajet) intentions.add(p.trajet); for (const g of p.gestes || []) intentions.add(g); } }
  }
  ['parler', 'ecouter', 'oui', 'non', 'saluer', 'attendre', 'assis_parler'].forEach((i) => intentions.add(i));
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
  const habitants = [], vie = new Vie();
  await Promise.all(ctx.habitants.map(async (h) => {
    try {
      const m = await hab.habiller(h.desc);
      h.objet.add(m.racine);
      const H = new Habitant(m, mvt, h.act, hache(h.id));
      H.id = h.id; H.objet = h.objet;
      if (h.routine && h.routine.postes.length) {
        H.routine = { ...h.routine, i: 0, etat: 'poste', t: 2 + Math.random() * 6 };
        H.x = h.routine.postes[0].x; H.y = h.routine.postes[0].y; H.objet.rotation.y = h.routine.postes[0].cap ?? H.objet.rotation.y;
      }
      // porteur de la vie procédurale du Studio (respiration, appuis, regard, clignements)
      H.porteur = { objet: H.racine, os: H.os, maillages: H.maillages, desc: { id: h.id }, hauteur: H.hauteur,
        get etat() { return H.intentionFond || ''; }, get geste() { return !!H.geste; }, get enMarche() { return !!H.marche; } }; H.marche = h.act.marche ? { chemin: h.act.chemin, i: 0, x: h.act.chemin[0][0], y: h.act.chemin[0][1] } : null;
      habitants.push(H);
    } catch (e) { console.warn('habitant non chargé', h.id, e); }
  }));
  await preMvt;
  for (const H of habitants) if (H.marche) { H.poser(H.act.marche, 0.1); }
  return {
    betes, habitants,
    vie,
    /** Regard d'un habitant : `point` (THREE.Vector3, monde) qu'il suit des yeux et de la tête, ou null. */
    regarder(id, point) { const H = habitants.find((x) => x.id === id); if (H) vie.fixer(H.objet, point); },
    maj(dt, parlant, voyageur) {
      for (const b of betes) b.maj(dt);
      vie.avant();
      for (const H of habitants) {
        const parle = parlant && parlant.id === H.id ? parlant : null;
        const px = H.routine ? H.x : H.marche ? H.marche.x : null, py = H.routine ? H.y : H.marche ? H.marche.y : null;
        const arret = !!voyageur && px != null && Math.hypot(voyageur.x - px, voyageur.y - py) < (H.arret || 3.6);
        if (H.routine) { H.maj(dt, parle, arret); H.objet.position.set(H.x, ctx.sol(H.x, H.y), -H.y); continue; }
        if (H.marche && arret) { H.poser('attendre'); H.marcheArretee = true; }
        else if (H.marche && H.marcheArretee) { H.marcheArretee = false; H.poser(H.act.marche, 0.35); }
        if (H.marche && !arret) {
          const M = H.marche, c = M.chemin[(M.i + 1) % M.chemin.length], dx = c[0] - M.x, dy = c[1] - M.y, d = Math.hypot(dx, dy);
          const v = (H.fond && H.fond.userData.v) || 1;
          if (d < 0.2) M.i = (M.i + 1) % M.chemin.length;
          else { const p = Math.min(d, v * dt); M.x += dx / d * p; M.y += dy / d * p; }
          H.objet.position.set(M.x, ctx.sol(M.x, M.y), -M.y);
          const vis = Math.atan2(dx, -dy); let dr = vis - H.objet.rotation.y; dr = Math.atan2(Math.sin(dr), Math.cos(dr)); H.objet.rotation.y += dr * Math.min(1, dt * 5);
        }
        H.maj(dt, parle, arret);
      }
      vie.apres(habitants.map((H) => H.porteur), dt);
    },
    trouver(id) { return habitants.find((h) => h.id === id) || null; },
  };
}
