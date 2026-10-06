// Datos de la escena: los genera medir/analizar.py en src/data/medidas.json.
// Si el archivo no existe todavía, o con ?mock en la URL, se usan datos simulados y la escena lo dice.

/** laya = convaiinnovations/laya (general); laya_td = laya-typed-decisions (especializada). */
export type Modelo = 'laya' | 'laya_td' | 'jev';
export type Estado = 'crudo' | 'de_serie' | 'reajustado';

export interface Tramo {
  desde: number;
  hasta: number;
  n: number;
  confianza: number | null;
  exactitud: number | null;
}

export interface Resumen {
  decisiones: number;
  exactitud: number;
  confianza_media: number;
  sobreconfianza: number;
  brier: number;
  ece: number;
  ece_ic95: [number, number];
  tramos: Tramo[];
}

export interface Variantes {
  '10_tramos': number;
  '15_tramos': number;
  '10_tramos_igual_masa': number;
  campo_confidence_del_modelo: number;
  todas_las_opciones: number;
  contra_oro_blando: number;
  media_por_pregunta_10_tramos: number;
  media_por_pregunta_15_tramos: number;
  por_flujo: Record<string, number>;
  por_tipo: Record<string, number>;
}

export interface MedidaModelo {
  version: string | null;
  casos_test: number;
  casos_ajuste: number;
  latencia_p50_ms_por_caso: number | null;
  temperaturas_reajuste: Record<string, number>;
  estados: Partial<Record<Estado, Resumen>>;
  variantes_de_medida: Partial<Record<Estado, Variantes>>;
}

export interface Resultados {
  conjunto: string;
  test_casos: number;
  ajuste_casos: number;
  modelos: Record<'laya' | 'jev', MedidaModelo> & { laya_td?: MedidaModelo };
  publicado: {
    laya: { ece_sin_ajustar: number; ece_reajustado: number };
    jev: { ece: number; fuente: string }[];
  };
}

/** Una decisión por elemento, en el orden del test: confianza en milésimas y acierto. */
export interface Secuencia {
  c: number[];
  ok: string;
}

export interface Datos {
  simulado: boolean;
  resultados: Resultados;
  secuencias: Partial<Record<Modelo, Partial<Record<Estado, Secuencia>>>>;
}

const archivos = import.meta.glob<{ default: Omit<Datos, 'simulado'> }>('./data/medidas.json', { eager: true });

export function cargarDatos(): Datos {
  const real = Object.values(archivos)[0]?.default;
  if (real && !new URLSearchParams(location.search).has('mock')) return { simulado: false, ...real };
  return simular();
}

// ---- Datos simulados (sólo para desarrollar la escena) ----

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

/** Confianzas con forma de "casi todo arriba" y acierto = confianza - sesgo. */
function secuenciaSimulada(seed: number, n: number, sesgo: number, picos: number): Secuencia {
  const r = rng(seed);
  const c: number[] = [];
  let ok = '';
  for (let i = 0; i < n; i++) {
    const conf = Math.min(1, 0.3 + 0.7 * Math.pow(r(), 1 / picos));
    c.push(Math.round(conf * 1000));
    ok += r() < Math.max(0, conf - sesgo) ? '1' : '0';
  }
  return { c, ok };
}

function resumir(s: Secuencia): Resumen {
  const tramos: Tramo[] = [];
  let ece = 0;
  let aciertos = 0;
  let conf = 0;
  for (let i = 0; i < 10; i++) {
    let n = 0;
    let sc = 0;
    let so = 0;
    s.c.forEach((m, j) => {
      const x = m / 1000;
      if ((i === 0 ? x >= 0 : x > i / 10) && x <= (i + 1) / 10) {
        n++;
        sc += x;
        so += +s.ok[j];
      }
    });
    tramos.push({ desde: i / 10, hasta: (i + 1) / 10, n, confianza: n ? sc / n : null, exactitud: n ? so / n : null });
    ece += Math.abs(sc - so) / s.c.length;
    aciertos += so;
    conf += sc;
  }
  const N = s.c.length;
  return {
    decisiones: N, exactitud: aciertos / N, confianza_media: conf / N, sobreconfianza: (conf - aciertos) / N,
    brier: 0, ece, ece_ic95: [ece * 0.85, ece * 1.15], tramos,
  };
}

function simular(): Datos {
  const sec = {
    laya: {
      crudo: secuenciaSimulada(1, 2000, 0.45, 4),
      de_serie: secuenciaSimulada(2, 2000, 0.3, 3),
      reajustado: secuenciaSimulada(3, 2000, 0.05, 1.5),
    },
    laya_td: {
      crudo: secuenciaSimulada(6, 2000, 0.25, 4),
      de_serie: secuenciaSimulada(7, 2000, 0.15, 5),
      reajustado: secuenciaSimulada(8, 2000, 0.03, 3),
    },
    jev: {
      de_serie: secuenciaSimulada(4, 2000, 0.2, 6),
      reajustado: secuenciaSimulada(5, 2000, 0.04, 2),
    },
  };
  const modelo = (m: Modelo): MedidaModelo => {
    const estados = Object.fromEntries(Object.entries(sec[m]).map(([e, s]) => [e, resumir(s)])) as MedidaModelo['estados'];
    const v = (e: number): Variantes => ({
      '10_tramos': e, '15_tramos': e * 1.04, '10_tramos_igual_masa': e * 0.92, campo_confidence_del_modelo: e * 1.6,
      todas_las_opciones: e * 0.6, contra_oro_blando: e * 4, media_por_pregunta_10_tramos: e * 3, media_por_pregunta_15_tramos: e * 3.4,
      por_flujo: { a: e * 0.7, b: e * 1.3 }, por_tipo: { noul: e * 0.8, choice: e, score: e * 1.2 },
    });
    return {
      version: `${m} (SIMULADO)`, casos_test: 400, casos_ajuste: 200, latencia_p50_ms_por_caso: null, temperaturas_reajuste: {},
      estados, variantes_de_medida: Object.fromEntries(Object.entries(estados).map(([e, r]) => [e, v(r!.ece)])),
    };
  };
  return {
    simulado: true,
    secuencias: sec,
    resultados: {
      conjunto: 'SIMULADO', test_casos: 400, ajuste_casos: 200,
      modelos: { laya: modelo('laya'), laya_td: modelo('laya_td'), jev: modelo('jev') },
      publicado: { laya: { ece_sin_ajustar: 0.466, ece_reajustado: 0.081 }, jev: [{ ece: 0.246, fuente: '' }, { ece: 0.144, fuente: '' }] },
    },
  };
}
