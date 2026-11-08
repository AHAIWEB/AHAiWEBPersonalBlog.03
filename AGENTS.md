# Architecture decisions
- Keep sitemap and site-wide metadata in the static Vite document because this app is client-rendered and crawlers consume its initial HTML.
- Keep scraping as authenticated edge-function workflows that write extracted articles to the existing posts archive, avoiding a second content store.