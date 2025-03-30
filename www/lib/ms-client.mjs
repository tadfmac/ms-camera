import Device from "../lib/mediasoup-client-esm.js";
import socketPromise from '../lib/socket.io-promise.js';
import hashids from "../lib/hashids.js";

export default class MSClient {
  constructor(socketClient, config){
    this.COOLDOWNTIME = 2000;
    this.timer = null;
    this.device = null;
    this.socketClient = socketClient;
    this.request = socketPromise(this.socketClient);
    this.trpData = null;
    this.config = config;
    this.type = null;             // "caster" or "viewer"
    this.caster = null;           // only used by caster
    this.viewer = null;           // only used by viewer
    this.onUpdateViewer = null;
    this.onResumeCam = null;
    this.onPauseCam = null;
    this.onInitCompleted = null;
    this.onConsumerClosed = null;
  }

  getId(){
    let ids = new hashids(""+Date.now()+Math.random(),5);
    return ids.encode(1234);
  }

  async init(type){
    console.log("init() called");
    this.type = type;
    if(this.type == "caster"){
      this.caster = {id:this.getId(), cams:{}, transport:null};
    }else if(this.type == "viewer"){
      this.viewer = {id:this.getId(), transport:null, consumer:null};
    }
    this.socketClient.on('connect', async (socket) => {
      console.log("socket event (connect) recieved");
      try {
        const data = await this.request('getRouterRtpCapabilities');
        await this.loadDevice(data);
        if(this.type == "caster"){
          this.caster.transport = null;
          this.trpData = await this.request('addCaster',this.caster);
          this.caster.transport = await this.createSendTransport(this.trpData);
          this.socketClient.on("resumeCam", async (camid) => {
            console.log("resumeCam: "+camid);
            await this.resumeCam(camid);
            if((this.onResumeCam != null)&&(typeof this.onResumeCam === 'function')){
              this.onResumeCam(this.caster.cams[camid]);
            }
          });
          this.socketClient.on("pauseCam", async (camid) => {
            console.log("pauseCam: "+camid);
            await this.pauseCam(camid);
            if((this.onPauseCam != null)&&(typeof this.onPauseCam === 'function')){
              this.onPauseCam(this.caster.cams[camid]);
            }
          });
          this.socketClient.on("updateViewer", async (cams) => {
            console.log("updateViewer ");
            if((this.onUpdateViewer != null)&&(typeof this.onUpdateViewer === 'function')){
              this.onUpdateViewer(cams);
            }
          });
        }else if(this.type == "viewer"){
          this.viewer.transport = null;
          this.trpData = await this.request('addViewer',this.viewer.id);
          this.viewer.transport = await this.createReceiveTransport(this.trpData);
          this.socketClient.on("consumerClosed", async (data) => {
            console.log("consumerClosed: caster:["+data.casterId+"] cam:["+data.camName+"]");
            if((this.onConsumerClosed != null)&&(typeof this.onConsumerClosed === 'function')){
              this.onConsumerClosed(data);
            }
          });
        }
        if((this.onInitCompleted != null)&&(typeof this.onInitCompleted === 'function')){
          this.onInitCompleted();
        }
      }catch (err) {
        console.log("MSClient.init(onconnect) err : "+err);
      }
    });
  }

  async loadDevice(routerRtpCapabilities) {
    console.log("loadDevice()");
    try {
      this.device = new Device();
    } catch (error) {
      if (error.name === 'UnsupportedError') {
        console.error('browser not supported');
      }
    }
    await this.device.load({ routerRtpCapabilities });
  }

  async createSendTransport(trpData){
    console.log("createSendTransport()");
    if(this.type != "caster"){
      console.log("createSendTransport() must be called by caster");
      return;
    }
    if(this.config.iceServers){
      trpData.params.iceServers = this.config.iceServers;
    }
    const transport = this.device.createSendTransport(trpData.params);
    transport.on('connect', async ({ dtlsParameters }, callback, errback) => {
      console.log("transport.on(connect)");
      this.request('connectProducerTransport', { trpData, dtlsParameters })
        .then(callback)
        .catch(errback);
    });

    transport.on('produce', async (data , callback, errback) => {
      console.log("transport.on(produce):"+trpData.id);
      console.dir(data);
      const { kind, rtpParameters, appData } = data;
      let camid = appData.camid;
      let camName = appData.camName;
      try {
        const { id } = await this.request('produce', {
          trpData,
          camid,
          transportId: transport.id,
          kind,
          camName,
          rtpParameters
        });
        callback({ id });
      } catch (err) {
        errback(err);
      }
    });

    transport.on('connectionstatechange', (state) => {
      console.log("transport.on(connectionstatechange) : "+state);
      switch (state) {
      case 'failed':
        transport.close();
        break;
      default: break;
      }
    });
    return transport;
  }

  async produceCam(stream,camid,_camName) {
//    if(this.checkInCooldown()){
//      return null;
//    }
//    await this.wait(this.COOLDOWNTIME+1000);
    console.log("produceCam() : "+camid);
    if(this.type != "caster"){
      console.log("produceCam() must be called by caster");
      return;
    }
    try {
      console.dir(this.caster);
      if(camid in this.caster.cams){
        if(this.caster.cams[camid].producer != null){
          this.caster.cams[camid].producer.close();
        }
      }else{
        this.caster.cams[camid] = {id:camid, producer:null, viewers:{}, camName:_camName};
        console.dir(this.caster.cams[camid]);
      }
      const track = stream.getVideoTracks()[0];

      let file = await this.takeThumbnail(track,128);
console.log("@@@@@@@@@");
console.dir(file);
      await this.request('saveThumbnail', { casterId:this.caster.id, camId:camid , file });
      file = null;

      const params = { track , appData:{camid, camName:_camName}};
//      params.codec = this.device.rtpCapabilities.codecs.find(codec => codec.mimeType.toLowerCase() === "video/h264");
      this.caster.cams[camid].producer = await this.caster.transport.produce(params);
      this.caster.cams[camid].producer.pause(); // 最初はpauseしとく -> call

      return this.caster.cams[camid].producer;
    } catch (err) {
      console.log("publish() err : "+err);
    }
  }

  async takeThumbnail(track,width){
    console.log("takeThumbnail() called");
    await this.wait(500);
    const imageCapture = new ImageCapture(track);
    let data = await new Promise(async (resolve)=>{
      let bitmap = await imageCapture.grabFrame();
      const $cvs = document.createElement('canvas');
      let ctx = $cvs.getContext('2d');
      $cvs.width = width;
      $cvs.height = Math.floor(bitmap.height / (bitmap.width / width));
      $cvs.getContext('2d').drawImage(bitmap,0,0,bitmap.width,bitmap.height,0,0,$cvs.width,$cvs.height);
      resolve($cvs.toDataURL("image/jpeg")); 
    });
    return data;
  }

  async closeCam(camid){
    console.log("closeCam() : "+camid);
    if(this.type != "caster"){
      console.log("closeCam() must be called by caster");
      return;
    }
    try {
      if(camid in this.caster.cams){
        if(this.caster.cams[camid].producer != null){
//          await this.caster.cams[camid].producer.pause();
//          await this.wait(500);
          await this.request('closeCam', {caster:this.caster.id, camid:camid} );
          await this.caster.cams[camid].producer.close();
          delete this.caster.cams[camid];
        }
      }else{
        console.log("closeCam err: camid["+camid+"] not exist");
      }
    } catch (err) {
      console.log("closeCam() err : "+err);
    }

  }

  async resumeCam(camid){
    console.log("resumeCam()");
    if(this.type != "caster"){
      console.log("resumeCam() must be called by caster");
      return;
    }
    try {
      console.log("resumeCam() : camid : "+camid);
      if(camid in this.caster.cams){
        if(this.caster.cams[camid].producer != null){
          console.log("resumeCam: "+camid);
          await this.caster.cams[camid].producer.resume();
        }
      }
    } catch (err){
      console.log("resumeCam() err : "+err);
    }
  }

  async pauseCam(camid){
    console.log("pauseCam() : camid : "+camid);
    if(this.type != "caster"){
      console.log("pauseCam() must be called by caster");
      return;
    }
    try {
      if(camid in this.caster.cams){
        if(this.caster.cams[camid].producer != null){
          console.log("pauseCam: "+camid);
          await this.caster.cams[camid].producer.pause();
        }
      }
    } catch (err){
      console.log("pauseCam() err : "+err);
    }
  }

  async createReceiveTransport(trpData){
    console.log("createReceiveTransport()");
    if(this.type != "viewer"){
      console.log("createReceiveTransport() must be called by viewer");
      return;
    }
    try {
      if(this.config.iceServers){
        trpData.params.iceServers = this.config.iceServers;
      }
      const transport = this.device.createRecvTransport(trpData.params);
      transport.on('connect', ({ dtlsParameters }, callback, errback) => {
        this.request('connectConsumerTransport', {trpData,dtlsParameters})
          .then(callback)
          .catch(errback);
      });
      transport.on('connectionstatechange', async (state) => {
        console.log("transport.on(connectionstatechange) : "+state);
        switch (state) {
        case 'connected':
          console.log("transport: connected.");
          break;
        case 'failed':
          console.log("transport: failed.");
          transport.close();
          break;
        default: break;
        }
      });
      return transport;
    } catch (err){
      console.log("resumeCam() err : "+err);
    }
  }

  async startConsume(casterId,camId) {
    if(this.checkInCooldown()){
      return null;
    }
    console.log("startConsume(): casterId:"+casterId+" camId:"+camId);
    if(this.type != "viewer"){
      console.log("startConsume() must be called by viewer");
      return null;
    }
    try {
      const { rtpCapabilities } = this.device;
      const data = await this.request('consume', { casterId,camId,rtpCapabilities });
      if(data){ // produceまだされてないこともあるので
        const { producerId, id, kind, rtpParameters} = data;
        let codecOptions = {};
        this.viewer.consumer = await this.viewer.transport.consume({id,producerId,kind,rtpParameters,codecOptions});
        await this.request('resume');
        let stream = new MediaStream();
        stream.addTrack(this.viewer.consumer.track);
        return stream;
      }
    } catch (err) {
      console.log("startConsume() err : "+err);
      return null;
    }
  }

  async stopConsume(casterId,camId) {
    console.log("stopConsume(): casterId:"+casterId+" camId:"+camId);
    if(this.type != "viewer"){
      console.log("stopConsume() must be called by viewer");
      return;
    }
    const data = await this.request('stopConsume', { casterId,camId});
  }

  async wait(time){
    return new Promise((resolve)=>{
      setTimeout(()=>{
        resolve();
      },time);
    });
  }

  checkInCooldown(){
    if(this.timer != null){
      console.log("checkInCooldown() waiting next action");
      return true;
    }
    console.log("checkInCooldown() timer start");
    this.timer = setTimeout((e)=>{
      console.log("checkInCooldown() cooldown timer expired");
      this.timer = null;
    },this.COOLDOWNTIME);
    return false;
  }
}

