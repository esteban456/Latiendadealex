#!/usr/bin/env python3
"""Constructor de índice de búsqueda invertido para el catálogo."""

import json
import unicodedata
import datetime
from pathlib import Path
from collections import defaultdict

BASE_DIR = Path(__file__).parent.parent
CATALOG_FILE = BASE_DIR / "data" / "catalog.json"
INDEX_FILE = BASE_DIR / "data" / "search-index.json"


def normalize(text: str) -> str:
    return (
        unicodedata.normalize("NFD", str(text or "").lower())
        .encode("ascii", "ignore")
        .decode("ascii")
    )


def tokenize(text: str) -> list:
    return [t for t in normalize(text).split() if len(t) > 1]


def main():
    print("=== Constructor de índice de búsqueda ===\n")

    with open(CATALOG_FILE, "r", encoding="utf-8") as f:
        catalog = json.load(f)

    products = catalog.get("products", [])
    print(f"📦 {len(products)} productos a indexar\n")

    inverted_index = defaultdict(set)
    product_data = {}

    for product in products:
        pid = str(product["id"])
        product_data[pid] = {
            "id": product["id"],
            "slug": product["slug"],
            "name": product["name"],
            "brand": product.get("brand", ""),
            "price": product["price"],
            "image": product.get("image", ""),
            "categories": [c["name"] for c in product.get("categories", [])],
            "available": product.get("available", True),
        }

        searchable = " ".join(
            [
                product.get("name", ""),
                product.get("brand", ""),
                *[c["name"] for c in product.get("categories", [])],
                product.get("description", ""),
            ]
        )

        for token in tokenize(searchable):
            inverted_index[token].add(pid)

    index = {
        "generatedAt": __import__("datetime").datetime.now().isoformat(),
        "totalProducts": len(products),
        "products": product_data,
        "invertedIndex": {k: list(v) for k, v in inverted_index.items()},
    }

    with open(INDEX_FILE, "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=2)

    print(f"  Palabras indexadas: {len(inverted_index)}")
    print(f"  Productos indexados: {len(product_data)}")
    print(f"\n✅ Índice guardado en {INDEX_FILE}")


if __name__ == "__main__":
    main()
