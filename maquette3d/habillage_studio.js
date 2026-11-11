// Oricourt — habillage du Studio de vie (J50 à J63) : peau détaillée, yeux tracés, cheveux et barbes en cartes, matières
// des tissus. Les méthodes de rendu sont reprises telles quelles de app/assets/jeu/personnages_habillage.js ; seul
// l'assemblage est propre à Oricourt (pièces choisies par habitant, sans clips ni armes : les mouvements viennent du
// dossier « mouvements »). Les modèles .glb sont rangés en base64 dans des « .modele.json » (l'hébergeur des artefacts
// ne sert pas .glb).
import * as THREE from 'three';
import { GLTFLoader } from './lib/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from './lib/jsm/libs/meshopt_decoder.module.js';
import { REGARD_YEUX } from './vie.js';

const APPOINT = 0.3;
const lin = (hex) => new THREE.Color(hex);
const chargeur = new GLTFLoader(); chargeur.setMeshoptDecoder(MeshoptDecoder);
async function lireGlb(url) {
  const j = await (await fetch(url.replace(/\.glb$/, '.modele.json'))).json(), s = atob(j.glb), o = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) o[i] = s.charCodeAt(i);
  return chargeur.parseAsync(o.buffer, '');
}

export class HabillageStudio {
  constructor(index, base) { this.index = index; this.base = base; this._glb = new Map(); }
  static async charger(base) { return new HabillageStudio(await (await fetch(base + 'habillage.json')).json(), base); }
  url(f) { return this.base + f; }
  glb(f) {
    if (!this._glb.has(f)) this._glb.set(f, lireGlb(this.url(f)).catch((e) => { this._glb.delete(f); throw e; }));
    return this._glb.get(f);
  }
  corpsDe(sexe) { return this.index.corps.find((c) => c.race === 'humain' && c.sexe === (sexe === 'F' ? 'F' : 'M')); }

  /** Un habitant : `desc` = { id, sexe, pieces: [ids de pièces], coupe, barbe, teintes, age } (ids de l'index du Studio).
   *  Retourne { racine, os, maillages, corps } : corps articulé, pièces rattachées à ses os, peau, yeux, cheveux. */
  async assembler(desc) {
    const corps = this.corpsDe(desc.sexe), baseC = corps, sexe = corps.sexe;
    const ids = [...(desc.pieces || [])];
    for (const x of [desc.coupe, desc.barbe, 'sourcils']) if (x) ids.push(x);
    const pieces = ids.map((id) => ({ id, def: this.index.pieces[id] })).filter((p) => p.def && p.def.fichiers && p.def.fichiers[sexe]);
    const [gc, ...gp] = await Promise.all([this.glb(baseC.fichier), ...pieces.map((p) => this.glb(p.def.fichiers[sexe])), this._matieresPretes(pieces), this._peauPrete(baseC)]);
    gp.pop(); gp.pop();
    const racine = gc.scene.clone(true);
    const os = new Map();
    racine.traverse((o) => { if (o.isBone) os.set(o.name, o); });
    const maillages = [];
    racine.traverse((o) => { if (o.isSkinnedMesh) maillages.push(o); });
    const srcMaill = []; gc.scene.traverse((o) => { if (o.isSkinnedMesh) srcMaill.push(o); });
    maillages.forEach((m, i) => { const s = srcMaill[i].skeleton; m.bind(new THREE.Skeleton(s.bones.map((b) => os.get(b.name)), s.boneInverses.map((x) => x.clone())), m.bindMatrix.clone()); });
    const zonesCachees = new Set();
    let cuir = desc.coupe && this.index.pieces[desc.coupe] && this.index.pieces[desc.coupe].cartes ? [] : null;
    gp.forEach((g, k) => {
      const def = pieces[k].def;
      for (const z of def.masque || []) zonesCachees.add(z);
      const morceaux = []; g.scene.traverse((o) => { if (o.isSkinnedMesh) morceaux.push(o); });
      for (const m0 of morceaux) {
        const m = m0.clone();
        m.material = (Array.isArray(m0.material) ? m0.material[0] : m0.material).clone();
        m.bind(new THREE.Skeleton(m0.skeleton.bones.map((b) => os.get(b.name)), m0.skeleton.boneInverses.map((x) => x.clone())), m0.bindMatrix.clone());
        m.name = 'piece_' + pieces[k].id; m.userData.piece = pieces[k].id;
        racine.add(m); maillages.push(m);
        if (def.cartes) { m.material = this._cheveux(def, desc); if (def.cuir) cuir = def.cuir; }
        else {
          // sous une robe longue (Oricourt), la jupe de la tunique est coupée aux hanches : la robe prend le relais
          const d2 = desc.robe && pieces[k].id === 'tunique' ? { ...def, jupe_sous: { piece: 'tunique', sous_m: -0.035, axe_m: -1 } } : def;
          this._teindre(m, d2, desc, ids, (baseC.hanches_pos || [0, baseC.hanches || 0.95, 0])[1]);
        }
      }
    });
    // pivots anatomiques de la tête et des clavicules (comme le Studio, J52)
    const cibles = { ...(corps.pivots || {}) };
    if (Object.keys(cibles).length) {
      racine.updateMatrixWorld(true);
      const avant = new Map([...os.values()].map((b) => [b, b.matrixWorld.clone()]));
      const abs = new Map();
      const absDe = (b) => { if (!abs.has(b)) abs.set(b, b.position.clone().add(b.parent && b.parent.isBone ? absDe(b.parent) : new THREE.Vector3())); return abs.get(b); };
      for (const b of os.values()) absDe(b);
      const voulu = new Map([...os.values()].map((b) => [b, cibles[b.name] ? new THREE.Vector3().fromArray(cibles[b.name]) : abs.get(b)]));
      for (const b of os.values()) b.position.copy(voulu.get(b)).sub(b.parent && b.parent.isBone ? voulu.get(b.parent) : new THREE.Vector3());
      racine.updateMatrixWorld(true);
      for (const sk of new Set(maillages.map((m) => m.skeleton))) {
        sk.boneInverses = sk.bones.map((b, i) => new THREE.Matrix4().copy(b.matrixWorld).invert().multiply(avant.get(b)).multiply(sk.boneInverses[i]));
      }
    }
    racine.updateMatrixWorld(true);
    this._repos(maillages);
    const k = { main_ouverte_g: 1, main_ouverte_d: 1, ...(desc.cles || {}) };
    for (const m of maillages) {
      if (!m.morphTargetDictionary) continue;
      for (const [nom, v] of Object.entries(k)) { const i = m.morphTargetDictionary[nom]; if (i !== undefined) m.morphTargetInfluences[i] = v; }
      m.frustumCulled = false;
    }
    const zones = this.index.zones || [];
    const masque = [...zonesCachees].reduce((s, z) => (zones.indexOf(z) >= 0 ? s | (1 << zones.indexOf(z)) : s), 0);
    const tete = (corps.pivots && corps.pivots.Head) || [0, 1.64, 0.04];
    const centre = [tete[0], tete[1] + 0.05, tete[2] + 0.005];
    if (cuir && desc.coupe && this.index.pieces[desc.coupe].cuir) cuir = this.index.pieces[desc.coupe].cuir;
    const cuirU = cuir && desc.coupe ? { cuir: cuir.length ? cuir : [0.97, 0, 0, 0], centre, ligne: this.index.cheveux && this.index.cheveux.ligne } : null;
    const peau = this.peauDe(baseC);
    const fondBarbe = (desc.barbe && this.index.pieces[desc.barbe] && this.index.pieces[desc.barbe].fond_peau) || 0;
    for (const m of maillages) if (!m.userData.piece) this._peau(m, desc, masque, cuirU, centre, peau, fondBarbe);
    if (desc.age && peau) for (const m of maillages) { const u = m.userData.uPeau; if (u && u.uAgeMix) { u.uDetA.value = this.texturePeau(peau.def.tete_age); u.uAgeMix.value = desc.age; } }
    return { racine, os, maillages, corps };
  }

  /** Robe longue (cotte jusqu'aux chevilles) et tablier, propres à Oricourt : le Studio n'a que la tunique courte. Une jupe
   *  évasée est levée autour du corps au repos (relevé du corps hauteur par hauteur), liée au bassin et aux jambes ;
   *  teinte et matière comme les autres pièces (laine, plis, salissure vers l'ourlet). `r` : { couleur, tablier } (hex). */
  robeLongue(a, r) {
    const peau = a.maillages.find((m) => m.userData.uPeau);
    if (!peau) return;
    // relevé du corps et des pièces déjà portées (la jupe de la tunique doit passer dessous), cheveux exceptés
    const pts = [], v = new THREE.Vector3();
    for (const m of a.maillages) {
      const def = m.userData.piece && this.index.pieces[m.userData.piece];
      if (m !== peau && (!def || def.cartes || m.userData.piece === 'tunique')) continue;
      const Q = m === peau ? peau.userData.uPeau.uQPeau.value : m.userData.uRepos && m.userData.uRepos.uQ.value;
      if (!Q) continue;
      const P = m.geometry.attributes.position, Z = m === peau ? m.geometry.attributes._zones : null;
      for (let i = 0; i < P.count; i++) {
        if (Z && (Math.round(Z.getX(i)) & 14)) continue;                 // bras, avant-bras et mains : pas dans la jupe
        v.fromBufferAttribute(P, i).applyMatrix4(Q); pts.push(v.x, v.y, v.z);
      }
    }
    const H = (a.corps.hanches_pos || [0, 0.9, 0])[1], haut = H + 0.12, bas = 0.055;
    const releve = (y, e = 0.025) => {                     // demi-largeur, avant et arrière du corps à la hauteur y
      let rx = 0, zf = -1, zb = 1;
      for (let i = 0; i < pts.length; i += 3) if (Math.abs(pts[i + 1] - y) < e && Math.abs(pts[i]) < 0.26) { rx = Math.max(rx, Math.abs(pts[i])); zf = Math.max(zf, pts[i + 2]); zb = Math.min(zb, pts[i + 2]); }
      return zf < zb ? null : { rx, zf, zb };
    };
    const hanche = releve(H - 0.02) || { rx: 0.18, zf: 0.12, zb: -0.12 };
    const os = ['Hips', 'LeftUpLeg', 'RightUpLeg', 'LeftLeg', 'RightLeg'].map((n) => a.os.get(n));
    const lever = (couleur, matiere, arc, ecart, yHaut, yBas, def) => {
      const NA = arc ? 16 : 30, NY = 16, pos = [], uv = [], idx = [], si = [], sw = [];
      for (let j = 0; j <= NY; j++) {
        const t = j / NY, y = yHaut + (yBas - yHaut) * t, m = releve(y) || hanche;
        const ev = 1 + 0.62 * Math.pow(t, 1.25);                     // évasement vers l'ourlet
        const rx = Math.max(m.rx + 0.022, hanche.rx * ev) + ecart, cz = ((m.zf + m.zb) / 2) * (1 - t) + ((hanche.zf + hanche.zb) / 2) * t;
        const rz = Math.max((m.zf - m.zb) / 2 + 0.022, ((hanche.zf - hanche.zb) / 2) * ev * 1.15) + ecart;
        for (let i = 0; i <= NA; i++) {
          const ang = arc ? -arc + (2 * arc * i) / NA : (i / NA) * Math.PI * 2;
          const x = Math.sin(ang) * rx, z = cz + Math.cos(ang) * rz;
          pos.push(x, y, z); uv.push(i / NA, t);
          // poids : bassin en haut ; plus bas, cuisses puis jambes, partagées entre gauche et droite (devant et dos à moitié)
          const g = Math.min(1, Math.max(0, 0.5 + Math.sin(ang) * 1.4)), wb = 1 - 0.72 * Math.min(1, t / 0.55);
          const wj = (1 - wb) * Math.min(1, Math.max(0, (t - 0.55) / 0.45)) * 0.45, wc = 1 - wb - wj;
          si.push(0, 1, 2, g >= 0.5 ? 3 : 4); sw.push(wb, wc * g, wc * (1 - g), wj);
        }
      }
      const L = NA + 1;
      for (let j = 0; j < NY; j++) for (let i = 0; i < NA; i++) { const p = j * L + i; idx.push(p, p + L, p + 1, p + 1, p + L, p + L + 1); }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4)); geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
      geo.setIndex(idx); geo.computeVertexNormals();
      const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, emissive: 0xff0000 });
      const m = new THREE.SkinnedMesh(geo, mat); m.name = 'piece_' + def; m.userData.piece = def; m.frustumCulled = false;
      a.racine.add(m); a.racine.updateMatrixWorld(true);
      m.bind(new THREE.Skeleton(os), new THREE.Matrix4());
      this._teindre(m, { teintes: { principal: 'robe_oricourt' }, matiere, salissure: [0.1, 0.3], usure: 0.3, plis: arc ? [0.5, 0] : [1.2, 0] }, { teintes: { robe_oricourt: couleur } }, [], H);
      a.maillages.push(m);
      return m;
    };
    lever(r.couleur || '#6a5a40', 'laine', 0, 0, haut, bas, 'robe_longue');
    if (r.tablier) lever(r.tablier, 'lin', 1.05, 0.012, haut - 0.02, bas + 0.16, 'tablier');
    this._repos(a.maillages.filter((m) => m.userData.piece === 'robe_longue' || m.userData.piece === 'tablier'));
  }

  /** Texture UV de la peau (J63) : sans retournement (convention glTF), données linéaires ; `repeter` pour la tuile de pores. */
  texturePeau(f, repeter = false) {
    if (!this._texPeau) this._texPeau = new Map();
    if (!this._texPeau.has(f)) {
      let fin; const pret = new Promise((r) => { fin = r; });
      const tx = new THREE.TextureLoader().load(this.url(f), () => fin(), undefined, () => fin());
      tx.flipY = false; tx.colorSpace = THREE.NoColorSpace; tx.anisotropy = 4;
      tx.wrapS = tx.wrapT = repeter ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
      tx.userData.pret = pret; this._texPeau.set(f, tx);
    }
    return this._texPeau.get(f);
  }
  /** Cartes de détail de la peau d'un corps de base (J63) : {tete, corps, pores, def} ou null si l'index n'en a pas. */
  peauDe(baseC) {
    const P = this.index.peau, pc = P && P.corps && baseC && P.corps[baseC.id];
    if (!pc || !P.pores) return null;
    return { def: pc, P, tete: this.texturePeau(pc.tete), corps: this.texturePeau(pc.corps), pores: this.texturePeau(P.pores.fichier, true) };
  }
  async _peauPrete(baseC) { const p = this.peauDe(baseC); if (p) await Promise.all([p.tete, p.corps, p.pores].map((t) => t.userData.pret)); }

  /** Peau. J50 : albédo neutre (variation, occlusion), teint de la fiche, lèvres, rougeurs, sourcils de la couleur des cheveux.
   *  J63 : détail tiré de photographies (peaux MakeHuman, CC0, reportées sur notre dépliage et neutralisées : le teint reste
   *  celui de la fiche), micro-relief des pores et des ridules (relief à l'écran), rugosité par zones (front, nez et menton
   *  plus brillants, lèvres lisses), diffusion sous la peau approchée (la lumière déborde le terminateur en rougissant ;
   *  oreilles et ailes du nez translucides à contre-jour). `hProc63` : relief ajouté par l'avatar (cicatrices, rides). */
  _peau(m, desc, masque, cuirU = null, centre = [0, 1.69, 0.045], peau = null, fondBarbe = 0) {
    const ancien = Array.isArray(m.material) ? m.material[0] : m.material;
    const mat = ancien.clone();
    if (!/^peau/.test(ancien.name || '')) { m.material = this._oeil(m, mat, desc); return; }
    if (mat.map) { mat.map.colorSpace = THREE.NoColorSpace; mat.map.needsUpdate = true; }
    const teint = lin((desc.teintes && desc.teintes.peau) || '#d9b08c');
    const cheveux = lin((desc.teintes && desc.teintes.cheveux) || '#4a2f1d');
    const u = {
      uTeint: { value: teint }, uLevres: { value: teint.clone().multiply(new THREE.Color(0.74, 0.47, 0.45)) },
      uSourcils: { value: cheveux.clone().multiplyScalar(0.75) }, uAppointHab: { value: APPOINT }, uMasque: { value: masque },
      uQPeau: { value: new THREE.Matrix4() }, uCentreCrane: { value: new THREE.Vector3().fromArray(centre) },
      uCheveuxCuir: { value: cheveux.clone() }, uBarbe63: { value: fondBarbe },
    };
    m.userData.uPeau = u;
    u.uQPeau.value.multiplyMatrices(m.skeleton.bones[0].matrixWorld, m.skeleton.boneInverses[0]).multiply(m.bindMatrix);   // repos en mètres
    // J52 : cuir chevelu teinté sous les cartes (couvre les jours entre les mèches) ou duvet d'un crâne rasé, d'après la
    // ligne d'implantation (élévation vue du centre du crâne selon l'azimut) ; tonsure et bande du dessus (rasée sur les côtés)
    const avecCuir = !!(cuirU && cuirU.ligne);
    if (avecCuir) {
      const L = cuirU.ligne;
      Object.assign(u, { uCuir: { value: new THREE.Vector4(...cuirU.cuir) },
        uLigneT: { value: L.map((x) => x[0]) }, uLigneP: { value: L.map((x) => x[1]) } });
    }
    const nL = avecCuir ? cuirU.ligne.length : 0;
    if (peau) {
      const d = peau.def, r = d.rect, R = d.reperes || {}, P = peau.P;
      Object.assign(u, {
        uDetT: { value: peau.tete }, uDetC: { value: peau.corps }, uDetA: { value: peau.tete }, uPores: { value: peau.pores }, uAgeMix: { value: 0 },
        uRectT: { value: new THREE.Vector4(r[0], r[1], 1 / (r[2] - r[0]), 1 / (r[3] - r[1])) },
        uTexT: { value: new THREE.Vector2(0.75 / d.taille_tete[0], 0.75 / d.taille_tete[1]) },
        uRelief: { value: new THREE.Vector4(P.relief_m ?? 0.0004, P.pores.relief_m ?? 0.00006, P.pores.repetitions ?? 72, 0) },
        uOre63: { value: new THREE.Vector3().fromArray(R.oreille_g || [0.095, -0.02, -0.02]) }, uNez63: { value: new THREE.Vector3().fromArray(R.nez || [0, -0.04, 0.13]) },
        uOeil63: { value: new THREE.Vector3().fromArray(R.oeil_g || [0.035, -0.005, 0.085]) }, uFente63: { value: new THREE.Vector3().fromArray(R.fente || [0, -0.08, 0.116]) },
        uSSS63: { value: new THREE.Vector3(0.5, 0.9, 0.75) },
      });
    }
    const lumieres = THREE.ShaderChunk.lights_fragment_begin.split('RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );')
      .join('RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );\n\t\tssPeau63( directLight, geometryNormal, geometryViewDir, material.diffuseColor, reflectedLight );');
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float _zones; uniform int uMasque; varying float vCache;\nuniform mat4 uQPeau; varying vec3 vRepPeau;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCache = (int(_zones + 0.5) & uMasque) != 0 ? 1.0 : 0.0;')
        .replace('#include <skinning_vertex>', 'vRepPeau = (uQPeau * vec4(transformed, 1.0)).xyz;\n#include <skinning_vertex>');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', (peau ? '#define PEAU_J63\n' : '') + `#include <common>
uniform vec3 uTeint; uniform vec3 uLevres; uniform vec3 uSourcils; uniform float uAppointHab; varying float vCache;
uniform vec3 uCentreCrane; varying vec3 vRepPeau; uniform vec3 uCheveuxCuir; uniform float uBarbe63;
float hProc63 = 0.0; vec2 gPeau63 = vec2(0.0); float rugPeau63 = 0.0; float finPeau63 = 0.0; float specPeau63 = 1.0; float cuirPeau63 = 0.0;
#ifdef PEAU_J63
uniform sampler2D uDetT; uniform sampler2D uDetC; uniform sampler2D uDetA; uniform sampler2D uPores; uniform float uAgeMix;
uniform vec4 uRectT; uniform vec2 uTexT; uniform vec4 uRelief; uniform vec3 uOre63; uniform vec3 uNez63; uniform vec3 uOeil63; uniform vec3 uFente63; uniform vec3 uSSS63;
#endif
// relief à l'écran : dh = variation de hauteur (mètres) d'un pixel au suivant, en x et en y
vec3 reliefG63(vec3 pos, vec3 n, vec2 dh, float fd) {
  vec3 sx = dFdx(pos), sy = dFdy(pos); vec3 r1 = cross(sy, n), r2 = cross(n, sx);
  float det = dot(sx, r1) * fd; vec3 g = sign(det) * (dh.x * r1 + dh.y * r2);
  return normalize(abs(det) * n - g);
}` + (avecCuir ? `
#define CUIR_J52
#define NL_J52 ${nL}
uniform vec4 uCuir; uniform float uLigneT[NL_J52]; uniform float uLigneP[NL_J52];
float ligneJ52(float t) { float p = uLigneP[0]; for (int i = 1; i < NL_J52; i++) { if (t <= uLigneT[i]) { float f = (t - uLigneT[i - 1]) / max(uLigneT[i] - uLigneT[i - 1], 1e-3); return mix(uLigneP[i - 1], uLigneP[i], clamp(f, 0.0, 1.0)); } p = uLigneP[i]; } return p; }` : ''))
        .replace('#include <lights_physical_pars_fragment>', `#include <lights_physical_pars_fragment>
// diffusion sous la peau, approchée : la lumière déborde le terminateur en rougissant ; les parties fines (oreilles, ailes du
// nez) laissent passer la lumière venue de derrière
void ssPeau63(IncidentLight l, vec3 n, vec3 v, vec3 alb, inout ReflectedLight r) {
#ifdef PEAU_J63
  float ndl = dot(n, l.direction);
  float deb = clamp((ndl + uSSS63.x) / (1.0 + uSSS63.x), 0.0, 1.0) - clamp(ndl, 0.0, 1.0);
  r.directDiffuse += l.color * alb * RECIPROCAL_PI * vec3(1.0, 0.30, 0.16) * deb * uSSS63.y;
  float tr = pow(clamp(dot(v, -l.direction), 0.0, 1.0), 2.0) * 0.7 + clamp(-ndl, 0.0, 1.0) * 0.45;
  r.directDiffuse += l.color * alb * RECIPROCAL_PI * vec3(1.0, 0.24, 0.10) * tr * finPeau63 * uSSS63.z;
#endif
}`)
        .replace('#include <lights_fragment_begin>', lumieres)
        .replace('#include <map_fragment>', `if (vCache > 0.5) discard;
#ifdef USE_MAP
  vec4 dPeau = texture2D(map, vMapUv);
  vec3 dCr63 = vRepPeau - uCentreCrane;
#ifdef PEAU_J63
  vec2 uvT = (vMapUv - uRectT.xy) * uRectT.zw;
  float dansT = step(0.0, uvT.x) * step(uvT.x, 1.0) * step(0.0, uvT.y) * step(uvT.y, 1.0);
  vec4 dC63 = texture2D(uDetC, vMapUv);
  vec4 dT63 = texture2D(uDetT, uvT);
  float hu63 = texture2D(uDetT, uvT + vec2(uTexT.x, 0.0)).a, hv63 = texture2D(uDetT, uvT + vec2(0.0, uTexT.y)).a;
  if (uAgeMix > 0.0) {                                   // peau âgée (avatar) : seconde carte de la tête, mêlée
    vec4 a = texture2D(uDetA, uvT);
    hu63 = mix(hu63, texture2D(uDetA, uvT + vec2(uTexT.x, 0.0)).a, uAgeMix); hv63 = mix(hv63, texture2D(uDetA, uvT + vec2(0.0, uTexT.y)).a, uAgeMix);
    dT63 = mix(dT63, a, uAgeMix);
  }
  vec4 det63 = mix(dC63, dT63, dansT);
  vec2 gUV = vec2(hu63 - dT63.a, hv63 - dT63.a) / uTexT;
  gPeau63 = (vec2(dot(gUV, dFdx(uvT)), dot(gUV, dFdy(uvT))) * dansT + vec2(dFdx(dC63.a), dFdy(dC63.a)) * (1.0 - dansT)) * uRelief.x;
  float po63 = texture2D(uPores, vMapUv * uRelief.z).r;
  gPeau63 += vec2(dFdx(po63), dFdy(po63)) * uRelief.y;
  vec3 rap63 = det63.rgb * 2.0;
  float lt63 = dot(uTeint, vec3(0.3, 0.59, 0.11)), lr63 = dot(rap63, vec3(0.3, 0.59, 0.11));
  rap63 = mix(vec3(lr63), rap63, mix(0.55, 1.0, smoothstep(0.02, 0.3, lt63)));     // teints sombres : écarts de teinte moins saturés
  vec3 cPeau = uTeint * rap63 * mix(1.0, dPeau.r, 0.7);
  cPeau = mix(cPeau, cPeau * vec3(1.05, 0.80, 0.76), dPeau.b * 0.2);
  float fin63 = clamp(0.5 + det63.a, 0.7, 1.3);
  cPeau = mix(cPeau, uLevres * fin63 * mix(1.0, dPeau.r, 0.6), dPeau.g * 0.85);
  // sourcils peints, fondus dans la peau (sous les cartes) : bord adouci, poils suggérés par le grain
  { float ms = clamp((1.0 - dPeau.a) * 1.5, 0.0, 1.0);                 // masque des sourcils (A = 1 − 0,8 × sourcils)
    float fx = clamp((abs(dCr63.x) - 0.012) / 0.04, 0.0, 1.0);          // 0 près du nez (poils dressés), 1 vers la tempe (couchés)
    vec2 nrm = normalize(vec2(mix(0.95, 0.25, fx), mix(0.3, -0.97, fx)));
    float t = dot(vec2(abs(dCr63.x), dCr63.y), nrm) * 4200.0;
    float al = fract(sin(floor(t / 6.2832) * 91.7) * 4375.85);
    float poil = smoothstep(-0.2, 0.75, sin(t + 2.5 * sin(dot(dCr63.xy, vec2(900.0, 700.0))))) * (0.55 + 0.45 * al);
    cPeau = mix(cPeau, uSourcils * (0.7 + 0.3 * al), smoothstep(0.16, 0.5, ms * (0.7 + 0.7 * poil)) * 0.9); }
  { vec3 q = vec3(abs(dCr63.x), dCr63.yz) - uOeil63; float dl = length(q);   // ligne des cils : bord des paupières assombri
    float bord = (1.0 - smoothstep(0.0128, 0.0152, dl)) * step(0.004, q.z);
    cPeau *= 1.0 - bord * mix(0.42, 0.78, step(0.0, q.y)); }
  { vec3 q = (vec3(abs(dCr63.x), dCr63.yz) - uOeil63) / vec3(0.024, 0.017, 0.03);        // contour des yeux plus sombre, un peu violacé
    cPeau *= mix(vec3(1.0), vec3(0.80, 0.72, 0.75), 0.55 * exp(-dot(q, q))); }
  { vec3 q = (vec3(abs(dCr63.x), dCr63.yz) - (uNez63 + vec3(0.0085, -0.004, -0.021))) / 0.0058;   // fond des narines dans l'ombre
    cPeau *= 1.0 - 0.82 * exp(-dot(q, q)) * step(dCr63.y, uNez63.y + 0.004); }
  // zones : front, nez et menton plus brillants, lèvres lisses, pores plus mats
  float face63 = smoothstep(0.02, 0.06, dCr63.z);
  float zT63 = exp(-dCr63.x * dCr63.x / 0.0012) * face63 * step(-0.15, dCr63.y);
  float sombre63 = 1.0 - smoothstep(0.02, 0.3, lt63);                 // teints sombres : reflet plus large et moins fort (relecture J63)
  rugPeau63 = -0.08 * zT63 + (0.5 - det63.a) * 0.5 + (0.5 - po63) * 0.2 - 0.15 * dPeau.g + 0.14 * sombre63;
  specPeau63 = mix(0.85, 0.5, sombre63);
  vec3 dOr63 = vec3(abs(dCr63.x), dCr63.yz) - uOre63;
  finPeau63 = (1.0 - smoothstep(0.025, 0.05, length(dOr63))) * smoothstep(-0.02, -0.006, dOr63.x)
    + 0.4 * (1.0 - smoothstep(0.012, 0.028, length(dCr63 - uNez63)));
  if (uBarbe63 > 0.0) {                                  // fond de barbe : poil ras peint sous les cartes (joues, mâchoire, menton, sous le menton)
    vec3 a = vec3(abs(dCr63.x), dCr63.yz); float dyE = a.y - uOeil63.y;
    float joue = smoothstep(-0.040, -0.074, dyE) * smoothstep(-0.168, -0.140, dyE) * smoothstep(uOeil63.z - 0.082, uOeil63.z - 0.056, a.z);
    float bouche = 1.0 - smoothstep(0.85, 1.25, length((a.xy - vec2(0.0, uFente63.y)) / vec2(0.036, 0.012)));
    float sousNez = (1.0 - smoothstep(0.016, 0.026, a.x)) * step(uFente63.y + 0.006, a.y);
    float g = fract(sin(dot(floor(vRepPeau * 2400.0), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    float hb = fract(sin(dot(floor(vec2(a.x * 2600.0 + a.y * 900.0, a.y * 700.0)), vec2(12.9898, 78.233))) * 43758.5453);
    float zb = joue * (1.0 - bouche) * (1.0 - sousNez);
    float b = smoothstep(0.0, 0.35, zb - 0.62 * hb) * (0.55 + 0.45 * smoothstep(0.5, 1.0, zb)) * uBarbe63;   // bord en poils épars, plein seulement au cœur
    cPeau = mix(cPeau, uCheveuxCuir * (0.34 + 0.45 * g) * mix(1.0, 0.7, smoothstep(0.35, 0.85, dot(uCheveuxCuir, vec3(0.3, 0.59, 0.11)))), clamp(b * (0.88 + 0.12 * g), 0.0, 1.0));
    rugPeau63 += 0.2 * b;
  }
#else
  vec3 cPeau = uTeint * mix(1.0, dPeau.r, 0.85);
  cPeau = mix(cPeau, cPeau * vec3(1.05, 0.80, 0.76), dPeau.b * 0.35);
  cPeau = mix(cPeau, uLevres, dPeau.g * 0.85);
  cPeau = mix(cPeau, uSourcils, clamp((1.0 - dPeau.a) * 1.5, 0.0, 1.0) * 0.55);   // A = 1 − 0,8 × sourcils (J52 : sous les cartes)
#endif
#ifdef CUIR_J52
  { vec3 d = dCr63; float th = degrees(atan(abs(d.x), d.z)); float ph = degrees(atan(d.y, length(d.xz)));
    // J63 : lisière en duvet. Le fond de chevelure n'arrive plus d'un trait : sur 13° il se défait en poils fins (cellules
    // étirées dans le sens de la pousse, chacune avec son seuil)
    float lgn = ligneJ52(th), fondu = smoothstep(lgn - 8.0, lgn + 5.0, ph);
    float hc = fract(sin(dot(floor(vec2(th * 34.0, ph * 0.55 + th * 1.9)), vec2(12.9898, 78.233))) * 43758.5453);
    float dans = smoothstep(0.0, 0.28, fondu - 0.72 * hc) * step(length(d), 0.17) * step(-0.14, d.y);
    float grain = fract(sin(dot(floor(vRepPeau * 1600.0), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    float haut = degrees(acos(clamp(normalize(d).y, -1.0, 1.0)));
    float o = uCuir.x;
    if (uCuir.z > 0.0 && haut < uCuir.z) o = uCuir.y * 0.4;                         // tonsure : couronne nue
    if (uCuir.w > 0.0 && abs(d.x) > uCuir.w) o = uCuir.y;                           // rasée sur les côtés : duvet
    if (uCuir.x <= 0.0) o = uCuir.y;                                                 // crâne rasé
    float dense = o >= 0.9 ? 1.0 : 0.0;                                              // sous les cartes : fond de chevelure
    vec3 cc = uCheveuxCuir * mix(0.4 + 0.45 * grain, 0.62 + 0.2 * grain, dense)
      * mix(1.0, 0.88, smoothstep(0.35, 0.85, dot(uCheveuxCuir, vec3(0.3, 0.59, 0.11))));   // J63 : accordé aux cartes des cheveux clairs (sinon le fond se lit en résille sombre)
    cuirPeau63 = clamp(dans * (dense > 0.5 ? o : o * (0.3 + 0.7 * grain)), 0.0, 1.0);
    cPeau = mix(cPeau, cc, cuirPeau63); }
#endif
  diffuseColor.rgb = cPeau;
#endif`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = clamp(roughnessFactor + rugPeau63, 0.3, 0.95);')
        .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n  normal = reliefG63(-vViewPosition, normal, gPeau63 + vec2(dFdx(hProc63), dFdy(hProc63)), faceDirection);')
        .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance = diffuseColor.rgb * uAppointHab;')
        // léger reflet de bord (lumière du ciel rasante) : la silhouette des peaux sombres reste lisible sans changer le teint
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
  reflectedLight.directSpecular *= specPeau63 * (1.0 - 0.92 * cuirPeau63);   // J63 : pas de reflet de peau sous les cheveux (il perçait en points clairs)
  reflectedLight.indirectSpecular *= 1.0 - 0.92 * cuirPeau63;
  { float rim = pow(1.0 - abs(dot(normalize(-vViewPosition), normal)), 3.0);
    reflectedLight.indirectSpecular += vec3(0.62, 0.66, 0.74) * rim * 0.16 * (1.0 - cuirPeau63); }`);
    };
    mat.customProgramCacheKey = () => 'peau_j63' + (peau ? '_det' : '') + (avecCuir ? '_cuir' + nL : '');
    mat.metalness = 0; mat.roughness = peau ? 0.6 : 0.52;
    if (!m.geometry.attributes._zones) m.geometry.setAttribute('_zones', new THREE.BufferAttribute(new Float32Array(m.geometry.attributes.position.count), 1));
    m.material = mat;
  }

  /** Yeux (J63) : sclère grisée et rosie vers les coins, veinules, iris fibré (collerette claire, anneau limbique sombre) et
   *  pupille, tracés dans le repère de l'œil (regard vers +Z). L'iris est éclairé en creux (relief à l'écran) sous une cornée
   *  bombée et lisse (couche de vernis) : le reflet de la lumière glisse sur la cornée. Un reflet de ciel suit la caméra pour
   *  que le regard reste vivant sans carte d'environnement. Paupière supérieure et cils : ombre sur le haut du globe. */
  _oeil(m, mat, desc) {
    // centre du globe d'après les seules positions de base (la boîte de three.js inclut les clés de forme : race, visage)
    const g = m.geometry, b = new THREE.Box3().setFromBufferAttribute(g.attributes.position);
    const c = b.getCenter(new THREE.Vector3());
    const IRIS = { marron: '#5a3a22', noisette: '#8a6a2f', vert: '#3f7a4a', bleu: '#3e6fa8', gris: '#7b8794', noir: '#1c1c22', ambre: '#c58a1f', violet: '#6a4a9c' };   // palette de la création
    const y = desc.yeux || (desc.teintes && desc.teintes.yeux);
    // J67 : uRegard67 (lacet, tangage, paupière), commun à tous les yeux et posé par personnage juste avant le dessin
    // (personnages_vie.js) : l'iris tourne dans l'orbite, la paupière est peinte sur le globe le temps d'un clignement
    const u = { uCentre: { value: c }, uIris: { value: lin(IRIS[y] || (typeof y === 'string' && y.startsWith('#') ? y : '#5a4630')) }, uAppointHab: { value: APPOINT * 0.45 },
      uRegard67: REGARD_YEUX, uPaupiere67: { value: lin((desc.teintes && desc.teintes.peau) || '#d9b08c') } };
    const o = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05, name: 'oeil' });
    o.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vOeil; uniform vec3 uCentre;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvOeil = normalize(position - uCentre);');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vOeil; uniform vec3 uIris; uniform float uAppointHab; uniform vec3 uRegard67; uniform vec3 uPaupiere67;
float hIris63 = 0.0; float hCornee63 = 0.0; float ombreOeil63 = 1.0; float paupiere67 = 0.0;
vec3 reliefG63(vec3 pos, vec3 n, vec2 dh, float fd) {
  vec3 sx = dFdx(pos), sy = dFdy(pos); vec3 r1 = cross(sy, n), r2 = cross(n, sx);
  float det = dot(sx, r1) * fd; vec3 g = sign(det) * (dh.x * r1 + dh.y * r2);
  return normalize(abs(det) * n - g);
}`)
        .replace('#include <color_fragment>', `#include <color_fragment>
  { vec3 vo = normalize(vOeil); float a0 = acos(clamp(vo.z, -1.0, 1.0)), az0 = atan(vo.y, vo.x);   // normalisé ici : l'œil allégé a de grands triangles
    // J67 : le regard tourne l'iris dans l'orbite (rotation inverse du repère de l'œil) ; la sclère et les ombres ne bougent pas
    float cy67 = cos(uRegard67.x), sy67 = sin(uRegard67.x), cx67 = cos(uRegard67.y), sx67 = sin(uRegard67.y);
    vec3 vr = vec3(cy67 * vo.x - sy67 * vo.z, vo.y, sy67 * vo.x + cy67 * vo.z);
    vr = vec3(vr.x, cx67 * vr.y + sx67 * vr.z, -sx67 * vr.y + cx67 * vr.z);
    float a = acos(clamp(vr.z, -1.0, 1.0)), az = atan(vr.y, vr.x);
    float r = a / 0.51;                                        // 0 au centre de la pupille, 1 au limbe
    vec3 sclere = mix(vec3(0.54, 0.51, 0.49), vec3(0.50, 0.33, 0.30), smoothstep(0.7, 1.4, a0) * 0.85);
    float veine = smoothstep(0.86, 1.0, sin(az0 * 7.0 + sin(a0 * 11.0 + az0 * 3.0) * 1.7)) * smoothstep(0.62, 1.2, a0);
    sclere = mix(sclere, vec3(0.50, 0.22, 0.20), veine * 0.28);
    float fib = 0.5 + 0.5 * sin(az * 41.0 + sin(az * 13.0) * 2.2 + r * 3.0), fib2 = 0.5 + 0.5 * sin(az * 97.0 + r * 8.0);
    vec3 iris = uIris * (0.50 + 0.8 * smoothstep(1.0, 0.4, r)) * (0.74 + 0.36 * fib + 0.16 * fib2);
    iris = mix(iris, (uIris + vec3(0.10, 0.07, 0.02)) * 1.25, smoothstep(0.66, 0.38, r) * (0.3 + 0.3 * fib));   // collerette
    iris *= 1.0 - 0.8 * smoothstep(0.74, 1.0, r);              // anneau limbique
    vec3 col = mix(sclere, iris, smoothstep(1.07, 0.96, r));
    col = mix(col, vec3(0.010), smoothstep(0.37, 0.32, r));    // pupille
    ombreOeil63 = (1.0 - 0.68 * smoothstep(-0.06, 0.42, vo.y)) * (1.0 - 0.42 * smoothstep(0.42, 1.1, a0)) * (1.0 - 0.3 * smoothstep(-0.18, -0.42, vo.y));   // paupière supérieure et cils, coins, contact de la paupière inférieure
    col *= ombreOeil63;
    hIris63 = -0.0011 * smoothstep(1.02, 0.55, r);             // iris en creux (éclairage diffus)
    hCornee63 = 0.0008 * smoothstep(1.2, 0.45, r);             // cornée bombée (reflet)
    if (uRegard67.z > 0.002) {                                 // J67 : clignement — la paupière supérieure descend, l'inférieure monte un peu
      float haut67 = mix(0.66, -0.24, uRegard67.z), bas67 = mix(-0.66, -0.28, uRegard67.z);
      paupiere67 = max(smoothstep(haut67 - 0.05, haut67 + 0.02, vo.y), smoothstep(bas67 + 0.05, bas67 - 0.02, vo.y));
      float cils67 = smoothstep(0.10, 0.0, abs(vo.y - haut67));
      col = mix(col, uPaupiere67 * (0.80 - 0.45 * cils67), paupiere67);
      hIris63 *= 1.0 - paupiere67; hCornee63 *= 1.0 - paupiere67; }
    diffuseColor.rgb = col; }`)
        .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n  normal = reliefG63(-vViewPosition, normal, vec2(dFdx(hIris63), dFdy(hIris63)), faceDirection);')
        .replace('#include <clearcoat_normal_fragment_maps>', '#include <clearcoat_normal_fragment_maps>\n  clearcoatNormal = reliefG63(-vViewPosition, clearcoatNormal, vec2(dFdx(hCornee63), dFdy(hCornee63)), faceDirection);')
        .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance = diffuseColor.rgb * uAppointHab;')
        .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n  material.clearcoat *= 1.0 - paupiere67; material.roughness = mix(material.roughness, 0.8, paupiere67);')
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
  { // reflet de ciel sur la cornée : une fenêtre claire en haut à gauche de la caméra, mesurée à la lumière ambiante
    vec3 Rv = reflect(-geometryViewDir, geometryClearcoatNormal);
    float f1 = smoothstep(0.90, 0.965, dot(Rv, normalize(vec3(-0.36, 0.50, 0.79))));
    float f2 = smoothstep(0.975, 0.992, dot(Rv, normalize(vec3(0.30, -0.22, 0.93)))) * 0.22;
    vec3 ciel = vec3(0.0);
#if NUM_HEMI_LIGHTS > 0
    ciel += hemisphereLights[0].skyColor * 0.30;
#endif
#if NUM_DIR_LIGHTS > 0
    ciel += directionalLights[0].color * 0.10;
#endif
    reflectedLight.directSpecular += ciel * (f1 * 1.5 + f2) * (0.35 + 0.65 * ombreOeil63) * (1.0 - paupiere67);
    reflectedLight.directDiffuse *= ombreOeil63 * 0.5 + 0.5; }`);
    };
    o.customProgramCacheKey = () => 'oeil_j67';
    return o;
  }

  /** Atlas des cartes de cheveux (J52) : racine en haut de l'image (sans retournement), bandes bord à bord. */
  atlasCheveux(f) {
    if (!this._atlas) this._atlas = new Map();
    if (!this._atlas.has(f)) {
      let fin; const pret = new Promise((r) => { fin = r; });
      const tx = new THREE.TextureLoader().load(this.url(f), () => fin(), undefined, () => fin());
      tx.flipY = false; tx.colorSpace = THREE.NoColorSpace; tx.anisotropy = 4; tx.wrapS = tx.wrapT = THREE.ClampToEdgeWrapping;
      tx.userData.pret = pret; this._atlas.set(f, tx);
    }
    return this._atlas.get(f);
  }

  /** Cartes de cheveux (J52) : couleur de la fiche × gris de l'atlas, racines plus sombres (canal racine → pointe), fond des
   *  mèches assombri (profondeur, occlusion des sommets), reflet anisotrope à deux lobes (Kajiya-Kay) le long du fil (dérivées
   *  des UV, écart de la carte de direction). J63 : une seule passe, la couverture de l'atlas devient la couverture des
   *  échantillons (alpha vers couverture, anticrénelage du moteur) : bords fondus sans tri ni seconde passe, moitié moins de
   *  triangles dessinés. Sans anticrénelage, il reste une découpe nette au seuil de 0,2. */
  _cheveux(def, desc) {
    const C = this.index.cheveux || {};
    const coul = lin((desc.teintes && desc.teintes.cheveux) || '#4a2f1d');
    const u = { uAtlas: { value: this.atlasCheveux(C.atlas) }, uDirC: { value: this.atlasCheveux(C.direction) }, uCoulC: { value: coul },
      uAppointHab: { value: APPOINT * 0.7 }, uEclatC: { value: def.eclat ?? 1 } };
    const mat = new THREE.MeshStandardMaterial({ name: 'cheveux_cartes', roughness: 0.62, metalness: 0, side: THREE.DoubleSide, vertexColors: true });
    mat.alphaToCoverage = true;
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vUvC;').replace('#include <uv_vertex>', '#include <uv_vertex>\nvUvC = uv;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
uniform sampler2D uAtlas; uniform sampler2D uDirC; uniform vec3 uCoulC; uniform float uAppointHab; uniform float uEclatC; varying vec2 vUvC;
float grisC; float racC; float cil63 = 0.0; float lumC63 = 0.2;`)
        .replace('#include <map_fragment>', `
  vec4 tc = texture2D(uAtlas, vUvC);
  { vec2 dx = dFdx(vUvC * 1024.0), dy = dFdy(vUvC * 1024.0);            // J63 : au loin, les mipmaps amincissent les mèches : couverture regonflée
    tc.a = clamp(tc.a * (1.0 + 0.18 * max(0.0, 0.5 * log2(max(dot(dx, dx), dot(dy, dy))))), 0.0, 1.0); }
  cil63 = step(vColor.r, 0.02);                                        // J63 : cils (couleur de sommet nulle), tracés un à un
  if (cil63 > 0.5) {
    float x = (vUvC.x * 8.0 - 5.0) * 26.0, i = floor(x), h = fract(sin(i * 12.9898) * 43758.5453);
    float f = fract(x) - 0.5 + (h - 0.5) * 0.6 * vUvC.y;                // chaque cil penche un peu
    float w = 0.42 * pow(1.0 - vUvC.y, 0.7) * (0.6 + 0.4 * h);
    float un = (1.0 - smoothstep(w * 0.5, w, abs(f))) * step(vUvC.y, 0.75 + 0.25 * h);
    float loin = smoothstep(0.25, 0.9, fwidth(x));                       // de loin, les cils se fondent en une frange sombre
    tc.a = mix(un, 0.95 * pow(1.0 - vUvC.y, 1.6), loin);
  }
  // découpe au seuil de 0,3, adoucie sur la largeur d'un pixel (alpha vers couverture : bord anticrénelé, sans tramage)
  diffuseColor.a = clamp((tc.a - 0.3) / max(fwidth(tc.a), 1e-4) + 0.5, 0.0, 1.0);
  if (diffuseColor.a <= 0.0) discard;
  grisC = tc.r; racC = tc.b;
  // J63 : l'ombre de racine et l'occlusion de chaque carte dessinaient des écailles ; elles sont presque effacées (la chevelure
  // se lit en masse), le fil des mèches (gris de l'atlas) est plus marqué
  diffuseColor.rgb = uCoulC * uEclatC * (0.42 + 0.78 * tc.r) * mix(0.95, 1.0, smoothstep(0.0, 0.4, tc.b)) * (1.0 - 0.08 * tc.g);
  lumC63 = dot(uCoulC, vec3(0.3, 0.59, 0.11));
  diffuseColor.rgb *= mix(1.0, 0.7, smoothstep(0.35, 0.85, lumC63));   // J63 : blancs et blonds pâles moins brûlés au soleil
  if (cil63 > 0.5) diffuseColor.rgb = min(uCoulC * 0.35, vec3(0.05));`)
        .replace('#include <color_fragment>', 'diffuseColor.rgb *= mix(vec3(1.0), vColor.rgb, 0.1 * (1.0 - cil63));')
        .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance = diffuseColor.rgb * uAppointHab;')
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
  // J63 : le reflet large de la matière (blanc) grisait les cheveux sombres : il est presque éteint ; un noir reste noir,
  // avec un reflet étroit et froid le long du fil, et un second lobe de la couleur du cheveu
  reflectedLight.directSpecular *= 0.22; reflectedLight.indirectSpecular *= 0.22;
#if NUM_DIR_LIGHTS > 0
  { vec3 q0 = dFdx(-vViewPosition), q1 = dFdy(-vViewPosition); vec2 st0 = dFdx(vUvC), st1 = dFdy(vUvC);
    vec3 fil = cross(q1, normal) * st0.y + cross(normal, q0) * st1.y;            // sens racine → pointe à l'écran
    if (dot(fil, fil) > 1e-12) {
      fil = normalize(fil);
      float dv = texture2D(uDirC, vUvC).r * 2.0 - 1.0;                             // écart du fil à l'axe de la bande
      fil = normalize(fil + cross(normal, fil) * dv * 0.6);
      vec3 L = directionalLights[0].direction, V = normalize(vViewPosition), Hh = normalize(L + V);
      float d1 = dot(normalize(fil + normal * 0.1), Hh), d2 = dot(normalize(fil - normal * 0.15), Hh);
      float s1 = pow(sqrt(max(0.0, 1.0 - d1 * d1)), 140.0), s2 = pow(sqrt(max(0.0, 1.0 - d2 * d2)), 18.0);
      float nl = clamp(dot(normal, L) * 0.5 + 0.5, 0.0, 1.0);
      float clair = smoothstep(0.3, 0.8, lumC63);                              // cheveux clairs : le second lobe, de la couleur du cheveu, les brûlait en fils blancs
      reflectedLight.directSpecular += directionalLights[0].color * (s1 * vec3(0.036, 0.040, 0.048) * mix(1.0, 0.4, clair) + s2 * 0.1 * uCoulC * mix(1.0, 0.12, clair)) * nl * (0.5 + 0.5 * grisC) * (0.6 + 0.4 * smoothstep(0.0, 0.3, racC));
    } }
#endif`);
    };
    mat.customProgramCacheKey = () => 'cheveux_j63';
    return mat;
  }

  /** Texture de matière (J51) : chargée une fois, répétée, mipmaps (le détail s'efface de lui-même au loin). */
  texture(f) {
    if (!this._tex) this._tex = new Map();
    if (!this._tex.has(f)) {
      let fin; const pret = new Promise((r) => { fin = r; });
      const tx = new THREE.TextureLoader().load(this.url(f), () => fin(), undefined, () => fin());
      tx.wrapS = tx.wrapT = THREE.RepeatWrapping; tx.colorSpace = THREE.NoColorSpace; tx.anisotropy = 4;
      tx.userData.pret = pret;
      this._tex.set(f, tx);
    }
    return this._tex.get(f);
  }
  /** Matières des pièces chargées (sinon la première image montrerait une texture vide : noir). */
  async _matieresPretes(pieces) {
    const MA = this.index.matieres || {}, b = this.index.bruit;
    const f = new Set();
    const C = this.index.cheveux;
    if (C && pieces.some((p) => p.def.cartes)) await Promise.all([this.atlasCheveux(C.atlas).userData.pret, this.atlasCheveux(C.direction).userData.pret]);
    for (const p of pieces) for (const k of [p.def.matiere, p.def.matiere_b]) if (MA[k]) f.add(MA[k].fichier);
    if (f.size && b) f.add(b.fichier);
    await Promise.all([...f].map((x) => this.texture(x).userData.pret));
  }

  /** Teintures : masque RGBA de la pièce (R tissu principal, G secondaire, B cuir ou métal, A ornement) × couleurs choisies.
   *  J51 : matière de détail (trame du lin, sergé de laine, toile, grain du cuir, anneaux des mailles) projetée sur trois plans
   *  dans le repère de repos (mètres), relief à l'écran, salissure vers le bas de la pièce, usure par taches ; l'acier des
   *  mailles n'est plus l'albédo sombre cuit mais une teinte d'acier ; lisière des cheveux adoucie (alpha dégradé). */
  _teindre(m, def, desc, ids = [], hanchesY = 0.95) {
    const mat = m.material;
    const t = desc.teintures || {};
    const te = desc.teintes || {};
    const td = this.index.teintes_defaut || {};
    const choix = (canal, defaut) => { const n = (def.teintes || {})[canal]; return lin(t[n] || (def.cheveux ? null : t[canal]) || te[n] || td[n] || defaut); };   // les cheveux gardent leur couleur
    const u = {
      uT1: { value: choix('principal', '#7a6a48') }, uT2: { value: choix('secondaire', '#5a4a38') },
      uT3: { value: choix('cuir', '#6a4a2a') }, uT4: { value: choix('ornement', '#b8a070') }, uAppointHab: { value: APPOINT },
    };
    const masque = mat.emissiveMap;
    if (masque) { masque.colorSpace = THREE.NoColorSpace; masque.needsUpdate = true; }
    // un masque uniforme est replié par la compression en couleur d'émission (sans texture) : il devient une constante
    u.uMasqueCst = { value: new THREE.Vector4(mat.emissive.r, mat.emissive.g, mat.emissive.b, 1) };
    mat.emissive.setRGB(0, 0, 0);
    mat.side = THREE.DoubleSide;               // ourlets : on voit l'envers du tissu, pas le vide
    // matières (J51)
    const MA = this.index.matieres || {};
    const ma = MA[def.matiere], mb = MA[def.matiere_b];
    const bruit = this.index.bruit;
    const defs = [];
    u.uQ = { value: new THREE.Matrix4() };     // repère de repos en mètres (rempli après la race : voir _repos)
    if (ma && bruit) {
      defs.push('MATIERE_J51');
      Object.assign(u, {
        uDetA: { value: this.texture(ma.fichier) }, uEchA: { value: 1 / ma.taille_m }, uRelA: { value: ma.relief_m || 0.0004 },
        uBruit: { value: this.texture(bruit.fichier) }, uEchB: { value: 1 / bruit.taille_m },
        uSale: { value: new THREE.Vector4(0, def.salissure ? def.salissure[0] : 0, def.salissure ? def.salissure[1] : 0, def.usure || 0) },
        uRugVar: { value: ma.rugosite_var ?? 0.5 },
      });
      if (mb) { defs.push('MATIERE_B_J51'); Object.assign(u, { uDetB: { value: this.texture(mb.fichier) }, uEchDB: { value: 1 / mb.taille_m }, uRelB: { value: mb.relief_m || 0.0004 } }); }
      if (def.acier) { defs.push('ACIER_J51'); u.uAcier = { value: lin(te.metal || td.metal || '#b8b8b8').multiplyScalar(def.acier) }; }
    }
    // jupe cachée sous une autre pièce (haubert sous le surcot) : écartée hors de l'axe des fentes, où la maille se voit
    const dessus = def.jupe_sous && ids.includes(def.jupe_sous.piece);
    if (dessus) { defs.push('JUPE_SOUS_J51'); u.uJupe = { value: new THREE.Vector2(def.jupe_sous.sous_m, def.jupe_sous.axe_m) }; u.uHanchesJ51 = { value: hanchesY }; }
    if (def.plis && ma && bruit) { defs.push('PLIS_J63'); u.uPlis63 = { value: new THREE.Vector3(hanchesY, def.plis[0], def.plis[1]) }; }   // J63 : plis en relief
    if (def.rugosite) mat.roughness = def.rugosite;
    if (def.metal) mat.metalness = Math.min(0.5, def.metal);
    if (def.cheveux) {
      defs.push('LISIERE_J51');
      m.userData.lisiere = def.lisiere_m || 0.018;        // calculée avec le repère de repos (_repos)
      mat.alphaTest = 0.5; mat.alphaToCoverage = true; mat.transparent = false;
    }
    m.userData.uRepos = u;
    const enTete = defs.map((d) => `#define ${d}\n`).join('');
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', `${enTete}#include <common>
uniform mat4 uQ; varying vec3 vRep; varying vec3 vNRep; varying float vYRep; varying float vXRep; varying vec3 vR0;
#ifdef LISIERE_J51
attribute float _lisiere; varying float vLis;
#endif`)
        .replace('#include <skinning_vertex>', `vRep = (uQ * vec4(transformed, 1.0)).xyz; vec3 r0J51 = (uQ * vec4(position, 1.0)).xyz; vYRep = r0J51.y; vXRep = r0J51.x; vR0 = r0J51;
#ifdef LISIERE_J51
vLis = _lisiere;
#endif
#include <skinning_vertex>`)
        .replace('#include <skinbase_vertex>', 'vNRep = normalize(mat3(uQ) * objectNormal);\n#include <skinbase_vertex>');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `${enTete}#include <common>
uniform vec3 uT1; uniform vec3 uT2; uniform vec3 uT3; uniform vec3 uT4; uniform float uAppointHab; uniform vec4 uMasqueCst;
varying vec3 vRep; varying vec3 vNRep; varying float vYRep; varying float vXRep; varying vec3 vR0;
#ifdef PLIS_J63
uniform vec3 uPlis63;
#endif
#ifdef JUPE_SOUS_J51
uniform vec2 uJupe; uniform float uHanchesJ51;
#endif
#ifdef LISIERE_J51
varying float vLis;
#endif
#ifdef MATIERE_J51
uniform sampler2D uDetA; uniform float uEchA; uniform float uRelA; uniform sampler2D uBruit; uniform float uEchB; uniform vec4 uSale; uniform float uRugVar;
#ifdef MATIERE_B_J51
uniform sampler2D uDetB; uniform float uEchDB; uniform float uRelB;
#endif
#ifdef ACIER_J51
uniform vec3 uAcier;
#endif
vec4 triJ51(sampler2D tx, vec3 p, vec3 w) { return texture2D(tx, p.zy) * w.x + texture2D(tx, p.xz) * w.y + texture2D(tx, p.xy) * w.z; }
// relief à l'écran, pente physique : hauteur en mètres, dérivées de la position de vue non normalisées
vec3 reliefJ51(vec3 pos, vec3 n, float h, float fd) {
  vec3 sx = dFdx(pos), sy = dFdy(pos); vec3 r1 = cross(sy, n), r2 = cross(n, sx);
  float det = dot(sx, r1) * fd; vec3 g = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
  return normalize(abs(det) * n - g);
}
#endif`)
        .replace('#include <map_fragment>', `
#ifdef JUPE_SOUS_J51
  if (vYRep < uHanchesJ51 - uJupe.x && abs(vXRep) > uJupe.y) discard;
#endif
#include <map_fragment>
  float sJ51 = 0.0; vec4 dJ51 = vec4(0.5); float hJ51 = 0.0; float mqbJ51 = 0.0; float brutJ51 = diffuseColor.g;
  {
#ifdef USE_EMISSIVEMAP
    vec4 mq = texture2D(emissiveMap, vEmissiveMapUv);
#else
    vec4 mq = uMasqueCst;
#endif
    float orn = clamp((1.0 - mq.a) / 0.85, 0.0, 1.0);          // A = 1 − 0,85 × ornement (jamais nul : WebP)
    float s = clamp(mq.r + mq.g + mq.b + orn, 0.0, 1.0);
    sJ51 = s; mqbJ51 = mq.b;
#ifdef ACIER_J51
    diffuseColor.rgb = uAcier * (1.0 - s) + diffuseColor.rgb * (uT1 * mq.r + uT2 * mq.g + uT3 * mq.b + uT4 * orn);
#else
    diffuseColor.rgb *= vec3(1.0 - s) + uT1 * mq.r + uT2 * mq.g + uT3 * mq.b + uT4 * orn;
#endif
#ifdef MATIERE_J51
    vec3 w = pow(abs(normalize(vNRep)), vec3(4.0)); w /= (w.x + w.y + w.z);
    dJ51 = triJ51(uDetA, vRep * uEchA, w); hJ51 = dJ51.r * uRelA;
#ifdef MATIERE_B_J51
    vec4 dB = triJ51(uDetB, vRep * uEchDB, w);
    dJ51 = mix(dJ51, dB, mq.b); hJ51 = mix(hJ51, dB.r * uRelB, mq.b);
#endif
    vec3 b = triJ51(uBruit, vRep * uEchB, w).rgb;
    vec3 c = diffuseColor.rgb * (2.0 * dJ51.g);
#ifdef PLIS_J63
    { // J63 : plis du tissu, en relief (repère de repos de base, mètres) : godets de la jupe sous la ceinture, fronces à la
      // taille, plis en travers des manches, serrés au coude ; le creux des plis est un peu plus sombre
      vec3 r = vR0; float ang = atan(r.x, r.z);
      float sous = smoothstep(uPlis63.x - 0.03, uPlis63.x - 0.24, r.y);
      float pj = 0.5 + 0.5 * sin(ang * 13.0 + 2.2 * sin(ang * 3.0 + 1.3) + r.y * 5.0);
      float hj = pow(pj, 1.5) * sous * uPlis63.y;
      float taille = exp(-pow((r.y - (uPlis63.x + 0.10)) / 0.05, 2.0)) * (1.0 - smoothstep(0.15, 0.2, abs(r.x)));
      float pt = 0.5 + 0.5 * sin(ang * 27.0 + 3.0 * sin(ang * 5.0));
      float bras = smoothstep(0.18, 0.25, abs(r.x));
      float sb = dot(vec2(abs(r.x) - 0.19, uPlis63.x + 0.50 - r.y), vec2(0.72, 0.69));   // le long du bras depuis l'épaule (pose en A)
      float coude = exp(-pow((sb - 0.30) / 0.07, 2.0)) + 0.3;
      float pm = 0.5 + 0.5 * sin(sb * 140.0 + 4.0 * sin(r.z * 38.0 + sb * 9.0));
      float hm = pm * bras * coude * uPlis63.z;
      hJ51 += hj * 0.007 + pt * taille * uPlis63.z * 0.0025 + hm * 0.0022;
      c *= 1.0 - 0.2 * sous * uPlis63.y * (1.0 - pj) - 0.14 * bras * coude * uPlis63.z * (1.0 - pm) * 0.6;
    }
#endif
    c *= 0.9 + 0.2 * b.r;                                        // teinte inégale (lavages, soleil)
    float lum = dot(c, vec3(0.3, 0.59, 0.11));
    c = mix(c, vec3(lum) * 1.18 + c * 0.1, uSale.w * smoothstep(0.5, 0.82, b.g));   // usure : taches passées
    float sale = uSale.z * smoothstep(uSale.x + uSale.y, uSale.x, vYRep) * (0.45 + 0.9 * b.r) * (0.8 + 0.4 * b.b);
    c = mix(c, c * vec3(0.52, 0.45, 0.37) + vec3(0.018, 0.014, 0.010), clamp(sale, 0.0, 1.0));   // boue et poussière en bas
    diffuseColor.rgb = c;
#endif
  }
#ifdef LISIERE_J51
  {  // lisière des cheveux : dégradé vers le bord, découpé par les mèches de la carte (alpha au recouvrement)
    diffuseColor.a = clamp(vLis * 1.6 - 0.3 + (brutJ51 - 0.6) * 0.9, 0.0, 1.0);
    diffuseColor.rgb *= mix(0.72, 1.0, smoothstep(0.0, 0.9, vLis));
  }
#endif`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
#ifdef MATIERE_J51
  roughnessFactor = clamp(roughnessFactor * (1.0 + (0.5 - dJ51.b) * 2.0 * uRugVar), 0.08, 1.0);
#endif`)
        .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
#ifdef ACIER_J51
  metalnessFactor *= (1.0 - sJ51);
#endif`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
#ifdef MATIERE_J51
  normal = reliefJ51(-vViewPosition, normal, hJ51, faceDirection);
#endif`)
        .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance = diffuseColor.rgb * uAppointHab;');
    };
    mat.customProgramCacheKey = () => 'teinture_j51_' + defs.join('_');
  }

  /** Repère de repos en mètres de chaque pièce (les positions du GLB sont quantifiées : la déquantification est dans les
   *  matrices de liaison) et bas de la pièce (salissure). Os au repos, race appliquée. */
  _repos(maillages) {
    for (const m of maillages) {
      const u = m.userData.uRepos; if (!u) continue;
      const sk = m.skeleton;
      u.uQ.value.multiplyMatrices(sk.bones[0].matrixWorld, sk.boneInverses[0]).multiply(m.bindMatrix);
      if (u.uSale) {
        const b = new THREE.Box3().setFromBufferAttribute(m.geometry.attributes.position).applyMatrix4(u.uQ.value);
        u.uSale.value.x = b.min.y;
      }
      if (m.userData.lisiere) {
        m.geometry.userData.metresParUnite = new THREE.Vector3().setFromMatrixColumn(u.uQ.value, 0).length();
        lisiere(m.geometry, m.userData.lisiere);
      }
    }
  }

}

/** Lisière (J51) : distance au bord libre de la pièce, de 0 sur le bord à 1 à `largeur` mètres (positions soudées : les
 *  coutures du dépliage ne sont pas des bords). Attribut `_lisiere` ; calculé une fois par géométrie. */
function lisiere(g, largeur) {
  if (g.attributes._lisiere) return;
  const P = g.attributes.position, n = P.count, idx = g.index ? g.index.array : Array.from({ length: n }, (_, i) => i);
  const b = new THREE.Box3().setFromBufferAttribute(P), tol = b.getSize(new THREE.Vector3()).length() * 1e-5 + 1e-9;
  const cle = new Map(), id = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const k = Math.round(P.getX(i) / tol) + ',' + Math.round(P.getY(i) / tol) + ',' + Math.round(P.getZ(i) / tol);
    if (!cle.has(k)) cle.set(k, cle.size);
    id[i] = cle.get(k);
  }
  const nb = cle.size, aretes = new Map(), voisins = Array.from({ length: nb }, () => []);
  const pos = new Float64Array(nb * 3);
  for (let i = 0; i < n; i++) { pos[id[i] * 3] = P.getX(i); pos[id[i] * 3 + 1] = P.getY(i); pos[id[i] * 3 + 2] = P.getZ(i); }
  for (let t = 0; t < idx.length; t += 3) for (let e = 0; e < 3; e++) {
    const a = id[idx[t + e]], c = id[idx[t + (e + 1) % 3]];
    if (a === c) continue;
    const k = a < c ? a * nb + c : c * nb + a;
    aretes.set(k, (aretes.get(k) || 0) + 1);
  }
  const dist = new Float64Array(nb).fill(Infinity), file = [];
  for (const [k, c] of aretes) {
    const a = Math.floor(k / nb), d = k % nb;
    const l = Math.hypot(pos[a * 3] - pos[d * 3], pos[a * 3 + 1] - pos[d * 3 + 1], pos[a * 3 + 2] - pos[d * 3 + 2]);
    voisins[a].push(d, l); voisins[d].push(a, l);
    if (c === 1) { dist[a] = 0; dist[d] = 0; }
  }
  for (let i = 0; i < nb; i++) if (dist[i] === 0) file.push(i);
  // relâchement (Dijkstra simplifié, quelques milliers de sommets) ; `largeur` en mètres → unités quantifiées
  const echelle = g.userData.metresParUnite || 1;
  for (let q = 0; q < file.length; q++) {
    const a = file[q], v = voisins[a];
    for (let j = 0; j < v.length; j += 2) {
      const d = dist[a] + v[j + 1] * echelle;
      if (d < dist[v[j]] && d < largeur) { dist[v[j]] = d; file.push(v[j]); }
    }
  }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.min(1, dist[id[i]] / largeur);
  g.setAttribute('_lisiere', new THREE.BufferAttribute(out, 1));
}

