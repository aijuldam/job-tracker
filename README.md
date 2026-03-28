# Job Tracker

A personal job board for tracking Product Marketing and Finance roles.

## Setup

### 1. Create the GitHub repo

```bash
gh repo create job-tracker --public
```

Or manually at github.com/new — name it exactly **`job-tracker`** (the Vite base path depends on this).

### 2. Push the code

```bash
cd job-tracker
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/job-tracker.git
git push -u origin main
```

### 3. Enable GitHub Pages

1. Go to your repo → **Settings** → **Pages**
2. Under **Source**, select **GitHub Actions**
3. Save — the next push to `main` will trigger the deploy workflow automatically

Your site will be live at: `https://YOUR_USERNAME.github.io/job-tracker/`

## Local development

```bash
npm install
npm run dev
```

## Tech stack

- React 18 + Vite + TypeScript
- Tailwind CSS v3
- Application status persisted in `localStorage`
- GitHub Actions → GitHub Pages for CI/CD

## Phase 2 roadmap

- Replace mock data with live job board API (Adzuna / JobsAPI / LinkedIn scraper)
- Add real match-score calculation against resume embeddings
- Notes field per job card
- Email digest of new matches
