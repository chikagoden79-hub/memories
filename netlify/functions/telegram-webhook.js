import { getStore } from "@netlify/blobs";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

export default async (req) => {
  if (req.method !== "POST") return new Response("OK");

  const update = await req.json();
  const msg = update.message;

  if (!msg || !msg.photo) {
    return new Response("OK");
  }

  // Telegram sends multiple sizes; take the largest.
  const photo = msg.photo[msg.photo.length - 1];

  const fileInfoRes = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${photo.file_id}`
  );
  const fileInfo = await fileInfoRes.json();
  const filePath = fileInfo.result.file_path;
  const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
  const imgRes = await fetch(fileUrl);
  const buf = Buffer.from(await imgRes.arrayBuffer());

  // Caption can optionally start with a date: "21.07.2026 текст" or "2026-07-21 текст"
  let date = new Date(msg.date * 1000).toISOString().slice(0, 10);
  let caption = msg.caption || "";
  const dateMatch = caption.match(/^(\d{4}-\d{2}-\d{2}|\d{2}\.\d{2}\.\d{4})\s*/);
  if (dateMatch) {
    const raw = dateMatch[1];
    date = raw.includes(".") ? raw.split(".").reverse().join("-") : raw;
    caption = caption.slice(dateMatch[0].length).trim();
  }

  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const s = getStore("memories");
  await s.set(`img:${id}`, buf, { metadata: { mimeType: "image/jpeg" } });

  const metaRaw = await s.get("meta.json");
  const meta = metaRaw ? JSON.parse(metaRaw) : [];
  meta.push({ id, date, caption });
  await s.set("meta.json", JSON.stringify(meta));

  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: msg.chat.id,
      text: `Сохранено ✅ дата: ${date}${caption ? "\nподпись: " + caption : ""}`
    })
  });

  return new Response("OK");
};

export const config = { path: "/api/telegram-webhook" };
