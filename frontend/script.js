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
