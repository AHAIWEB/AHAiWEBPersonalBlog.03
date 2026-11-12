// Scrape Bangla Wikipedia person pages and upsert as posts
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function slugify(s: string) {
  return s.trim().toLowerCase()
    .replace(/[\s\u00A0]+/g, "-")
    .replace(/[^\p{L}\p{N}\-]/gu, "")
    .replace(/-+/g, "-")
    .slice(0, 180);
}

function decodeWikiTitle(url: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").pop() || "";
    return decodeURIComponent(last).replace(/_/g, " ");
  } catch {
    return url;
  }
}

async function requireScraperUser(req: Request, supabaseUrl: string, anonKey: string, serviceKey: string) {
  const token = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new Error("authenticated session required");
  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: `Bearer ${token}` } });
  if (!userRes.ok) throw new Error("invalid authenticated session");
  const user = await userRes.json();
  if (!user?.id) throw new Error("invalid authenticated session");
  const rolesRes = await fetch(`${supabaseUrl}/rest/v1/user_roles?user_id=eq.${encodeURIComponent(user.id)}&role=in.(admin,moderator,editor)&select=role&limit=1`, { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } });
  if (!rolesRes.ok) throw new Error("account permission could not be checked");
  const roles = await rolesRes.json();
  if (!roles?.length) throw new Error("scraper access not allowed for this account");
  return { id: user.id, role: roles[0].role as string };
}

async function fetchWikiPage(title: string) {
  // Use mobile-sections REST API which provides clean lead + remaining HTML + image
  const enc = encodeURIComponent(title.replace(/ /g, "_"));
  const summaryRes = await fetch(`https://bn.wikipedia.org/api/rest_v1/page/summary/${enc}`);
  const summary = summaryRes.ok ? await summaryRes.json() : null;

  const htmlRes = await fetch(`https://bn.wikipedia.org/api/rest_v1/page/html/${enc}`);
  if (!htmlRes.ok) throw new Error(`Wiki fetch failed: ${htmlRes.status}`);
  let html = await htmlRes.text();

  // Strip Parsoid metadata, references, edit links etc. but keep content rich
  html = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/ about="[^"]*"/g, "")
    .replace(/ typeof="[^"]*"/g, "")
    .replace(/ data-mw="[^"]*"/g, "")
    .replace(/<link[^>]*>/gi, "");

  return {
    title: summary?.titles?.normalized || summary?.title || title,
    extract: summary?.extract || "",
    image: summary?.thumbnail?.source || summary?.originalimage?.source || "",
    html,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceKey) throw new Error("server configuration is incomplete");
    const scraperUser = await requireScraperUser(req, supabaseUrl, anonKey, serviceKey);
    const body = await req.json().catch(() => ({}));
    let urls: string[] = [];
    if (Array.isArray(body.urls)) urls = body.urls;
    else if (typeof body.urls === "string") urls = body.urls.split(/[👉\n,]+/);
    urls = urls.map((s: string) => s.trim()).filter((s) => s.startsWith("http"));
    if (!urls.length || urls.length > 10) {
      return new Response(JSON.stringify({ error: "Provide between 1 and 10 Wikipedia URLs" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ownerUserId = scraperUser.id;

    // Find/create "পিপল" category
    let categoryId: string | null = null;
    const catRes = await fetch(`${supabaseUrl}/rest/v1/categories?slug=eq.people&select=id`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });
    const cats = catRes.ok ? await catRes.json() : [];
    if (cats[0]) categoryId = cats[0].id;
    else {
      const cRes = await fetch(`${supabaseUrl}/rest/v1/categories`, {
        method: "POST",
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", Prefer: "return=representation" },
        body: JSON.stringify({ name: "পিপল", slug: "people", icon: "👤", show_in_nav: true }),
      });
      if (cRes.ok) {
        const created = await cRes.json();
        categoryId = created[0]?.id;
      }
    }

    const results: any[] = [];
    for (const url of urls) {
      try {
        const title = decodeWikiTitle(url);
        const wiki = await fetchWikiPage(title);
        const slug = slugify(wiki.title) || slugify(title);

        // Check for existing post by source_url
        const existRes = await fetch(`${supabaseUrl}/rest/v1/posts?source_url=eq.${encodeURIComponent(url)}&select=id,user_id&limit=1`, {
          headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
        });
        if (!existRes.ok) throw new Error(`Archive lookup failed: ${await existRes.text()}`);
        const exist = await existRes.json();
        if (exist[0] && exist[0].user_id !== ownerUserId && scraperUser.role !== "admin") {
          results.push({ url, ok: false, error: "You do not have permission to update another user's post" });
          continue;
        }

        const payload = {
          user_id: exist[0]?.user_id || ownerUserId,
          category_id: categoryId,
          title: wiki.title,
          slug,
          content: wiki.html,
          excerpt: wiki.extract?.slice(0, 280) || null,
          featured_image: wiki.image || null,
          source_url: url,
          source_name: "বাংলা উইকিপিডিয়া",
          post_type: "url",
          status: "published",
          published_at: new Date().toISOString(),
        };

        let postId: string | null = null;
        if (exist[0]) {
          postId = exist[0].id;
          const updateRes = await fetch(`${supabaseUrl}/rest/v1/posts?id=eq.${postId}`, {
            method: "PATCH",
            headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", Prefer: "return=minimal" },
            body: JSON.stringify({ title: payload.title, slug: payload.slug, category_id: payload.category_id, content: payload.content, excerpt: payload.excerpt, featured_image: payload.featured_image, source_name: payload.source_name, updated_at: new Date().toISOString() }),
          });
          if (!updateRes.ok) throw new Error(`Archive update failed: ${await updateRes.text()}`);
        } else {
          const insRes = await fetch(`${supabaseUrl}/rest/v1/posts`, {
            method: "POST",
            headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", Prefer: "return=representation" },
            body: JSON.stringify(payload),
          });
          if (insRes.ok) {
            const created = await insRes.json();
            postId = created[0]?.id;
            if (postId && categoryId) {
              await fetch(`${supabaseUrl}/rest/v1/post_categories`, {
                method: "POST",
                headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
                body: JSON.stringify({ post_id: postId, category_id: categoryId }),
              });
            }
          } else {
            const errTxt = await insRes.text();
            results.push({ url, ok: false, error: errTxt });
            continue;
          }
        }
        if (postId && categoryId) {
          const linkRes = await fetch(`${supabaseUrl}/rest/v1/post_categories?on_conflict=post_id,category_id`, {
            method: "POST",
            headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", Prefer: "resolution=ignore-duplicates,return=minimal" },
            body: JSON.stringify({ post_id: postId, category_id: categoryId }),
          });
          if (!linkRes.ok) throw new Error(`Could not add archive category: ${await linkRes.text()}`);
        }
        results.push({ url, ok: true, id: postId, title: wiki.title, updated: !!exist[0] });
      } catch (e) {
        results.push({ url, ok: false, error: String((e as Error).message || e) });
      }
    }

    return new Response(JSON.stringify({ results, total: urls.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const message = String((e as Error).message || e);
    return new Response(JSON.stringify({ error: message }), {
      status: message.includes("authenticated") || message.includes("session") ? 401 : message.includes("not allowed") ? 403 : 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
