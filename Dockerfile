FROM buildkite/puppeteer:v3.0.4
WORKDIR /likesbot

COPY . .

RUN PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true yarn
CMD [ "yarn", "start" ]
