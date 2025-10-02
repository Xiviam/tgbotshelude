import { Bot } from "grammy";

// Жёстко прописанный токен
const bot = new Bot("8276489760:AAExH_s9ZMH-wX76tKl8dnusBZtan8g-giA");

console.log("🚀 Бот запускается...");

// Простая команда для проверки
bot.command("start", (ctx) => ctx.reply("Бот работает!"));

// Запуск бота
bot.start();
