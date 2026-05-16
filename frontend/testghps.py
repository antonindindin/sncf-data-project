"""
============================================================================
SNCF DATA PROJECT - TRAITEMENT GTFS → graphe.js (v8 - DÉFINITIF)
============================================================================
STRATÉGIE (validée sur les données réelles) :

Le réseau SNCF n'est PAS un graphe routable (99% déconnecté) et ses tronçons
sont parfois très longs (jusqu'à 350 km d'un bloc). MAIS chaque tronçon a une
géométrie très fine (jusqu'à 1500+ points).

Donc, pour chaque arête du graphe GTFS (= 2 gares ADJACENTES, donc proches
et en général sur la même ligne) :
  1. On trouve le tronçon reseau.js le plus proche des deux gares
  2. On PROJETTE les 2 gares sur la polyligne fine de ce tronçon
  3. On extrait la PORTION de tracé entre les 2 projections
  4. On stocke cette portion (liste de [lat,lng]) dans l'arête

Le graphe.js contient ainsi, pour chaque arête, la clé 'trace' = la
géométrie EXACTE à surligner. Côté navigateur : on dessine ces traces en
orange. Aucun débordement, suit la voie ferrée, indépendant du calque réseau.

Usage :
    1. python3 convertir_lignes_en_js.py   (génère reseau.js depuis le CSV)
    2. python3 testghps.py                 (génère graphe.js)

Dépendance : stdlib uniquement.
"""

import csv
import io
import json
import math
import os
import re
import sys
import urllib.request
import zipfile
from collections import defaultdict

csv.field_size_limit(sys.maxsize)

URL_GTFS = "https://eu.ftp.opendatasoft.com/sncf/plandata/Export_OpenData_SNCF_GTFS_NewTripId.zip"
NOM_ZIP = "gtfs_sncf.zip"
TARIFS_KM = {'TGV': 0.18, 'IC': 0.15, 'TER': 0.10}

# Distance max (degrés) entre une gare et un tronçon pour les associer.
# 0.04° ≈ 4 km (certaines gares TGV sont loin du tracé exact).
SEUIL_GARE_TRONCON = 0.04


def haversine_km(lat1, lon1, lat2, lon2):
    R = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2 * R * math.asin(math.sqrt(a))


def gtfs_time_to_seconds(t):
    h, m, s = map(int, t.split(':'))
    return h*3600 + m*60 + s


def detecter_categorie(rsn, rln, aid):
    nom = ((rsn or '') + ' ' + (rln or '')).upper()
    if 'TGV' in nom or 'OUIGO' in nom or 'INOUI' in nom:
        return 'TGV'
    if 'INTERCITÉ' in nom or 'INTERCITES' in nom or nom.startswith('IC'):
        return 'IC'
    return 'TER'


def telecharger_gtfs():
    if os.path.exists(NOM_ZIP):
        mo = os.path.getsize(NOM_ZIP)/(1024*1024)
        print(f"  → ZIP présent ({mo:.1f} Mo), réutilisation.")
        return
    print(f"  → Téléchargement GTFS (1-2 min)...")
    try:
        urllib.request.urlretrieve(URL_GTFS, NOM_ZIP)
        print(f"  ✓ {os.path.getsize(NOM_ZIP)/(1024*1024):.1f} Mo")
    except Exception as e:
        print(f"  ✗ {e}")
        sys.exit(1)


def lire_csv_zip(zf, nom):
    with zf.open(nom) as fp:
        for r in csv.DictReader(io.TextIOWrapper(fp, encoding='utf-8-sig', newline='')):
            yield r


def charger_stops(zf):
    print("  → stops.txt...")
    s = {}
    for r in lire_csv_zip(zf, 'stops.txt'):
        try:
            s[r['stop_id']] = {'nom': r['stop_name'].strip(),
                               'lat': float(r['stop_lat']),
                               'lon': float(r['stop_lon']),
                               'parent': r.get('parent_station', '').strip()}
        except (ValueError, KeyError):
            pass
    print(f"     {len(s)} arrêts")
    return s


def charger_routes(zf):
    print("  → routes.txt...")
    rt = {}
    for r in lire_csv_zip(zf, 'routes.txt'):
        try:
            rt[r['route_id']] = detecter_categorie(
                r.get('route_short_name', ''), r.get('route_long_name', ''),
                r.get('agency_id', ''))
        except KeyError:
            pass
    print(f"     {len(rt)} routes")
    return rt


def charger_trips(zf):
    print("  → trips.txt...")
    tp = {}
    for r in lire_csv_zip(zf, 'trips.txt'):
        try:
            tp[r['trip_id']] = r['route_id']
        except KeyError:
            pass
    print(f"     {len(tp)} trajets")
    return tp


def analyser_stop_times(zf, trips, routes, stops):
    print("  → stop_times.txt (gros fichier)...")
    seg = defaultdict(lambda: [0, 0])
    etat = {'tc': None, 'arr': []}
    n = 0

    def flush():
        tc = etat['tc']
        arr = etat['arr']
        if tc is None or len(arr) < 2:
            etat['arr'] = []
            return
        rid = trips.get(tc)
        if rid is None:
            etat['arr'] = []
            return
        cat = routes.get(rid, 'TER')
        arr.sort(key=lambda x: x[0])
        for i in range(len(arr)-1):
            _, sa, _, aa = arr[i]
            _, sb, db, _ = arr[i+1]
            d = db - aa if aa > 0 else 0
            if 0 < d <= 6*3600:
                k = (sa, sb, cat)
                seg[k][0] += d
                seg[k][1] += 1
        etat['arr'] = []

    for r in lire_csv_zip(zf, 'stop_times.txt'):
        n += 1
        if n % 500000 == 0:
            print(f"     ... {n:,}")
        try:
            tid = r['trip_id']
            if tid != etat['tc']:
                flush()
                etat['tc'] = tid
            sq = int(r['stop_sequence'])
            sid = r['stop_id']
            if sid in stops and stops[sid]['parent']:
                sid = stops[sid]['parent']
            dp = gtfs_time_to_seconds(r['departure_time']) if r['departure_time'] else 0
            ar = gtfs_time_to_seconds(r['arrival_time']) if r['arrival_time'] else dp
            etat['arr'].append((sq, sid, dp, ar))
        except (ValueError, KeyError):
            pass
    flush()
    print(f"     {n:,} lignes, {len(seg):,} segments")
    return seg


def charger_reseau_js(dossier):
    chemin = os.path.join(dossier, 'reseau.js')
    if not os.path.exists(chemin):
        print("  ✗ reseau.js introuvable. Lance convertir_lignes_en_js.py")
        sys.exit(1)
    print("  → Lecture de reseau.js...")
    with open(chemin, 'r', encoding='utf-8') as f:
        c = f.read()
    mt = re.search(r'const\s+reseauGeoJsonData\s*=\s*(.+?);?\s*$', c, re.DOTALL)
    data = json.loads(mt.group(1).rstrip(';').strip())
    print(f"     {len(data['features'])} tronçons")
    return data['features']


def construire_index_troncons(features):
    print("  → Index spatial des tronçons...")
    TAILLE = 0.1
    index = defaultdict(list)
    troncons = {}
    for f in features:
        g = f.get('geometry')
        if not g or g.get('type') != 'LineString':
            continue
        tid = f['properties']['troncon_id']
        coords = g['coordinates']
        troncons[tid] = coords
        vues = set()
        for (lng, lat) in coords:
            c = (int(lng/TAILLE), int(lat/TAILLE))
            if c not in vues:
                vues.add(c)
                index[c].append(tid)
    print(f"     {len(troncons)} tronçons indexés, {len(index)} cellules")
    return index, troncons


def projeter_sur_troncon(lat, lng, coords):
    best_d, best_i = float('inf'), 0
    for i, (x, y) in enumerate(coords):
        d = (lng-x)**2 + (lat-y)**2
        if d < best_d:
            best_d, best_i = d, i
    return math.sqrt(best_d), best_i


def meilleur_troncon(lat, lng, index, troncons):
    TAILLE = 0.1
    cx, cy = int(lng/TAILLE), int(lat/TAILLE)
    cand = set()
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            cand.update(index.get((cx+dx, cy+dy), ()))
    best = (None, float('inf'), 0)
    for tid in cand:
        d, ip = projeter_sur_troncon(lat, lng, troncons[tid])
        if d < best[1]:
            best = (tid, d, ip)
    return best


def construire_graphe(segments, stops, index, troncons):
    print("  → Agrégation des arêtes GTFS...")
    prio = {'TGV': 3, 'IC': 2, 'TER': 1}
    gares_ut = set()
    for (a, b, _) in segments:
        if a in stops and b in stops:
            gares_ut.add(a)
            gares_ut.add(b)

    meilleure = {}
    for (a, b, cat), (tot, nb) in segments.items():
        if a not in stops or b not in stops or nb < 1:
            continue
        dm = (tot/nb)/60
        cle = tuple(sorted((a, b)))
        if cle not in meilleure or (
            prio[cat] > prio[meilleure[cle]['cat']] or
            (prio[cat] == prio[meilleure[cle]['cat']] and dm < meilleure[cle]['duree'])):
            meilleure[cle] = {'duree': dm, 'cat': cat}

    print("  → Indexation des gares...")
    liste_gares = []
    id_to_idx = {}
    for sid in sorted(gares_ut):
        info = stops[sid]
        id_to_idx[sid] = len(liste_gares)
        liste_gares.append({'id': sid, 'nom': info['nom'],
                            'lat': round(info['lat'], 5),
                            'lon': round(info['lon'], 5)})

    print("  → Extraction des traces par arête (projection)...")
    liste_aretes = []
    nb_ok = nb_ko = 0
    total = len(meilleure)
    for cpt, ((a, b), data) in enumerate(meilleure.items()):
        if cpt % 1000 == 0:
            print(f"     ... {cpt}/{total}")
        ia, ib = id_to_idx[a], id_to_idx[b]
        la, lna = stops[a]['lat'], stops[a]['lon']
        lb, lnb = stops[b]['lat'], stops[b]['lon']
        dist = haversine_km(la, lna, lb, lnb)

        tA, dA, ipA = meilleur_troncon(la, lna, index, troncons)
        tB, dB, ipB = meilleur_troncon(lb, lnb, index, troncons)

        trace = []
        if (tA is not None and tA == tB and
                dA < SEUIL_GARE_TRONCON and dB < SEUIL_GARE_TRONCON):
            coords = troncons[tA]
            i1, i2 = min(ipA, ipB), max(ipA, ipB)
            portion = coords[i1:i2+1]
            trace = [[round(c[1], 5), round(c[0], 5)] for c in portion]
            nb_ok += 1
        else:
            st = []
            if tA is not None and dA < SEUIL_GARE_TRONCON:
                cA = troncons[tA]
                i0, i1 = max(0, ipA-30), min(len(cA), ipA+30)
                st += [[round(c[1], 5), round(c[0], 5)] for c in cA[i0:i1]]
            if tB is not None and dB < SEUIL_GARE_TRONCON and tB != tA:
                cB = troncons[tB]
                i0, i1 = max(0, ipB-30), min(len(cB), ipB+30)
                st += [[round(c[1], 5), round(c[0], 5)] for c in cB[i0:i1]]
            if st:
                trace = st
                nb_ok += 1
            else:
                trace = [[round(la, 5), round(lna, 5)],
                         [round(lb, 5), round(lnb, 5)]]
                nb_ko += 1

        liste_aretes.append({
            'a': ia, 'b': ib,
            'duree': round(data['duree'], 1),
            'distance': round(dist, 1),
            'cat': data['cat'],
            'trace': trace,
        })

    pct = nb_ok*100//len(liste_aretes) if liste_aretes else 0
    print(f"     {len(liste_aretes)} arêtes : {nb_ok} tracées ({pct}%), "
          f"{nb_ko} en ligne droite")
    return {'gares': liste_gares, 'aretes': liste_aretes,
            'tarifs_km': TARIFS_KM}


def main():
    print("=" * 70)
    print("  Traitement GTFS SNCF → graphe.js (v8)")
    print("=" * 70)
    d = os.path.dirname(os.path.abspath(__file__))
    os.chdir(d)
    print(f"\nDossier : {d}\n")

    print("[1/4] Lecture du réseau (reseau.js)")
    features = charger_reseau_js(d)
    index, troncons = construire_index_troncons(features)
    print()

    print("[2/4] Récupération du GTFS")
    telecharger_gtfs()
    print()

    print("[3/4] Lecture des fichiers GTFS")
    with zipfile.ZipFile(NOM_ZIP, 'r') as zf:
        stops = charger_stops(zf)
        routes = charger_routes(zf)
        trips = charger_trips(zf)
        segments = analyser_stop_times(zf, trips, routes, stops)
    print()

    print("[4/4] Construction du graphe + génération graphe.js")
    graphe = construire_graphe(segments, stops, index, troncons)
    out = os.path.join(d, 'graphe.js')
    txt = "// Généré par testghps.py (v8)\n"
    txt += "// Chaque arête a 'trace' = liste de [lat,lng] (portion de voie à surligner)\n"
    txt += "const grapheSNCF = " + json.dumps(graphe, ensure_ascii=False) + ";\n"
    with open(out, 'w', encoding='utf-8') as f:
        f.write(txt)
    print(f"  ✓ graphe.js généré ({os.path.getsize(out)/1024:.1f} Ko)")
    print()
    print("=" * 70)
    print("  ✓ Terminé")
    print("=" * 70)


if __name__ == "__main__":
    main()
