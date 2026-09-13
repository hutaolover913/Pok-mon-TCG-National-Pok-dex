import requests, json

query = """query {
  pokemon_v2_pokemonspecies(limit: 1025, order_by: {id: asc}) {
    id
    pokemon_v2_pokemonspeciesnames(where: {pokemon_v2_language: {name: {_eq: "ja-Hrkt"}}}) {
      name
    }
  }
}"""

r = requests.post('https://beta.pokeapi.co/graphql/v1beta', json={"query": query}, timeout=30)
j = r.json()
arr = j['data']['pokemon_v2_pokemonspecies']
out = {}
for e in arr:
    names = e['pokemon_v2_pokemonspeciesnames']
    out[e['id']] = names[0]['name'] if names else None

with open('../ja_species_names.json', 'w', encoding='utf-8') as f:
    json.dump(out, f, ensure_ascii=False)
print("count:", len(out), "missing:", sum(1 for v in out.values() if not v))
