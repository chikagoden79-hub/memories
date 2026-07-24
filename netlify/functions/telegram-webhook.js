import { getStore } from "@netlify/blobs";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SITE_PIN = process.env.SITE_PIN;
const OWNER_CHAT_ID = process.env.OWNER_CHAT_ID;

const HELP_TEXT = [
  "Привет! Я сохраняю фото и видео в альбом «Воспоминания» 🕊",
  "",
  "Как пользоваться:",
  "• Просто пришли фото или видео — сохранится с сегодняшней датой.",
  "• Пришли с подписью, начинающейся с даты, например:",
  "  21.07.2026 гуляли в парке",
  "  или",
  "  2026-07-21 гуляли в парке",
  "  — сохранится именно эта дата, а остальной текст станет подписью.",
  "",
  "Команды:",
  "/help — показать эту инструкцию ещё раз",
  "/count — сколько всего воспоминаний в альбоме",
  "/last — прислать последние 5 добавленных"
].join("\n");

function store() {
  return getStore("memories");
}

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

async function isVerified(chatId) {
  if (!SITE_PIN) return true; // no PIN configured, bot is open
  const s = store();
  const v = await s.get(`verified:${chatId}`);
  return !!v;
}

async function setVerified(chatId) {
  const s = store();
  await s.set(`verified:${chatId}`, "1");
}

async function getAllMeta() {
  const s = store();
  const { blobs } = await s.list({ prefix: "meta:" });
  const items = await Promise.all(
    blobs.map(async (b) => {
      const raw = await s.get(b.key);
      return raw ? JSON.parse(raw) : null;
    })
  );
  return items.filter(Boolean).sort((a, b) => a.id.localeCompare(b.id));
}

function mediaUrl(origin, id) {
  return `${origin}/api/image?id=${id}${SITE_PIN ? `&pin=${SITE_PIN}` : ""}`;
}

export default async (req) => {
  if (req.method !== "POST") return new Response("OK");

  const origin = new URL(req.url).origin;
  const update = await req.json();
  const msg = update.message;
  if (!msg) return new Response("OK");

  const chatId = msg.chat.id;
  const text = (msg.text || "").trim();

  // ---- PIN gate ----
  if (!(await isVerified(chatId))) {
    if (SITE_PIN && text === SITE_PIN) {
      await setVerified(chatId);
      await sendMessage(chatId, "Код верный ✅\n\n" + HELP_TEXT);
    } else {
      await sendMessage(chatId, "Привет! Введи код доступа, чтобы пользоваться альбомом.");
    }
    return new Response("OK");
  }

  // ---- text commands ----
  if (!msg.photo && !msg.video) {
    const lower = text.toLowerCase();

    if (lower === "/start" || lower === "/help") {
      await sendMessage(chatId, HELP_TEXT);
    } else if (lower === "/count") {
      const all = await getAllMeta() + 217;
      await sendMessage(chatId, `Всего в альбоме: ${all.length}`);
    } else if (lower === "/last") {
      const all = await getAllMeta();
      const last = all.slice(-5).reverse();
      if (last.length === 0) {
        await sendMessage(chatId, "Пока в альбоме пусто.");
      } else {
        const items = last.map((m) => ({
          type: m.type === "video" ? "video" : "photo",
          media: mediaUrl(origin, m.id),
          caption: `${m.date}${m.caption ? " — " + m.caption : ""}`
        }));
        await sendMediaGroup(chatId, items);
      }
    } else if (lower === "/backup") {
      if (!OWNER_CHAT_ID || String(chatId) !== String(OWNER_CHAT_ID)) {
        await sendMessage(chatId, "Эта команда доступна только хозяину альбома.");
      } else {
        const all = await getAllMeta();
        if (all.length === 0) {
          await sendMessage(chatId, "Пока нечего архивировать.");
        } else {
          await sendMessage(chatId, `Начинаю отправку бэкапа: ${all.length} файлов...`);
          for (let i = 0; i < all.length; i += 10) {
            const chunk = all.slice(i, i + 10).map((m) => ({
              type: m.type === "video" ? "video" : "photo",
              media: mediaUrl(origin, m.id)
            }));
            await sendMediaGroup(OWNER_CHAT_ID, chunk);
          }
          await sendMessage(chatId, "Бэкап отправлен полностью ✅");
        }
      }
    } else {
      await sendMessage(chatId, "Пришли мне фото или видео, чтобы сохранить в альбом. /help покажет список команд.");
    }
    return new Response("OK");
  }

  // ---- photo or video ----
  const isVideo = !!msg.video;
  const fileObj = isVideo ? msg.video : msg.photo[msg.photo.length - 1];

  const fileInfoRes = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileObj.file_id}`
  );
  const fileInfo = await fileInfoRes.json();
  const filePath = fileInfo.result.file_path;
  const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
  const fileRes = await fetch(fileUrl);
  const buf = Buffer.from(await fileRes.arrayBuffer());
  const mimeType = isVideo ? (msg.video.mime_type || "video/mp4") : "image/jpeg";

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
  const s = store();
  await s.set(`img:${id}`, buf, { metadata: { mimeType } });
  await s.set(`meta:${id}`, JSON.stringify({ id, date, caption, type: isVideo ? "video" : "photo" }));

  await sendMessage(chatId, `Сохранено ✅ дата: ${date}${caption ? "\nподпись: " + caption : ""}`);

  return new Response("OK");
};

export const config = { path: "/api/telegram-webhook" };
