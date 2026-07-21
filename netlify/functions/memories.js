import { getStore } from "@netlify/blobs";

const store = () => getStore("memories");

export default async (req) => {
  const s = store();

  if (req.method === "GET") {
    const metaRaw = await s.get("meta.json");
    const meta = metaRaw ? JSON.parse(metaRaw) : [];
    return new Response(JSON.stringify(meta), {
      headers: { "content-type": "application/json" }
    });
  }

  if (req.method === "POST") {
    const body = await req.json();
    const { date, caption, imageBase64, mimeType } = body;
    if (!imageBase64) {
      return new Response(JSON.stringify({ error: "Missing image" }), { status: 400 });
    }

    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    const bytes = Buffer.from(imageBase64, "base64");
    await s.set(`img:${id}`, bytes, { metadata: { mimeType: mimeType || "image/jpeg" } });

    const metaRaw = await s.get("meta.json");
    const meta = metaRaw ? JSON.parse(metaRaw) : [];
    meta.push({
      id,
      date: date || new Date().toISOString().slice(0, 10),
      caption: caption || ""
    });
    await s.set("meta.json", JSON.stringify(meta));

    return new Response(JSON.stringify({ ok: true, id }), {
      headers: { "content-type": "application/json" }
    });
  }

  if (req.method === "DELETE") {
    const { id } = await req.json();
    await s.delete(`img:${id}`);
    const metaRaw = await s.get("meta.json");
    let meta = metaRaw ? JSON.parse(metaRaw) : [];
    meta = meta.filter((m) => m.id !== id);
    await s.set("meta.json", JSON.stringify(meta));
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json" }
    });
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config = { path: "/api/memories" };
