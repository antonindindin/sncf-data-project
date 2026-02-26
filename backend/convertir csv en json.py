import pandas as pd
import json
import os

print("Démarrage de la conversion et du filtrage des gares...")

dossier_projet = os.path.expanduser("~/Documents/sncf-data-project/data")
fichier_entree = os.path.join(dossier_projet, "gares-de-voyageurs.csv")
fichier_sortie = os.path.join(dossier_projet, "frontend", "gares.geojson")

df = pd.read_csv(fichier_entree, sep=";")
features = []
gares_conservees = 0

for index, row in df.iterrows():
    pos = str(row.get('Position géographique', ''))
    segment = str(row.get('Segment(s) DRG', '')).strip()
    
    # FILTRE ANTI-LAG : On ignore les gares sans coordonnées ET les gares de catégorie C (locales)
    if pd.isna(row.get('Position géographique')) or pos.strip() == '':
        continue
    if segment == 'C' or segment == 'a' or segment == 'c': # On ne garde que A et B
        continue
        
    try:
        lat_str, lng_str = pos.split(',')
        lat = float(lat_str.strip())
        lng = float(lng_str.strip())
        
        geometry = {
            "type": "Point",
            "coordinates": [lng, lat]
        }
        
        properties = row.to_dict()
        for k, v in properties.items():
            if pd.isna(v):
                properties[k] = ""
            else:
                properties[k] = str(v)
        
        feature = {
            "type": "Feature",
            "geometry": geometry,
            "properties": properties
        }
        features.append(feature)
        gares_conservees += 1
        
    except Exception as e:
        pass

geojson = {
    "type": "FeatureCollection",
    "features": features
}

os.makedirs(os.path.dirname(fichier_sortie), exist_ok=True)
with open(fichier_sortie, "w", encoding="utf-8") as f:
    json.dump(geojson, f, ensure_ascii=False)

print(f"Succès ! Fichier allégé généré : {fichier_sortie}_allégé")
print(f"Nombre de gares conservées (Segments A et B) : {gares_conservees}")