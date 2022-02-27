export default {
  basicAuth:{
    id:"camguest",
    pass:"4191333"
  },
  thumbnailPath:"/thumbnail",
  listenIp: "127.0.0.1",
  listenPort: 4000,
  mediasoup: {
    worker: {
      rtcMinPort: 10000,
      rtcMaxPort: 10100,
      logLevel: "warn",
      logTags: [
        "info",
        "ice",
        "dtls",
        "rtp",
        "srtp",
        "rtcp"
      ]
    },
    router: {
      mediaCodecs:[
        {
          kind: "audio",
          mimeType: "audio/opus",
          clockRate: 48000,
          channels: 2
        },
        {
          kind: "video",
          mimeType: "video/VP8",
          clockRate: 90000,
          parameters:
           {
             "x-google-start-bitrate": 2000000
           }
        }
      ]
    },
    webRtcTransport: {
      listenIps: [
        {
          ip: "0.0.0.0",
          announcedIp: "140.227.127.187"
        },
        {
          ip: "127.0.0.1"
        }
      ],
      "maxIncomingBitrate": 5000000,
      "initialAvailableOutgoingBitrate": 4000000
    }
  }
}
