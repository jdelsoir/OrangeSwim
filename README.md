# OrangeSwim

A tiny installable web app (PWA) for a friendly monthly swimming contest between colleagues.

* Join with your name and a 4 digit PIN, then log each swim: date and meters (required), pool and photo (optional).
* A leaderboard per calendar month ranks everyone by distance, with the team total.
* A feed shows the swims of the month with photos. The Me tab shows your stats and lets you delete your own swims.

It is plain HTML, CSS and JavaScript (no build step), hosted for free on GitHub Pages, with a free Supabase project as the shared database and photo storage. Built for a handful of friends (3 to 10 people), so it stays deliberately simple.

## Project layout

| Path | What it is |
| --- | --- |
| `index.html`, `styles.css`, `app.js` | The app shell, styles and UI controller |
| `logic.js` | Pure functions (dates, months, leaderboard, validation, formatting) |
| `db.js` | Data layer: `SupabaseAdapter` and `DemoAdapter` behind one interface |
| `config.js` | Your Supabase URL and anon key (empty means demo mode) |
| `supabase/schema.sql` | One-time database setup script |
| `sw.js`, `manifest.webmanifest`, `offline.html`, `icons/` | PWA pieces (offline shell, install metadata, icons) |
| `tests/` | Unit tests (`node --test tests/`) |
| `.github/workflows/deploy.yml` | Tests and deploys to GitHub Pages on every push to `main` |

## One-time Supabase setup (about 5 minutes)

1. Create a free account at [supabase.com](https://supabase.com) and click **New project**. Pick any name, a database password (you will not need it in the app) and a region close to you.
2. When the project is ready, open **SQL Editor**, click **New query**, paste the whole content of [`supabase/schema.sql`](supabase/schema.sql) and click **Run**. It creates the tables, the PIN checking functions and a public `photos` storage bucket. Running it again later is safe.
3. Open **Project Settings**, then **API** (called **API Keys** / **Data API** in newer dashboards) and copy:
   * the **Project URL** (like `https://abcdefghijkl.supabase.co`)
   * the **anon public** key (or the newer **publishable** key)
4. Paste both into `config.js`:

   ```js
   export const SUPABASE_URL = 'https://abcdefghijkl.supabase.co';
   export const SUPABASE_ANON_KEY = 'eyJhbGciOi...';
   ```

5. Commit and push. The anon key is designed to be public (it only allows what the database policies allow), so committing it is fine. Never put the `service_role` or secret key in this repo.

## Deploy to GitHub Pages

1. Create a GitHub repository named `OrangeSwim` and push this folder to its `main` branch.
2. In the repository, open **Settings**, **Pages**, and set **Source** to **GitHub Actions**.
3. Every push to `main` runs the tests and publishes the site. The first deploy takes a minute or two; the app is then live at `https://<your-user>.github.io/OrangeSwim/`.
4. Share that link with your colleagues.

All paths in the app are relative, so it also works under another repository name or on a custom domain.

## Local development

```sh
python3 -m http.server 8000
# then open http://localhost:8000/
```

Run the unit tests (Node 20 or newer):

```sh
node --test tests/
```

Tip: the service worker caches files. While developing, use a private window, or tick **Update on reload** in Chrome DevTools, Application, Service workers.

## Demo mode

If `SUPABASE_URL` or `SUPABASE_ANON_KEY` is empty, the app runs in demo mode: everything (including photos) is stored in the browser's localStorage, and a banner says "Demo mode, data stored on this device only". Handy for trying the app or developing offline. Demo data is not shared with anyone and browsers limit localStorage to a few megabytes, so a few photos fill it up.

## Installing on a phone

* **iPhone / iPad:** open the link in Safari, tap **Share**, then **Add to Home Screen**.
* **Android (Chrome):** use the **Install app** prompt, the button in the Me tab, or the browser menu, **Add to Home screen**.

## Good to know

* **Supabase free projects pause after about a week without activity.** If the app says it cannot reach the server, open the Supabase dashboard and click **Resume project**. It takes a minute or two and no data is lost.
* **The PIN is a friendly guard, not real security.** It stops accidental swims under the wrong name. Anyone can read all swims and photos, and a determined colleague could delete photos through the API. That is fine for a contest between friends; do not store anything private here.
* PINs are stored hashed (bcrypt) in the database and are never readable through the API.
* Photos are resized in the browser to at most 1600 px and saved as JPEG before upload, so they stay small. The bucket is limited to 5 MB per file.
* The leaderboard uses the swim date (local date chosen in the form), not the time it was logged. Months run from the 1st to the last day of the month.
* To reset a forgotten PIN, delete or edit the swimmer in the Supabase dashboard (Table Editor, `swimmers`). Deleting a swimmer also deletes their swims.
* If a bad deploy ever leaves people stuck on an old version, the Reload banner normally fixes it. As a last resort, temporarily replace `sw.js` (same file name) with a tiny worker that deletes all caches and unregisters itself, push, wait for everyone to open the app once, then restore the real `sw.js`.
