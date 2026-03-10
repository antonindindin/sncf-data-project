// Variables globales
let map; 
let infoWindow; 

// === RESEAU FERRE (Lignes) ===
let reseauData; 
let reseauDataLoaded = false; 
let reseauVisible = false;    

// === GARES ET VILLES (Points ultra-optimisés) ===
let toutesLesGares = [];      
let marqueursAffiches = [];   
let garesDataLoaded = false;
let garesVisible = false;

// === FREQUENTATION (Heatmap) ===
let heatmap = null;
let frequentationVisible = false;

// 1. Fonction pour le réseau ferré
function loadLGVLines() {
    if (!reseauDataLoaded) {
        reseauData.loadGeoJson('reseau.geojson'); 
        reseauDataLoaded = true; 

        reseauData.addListener('click', function(event) { 
            let typeLigne = event.feature.getProperty('CATLIG');
            let idLigne = event.feature.getProperty('LIB_LIGNE');
            
            let contenuBulle = `
                <div style="color: #333; font-family: sans-serif; padding: 5px;">
                    <h3 style="margin: 0 0 5px 0; color: #004696; font-size: 16px;">Ligne ${idLigne}</h3>
                    <p style="margin: 0; font-size: 14px;"><strong>Type:</strong> ${typeLigne}</p>
                </div>
            `;
            infoWindow.setContent(contenuBulle);
            infoWindow.setPosition(event.latLng);
            infoWindow.open(map);
        });
    }

    reseauData.setStyle(function(feature) { 
        if (!reseauVisible) return { visible: false };
        let estLGV = (feature.getProperty('CATLIG') === 'Ligne à grande vitesse');
        return {
            strokeColor: estLGV ? '#E20074' : '#0055A4',
            strokeWeight: estLGV ? 4 : 1.5,
            strokeOpacity: 0.8,
            zIndex: estLGV ? 10 : 5,
            visible: true
        };
    });
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
            console.error("Erreur de chargement :", erreur);
            return;
        }
    }
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

            let contenuBulle = `
                <div style="color: #333; font-family: sans-serif; padding: 5px; min-width: 200px; text-align: center;">
                    
                    <div id="wiki-img-${idBulle}" style="min-height: 20px; margin-bottom: 10px;">
                        <span style="font-size: 11px; color: #888; font-style: italic;">Recherche d'image... ⏳</span>
                    </div>

                    <h3 style="margin: 0 0 5px 0; color: ${couleurPoint}; font-size: 16px;">${props['Nom']}</h3>
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

    infoWindow = new google.maps.InfoWindow({
        disableAutoPan: true 
    });
    
    const legend = document.getElementById("map-legend");
    legend.style.display = "block"; 
    map.controls[google.maps.ControlPosition.BOTTOM_LEFT].push(legend);
    
    map.addListener('idle', function() {
        if (garesVisible) actualiserAffichageGares();
    });
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
    }
    else if (appName === 'frequentation') {
        frequentationVisible = !frequentationVisible; 
        basculerBouton('frequentation', frequentationVisible); 
        loadFrequentation(); 
    }
}

// === NOUVEAU : 7. Gestion de l'affichage des onglets du menu principal ===
function showView(viewName) {
    const dashboardView = document.getElementById('dashboard-view');
    const aboutView = document.getElementById('about-view');

    if (viewName === 'home') {
        dashboardView.style.display = 'block';
        aboutView.style.display = 'none';
        // Si la carte n'était pas encore chargée, on force un redimensionnement
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
window.showView = showView; // On expose la fonction pour qu'elle soit cliquable dans le HTML