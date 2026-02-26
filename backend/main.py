import pandas as pd
import json
import os

print("Démarrage de la conversion CSV vers GeoJSON...")

# Définition des chemins de base (ajustez le chemin si nécessaire)
# os.path.expanduser("~") remplace le "~" par "/home/votre_nom_utilisateur" (ou C:\Users\Nom sous Windows)
dossier_projet = os.path.expanduser("~/Documents/sncf-data-project")

fichier_entree = os.path.join(dossier_projet, "lignes-lgv-et-par-ecartement.csv")
fichier_sortie = os.path.join(dossier_projet, "frontend", "reseau.geojson") # J'ajoute /frontend/ pour qu'il aille au bon endroit

# 1. Charger le CSV
df = pd.read_csv(fichier_entree, sep=";")

features = []

# 2. Parcourir chaque ligne pour extraire le tracé géographique
for index, row in df.iterrows():
    if pd.isna(row.get('Geo Shape')):
        continue
        
    try:
        geo_shape = json.loads(row['Geo Shape'])
        
        feature = {
            "type": "Feature",
            "geometry": geo_shape,
            "properties": {
                "CODE_LIGNE": row.get('CODE_LIGNE', ''),
                "LIB_LIGNE": str(row.get('LIB_LIGNE', '')),
                "CATLIG": row.get('CATLIG', '')
            }
        }
        features.append(feature)
    except Exception as e:
        print(f"Erreur d'extraction à la ligne {index}: {e}")

# 4. Formater le tout selon le standard GeoJSON
geojson = {
    "type": "FeatureCollection",
    "features": features
}

# 5. Sauvegarder le fichier
# On s'assure que le dossier de destination existe, sinon on le crée
os.makedirs(os.path.dirname(fichier_sortie), exist_ok=True)

with open(fichier_sortie, "w", encoding="utf-8") as f:
    json.dump(geojson, f, ensure_ascii=False)

print(f"Succès ! Fichier cartographique généré : {fichier_sortie}")