import { getStore } from "@netlify/blobs";

export default async (req) => {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return new Response("Missing id", { status: 400 });

  const expected = process.env.SITE_PIN;
  if (expected && url.searchParams.get("pin") !== expected) {
    return new Response("Unauthorized", { status: 401 });
  }

  const s = getStore("memories");
  const entry = await s.getWithMetadata(`img:${id}`, { type: "arrayBuffer" });
  if (!entry) return new Response("Not found", { status: 404 });

  return new Response(entry.data, {
    headers: {
      "content-type": entry.metadata?.mimeType || "image/jpeg",
      "cache-control": "private, max-age=31536000, immutable"
    }
  });
};

export const config = { path: "/api/image" };
