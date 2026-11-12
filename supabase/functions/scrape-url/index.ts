// Smart URL scraper with auto-routing:
// - bani.com.bd/author/* -> quotes_pool (per-author quote list)
// - *.wikipedia.org/wiki/* -> posts (Wikipedia person article, full HTML)
// - everything else -> posts (generic article: title + main content + og:image)
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type AuthUser = { id: string; role: string };

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function validatePublicUrl(rawUrl: string): URL {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("শুধু http বা https লিংক গ্রহণযোগ্য");
  if (parsed.username || parsed.password) throw new Error("লিংকে লগইন তথ্য রাখা যাবে না");
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("এই ঠিকানাটি স্ক্র্যাপ করা যাবে না");
  }
  const ipv4 = host.split(".").map(Number);
  if (ipv4.length === 4 && ipv4.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    const [a, b] = ipv4;
    if (a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) {
      throw new Error("ব্যক্তিগত বা অভ্যন্তরীণ নেটওয়ার্কের ঠিকানা গ্রহণযোগ্য নয়");
    }
  }
  if (host.includes(":")) throw new Error("সরাসরি IP ঠিকানা গ্রহণযোগ্য নয়");
  parsed.hash = "";
  return parsed;
}

function strip(s: string) {
  return s.replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, " ").trim();
}

function slugify(s: string) {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 80) || `post-${Date.now()}`;
}

function isPrivateIpv4(address: string) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

async function assertPublicHost(hostname: string) {
  const host = hostname.toLowerCase();
  if (host.includes(":")) throw new Error("সরাসরি IP ঠিকানা গ্রহণযোগ্য নয়");
  const ipv4 = host.split(".").map(Number);
  if (ipv4.length === 4 && ipv4.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    if (isPrivateIpv4(host)) throw new Error("ব্যক্তিগত বা অভ্যন্তরীণ নেটওয়ার্কের ঠিকানা গ্রহণযোগ্য নয়");
    return;
  }
  const answers = await Promise.all(["A", "AAAA"].map(async (type) => {
    try { return await Deno.resolveDns(host, type as "A" | "AAAA"); } catch { return []; }
  }));
  const addresses = answers.flat() as string[];
  if (addresses.length === 0) throw new Error("ওয়েব ঠিকানাটি যাচাই করা যায়নি");
  for (const address of addresses) {
    if (address.includes(":")) {
      if (!/^[23]/i.test(address)) throw new Error("ব্যক্তিগত বা অভ্যন্তরীণ নেটওয়ার্কের ঠিকানা গ্রহণযোগ্য নয়");
    } else if (isPrivateIpv4(address)) {
      throw new Error("ব্যক্তিগত বা অভ্যন্তরীণ নেটওয়ার্কের ঠিকানা গ্রহণযোগ্য নয়");
    }
  }
}

async function fetchHtml(url: string): Promise<string> {
  let currentUrl = validatePublicUrl(url);
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    await assertPublicHost(currentUrl.hostname);
    const res = await fetch(currentUrl, {
      redirect: "manual",
      signal: AbortSignal.timeout(20000),
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,*/*",
      },
    });
    if (res.status >= 300 && res.status < 400) {
      const redirectTo = res.headers.get("location");
      if (!redirectTo || redirects === 5) throw new Error("ওয়েবসাইটটি অনেকবার ঠিকানা বদলেছে");
      currentUrl = validatePublicUrl(new URL(redirectTo, currentUrl).href);
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const contentLength = Number(res.headers.get("content-length") || 0);
    if (contentLength > 8_000_000) throw new Error("ওয়েবপেজটি ৮ MB-এর বেশি");
    const html = await res.text();
    if (html.length > 8_000_000) throw new Error("ওয়েবপেজটি ৮ MB-এর বেশি");
    return html;
  }
  throw new Error("ওয়েবপেজটি আনা যায়নি");
}

async function requireUser(req: Request, supabaseUrl: string, anonKey: string, serviceKey: string): Promise<AuthUser> {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new Error("authenticated session required");

  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("invalid authenticated session");
  const user = await res.json();
  if (!user?.id) throw new Error("invalid authenticated session");
  const rolesRes = await fetch(`${supabaseUrl}/rest/v1/user_roles?user_id=eq.${encodeURIComponent(user.id)}&role=in.(admin,moderator,editor)&select=role&limit=1`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  if (!rolesRes.ok) throw new Error("অ্যাকাউন্টের অনুমতি যাচাই করা যায়নি");
  const roles = await rolesRes.json();
  const role = roles?.[0]?.role;
  if (!role) throw new Error("scraper access not allowed for this account");
  return { id: user.id, role };
}

function sanitizeArticleHtml(html: string, baseUrl: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|iframe|object|embed|form|svg|math|template|noscript|base|meta|link|button|input|textarea|select|video|audio)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<(script|style|iframe|object|embed|form|svg|math|template|noscript|base|meta|link|button|input|textarea|select|video|audio)\b[^>]*\/?\s*>/gi, "")
    .replace(/<a\b[^>]*>/gi, "<span>")
    .replace(/<\/a\s*>/gi, "</span>")
    .replace(/\s(?:on[a-z]+|style|srcdoc|formaction|xlink:href|href|srcset|poster)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(src)\s*=\s*(["'])(.*?)\2/gi, (_match, _attribute, _quote, value: string) => {
      try {
        const imageUrl = new URL(value, baseUrl);
        return imageUrl.protocol === "http:" || imageUrl.protocol === "https:" ? ` src="${escapeHtml(imageUrl.href)}"` : "";
      } catch {
        return "";
      }
    });
}

function pick(html: string, re: RegExp): string | null {
  const m = re.exec(html); return m ? m[1].trim() : null;
}

function detectType(url: string): "bani-author" | "wiki" | "generic" {
  try {
    const u = new URL(url);
    if (u.hostname.includes("bani.com.bd") && /\/author\/\d+/.test(u.pathname)) return "bani-author";
    if (u.hostname.endsWith("wikipedia.org") && u.pathname.startsWith("/wiki/")) return "wiki";
    return "generic";
  } catch { return "generic"; }
}

// bani.com.bd/author/N pages have structure: author name in h1/h2; quotes in .single-bani / blockquote / p with author-link
function extractBaniAuthor(html: string, url: string) {
  const authorName = pick(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i) ||
    pick(html, /<title>([\s\S]*?)(?:\s*[-|–]\s*[^<]*)?<\/title>/i) || "অজানা";
  const author = strip(authorName).replace(/\s*[-|–].*$/, "").trim();

  const out: { text: string; author: string; source_name: string; source_url: string }[] = [];
  const seen = new Set<string>();

  // bani.com.bd uses .single-bani .bani-text or blockquote
  const patterns = [
    /<div[^>]*class="[^"]*(?:single-bani|bani-text|bani-content|quote-text)[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
    /<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi,
    /<p[^>]*class="[^"]*(?:bani|quote)[^"]*"[^>]*>([\s\S]*?)<\/p>/gi,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(html)) !== null) {
      const txt = strip(m[1]);
      if (txt.length > 10 && txt.length < 1200 && !seen.has(txt)) {
        seen.add(txt);
        out.push({ text: txt, author, source_name: "bani.com.bd", source_url: `${url}#q${out.length + 1}` });
      }
    }
    if (out.length > 0) break;
  }

  // Fallback: any <p> inside main/article
  if (out.length === 0) {
    const main = pick(html, /<(?:main|article|div[^>]*class="[^"]*(?:content|main|entry)[^"]*")[^>]*>([\s\S]*?)<\/(?:main|article|div)>/i) || html;
    const pRe = /<p[^>]*>([\s\S]*?)<\/p>/gi;
    let m;
    while ((m = pRe.exec(main)) !== null) {
      const txt = strip(m[1]);
      if (txt.length > 20 && txt.length < 800 && !seen.has(txt)) {
        seen.add(txt);
        out.push({ text: txt, author, source_name: "bani.com.bd", source_url: `${url}#q${out.length + 1}` });
      }
    }
  }

  return { author, quotes: out };
}

function extractArticle(html: string, url: string) {
  const ogTitle = pick(html, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  const title = ogTitle || pick(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i) || pick(html, /<title>([\s\S]*?)<\/title>/i) || url;
  const cleanTitle = strip(title);
  const ogImageValue = pick(html, /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  let ogImage: string | null = null;
  if (ogImageValue) {
    try {
      const parsedImage = new URL(ogImageValue, url);
      if (parsedImage.protocol === "http:" || parsedImage.protocol === "https:") ogImage = parsedImage.href;
    } catch { /* Ignore invalid image URLs. */ }
  }
  const description = pick(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);

  // Wikipedia infobox + content area
  const contentBlock =
    pick(html, /<div[^>]+id=["']mw-content-text["'][^>]*>([\s\S]*?)<div[^>]+id=["']catlinks["']/i) ||
    pick(html, /<article[^>]*>([\s\S]*?)<\/article>/i) ||
    pick(html, /<main[^>]*>([\s\S]*?)<\/main>/i) ||
    pick(html, /<div[^>]*class="[^"]*(?:entry-content|post-content|article-content|content)[^"]*"[^>]*>([\s\S]*?)<\/div>/i) ||
    "";
  const cleanedContent = sanitizeArticleHtml(contentBlock || "", url).trim();

  return {
    title: cleanTitle,
    content: cleanedContent || strip(html).slice(0, 5000),
    excerpt: description ? strip(description).slice(0, 300) : strip(cleanedContent || html).slice(0, 300),
    featured_image: ogImage,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceKey) throw new Error("সার্ভার সেটিংস অনুপস্থিত");
    const body = await req.json().catch(() => ({}));
    if (!Array.isArray(body.urls) || body.urls.length < 1 || body.urls.length > 10 || body.urls.some((value: unknown) => typeof value !== "string" || value.length > 2048)) {
      return new Response(JSON.stringify({ error: "urls[] required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const authUser = await requireUser(req, supabaseUrl, anonKey, serviceKey);
    const categoryId = body.categoryId;
    if (categoryId !== null && categoryId !== undefined && (typeof categoryId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(categoryId))) {
      return new Response(JSON.stringify({ error: "বৈধ বিভাগ নির্বাচন করুন" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (categoryId) {
      const categoryRes = await fetch(`${supabaseUrl}/rest/v1/categories?id=eq.${encodeURIComponent(categoryId)}&select=id&limit=1`, { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } });
      if (!categoryRes.ok || !(await categoryRes.json()).length) {
        return new Response(JSON.stringify({ error: "নির্বাচিত বিভাগটি পাওয়া যায়নি" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    const results: any[] = [];

    for (const rawUrl of urls) {
      let parsedUrl: URL;
      try { parsedUrl = validatePublicUrl(rawUrl.trim()); }
      catch (e) { results.push({ url: rawUrl, type: "invalid", ok: false, error: (e as Error).message }); continue; }
      const url = parsedUrl.href;
      const type = detectType(url);
      try {
        const html = await fetchHtml(url);

        if (type === "bani-author") {
          const { author, quotes } = extractBaniAuthor(html, url);
          if (!quotes.length) { results.push({ url, type, ok: false, error: "no quotes found" }); continue; }
          const insRes = await fetch(`${supabaseUrl}/rest/v1/quotes_pool?on_conflict=source_url`, {
            method: "POST",
            headers: {
              apikey: serviceKey, Authorization: `Bearer ${serviceKey}`,
              "Content-Type": "application/json",
              Prefer: "resolution=ignore-duplicates,return=representation",
            },
            body: JSON.stringify(quotes),
          });
          const ok = insRes.ok;
          const data = ok ? await insRes.json() : null;
          results.push({ url, type, ok, author, found: quotes.length, inserted: data?.length ?? 0, error: ok ? null : await insRes.text() });
          continue;
        }

        // posts route (wiki / generic) — ownership is derived only from the verified bearer token
        if (!authUser) { results.push({ url, type, ok: false, error: "authenticated session required" }); continue; }
        const art = extractArticle(html, url);
        const slug = slugify(art.title) + "-" + Math.random().toString(36).slice(2, 6);
        const sourceFooter = `<p class="scraped-source">মূল পোস্টের উৎস: <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(new URL(url).hostname)}</a></p>`;
        const payload = {
          user_id: authUser.id,
          ...(categoryId ? { category_id: categoryId } : {}),
          title: art.title.slice(0, 250) || new URL(url).hostname,
          slug,
          content: `${art.content}\n${sourceFooter}`,
          excerpt: art.excerpt,
          featured_image: art.featured_image,
          source_url: url,
          source_name: new URL(url).hostname,
          post_type: "url",
          status: "published",
          published_at: new Date().toISOString(),
        };
        // upsert by source_url — first check existing
        const existRes = await fetch(`${supabaseUrl}/rest/v1/posts?source_url=eq.${encodeURIComponent(url)}&select=id,user_id,category_id&limit=1`, {
          headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
        });
        if (!existRes.ok) throw new Error(`আর্কাইভ খুঁজতে সমস্যা: ${await existRes.text()}`);
        const existing = await existRes.json();
        let inserted = false, updated = false;
        if (existing.length > 0) {
          if (existing[0].user_id !== authUser.id && authUser.role !== "admin") {
            results.push({ url, type, ok: false, error: "অন্য ব্যবহারকারীর পোস্ট আপডেটের অনুমতি নেই" });
            continue;
          }
          const upRes = await fetch(`${supabaseUrl}/rest/v1/posts?id=eq.${existing[0].id}`, {
            method: "PATCH",
            headers: {
              apikey: serviceKey, Authorization: `Bearer ${serviceKey}`,
              "Content-Type": "application/json", Prefer: "return=minimal",
            },
            body: JSON.stringify({ title: payload.title, content: payload.content, excerpt: payload.excerpt, featured_image: payload.featured_image, source_name: payload.source_name, ...(categoryId ? { category_id: categoryId } : {}) }),
          });
          updated = upRes.ok;
          results.push({ url, type, ok: updated, title: art.title, owner_source: "auth", updated, error: updated ? null : await upRes.text() });
        } else {
          const insRes = await fetch(`${supabaseUrl}/rest/v1/posts`, {
            method: "POST",
            headers: {
              apikey: serviceKey, Authorization: `Bearer ${serviceKey}`,
              "Content-Type": "application/json", Prefer: "return=representation",
            },
            body: JSON.stringify(payload),
          });
          inserted = insRes.ok;
          results.push({ url, type, ok: inserted, title: art.title, owner_source: "auth", inserted, error: inserted ? null : await insRes.text() });
        }
      } catch (e) {
        results.push({ url, type, ok: false, error: (e as Error).message });
      }
    }

    const okCount = results.filter((r) => r.ok).length;
    return new Response(JSON.stringify({ ok: okCount, total: results.length, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const message = (e as Error).message;
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: message.includes("authenticated") || message.includes("session") ? 401 : 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
