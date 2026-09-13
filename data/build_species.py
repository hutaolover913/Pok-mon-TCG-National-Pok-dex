import json, csv

rows = []
with open('dex_raw.csv', encoding='utf-8') as f:
    for line in f:
        line = line.rstrip('\n')
        if not line.strip():
            continue
        parts = line.split('|')
        # id | zh | en | gen | legendary | mythical | evolvesFrom
        while len(parts) < 7:
            parts.append('')
        pid, zh, en, gen, leg, myth, evolves = parts[:7]
        rows.append({
            "id": int(pid),
            "nameZh": zh,
            "nameEn": en,
            "generation": int(gen),
            "isLegendary": leg == "1",
            "isMythical": myth == "1",
            "evolvesFromId": int(evolves) if evolves.strip() else None,
            "imageUrl": f"https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/{pid}.png"
        })

rows.sort(key=lambda r: r["id"])
print(len(rows), "species")
with open('species.json', 'w', encoding='utf-8') as f:
    json.dump(rows, f, ensure_ascii=False, separators=(',', ':'))
print("done")
