# PES — web application

This folder is the React front end of the Performance Evaluation System. The project README, with the architecture, database, AI assistant and setup instructions, is at the repository root: [`../README.md`](../README.md).

```bash
npm install
npm run dev        # http://localhost:5173
npm run typecheck
npm run build
```

Needs `pes_app/.env.local` with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
