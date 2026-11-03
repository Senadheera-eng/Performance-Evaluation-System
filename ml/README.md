# Grade prediction

PES's machine-learning feature. A model trained on the faculty's past results predicts, for each student and each
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

## How it works

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

## Running it each semester

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

## Files

| File | |
|---|---|
| `export_dataset.sql` | The anonymised training data, as rows to save into `ml/data/`. |
| `train.py` | Features, evaluation against baselines, the report and charts, and the predictions (`ml/out/predictions.json`). |
| `load_predictions.py` | Makes a load token; sends the predictions to `ml_load_predictions`. Standard library only. |
| `report/` | The latest evaluation: `report.md`, `metrics.json` and the charts. |
| `requirements.txt` | The Python libraries `train.py` needs. |

Database side: `supabase/migrations/20261102185644_grade_predictions_and_the_model_behind_them.sql` and
`20261102190702_early_warning_levels_and_a_students_own_forecast.sql`. App side: `pes_app/src/lib/gradeForecast.ts`
and `pes_app/src/app/components/forecast/GradeForecast.tsx`.
