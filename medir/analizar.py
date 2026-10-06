"""Curvas de fiabilidad y ECE de Jev, Laya y Laya especializada sobre typed-decisions (test), con el reajuste hecho en 'ajuste'.

Definiciones (las mismas para todos los modelos):
- Una decisión = una pregunta de un caso. Test: 400 casos x 5 preguntas = 2.000 decisiones.
- Respuesta = la opción con más probabilidad. Acierto = coincide con la etiqueta del oro (gold.label).
- Confianza = probabilidad de la respuesta, max(p). En sí/no, max(p, 1-p).
- ECE principal = 10 tramos de igual anchura, peso por número de decisiones.
- Reajuste = una temperatura por tipo de pregunta y nº de opciones (como agrupa Laya), ajustada
  minimizando la log-verosimilitud en 'ajuste' (200 casos de train, nunca vistos en test).

Uso:  python medir/analizar.py            -> datos/resultados.json y src/data/medidas.json
      python medir/analizar.py --prueba   -> comprueba el cálculo del ECE con datos sintéticos
"""
import json
import sys
from pathlib import Path

import numpy as np
from scipy.optimize import minimize_scalar

RAIZ = Path(__file__).resolve().parent.parent
TRAMOS = 10
SEMILLA = 11
SUELO_JEV = 0.005  # Jev redondea a 2 decimales; un 0,00 se lee como "menos de 0,005"
SUELO = 1e-6


def leer(ruta: Path) -> list:
    with open(ruta, encoding="utf-8") as f:
        return [json.loads(l) for l in f if l.strip()]


def cubeta(tipo: str, k: int) -> str:
    """Mismo agrupamiento que laya.common.temp_bucket."""
    return f"{tipo}:" + ("2" if k <= 2 else "3-5" if k <= 5 else "6-10" if k <= 10 else "11+")


def opciones(q: dict) -> list:
    if q["type"] == "noul":
        return ["false", "true"]
    if q["type"] == "score":
        return [str(i) for i in range(len(q["criteria"]))]
    return list(q["criteria"].keys())


def vector(resp: dict, q: dict, ops: list, suelo: float) -> np.ndarray:
    if q["type"] == "noul":
        t = float(resp["noul"])
        p = np.array([1 - t, t])
    else:
        p = np.array([float(resp["probabilities"].get(o, 0.0)) for o in ops])
    p = np.clip(p, suelo, None)
    return p / p.sum()


def decisiones(casos: list, respuestas: list, suelo: float) -> list:
    """Una fila por decisión: tipo, cubeta, vector de probabilidades, etiqueta del oro, confianza que declara el modelo."""
    por_id = {r["id"]: r for r in respuestas}
    filas = []
    for c in casos:
        r = por_id.get(c["id"])
        if r is None:
            continue
        for nombre, q in c["questions"].items():
            ops = opciones(q)
            a = r["answers"][nombre]
            p = vector(a, q, ops, suelo)
            declarada = a.get("confidence")
            filas.append({
                "caso": c["id"], "flujo": c["flujo"], "pregunta": nombre, "tipo": q["type"],
                "cubeta": cubeta(q["type"], len(ops)), "p": p, "oro": ops.index(str(c["gold"][nombre]["label"])),
                "declarada": float(declarada) if declarada is not None else float(p.max()),
                "oro_blando": np.array([float(c["gold"][nombre]["probabilities"][o]) for o in ops]),
            })
    return filas


def escalar(p: np.ndarray, t: float) -> np.ndarray:
    z = np.log(p) / t
    z = np.exp(z - z.max())
    return z / z.sum()


def ajustar_temperaturas(filas: list) -> dict:
    temps = {}
    for cb in sorted({f["cubeta"] for f in filas}):
        sub = [f for f in filas if f["cubeta"] == cb]

        def nll(logt):
            t = np.exp(logt)
            return -sum(np.log(escalar(f["p"], t)[f["oro"]] + 1e-12) for f in sub)

        r = minimize_scalar(nll, bounds=(np.log(0.05), np.log(50)), method="bounded")
        temps[cb] = round(float(np.exp(r.x)), 4)
    return temps


def aplicar(filas: list, temps: dict) -> list:
    return [{**f, "p": escalar(f["p"], temps.get(f["cubeta"], 1.0))} for f in filas]


def deshacer_serie_laya(filas: list, ts: dict) -> list:
    """Laya devuelve softmax(z / T_serie). Elevar a T_serie y normalizar devuelve softmax(z): el modelo crudo."""
    def t_serie(cb, tipo):
        idx = {"noul": 0, "choice": 1, "score": 2}[tipo]
        t = ts["temperature_by_options"].get(cb, ts["temperature"][idx])
        return min(max(t, 0.5), 5.0)  # laya.common.clamp_temperature
    return [{**f, "p": escalar(f["p"], 1 / t_serie(f["cubeta"], f["tipo"]))} for f in filas]


def conf_acierto(filas: list):
    conf = np.array([f["p"].max() for f in filas])
    ok = np.array([int(f["p"].argmax() == f["oro"]) for f in filas])
    return conf, ok


def ece(conf, ok, tramos=TRAMOS, igual_masa=False) -> float:
    conf, ok = np.asarray(conf, float), np.asarray(ok, float)
    if igual_masa:
        orden = np.argsort(conf, kind="stable")
        grupos = np.array_split(orden, tramos)
        return float(sum(len(g) / len(conf) * abs(conf[g].mean() - ok[g].mean()) for g in grupos if len(g)))
    bordes = np.linspace(0, 1, tramos + 1)
    e = 0.0
    for i in range(tramos):
        sel = (conf >= bordes[i] if i == 0 else conf > bordes[i]) & (conf <= bordes[i + 1])
        if sel.any():
            e += sel.mean() * abs(conf[sel].mean() - ok[sel].mean())
    return float(e)


def curva(conf, ok) -> list:
    bordes = np.linspace(0, 1, TRAMOS + 1)
    out = []
    for i in range(TRAMOS):
        sel = (conf >= bordes[i] if i == 0 else conf > bordes[i]) & (conf <= bordes[i + 1])
        n = int(sel.sum())
        out.append({"desde": round(bordes[i], 2), "hasta": round(bordes[i + 1], 2), "n": n,
                    "confianza": round(float(conf[sel].mean()), 4) if n else None,
                    "exactitud": round(float(ok[sel].mean()), 4) if n else None})
    return out


def intervalo(filas: list, rng, veces=1000):
    """IC 95 % del ECE remuestreando casos enteros (las cinco decisiones de un caso van juntas)."""
    ids = sorted({f["caso"] for f in filas})
    por = {i: [] for i in ids}
    for f in filas:
        por[f["caso"]].append(f)
    vals = []
    for _ in range(veces):
        m = [f for i in rng.choice(ids, len(ids)) for f in por[i]]
        vals.append(ece(*conf_acierto(m)))
    return [round(float(np.percentile(vals, 2.5)), 4), round(float(np.percentile(vals, 97.5)), 4)]


def resumen(filas: list, rng) -> dict:
    conf, ok = conf_acierto(filas)
    brier = float(np.mean([((f["p"] - np.eye(len(f["p"]))[f["oro"]]) ** 2).sum() for f in filas]))
    return {
        "decisiones": len(filas), "exactitud": round(float(ok.mean()), 4), "confianza_media": round(float(conf.mean()), 4),
        "sobreconfianza": round(float(conf.mean() - ok.mean()), 4), "brier": round(brier, 4),
        "ece": round(ece(conf, ok), 4), "ece_ic95": intervalo(filas, rng), "tramos": curva(conf, ok),
    }


def variantes(filas: list) -> dict:
    """La misma tanda de respuestas medida de varias maneras que se usan en la práctica.

    Ninguna reproduce a la vez las tres cifras de la tabla de typed-decisions (uniforme 0,169,
    prior 0,088, Jev 0,144); el script con el que se calcularon no está publicado.
    """
    conf, ok = conf_acierto(filas)
    declarada = np.array([f["declarada"] for f in filas])
    flujos = sorted({f["flujo"] for f in filas})
    tipos = sorted({f["tipo"] for f in filas})
    sel = lambda clave, v: [f for f in filas if f[clave] == v]
    preguntas = sorted({(f["flujo"], f["pregunta"]) for f in filas})
    por_preg = [conf_acierto([f for f in filas if (f["flujo"], f["pregunta"]) == q]) for q in preguntas]
    todas_p = np.concatenate([f["p"] for f in filas])
    todas_y = np.concatenate([np.eye(len(f["p"]))[f["oro"]] for f in filas])
    oro_elegida = np.array([f["oro_blando"][int(f["p"].argmax())] for f in filas])
    return {
        "10_tramos": round(ece(conf, ok), 4),
        "15_tramos": round(ece(conf, ok, 15), 4),
        "10_tramos_igual_masa": round(ece(conf, ok, 10, True), 4),
        "campo_confidence_del_modelo": round(ece(declarada, ok), 4),
        "todas_las_opciones": round(ece(todas_p, todas_y), 4),
        "contra_oro_blando": round(ece(conf, oro_elegida), 4),
        "media_por_pregunta_10_tramos": round(float(np.mean([ece(c, o) for c, o in por_preg])), 4),
        "media_por_pregunta_15_tramos": round(float(np.mean([ece(c, o, 15) for c, o in por_preg])), 4),
        "por_flujo": {fl: round(ece(*conf_acierto(sel("flujo", fl))), 4) for fl in flujos},
        "por_tipo": {t: round(ece(*conf_acierto(sel("tipo", t))), 4) for t in tipos},
    }


def secuencia(filas: list) -> dict:
    """Para la escena: confianza (en milésimas) y acierto de cada decisión, en el orden del test."""
    conf, ok = conf_acierto(filas)
    return {"c": [int(round(x * 1000)) for x in conf], "ok": "".join(str(int(x)) for x in ok)}


def prueba():
    rng = np.random.default_rng(0)
    c = rng.uniform(0, 1, 200_000)
    print("calibrado perfecto  ECE =", round(ece(c, rng.uniform(0, 1, c.size) < c), 4), "(esperado ~0)")
    print("dice 100 %, acierta 50 %  ECE =", round(ece(np.ones(10_000), rng.uniform(0, 1, 10_000) < 0.5), 4), "(esperado ~0,5)")


def main():
    if "--prueba" in sys.argv:
        return prueba()
    d = RAIZ / "datos"
    test, ajuste = leer(d / "test.jsonl"), leer(d / "ajuste.jsonl")
    rng = np.random.default_rng(SEMILLA)
    out = {"conjunto": "LocalLLaMA/typed-decisions", "test_casos": len(test), "ajuste_casos": len(ajuste),
           "definiciones": __doc__.split("Uso:")[0].strip(), "modelos": {}}
    medidas = {}

    # clave en resultados.json -> prefijo de los archivos de respuestas
    modelos = [("jev", "jev", SUELO_JEV), ("laya", "laya", SUELO), ("laya_td", "laya-td", SUELO)]
    for nombre, archivo, suelo in modelos:
        if not all((d / "respuestas" / f"{archivo}-{c}.jsonl").exists() for c in ("test", "ajuste")):
            continue
        rt, ra = leer(d / "respuestas" / f"{archivo}-test.jsonl"), leer(d / "respuestas" / f"{archivo}-ajuste.jsonl")
        ft, fa = decisiones(test, rt, suelo), decisiones(ajuste, ra, suelo)
        estados = {}
        if nombre.startswith("laya"):
            ts = json.loads((d / "respuestas" / f"{archivo}-temperaturas.json").read_text())
            ft_crudo, fa_crudo = deshacer_serie_laya(ft, ts), deshacer_serie_laya(fa, ts)
            temps = ajustar_temperaturas(fa_crudo)
            estados["crudo"] = ft_crudo
            estados["de_serie"] = ft
            estados["reajustado"] = aplicar(ft_crudo, temps)
        else:
            temps = ajustar_temperaturas(fa)
            estados["de_serie"] = ft
            estados["reajustado"] = aplicar(ft, temps)
        ms = np.array([r["ms"] for r in rt])
        out["modelos"][nombre] = {
            "version": rt[0]["modelo"] if rt else None, "casos_test": len(rt), "casos_ajuste": len(ra),
            "latencia_p50_ms_por_caso": round(float(np.median(ms)), 1) if len(ms) else None,
            "temperaturas_reajuste": temps,
            "estados": {e: resumen(f, rng) for e, f in estados.items()},
            "variantes_de_medida": {e: variantes(f) for e, f in estados.items()},
        }
        medidas[nombre] = {e: secuencia(f) for e, f in estados.items()}
        print(f"{nombre}: " + "  ".join(f"{e} ECE {out['modelos'][nombre]['estados'][e]['ece']:.3f}" for e in estados))

    out["publicado"] = {
        "nota": "Cifras de terceros, no medidas aquí.",
        "laya": {"ece_sin_ajustar": 0.466, "ece_reajustado": 0.081,
                 "fuentes": ["https://huggingface.co/convaiinnovations/laya", "https://www.eesel.ai/blog/laya-ai-review"]},
        "jev": [
            {"ece": 0.246, "fuente": "https://www.eesel.ai/blog/laya-ai-review (comparativa Laya vs Jev)"},
            {"ece": 0.144, "fuente": "https://huggingface.co/datasets/LocalLLaMA/typed-decisions (Jev 1.13.0, test, zero-shot)"},
        ],
    }
    (d / "resultados.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    (RAIZ / "src" / "data").mkdir(parents=True, exist_ok=True)
    (RAIZ / "src" / "data" / "medidas.json").write_text(json.dumps(
        {"resultados": out, "secuencias": medidas}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("datos/resultados.json y src/data/medidas.json")


if __name__ == "__main__":
    main()
