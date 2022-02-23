import fs from 'fs';
import https from 'https';
import express from 'express';
import {Server} from 'socket.io';
import config from './lib/config.json' assert {type:"json"};
import path from 'path';
import msServer from './lib/ms-server.mjs';

const dirname = path.dirname(new URL(import.meta.url).pathname);

// Global variables
let webServer;
let socketServer;
let expressApp;
let msSrv;

(async () => {
  try {
    await runExpressApp();
    await runWebServer();
    await runSocketServer();
    msSrv = new msServer(socketServer,config);
    await msSrv.init();
  } catch (err) {
    console.error(err);
  }
})();

async function runExpressApp() {
  expressApp = express();
  expressApp.use(express.json());
  expressApp.use(express.static(dirname));

  expressApp.use((error, req, res, next) => {
    if (error) {
      console.warn('Express app error,', error.message);

      error.status = error.status || (error.name === 'TypeError' ? 400 : 500);

      res.statusMessage = error.message;
      res.status(error.status).send(String(error));
    } else {
      next();
    }
  });
}

async function runWebServer() {
  const { sslKey, sslCrt } = config;
  if (!fs.existsSync(sslKey) || !fs.existsSync(sslCrt)) {
    console.error('SSL files are not found. check your config.js file');
    process.exit(0);
  }
  const tls = {
    cert: fs.readFileSync(sslCrt),
    key: fs.readFileSync(sslKey),
  };
  webServer = https.createServer(tls, expressApp);
  webServer.on('error', (err) => {
    console.error('starting web server failed:', err.message);
  });

  await new Promise((resolve) => {
    const { listenIp, listenPort } = config;
    webServer.listen(listenPort, listenIp, () => {
      const listenIps = config.mediasoup.webRtcTransport.listenIps[0];
      const ip = listenIps.announcedIp || listenIps.ip;
      console.log('server is running');
      console.log(`open https://${ip}:${listenPort} in your web browser`);
      resolve();
    });
  });
}

async function runSocketServer() {
  socketServer = new Server(webServer, {
    serveClient: false,
    path: '/server',
    log: false,
  });
}
