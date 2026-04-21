// Variables globales
let map; 
let infoWindow; 

// === RESEAU FERRE (Lignes) ===
let reseauData; 
let reseauHitbox; // NOUVEAU : Calque invisible pour capter les clics larges
let reseauDataLoaded = false; 
let reseauVisible = false;    
let ligneSelectionnee = null; // Mémorise la ligne cliquée

// === GARES ET VILLES (Points ultra-optimisés) ===
let toutesLesGares = [];      
let marqueursAffiches = [];   
let garesDataLoaded = false;
let garesVisible = false;

// === NOUVEAU : WI-FI ===
let wifiData = [];
let wifiDataLoaded = false;

// === FREQUENTATION (Heatmap) ===
let heatmap = null;
let frequentationVisible = false;

// --- GESTION DES LIGNES (Focus/Extinction) ---

function appliquerStyleReseau() {
    reseauData.setStyle(function(feature) { 
        if (!reseauVisible) return { visible: false };
        
        let estLGV = (feature.getProperty('CATLIG') === 'Ligne à grande vitesse');
        let couleurBase = estLGV ? '#E20074' : '#0055A4';
        let epaisseurBase = estLGV ? 4 : 1.5;

        // Mode FOCUS / EXTINCTION
        if (ligneSelectionnee) {
            if (feature === ligneSelectionnee) {
                return {
                    strokeColor: couleurBase,
                    strokeWeight: epaisseurBase + 3,
                    strokeOpacity: 1.0,
                    zIndex: 100,
                    clickable: true, // <-- CHANGÉ ICI
                    visible: true
                };
            } else {
                return {
                    strokeColor: '#999999',
                    strokeWeight: epaisseurBase,
                    strokeOpacity: 0.3,
                    zIndex: 1,
                    clickable: true, // <-- CHANGÉ ICI
                    visible: true
                };
            }
        }

        // Mode Normal
        return {
            strokeColor: couleurBase,
            strokeWeight: epaisseurBase,
            strokeOpacity: 0.8,
            zIndex: estLGV ? 10 : 5,
            clickable: true, // <-- CHANGÉ ICI
            visible: true
        };
    });
    reseauHitbox.setStyle(function(feature) {
        return {
            strokeWeight: 15,    // Marge d'erreur de clic (ajustez si besoin)
            strokeOpacity: 0.0,  // Totalement invisible ! (ou 0.01 si bug sur certains vieux navigateurs)
            zIndex: 20,          // Au-dessus du réseau visuel
            clickable: true,     // Elle capte la souris
            visible: reseauVisible,
            cursor: 'pointer'
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

// 1. Fonction pour le réseau ferré
function loadLGVLines() {
    if (!reseauDataLoaded) {
        reseauData.loadGeoJson('reseau.geojson'); 
        reseauHitbox.loadGeoJson('reseau.geojson'); // NOUVEAU : Charge la donnée dans la hitbox
        reseauDataLoaded = true; 
    }
    appliquerStyleReseau();
}

// Fonction pour charger les données Wi-Fi
async function loadWifiData() {
    if (!wifiDataLoaded) {
        console.log("Téléchargement des données Wi-Fi...");
        try {
            const reponse = await fetch('gares-equipees-du-wifi.json');
            wifiData = await reponse.json();
            wifiDataLoaded = true;
        } catch (erreur) {
            console.error("Erreur de chargement Wi-Fi :", erreur);
        }
    }
}

// 2. Fonction de téléchargement des gares
async function loadGares() {
    if (!garesDataLoaded) {
        console.log("Téléchargement des données des gares...");
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

// 3. LA FONCTION MAGIQUE (Viewport Culling + Filtre de zoom)
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
                ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0088CE" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-left: 8px; vertical-align: middle;" title="Wi-Fi disponible">
                     <path d="M8.53 16.11a6 6 0 0 1 6.95 0"/>
                     <path d="M5 12.55a11 11 0 0 1 14.08 0"/>
                     <circle cx="12" cy="20" r="1.5" fill="#0088CE" stroke="none"/>
                   </svg>` 
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

// 4. Fonction pour charger la carte de chaleur (Fréquentation)
function loadFrequentation() {
    if (!heatmap) {
        console.log("Création de la Heatmap...");
        
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

// 5. Initialisation de la carte
function initMap() {
    map = new google.maps.Map(document.getElementById("app-container"), {
        center: { lat: 46.603354, lng: 1.888334 },
        zoom: 6, 
        minZoom: 5, 
        mapId: 'def9248b61a9c229f43789e9', 
        restriction: { latLngBounds: { north: 51.5, south: 41.0, west: -5.5, east: 9.5 }, strictBounds: false },
        disableDefaultUI: true, 
        zoomControl: true,      
    });

    reseauData = new google.maps.Data();
    reseauData.setMap(map);

    reseauHitbox = new google.maps.Data();
    reseauHitbox.setMap(map);

    infoWindow = new google.maps.InfoWindow({
        disableAutoPan: true 
    });
    
    const legend = document.getElementById("map-legend");
    legend.style.display = "block"; 
    map.controls[google.maps.ControlPosition.BOTTOM_LEFT].push(legend);
    
    map.addListener('idle', function() {
        if (garesVisible) actualiserAffichageGares();
    });

    // === NOUVEAU : GESTION DES CLICS ULTRA-OPTIMISÉE ===
    
    // Petite variable pour éviter les conflits de clics
    let clicSurLigne = false;

    // 1. Clic NATIF sur une ligne du réseau (Google gère la géométrie tout seul, instantanément)
    // 1. Clic sur la HITBOX (transparente et large)
    reseauHitbox.addListener('click', function(event) {
        if (!reseauVisible) return;
        clicSurLigne = true;
        
        // On récupère le nom de la ligne cliquée sur la hitbox
        let idLigneCliquee = event.feature.getProperty('LIB_LIGNE');
        let featureVisuelle = null;

        // On cherche sa jumelle dans le calque visuel
        reseauData.forEach(function(f) {
            if (f.getProperty('LIB_LIGNE') === idLigneCliquee) {
                featureVisuelle = f;
            }
        });

        // Si on la trouve, on applique la sélection visuelle
        if (featureVisuelle) {
            selectionnerLigne(featureVisuelle, event.latLng);
        }
        
        // On réinitialise après un instant
        setTimeout(() => { clicSurLigne = false; }, 100);
    });

    // 2. Clic dans le vide sur la carte (pour désélectionner)
    map.addListener('click', function() {
        if (!clicSurLigne) {
            deselectionnerLigne();
        }
    });

    // NOTE : Le changement de curseur en petite main ("pointer") se fait maintenant
    // TOUT SEUL car nous avons mis `clickable: true` sur les lignes ! Plus besoin de mousemove !
}

// Fonction utilitaire pour allumer/éteindre un bouton HTML
function basculerBouton(appName, estActif) {
    const bouton = document.getElementById("btn-" + appName);
    if (bouton) {
        if (estActif) bouton.classList.add("active");
        else bouton.classList.remove("active");
    }
}

// 6. Gestion des clics sur le menu des données
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

// 7. Gestion de l'affichage des onglets du menu principal
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

window.initMap = initMap;
window.loadApp = loadApp;
window.showView = showView;
