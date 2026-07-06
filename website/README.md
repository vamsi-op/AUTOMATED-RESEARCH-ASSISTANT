# Automated Research Assistant — Marketing Website + App

A standalone, production-ready front end for the **Automated Research Assistant**, built with
plain **HTML + CSS + vanilla JavaScript** (no build step, no framework runtime). It ships as
static files you can host anywhere — Vercel, Netlify, GitHub Pages, S3, or the FastAPI app itself.

## Structure

```
website/
├── index.html            # Landing / marketing page (hero, features, how-it-works, FAQ)
├── app.html              # The application (chat, upload, papers, summarize, lit review)
├── assets/
│   ├── css/
│   │   ├── style.css     # Design system + landing page + animations
│   │   └── app.css       # Application-specific components
│   └── js/
│       ├── config.js     # Runtime backend configuration (edit API URL here)
│       ├── animations.js # Landing page interactions (scroll reveal, counters, FAQ…)
│       └── app.js        # API client + all tool logic
└── README.md
```

## Connecting to the backend

The app reads the backend URL from `assets/js/config.js` in this priority order:

1. `?api=<url>` query string — e.g. `app.html?api=http://localhost:8000`
2. `localStorage` (set via the ⚙ settings button in the app)
3. `window.SCHOLARAI_API` global
4. `DEFAULT_BACKEND` constant in `config.js`
5. Same origin (when served by the FastAPI app)

To point at your own backend, either edit `DEFAULT_BACKEND` in `config.js` or use the ⚙ button.

The backend already sends permissive CORS headers (`allow_origins=["*"]`), so the static site
can call it from any origin.

## Run locally

Any static file server works. For example:

```bash
# from the website/ folder
python -m http.server 5500
# then open http://localhost:5500
```

## Deploy to Vercel

This folder is a static site — set the project root to `website/` (no build command,
output directory `.`) and deploy. Update `DEFAULT_BACKEND` to your live API first.

## API endpoints used

| Feature       | Method | Path                          |
|---------------|--------|-------------------------------|
| Health        | GET    | `/api/v1/health`              |
| List papers   | GET    | `/api/v1/papers`              |
| Upload paper  | POST   | `/api/v1/papers/upload`       |
| Delete paper  | DELETE | `/api/v1/papers/{id}`         |
| Query (RAG)   | POST   | `/api/v1/query`               |
| Summarize     | POST   | `/api/v1/summarize`           |
| Lit review    | POST   | `/api/v1/literature-review`   |
