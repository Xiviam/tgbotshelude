import { Bot } from "grammy";
import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

import { sequelize, User } from "./db";
import { encrypt } from "./cryptoUtil";

const bot = new Bot(process.env.BOT_TOKEN!);

// 🔹 Получение локальной даты YYYY-MM-DD (+ смещение по дням)
function getLocalDateString(offsetDays = 0): string {
  const now = new Date();
  now.setDate(now.getDate() + offsetDays);
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// 🔹 Планирование напоминаний
function scheduleReminders(chatId: number, lessons: any[], date: string) {
  const now = new Date();

  for (const lesson of lessons) {
    const [hour, minute] = lesson.started_at.split(":").map(Number);

    const lessonTime = new Date(date + "T00:00:00");
    lessonTime.setHours(hour, minute, 0, 0);

    // За 5 минут до пары
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
        `Напоминание для чата ${chatId} запланировано на ${reminderTime.toLocaleString()}`
      );
    }
  }
}

// 🔹 Логин через API и сохранение в БД
async function loginAndSave(chatId: number, username: string, password: string) {
  try {
    const res = await axios.post(
      "https://msapi.top-academy.ru/api/v2/auth/login",
      {
        application_key: process.env.APPLICATION_KEY,
        id_city: null,
        username,
        password,
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

// 🔹 Получение расписания на произвольную дату
async function getSchedule(chatId: number, date: string) {
  const user = await User.findOne({ where: { chatId } });
  if (!user) return "❌ Сначала авторизуйтесь";

  const accessToken = user.getDataValue("accessToken");

  try {
    const res = await axios.get(
      "https://msapi.top-academy.ru/api/v2/schedule/operations/get-by-date",
      {
        params: { date_filter: date },
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json, text/plain, */*",
          Origin: "https://journal.top-academy.ru",
          Referer: "https://journal.top-academy.ru/",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
        },
      }
    );

    const lessons = res.data;
    if (!lessons || lessons.length === 0) {
      return `📭 На ${date} занятий нет`;
    }

    // Планируем напоминания
    scheduleReminders(chatId, lessons, date);

    let text = `📅 Расписание на ${date}:\n\n`;
    for (const lesson of lessons) {
      text +=
        `🔢 Пара: ${lesson.lesson}\n` +
        `⏰ ${lesson.started_at} – ${lesson.finished_at}\n` +
        `📖 ${lesson.subject_name}\n` +
        `👨‍🏫 ${lesson.teacher_name}\n\n`
    }

    return text.trim();
  } catch (err: any) {
    console.error(err.response?.data || err.message);
    return "❌ Не удалось получить расписание";
  }
}

// 🔹 Команда /login
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
    ctx.reply("✅ Успешно авторизованы!");
  } catch {
    ctx.reply("❌ Не удалось авторизоваться");
  }
});

// 🔹 Команда /today
bot.command("today", async (ctx) => {
  const date = getLocalDateString(0);
  const schedule = await getSchedule(ctx.chat.id, date);
  ctx.reply(schedule);
});

// 🔹 Команда /tomorrow
bot.command("tomorrow", async (ctx) => {
  const date = getLocalDateString(1);
  const schedule = await getSchedule(ctx.chat.id, date);
  ctx.reply(schedule);
});

// 🔹 Старт бота
(async () => {
  await sequelize.authenticate();
  await User.sync();
  console.log("✅ DB connected, bot starting...");
  bot.start();
})();
