# Machine learning

PES has two machine-learning features, each trained outside the app and loaded into the database with a single-use
token:

- [Grade prediction](#grade-prediction): each student's likely grade band per course next semester, and early
  warnings for mentors.
- [Attendance anomaly detection](#attendance-anomaly-detection): live sign-ins whose pattern is unusual, for the
  lecturer to review.

## Grade prediction

A model trained on the faculty's past results predicts, for each student and each
course of the coming semester, the grade band they are likely to get: A+/A, A-/B+, B/B-, C+/C or R/F. From these
it forecasts each student's SGPA and their chance of at least one R or F.

Who sees what:

| Who | Where | What |
|---|---|---|
| Student | Graduation Planner, Current Standing | Likely band per course and a forecast SGPA. No R or F figures; a course whose likeliest band is R/F says "Needs attention" and points to the mentor. |
| Mentor | Academic Mentoring | Early warnings: mentees with an above-usual chance of an R or F, likeliest first, with the courses to watch. On a mentee's page, their full forecast. |
| Head of department, department admin, super admin | `get_student_grade_forecast` | A student's full forecast, for anyone who may see their record. |

The levels follow the faculty's own record: 5% of past course grades were an R or F, and 22% of students got at
least one in a semester. A mentee is **Watch** from a 25% chance, **High** from 40% (about the top tenth), and a
course is listed to watch from a 10% chance (twice the usual rate).

### How it works

1. **Export** the results, anonymised (`export_dataset.sql`). Students and courses become numbers; no id, name or
   index number leaves the database. Each course also says whether it is graded in its own semester: the earlier
   part of a course taught over two semesters (the Engineering Project's Semester 7 part) is never predicted.
2. **Train and evaluate** (`train.py`). Features are what was known before the semester: the student's average so
   far, last semester's average and the change, their average in the course's department, how uneven their grades
   are, earlier R/F grades and deferrals, the share of A grades, and the course's credits, type and department.
3. **Load** the predictions (`load_predictions.py`) into `ml_models` and `ml_grade_predictions`, through
   `ml_load_predictions`, which maps the numbers back to ids inside the database.

Evaluation is rolling-origin, so the model never sees the semester it is tested on: trained on Semesters 2–4 and
tested on 5, then trained on 2–5 and tested on 6. Every model is compared with baselines a mentor could work out by
hand. The full table is in [`report/report.md`](report/report.md); on Semester 6:

| Model | Exact band | Within one band | SGPA error | Early-warning AUC |
|---|---|---|---|---|
| Most common band | 0.345 | 0.906 | 0.390 | – |
| Student's own average | 0.392 | 0.879 | 0.289 | 0.722 |
| Decision tree (CART) | 0.380 | 0.787 | 0.288 | 0.690 |
| **Random forest (deployed)** | 0.378 | 0.793 | **0.255** | **0.759** |

The proposal chose a decision tree. A single tree proved unstable, so following the proposal's improvement strategy
the deployed model is a random forest (300 trees, depth 10, at least 10 results per leaf, tuned by grouped
cross-validation). On Semester 6 it forecasts SGPA best and ranks students for early warning better than their own
average does. On Semester 5, trained on less data, the student's own average did better on both: the forest gains
most from more data, and the deployed model is trained on the most (6,103 results).
With grades alone and one cohort, a student's own average is a strong baseline. Mid-semester, CA and attendance marks
are the next features to add, and should lift every number.

The full explanation, with the charts, is the study guide `docs/PES_Guide_ML_Grade_Prediction.docx`.

Charts in `report/`: `confusion_matrix.png`, `feature_importance.png`, `sgpa_forecast.png` (random forest, Semester 6),
and `tree_top.png` (the top of the CART tree).

### Running it each semester

Once a semester's results are published and before the next one starts:

```bash
python -m venv .venv && . .venv/bin/activate
pip install -r ml/requirements.txt

# 1. Export: run ml/export_dataset.sql in the Supabase SQL editor and save each
#    row's content as ml/data/<file> (courses.txt, students.txt, results.txt,
#    fingerprint.json).

# 2. Train, evaluate and predict the next semester (about 3 minutes).
python ml/train.py --test-semesters 5 6 --predict-semester 7

# 3. Load. Make a one-hour, single-use token and run the SQL line it prints in
#    the SQL editor (only the token's hash is stored), then load with it.
python ml/load_predictions.py --new-token
ML_LOAD_TOKEN=<token> python ml/load_predictions.py
```

Move `--test-semesters` and `--predict-semester` on by one each semester. A load replaces the active model and its
predictions; earlier models stay in `ml_models`, inactive. If a student or course was added or removed after the
export, the load is refused, because the numbering would no longer match: export and train again.

`ml/data/` and `ml/out/` are git-ignored, so neither the export nor the predictions are committed.

## Attendance anomaly detection

A live register shows a code that changes every few seconds, and students sign in by scanning it. A friend can still
sign in a student who is not there: by relaying a photo of the code, or from a second browser or phone. Each leaves
traces (an old code, a phone far from the hall or sending no location, a device the student has never used, a device
that has signed in other students, presence checks missed), but each trace also has innocent causes, so a rule on any
one of them either misses proxies or buries the lecturer in false alarms.

An **Isolation Forest** (100 trees, scikit-learn) learns what ordinary sign-ins look like from six signals and scores
how unusual each one's combination is. It is unsupervised, so it needs no labelled cases of cheating. A sign-in is
listed for review when its score is at least 0.626, or when it was made 1 km or more from the lecture.

| Who | Where | What |
|---|---|---|
| The course's lecturer, head of department, department admin, super admin | Attendance, under the lecture's register | "Sign-ins to review": the unusual sign-ins of that lecture, most unusual first, each with what was unusual about it. |
| Student | – | Nothing. A flag is a reason for the lecturer to look, never a mark: nothing here changes attendance. |

The model is scored **inside the database**: its trees are stored in `ml_isolation_trees`, and
`ml_checkin_features` computes the six signals from what the register already records, so a sign-in is checked the
moment the list is opened, with no server to run.

### How well it works

PES has recorded only a handful of live sign-ins, so the model is trained and tested on simulated lectures with
proxy sign-ins injected (the assumptions are `SIM` in `attendance_anomaly.py`). On 720 test lectures, 345 proxies
among 23,052 sign-ins:

| Approach | Proxies caught | Flags that were proxies | Honest students flagged per lecture |
|---|---|---|---|
| Rules today (far or no location) | 44% | 4% | 5.85 |
| Every signal as a rule | 80% | 3% | 11.65 |
| Isolation Forest | 39% | 28% | 0.49 |
| **Isolation Forest + 1 km rule (deployed)** | **41%** | **29%** | **0.49** |

It catches about half of the photo and second-device proxies while flagging one honest student every two lectures;
the rules flag six to twelve. A proxy on the student's own phone, carried into the room, leaves no trace and is not
caught by any method here. On the real sign-ins so far, the one made 16.2 km from its lecture is listed and the one
268 m away is not. The full table is in [`report/attendance/report.md`](report/attendance/report.md), and the study
guide is `docs/PES_Guide_ML_Attendance_Anomaly.docx`.

### Retraining with real lectures

Once a semester of live registers has been recorded:

```bash
# 1. Run ml/export_checkins.sql in the Supabase SQL editor and save the result as
#    ml/data/checkins.csv (six numbers per sign-in, nothing else).

# 2. Train on the simulation plus the real sign-ins, and evaluate.
python ml/attendance_anomaly.py --real ml/data/checkins.csv

# 3. Load, with a single-use token as above.
python ml/load_predictions.py --new-token
ML_LOAD_TOKEN=<token> python ml/load_predictions.py --anomaly
```

The loader sends 40 sample sign-ins with the scores scikit-learn gave them; the database scores them with the
stored trees and refuses the load unless every score matches to six decimal places. A load replaces the active
model; earlier ones stay in `ml_models`, inactive.

## Files

| File | |
|---|---|
| `export_dataset.sql` | Grade prediction: the anonymised training data, as rows to save into `ml/data/`. |
| `train.py` | Grade prediction: features, evaluation against baselines, the report and charts, and the predictions (`ml/out/predictions.json`). |
| `attendance_anomaly.py` | Attendance anomalies: the simulation, the six signals, the Isolation Forest, its evaluation and charts, and the model as `ml/out/anomaly_model.json`. |
| `export_checkins.sql` | Attendance anomalies: the six signals of every real sign-in, with nothing else, for `--real`. |
| `load_predictions.py` | Makes a load token; sends the predictions to `ml_load_predictions`, or with `--anomaly` the model to `ml_load_anomaly_model`. Standard library only. |
| `report/` | The latest grade-prediction evaluation: `report.md`, `metrics.json` and the charts. |
| `report/attendance/` | The latest attendance-anomaly evaluation: `report.md`, `metrics.json` and the charts. |
| `requirements.txt` | The Python libraries both scripts need. |

Grade prediction: database side `supabase/migrations/20261102185644_grade_predictions_and_the_model_behind_them.sql`
and `20261102190702_early_warning_levels_and_a_students_own_forecast.sql`; app side `pes_app/src/lib/gradeForecast.ts`
and `pes_app/src/app/components/forecast/GradeForecast.tsx`.

Attendance anomalies: database side `supabase/migrations/20261103041134_sign_ins_worth_a_second_look.sql` and
`20261103041416_a_sign_in_kilometres_away_is_always_listed.sql`; app side `pes_app/src/lib/checkinReview.ts` and
`pes_app/src/app/components/attendance/CheckinReview.tsx`.
