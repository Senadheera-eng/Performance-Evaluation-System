---
kicker: Feature Guide  ·  Machine learning  ·  Mid-evaluation brief
title: Machine Learning in PES
subtitle: Everything to know about the two models, in plain words
intro: PES has two machine-learning features. Grade prediction forecasts each student's grade bands and SGPA for the coming semester. Attendance anomaly detection lists live sign-ins that look like proxy attendance, for the lecturer to review. This brief explains both in plain words, so they can be explained and defended at the mid evaluation. It covers what each model does and why it was built that way, how it was tested and what the numbers mean, the numbers worth remembering, the questions an examiner is likely to ask with answers, and how to show both in the live demonstration. The two feature guides go deeper on each.
updated: Written 3 November 2026  ·  describes the models trained and loaded on that date
footer: PES Study Guide
---

# 1. The two models on one page

<!-- widths: 22,39,39 -->
| | Grade prediction | Attendance anomaly detection |
|---|---|---|
| The question | Which grade band is each student likely to get in each course next semester? | Which of today's live sign-ins look like someone signing in for an absent student? |
| Algorithm | Random forest: 300 decision trees that vote | Isolation Forest: 100 random trees that isolate unusual points |
| Kind of learning | Supervised: learns from past results with known grades | Unsupervised: learns what normal looks like, needs no labelled cheating |
| Learns from | 7,392 published results of 167 students, anonymised | 8,405 simulated sign-ins (PES has almost no real ones yet) |
| Output | Probability of each band; a forecast SGPA; a chance of an R or F | An anomaly score from 0 to 1, and the reasons in plain words |
| Who sees it | Students (bands, never R/F figures); mentors (early warnings) | The course's lecturer, head of department, department admin, super admin |
| Key result | SGPA off by 0.26 on an unseen semester, against 0.29 for the student's own average | 91% of account switching and 47% of all proxies caught, at 0.5 false alarms per lecture |
| Where it runs | Trained in Python; predictions loaded into the database | Trained in Python; the trees are loaded and scored inside the database |

:::why THE ONE IDEA BEHIND BOTH
Neither model makes a decision. Grade prediction is a guide to plan with, and a prompt for a mentor to talk to a student. Anomaly detection is a list of sign-ins worth a second look. A person always decides, and nothing in either feature changes a grade or an attendance mark.
:::

# 2. Grade prediction

## 2.1 What it answers

For every student and every course of the coming semester, the model predicts the chance of each of five grade bands: A+/A, A-/B+, B/B-, C+/C and R/F. From those, PES works out:

- **the likely band** of each course (the one with the highest chance);
- **a forecast SGPA**: each band's chance times its average grade point, added up per course, then the credit-weighted average over the semester;
- **the chance of at least one R or F**, used to rank students for early warning.

2,020 predictions are loaded for Semester 7, for 166 students. The Engineering Project's Semester 7 part (CO4002) is not predicted, because its grade is given once, in Semester 8.

## 2.2 The data, and what never leaves the database

The model learns from 7,392 published results. Before they leave the database (`ml/export_dataset.sql`), every student and every course becomes a number. No name, id or index number is exported. The predictions come back as numbers, and the database maps them back to students inside itself, after checking that the student and course lists have not changed since the export.

## 2.3 The features: only what was known before the semester

Each training row is one result. Its features come only from the student's record **before** that semester, because when the model predicts for real, the semester's own grades do not exist yet. Using them would be **leakage**: brilliant in testing, useless in practice.

<!-- widths: 34,66 -->
| Feature | In plain words |
|---|---|
| Earlier average | The credit-weighted grade-point average so far |
| Last semester's average, and its change | Is the student rising or falling? |
| Average in this department's courses | How they do in courses like this one |
| Spread of earlier grades | How uneven their grades are |
| Earlier R/F grades and deferrals | How often they have had to repeat or defer |
| Share of A grades | How often they reach the top |
| Course facts | Credits; elective or not; own department or not; interdisciplinary or not; how this department usually grades |

Nothing about who the student is (name, gender, school, district) is a feature. One feature was removed: the semester number. With one batch, every training row was from an earlier semester than every test row, so the model was guessing outside its experience; removing it made the model more accurate.

## 2.4 The models compared, and why a random forest

A model is only worth using if it beats what a mentor could work out by hand, so five models were compared:

<!-- widths: 34,66 -->
| Model | What it does |
|---|---|
| Most common band (baseline) | Predicts A-/B+ for everyone |
| Same as before (baseline) | Predicts the band of the student's average so far |
| Same as before, with last semester (baseline) | The same, from the average of the overall and last-semester averages |
| Decision tree (CART) | The proposal's choice: a series of yes/no questions on the features |
| **Random forest (deployed)** | 300 trees, each grown on a random sample of results and features; their votes are averaged |

A single decision tree is easy to read but **unstable**: move a few results and it asks different questions. The proposal's improvement plan was to move to an ensemble if that happened, and it did. Averaging 300 trees gives a steadier answer and a probability for each band, not just one guess. The forest has trees of at most 10 levels and at least 10 results per leaf, chosen by cross-validation **grouped by student**, so a student's results never sit on both sides of a test.

## 2.5 How it was tested: on semesters it never saw

The model is tested the way it is used: trained on earlier semesters, tested on a later one it never saw. This is **rolling-origin** evaluation.

- Trained on Semesters 2–4, tested on Semester 5 (1,341 results).
- Trained on Semesters 2–5, tested on Semester 6 (1,336 results).

<!-- widths: 40,20,20,20 -->
| On Semester 6 | SGPA error | Early-warning AUC | Exact band |
|---|---|---|---|
| Most common band | 0.39 | – | 0.35 |
| Student's own average | 0.29 | 0.72 | 0.39 |
| Own average with last semester | 0.28 | 0.74 | 0.40 |
| Decision tree (CART) | 0.29 | 0.69 | 0.38 |
| **Random forest** | **0.26** | **0.76** | 0.38 |

- **SGPA error** is the average gap between the forecast and the real SGPA, on the 0–4 scale. The forest is the best.
- **Early-warning AUC**: rank students by their chance of an R or F; AUC is how often a student who did get one is ranked above one who did not (0.5 is chance, 1.0 perfect). The forest is the best.
- **Exact band** is only about 2 in 5 for every model, which is why PES shows "likely" bands with their chance, not certainties.

:::warn THE HONEST PART
On Semester 5, trained on less data, the student's own average did better than the forest (SGPA error 0.33 against 0.40). The forest gains most from more data, and the deployed model is trained on the most: 6,103 results, Semesters 2 to 6. With grades alone and one cohort, a student's own average is a strong baseline. Mid-semester, CA and attendance marks are the next features to add.
:::

## 2.6 Who sees what

<!-- widths: 22,78 -->
| Who | What they see |
|---|---|
| Student | In the Graduation Planner: the likely band of each course and how likely it is, and a forecast SGPA "usually within ±0.26". Never an R or F figure: a course whose likeliest band is R/F says **Needs attention** and points to the mentor. |
| Mentor | An **Early warnings** card: mentees with an above-usual chance of an R or F, likeliest first, with the courses to watch, and each mentee's full forecast. |
| Head, department admin, super admin | A student's full forecast, for anyone allowed to see that student's record. |

The levels come from the faculty's own record: 5% of past grades were an R or F, and 22% of students got at least one in a semester. A mentee is **Watch** from a 25% chance and **High** from 40%; a course is "to watch" from 10%, twice the usual rate. The database decides all of this, not the page.

## 2.7 How the predictions get into PES

1. **Export** the anonymised results (an SQL file run in the Supabase editor).
2. **Train and test** with `ml/train.py` (Python, scikit-learn), about three minutes.
3. **Load** with `ml/load_predictions.py`, using a **single-use token that expires in an hour**. Only the token's hash is stored in the database, so the training computer never holds a service key.

Students and mentors then read the predictions through database functions that check who is asking.

# 3. Attendance anomaly detection

## 3.1 What it answers

A live register puts a QR code on the projector that changes every 10 seconds. A browser can sign in only one student per lecture, and the phone's distance from the lecturer is recorded. That stops the easy tricks, but not all of them:

- **A code relayed by photo.** A friend sends a photo; the absent student scans it from home.
- **A friend's phone, switching accounts.** A friend signs in, then logs in as the absent student on the same phone, in a private window or another browser, and scans again.
- **A spare phone kept signed in** as the absent student.
- **The student's own phone, carried in** by a friend. No data can catch this one.

Every trace these leave also has an innocent cause: indoor GPS drifts, people deny location, phones get replaced, batteries die. A rule on any one signal either misses the cheats or floods the lecturer with false alarms. So the model looks for unusual **combinations**.

## 3.2 The eight signals

<!-- widths: 36,64 -->
| Signal | Why it matters |
|---|---|
| Age of the code | A relayed photo arrives late |
| Distance from the hall | A phone far away was not in the lecture |
| Location withheld, unusually | Matters only if the phone usually sends it |
| First sign-in from a device | A student's sign-in from a device they have never used |
| Device used by other students | One phone signing in several people over time |
| Presence checks missed | A phone that left the room cannot answer the surprise check |
| Logged in just before signing | Switching accounts means a login seconds before the scan |
| Same network and browser as the sign-in just before | The friend's own sign-in, a minute earlier, from the same phone |

The last two were added for account switching (section 3.6). The network address and browser string are never stored: only an md5 hash of them, salted with that lecture's secret, so two sign-ins can be compared within one lecture and nowhere else.

## 3.3 What an Isolation Forest is

Imagine cutting a crowd of points with random straight lines, again and again, until every point stands alone. An ordinary sign-in sits in the crowd and takes many cuts to isolate. An unusual one is cut off in a few. An Isolation Forest builds 100 such random trees and scores each sign-in by how quickly it is isolated on average: a number from 0 to 1, where higher means more unusual.

It is **unsupervised**. It never needs examples labelled "proxy", which PES will never have in quantity, because a proxy that is caught is rarely recorded as one.

## 3.4 When a sign-in is listed

- When its score is **at least 0.643**. That threshold was set on separate validation lectures, so that about 1.5% of honest sign-ins are listed: about one honest student every two lectures.
- **Always**, when it was made **1 km or more** from the lecture. No hall is that big.
- **Always**, when the same browser then tried to sign in **another student**. The register refuses the second student, records the attempt, and lists the first sign-in with the name of the student it tried.

The lecturer sees a **Sign-ins to review** card under the register, most unusual first, each with its reasons in plain words. Nothing is marked absent automatically.

## 3.5 Why a simulation, and what it found

PES has recorded only a handful of real live sign-ins, so there was nothing real to learn from or test on. The script `ml/attendance_anomaly.py` simulates whole semesters (25 to 60 students, 30 lectures), injects proxy sign-ins of each kind, and measures how many are caught. Its assumptions are written in the script and the feature guide. The model was tested on 720 lectures it never saw, with 386 proxies among 28,397 sign-ins.

<!-- widths: 36,16,16,16,16 -->
| Approach | Proxies caught | Account switching | Flags that were proxies | Honest students listed per lecture |
|---|---|---|---|---|
| Simple location rules | 41% | 9% | 3% | 6.7 |
| Every signal as a rule | 88% | 100% | 2% | 20.8 |
| **Isolation Forest + 1 km rule** | **47%** | **91%** | **32%** | **0.5** |

The point is the false alarms. A list of seven honest students every lecture would soon be ignored; a list of one every two lectures, of which nearly a third are real proxies, is worth reading. The AUC is 0.84: a random proxy is scored above a random honest sign-in 84% of the time.

## 3.6 The two signals added for account switching

The first model had six signals and caught about a third of account switches (34% on the same test). A switched account left only one trace among them: a new device, which an honest new phone also leaves. Adding "logged in just before signing" and "same network and browser as the sign-in before" raised it to 91%, and all proxies from 38% to 47%. The cost was photo relays, from 51% to 40%, because the same small budget of false alarms is now shared with a new pattern.

## 3.7 Tested on the live system

- **A real far sign-in:** a sign-in 16.2 km from its lecture is listed; a real one 268 m away is not.
- **The first phone test found an app bug, not a cheat:** the page waited up to 8 seconds for GPS *after* reading the code, so an honest sign-in indoors arrived with an old code and no location, just like a relayed photo. The page now finds the location while the student aims, and sends the code within 1.5 seconds.
- **Account switching, replayed in the database:** in the same browser, the second student was refused and the first was listed with their name. In a private window, the switched account was listed at 0.668 with three reasons, while an honest classmate on the same Wi-Fi was not.

## 3.8 Limits

- Every figure comes from a simulation; the first real semester is the real test, and the model will be retrained on it.
- The student's own phone, carried in by a friend, leaves no trace.
- A friend who keeps the absent student logged in on a second browser shows a new device only the first time; after that, only presence checks catch it.
- On campus Wi-Fi many phones share one address and browser string, so that signal is weaker there than on mobile data.
- In a student's first lectures, before a new device stands out, account switching scores below the threshold unless a presence check is also missed.

# 4. Numbers worth remembering

<!-- widths: 22,78 -->
| Number | What it is |
|---|---|
| 7,392 | Published results grade prediction learned from (167 students) |
| 2,020 | Predictions loaded for Semester 7 (166 students) |
| 0.26 | The forest's SGPA error on unseen Semester 6, against 0.29 for the student's own average |
| 0.76 | Early-warning AUC, against 0.72 for the student's own average |
| 300 | Trees in the grade forest |
| 8 | Signals per sign-in for anomaly detection |
| 100 | Trees in the Isolation Forest |
| 0.643 | The anomaly threshold |
| 91% | Account switching caught (34% before the two new signals) |
| 47% | All proxy sign-ins caught |
| 0.5 | Honest students listed per lecture (6.7 for location rules) |
| 720 | Simulated test lectures |
| 1 hour | How long a single-use load token lasts |

# 5. Questions an examiner may ask

**Why machine learning at all? Couldn't simple rules do this?**
For grades, a simple rule (the student's own average) is the baseline the model must beat, and it is reported honestly: the forest beats it on SGPA and early warning on Semester 6, not on Semester 5. For attendance, simple rules either miss most proxies or list seven honest students a lecture; the model lists one every two lectures.

**Why a random forest and not the decision tree in your proposal?**
The tree was built and tested. It was unstable, and it ranked students for early warning worse than their own average. The proposal's improvement plan was to move to an ensemble if that happened. A random forest averages 300 trees, which is steadier, and gives a probability for each band.

**How do you know the model is not cheating with information from the future?**
Every feature is computed only from results before the semester being predicted, and each model is tested on a semester it never saw. The test semester is never used for tuning, and cross-validation is grouped by student.

**Why is exact-band accuracy only about 40%?**
Grades are noisy and the model sees grades only, not effort, attendance or this semester's marks. So PES shows likely bands with their chance and a forecast SGPA, whose error is small (0.26). It is a guide to plan with, not a verdict.

**Is it fair to warn about a student?**
The student is never shown an R or F figure, only "needs attention" and a pointer to their mentor. The mentor sees the figures and puts them in context. No personal detail is a feature, only grades and course facts.

**How is student privacy protected in training?**
Results leave the database as numbers, with no names, ids or index numbers. Predictions come back as numbers and are mapped back inside the database. They are loaded with a single-use token, and read only through functions that check who is asking.

**Why an Isolation Forest for attendance?**
There are no labelled examples of proxy attendance, and there never will be many. An Isolation Forest is unsupervised: it learns what normal sign-ins look like and scores how unusual each one is. It is also small enough to store as arrays and score inside the database.

**Your attendance results come from a simulation. Why should we believe them?**
They show the method works under stated assumptions, and at what cost in false alarms. They do not say how often students really cheat. The real check is the first semester of real sign-ins: retrain on them and compare the flags with what lecturers find. The two real tests so far behaved as expected, and one of them found a real bug in the app, which was fixed.

**Can a student be marked absent by the model?**
No. The model only lists sign-ins for the lecturer to look at, with reasons. Changing a mark is always a person's act, through the register.

**What if an honest student is flagged?**
That is expected about once every two lectures, and the reason is shown: for example, "logged in 40 seconds before signing" after a new phone. The lecturer checks with the student. Nothing changes unless the lecturer changes it.

**What stops a student logging out and signing in a friend on the same phone?**
In the same browser, the database refuses a second student per lecture, records the attempt, and always lists it. In a private window, the switched account was logged in seconds before and comes from the same network and browser as the friend's sign-in a minute earlier, which the model now catches 91% of the time once the student has a normal history.

**Do you store students' IP addresses?**
No. Only an md5 hash of the network address and browser string, salted with that lecture's secret, so it can only be compared within the same lecture.

**How does the model get into the database without a secret key?**
The training script makes a random token, prints the SQL that stores its hash, and someone with database access runs that line. The loader accepts the token once, within an hour. It also refuses an anomaly model unless the database scores 40 sample sign-ins exactly as scikit-learn did.

**What would you improve next?**
Add mid-semester, CA and attendance marks to grade prediction; learn each course's own difficulty once a second batch has taken it; check that the probabilities are well calibrated; and retrain the anomaly model on real lectures, with a "this was fine / this was a proxy" button for lecturers to give it its first labels.

# 6. Showing both in the demonstration

**Grade prediction (about one minute)**

1. As a student, open **Graduation Planner**: point to the **Semester 7 forecast** card, the likely band of each course, and the forecast SGPA "usually within ±0.26".
1. Open **How this forecast works**: the figures from the student's own record the model leans on, and what it cannot see.
1. As a lecturer who mentors students, open **Academic Mentoring**: the **Early warnings** card, likeliest first, with courses to watch. Open one mentee's forecast.

**Attendance anomaly detection (about one minute)**

1. As a lecturer, open a register and let a student sign in by QR on a phone.
1. Close and record. Under the register, the **Sign-ins to review** card appears: either "All sign-ins look ordinary" or a list with reasons.
1. Open **How sign-ins are checked**: the eight signals, the two things always listed, and the test figures.
1. If there is time, show the same-browser refusal: sign in, log out, sign in as another student in the same browser and scan. The student is refused, and after closing, the first sign-in is listed with the other student's name.

:::warn BEFORE THE DEMO
A friend's account needs two earlier sign-ins from its own phone before a private-window switch stands out by itself. The same-browser refusal works every time, so it is the safer one to show live.
:::

# 7. Words used in this brief

<!-- widths: 28,72 -->
| Word | Meaning |
|---|---|
| Supervised learning | Learning from examples with known answers (past grades) |
| Unsupervised learning | Learning what normal looks like, without labelled answers |
| Baseline | A simple rule a model must beat to be worth using |
| Leakage | Using information in training that would not exist at prediction time |
| Rolling-origin test | Train on earlier semesters, test on a later one never seen |
| Cross-validation | Scoring settings on parts of the training data held back in turn |
| Random forest | Many decision trees on random samples, whose votes are averaged |
| Isolation Forest | Random trees that cut data until each point is alone; unusual points are cut off sooner |
| AUC | How well a score ranks the cases that matter above the rest; 0.5 is chance, 1.0 perfect |
| Precision | The share of flags that were real |
| Recall | The share of real cases that were flagged |
| Threshold | The score at or above which something is listed |
| Proxy sign-in | A sign-in made for a student who is not in the lecture |
