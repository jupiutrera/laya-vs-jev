"""Tests of the calibration maths in medir/analizar.py and of the stored data.

The analysis code and its JSON keys are in Spanish. The names used here:
ece = expected calibration error, escalar = temperature-scale a probability vector,
ajustar_temperaturas = fit one temperature per bucket, cubeta = bucket,
deshacer_serie_laya = undo the temperatures Laya ships with,
oro = gold label, ajuste = the held-out split the temperatures are fitted on.
"""
import json
from pathlib import Path

import numpy as np
import pytest

import analizar

DATA = Path(__file__).resolve().parent.parent / "datos"
MODELS = {"jev": "jev", "laya": "laya", "laya_td": "laya-td"}


def softmax(z):
    z = np.exp(z - z.max())
    return z / z.sum()


# ---------------------------------------------------------------- ECE ----


def test_ece_of_a_hand_computed_example():
    # Two answers at 95 % with one right: |0.95 - 0.5| = 0.45 on half the data.
    # Two answers at 55 % with both right: |0.55 - 1.0| = 0.45 on the other half.
    assert analizar.ece([0.95, 0.95, 0.55, 0.55], [1, 0, 1, 1]) == pytest.approx(0.45)


def test_ece_is_near_zero_when_confidence_matches_accuracy():
    rng = np.random.default_rng(0)
    confidence = rng.uniform(0, 1, 200_000)
    correct = rng.uniform(0, 1, confidence.size) < confidence
    assert analizar.ece(confidence, correct) < 0.01


def test_ece_is_the_gap_when_a_model_is_always_sure():
    rng = np.random.default_rng(0)
    correct = rng.uniform(0, 1, 10_000) < 0.5
    assert analizar.ece(np.ones(10_000), correct) == pytest.approx(0.5, abs=0.02)


def test_ece_puts_a_value_on_a_bin_edge_in_the_lower_bin():
    # 0.5 belongs to (0.4, 0.5], so it is not averaged with 0.6, which belongs to (0.5, 0.6].
    # Separate bins: 0.5 * |0.5 - 1| + 0.5 * |0.6 - 0| = 0.55. One shared bin would give 0.05.
    assert analizar.ece([0.5, 0.6], [1, 0]) == pytest.approx(0.55)


def test_ece_counts_a_confidence_of_zero():
    assert analizar.ece([0.0, 0.0], [1, 1]) == pytest.approx(1.0)


def test_equal_mass_ece_splits_the_data_into_groups_of_the_same_size():
    confidence = np.array([0.91, 0.92, 0.93, 0.94])
    correct = np.array([1, 1, 0, 0])
    # Equal width: one bin, |0.925 - 0.5|. Equal mass with 2 groups: |0.915 - 1| and |0.935 - 0|.
    assert analizar.ece(confidence, correct, 10) == pytest.approx(0.425)
    assert analizar.ece(confidence, correct, 2, igual_masa=True) == pytest.approx((0.085 + 0.935) / 2)


# ------------------------------------------------- temperature scaling ----


def test_temperature_one_changes_nothing():
    p = np.array([0.7, 0.2, 0.1])
    assert analizar.escalar(p, 1.0) == pytest.approx(p)


def test_temperature_flattens_above_one_and_sharpens_below():
    p = np.array([0.7, 0.2, 0.1])
    assert analizar.escalar(p, 2.0).max() < 0.7 < analizar.escalar(p, 0.5).max()
    assert analizar.escalar(p, 2.0).sum() == pytest.approx(1.0)
    assert analizar.escalar(p, 0.5).argmax() == 0


def test_fitting_recovers_the_temperature_that_was_applied():
    # Labels are drawn from softmax(z); the model reports softmax(z / 0.5), which is overconfident.
    # Dividing its log-probabilities by T = 2 gives softmax(z) back.
    rng = np.random.default_rng(3)
    rows = []
    for _ in range(4000):
        z = rng.normal(0, 1.5, 4)
        rows.append({"cubeta": "choice:3-5", "p": softmax(z / 0.5), "oro": rng.choice(4, p=softmax(z))})
    temperatures = analizar.ajustar_temperaturas(rows)
    assert temperatures["choice:3-5"] == pytest.approx(2.0, abs=0.15)


def test_fitting_lowers_the_ece_of_an_overconfident_model():
    rng = np.random.default_rng(4)
    rows = []
    for _ in range(4000):
        z = rng.normal(0, 1.5, 4)
        rows.append({"cubeta": "choice:3-5", "p": softmax(z / 0.4), "oro": rng.choice(4, p=softmax(z))})
    fit, held_out = rows[:2000], rows[2000:]
    before = analizar.ece(*analizar.conf_acierto(held_out))
    after = analizar.ece(*analizar.conf_acierto(analizar.aplicar(held_out, analizar.ajustar_temperaturas(fit))))
    assert before > 0.15
    assert after < 0.04


def test_undoing_the_stock_temperature_gives_the_raw_model_back():
    z = np.array([1.2, -0.3, 0.4])
    stock = {"temperature": [1.0, 1.0, 1.0], "temperature_by_options": {"choice:3-5": 1.8}}
    row = {"cubeta": "choice:3-5", "tipo": "choice", "p": softmax(z / 1.8)}
    [raw] = analizar.deshacer_serie_laya([row], stock)
    assert raw["p"] == pytest.approx(softmax(z))


def test_undoing_falls_back_to_the_per_type_temperature_and_clamps_it():
    z = np.array([0.5, -0.5])
    # No entry for the bucket: the per-type list is used (noul, choice, score), clamped to [0.5, 5].
    stock = {"temperature": [9.0, 1.0, 1.0], "temperature_by_options": {}}
    row = {"cubeta": "noul:2", "tipo": "noul", "p": softmax(z / 5.0)}
    [raw] = analizar.deshacer_serie_laya([row], stock)
    assert raw["p"] == pytest.approx(softmax(z))


# ------------------------------------------------------------ questions ----


@pytest.mark.parametrize(
    "kind, options, bucket",
    [
        ("noul", 2, "noul:2"),
        ("choice", 3, "choice:3-5"),
        ("choice", 5, "choice:3-5"),
        ("score", 6, "score:6-10"),
        ("choice", 11, "choice:11+"),
    ],
)
def test_buckets_group_questions_by_type_and_number_of_options(kind, options, bucket):
    assert analizar.cubeta(kind, options) == bucket


def test_options_of_each_question_type():
    assert analizar.opciones({"type": "noul"}) == ["false", "true"]
    assert analizar.opciones({"type": "score", "criteria": ["bad", "fine", "good"]}) == ["0", "1", "2"]
    assert analizar.opciones({"type": "choice", "criteria": {"stop": "", "continue": ""}}) == ["stop", "continue"]


def test_a_yes_no_answer_becomes_a_two_way_distribution():
    p = analizar.vector({"noul": 0.8}, {"type": "noul"}, ["false", "true"], 1e-6)
    assert p == pytest.approx([0.2, 0.8])


def test_a_probability_reported_as_zero_is_floored_and_renormalised():
    question = {"type": "choice", "criteria": {"a": "", "b": ""}}
    p = analizar.vector({"probabilities": {"a": 1.0, "b": 0.0}}, question, ["a", "b"], 0.005)
    assert p.sum() == pytest.approx(1.0)
    assert p[1] == pytest.approx(0.005 / 1.005)


# ----------------------------------------------------------- stored data ----


def read_jsonl(path):
    with open(path, encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def test_the_test_split_is_400_cases_and_2000_decisions():
    cases = read_jsonl(DATA / "test.jsonl")
    assert len(cases) == 400
    assert sum(len(case["questions"]) for case in cases) == 2000


def test_no_case_is_in_both_the_fitting_split_and_the_test_split():
    test_ids = {case["id"] for case in read_jsonl(DATA / "test.jsonl")}
    fit_ids = {case["id"] for case in read_jsonl(DATA / "ajuste.jsonl")}
    assert len(fit_ids) == 200
    assert test_ids.isdisjoint(fit_ids)


@pytest.mark.parametrize("prefix", MODELS.values())
@pytest.mark.parametrize("split", ["test", "ajuste"])
def test_every_model_answered_every_question_once(prefix, split):
    cases = read_jsonl(DATA / f"{split}.jsonl")
    answers = read_jsonl(DATA / "respuestas" / f"{prefix}-{split}.jsonl")
    assert sorted(answer["id"] for answer in answers) == sorted(case["id"] for case in cases)
    by_id = {answer["id"]: answer for answer in answers}
    for case in cases:
        assert set(by_id[case["id"]]["answers"]) == set(case["questions"])


# ---------------------------------------------------------- reproduction ----


@pytest.fixture(scope="module")
def recomputed():
    # Few bootstrap rounds: the intervals are not compared, and the rest does not depend on them.
    results, _ = analizar.calcular(DATA, veces=20)
    return results


@pytest.fixture(scope="module")
def published():
    return json.loads((DATA / "resultados.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("model", MODELS)
def test_stored_answers_reproduce_the_published_numbers(model, recomputed, published):
    assert set(recomputed["modelos"][model]["estados"]) == set(published["modelos"][model]["estados"])
    for state, expected in published["modelos"][model]["estados"].items():
        actual = recomputed["modelos"][model]["estados"][state]
        for metric in ("decisiones", "exactitud", "confianza_media", "brier", "ece"):
            assert actual[metric] == pytest.approx(expected[metric], abs=2e-4), f"{model} {state} {metric}"
        low, high = expected["ece_ic95"]
        assert low <= expected["ece"] <= high


def test_the_readme_headline_numbers(published):
    ece = {model: {state: r["ece"] for state, r in m["estados"].items()} for model, m in published["modelos"].items()}
    assert round(ece["jev"]["de_serie"], 3) == 0.036
    assert round(ece["laya"]["de_serie"], 3) == 0.175
    assert round(ece["laya_td"]["de_serie"], 3) == 0.213
    assert round(ece["laya"]["reajustado"], 3) == 0.035
