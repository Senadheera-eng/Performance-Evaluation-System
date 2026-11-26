"""Grade prediction for PES: train, evaluate, and predict the current semester.

What it does
------------
For each student and each course, it predicts the grade band the student is
likely to get, using only what was known before that semester: the student's
earlier grades, and the course's department, credits and type. It reports how
well that works on a semester the model never saw, then predicts the current
semester and writes them for ml/load_predictions.py to load.

Bands follow the proposal: A+/A, A-/B+, B/B-, C+/C, and R/F (at risk).

How it is evaluated (no peeking at the future)
----------------------------------------------
Rolling origin: to test on Semester 5, the model is trained on Semesters 2-4
(each result with features from the semesters before it); to test on Semester
6, on Semesters 2-5. It never sees a grade from the semester it is tested on,
which is the situation it is in when it predicts the current semester for
real. Every model is compared with two baselines a mentor could work out by
hand: the most common band, and "the same as before" (the student's own
average so far, and the average of that with last semester's).

Usage
-----
    python ml/train.py                  # data in ml/data, writes ml/report and ml/out
    python ml/train.py --predict-semester 7

The data files come from ml/export_dataset.sql (see ml/README.md). Students and
courses in them are numbers, not names or ids; ml_load_predictions maps them
back inside the database.
"""

from __future__ import annotations

import argparse
import json
import math
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from sklearn.ensemble import RandomForestClassifier  # noqa: E402
from sklearn.metrics import (  # noqa: E402
    accuracy_score,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import GridSearchCV, GroupKFold  # noqa: E402
from sklearn.tree import DecisionTreeClassifier, plot_tree  # noqa: E402

ROOT = Path(__file__).resolve().parent

# The faculty's grade points (system_settings.gpv_scale). L is a deferral after
# an approved medical, not a result, so it is neither a label nor counted.
GPV = {"A+": 4.0, "A": 4.0, "A-": 3.7, "B+": 3.3, "B": 3.0, "B-": 2.7,
       "C+": 2.3, "C": 2.0, "R": 0.0, "F": 0.0}
CODE = {"1": "A+", "2": "A", "3": "A-", "4": "B+", "5": "B", "6": "B-",
        "7": "C+", "8": "C", "R": "R", "F": "F", "L": "L"}
BANDS = ["A+/A", "A-/B+", "B/B-", "C+/C", "R/F"]
BAND_OF = {"A+": 0, "A": 0, "A-": 1, "B+": 1, "B": 2, "B-": 2, "C+": 3, "C": 3, "R": 4, "F": 4}
AT_RISK = 4
DEPT_NAME = {"CE": "Civil", "CO": "Computer", "EE": "Electrical", "ME": "Mechanical",
             "IS": "Interdisciplinary"}

FEATURES = [
    "prior_gpa",        # credit-weighted average of every earlier GPA course
    "last_sem_gpa",     # the semester just before
    "trend",            # last semester's average minus the one before it
    "dept_gpa",         # the student's average in earlier courses of this course's department
    "gpa_spread",       # how uneven their earlier grades are (standard deviation)
    "prior_rf",         # earlier R or F grades
    "prior_l",          # earlier deferrals (L)
    "a_share",          # share of earlier grades in A-/A/A+
    "credits",          # this course's credits
    "elective",         # 1 if elective or optional
    "own_dept",         # 1 if the course is the student's own department's
    "is_course",        # 1 if Interdisciplinary Studies
    "dept_difficulty",  # everyone's earlier average in this course's department
]
# Not "semester": with one cohort every training row comes from an earlier
# semester than every test row, so a tree splitting on it extrapolates.
LABELS = {
    "prior_gpa": "Earlier average",
    "last_sem_gpa": "Last semester's average",
    "trend": "Change in average last semester",
    "dept_gpa": "Average in this department's courses",
    "gpa_spread": "Spread of earlier grades",
    "prior_rf": "Earlier R or F grades",
    "prior_l": "Earlier deferrals",
    "a_share": "Share of A grades",
    "credits": "Course credits",
    "elective": "Elective course",
    "own_dept": "Own department's course",
    "is_course": "Interdisciplinary course",
    "dept_difficulty": "Department's usual average",
}


@dataclass
class Course:
    idx: int
    dept: str
    semester: int
    credits: int
    category: str
    in_gpa: bool
    # False for the earlier part of a course taught over two semesters: its
    # grade is given with the later part, so it has no result to predict.
    graded_here: bool = True


@dataclass
class Result:
    course: Course
    grade: str

    @property
    def gpv(self) -> float | None:
        return GPV.get(self.grade)


@dataclass
class Student:
    idx: int
    dept: str
    results: list[Result] = field(default_factory=list)


# ---------------------------------------------------------------- loading

def load(data: Path) -> tuple[dict[int, Course], dict[int, Student]]:
    courses: dict[int, Course] = {}
    for part in (data / "courses.txt").read_text().strip().split(";"):
        ci, dept, sem, credits, cat, gpa, *rest = part.split(",")
        graded_here = rest[0] == "1" if rest else True
        courses[int(ci)] = Course(int(ci), dept, int(sem), int(credits), cat, gpa == "1", graded_here)
    students: dict[int, Student] = {}
    for part in (data / "students.txt").read_text().strip().split(";"):
        si, dept = part.split(",")
        students[int(si)] = Student(int(si), dept)
    for path in sorted(data.glob("results*.txt")):
        for line in path.read_text().strip().split(";"):
            si, codes = line.split("=")
            assert len(codes) % 3 == 0, f"bad record for student {si}"
            for k in range(0, len(codes), 3):
                ci = int(codes[k:k + 2], 36)
                students[int(si)].results.append(Result(courses[ci], CODE[codes[k + 2]]))
    return courses, students


# ---------------------------------------------------------------- features

def gpa(results: list[Result]) -> float | None:
    """Credit-weighted grade-point average of GPA courses, ignoring deferrals."""
    num = den = 0.0
    for r in results:
        if r.course.in_gpa and r.gpv is not None and r.course.credits > 0:
            num += r.gpv * r.course.credits
            den += r.course.credits
    return num / den if den else None


def dept_difficulty(students: dict[int, Student], before: int) -> dict[str, float]:
    """Everyone's average grade point per department, from semesters before `before`."""
    sums: dict[str, list[float]] = defaultdict(list)
    for st in students.values():
        for r in st.results:
            if r.course.semester < before and r.gpv is not None:
                sums[r.course.dept].append(r.gpv)
    return {d: float(np.mean(v)) for d, v in sums.items()}


def features(st: Student, course: Course, semester: int, difficulty: dict[str, float]) -> dict | None:
    prior = [r for r in st.results if r.course.semester < semester]
    p = gpa(prior)
    if p is None:
        return None
    last = gpa([r for r in prior if r.course.semester == semester - 1])
    before_last = gpa([r for r in prior if r.course.semester == semester - 2])
    last_v = last if last is not None else p
    trend = (last - before_last) if (last is not None and before_last is not None) else 0.0
    same = gpa([r for r in prior if r.course.dept == course.dept])
    gpvs = [r.gpv for r in prior if r.gpv is not None]
    return {
        "prior_gpa": p,
        "last_sem_gpa": last_v,
        "trend": trend,
        "dept_gpa": same if same is not None else p,
        "gpa_spread": float(np.std(gpvs)) if gpvs else 0.0,
        "prior_rf": sum(1 for r in prior if r.grade in ("R", "F")),
        "prior_l": sum(1 for r in prior if r.grade == "L"),
        "a_share": (sum(1 for r in prior if r.grade in ("A+", "A", "A-")) / len(prior)) if prior else 0.0,
        "credits": course.credits,
        "elective": 1 if course.category in ("E", "O") else 0,
        "own_dept": 1 if course.dept == st.dept else 0,
        "is_course": 1 if course.dept == "IS" else 0,
        "dept_difficulty": difficulty.get(course.dept, 3.0),
    }


def dataset(students: dict[int, Student], semesters: range) -> tuple[np.ndarray, np.ndarray, np.ndarray, list[tuple]]:
    """Rows for every graded result in `semesters`, with features from before it."""
    X, y, groups, meta = [], [], [], []
    for s in semesters:
        diff = dept_difficulty(students, s)
        for st in students.values():
            for r in st.results:
                if r.course.semester != s or r.grade == "L":
                    continue
                f = features(st, r.course, s, diff)
                if f is None:
                    continue
                X.append([f[k] for k in FEATURES])
                y.append(BAND_OF[r.grade])
                groups.append(st.idx)
                meta.append((st.idx, r.course.idx, r.grade))
    return np.array(X, dtype=float), np.array(y), np.array(groups), meta


# ---------------------------------------------------------------- evaluation helpers

def band_of_gpv(v: float) -> int:
    """The band a grade-point average falls in, for the 'same as before' baseline."""
    return 0 if v >= 3.85 else 1 if v >= 3.15 else 2 if v >= 2.5 else 3 if v >= 1.0 else 4


def expected_gpv(proba: np.ndarray, classes: np.ndarray, band_mean: dict[int, float]) -> np.ndarray:
    means = np.array([band_mean[int(c)] for c in classes])
    return proba @ means


def sgpa_forecast(meta: list[tuple], gpv_pred: np.ndarray, courses: dict[int, Course]) -> dict[int, tuple[float, float]]:
    """Per student: (forecast SGPA, actual SGPA) over the semester's GPA courses."""
    acc: dict[int, list[float]] = defaultdict(lambda: [0.0, 0.0, 0.0])
    for (si, ci, grade), g in zip(meta, gpv_pred):
        c = courses[ci]
        if not c.in_gpa or c.credits == 0:
            continue
        acc[si][0] += g * c.credits
        acc[si][1] += GPV[grade] * c.credits
        acc[si][2] += c.credits
    return {si: (a / n, b / n) for si, (a, b, n) in acc.items() if n}


def scores(name: str, y: np.ndarray, pred: np.ndarray, gpv_true: np.ndarray, gpv_pred: np.ndarray,
           risk_score: np.ndarray | None, sgpa: dict[int, tuple[float, float]] | None) -> dict:
    out = {
        "model": name,
        "accuracy": accuracy_score(y, pred),
        "macro_f1": f1_score(y, pred, average="macro", zero_division=0),
        "weighted_f1": f1_score(y, pred, average="weighted", zero_division=0),
        "within_one_band": float(np.mean(np.abs(y - pred) <= 1)),
        "gpv_mae": float(np.mean(np.abs(gpv_true - gpv_pred))),
        "at_risk_recall": recall_score(y == AT_RISK, pred == AT_RISK, zero_division=0),
        "at_risk_precision": precision_score(y == AT_RISK, pred == AT_RISK, zero_division=0),
    }
    if risk_score is not None and len(set(y == AT_RISK)) > 1:
        out["at_risk_auc"] = roc_auc_score(y == AT_RISK, risk_score)
    if sgpa:
        f = np.array([v[0] for v in sgpa.values()])
        a = np.array([v[1] for v in sgpa.values()])
        out["sgpa_mae"] = float(np.mean(np.abs(f - a)))
        out["sgpa_within_0_25"] = float(np.mean(np.abs(f - a) <= 0.25))
        out["students"] = len(sgpa)
    return {k: (round(v, 4) if isinstance(v, float) else v) for k, v in out.items()}


# ---------------------------------------------------------------- explanations

def path_reasons(tree: DecisionTreeClassifier, x: np.ndarray) -> list[str]:
    """The rules the tree followed for this row, in words, most decisive first."""
    t = tree.tree_
    node, rules = 0, []
    while t.children_left[node] != -1:
        f = FEATURES[t.feature[node]]
        thr = t.threshold[node]
        go_left = x[t.feature[node]] <= thr
        rules.append(describe(f, thr, go_left, x[t.feature[node]]))
        node = t.children_left[node] if go_left else t.children_right[node]
    # A rule repeated deeper down (the same feature split again) says the same
    # thing more precisely; keep the last one for each feature.
    seen, ordered = set(), []
    for r in reversed(rules):
        key = r.split(":")[0]
        if key not in seen:
            seen.add(key)
            ordered.append(r)
    return list(reversed(ordered))[:4]


def describe(f: str, thr: float, below: bool, value: float) -> str:
    label = LABELS[f]
    if f in ("elective", "own_dept", "is_course"):
        return f"{label}: {'no' if below else 'yes'}"
    if f in ("prior_rf", "prior_l", "credits"):
        return f"{label}: {int(value)}"
    if f == "a_share":
        return f"{label}: {value:.0%}"
    return f"{label}: {value:.2f} ({'at most' if below else 'above'} {thr:.2f})"


def feature_reasons(f: dict, dept: str) -> list[str]:
    """What the prediction rests on, in the student's own figures: the inputs
    the forest leans on most (see feature_importance.png)."""
    out = [f"Average so far: {f['prior_gpa']:.2f}"]
    if abs(f["trend"]) >= 0.2:
        out.append(f"Last semester: {f['last_sem_gpa']:.2f} ({'up' if f['trend'] > 0 else 'down'} {abs(f['trend']):.2f})")
    else:
        out.append(f"Last semester: {f['last_sem_gpa']:.2f}")
    out.append(f"Average in {DEPT_NAME.get(dept, dept)} courses: {f['dept_gpa']:.2f}")
    if f["prior_rf"]:
        out.append(f"R or F grades so far: {int(f['prior_rf'])}")
    return out


# ---------------------------------------------------------------- main

def student_risk(meta: list[tuple], risk: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Per student: the chance of at least one R or F this semester, from the
    per-course chances, and whether they actually got one."""
    p_none: dict[int, float] = defaultdict(lambda: 1.0)
    got: dict[int, bool] = defaultdict(bool)
    for (si, _, grade), r in zip(meta, risk):
        p_none[si] *= 1.0 - r
        got[si] |= grade in ("R", "F")
    ids = sorted(p_none)
    return np.array([1.0 - p_none[i] for i in ids]), np.array([got[i] for i in ids])


def flag_recall(score: np.ndarray, truth: np.ndarray, share: float = 0.25) -> float:
    """Of the students who did get an R or F, how many were in the top `share` flagged."""
    k = max(1, int(round(len(score) * share)))
    top = np.argsort(-score)[:k]
    return float(truth[top].sum() / max(1, truth.sum()))


def evaluate(students, courses, ts: int, seed: int) -> tuple[list[dict], dict]:
    """Every model on one held-out semester, trained on the semesters before it."""
    X_tr, y_tr, g_tr, meta_tr = dataset(students, range(2, ts))
    X_te, y_te, _, meta_te = dataset(students, range(ts, ts + 1))
    gpv_te = np.array([GPV[g] for _, _, g in meta_te])
    tr_gpv = defaultdict(list)
    for (_, _, g), b in zip(meta_tr, y_tr):
        tr_gpv[int(b)].append(GPV[g])
    band_mean = {b: float(np.mean(v)) for b, v in tr_gpv.items()}
    out: list[dict] = []

    def add(name, pred, gp, risk, extra=None):
        row = scores(name, y_te, pred, gpv_te, gp, risk, sgpa_forecast(meta_te, gp, courses))
        if risk is not None:
            sr, truth = student_risk(meta_te, risk)
            row["student_risk_auc"] = round(roc_auc_score(truth, sr), 4) if 0 < truth.sum() < len(truth) else None
            row["top25_flag_recall"] = round(flag_recall(sr, truth), 4)
        out.append(row | (extra or {}))

    majority = int(np.bincount(y_tr).argmax())
    add("Most common band (baseline)", np.full_like(y_te, majority),
        np.full(len(y_te), band_mean[majority]), None)
    prior = X_te[:, FEATURES.index("prior_gpa")]
    blend = (prior + X_te[:, FEATURES.index("last_sem_gpa")]) / 2
    # A baseline's "risk" is just how low the average is, scaled to 0-1.
    add("Same as before: average so far (baseline)", np.array([band_of_gpv(v) for v in prior]), prior,
        np.clip((4 - prior) / 4, 0, 1))
    add("Same as before: with last semester (baseline)", np.array([band_of_gpv(v) for v in blend]), blend,
        np.clip((4 - blend) / 4, 0, 1))

    cv = GroupKFold(n_splits=5)
    cart_search = GridSearchCV(
        DecisionTreeClassifier(random_state=seed),
        {"max_depth": [3, 4, 5, 6], "min_samples_leaf": [20, 40, 80, 120],
         "criterion": ["gini", "entropy"]},
        scoring="accuracy", cv=cv, n_jobs=-1)
    cart_search.fit(X_tr, y_tr, groups=g_tr)
    cart = cart_search.best_estimator_
    proba = cart.predict_proba(X_te)
    gp = expected_gpv(proba, cart.classes_, band_mean)
    add("Decision tree (CART)", cart.predict(X_te), gp, proba[:, list(cart.classes_).index(AT_RISK)],
        {"params": cart_search.best_params_, "cv_accuracy": round(cart_search.best_score_, 4)})

    rf_search = GridSearchCV(
        RandomForestClassifier(n_estimators=300, random_state=seed, n_jobs=-1),
        {"max_depth": [6, 10], "min_samples_leaf": [10, 20, 40]},
        scoring="accuracy", cv=cv, n_jobs=-1)
    rf_search.fit(X_tr, y_tr, groups=g_tr)
    rf = rf_search.best_estimator_
    proba_rf = rf.predict_proba(X_te)
    add("Random forest", rf.predict(X_te), expected_gpv(proba_rf, rf.classes_, band_mean),
        proba_rf[:, list(rf.classes_).index(AT_RISK)],
        {"params": rf_search.best_params_, "cv_accuracy": round(rf_search.best_score_, 4)})

    detail = {"train_rows": int(len(y_tr)), "test_rows": int(len(y_te)), "cart": cart, "rf": rf,
              "rf_params": rf_search.best_params_, "y_te": y_te, "pred": rf.predict(X_te),
              "meta_te": meta_te, "gp": expected_gpv(proba_rf, rf.classes_, band_mean)}
    return out, detail


COLS = [("accuracy", "Exact band"), ("within_one_band", "Within one band"), ("macro_f1", "Macro F1"),
        ("gpv_mae", "Grade-point error"), ("sgpa_mae", "SGPA error"),
        ("student_risk_auc", "Early-warning AUC"), ("top25_flag_recall", "Caught in top 25%")]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--data", type=Path, default=ROOT / "data")
    ap.add_argument("--out", type=Path, default=ROOT / "out")
    ap.add_argument("--report", type=Path, default=ROOT / "report")
    ap.add_argument("--test-semesters", type=int, nargs="+", default=[5, 6])
    ap.add_argument("--predict-semester", type=int, default=7)
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    args.report.mkdir(parents=True, exist_ok=True)

    courses, students = load(args.data)
    n_results = sum(len(s.results) for s in students.values())
    print(f"Loaded {len(students)} students, {len(courses)} courses, {n_results} results")

    evaluation = {}
    for ts in args.test_semesters:
        rows, detail = evaluate(students, courses, ts, args.seed)
        evaluation[ts] = {"train_rows": detail["train_rows"], "test_rows": detail["test_rows"], "results": rows}
        print(f"\nHeld-out Semester {ts}: trained on {detail['train_rows']} results, tested on {detail['test_rows']}")
        print(f"{'model':48s}" + "".join(f"{c[1]:>19s}" for c in COLS))
        for r in rows:
            print(f"{r['model']:48s}" + "".join(
                f"{r[k]:>19.3f}" if isinstance(r.get(k), (int, float)) else f"{'-':>19s}" for k, _ in COLS))
        last = detail
    ts = args.test_semesters[-1]
    charts(args.report, last, ts, courses)

    # ---------------------------------------------------------- final model and predictions
    ps = args.predict_semester
    X_all, y_all, _, meta_all = dataset(students, range(2, ps))
    params = last["rf_params"]
    final = RandomForestClassifier(n_estimators=300, random_state=args.seed, n_jobs=-1, **params).fit(X_all, y_all)
    band_acc = defaultdict(list)
    for (_, _, g), b in zip(meta_all, y_all):
        band_acc[int(b)].append(GPV[g])
    band_mean = {b: float(np.mean(v)) for b, v in band_acc.items()}
    diff = dept_difficulty(students, ps)
    rows = []
    for st in students.values():
        for c in courses.values():
            if c.semester != ps or c.dept not in (st.dept, "IS") or not c.graded_here:
                continue  # not this semester's, not theirs, or graded in a later semester
            if any(r.course.idx == c.idx for r in st.results):
                continue  # already graded
            f = features(st, c, ps, diff)
            if f is None:
                continue
            x = np.array([f[k] for k in FEATURES])
            p = final.predict_proba(x.reshape(1, -1))[0]
            full = np.zeros(5)
            for cls, v in zip(final.classes_, p):
                full[int(cls)] = v
            rows.append({
                "s": st.idx, "c": c.idx, "band": BANDS[int(full.argmax())],
                "probs": {BANDS[b]: round(float(full[b]), 3) for b in range(5)},
                "gpv": round(float(sum(full[b] * band_mean.get(b, 0.0) for b in range(5))), 2),
                "risk": round(float(full[AT_RISK]), 3),
                "reasons": feature_reasons(f, c.dept),
            })
    print(f"\nSemester {ps} predictions: {len(rows)} (student, course) pairs for "
          f"{len({r['s'] for r in rows})} students")

    model_info = {
        "name": "grade-band-forest",
        "algorithm": "Random forest (300 trees), scikit-learn " + __import__("sklearn").__version__,
        "trained_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "params": params,
        "features": [LABELS[f] for f in FEATURES],
        "train_rows": int(len(y_all)),
        "evaluation": {str(k): v for k, v in evaluation.items()},
        "bands": BANDS,
        "band_mean_gpv": {BANDS[b]: round(v, 3) for b, v in band_mean.items()},
    }
    (args.report / "metrics.json").write_text(json.dumps(model_info, indent=2))
    write_report(args.report / "report.md", model_info, n_results, len(students))
    write_payload(args.out / "predictions.json", args.data, model_info, rows, ps)
    print("Wrote", args.report / "metrics.json", args.report / "report.md", "and", args.out / "predictions.json")


def charts(report: Path, d: dict, ts: int, courses) -> None:
    cm = confusion_matrix(d["y_te"], d["pred"], labels=range(5))
    fig, ax = plt.subplots(figsize=(5.6, 4.6))
    ax.imshow(cm, cmap="Blues")
    ax.set_xticks(range(5), BANDS, rotation=30, ha="right")
    ax.set_yticks(range(5), BANDS)
    ax.set_xlabel("Predicted band")
    ax.set_ylabel("Actual band")
    ax.set_title(f"Random forest: Semester {ts} (held out)")
    for i in range(5):
        for j in range(5):
            ax.text(j, i, cm[i, j], ha="center", va="center",
                    color="white" if cm[i, j] > cm.max() / 2 else "#111827", fontsize=9)
    fig.tight_layout()
    fig.savefig(report / "confusion_matrix.png", dpi=160)
    plt.close(fig)

    cart = d["cart"]
    imp = sorted(zip(d["rf"].feature_importances_, FEATURES), reverse=True)
    imp = [(v, f) for v, f in imp if v > 0.005][:8]
    fig, ax = plt.subplots(figsize=(6, 3.6))
    ax.barh([LABELS[f] for _, f in imp][::-1], [v for v, _ in imp][::-1], color="#2563EB")
    ax.set_xlabel("Importance in the random forest")
    ax.spines[["top", "right"]].set_visible(False)
    fig.tight_layout()
    fig.savefig(report / "feature_importance.png", dpi=160)
    plt.close(fig)

    sg = sgpa_forecast(d["meta_te"], d["gp"], courses)
    f_, a_ = np.array([v[0] for v in sg.values()]), np.array([v[1] for v in sg.values()])
    fig, ax = plt.subplots(figsize=(4.8, 4.6))
    ax.scatter(a_, f_, s=14, alpha=0.7, color="#2563EB")
    lo = min(a_.min(), f_.min()) - 0.1
    ax.plot([lo, 4.05], [lo, 4.05], color="#9CA3AF", lw=1)
    ax.set_xlabel(f"Actual Semester {ts} SGPA")
    ax.set_ylabel("Forecast SGPA")
    ax.set_title("SGPA forecast, one dot per student")
    ax.spines[["top", "right"]].set_visible(False)
    fig.tight_layout()
    fig.savefig(report / "sgpa_forecast.png", dpi=160)
    plt.close(fig)

    fig, ax = plt.subplots(figsize=(13, 6))
    plot_tree(cart, max_depth=2, feature_names=[LABELS[f] for f in FEATURES],
              class_names=[BANDS[int(c)] for c in cart.classes_], filled=True, impurity=False,
              proportion=True, fontsize=8, ax=ax)
    fig.tight_layout()
    fig.savefig(report / "tree_top.png", dpi=150)
    plt.close(fig)


def write_report(path: Path, model: dict, n_results: int, n_students: int) -> None:
    """The evaluation as a table a reader can check, for the docs and the slides."""
    lines = [
        "# Grade prediction: evaluation",
        "",
        f"Generated by `ml/train.py` on {model['trained_at'][:10]}. {n_results:,} graded results of "
        f"{n_students} students. Bands: {', '.join(model['bands'])}.",
        "",
        f"Model deployed: **{model['algorithm']}**, parameters `{json.dumps(model['params'])}`, "
        f"trained on {model['train_rows']:,} results (Semesters 2-6) to predict Semester 7.",
        "",
    ]
    for ts, ev in model["evaluation"].items():
        lines += [f"## Held-out Semester {ts}", "",
                  f"Trained on {ev['train_rows']:,} results from earlier semesters; tested on {ev['test_rows']:,}.", "",
                  "| Model | " + " | ".join(c[1] for c in COLS) + " |",
                  "|---|" + "---|" * len(COLS)]
        for r in ev["results"]:
            cells = [f"{r[k]:.3f}" if isinstance(r.get(k), (int, float)) else "-" for k, _ in COLS]
            lines.append(f"| {r['model']} | " + " | ".join(cells) + " |")
        lines.append("")
    lines += [
        "## Reading the numbers",
        "",
        "- **Exact band** is the share of course grades whose band was predicted exactly; **within one band** allows a neighbouring band.",
        "- **Grade-point error** and **SGPA error** are mean absolute errors on the 0-4 scale.",
        "- **Early-warning AUC** ranks students by their chance of at least one R or F in the semester (0.5 is chance, 1.0 is perfect); "
        "**caught in top 25%** is the share of students who did get an R or F who were among the quarter flagged.",
        "",
        "The proposal chose a decision tree (CART). A single tree proved unstable here, and its early warning ranked "
        "students worse than their own average does, so, following the proposal's improvement strategy, the deployed "
        "model is a random forest, which matches or edges the baselines. With grade history alone the student's own "
        "average is a strong baseline: the data holds one cohort, so no course had been taken before the semester it "
        "is tested on, and there are no mid-semester, CA or attendance marks yet. Those in-semester signals are the "
        "next features to add.",
        "",
        "Charts: `confusion_matrix.png`, `feature_importance.png` and `sgpa_forecast.png` are the random forest on the "
        "last held-out semester; `tree_top.png` is the top of the CART tree, for reading how a tree splits.",
    ]
    path.write_text("\n".join(lines) + "\n")


def write_payload(path: Path, data: Path, model: dict, rows: list[dict], semester: int) -> None:
    """What ml/load_predictions.py sends to ml_load_predictions: the model, its
    predictions, and the fingerprints of the student and course lists the
    numbering came from, so the database can refuse a stale load."""
    fp = json.loads((data / "fingerprint.json").read_text())
    payload = {
        "model": model,
        "semester": semester,
        "students_fingerprint": fp["students"],
        "courses_fingerprint": fp["courses"],
        "rows": rows,
    }
    path.write_text(json.dumps(payload, separators=(",", ":")))


if __name__ == "__main__":
    main()
