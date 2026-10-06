"""Descarga typed-decisions (LocalLLaMA/typed-decisions) y guarda los casos en datos/.

- test completo (400 casos, 2.000 decisiones): donde se mide.
- 200 casos de train (50 por flujo, semilla fija): donde se ajusta la temperatura.
"""
import json
import random
from pathlib import Path

from datasets import load_dataset

RAIZ = Path(__file__).resolve().parent.parent
FLUJOS = ["agent_trace_observability", "customer_service", "invoice_processing", "security_incidents"]
AJUSTE_POR_FLUJO = 50
SEMILLA = 7


def filas(flujo: str, split: str):
    for r in load_dataset("LocalLLaMA/typed-decisions", flujo, split=split):
        yield {
            "id": r["id"] if "id" in r else r.get("case_id"),
            "flujo": flujo,
            "state": json.loads(r["state"]),
            "questions": json.loads(r["questions"]),
            "gold": json.loads(r["gold"]),
        }


def guardar(nombre: str, casos: list):
    with open(RAIZ / "datos" / nombre, "w", encoding="utf-8") as f:
        for c in casos:
            f.write(json.dumps(c, ensure_ascii=False) + "\n")
    print(f"{nombre}: {len(casos)} casos")


if __name__ == "__main__":
    rng = random.Random(SEMILLA)
    test, ajuste = [], []
    for flujo in FLUJOS:
        test += list(filas(flujo, "test"))
        tr = list(filas(flujo, "train"))
        ajuste += rng.sample(tr, AJUSTE_POR_FLUJO)
    guardar("test.jsonl", test)
    guardar("ajuste.jsonl", ajuste)
