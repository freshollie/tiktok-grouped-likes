process.env.DEBUG = "like-bot:*"

import { Cluster } from "puppeteer-cluster";
import stealth from "./stealth";
import debug from "debug";
import { TaskFunction } from "puppeteer-cluster/dist/Cluster";

const getRandomInt = (min: number, max: number): number => {
  const bMin = Math.ceil(min);
  const bMax = Math.floor(max);
  return Math.floor(Math.random() * (bMax - bMin + 1)) + bMin;
}


const SESSIONID = process.env.SESSIONID || "";
const USERS = process.env.USERS;
const loginCookies = [
  {
    name: 'sessionid',
    value: SESSIONID,
    domain: '.tiktok.com',
    path: '/',
    size: 41,
    httpOnly: true,
    secure: false,
    session: false
  },
  {
    name: 'sessionid_ss',
    value: SESSIONID,
    domain: '.tiktok.com',
    path: '/',
    size: 44,
    httpOnly: true,
    secure: true,
    session: false
  }
];

type BotData = { username: string, log: debug.Debugger, lastLiked?: string };
const doLikes: TaskFunction<BotData, string | undefined> = async ({ page, data: { log, username, lastLiked } }) => {
  log(`starting work`);

  await page.setRequestInterception(true);
  page.on('request', (request) => {
    if (['video', 'image'].indexOf(request.resourceType()) !== -1) {
      request.abort();
    } else {
      request.continue();
    }
  });

  await page.setCookie(...loginCookies);
  await page.evaluateOnNewDocument(`() => {
        delete navigator.__proto__.webdriver;
            }`)
  await stealth(page);

  await page.emulate({
    'userAgent': "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.0 Safari/537.36)",
    'viewport': { 'width': getRandomInt(1280, 1920), 'height': getRandomInt(720, 1920), },
    'deviceScaleFactor': getRandomInt(1, 3),
    'isMobile': Math.random() > 0.5,
    'hasTouch': Math.random() > 0.5
  } as any);

  log(`loading tiktok`);
  await page.goto(`https://www.tiktok.com/@${username}?lang=en`, {
    'waitUntil': "domcontentloaded"
  });



  // go to likes
  await Promise.race([page.waitFor(".error-page"), page.waitFor(".video-feed-item-wrapper")])

  log(`loading liked videos`);
  const likes = await page.waitFor(".like")
  await likes.click();

  await Promise.race([page.waitFor(".error-page"), page.waitFor(".video-feed-item-wrapper")])
  if (await page.$(".error-page")) {
    throw new Error("user doesn't have likes public");
  }

  for (let i = 0; i < 2; i++) {

    if (lastLiked && await page.$(`.video-feed-item-wrapper[href='${lastLiked}']`)) {
      break;
    }
    
    // scroll to bottom, wait for next page to load
    await page.evaluate(() => document.querySelector(".video-feed-item:last-child")?.scrollIntoView());

    if (await page.waitFor(".tiktok-loading.feed-loading", { timeout: 1000 }).then(() => true).catch(() => false)) {
      await page.waitFor(() => !document.querySelector(".tiktok-loading.feed-loading"));
    } else {
      break;
    }
  }

  log(`starting likes`);
  if (lastLiked) {
    log(`starting from last liked video: ${lastLiked}`)
  };

  let startVideo = await page.$(lastLiked ? 
    `.video-feed-item-wrapper[href='${lastLiked}']` : 
    ".video-feed-item:last-child .video-feed-item-wrapper"
  )

  if (!startVideo) {
    startVideo = await page.waitFor(".video-feed-item:last-child .video-feed-item-wrapper")
  }

  await startVideo.click();

  let likedVideos = 0;
  let checkedVideos = 0;
  let lastVideo: string;

  while (true) {
    lastVideo = page.url().split("?")[0];
    log(`checking ${lastVideo}`)
    checkedVideos += 1;
    const likebutton = await page.waitFor(".icons.like");

    let shouldLike = await page.$(".icons.like:not(.liked")
    if (shouldLike) {
      log(`liking ${lastVideo}`)
      await likebutton.click();
      likedVideos += 1;
    }

    try {
      const nextButton = await page.waitFor(".control-icon.arrow-left", { timeout: 1000 });
      await nextButton.click();
    } catch (e) {
      // if there is no next button in the page, we are at the end of the videos
      if (!await page.$(".control-icon.arrow-left")) {
        break;
      }
    }
    if (shouldLike) {
      // wait some time
      await page.waitFor(1000 + Math.random() * 1000);
    }
  }

  log(`Checked ${checkedVideos} videos, added ${likedVideos} to likes`)
  return lastVideo;
}


(async () => {
  if (!USERS) {
    console.error("USERS is a required environment variable");
    return;
  }

  if (!SESSIONID) {
    console.error("SESSIONID is a required environment variable");
    return;
  }

  const usernames = USERS.split(",");
  console.log("STARTING BOT")
  console.log(`Grouping ${usernames} likes`)

  const cluster: Cluster<BotData, string | undefined> = await Cluster.launch({
    concurrency: Cluster.CONCURRENCY_CONTEXT,
    maxConcurrency: Number(process.env.CONCURRENCY) || 3,
    timeout: 10 * 60 * 1000,
    puppeteerOptions: {
      headless: true,
      executablePath: '',
      args: [
        // Required for Docker version of Puppeteer
        '--no-sandbox',
        '--disable-setuid-sandbox',
        // This will write shared memory files into /tmp instead of /dev/shm,
        // because Docker’s default for /dev/shm is 64MB
        '--disable-dev-shm-usage'
      ]
    }
  });

  cluster.task(doLikes);
  await Promise.all(usernames.map(async (user) => {
    const log = debug(`like-bot:${user}`);
    let lastLiked: string | undefined;
    while (true) {
      try {
        lastLiked = await cluster.execute({ username: user, log, lastLiked });
      } catch (e) {
        log(`something went wrong during likes`, e);
      }
      const sleep = Math.round(30 * 1000 + Math.random() * 60 * 1000);
      log(`sleeping for ${sleep}ms`);
      await new Promise(resolve => setTimeout(resolve, sleep))
    }
  }));

  await cluster.idle();
  await cluster.close();
})()

