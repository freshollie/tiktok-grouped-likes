import { launch } from "puppeteer";

(async () => {
  console.log("Please login when prompted and then wait for window to close")
  const browser = await launch({ "headless": false })
  const page = await browser.newPage()
  await page.goto("https://www.tiktok.com/login/phone-or-email/email?lang=en", { 'waitUntil': "load" })
  await page.waitForNavigation({ "timeout": 9999999 });
  console.log(`SESSION_ID: ${(await page.cookies()).find((cookie) => cookie.name === "sessionid")?.value}`);
  await browser.close();
})()
