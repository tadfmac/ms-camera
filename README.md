in development!

# Mediasoup Sample App (ESM Version)

A minimal Client/Server app based on Mediasoup and Socket.io

## Dependencies

* [Mediasoup v3 requirements](https://mediasoup.org/documentation/v3/mediasoup/installation/#requirements)
* Node.js >= v17.5
* [rollup.js](https://rollupjs.org/guide/en/)
* [socket.io](https://socket.io)
* [express](https://expressjs.com)
* [hashids](https://hashids.org/javascript/)

## Run

The server app runs on any supported platform by Mediasoup.
The following client apps runs on each browser tabs.
- /cam/ : media sender app
- /viewer/ : media viewer app

```
# modify the configuration 
# make sure you set the proper IP for mediasoup.webRtcTransport.listenIps
cp config.skelton.json config.json
nano config.json

# install dependencies and build mediasoup
npm install

# create the client bundle
npm run build

## start the server app
npm start
```

## Based on

- https://github.com/mkhahani/mediasoup-sample-app
- https://github.com/daily-co/mediasoup-client-script-build


