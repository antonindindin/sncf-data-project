let map; // Variable globale pour stocker la carte

// Fonction appelée automatiquement par Google Maps quand le script est chargé
function initMap() {
    // 1. Coordonnées du centre de la France
    const centreFrance = { lat: 46.603354, lng: 1.888334 };

    // 2. On définit la "boîte" invisible qui bloque la caméra autour de la France
    const limitesFrance = {
        north: 51.5, // Frontière Nord
        south: 41.0, // Sud (Corse incluse)
        west: -5.5,  // Ouest (Bretagne)
        east: 9.5,   // Est (Alsace/Alpes)
    };

    // 3. Création et configuration de la carte
    map = new google.maps.Map(document.getElementById("app-container"), {
        center: centreFrance,
        zoom: 6, // Zoom initial
        minZoom: 5, // Empêche l'utilisateur de trop dézoomer pour voir la Terre entière
        
        // ⚠️ TRÈS IMPORTANT : Mets ton vrai Map ID ici pour charger tes couleurs
        mapId: 'def9248b61a9c229f43789e9', 
        
        // 4. On applique le mur invisible (Restriction)
        restriction: {
            latLngBounds: limitesFrance,
            strictBounds: false,
        },

        // 5. Nettoyage de l'interface (UI)
        disableDefaultUI: true, // Cette commande nucléaire désactive TOUT (Satellite, Street View, etc.)
        zoomControl: true,      // Mais on réactive manuellement les boutons + et -
    });
    loadLGVLines();
}

function loadApp(appName) {
    console.log("Lancement du module : " + appName);
    
    if (appName === 'gares') {
        if (!map) {
            initMap(); 
        } else {
            map.setZoom(6);
        }
    }
}

window.initMap = initMap;

async function loadLGVLines() {
    try {
        if (!map) {
            console.error('La carte n\'est pas initialisée. Appelez initMap() d\'abord.');
            return;
        }
        
        const response = await fetch('/backend/lignes-lgv-et-par-ecartement.json');
        if (!response.ok) {
            throw new Error(`Erreur HTTP: ${response.status}`);
        }
        const data = await response.json();
        
        if (!Array.isArray(data)) {
            throw new Error('Les données ne sont pas un tableau');
        }
        
        // CORRECTION 1 : On utilise "catlig" en minuscules pour correspondre au JSON
        const lgvLines = data.filter(line => line.catlig === 'Ligne à grande vitesse');
        
        // Tracé des segments sur la carte
        lgvLines.forEach(segment => {
            // CORRECTION 2 : On utilise les coordonnées en minuscules
            if (segment.y_d_wgs84 && segment.x_d_wgs84 && segment.y_f_wgs84 && segment.x_f_wgs84) {
                
                const coordDebut = { 
                    lat: parseFloat(segment.y_d_wgs84), 
                    lng: parseFloat(segment.x_d_wgs84) 
                };
                const coordFin = { 
                    lat: parseFloat(segment.y_f_wgs84), 
                    lng: parseFloat(segment.x_f_wgs84) 
                };
                
                new google.maps.Polyline({
                    path: [coordDebut, coordFin],
                    geodesic: true,
                    strokeColor: '#004696', 
                    strokeOpacity: 0.8,
                    strokeWeight: 3,
                    map: map
                });
            }
        });
        console.log(`${lgvLines.length} segments LGV chargés avec succès !`);
    } catch (error) {
        console.error('Erreur lors du chargement des lignes LGV:', error);
    }
}