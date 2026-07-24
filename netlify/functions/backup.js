import { getStore } from "@netlify/blobs";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SITE_PIN = process.env.SITE_PIN;
const OWNER_CHAT_ID = process.env.OWNER_CHAT_ID;
const SITE_URL = process.env.SITE_URL; // e.g. https://your-site.netlify.app, no trailing slash

async function sendMessage(chatId, text) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text })
  });
}

async function sendMediaGroup(chatId, items) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMediaGroup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, media: items })
  });
}

function mediaUrl(id) {
  return `${SITE_URL}/api/image?id=${id}${SITE_PIN ? `&pin=${SITE_PIN}` : ""}`;
}

export default async () => {
  if (!OWNER_CHAT_ID || !SITE_URL) {
    console.log("Backup skipped: OWNER_CHAT_ID or SITE_URL not configured.");
    return new Response("Skipped: missing env vars");
  }

  const s = getStore("memories");
  const { blobs } = await s.list({ prefix: "meta:" });
  const items = await Promise.all(
    blobs.map(async (b) => {
      const raw = await s.get(b.key);
      return raw ? JSON.parse(raw) : null;
    })
  );
  const all = items.filter(Boolean).sort((a, b) => a.id.localeCompare(b.id));

  if (all.length === 0) {
    return new Response("Nothing to back up");
  }

  await sendMessage(OWNER_CHAT_ID, `Ежемесячный бэкап альбома: ${all.length} файлов, отправляю...`);
  for (let i = 0; i < all.length; i += 10) {
    const chunk = all.slice(i, i + 10).map((m) => ({
      type: m.type === "video" ? "video" : "photo",
      media: mediaUrl(m.id)
    }));
    await sendMediaGroup(OWNER_CHAT_ID, chunk);
  }
  await sendMessage(OWNER_CHAT_ID, "Бэкап завершён ✅");

  return new Response("OK");
};

export const config = { schedule: "@monthly" };
