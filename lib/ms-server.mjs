/*

  mediasoupを使ったかなり用途の限られるメディアサーバ

  - clientは caster (配信専用) と viewer (受信専用) いずれか
    - つまり片方向配信

  - client 1つにつき 1つの transport
    - videoのみproduce可能 (audio非対応)
    - transportに複数のvideoをproduce可能 (になる予定 ※serverとしては。client次第)

  - websocket (socket.io) でsignaling

*/


import mediasoup from 'mediasoup';
import path from 'path';

const dirname = path.dirname(new URL(import.meta.url).pathname);

export default class MediasoupServer {
  constructor(socketServer, config){
    this.cons = {};
    this.casters = {};
    this.viewers = {};
    this.config = config;
    this.socketServer = socketServer;
    this.worker = null;
    this.mediasoupRouter = null;
  }
  async init(){
    /* 
      Todo:

      現状、WebRTCTransportの死活をSignalingのWSのConnectionと同期している。
      WS瞬断して再接続時にもいちいちWebRTC貼り直しになってしまうので、
      WS「瞬断」を検出して、瞬断の間はWebRTCTransportを維持できるようにしたい。
    */

    this.socketServer.on('connection', (socket) => {
      console.log("socket event (connection) recieved : "+socket.id);
      this.cons[socket.id] = {
        id:socket.id,
        viewer:null,
        caster:null
      };

      // Viewer -> Server (起動時すぐ) server側のtransport を作って返す
      socket.on("addViewer", async (_viewer, callback)=>{
        console.log("socket event (addViewer) recieved id: "+socket.id+" viewer: "+_viewer);
        this.cons[socket.id].viewer = _viewer;

        socket.broadcast.emit("join",_viewer);
        const wrtcTrpt = await this.createWebRtcTransport();
        this.viewers[_viewer] = {
          viewer:_viewer,
          socketid:socket.id,
          transport: wrtcTrpt.transport,
          params: wrtcTrpt.params,
          consumer:null,
          casterId:null,
          camName:null
        };
        callback(this.viewers[_viewer]);
        this._sendViewers(socket);
        this.socketServer.to(socket.id).emit("updateCasters",this._makeCasterArr());
      });

      // Cam -> Server (起動時すぐ) server側のtransport を作って返す
      socket.on("addCaster", async (_caster, callback)=>{
        console.log("socket event (addCaster) recieved id: "+socket.id+" caster id: "+_caster.id);
        this.cons[socket.id].caster = _caster;
        const wrtcTrpt = await this.createWebRtcTransport();
        this.casters[_caster.id] = {
          id:_caster.id,
          cams:_caster.cams,
          socketid:socket.id,
          transport: wrtcTrpt.transport,
          params: wrtcTrpt.params
        };
        callback(this.casters[_caster.id]);
        socket.broadcast.emit("updateCasters",this._makeCasterArr()); // ToDo: 他のCamにも送ってるので修正
      });

      socket.on('disconnect', async () => {
        console.log("socket event (disconnect) recieved : "+socket.id);
        if(this.cons[socket.id].viewer != null){
          let viewer = this.cons[socket.id].viewer;
          socket.broadcast.emit("leave",viewer);
          let casterId = this.viewers[viewer].casterId;
          let camName = this.viewers[viewer].camName;
          await this.closeConsumer(viewer,casterId,camName); // 接続中のconsumerを解除
          this.viewers[viewer].transport.close();
          delete this.viewers[viewer];
          this._sendViewers(socket);
        }
        if(this.cons[socket.id].caster != null){
          let caster = this.cons[socket.id].caster;
          this.casters[caster.id].transport.close();

          Object.keys(this.casters[caster.id].cams).forEach((camName)=>{
            Object.keys(this.casters[caster.id].cams[camName].viewers).forEach((viewer)=>{
              this.viewers[viewer].consumer.close();
              this.socketServer.to(this.viewers[viewer].socketid).emit("consumerClosed",{casterId:caster.id, camName});
              this.viewers[viewer].consumer = null;
              this.viewers[viewer].casterId = null;
              this.viewers[viewer].camName = null;
            });
          });

          delete this.casters[caster.id];
          socket.broadcast.emit("updateCasters",this._makeCasterArr());
        }
        delete this.cons[socket.id];
      });

      socket.on('connect_error', (err) => {
        console.error('client connection error', err);
      });

      socket.on('getRouterRtpCapabilities', (data, callback) => {
        callback(this.mediasoupRouter.rtpCapabilities);
      });

      socket.on('connectProducerTransport', async (casterObj, callback) => {
        console.log("connectProducerTransport()");
        console.dir(casterObj);
        let caster = casterObj.trpData.id;
        let trp = this.casters[caster].transport;
        await trp.connect({ dtlsParameters: casterObj.dtlsParameters });
        callback();
      });

      socket.on('connectConsumerTransport', async (viewerObj, callback) => {
        console.log("connectConsumerTransport()");
        console.dir(viewerObj);
        let viewer = viewerObj.trpData.viewer;
        let trp = this.viewers[viewer].transport;
        await trp.connect({ dtlsParameters: viewerObj.dtlsParameters });
        callback();
      });

      socket.on('produce', async (data, callback) => {
        console.log("produce()");
        const {kind, rtpParameters,trpData, camid} = data;
        console.dir(data);
        let caster = trpData.id;
        let trp = this.casters[caster].transport;
        this.casters[caster].cams[camid].producer = await trp.produce({ kind, rtpParameters });
        callback({ id: this.casters[caster].cams[camid].producer.id });

        // inform clients about new producer
        socket.broadcast.emit('newProducer', this.casters[caster].cams[camid].producer.id);
      });

      socket.on('consume', async (data, callback) => {
        const {casterId, camName, rtpCapabilities} = data;
        let viewer = this.cons[socket.id].viewer;
        console.log("consume() : viewer:"+viewer+" caster:"+casterId+" cam:"+camName);
        callback(await this.createConsumer(casterId, camName, viewer, rtpCapabilities));
      });

      socket.on('resume', async (data, callback) => {
        console.log("resume()");
        let viewer = this.cons[socket.id].viewer;

        await this.viewers[viewer].consumer.resume();
        callback();
      });
    });

    this.worker = await mediasoup.createWorker({
      logLevel: this.config.mediasoup.worker.logLevel,
      logTags: this.config.mediasoup.worker.logTags,
      rtcMinPort: this.config.mediasoup.worker.rtcMinPort,
      rtcMaxPort: this.config.mediasoup.worker.rtcMaxPort,
    });

    this.worker.on('died', () => {
      console.error('mediasoup worker died, exiting in 2 seconds... [pid:%d]', worker.pid);
      setTimeout(() => process.exit(1), 2000);
    });

    const mediaCodecs = this.config.mediasoup.router.mediaCodecs;
    this.mediasoupRouter = await this.worker.createRouter({ mediaCodecs });

  }
  _makeCasterArr(){
    let _Arr = [];
    Object.keys(this.casters).forEach((_id)=>{
      let _cams = [];
      Object.keys(this.casters[_id].cams).forEach((_cam)=>{
        _cams.push(_cam);
      });
      _Arr.push({id:_id, cams:_cams});
    });
    console.log("_makeCasterArr() : ");
    console.dir(_Arr);
    return _Arr;     
  }
  _sendViewers(socket){
    let _viewers = [];
    Object.keys(this.viewers).forEach((viewer)=>{
      _viewers.push(this.viewers[viewer].viewer);
    });
    console.log("_sendViewers()");
    console.dir(_viewers);
    socket.emit("viewers",_viewers);
  }

  async createWebRtcTransport() {
    const {
      maxIncomingBitrate,
      initialAvailableOutgoingBitrate
    } = this.config.mediasoup.webRtcTransport;

    const transport = await this.mediasoupRouter.createWebRtcTransport({
      listenIps: this.config.mediasoup.webRtcTransport.listenIps,
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
      initialAvailableOutgoingBitrate,
    });
    if (maxIncomingBitrate) {
      try {
        await transport.setMaxIncomingBitrate(maxIncomingBitrate);
      } catch (error) {}
    }
    return {
      transport,
      params: {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters
      },
    };
  }

  async createConsumer(casterId, camName, viewer, rtpCapabilities) {
    console.log("createConsumer(): "+casterId+" "+camName+" "+viewer);
    let producer = this.casters[casterId].cams[camName].producer;

    if(producer == null){
      console.error("producer does not created yet.");
      return;
    }

    if (!this.mediasoupRouter.canConsume({producerId: producer.id,rtpCapabilities})){
      console.error('can not consume');
      return;
    }
    try {
      // consumerが既に作られていたら一回解放する
      await this.closeConsumer(viewer);

      this.viewers[viewer].casterId = casterId;
      this.viewers[viewer].camName = camName;
      this.casters[casterId].cams[camName].viewers[viewer] = viewer;
      if(Object.keys(this.casters[casterId].cams[camName].viewers).length == 1){ // 0->1
        console.log("resume : caster: "+casterId+" cam: "+camName)
        let id = this.casters[casterId].socketid;
        this.socketServer.to(id).emit("resumeCam",camName);
      }

      this.viewers[viewer].consumer = await this.viewers[viewer].transport.consume({
        producerId: producer.id,
        rtpCapabilities,
        paused: producer.kind === 'video',
      });

    } catch (error) {
      console.error('consume failed', error);
      return;
    }

    if (this.viewers[viewer].consumer.type === 'simulcast') {
      await this.viewers[viewer].consumer.setPreferredLayers({ spatialLayer: 2, temporalLayer: 2 });
    }

    return {
      producerId: producer.id,
      id: this.viewers[viewer].consumer.id,
      kind: this.viewers[viewer].consumer.kind,
      rtpParameters: this.viewers[viewer].consumer.rtpParameters,
      type: this.viewers[viewer].consumer.type,
      producerPaused: this.viewers[viewer].consumer.producerPaused
    };
  }
  
  async closeConsumer(viewer){
    console.log("closeConsumer()");
    if(this.viewers[viewer].consumer != null){
      this.viewers[viewer].consumer.close();
      let casterId = this.viewers[viewer].casterId;
      let camName = this.viewers[viewer].camName;
      if((casterId != null)&&(camName != null)){
        delete this.casters[casterId].cams[camName].viewers[viewer];
        if(Object.keys(this.casters[casterId].cams[camName].viewers).length == 0){ // 0->1
          let id = this.casters[casterId].socketid;
          this.socketServer.to(id).emit("pauseCam",camName);
        }
      }
    }
  }

}

