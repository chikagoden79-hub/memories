import { getStore } from "@netlify/blobs";

const store = () => getStore("memories");

function checkPin(req) {
  const expected = process.env.SITE_PIN;
  if (!expected) return true; // no PIN configured — leave open
  const url = new URL(req.url);
  const provided = req.headers.get("x-site-pin") || url.searchParams.get("pin");
  return provided === expected;
}

export default async (req) => {
  if (!checkPin(req)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const s = store();

  if (req.method === "GET") {
    const { blobs } = await s.list({ prefix: "meta:" });
    const items = await Promise.all(
      blobs.map(async (b) => {
        const raw = await s.get(b.key);
        return raw ? JSON.parse(raw) : null;
      })
    );
    let meta = items.filter(Boolean);

    // Backward compatibility: merge in anything still sitting in the old
    // single-file list from before this fix, in case it wasn't migrated yet.
    const oldRaw = await s.get("meta.json");
    if (oldRaw) {
      const old = JSON.parse(oldRaw);
      const knownIds = new Set(meta.map((m) => m.id));
      for (const record of old) {
        if (!knownIds.has(record.id)) {
          meta.push(record);
          knownIds.add(record.id);
        }
      }
    }

    return new Response(JSON.stringify(meta), {
      headers: { "content-type": "application/json" }
    });
  }

  if (req.method === "POST") {
    const body = await req.json();
    const { date, caption, imageBase64, mimeType } = body;
    if (!imageBase64) {
      return new Response(JSON.stringify({ error: "Missing media" }), { status: 400 });
    }

    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    const bytes = Buffer.from(imageBase64, "base64");
    const finalMimeType = mimeType || "image/jpeg";
    const type = finalMimeType.startsWith("video/") ? "video" : "photo";
    await s.set(`img:${id}`, bytes, { metadata: { mimeType: finalMimeType } });

    const record = {
      id,
      date: date || new Date().toISOString().slice(0, 10),
      caption: caption || "",
      type
    };
    await s.set(`meta:${id}`, JSON.stringify(record));

    return new Response(JSON.stringify({ ok: true, id }), {
      headers: { "content-type": "application/json" }
    });
  }

  if (req.method === "DELETE") {
    const { id } = await req.json();
    await s.delete(`img:${id}`);
    await s.delete(`meta:${id}`);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json" }
    });
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config = { path: "/api/memories" };
