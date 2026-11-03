"""Attendance anomaly detection for PES: simulate, train, evaluate, export.

What it does
------------
Every live sign-in to a lecture records how old the code was, how far the
phone was from the hall, which device signed in, and whether the student
answered the surprise presence checks. A proxy sign-in (someone signing in a
student who is not there) tends to leave an unusual combination of these: an
old code relayed by photo, no location or a far one, a device the student has
never used, a device that has signed in other students, a presence check
missed. Each signal alone has innocent causes (indoor GPS drifts, people deny
location, phones get replaced), so a single rule either misses proxies or
raises false alarms.

An Isolation Forest scores how unusual each sign-in's combination is. It is
unsupervised: it learns what normal sign-ins look like and needs no labelled
cases of cheating, which PES will never have in quantity. A high score is a
flag for the lecturer to review, never a decision.

Why a simulation
----------------
PES has recorded only a handful of live sign-ins so far, so there is nothing
real to learn from or to test on. The model is trained and tested on
simulated lectures whose behaviour is set out below (SIM), with proxy sign-ins
injected so that recall, precision and false alarms per lecture can be
measured, as the project plan proposed. The features are computed exactly as
the database computes them (ml_checkin_features), so the same model scores
real sign-ins. Once a semester of real sign-ins exists, export them
(ml/export_checkins.sql) and retrain with --real.

Usage
-----
    python ml/attendance_anomaly.py              # writes ml/report/attendance and ml/out/anomaly_model.json
    python ml/attendance_anomaly.py --real ml/data/checkins.csv
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
import matplotlib.ticker  # noqa: E402
import numpy as np  # noqa: E402
from sklearn.ensemble import IsolationForest  # noqa: E402
from sklearn.metrics import roc_auc_score  # noqa: E402

ROOT = Path(__file__).resolve().parent

FEATURES = [
    "code_age",             # how old the code was, in rotations (0-2; the database refuses older)
    "distance",             # ln(1 + distance from the hall / its radius), capped at 6 (0 if unknown)
    "location_withheld",    # no location this time, weighted by how often the student usually sends one
    "first_use_of_device",  # 1 if a student with earlier sign-ins has never used this device before
    "shared_device",        # other students this device signed in before (capped at 3)
    "missed_checks",        # share of presence checks after the sign-in left unanswered
]
LABELS = {
    "code_age": "Age of the code",
    "distance": "Distance from the hall",
    "location_withheld": "Location withheld, unusually",
    "first_use_of_device": "First sign-in from this device",
    "shared_device": "Device used by other students",
    "missed_checks": "Presence checks missed",
}
HISTORY = 20  # earlier sign-ins looked at, as in the database
# A sign-in this far from the lecture is always listed, whatever the model
# scores: no hall is that big, and indoor GPS errs by a few hundred metres at
# most. The model is for the subtler combinations.
FAR_LIMIT_M = 1000

# ---------------------------------------------------------------- the simulation's assumptions
SIM = {
    "students_per_class": (25, 60),
    "lectures": 30,
    "rotate_seconds": 10,
    "radius_m": 250,
    "lecture_has_location": 0.95,      # the lecturer's own location was allowed
    "attend": (8, 2),                  # Beta: each student's usual attendance (about 80%)
    "never_location": 0.12,            # students whose phone never shares location
    "location_slip": 0.04,             # a usually-sharing phone sends none this time
    "gps_spread_m": 25,                # half-normal spread inside the hall
    "gps_glitch": 0.05,                # indoor GPS jumps 100-600 m
    "previous_code": 0.06,             # scanned just as the code changed
    "latency_s": 1.2,                  # mean scan-to-server delay
    "new_phone_per_lecture": 0.015,    # new phone or cleared storage; the new id stays
    "borrowed_phone": 0.004,           # signs in on a friend's phone (another lecture)
    "presence_check": 0.4,             # lectures with one presence check
    "answer_check": 0.93,              # an honest student answers it
    "proxy_rate": 0.06,                # absences covered by a proxy sign-in
    "proxy_types": {"photo": 0.4, "second_device": 0.4, "own_phone": 0.2},
}
TYPE_NAMES = {
    "photo": "Code relayed by photo",
    "second_device": "Second browser or phone",
    "own_phone": "Their own phone, carried in",
}


@dataclass
class Student:
    sid: int
    attend: float
    shares_location: bool
    device: str
    history: list = field(default_factory=list)  # earlier sign-ins: (device, sent_location, lecture_had_location)


def simulate(rng: np.random.Generator, n_classes: int, start_id: int = 0) -> list[dict]:
    """Sign-ins for n_classes classes over a semester. Each row carries the raw
    fields the database stores, the features as the database computes them,
    and the truth (proxy or not), which the model never sees."""
    rows: list[dict] = []
    device_owner: dict[str, set] = defaultdict(set)  # device -> students it signed in, so far
    sid = start_id
    dev_n = 0

    def new_device() -> str:
        nonlocal dev_n
        dev_n += 1
        return f"d{start_id}-{dev_n}"

    for cls in range(n_classes):
        size = int(rng.integers(*SIM["students_per_class"]))
        students = []
        for _ in range(size):
            students.append(Student(sid, float(rng.beta(*SIM["attend"])),
                                    bool(rng.random() > SIM["never_location"]), new_device()))
            sid += 1
        spare_devices = [new_device() for _ in range(3)]  # a few second phones/tablets in the class
        for lec in range(SIM["lectures"]):
            rotate = SIM["rotate_seconds"]
            radius = SIM["radius_m"]
            has_loc = bool(rng.random() < SIM["lecture_has_location"])
            check_at = float(rng.uniform(2, 6)) if rng.random() < SIM["presence_check"] else None
            lecture_rows = []
            for st in students:
                present = rng.random() < st.attend
                proxy = None
                if not present and rng.random() < SIM["proxy_rate"]:
                    proxy = rng.choice(list(SIM["proxy_types"]), p=list(SIM["proxy_types"].values()))
                if not present and proxy is None:
                    continue
                at = float(min(rng.exponential(1.4), 6.5))  # minutes after the register opened
                # ---- what the sign-in looks like
                if proxy is None:
                    if rng.random() < SIM["new_phone_per_lecture"]:
                        st.device = new_device()
                    device = st.device
                    if rng.random() < SIM["borrowed_phone"]:
                        device = students[int(rng.integers(len(students)))].device
                    age = rng.uniform(0, 1) + rng.exponential(SIM["latency_s"]) / rotate
                    if rng.random() < SIM["previous_code"]:
                        age += 1.0
                    sends = st.shares_location and rng.random() > SIM["location_slip"]
                    dist = (abs(rng.normal(0, SIM["gps_spread_m"])) +
                            (rng.uniform(100, 600) if rng.random() < SIM["gps_glitch"] else 0))
                    answers = rng.random() < SIM["answer_check"]
                elif proxy == "photo":       # the absent student scans a photo sent from the hall
                    device = st.device
                    age = rng.uniform(0.6, 2.0)
                    sends = st.shares_location and rng.random() < 0.45
                    dist = rng.uniform(2_000, 60_000)
                    answers = rng.random() < 0.35
                elif proxy == "second_device":  # a friend in the hall, on a private window or spare phone
                    device = new_device() if rng.random() < 0.6 else spare_devices[int(rng.integers(3))]
                    age = rng.uniform(0, 1) + rng.exponential(SIM["latency_s"]) / rotate
                    sends = rng.random() > 0.1
                    dist = abs(rng.normal(0, SIM["gps_spread_m"]))
                    answers = rng.random() < 0.6
                else:                         # the student's own phone, carried in by a friend
                    device = st.device
                    age = rng.uniform(0, 1) + rng.exponential(SIM["latency_s"]) / rotate
                    sends = st.shares_location and rng.random() > SIM["location_slip"]
                    dist = abs(rng.normal(0, SIM["gps_spread_m"]))
                    answers = rng.random() < 0.9
                age = float(min(age, 1.999))   # anything older is refused by the database
                lecture_rows.append(dict(student=st, device=device, age=age, sends=bool(sends),
                                         dist=float(dist), at=at, answers=bool(answers), proxy=proxy))
            # one device signs in one student per lecture (the database refuses a second)
            seen_dev = set()
            kept = []
            for r in sorted(lecture_rows, key=lambda r: r["at"]):
                if r["device"] in seen_dev:
                    continue
                seen_dev.add(r["device"])
                kept.append(r)
            # ---- features, as ml_checkin_features computes them
            for r in kept:
                st = r["student"]
                hist = st.history[-HISTORY:]
                no_loc = has_loc and not r["sends"]
                x = feature_vector(
                    code_age=r["age"],
                    distance=(min(math.log1p(r["dist"] / radius), 6.0) if has_loc and r["sends"] else 0.0),
                    no_location=no_loc,
                    history=hist,
                    device=r["device"],
                    shared=len(device_owner[r["device"]] - {st.sid}),
                    checks_after=(1 if check_at is not None and check_at > r["at"] else 0),
                    answered=(1 if check_at is not None and check_at > r["at"] and r["answers"] else 0),
                )
                rows.append(dict(x=x, proxy=r["proxy"], cls=cls, lecture=(start_id, cls, lec),
                                 present=(r["proxy"] is None),
                                 far=bool(has_loc and r["sends"] and r["dist"] > radius), no_loc=bool(no_loc),
                                 very_far=bool(has_loc and r["sends"] and r["dist"] >= FAR_LIMIT_M)))
            # ---- history only after the lecture, as the database sees earlier lectures only
            for r in kept:
                st = r["student"]
                st.history.append((r["device"], r["sends"], has_loc))
                device_owner[r["device"]].add(st.sid)
    return rows


def feature_vector(code_age, distance, no_location, history, device, shared, checks_after, answered) -> list[float]:
    """The features, exactly as ml_checkin_features computes them in the database."""
    with_loc = [h for h in history if h[2]]
    usually_sends = (sum(1 for h in with_loc if h[1]) / len(with_loc)) if with_loc else 0.5
    withheld = usually_sends if no_location else 0.0
    first_use = 1.0 if device and len(history) >= 2 and all(h[0] != device for h in history) else 0.0
    missed = ((checks_after - answered) / checks_after) if checks_after else 0.0
    return [float(code_age), float(distance), float(withheld), first_use,
            float(min(shared, 3)), float(missed)]


# ---------------------------------------------------------------- rules PES already has
FAR = math.log1p(1.0)  # the distance feature's value at the edge of the hall's radius

def rule_flags(rows: list[dict]) -> np.ndarray:
    """What the register flags today: far from the hall, or no location."""
    return np.array([r["far"] or r["no_loc"] for r in rows])


def any_signal(X: np.ndarray, rows: list[dict]) -> np.ndarray:
    """Every signal as its own rule: the obvious alternative to a model."""
    f = {k: X[:, i] for i, k in enumerate(FEATURES)}
    return (rule_flags(rows) | (f["code_age"] >= 1.0) | (f["first_use_of_device"] > 0) |
            (f["shared_device"] >= 1) | (f["missed_checks"] > 0))


def evaluate(name: str, flagged: np.ndarray, rows: list[dict], score: np.ndarray | None = None) -> dict:
    y = np.array([r["proxy"] is not None for r in rows])
    types = np.array([r["proxy"] or "" for r in rows])
    lectures = len({r["lecture"] for r in rows})
    tp = int((flagged & y).sum())
    fp = int((flagged & ~y).sum())
    out = {
        "model": name,
        "recall": tp / max(1, int(y.sum())),
        "precision": tp / max(1, tp + fp),
        "false_alarms_per_lecture": fp / lectures,
        "flags_per_lecture": int(flagged.sum()) / lectures,
        "proxies": int(y.sum()),
        "honest": int((~y).sum()),
        "lectures": lectures,
        "by_type": {t: float((flagged & (types == t)).sum() / max(1, (types == t).sum())) for t in SIM["proxy_types"]},
    }
    if score is not None:
        out["auc"] = float(roc_auc_score(y, score))
    return {k: (round(v, 4) if isinstance(v, float) else v) for k, v in out.items()}


# ---------------------------------------------------------------- export, for the database
def average_path_length(n: int) -> float:
    if n <= 1:
        return 0.0
    if n == 2:
        return 1.0
    return 2.0 * (math.log(n - 1) + np.euler_gamma) - 2.0 * (n - 1) / n


def export_trees(model: IsolationForest) -> list[dict]:
    trees = []
    for est, feats in zip(model.estimators_, model.estimators_features_):
        t = est.tree_
        assert list(feats) == list(range(len(FEATURES))), "every tree must see every feature, in order"
        trees.append({
            "f": [int(v) for v in t.feature],
            "t": [float(v) for v in t.threshold],
            "l": [int(v) for v in t.children_left],
            "r": [int(v) for v in t.children_right],
            "n": [int(v) for v in t.n_node_samples],
        })
    return trees


def score_like_database(trees: list[dict], c_norm: float, x: list[float]) -> float:
    """The scoring the database does (ml_isolation_score), to check the export."""
    xs = np.array(x, dtype=np.float32).astype(np.float64)
    total = 0.0
    for tr in trees:
        node, depth = 0, 0
        while tr["l"][node] != -1:
            node = tr["l"][node] if xs[tr["f"][node]] <= tr["t"][node] else tr["r"][node]
            depth += 1
        total += depth + average_path_length(tr["n"][node])
    return 2.0 ** (-(total / len(trees)) / c_norm)


def charts(report: Path, scores: np.ndarray, rows: list[dict], threshold: float, results: list[dict]) -> None:
    y = np.array([r["proxy"] is not None for r in rows])
    fig, ax = plt.subplots(figsize=(6.4, 3.6))
    bins = np.linspace(min(scores.min(), threshold) - 0.01, scores.max() + 0.01, 45)
    ax.hist(scores[~y], bins=bins, color="#94A3B8", label="Honest sign-ins", density=True)
    ax.hist(scores[y], bins=bins, color="#C41E3A", alpha=0.75, label="Proxy sign-ins", density=True)
    ax.axvline(threshold, color="#111827", lw=1.2, ls="--")
    ax.text(threshold, ax.get_ylim()[1] * 0.92, "  flag for review", fontsize=9, color="#111827")
    ax.set_xlabel("Anomaly score")
    ax.set_yticks([])
    ax.legend(frameon=False, fontsize=9)
    ax.spines[["top", "right", "left"]].set_visible(False)
    fig.tight_layout()
    fig.savefig(report / "score_distribution.png", dpi=160)
    plt.close(fig)

    names = [r["model"] for r in results]
    colours = ["#CBD5E1", "#94A3B8", "#64748B", "#334155"]
    fig, axes = plt.subplots(1, 2, figsize=(9.2, 3.9))
    types = list(SIM["proxy_types"])
    short = {"photo": "Code relayed\nby photo", "second_device": "Second browser\nor phone",
             "own_phone": "Their own phone,\ncarried in"}
    w = 0.2
    for i, r in enumerate(results):
        axes[0].bar(np.arange(len(types)) + (i - 1.5) * w, [r["by_type"][t] for t in types], w,
                    color=colours[i], label=r["model"])
    axes[0].set_xticks(range(len(types)), [short[t] for t in types], fontsize=8)
    axes[0].set_ylim(0, 1)
    axes[0].yaxis.set_major_formatter(matplotlib.ticker.PercentFormatter(1.0))
    axes[0].set_title("Proxies caught, by kind", fontsize=10)
    fig.legend(*axes[0].get_legend_handles_labels(), loc="lower center", ncol=4, frameon=False, fontsize=8)
    axes[1].bar(range(len(names)), [r["false_alarms_per_lecture"] for r in results], color=colours)
    axes[1].set_xticks(range(len(names)), [n.replace(" (far or no location)", "").replace("Every signal as a rule", "Every signal").replace("Isolation Forest", "Forest") for n in names])
    for i, r in enumerate(results):
        axes[1].text(i, r["false_alarms_per_lecture"], f"{r['false_alarms_per_lecture']:.1f}", ha="center", va="bottom", fontsize=9)
    axes[1].set_title("Honest students flagged, per lecture", fontsize=10)
    axes[1].tick_params(axis="x", labelsize=8)
    for a in axes:
        a.spines[["top", "right"]].set_visible(False)
    fig.tight_layout(rect=(0, 0.08, 1, 1))
    fig.savefig(report / "caught_and_false_alarms.png", dpi=160)
    plt.close(fig)


def write_report(path: Path, info: dict) -> None:
    ev = info["evaluation"]
    lines = [
        "# Attendance anomaly detection: evaluation",
        "",
        f"Generated by `ml/attendance_anomaly.py` on {info['trained_at'][:10]}. Trained on {info['train_rows']:,} "
        f"simulated sign-ins; the flag threshold was set on {ev['validation_rows']:,} more; tested on "
        f"{ev['test']['rows']:,} sign-ins in {ev['test']['lectures']} lectures it never saw, "
        f"{ev['test']['proxies']} of them proxies.",
        "",
        f"Model deployed: **{info['algorithm']}**. A sign-in is flagged for review when its anomaly score is "
        f"at least {info['threshold']:.3f} (set so that about {ev['target_honest_flag_rate']:.1%} of honest "
        f"sign-ins in the validation lectures were flagged), or when it was made {FAR_LIMIT_M:,} m or more from "
        "the lecture: the forest ranks one far-off signal about as unusual as two mild ones together, and a "
        "sign-in kilometres away should always be seen.",
        "",
        "| Approach | Proxies caught | Precision | Honest students flagged per lecture | " +
        " | ".join(TYPE_NAMES[t] for t in SIM["proxy_types"]) + " | AUC |",
        "|---|---|---|---|" + "---|" * len(SIM["proxy_types"]) + "---|",
    ]
    for r in ev["test"]["results"]:
        lines.append(f"| {r['model']} | {r['recall']:.0%} | {r['precision']:.0%} | {r['false_alarms_per_lecture']:.2f} | " +
                     " | ".join(f"{r['by_type'][t]:.0%}" for t in SIM["proxy_types"]) +
                     f" | {r['auc']:.3f} |" if "auc" in r else
                     f"| {r['model']} | {r['recall']:.0%} | {r['precision']:.0%} | {r['false_alarms_per_lecture']:.2f} | " +
                     " | ".join(f"{r['by_type'][t]:.0%}" for t in SIM["proxy_types"]) + " | – |")
    lines += [
        "",
        "## Reading the numbers",
        "",
        "- **Proxies caught** is the share of injected proxy sign-ins flagged; **precision** the share of flags that were proxies.",
        "- **Honest students flagged per lecture** is the false alarms a lecturer would review in an average lecture.",
        "- *Their own phone, carried in* leaves no trace in the data: the right phone, in the room, answering checks. No method here can catch it; it is in the test so the recall is honest.",
        "",
        "Every number comes from a simulation (its assumptions are `SIM` in the script), because PES has almost no real "
        "live sign-ins yet. It shows the method works under those assumptions, not how often students cheat. Once a "
        "semester of real sign-ins exists, retrain with `--real` and check the flags against what lecturers find.",
        "",
        "Charts: `score_distribution.png` (honest and proxy scores, with the threshold) and "
        "`caught_and_false_alarms.png` (each approach on the test lectures).",
    ]
    path.write_text("\n".join(lines) + "\n")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--out", type=Path, default=ROOT / "out")
    ap.add_argument("--report", type=Path, default=ROOT / "report" / "attendance")
    ap.add_argument("--real", type=Path, help="real sign-in features from ml/export_checkins.sql, added to training")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--honest-flag-rate", type=float, default=0.015)
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    args.report.mkdir(parents=True, exist_ok=True)

    train = simulate(np.random.default_rng(args.seed), n_classes=8, start_id=0)
    valid = simulate(np.random.default_rng(args.seed + 1), n_classes=6, start_id=100_000)
    test = simulate(np.random.default_rng(args.seed + 2), n_classes=24, start_id=200_000)
    X_train = np.array([r["x"] for r in train])
    if args.real and args.real.exists():
        real = np.array([[float(v) for v in line.split(",")] for line in args.real.read_text().split() if line])
        X_train = np.vstack([X_train, real])
        print(f"Added {len(real)} real sign-ins to training")
    X_valid = np.array([r["x"] for r in valid])
    X_test = np.array([r["x"] for r in test])
    print(f"Simulated {len(train)} training, {len(valid)} validation and {len(test)} test sign-ins")

    model = IsolationForest(n_estimators=100, max_samples=512, random_state=args.seed).fit(X_train)
    s_valid = -model.score_samples(X_valid)
    honest_valid = np.array([r["proxy"] is None for r in valid])
    threshold = float(np.quantile(s_valid[honest_valid], 1 - args.honest_flag_rate))
    s_test = -model.score_samples(X_test)

    results = [
        evaluate("Rules today (far or no location)", rule_flags(test), test),
        evaluate("Every signal as a rule", any_signal(X_test, test), test),
        evaluate("Isolation Forest", s_test >= threshold, test, s_test),
        evaluate(f"Isolation Forest + {FAR_LIMIT_M // 1000} km rule",
                 (s_test >= threshold) | np.array([r["very_far"] for r in test]), test, s_test),
    ]
    for r in results:
        print(f"{r['model']:36s} caught {r['recall']:.0%}  precision {r['precision']:.0%}  "
              f"false alarms/lecture {r['false_alarms_per_lecture']:.2f}  by type " +
              ", ".join(f"{t} {v:.0%}" for t, v in r["by_type"].items()) +
              (f"  AUC {r['auc']:.3f}" if "auc" in r else ""))

    charts(args.report, s_test, test, threshold, results)

    trees = export_trees(model)
    c_norm = average_path_length(model.max_samples_)
    rng = np.random.default_rng(1)
    picks = rng.choice(len(X_test), 40, replace=False)
    checks = [{"x": [float(v) for v in X_test[i]], "score": float(s_test[i])} for i in picks]
    for c in checks:  # the export must score exactly as sklearn does
        assert abs(score_like_database(trees, c_norm, c["x"]) - c["score"]) < 1e-9, c

    info = {
        "name": "attendance-anomaly-forest",
        "algorithm": f"Isolation Forest (100 trees), scikit-learn {__import__('sklearn').__version__}",
        "trained_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "params": {"n_estimators": 100, "max_samples": int(model.max_samples_), "seed": args.seed,
                   "far_limit_m": FAR_LIMIT_M},
        "features": FEATURES,
        "feature_labels": [LABELS[f] for f in FEATURES],
        "train_rows": int(len(X_train)),
        "threshold": round(threshold, 6),
        "c_norm": c_norm,
        "simulation": SIM,
        "evaluation": {
            "validation_rows": len(valid),
            "target_honest_flag_rate": args.honest_flag_rate,
            "test": {"rows": len(test), "lectures": results[0]["lectures"], "proxies": results[0]["proxies"],
                     "results": results},
        },
    }
    (args.report / "metrics.json").write_text(json.dumps(info, indent=2))
    write_report(args.report / "report.md", info)
    payload = {"model": info, "trees": trees, "checks": checks}
    (args.out / "anomaly_model.json").write_text(json.dumps(payload, separators=(",", ":")))
    size = (args.out / "anomaly_model.json").stat().st_size
    print(f"Wrote {args.report}/report.md, metrics.json, charts, and {args.out}/anomaly_model.json ({size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
