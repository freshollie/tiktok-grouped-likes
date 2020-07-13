# TikTok Grouped Likes
> Like the videos your friends like

## About
Group viewing tiktok on a TV is fun, but tiktok doesn't let you group liked videos into a steady stream (no group chats, no group accounts).

This program automatically likes the tiktok videos of the provided users, so that your group's liked videos all end up on a single account.

It was written pretty quickly, and not really something I care too much about. No tests, no linting yet. 

## Usage

Requirements: `node v12+`

Install dependencies

```
yarn
```

Get your group account session token (their captchas are too hard to solve)
```
yarn authenticate
```

Run the bot, it's best to keep it running all the time so that likes
trickled in in the order which your users like them.
```bash
$ SESSION_ID=example_session_id USERS=a,b,c,d yarn start
```


## Disclaimer

I do not recommend authenticating with an account which you care about,
it's highly likely that tiktok will notice the likes are being botted and
ban the account.

## Under the hood

Tiktoks API is extremely secure. Liking directly via API does not seem to be viable as they detect exactly what's going on.

This program works by using headless browsers to like the videos using the TikTok web UI. It works relatively quickly.
