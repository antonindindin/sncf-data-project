let map; // Variable globale pour stocker la carte

// Fonction appelée automatiquement par Google Maps quand le script est chargé
function initMap() {
    // Coordonnées du centre de la France (environ)
    const centreFrance = { lat: 46.603354, lng: 1.888334 };

    // Création de la carte
    // On l'attache à la div qui a l'id "app-container"
    map = new google.maps.Map(document.getElementById("app-container"), {
        center: centreFrance,
        zoom: 6, // Zoom niveau pays
        mapId: 'DEMO_MAP_ID', // (Optionnel) requis pour les styles avancés
    });

    // Exemple : Ajouter un marqueur sur Paris (Gare de Lyon)
    new google.maps.Marker({
        position: { lat: 48.8443, lng: 2.3744 },
        map: map,
        title: "Gare de Lyon",
    });
}

function loadApp(appName) {
    console.log("Lancement du module : " + appName);
    const container = document.getElementById("app-container");
    
    if (appName === 'gares') {
        // Si la carte n'existe pas encore, on force son initialisation
        // (Utile si Google Maps a chargé avant qu'on clique)
        if (!map) {
            initMap(); 
        } else {
            // Si la carte existe déjà, on peut juste recentrer ou nettoyer les marqueurs
            map.setZoom(6);
        }
    }
    // Ici tu pourras gérer les autres cas (Tarifs, etc.) plus tard
}