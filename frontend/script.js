/**
 * ============================================================================
 * SNCF DATA PROJECT - MODULE CARTOGRAPHIQUE INTERACTIF
 * ============================================================================
 * Interface Google Maps pour la visualisation du réseau ferroviaire français,
 * des gares de voyageurs et de la fréquentation des stations.
 */

// ============================================================================
// SECTION 1 : VARIABLES GLOBALES - MAP & WINDOW
// ============================================================================
let map;              // Instance Google Maps principale
let infoWindow;       // Bulle d'information commune pour tous les marqueurs

// ============================================================================
// SECTION 2 : VARIABLES - DONNÉES RÉSEAU FERRÉ (LGV et Classique)
// ============================================================================
let reseauData;               // Objet Google Data Layer contenant les lignes
let reseauDataLoaded = false; // Flag : données chargées en mémoire ?
let reseauVisible = false;    // Flag : affichage activé actuellement ?
let ligneSelectionnee = null; // Mémorise la ligne sélectionnée (pour focus/estompe)

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
let wifiData = [];            // Cache des gares équipées de Wi-Fi
let wifiDataLoaded = false;   // Flag : données Wi-Fi chargées ?

let heatmap = null;               // Couche heatmap (fréquentation)
let frequentationVisible = false; // Flag : heatmap affichée ?

// ============================================================================
// SECTION 5 : GESTION RÉSEAU FERRÉ - Styling et Sélection
// ============================================================================

/**
 * Applique les styles de couleur et d'épaisseur aux lignes du réseau
 */
function appliquerStyleReseau() {
    reseauData.setStyle(function(feature) { 
        // Si la couche est cachée, masquer toutes les lignes
        if (!reseauVisible) return { visible: false };
        
        // Déterminer le type et la couleur de base
        let estLGV = (feature.getProperty('CATLIG') === 'Ligne à grande vitesse');
        let couleurBase = estLGV ? '#E20074' : '#0055A4';    // Rose/Bleu SNCF
        let epaisseurBase = estLGV ? 4 : 1.5;

        // ---------- MODE 1 : UNE LIGNE EST SÉLECTIONNÉE ----------
        if (ligneSelectionnee) {
            if (feature === ligneSelectionnee) {
                // Style FOCUS : ligne mise en avant
                return {
                    strokeColor: couleurBase,
                    strokeWeight: epaisseurBase + 3,
                    strokeOpacity: 1.0,
                    zIndex: 100,
                    clickable: false, // False pour laisser passer le clic vers la Hitbox
                    visible: true
                };
            } else {
                // Style ESTOMPE : autres lignes en arrière-plan
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
    
    let typeLigne = feature.getProperty('CATLIG');
    let idLigne = feature.getProperty('LIB_LIGNE') || "Inconnue";
    
    let contenuBulle = `
        <div style="color: #333; font-family: sans-serif; padding: 5px;">
            <h3 style="margin: 0 0 5px 0; color: #004696; font-size: 16px;">Ligne ${idLigne}</h3>
            <p style="margin: 0; font-size: 14px;"><strong>Type:</strong> ${typeLigne}</p>
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
// SECTION 6 : CHARGEMENT DES DONNÉES - Réseau, Gares, Wi-Fi
// ============================================================================

// === OUTIL : Calcul de distance mathématique pour la "Hitbox" ===
function distancePointSegment(px, py, ax, ay, bx, by) {
    let l2 = Math.pow(ax - bx, 2) + Math.pow(ay - by, 2);
    if (l2 === 0) return Math.sqrt(Math.pow(px - ax, 2) + Math.pow(py - ay, 2));
    let t = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / l2));
    let projX = ax + t * (bx - ax);
    let projY = ay + t * (by - ay);
    return Math.sqrt(Math.pow(px - projX, 2) + Math.pow(py - projY, 2));
}

// 1. Fonction pour le réseau ferré (avec clic Hitbox intégré)
function loadLGVLines() {
    if (!reseauDataLoaded) {
        reseauData.loadGeoJson('reseau.geojson'); 
        reseauDataLoaded = true; 

        // CLIC HITBOX MATHÉMATIQUE (Directement sur la carte)
        map.addListener('click', function(event) {
            if (!reseauVisible) return;

            let clicLat = event.latLng.lat();
            let clicLng = event.latLng.lng();
            
            let meilleureLigne = null;
            let minDistance = 0.05; // Marge d'erreur au clic (~5km)

            // Chercher la ligne la plus proche
            reseauData.forEach(function(feature) {
                let geo = feature.getGeometry();
                
                const verifierChemin = (path) => {
                    let pts = path.getArray();
                    for (let i = 0; i < pts.length - 1; i++) {
                        let dist = distancePointSegment(
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

                if (geo.getType() === 'LineString') { verifierChemin(geo); } 
                else if (geo.getType() === 'MultiLineString') { geo.getArray().forEach(verifierChemin); }
            });

            // Actionner la sélection
            if (meilleureLigne) {
                selectionnerLigne(meilleureLigne, event.latLng);
            } else {
                deselectionnerLigne();
            }
        });
    }

    // Appliquer le style au chargement
    appliquerStyleReseau();
}

async function loadWifiData() {
    if (!wifiDataLoaded) {
        try {
            const reponse = await fetch('gares-equipees-du-wifi.json');
            wifiData = await reponse.json();
            wifiDataLoaded = true;
        } catch (erreur) {
            console.error("Erreur de chargement Wi-Fi :", erreur);
        }
    }
}

async function loadGares() {
    if (!garesDataLoaded) {
        try {
            const reponse = await fetch('gares.geojson');
            const data = await reponse.json();
            toutesLesGares = data.features;  
            garesDataLoaded = true;
        } catch (erreur) {
            console.error("Erreur de chargement gares:", erreur);
            return;
        }
    }
    
    await loadWifiData();
    actualiserAffichageGares();
}

// ============================================================================
// SECTION 7 : AFFICHAGE GARES - OPTIMISATION VIEWPORT CULLING & ZOOM
// ============================================================================

function actualiserAffichageGares() {
    if (!garesVisible) {
        marqueursAffiches.forEach(m => m.setMap(null));
        marqueursAffiches = [];
        return;
    }

    let currentZoom = map.getZoom();
    let limitesEcran = map.getBounds();

    if (!limitesEcran) return;

    marqueursAffiches.forEach(m => m.setMap(null));
    marqueursAffiches = [];

    toutesLesGares.forEach(feature => {
        let coords = feature.geometry.coordinates;
        let props = feature.properties;
        let segment = props['Segment(s) DRG'];  
        
        let position = new google.maps.LatLng(coords[1], coords[0]);

        if (!limitesEcran.contains(position)) return;
        if (currentZoom < 8 && segment !== 'A') return;
        if (currentZoom < 11 && segment === 'C') return;

        let taillePoint = (segment === 'A') ? 9 : (segment === 'B' ? 7 : 5);
        let couleurPoint = (segment === 'A') ? '#E20074' : (segment === 'B' ? '#0088CE' : '#6C757D');

        let marker = new google.maps.Marker({
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

        marker.addListener('click', async () => {
            let nomGare = props['Nom'];
            nomGare = nomGare.replace(/ - /g, '-');
            let commenceParVoyelle = /^[AEIOUYÉÈÊËÀÂÄÎÏÔÖÛÜ]/i.test(nomGare);
            let prefixe = commenceParVoyelle ? "Gare d'" : "Gare de ";
            let nomComplet = prefixe + nomGare;

            let lienWiki = "https://fr.wikipedia.org/w/index.php?search=" + encodeURIComponent(nomComplet);
            let idBulle = props['Code(s) UIC'];

            let aLeWifi = wifiData.some(gareWifi => gareWifi.nom.toLowerCase() === props['Nom'].toLowerCase());
            let badgeWifi = aLeWifi 
                ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0088CE" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-left: 8px; vertical-align: middle;" title="Wi-Fi disponible"><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><path d="M5 12.55a11 11 0 0 1 14.08 0"/><circle cx="12" cy="20" r="1.5" fill="#0088CE" stroke="none"/></svg>` 
                : '';

            let contenuBulle = `
                <div style="color: #333; font-family: sans-serif; padding: 5px; min-width: 200px; text-align: center;">
                    <div id="wiki-img-${idBulle}" style="min-height: 20px; margin-bottom: 10px;">
                        <span style="font-size: 11px; color: #888; font-style: italic;">Recherche d'image... ⏳</span>
                    </div>
                    <h3 style="margin: 0 0 5px 0; color: ${couleurPoint}; font-size: 16px; display: flex; align-items: center; justify-content: center;">
                        ${props['Nom']} ${badgeWifi}
                    </h3>
                    <p style="margin: 0; font-size: 14px;"><strong>Code UIC:</strong> ${idBulle}</p>
                    <p style="margin: 0; font-size: 12px; color: #666;">Catégorie: ${segment}</p>
                    <div style="margin-top: 10px; border-top: 1px solid #eee; padding-top: 8px;">
                        <a href="${lienWiki}" target="_blank" style="color: #0055A4; text-decoration: none; font-size: 13px; font-weight: bold;">
                            🌐 Voir sur Wikipédia ↗
                        </a>
                    </div>
                </div>
            `;
            
            infoWindow.setContent(contenuBulle);
            infoWindow.open(map, marker);

            try {
                let urlSearch = "https://fr.wikipedia.org/w/api.php?action=opensearch&search=" + encodeURIComponent(nomComplet) + "&limit=1&format=json&origin=*";
                let reponseSearch = await fetch(urlSearch);
                let dataSearch = await reponseSearch.json();

                let conteneurImage = document.getElementById(`wiki-img-${idBulle}`);

                if (dataSearch[1] && dataSearch[1].length > 0) {
                    let titreExact = dataSearch[1][0];
                    let urlApiWiki = "https://fr.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(titreExact);
                    let reponse = await fetch(urlApiWiki);
                    
                    if (reponse.ok && conteneurImage) {
                        let donneesWiki = await reponse.json();
                        if (donneesWiki.thumbnail && donneesWiki.thumbnail.source) {
                            let urlImage = donneesWiki.thumbnail.source;
                            conteneurImage.innerHTML = `<img src="${urlImage}" alt="${titreExact}" style="width: 100%; max-height: 140px; object-fit: cover; border-radius: 6px; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">`;
                        } else {
                            conteneurImage.style.display = 'none';
                        }
                    } else if (conteneurImage) {
                        conteneurImage.style.display = 'none';
                    }
                } else if (conteneurImage) {
                    conteneurImage.style.display = 'none';
                }
            } catch (erreur) {
                let conteneurImage = document.getElementById(`wiki-img-${idBulle}`);
                if (conteneurImage) conteneurImage.style.display = 'none';
            }
        });

        marqueursAffiches.push(marker);
    });
}

// ============================================================================
// SECTION 8 : AFFICHAGE FRÉQUENTATION - Heatmap Layer
// ============================================================================

function loadFrequentation() {
    if (!heatmap) {
        if (typeof frequentationData === 'undefined') {
            console.error("Fichier frequentation.js manquant ou mal chargé.");
            return;
        }

        let heatmapData = frequentationData.map(point => {
            return {
                location: new google.maps.LatLng(point.lat, point.lng),
                weight: point.poids  
            };
        });

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

    if (frequentationVisible) {
        heatmap.setMap(map);
    } else {
        heatmap.setMap(null);
    }
}

// ============================================================================
// SECTION 9 : INITIALISATION MAP - Configuration Paramètres & Événements
// ============================================================================

function initMap() {
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
    });

    reseauData = new google.maps.Data();
    reseauData.setMap(map);

    infoWindow = new google.maps.InfoWindow({
        disableAutoPan: true  
    });
    
    const legend = document.getElementById("map-legend");
    if(legend) {
        legend.style.display = "block";
        map.controls[google.maps.ControlPosition.BOTTOM_LEFT].push(legend);
    }
    
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
        if (estActif) {
            bouton.classList.add("active");
        } else {
            bouton.classList.remove("active");
        }
    }
}

function loadApp(appName) {
    if (!map) initMap();
    if (infoWindow) infoWindow.close();

    if (appName === 'gares') {
        garesVisible = !garesVisible;           
        basculerBouton('gares', garesVisible);  
        
        if (!garesDataLoaded && garesVisible) {
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
}

function showView(viewName) {
    const dashboardView = document.getElementById('dashboard-view');
    const aboutView = document.getElementById('about-view');

    if (viewName === 'home') {
        dashboardView.style.display = 'block';
        aboutView.style.display = 'none';
        
        if (map) {
            google.maps.event.trigger(map, 'resize');
        }
    } else if (viewName === 'about') {
        dashboardView.style.display = 'none';
        aboutView.style.display = 'block';
    }
}

// ============================================================================
// SECTION 11 : EXPORT FONCTIONS GLOBALES
// ============================================================================
window.initMap = initMap;
window.loadApp = loadApp;
window.showView = showView;