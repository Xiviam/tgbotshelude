import { Bot } from "grammy";
import axios from "axios";
import dotenv from "dotenv";
import { Keyboard } from "grammy";
dotenv.config();

import { sequelize, User } from "./db";
import { encrypt } from "./cryptoUtil";
import { Model } from "sequelize";

const bot = new Bot(process.env.BOT_TOKEN!);

interface IUser extends Model {
  chatId: number;
  login: string;
  password: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  city_data?: string;
}

function getLocalDateString(offsetDays = 0): string {
  const now = new Date();
  now.setDate(now.getDate() + offsetDays);
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function scheduleReminders(chatId: number, lessons: any[], date: string) {
  const now = new Date();

  for (const lesson of lessons) {
    const [hour, minute] = lesson.started_at.split(":").map(Number);

    const lessonTime = new Date(
      new Date(`${date}T${hour.toString().padStart(2,"0")}:${minute.toString().padStart(2,"0")}:00+03:00`)
    );

    const reminderTime = new Date(lessonTime.getTime() - 5 * 60 * 1000);

    const diff = reminderTime.getTime() - now.getTime();

    if (diff > 0) {
      setTimeout(() => {
        bot.api.sendMessage(
          chatId,
          `⏰ Через 5 минут начнется пара!\n\n📖 ${lesson.subject_name}\n👨‍🏫 ${lesson.teacher_name}\n🏫 ${lesson.room_name}`
        );
      }, diff);

      console.log(
        `✅ Напоминание для чата ${chatId} запланировано на ${reminderTime.toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })}`
      );
    } else {
      console.log(
        `⚠️ Пара "${lesson.subject_name}" уже началась или reminderTime < now`
      );
    }
  }
}


async function loginAndSave(chatId: number, username: string, password: string) {
  try {
    const res = await axios.post(
      "https://msapi.top-academy.ru/api/v2/auth/login",
      { application_key: process.env.APPLICATION_KEY, id_city: null, username, password },
      { headers: { "Content-Type": "application/json", Origin: "https://journal.top-academy.ru", Referer: "https://journal.top-academy.ru" } }
    );

    const auth = res.data;
    if (!auth || !auth.access_token) throw new Error("No access_token in response");

    await User.upsert({
      chatId,
      login: username,
      password: encrypt(password),
      accessToken: auth.access_token,
      refreshToken: auth.refresh_token,
      expiresAt: Date.now() + auth.expires_in_access * 1000,
      city_data: JSON.stringify(auth.city_data),
    });

    return auth.access_token;
  } catch (err: any) {
    console.error("Login error:", err.response?.data || err.message);
    throw new Error("Auth failed");
  }
}

async function refreshTokenIfNeeded(user: any) {
  const now = Date.now();
  const expiresAt = user.getDataValue("expiresAt") || 0;

  if (now < expiresAt) return user.getDataValue("accessToken");

  try {
    const res = await axios.post(
      "https://msapi.top-academy.ru/api/v2/auth/refresh",
      {
        refresh_token: user.getDataValue("refreshToken"),
        application_key: process.env.APPLICATION_KEY,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Origin: "https://journal.top-academy.ru",
          Referer: "https://journal.top-academy.ru",
        },
      }
    );

    const auth = res.data;
    await User.update(
      {
        accessToken: auth.access_token,
        refreshToken: auth.refresh_token,
        expiresAt: Date.now() + auth.expires_in_access * 1000,
      },
      { where: { chatId: user.getDataValue("chatId") } }
    );

    return auth.access_token;
  } catch (err: any) {
    console.error("Refresh token error:", err.response?.data || err.message);
    throw new Error("Не удалось обновить токен");
  }
}


async function getSchedule(chatId: number, date: string) {
  const user = await User.findOne({ where: { chatId } });
  if (!user) return "❌ Сначала авторизуйтесь";

  let accessToken = user.getDataValue("accessToken");

  try {
    accessToken = await refreshTokenIfNeeded(user);

    const res = await axios.get(
      "https://msapi.top-academy.ru/api/v2/schedule/operations/get-by-date",
      {
        params: { date_filter: date },
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Origin: "https://journal.top-academy.ru",
          Referer: "https://journal.top-academy.ru",
        },
      }
    );

    const lessons = res.data;
    if (!lessons || lessons.length === 0) return `📭 На ${date} занятий нет`;

    scheduleReminders(chatId, lessons, date);

    let text = `📅 Расписание на ${date}:\n\n`;
    for (const lesson of lessons) {
      text += `🔢 Пара: ${lesson.lesson}\n⏰ ${lesson.started_at} – ${lesson.finished_at}\n📖 ${lesson.subject_name}\n👨‍🏫 ${lesson.teacher_name}\n🏫 ${lesson.room_name}\n\n`;
    }

    return text.trim();
  } catch (err: any) {
    if (err.response?.status === 403) {
      try {
        console.log("⚠️ 403 Forbidden — пробуем обновить токен и повторить запрос");
        accessToken = await refreshTokenIfNeeded(user);

        const retryRes = await axios.get(
          "https://msapi.top-academy.ru/api/v2/schedule/operations/get-by-date",
          {
            params: { date_filter: date },
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Origin: "https://journal.top-academy.ru",
              Referer: "https://journal.top-academy.ru",
            },
          }
        );

        const lessons = retryRes.data;
        if (!lessons || lessons.length === 0) return `📭 На ${date} занятий нет`;

        scheduleReminders(chatId, lessons, date);

        let text = `📅 Расписание на ${date}:\n\n`;
        for (const lesson of lessons) {
          text += `🔢 Пара: ${lesson.lesson}\n⏰ ${lesson.started_at} – ${lesson.finished_at}\n📖 ${lesson.subject_name}\n👨‍🏫 ${lesson.teacher_name}\n🏫 ${lesson.room_name}\n\n`;
        }

        return text.trim();
      } catch (retryErr: any) {
        console.error("Повторный запрос после обновления токена не удался:", retryErr.response?.data || retryErr.message);
        return "❌ Не удалось получить расписание (403 Forbidden)";
      }
    }

    console.error("Ошибка при получении расписания:", err.response?.data || err.message);
    return "❌ Не удалось получить расписание";
  }
}


bot.command("login", async (ctx) => {
  const text = ctx.message?.text;
  if (!text) return ctx.reply("❌ Текст команды не найден");

  const parts = text.split(" ");
  if (parts.length < 3) return ctx.reply("Использование: /login <username> <password>");

  const username = parts[1];
  const password = parts[2];
  ctx.reply("Авторизация...");

  try {
    await loginAndSave(ctx.chat.id, username, password);
    ctx.reply("✅ Успешно авторизованы!", {
      reply_markup: new Keyboard()
        .text("📅 Расписание на сегодня")
        .text("📅 Расписание на завтра")
    });

  } catch {
    ctx.reply("❌ Не удалось авторизоваться");
  }
});

bot.command("today", async (ctx) => {
  const date = getLocalDateString(0);
  const schedule = await getSchedule(ctx.chat.id, date);
  ctx.reply(schedule);
});

bot.command("tomorrow", async (ctx) => {
  const date = getLocalDateString(1);
  const schedule = await getSchedule(ctx.chat.id, date);
  ctx.reply(schedule);
});

bot.command("start", async (ctx) => {
  ctx.reply(`Авторизация: /login <name> <pass>\n
Узнать расписание на сегодня: /today\n
Узнать расписание на завтра: /tomorrow`)
});


bot.on("message:text", async (ctx) => {
  const text = ctx.message.text;

  if (text === "📅 Расписание на сегодня") {
    const date = getLocalDateString(0);
    const schedule = await getSchedule(ctx.chat.id, date);
    return ctx.reply(schedule);
  }

  if (text === "📅 Расписание на завтра") {
    const date = getLocalDateString(1);
    const schedule = await getSchedule(ctx.chat.id, date);
    return ctx.reply(schedule);
  }
});

(async () => {
  await sequelize.authenticate();
  // await User.sync({ alter: true });
  console.log("✅ DB connected, bot starting...");
  bot.start();
})();
