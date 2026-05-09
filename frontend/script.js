/**
 * ============================================================================
 * SNCF DATA PROJECT - MODULE CARTOGRAPHIQUE INTERACTIF
 * ============================================================================
 * Interface Google Maps pour la visualisation du réseau ferroviaire français,
 * des gares de voyageurs et de la fréquentation des stations.
 *
 * NOTE IMPORTANTE :
 * Les données (réseau, gares, wifi, fréquentation) ne sont PAS chargées via
 * fetch() — elles sont déclarées en variables globales par les fichiers
 *   reseau.js, gares.js, wifi.js, frequentation.js
 * Ce choix permet d'ouvrir index.html directement (file://) sans avoir
 * besoin de lancer un serveur HTTP local (contournement de CORS).
 */

// ============================================================================
// SECTION 1 : VARIABLES GLOBALES - MAP & WINDOW
// ============================================================================
let map;              // Instance Google Maps principale
let infoWindow;       // Bulle d'information commune pour tous les marqueurs

// ============================================================================
// SECTION 2 : VARIABLES - DONNÉES RÉSEAU FERRÉ (LGV et Classique)
// ============================================================================
let reseauData;                    // Objet Google Data Layer contenant les lignes
let reseauDataLoaded = false;      // Flag : données chargées en mémoire ?
let reseauVisible = false;         // Flag : affichage activé actuellement ?
let ligneSelectionnee = null;      // Mémorise la ligne sélectionnée (focus/estompe)
let listenerClicCarteAttache = false; // Flag : le listener de clic est-il déjà attaché ?

// ============================================================================
// SECTION 3 : VARIABLES - DONNÉES GARES (Points optimisés)
// ============================================================================
let toutesLesGares = [];      // Cache des features GeoJSON (toutes les gares)
let marqueursAffiches = [];   // Marqueurs actuels visibles (gestion mémoire)
let garesDataLoaded = false;  // Flag : données chargées en mémoire ?
let garesVisible = false;     // Flag : affichage activé actuellement ?

// ============================================================================
// SECTION 4 : VARIABLES - DONNÉES COMPLÉMENTAIRES
// ============================================================================
let wifiSet = null;               // Set des noms de gares Wi-Fi (recherche O(1))
let heatmap = null;               // Couche heatmap (fréquentation)
let frequentationVisible = false; // Flag : heatmap affichée ?

// Cache des résultats Wikipédia (évite de re-fetch à chaque clic sur la même gare)
const cacheWikipedia = new Map();

// ============================================================================
// SECTION 5 : GESTION RÉSEAU FERRÉ - Styling et Sélection
// ============================================================================

/**
 * Applique les styles de couleur et d'épaisseur aux lignes du réseau.
 * Trois modes : caché, focus (une ligne sélectionnée), ou affichage normal.
 */
function appliquerStyleReseau() {
    reseauData.setStyle(function(feature) {
        // Si la couche est cachée, masquer toutes les lignes
        if (!reseauVisible) return { visible: false };

        // Déterminer le type et la couleur de base
        const estLGV = (feature.getProperty('CATLIG') === 'Ligne à grande vitesse');
        const couleurBase = estLGV ? '#E20074' : '#0055A4';   // Rose/Bleu SNCF
        const epaisseurBase = estLGV ? 4 : 1.5;

        // ---------- MODE 1 : UNE LIGNE EST SÉLECTIONNÉE ----------
        if (ligneSelectionnee) {
            if (feature === ligneSelectionnee) {
                return {
                    strokeColor: couleurBase,
                    strokeWeight: epaisseurBase + 3,
                    strokeOpacity: 1.0,
                    zIndex: 100,
                    clickable: false, // Laisser passer le clic vers la Hitbox
                    visible: true
                };
            } else {
                return {
                    strokeColor: '#999999',
                    strokeWeight: epaisseurBase,
                    strokeOpacity: 0.3,
                    zIndex: 1,
                    clickable: false,
                    visible: true
                };
            }
        }

        // ---------- MODE 2 : AUCUNE LIGNE SÉLECTIONNÉE (Normal) ----------
        return {
            strokeColor: couleurBase,
            strokeWeight: epaisseurBase,
            strokeOpacity: 0.8,
            zIndex: estLGV ? 10 : 5,
            clickable: false,
            visible: true
        };
    });
}

function selectionnerLigne(feature, latLng) {
    ligneSelectionnee = feature;
    appliquerStyleReseau();

    const typeLigne = feature.getProperty('CATLIG') || 'Inconnu';
    const idLigne = feature.getProperty('LIB_LIGNE') || "Inconnue";

    const contenuBulle = `
        <div style="color: #333; font-family: sans-serif; padding: 5px;">
            <h3 style="margin: 0 0 5px 0; color: #004696; font-size: 16px;">Ligne ${idLigne}</h3>
            <p style="margin: 0; font-size: 14px;"><strong>Type :</strong> ${typeLigne}</p>
        </div>
    `;

    infoWindow.setContent(contenuBulle);
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

// ============================================================================
// SECTION 6 : CHARGEMENT DES DONNÉES (depuis variables globales)
// ============================================================================

/**
 * Outil mathématique : calcule la distance entre un point (px, py) et le
 * segment formé par (ax, ay) et (bx, by). Sert à la "Hitbox" pour détecter
 * un clic à proximité d'une ligne fine.
 */
function distancePointSegment(px, py, ax, ay, bx, by) {
    const l2 = Math.pow(ax - bx, 2) + Math.pow(ay - by, 2);
    if (l2 === 0) return Math.sqrt(Math.pow(px - ax, 2) + Math.pow(py - ay, 2));
    const t = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / l2));
    const projX = ax + t * (bx - ax);
    const projY = ay + t * (by - ay);
    return Math.sqrt(Math.pow(px - projX, 2) + Math.pow(py - projY, 2));
}

/**
 * Charge le réseau ferré depuis la variable globale `reseauGeoJsonData`.
 * Le listener de clic n'est attaché qu'UNE SEULE FOIS.
 */
function loadLGVLines() {
    if (!reseauDataLoaded) {
        if (typeof reseauGeoJsonData === 'undefined') {
            console.error("Fichier reseau.js manquant ou mal chargé.");
            alert("Erreur : impossible de charger le réseau ferré.\nVérifie que le fichier reseau.js est bien présent.");
            return;
        }
        reseauData.addGeoJson(reseauGeoJsonData);
        reseauDataLoaded = true;
    }

    // Attacher le listener de clic UNE seule fois (et pas à chaque toggle)
    if (!listenerClicCarteAttache) {
        map.addListener('click', function(event) {
            if (!reseauVisible) return;

            const clicLat = event.latLng.lat();
            const clicLng = event.latLng.lng();

            let meilleureLigne = null;
            let minDistance = 0.05; // Marge d'erreur au clic (~5 km)

            reseauData.forEach(function(feature) {
                const geo = feature.getGeometry();

                const verifierChemin = (path) => {
                    const pts = path.getArray();
                    for (let i = 0; i < pts.length - 1; i++) {
                        const dist = distancePointSegment(
                            clicLng, clicLat,
                            pts[i].lng(), pts[i].lat(),
                            pts[i+1].lng(), pts[i+1].lat()
                        );
                        if (dist < minDistance) {
                            minDistance = dist;
                            meilleureLigne = feature;
                        }
                    }
                };

                if (geo.getType() === 'LineString') {
                    verifierChemin(geo);
                } else if (geo.getType() === 'MultiLineString') {
                    geo.getArray().forEach(verifierChemin);
                }
            });

            if (meilleureLigne) {
                selectionnerLigne(meilleureLigne, event.latLng);
            } else {
                deselectionnerLigne();
            }
        });
        listenerClicCarteAttache = true;
    }

    appliquerStyleReseau();
}

/**
 * Initialise le Set des gares Wi-Fi (si pas déjà fait) pour des recherches en O(1).
 */
function initialiserWifi() {
    if (wifiSet === null) {
        wifiSet = new Set();
        if (typeof wifiData !== 'undefined' && Array.isArray(wifiData)) {
            wifiData.forEach(gareWifi => {
                if (gareWifi && gareWifi.nom) {
                    wifiSet.add(gareWifi.nom.toLowerCase());
                }
            });
        } else {
            console.warn("Fichier wifi.js manquant : badge Wi-Fi désactivé.");
        }
    }
}

/**
 * Charge les gares depuis la variable globale `garesGeoJsonData`.
 */
function loadGares() {
    if (!garesDataLoaded) {
        if (typeof garesGeoJsonData === 'undefined') {
            console.error("Fichier gares.js manquant ou mal chargé.");
            alert("Erreur : impossible de charger les gares.\nVérifie que le fichier gares.js est bien présent.");
            return;
        }
        toutesLesGares = garesGeoJsonData.features || [];
        garesDataLoaded = true;
        initialiserWifi();
    }
    actualiserAffichageGares();
}

// ============================================================================
// SECTION 7 : AFFICHAGE GARES - OPTIMISATION VIEWPORT CULLING & ZOOM
// ============================================================================

function actualiserAffichageGares() {
    // Si caché, supprimer tous les marqueurs
    if (!garesVisible) {
        marqueursAffiches.forEach(m => m.setMap(null));
        marqueursAffiches = [];
        return;
    }

    const currentZoom = map.getZoom();
    const limitesEcran = map.getBounds();

    if (!limitesEcran) return;

    // Reset des anciens marqueurs avant de redessiner
    marqueursAffiches.forEach(m => m.setMap(null));
    marqueursAffiches = [];

    toutesLesGares.forEach(feature => {
        const coords = feature.geometry.coordinates;
        const props = feature.properties;
        const segment = props['Segment(s) DRG'];

        const position = new google.maps.LatLng(coords[1], coords[0]);

        // Filtrage par viewport et par zoom (pour les performances)
        if (!limitesEcran.contains(position)) return;
        if (currentZoom < 8 && segment !== 'A') return;
        if (currentZoom < 11 && segment === 'C') return;

        const taillePoint = (segment === 'A') ? 9 : (segment === 'B' ? 7 : 5);
        const couleurPoint = (segment === 'A') ? '#E20074' : (segment === 'B' ? '#0088CE' : '#6C757D');

        const marker = new google.maps.Marker({
            position: position,
            map: map,
            title: props['Nom'],
            icon: {
                path: google.maps.SymbolPath.CIRCLE,
                scale: taillePoint,
                fillColor: couleurPoint,
                fillOpacity: 0.9,
                strokeColor: '#FFFFFF',
                strokeWeight: 1
            }
        });

        marker.addListener('click', () => afficherBulleGare(marker, props, segment, couleurPoint));
        marqueursAffiches.push(marker);
    });
}

/**
 * Affiche la bulle d'information pour une gare donnée.
 * Récupère l'image Wikipédia (avec cache) en arrière-plan.
 */
async function afficherBulleGare(marker, props, segment, couleurPoint) {
    let nomGare = props['Nom'];
    nomGare = nomGare.replace(/ - /g, '-');
    const commenceParVoyelle = /^[AEIOUYÉÈÊËÀÂÄÎÏÔÖÛÜ]/i.test(nomGare);
    const prefixe = commenceParVoyelle ? "Gare d'" : "Gare de ";
    const nomComplet = prefixe + nomGare;

    const lienWiki = "https://fr.wikipedia.org/w/index.php?search=" + encodeURIComponent(nomComplet);
    const idBulle = props['Code(s) UIC'];

    const aLeWifi = wifiSet && wifiSet.has(props['Nom'].toLowerCase());
    const badgeWifi = aLeWifi
        ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0088CE" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-left: 8px; vertical-align: middle;"><title>Wi-Fi disponible</title><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><path d="M5 12.55a11 11 0 0 1 14.08 0"/><circle cx="12" cy="20" r="1.5" fill="#0088CE" stroke="none"/></svg>`
        : '';

    const contenuBulle = `
        <div style="color: #333; font-family: sans-serif; padding: 5px; min-width: 200px; text-align: center;">
            <div id="wiki-img-${idBulle}" style="min-height: 20px; margin-bottom: 10px;">
                <span style="font-size: 11px; color: #888; font-style: italic;">Recherche d'image… ⏳</span>
            </div>
            <h3 style="margin: 0 0 5px 0; color: ${couleurPoint}; font-size: 16px; display: flex; align-items: center; justify-content: center;">
                ${props['Nom']} ${badgeWifi}
            </h3>
            <p style="margin: 0; font-size: 14px;"><strong>Code UIC :</strong> ${idBulle}</p>
            <p style="margin: 0; font-size: 12px; color: #666;">Catégorie : ${segment}</p>
            <div style="margin-top: 10px; border-top: 1px solid #eee; padding-top: 8px;">
                <a href="${lienWiki}" target="_blank" rel="noopener" style="color: #0055A4; text-decoration: none; font-size: 13px; font-weight: bold;">
                    🌐 Voir sur Wikipédia ↗
                </a>
            </div>
        </div>
    `;

    infoWindow.setContent(contenuBulle);
    infoWindow.open(map, marker);

    // Récupération de l'image Wikipédia (avec cache)
    chargerImageWikipedia(nomComplet, idBulle);
}

/**
 * Récupère et affiche la miniature Wikipédia, avec mise en cache.
 */
async function chargerImageWikipedia(nomComplet, idBulle) {
    const cacheCle = nomComplet;

    const masquerConteneur = () => {
        const conteneur = document.getElementById(`wiki-img-${idBulle}`);
        if (conteneur) conteneur.style.display = 'none';
    };

    const afficherImage = (urlImage, alt) => {
        const conteneur = document.getElementById(`wiki-img-${idBulle}`);
        if (conteneur) {
            conteneur.innerHTML = `<img src="${urlImage}" alt="${alt}" style="width: 100%; max-height: 140px; object-fit: cover; border-radius: 6px; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">`;
        }
    };

    // 1. Vérifier le cache
    if (cacheWikipedia.has(cacheCle)) {
        const resultat = cacheWikipedia.get(cacheCle);
        if (resultat === null) {
            masquerConteneur();
        } else {
            afficherImage(resultat.url, resultat.titre);
        }
        return;
    }

    // 2. Sinon, requête à l'API Wikipédia (en deux étapes)
    try {
        const urlSearch = "https://fr.wikipedia.org/w/api.php?action=opensearch&search=" + encodeURIComponent(nomComplet) + "&limit=1&format=json&origin=*";
        const reponseSearch = await fetch(urlSearch);
        const dataSearch = await reponseSearch.json();

        if (dataSearch[1] && dataSearch[1].length > 0) {
            const titreExact = dataSearch[1][0];
            const urlApiWiki = "https://fr.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(titreExact);
            const reponse = await fetch(urlApiWiki);

            if (reponse.ok) {
                const donneesWiki = await reponse.json();
                if (donneesWiki.thumbnail && donneesWiki.thumbnail.source) {
                    const urlImage = donneesWiki.thumbnail.source;
                    cacheWikipedia.set(cacheCle, { url: urlImage, titre: titreExact });
                    afficherImage(urlImage, titreExact);
                    return;
                }
            }
        }

        // Aucune image trouvée → mettre en cache pour ne pas re-tenter
        cacheWikipedia.set(cacheCle, null);
        masquerConteneur();
    } catch (erreur) {
        console.warn("Erreur Wikipédia :", erreur);
        masquerConteneur();
    }
}

// ============================================================================
// SECTION 8 : AFFICHAGE FRÉQUENTATION - Heatmap Layer
// ============================================================================

function loadFrequentation() {
    if (!heatmap) {
        if (typeof frequentationData === 'undefined') {
            console.error("Fichier frequentation.js manquant ou mal chargé.");
            alert("Erreur : impossible de charger les données de fréquentation.");
            return;
        }

        const heatmapData = frequentationData.map(point => ({
            location: new google.maps.LatLng(point.lat, point.lng),
            weight: point.poids
        }));

        heatmap = new google.maps.visualization.HeatmapLayer({
            data: heatmapData,
            radius: 30,
            opacity: 0.7,
            maxIntensity: 5000000,
            gradient: [
                'rgba(0, 0, 255, 0)',
                'rgba(65, 105, 225, 1)',
                'rgba(0, 255, 255, 1)',
                'rgba(0, 255, 0, 1)',
                'rgba(255, 255, 0, 1)',
                'rgba(255, 165, 0, 1)',
                'rgba(255, 0, 0, 1)'
            ]
        });
    }

    heatmap.setMap(frequentationVisible ? map : null);
}

// ============================================================================
// SECTION 9 : INITIALISATION MAP - Configuration & Événements
// ============================================================================

function initMap() {
    // Retirer le spinner de chargement
    const loader = document.getElementById('map-loading');
    if (loader) loader.remove();

    map = new google.maps.Map(document.getElementById("app-container"), {
        center: { lat: 46.603354, lng: 1.888334 },
        zoom: 6,
        minZoom: 5,
        mapId: 'def9248b61a9c229f43789e9',
        restriction: {
            latLngBounds: { north: 51.5, south: 41.0, west: -5.5, east: 9.5 },
            strictBounds: false
        },
        disableDefaultUI: true,
        zoomControl: true,
        gestureHandling: 'greedy' // Permet le zoom à un doigt sur mobile
    });

    reseauData = new google.maps.Data();
    reseauData.setMap(map);

    infoWindow = new google.maps.InfoWindow({
        disableAutoPan: true
    });

    // Affichage de la légende dans la carte
    const legend = document.getElementById("map-legend");
    if (legend) {
        legend.style.display = "block";
        map.controls[google.maps.ControlPosition.BOTTOM_LEFT].push(legend);
    }

    // Mise à jour des gares à chaque mouvement (viewport culling)
    map.addListener('idle', function() {
        if (garesVisible) actualiserAffichageGares();
    });
}

// ============================================================================
// SECTION 10 : CONTRÔLE MENU - Basculer Applications & Vues
// ============================================================================

function basculerBouton(appName, estActif) {
    const bouton = document.getElementById("btn-" + appName);
    if (bouton) {
        bouton.classList.toggle("active", estActif);
    }
}

function loadApp(appName) {
    if (!map) {
        console.warn("La carte n'est pas encore prête.");
        return;
    }
    if (infoWindow) infoWindow.close();

    if (appName === 'gares') {
        garesVisible = !garesVisible;
        basculerBouton('gares', garesVisible);

        if (garesVisible && !garesDataLoaded) {
            loadGares();
        } else {
            actualiserAffichageGares();
        }
    }
    else if (appName === 'reseau') {
        reseauVisible = !reseauVisible;
        basculerBouton('reseau', reseauVisible);
        loadLGVLines();
        if (!reseauVisible) deselectionnerLigne();
    }
    else if (appName === 'frequentation') {
        frequentationVisible = !frequentationVisible;
        basculerBouton('frequentation', frequentationVisible);
        loadFrequentation();
    }
    else if (appName === 'tarifs') {
        alert("Le comparateur de tarifs sera disponible prochainement !");
    }
}

function showView(viewName) {
    const dashboardView = document.getElementById('dashboard-view');
    const aboutView = document.getElementById('about-view');

    if (viewName === 'home') {
        dashboardView.style.display = 'block';
        aboutView.style.display = 'none';

        // Empêche le bug de la "carte grise" après changement de display
        if (map) {
            google.maps.event.trigger(map, 'resize');
        }
    } else if (viewName === 'about') {
        dashboardView.style.display = 'none';
        aboutView.style.display = 'block';
    }
}

// ============================================================================
// SECTION 11 : EXPORT FONCTIONS GLOBALES (appelées depuis le HTML inline)
// ============================================================================
window.initMap = initMap;
window.loadApp = loadApp;
window.showView = showView;
