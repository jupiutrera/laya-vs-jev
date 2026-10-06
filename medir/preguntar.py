"""Hace la misma petición (state + las cinco preguntas del caso) a Jev y a Laya y guarda la respuesta entera.

Uso:  python medir/preguntar.py jev|laya|laya-td [test|ajuste ...] [--max N]
      laya = convaiinnovations/laya (general); laya-td = convaiinnovations/laya-typed-decisions (especializada)
Reanudable: los casos que ya están en datos/respuestas/<modelo>-<conjunto>.jsonl se saltan.
"""
import argparse
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import requests
from dotenv import load_dotenv

RAIZ = Path(__file__).resolve().parent.parent
load_dotenv(RAIZ / ".env")


def leer(ruta: Path) -> list:
    if not ruta.exists():
        return []
    with open(ruta, encoding="utf-8") as f:
        return [json.loads(l) for l in f if l.strip()]


class Jev:
    hilos = 4

    def __init__(self):
        if os.environ.get("TYPESAFE_API_KEY"):
            self.url, self.modelo, self.clave = "https://api.typesafe.ai/v1/systemone", "jev-latest", os.environ["TYPESAFE_API_KEY"]
        elif os.environ.get("AI_GATEWAY_API_KEY"):
            self.url, self.modelo, self.clave = "https://ai-gateway.vercel.sh/v1/evaluate", "typesafe-ai/jev", os.environ["AI_GATEWAY_API_KEY"]
        else:
            sys.exit("Falta TYPESAFE_API_KEY o AI_GATEWAY_API_KEY en .env")

    def preguntar(self, caso: dict) -> dict:
        cuerpo = {"model": self.modelo, "state": caso["state"], "questions": caso["questions"]}
        for intento in range(5):
            t0 = time.perf_counter()
            try:
                r = requests.post(self.url, json=cuerpo, timeout=90, headers={"Authorization": f"Bearer {self.clave}"})
                ms = (time.perf_counter() - t0) * 1000
                if r.status_code == 200:
                    j = r.json()
                    return {"id": caso["id"], "modelo": j.get("model", self.modelo), "ms": round(ms, 1),
                            "usage": j.get("usage"), "answers": j["answers"]}
                if r.status_code < 500 and r.status_code != 429:
                    raise RuntimeError(f"HTTP {r.status_code}: {r.text[:300]}")
            except requests.RequestException:
                pass
            time.sleep(2 ** intento)
        raise RuntimeError(f"{caso['id']}: sin respuesta tras 5 intentos")


class Laya:
    hilos = 1

    def __init__(self, repo: str = "convaiinnovations/laya"):
        import laya
        self.repo = repo
        self.agente = laya.load(repo)
        self.version = getattr(laya, "__version__", "?")

    def temperaturas(self) -> dict:
        return {"temperature": self.agente.temperature_raw, "temperature_by_options": self.agente.temperature_by_options_raw}

    def preguntar(self, caso: dict) -> dict:
        t0 = time.perf_counter()
        r = self.agente.predict(caso["state"], caso["questions"])
        ms = (time.perf_counter() - t0) * 1000
        return {"id": caso["id"], "modelo": f"{self.repo} (laya {self.version}, CPU)", "ms": round(ms, 1),
                "answers": r["answers"]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("modelo", choices=["jev", "laya", "laya-td"])
    ap.add_argument("conjuntos", nargs="*", default=["test", "ajuste"])
    ap.add_argument("--max", type=int, default=0, help="como mucho N casos por conjunto (prueba de humo)")
    a = ap.parse_args()

    cliente = Jev() if a.modelo == "jev" else Laya() if a.modelo == "laya" else Laya("convaiinnovations/laya-typed-decisions")
    (RAIZ / "datos" / "respuestas").mkdir(parents=True, exist_ok=True)
    if a.modelo.startswith("laya"):
        with open(RAIZ / "datos" / "respuestas" / f"{a.modelo}-temperaturas.json", "w", encoding="utf-8") as f:
            json.dump(cliente.temperaturas(), f, indent=1)

    for nombre in a.conjuntos:
        casos = leer(RAIZ / "datos" / f"{nombre}.jsonl")
        salida = RAIZ / "datos" / "respuestas" / f"{a.modelo}-{nombre}.jsonl"
        hechos = {r["id"] for r in leer(salida)}
        pendientes = [c for c in casos if c["id"] not in hechos]
        if a.max:
            pendientes = pendientes[: max(0, a.max - len(hechos))]
        print(f"{a.modelo} {nombre}: {len(hechos)} hechos, {len(pendientes)} pendientes", flush=True)
        t0, n = time.time(), 0
        with open(salida, "a", encoding="utf-8") as f, ThreadPoolExecutor(cliente.hilos) as pool:
            for fut in as_completed([pool.submit(cliente.preguntar, c) for c in pendientes]):
                f.write(json.dumps(fut.result(), ensure_ascii=False) + "\n")
                f.flush()
                n += 1
                if n % 20 == 0 or n == len(pendientes):
                    print(f"  {n}/{len(pendientes)}  {time.time() - t0:.0f} s", flush=True)


if __name__ == "__main__":
    main()
