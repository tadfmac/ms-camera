export default {
  ipWhiteList:[
    "127.0.0.1"
  ],
  basicAuth:{
    id:"your-id",
    pass:"your-password"
  },
  iceServers:[
  ],
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
             "x-google-start-bitrate": 200000
           }
        }
      ]
    },
    webRtcTransport: {
      listenIps: [
        {
          ip: "0.0.0.0",
          announcedIp: "your-server-global-ip-here"
        },
        {
          ip: "127.0.0.1"
        }
      ],
      "maxIncomingBitrate": 3000000,
      "initialAvailableOutgoingBitrate": 2000000
    }
  }
}
