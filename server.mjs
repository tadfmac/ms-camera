import fs from 'fs';
import http from 'http';
import express from 'express';
import auth from 'basic-auth';
import cors from 'cors';　
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
    msSrv = new msServer(socketServer,config,dirname);
    await msSrv.init();
  } catch (err) {
    console.error(err);
  }
})();

async function runExpressApp() {
  expressApp = express();
  expressApp.use(express.json());
  expressApp.use(basicauth);
  expressApp.use(cors());
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

function basicauth(request, response, next) {
  var user = auth(request);
  console.log(user);
  if (!user || config.basicAuth.id !== user.name || config.basicAuth.pass !== user.pass) {
    response.set('WWW-Authenticate', 'Basic realm="401"');
    return response.status(401).send();
  }
  return next();
};

async function runWebServer() {
  webServer = http.createServer(expressApp);
  webServer.on('error', (err) => {
    console.error('starting web server failed:', err.message);
  });

  await new Promise((resolve) => {
    const { listenIp, listenPort } = config;
    webServer.listen(listenPort, listenIp, () => {
      const listenIps = config.mediasoup.webRtcTransport.listenIps[0];
      const ip = listenIps.announcedIp || listenIps.ip;
      console.log('server is running');
      console.log(`open http://${ip}:${listenPort} in your web browser`);
      resolve();
    });
  });
}

async function runSocketServer() {
  socketServer = new Server(webServer, {
    serveClient: false,
    path: '/ws',
    log: false,
  });
}
