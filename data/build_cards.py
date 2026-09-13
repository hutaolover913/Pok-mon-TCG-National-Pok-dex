import json

with open('raw_cards.json', encoding='utf-8') as f:
    raw = json.load(f)

# Default rarity -> app category mapping (English-market TCG API rarity strings).
# This is a best-effort DEFAULT mapping for the bundled English demo dataset;
# it is stored as editable data (categories.json) and can be changed by the user.
RARITY_TO_CATEGORY = {
    "Common": "NORMAL",
    "Uncommon": "NORMAL",
    "Rare": "NORMAL",
    "Rare Holo": "NORMAL",
    "Double Rare": "NORMAL",
    "Illustration Rare": "AR",
    "Rare Holo V": "SR",
    "Rare Holo VMAX": "SR",
    "Rare Holo VSTAR": "SR",
    "Rare Ultra": "SR",
    "Rare Rainbow": "UR",
    "Ultra Rare": "UR",
    "Hyper Rare": "UR",
    "Mega Hyper Rare": "UR",
    "Shiny Ultra Rare": "UR",
    "Rare Secret": "UR",
    "Special Illustration Rare": "SAR",
    "Trainer Gallery Rare Holo": "CHR",
    "Classic Collection": "OTHER",
    "Promo": "PROMO",
}

STAGE_EXCLUDE = {"Basic", "Stage 1", "Stage 2"}

cards = []
for c in raw:
    tags = [t for t in c.get("subtypes", []) if t not in STAGE_EXCLUDE]
    category = RARITY_TO_CATEGORY.get(c["rarity"], "OTHER")
    cards.append({
        "id": c["id"],
        "nameEn": c["name"],
        "nameZh": None,
        "setName": c["setName"],
        "setCode": c["setId"],
        "series": c["series"],
        "cardNumber": c["num"],
        "printedTotal": c["total"],
        "originalRarity": c["rarity"],
        "categoryId": category,
        "tags": tags,
        "language": "en",
        "imageSmall": c["small"],
        "imageLarge": c["large"],
        "releaseDate": c["release"],
        "dexNumbers": c["dex"],
        "isSample": True
    })

cards.sort(key=lambda c: (c["dexNumbers"][0] if c["dexNumbers"] else 9999, c["releaseDate"]), reverse=False)

with open('cards.json', 'w', encoding='utf-8') as f:
    json.dump(cards, f, ensure_ascii=False, separators=(',', ':'))

print(len(cards), "cards written")
from collections import Counter
print(Counter(c["categoryId"] for c in cards))
print(Counter(c["dexNumbers"][0] for c in cards))
