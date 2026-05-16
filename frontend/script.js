/**
 * ============================================================================
 * SNCF DATA PROJECT - MODULE CARTOGRAPHIQUE INTERACTIF (v10)
 * ============================================================================
 * Isochrone ferroviaire :
 * - Seules les grandes gares (Segment A du GeoJSON) affichées comme marqueurs
 * - Pas de marqueurs aux gares ordinaires (trop de points, peu utile)
 * - Les traces sont clippées à la bbox France (plus de débordement en Italie)
 * - Curseur interactif sans recalcul (Dijkstra source unique en cache)
 * - Gradient vert (<2h) → orange (5h) → rouge (>10h)
 */

// ============================================================================
// SECTION 1 : VARIABLES GLOBALES
// ============================================================================
let map;
let infoWindow;

// Réseau ferré
let reseauData;
let reseauDataLoaded = false;
let reseauVisible = false;
let ligneSelectionnee = null;
let listenerClicCarteAttache = false;

// Gares
let toutesLesGares = [];
let marqueursAffiches = [];
let garesDataLoaded = false;
let garesVisible = false;
let filtreGaresType = 'toutes'; // 'toutes', 'tgv', 'ter'

// Complémentaires
let wifiSet = null;
let heatmap = null;
let frequentationVisible = false;
const cacheWikipedia = new Map();

// Comparateur
let tarifsVisible = false;
let grapheInitialise = false;
let indexGares = null;
let adjacence = null;
let trajetActuel = null;

// Isochrone
let isochroneVisible = false;
let isochroneResultat = null;
let isochroneGareSource = -1;
let isochronePolylines = [];
let isochroneMarqueurs = [];

// Set des indices GTFS correspondant aux grandes gares (Segment A)
// Construit une seule fois lors du premier initialiserGraphe()
let grandesGaresIdx = null;

// Bbox stricte France métropolitaine + Corse (on coupe tout ce qui sort)
const FRANCE_BBOX = { latMin: 41.0, latMax: 51.5, lngMin: -5.5, lngMax: 9.5 };

// ============================================================================
// SECTION 2 : UTILITAIRES
// ============================================================================

/** Renvoie true si un point lat/lng est dans la bbox France */
function dansLaFrance(lat, lng) {
    return lat >= FRANCE_BBOX.latMin && lat <= FRANCE_BBOX.latMax &&
           lng >= FRANCE_BBOX.lngMin && lng <= FRANCE_BBOX.lngMax;
}

/**
 * Filtre une liste de points [[lat,lng],...] pour ne garder que les segments
 * entièrement dans la bbox France. Renvoie une liste de sous-polylines
 * continues (pour gérer les cas où on entre/sort de France).
 */
function clipperEnFrance(points) {
    if (!points || points.length === 0) return [];
    const segments = [];
    let courant = [];
    for (const [lat, lng] of points) {
        if (dansLaFrance(lat, lng)) {
            courant.push({ lat, lng });
        } else {
            if (courant.length >= 2) segments.push(courant);
            courant = [];
        }
    }
    if (courant.length >= 2) segments.push(courant);
    return segments;
}

/** Distance approchée entre deux points GPS (degrés, suffisant pour comparer) */
function distDeg(lat1, lng1, lat2, lng2) {
    return Math.hypot(lat1 - lat2, lng1 - lng2);
}

/** Formatte des minutes en "Xh YYmin" */
function formatMinutes(min) {
    const h = Math.floor(min / 60), m = Math.round(min % 60);
    if (h === 0) return `${m} min`;
    if (m === 0) return `${h}h`;
    return `${h}h${String(m).padStart(2, '0')}`;
}

// ============================================================================
// SECTION 3 : RÉSEAU FERRÉ (calque on/off)
// ============================================================================

function appliquerStyleReseau() {
    reseauData.setStyle(function(feature) {
        if (!reseauVisible) return { visible: false };
        const estLGV = feature.getProperty('CATLIG') === 'Ligne à grande vitesse';
        const couleurBase = estLGV ? '#E20074' : '#0055A4';
        const epaisseurBase = estLGV ? 4 : 1.5;
        if (ligneSelectionnee) {
            return feature === ligneSelectionnee
                ? { strokeColor: couleurBase, strokeWeight: epaisseurBase + 3, strokeOpacity: 1, zIndex: 100, clickable: false, visible: true }
                : { strokeColor: '#999', strokeWeight: epaisseurBase, strokeOpacity: 0.3, zIndex: 1, clickable: false, visible: true };
        }
        return { strokeColor: couleurBase, strokeWeight: epaisseurBase, strokeOpacity: 0.8, zIndex: estLGV ? 10 : 5, clickable: false, visible: true };
    });
}

function selectionnerLigne(feature, latLng) {
    ligneSelectionnee = feature;
    appliquerStyleReseau();
    const typeLigne = feature.getProperty('CATLIG') || 'Inconnu';
    const idLigne = feature.getProperty('LIB_LIGNE') || feature.getProperty('CODE_LIGNE') || "Inconnue";
    const estLGV = typeLigne === 'Ligne à grande vitesse';
    infoWindow.setContent(`
        <div style="color:#333;font-family:sans-serif;padding:5px;min-width:220px;">
            <h3 style="margin:0 0 8px 0;color:#004696;font-size:16px;">Ligne ${idLigne}</h3>
            <p style="margin:4px 0;font-size:13px;"><strong>Type :</strong> ${typeLigne}</p>
            <hr style="border:0;border-top:1px solid #eee;margin:8px 0;">
            <p style="margin:4px 0;font-size:12px;"><strong>Service :</strong> ${estLGV ? 'TGV' : 'TER/IC'}</p>
            <p style="margin:4px 0;font-size:12px;"><strong>Tarif moyen :</strong> ${estLGV ? '0,18 €/km' : '0,10 à 0,15 €/km'}</p>
            <p style="margin:4px 0;font-size:12px;"><strong>Vitesse :</strong> ${estLGV ? '~250 km/h' : '~90 km/h'}</p>
        </div>`);
    infoWindow.setPosition(latLng);
    infoWindow.open(map);
}

function deselectionnerLigne() {
    if (ligneSelectionnee || infoWindow.getMap()) {
        ligneSelectionnee = null;
        appliquerStyleReseau();
        infoWindow.close();
    }
}

function distancePointSegment(px, py, ax, ay, bx, by) {
    const l2 = (ax-bx)**2+(ay-by)**2;
    if (l2 === 0) return Math.hypot(px-ax, py-ay);
    const t = Math.max(0, Math.min(1, ((px-ax)*(bx-ax)+(py-ay)*(by-ay))/l2));
    return Math.hypot(px-(ax+t*(bx-ax)), py-(ay+t*(by-ay)));
}

function loadLGVLines() {
    if (!reseauDataLoaded) {
        if (typeof reseauGeoJsonData === 'undefined') { alert("Erreur : reseau.js manquant."); return; }
        reseauData.addGeoJson(reseauGeoJsonData);
        reseauDataLoaded = true;
    }
    if (!listenerClicCarteAttache) {
        map.addListener('click', function(event) {
            if (!reseauVisible) return;
            const clicLat = event.latLng.lat(), clicLng = event.latLng.lng();
            let mL = null, mD = 0.05;
            reseauData.forEach(function(feature) {
                const geo = feature.getGeometry();
                const v = (path) => {
                    const pts = path.getArray();
                    for (let i = 0; i < pts.length - 1; i++) {
                        const d = distancePointSegment(clicLng, clicLat, pts[i].lng(), pts[i].lat(), pts[i+1].lng(), pts[i+1].lat());
                        if (d < mD) { mD = d; mL = feature; }
                    }
                };
                if (geo.getType() === 'LineString') v(geo);
                else if (geo.getType() === 'MultiLineString') geo.getArray().forEach(v);
            });
            if (mL) selectionnerLigne(mL, event.latLng);
            else deselectionnerLigne();
        });
        listenerClicCarteAttache = true;
    }
    appliquerStyleReseau();
}

function initialiserWifi() {
    if (wifiSet === null) {
        wifiSet = new Set();
        if (typeof wifiData !== 'undefined' && Array.isArray(wifiData))
            wifiData.forEach(g => g && g.nom && wifiSet.add(g.nom.toLowerCase()));
    }
}

function loadGares() {
    if (!garesDataLoaded) {
        if (typeof garesGeoJsonData === 'undefined') { alert("Erreur : gares.js manquant."); return; }
        toutesLesGares = garesGeoJsonData.features || [];
        garesDataLoaded = true;
        initialiserWifi();
    }
    actualiserAffichageGares();
}

// ============================================================================
// SECTION 4 : AFFICHAGE GARES (calque on/off)
// ============================================================================

function mettreAJourFiltreGares() {
    const select = document.getElementById('filtre-gares-select');
    if (select) {
        filtreGaresType = select.value;
        actualiserAffichageGares();
    }
}

function actualiserAffichageGares() {
    if (!garesVisible) { marqueursAffiches.forEach(m => m.setMap(null)); marqueursAffiches = []; return; }
    const z = map.getZoom(), lim = map.getBounds();
    if (!lim) return;
    marqueursAffiches.forEach(m => m.setMap(null)); marqueursAffiches = [];
    
    toutesLesGares.forEach(feature => {
        const c = feature.geometry.coordinates, p = feature.properties;
        const seg = p['Segment(s) DRG'];
        
        // Filtre selon le choix de l'utilisateur
        if (filtreGaresType === 'tgv' && seg !== 'A') return;
        if (filtreGaresType === 'ter' && seg === 'A') return;

        const pos = new google.maps.LatLng(c[1], c[0]);
        if (!lim.contains(pos)) return;
        
        // Ajustement de la performance selon le niveau de zoom
        // On permet de voir plus de TER si l'utilisateur demande explicitement les TER
        if (filtreGaresType === 'toutes') {
            if (z < 8 && seg !== 'A') return;
            if (z < 11 && seg === 'C') return;
        } else if (filtreGaresType === 'ter') {
            if (z < 7 && seg !== 'A') return;
            if (z < 9 && seg === 'C') return;
        }

        const taille = seg === 'A' ? 9 : (seg === 'B' ? 7 : 5);
        const coul = seg === 'A' ? '#E20074' : (seg === 'B' ? '#0088CE' : '#6C757D');
        const marker = new google.maps.Marker({
            position: pos, map, title: p['Nom'],
            icon: { path: google.maps.SymbolPath.CIRCLE, scale: taille, fillColor: coul, fillOpacity: 0.9, strokeColor: '#FFFFFF', strokeWeight: 1 }
        });
        marker.addListener('click', () => afficherBulleGare(marker, p, seg, coul));
        marqueursAffiches.push(marker);
    });
}

async function afficherBulleGare(marker, props, segment, couleurPoint) {
    let nomGare = props['Nom'].replace(/ - /g, '-');
    const voyelle = /^[AEIOUYÉÈÊËÀÂÄÎÏÔÖÛÜ]/i.test(nomGare);
    const nomComplet = (voyelle ? "Gare d'" : "Gare de ") + nomGare;
    const lienWiki = "https://fr.wikipedia.org/w/index.php?search=" + encodeURIComponent(nomComplet);
    const idBulle = props['Code(s) UIC'];
    const aWifi = wifiSet && wifiSet.has(props['Nom'].toLowerCase());
    const badge = aWifi ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0088CE" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-left:8px;vertical-align:middle;"><title>Wi-Fi</title><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><path d="M5 12.55a11 11 0 0 1 14.08 0"/><circle cx="12" cy="20" r="1.5" fill="#0088CE" stroke="none"/></svg>` : '';
    infoWindow.setContent(`
        <div style="color:#333;font-family:sans-serif;padding:5px;min-width:200px;text-align:center;">
            <div id="wiki-img-${idBulle}" style="min-height:20px;margin-bottom:10px;"><span style="font-size:11px;color:#888;font-style:italic;">Recherche d'image… ⏳</span></div>
            <h3 style="margin:0 0 5px 0;color:${couleurPoint};font-size:16px;display:flex;align-items:center;justify-content:center;">${props['Nom']} ${badge}</h3>
            <p style="margin:0;font-size:14px;"><strong>Code UIC :</strong> ${idBulle}</p>
            <p style="margin:0;font-size:12px;color:#666;">Catégorie : ${segment}</p>
            <div style="margin-top:10px;border-top:1px solid #eee;padding-top:8px;"><a href="${lienWiki}" target="_blank" rel="noopener" style="color:#0055A4;text-decoration:none;font-size:13px;font-weight:bold;">🌐 Voir sur Wikipédia ↗</a></div>
        </div>`);
    infoWindow.open(map, marker);
    chargerImageWikipedia(nomComplet, idBulle);
}

async function chargerImageWikipedia(nomComplet, idBulle) {
    const masquer = () => { const c = document.getElementById(`wiki-img-${idBulle}`); if (c) c.style.display = 'none'; };
    const afficher = (url, alt) => { const c = document.getElementById(`wiki-img-${idBulle}`); if (c) c.innerHTML = `<img src="${url}" alt="${alt}" style="width:100%;max-height:140px;object-fit:cover;border-radius:6px;box-shadow:0 2px 4px rgba(0,0,0,0.2);">`; };
    if (cacheWikipedia.has(nomComplet)) { const r = cacheWikipedia.get(nomComplet); r === null ? masquer() : afficher(r.url, r.titre); return; }
    try {
        const ds = await (await fetch(`https://fr.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(nomComplet)}&limit=1&format=json&origin=*`)).json();
        if (ds[1]?.length > 0) {
            const titre = ds[1][0];
            const r = await fetch(`https://fr.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(titre)}`);
            if (r.ok) { const d = await r.json(); if (d.thumbnail?.source) { cacheWikipedia.set(nomComplet, { url: d.thumbnail.source, titre }); afficher(d.thumbnail.source, titre); return; } }
        }
        cacheWikipedia.set(nomComplet, null); masquer();
    } catch (e) { masquer(); }
}

// ============================================================================
// SECTION 5 : FRÉQUENTATION
// ============================================================================

function loadFrequentation() {
    if (!heatmap) {
        if (typeof frequentationData === 'undefined') { alert("Erreur : frequentation.js manquant."); return; }
        heatmap = new google.maps.visualization.HeatmapLayer({
            data: frequentationData.map(p => ({ location: new google.maps.LatLng(p.lat, p.lng), weight: p.poids })),
            radius: 30, opacity: 0.7, maxIntensity: 5000000,
            gradient: ['rgba(0,0,255,0)', 'rgba(65,105,225,1)', 'rgba(0,255,255,1)', 'rgba(0,255,0,1)', 'rgba(255,255,0,1)', 'rgba(255,165,0,1)', 'rgba(255,0,0,1)']
        });
    }
    heatmap.setMap(frequentationVisible ? map : null);
}

// ============================================================================
// SECTION 6 : GRAPHE GTFS + DIJKSTRA
// ============================================================================

function normaliserNomGare(nom) {
    return nom.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[-_'"]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Construit le Set des indices GTFS correspondant aux grandes gares (Segment A).
 * Matching par proximité géographique : pour chaque gare Segment A du GeoJSON,
 * on trouve la gare GTFS la plus proche (distance < 0.5 km).
 */
function construireGrandesGares() {
    if (grandesGaresIdx !== null) return;
    grandesGaresIdx = new Set();
    if (typeof garesGeoJsonData === 'undefined') return;

    const garesSegA = garesGeoJsonData.features
        .filter(f => f.properties['Segment(s) DRG'] === 'A')
        .map(f => ({ lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], nom: f.properties['Nom'] }));

    const SEUIL_DEG = 0.015; // ≈ 1.5 km
    grapheSNCF.gares.forEach((gGtfs, idx) => {
        for (const gA of garesSegA) {
            if (distDeg(gGtfs.lat, gGtfs.lon, gA.lat, gA.lng) < SEUIL_DEG) {
                grandesGaresIdx.add(idx);
                break;
            }
        }
    });
    console.log(`✓ Grandes gares (Segment A) trouvées dans GTFS : ${grandesGaresIdx.size}`);
}

function initialiserGraphe() {
    if (grapheInitialise) return true;
    if (typeof grapheSNCF === 'undefined') {
        alert("Erreur : graphe.js manquant.\n\nLance :\n  python3 convertir_lignes_en_js.py\n  python3 testghps.py");
        return false;
    }
    indexGares = new Map();
    grapheSNCF.gares.forEach((g, i) => indexGares.set(normaliserNomGare(g.nom), i));
    adjacence = Array.from({ length: grapheSNCF.gares.length }, () => []);
    grapheSNCF.aretes.forEach(ar => {
        adjacence[ar.a].push({ voisin: ar.b, duree: ar.duree, distance: ar.distance, cat: ar.cat, trace: ar.trace, sens: 1 });
        adjacence[ar.b].push({ voisin: ar.a, duree: ar.duree, distance: ar.distance, cat: ar.cat, trace: ar.trace, sens: -1 });
    });
    const dl = document.getElementById('liste-gares');
    if (dl) dl.innerHTML = grapheSNCF.gares.map(g => g.nom).sort().map(n => `<option value="${n.replace(/"/g, '&quot;')}">`).join('');
    const selIso = document.getElementById('isochrone-gare-select');
    if (selIso) {
        const triees = grapheSNCF.gares.map((g, i) => ({ nom: g.nom, idx: i })).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
        selIso.innerHTML = '<option value="">— Choisir une gare —</option>' +
            triees.map(g => `<option value="${g.idx}">${g.nom}</option>`).join('');
    }
    grapheInitialise = true;
    construireGrandesGares();
    console.log(`✓ Graphe GTFS : ${grapheSNCF.gares.length} gares, ${grapheSNCF.aretes.length} arêtes`);
    return true;
}

function trouverGare(nomSaisi) {
    if (!nomSaisi?.trim()) return -1;
    const norm = normaliserNomGare(nomSaisi);
    if (indexGares.has(norm)) return indexGares.get(norm);
    for (const [c, i] of indexGares.entries()) if (c.startsWith(norm)) return i;
    for (const [c, i] of indexGares.entries()) if (c.includes(norm)) return i;
    return -1;
}

function dijkstraDepuisSource(source, maxMinutes) {
    const n = grapheSNCF.gares.length;
    const dist = new Float64Array(n).fill(Infinity);
    const pred = new Int32Array(n).fill(-1);
    const segPred = new Array(n).fill(null);
    const vu = new Uint8Array(n);
    dist[source] = 0;
    const heap = new MinHeap();
    heap.push(0, source);
    while (heap.size() > 0) {
        const [d, u] = heap.pop();
        if (vu[u]) continue;
        if (d > maxMinutes) break;
        vu[u] = 1;
        for (const ar of adjacence[u]) {
            if (vu[ar.voisin]) continue;
            const nd = d + ar.duree;
            if (nd < dist[ar.voisin]) {
                dist[ar.voisin] = nd;
                pred[ar.voisin] = u;
                segPred[ar.voisin] = ar;
                heap.push(nd, ar.voisin);
            }
        }
    }
    return { dist, pred, segPred };
}

function dijkstra(depart, arrivee) {
    const n = grapheSNCF.gares.length;
    const dist = new Float64Array(n).fill(Infinity);
    const pred = new Int32Array(n).fill(-1);
    const segPred = new Array(n).fill(null);
    const vu = new Uint8Array(n);
    dist[depart] = 0;
    const heap = new MinHeap();
    heap.push(0, depart);
    while (heap.size() > 0) {
        const [d, u] = heap.pop();
        if (vu[u]) continue;
        vu[u] = 1;
        if (u === arrivee) break;
        for (const ar of adjacence[u]) {
            if (vu[ar.voisin]) continue;
            const nd = d + ar.duree;
            if (nd < dist[ar.voisin]) {
                dist[ar.voisin] = nd; pred[ar.voisin] = u; segPred[ar.voisin] = ar;
                heap.push(nd, ar.voisin);
            }
        }
    }
    if (dist[arrivee] === Infinity) return null;
    const chemin = [], segments = [];
    let u = arrivee;
    while (u !== -1) {
        chemin.unshift(u);
        if (pred[u] !== -1) segments.unshift({ de: pred[u], vers: u, duree: segPred[u].duree, distance: segPred[u].distance, cat: segPred[u].cat, trace: segPred[u].trace, sens: segPred[u].sens });
        u = pred[u];
    }
    return { chemin, dureeTotale: dist[arrivee], segments };
}

class MinHeap {
    constructor() { this.d = []; }
    size() { return this.d.length; }
    push(p, v) { this.d.push([p, v]); this._up(this.d.length - 1); }
    pop() { const t = this.d[0], l = this.d.pop(); if (this.d.length) { this.d[0] = l; this._down(0); } return t; }
    _up(i) { while (i > 0) { const p = (i - 1) >> 1; if (this.d[p][0] <= this.d[i][0]) break; [this.d[p], this.d[i]] = [this.d[i], this.d[p]]; i = p; } }
    _down(i) { const n = this.d.length; while (true) { const l = 2*i+1, r = 2*i+2; let s = i; if (l < n && this.d[l][0] < this.d[s][0]) s = l; if (r < n && this.d[r][0] < this.d[s][0]) s = r; if (s === i) break; [this.d[i], this.d[s]] = [this.d[s], this.d[i]]; i = s; } }
}

// ============================================================================
// SECTION 7 : ISOCHRONE — couleur et affichage
// ============================================================================

function couleurIsochrone(minutes) {
    const lerp = (a, b, t) => Math.round(a + (b - a) * t);
    if (minutes <= 120) {
        return '#00C853';
    } else if (minutes <= 300) {
        const t = (minutes - 120) / 180;
        return `rgb(${lerp(0, 255, t)},${lerp(200, 109, t)},${lerp(83, 0, t)})`;
    } else if (minutes <= 600) {
        const t = (minutes - 300) / 300;
        return `rgb(${lerp(255, 213, t)},${lerp(109, 0, t)},0)`;
    }
    return '#D50000';
}

function afficherIsochrone(idxSource, maxMinutes) {
    if (!initialiserGraphe()) return;

    if (isochroneGareSource !== idxSource || isochroneResultat === null) {
        const t0 = performance.now();
        isochroneResultat = dijkstraDepuisSource(idxSource, 900);
        isochroneGareSource = idxSource;
        console.log(`✓ Dijkstra isochrone : ${(performance.now() - t0).toFixed(0)} ms`);
    }

    effacerIsochrone();

    const { dist, pred, segPred } = isochroneResultat;
    const aretesDessinees = new Set();
    let nbGrandesGaresAtteintes = 0;

    for (let i = 0; i < grapheSNCF.gares.length; i++) {
        if (i === idxSource) continue;
        const d = dist[i];
        if (d > maxMinutes || d === Infinity) continue;

        let u = i;
        while (pred[u] !== -1) {
            const ar = segPred[u];
            const cle = Math.min(pred[u], u) + '_' + Math.max(pred[u], u);
            if (!aretesDessinees.has(cle)) {
                aretesDessinees.add(cle);
                
                if (ar.trace && ar.trace.length >= 2) {
                    const avgSegmentLength = ar.distance / (ar.trace.length - 1);
                    if (avgSegmentLength <= 4.0) {
                        let pts = ar.trace.map(c => [c[0], c[1]]);
                        if (ar.sens === -1) pts = pts.slice().reverse();
                        const segments = clipperEnFrance(pts);
                        const couleur = couleurIsochrone(dist[u]);
                        for (const seg of segments) {
                            if (seg.length < 2) continue;
                            isochronePolylines.push(new google.maps.Polyline({
                                path: seg, geodesic: false,
                                strokeColor: couleur,
                                strokeOpacity: 0.85,
                                strokeWeight: 4,
                                zIndex: 50,
                                map
                            }));
                        }
                    }
                }
            }
            u = pred[u];
        }

        if (grandesGaresIdx && grandesGaresIdx.has(i)) {
            nbGrandesGaresAtteintes++;
        }
    }

    const gareSource = grapheSNCF.gares[idxSource];
    const mkSource = new google.maps.Marker({
        position: { lat: gareSource.lat, lng: gareSource.lon },
        map,
        title: gareSource.nom + ' (départ)',
        icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 13,
            fillColor: '#003570',
            fillOpacity: 1,
            strokeColor: '#FFFFFF',
            strokeWeight: 2.5
        },
        zIndex: 300
    });
    mkSource.addListener('click', () => {
        infoWindow.setContent(`<div style="font-family:sans-serif;padding:6px 8px;"><strong style="color:#003570;">${gareSource.nom}</strong><br><span style="font-size:12px;color:#666;">Gare de départ</span></div>`);
        infoWindow.open(map, mkSource);
    });
    isochroneMarqueurs.push(mkSource);

    const stats = document.getElementById('isochrone-nb-gares');
    if (stats) {
        const nbTotal = [...Array(grapheSNCF.gares.length).keys()].filter(i => i !== idxSource && dist[i] <= maxMinutes && dist[i] !== Infinity).length;
        stats.textContent = `${nbTotal} gares atteignables · ${nbGrandesGaresAtteintes} grandes gares`;
    }

    console.log(`✓ Isochrone : ${isochronePolylines.length} segments, ${nbGrandesGaresAtteintes} grandes gares atteintes`);
}

function effacerIsochrone() {
    isochronePolylines.forEach(p => p.setMap(null)); isochronePolylines = [];
    isochroneMarqueurs.forEach(m => m.setMap(null)); isochroneMarqueurs = [];
}

// ============================================================================
// SECTION 8 : COMPARATEUR — interface
// ============================================================================

function calculerTrajet() {
    if (!initialiserGraphe()) return;
    const inputDep = document.getElementById('gare-depart').value;
    const inputArr = document.getElementById('gare-arrivee').value;
    const resultat = document.getElementById('tarifs-resultat');
    const idxDep = trouverGare(inputDep), idxArr = trouverGare(inputArr);
    if (idxDep === -1) { resultat.innerHTML = `<div class="resultat-erreur">Gare de départ introuvable : « ${inputDep} »</div>`; return; }
    if (idxArr === -1) { resultat.innerHTML = `<div class="resultat-erreur">Gare d'arrivée introuvable : « ${inputArr} »</div>`; return; }
    if (idxDep === idxArr) { resultat.innerHTML = `<div class="resultat-erreur">Départ et arrivée identiques.</div>`; return; }
    resultat.innerHTML = `<div class="resultat-loading">Calcul en cours…</div>`;
    setTimeout(() => {
        const t0 = performance.now();
        const trajet = dijkstra(idxDep, idxArr);
        if (!trajet) { resultat.innerHTML = `<div class="resultat-erreur">Aucun itinéraire trouvé.</div>`; return; }
        afficherResultatTrajet(trajet, idxDep, idxArr, (performance.now() - t0).toFixed(0));
        afficherTrajetSurCarte(trajet);
    }, 50);
}

function afficherResultatTrajet(trajet, idxDep, idxArr, tCalc) {
    const resultat = document.getElementById('tarifs-resultat');
    const tk = grapheSNCF.tarifs_km;
    let distT = 0, prixT = 0;
    const cats = new Set();
    trajet.segments.forEach(s => { distT += s.distance; prixT += s.distance * tk[s.cat]; cats.add(s.cat); });
    const corr = trajet.segments.filter((s, i) => i > 0 && s.cat !== trajet.segments[i-1].cat).length;
    const h = Math.floor(trajet.dureeTotale / 60), m = Math.round(trajet.dureeTotale % 60);
    const dF = h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m} min`;
    const det = trajet.segments.map(s => `
        <div class="segment-trajet">
            <span class="segment-cat segment-cat-${s.cat}">${s.cat}</span>
            <span class="segment-trajet-noms">${grapheSNCF.gares[s.de].nom} → ${grapheSNCF.gares[s.vers].nom}</span>
            <span class="segment-trajet-info">${Math.round(s.duree)} min · ${s.distance.toFixed(0)} km</span>
        </div>`).join('');
    resultat.innerHTML = `
        <div class="resultat-trajet">
            <div class="resultat-header"><h4>${grapheSNCF.gares[idxDep].nom} → ${grapheSNCF.gares[idxArr].nom}</h4><span class="resultat-meta">Calculé en ${tCalc} ms</span></div>
            <div class="resultat-chiffres">
                <div class="chiffre-bloc"><span class="chiffre-label">Durée</span><span class="chiffre-valeur">${dF}</span></div>
                <div class="chiffre-bloc"><span class="chiffre-label">Distance</span><span class="chiffre-valeur">${distT.toFixed(0)} km</span></div>
                <div class="chiffre-bloc"><span class="chiffre-label">Prix estimé</span><span class="chiffre-valeur">${prixT.toFixed(2)} €</span></div>
                <div class="chiffre-bloc"><span class="chiffre-label">Correspondances</span><span class="chiffre-valeur">${corr}</span></div>
            </div>
            <details class="resultat-details"><summary>Détail (${trajet.segments.length} segments)</summary><div class="segments-liste">${det}</div></details>
            <div class="resultat-disclaimer">💡 Prix estimé (${[...cats].join(', ')}). Tarifs réels variables.</div>
        </div>`;
}

function afficherTrajetSurCarte(trajet) {
    effacerTrajetSurCarte();
    const polys = [];
    trajet.segments.forEach(seg => {
        if (!seg.trace || seg.trace.length < 2) return;
        
        const avgSegmentLength = seg.distance / (seg.trace.length - 1);
        if (avgSegmentLength > 4.0) return;
        
        let pts = seg.trace.map(c => ({ lat: c[0], lng: c[1] }));
        if (seg.sens === -1) pts = pts.slice().reverse();
        const clipped = clipperEnFrance(pts.map(p => [p.lat, p.lng]));
        clipped.forEach(sub => {
            if (sub.length >= 2) polys.push(new google.maps.Polyline({
                path: sub, geodesic: false, strokeColor: '#FF6B00',
                strokeOpacity: 0.9, strokeWeight: 5, zIndex: 200, map
            }));
        });
    });
    const gDep = grapheSNCF.gares[trajet.chemin[0]], gArr = grapheSNCF.gares[trajet.chemin[trajet.chemin.length - 1]];
    const mkDep = new google.maps.Marker({ position: { lat: gDep.lat, lng: gDep.lon }, map, title: gDep.nom + ' (Départ)', label: { text: 'A', color: 'white', fontWeight: 'bold' }, icon: { path: google.maps.SymbolPath.CIRCLE, scale: 14, fillColor: '#28a745', fillOpacity: 1, strokeColor: '#FFFFFF', strokeWeight: 2 }, zIndex: 300 });
    const mkArr = new google.maps.Marker({ position: { lat: gArr.lat, lng: gArr.lon }, map, title: gArr.nom + ' (Arrivée)', label: { text: 'B', color: 'white', fontWeight: 'bold' }, icon: { path: google.maps.SymbolPath.CIRCLE, scale: 14, fillColor: '#dc3545', fillOpacity: 1, strokeColor: '#FFFFFF', strokeWeight: 2 }, zIndex: 300 });
    trajetActuel = { polylines: polys, markerDep: mkDep, markerArr: mkArr };
    const bounds = new google.maps.LatLngBounds();
    trajet.segments.forEach(s => { if (s.trace) s.trace.forEach(c => { if (dansLaFrance(c[0], c[1])) bounds.extend({ lat: c[0], lng: c[1] }); }); });
    bounds.extend({ lat: gDep.lat, lng: gDep.lon }); bounds.extend({ lat: gArr.lat, lng: gArr.lon });
    map.fitBounds(bounds, 80);
}

function effacerTrajetSurCarte() {
    if (trajetActuel) { trajetActuel.polylines.forEach(p => p.setMap(null)); trajetActuel.markerDep.setMap(null); trajetActuel.markerArr.setMap(null); trajetActuel = null; }
}

// ============================================================================
// SECTION 9 : INIT MAP & MENU
// ============================================================================

function initMap() {
    const loader = document.getElementById('map-loading');
    if (loader) loader.remove();
    map = new google.maps.Map(document.getElementById("app-container"), {
        center: { lat: 46.603354, lng: 1.888334 }, zoom: 6, minZoom: 5,
        mapId: 'def9248b61a9c229f43789e9',
        restriction: { latLngBounds: { north: 51.5, south: 41.0, west: -5.5, east: 9.5 }, strictBounds: false },
        disableDefaultUI: true, zoomControl: true, gestureHandling: 'greedy'
    });
    reseauData = new google.maps.Data();
    reseauData.setMap(map);
    infoWindow = new google.maps.InfoWindow({ disableAutoPan: true });
    const legend = document.getElementById("map-legend");
    if (legend) { legend.style.display = "block"; map.controls[google.maps.ControlPosition.BOTTOM_LEFT].push(legend); }
    map.addListener('idle', function() { if (garesVisible) actualiserAffichageGares(); });
}

function basculerBouton(appName, estActif) {
    const b = document.getElementById("btn-" + appName);
    if (b) b.classList.toggle("active", estActif);
}

function loadApp(appName) {
    if (!map) return;
    if (infoWindow) infoWindow.close();
    
    if (appName === 'gares') {
        garesVisible = !garesVisible; 
        basculerBouton('gares', garesVisible);
        
        // Affichage du panneau des gares
        const panel = document.getElementById('gares-panel');
        if (panel) panel.style.display = garesVisible ? 'block' : 'none';

        if (garesVisible && !garesDataLoaded) loadGares(); 
        else actualiserAffichageGares();
    } 
    else if (appName === 'reseau') {
        reseauVisible = !reseauVisible; basculerBouton('reseau', reseauVisible);
        loadLGVLines(); if (!reseauVisible) deselectionnerLigne();
    } 
    else if (appName === 'frequentation') {
        frequentationVisible = !frequentationVisible; basculerBouton('frequentation', frequentationVisible);
        loadFrequentation();
    } 
    else if (appName === 'tarifs') {
        tarifsVisible = !tarifsVisible; basculerBouton('tarifs', tarifsVisible);
        document.getElementById('tarifs-panel').style.display = tarifsVisible ? 'block' : 'none';
        if (tarifsVisible) initialiserGraphe(); else effacerTrajetSurCarte();
    } 
    else if (appName === 'isochrone') {
        isochroneVisible = !isochroneVisible; basculerBouton('isochrone', isochroneVisible);
        document.getElementById('isochrone-panel').style.display = isochroneVisible ? 'block' : 'none';
        if (isochroneVisible) initialiserGraphe();
        else { effacerIsochrone(); isochroneResultat = null; isochroneGareSource = -1; }
    }
}

function showView(viewName) {
    const dv = document.getElementById('dashboard-view'), av = document.getElementById('about-view');
    if (viewName === 'home') { dv.style.display = 'block'; av.style.display = 'none'; if (map) google.maps.event.trigger(map, 'resize'); }
    else if (viewName === 'about') { dv.style.display = 'none'; av.style.display = 'block'; }
}

function mettreAJourIsochrone() {
    const sel = document.getElementById('isochrone-gare-select');
    const cursor = document.getElementById('isochrone-curseur');
    const idxSource = parseInt(sel?.value ?? '-1');
    const maxMinutes = parseInt(cursor?.value ?? '300');
    const label = document.getElementById('isochrone-label-temps');
    if (label) label.textContent = formatMinutes(maxMinutes);
    if (isNaN(idxSource) || idxSource < 0 || !isochroneVisible) return;
    afficherIsochrone(idxSource, maxMinutes);
}

window.initMap = initMap;
window.loadApp = loadApp;
window.showView = showView;
window.calculerTrajet = calculerTrajet;
window.mettreAJourIsochrone = mettreAJourIsochrone;
window.mettreAJourFiltreGares = mettreAJourFiltreGares;