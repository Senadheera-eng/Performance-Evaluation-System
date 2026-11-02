# CLAUDE.md

## Commits

- Every commit is authored and committed by the repository owner alone: `SENADHEERA KMLN <en108953@foe.sjp.ac.lk>`. Set `git config user.name "SENADHEERA KMLN"` and `git config user.email "en108953@foe.sjp.ac.lk"` in the clone before the first commit, and do not set `GIT_COMMITTER_NAME` or `GIT_COMMITTER_EMAIL`.
- No `Co-Authored-By`, `Claude-Session` or other trailers, and no mention of Claude in commit messages, so GitHub shows one person.
- Commit unsigned (`git -c commit.gpgsign=false commit ...`): the session's signing key is not the owner's, and GitHub would mark a signed commit "Unverified".
- Keep commit messages short and plain: a one-line summary, and a few lines of body only when needed.
- Work on `feature/UI`. Never commit to `main` or `dev`; the owner merges through pull requests.
