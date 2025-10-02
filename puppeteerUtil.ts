import puppeteer from "puppeteer";
import dotenv from "dotenv";
dotenv.config();

interface PuppeteerLoginResult {
  status: number;
  json?: any;
  text?: string;
}

export async function puppeteerLogin(username: string, password: string) {
  const APPLICATION_KEY = process.env.APPLICATION_KEY;
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.goto("https://journal.top-academy.ru/", { waitUntil: "networkidle2", timeout: 30000 });

    const result: PuppeteerLoginResult = await page.evaluate((payload) => {
      return new Promise<PuppeteerLoginResult>((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "https://msapi.top-academy.ru/api/v2/auth/login", true);
        xhr.setRequestHeader("Content-Type", "application/json");
        xhr.withCredentials = true;
        xhr.onload = () => {
          try {
            resolve({ status: xhr.status, json: JSON.parse(xhr.responseText) });
          } catch {
            resolve({ status: xhr.status, text: xhr.responseText });
          }
        };
        xhr.onerror = () => resolve({ status: 0, text: "Network error" });
        xhr.send(JSON.stringify(payload));
      });
    }, {
      application_key: APPLICATION_KEY || null,
      id_city: null,
      username,
      password
    });

    if (result.status >= 200 && result.status < 300 && result.json) {
      const cookies = await page.cookies();
      return { ok: true, data: result.json, cookies };
    } else {
      return { ok: false, status: result.status, body: result.json ?? result.text ?? null };
    }
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  } finally {
    await browser.close();
  }
}
