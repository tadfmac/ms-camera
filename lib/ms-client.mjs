import Device from "../lib/mediasoup-client-esm.js";
import socketPromise from '../lib/socket.io-promise.js';
import hashids from "../lib/hashids.js";

export default class MSClient {
  constructor(socketClient, config){
    this.device = null;
    this.socketClient = socketClient;
    this.request = socketPromise(this.socketClient);
    this.trpData = null;
    this.config = config;
    this.type = null;             // "caster" or "viewer"
    this.caster = null;           // only used by caster
    this.sendTransport = null;    // only used by caster
    this.viewer = null;           // only used by viewer
    this.receiveTransport = null; // only used by viewer
//    this.consumer = null;         // only used by viewer
  }

  getCasterId(){
    let ids = new hashids(""+Date.now()+Math.random(),5);
    return ids.encode(1234);
  }

  async init(type){
    this.type = type;
    this.socketClient.on('connect', async (socket) => {
      console.log("socket event (connect) recieved");
      try {
        const data = await this.request('getRouterRtpCapabilities');
        await this.loadDevice(data);
        if(this.type == "caster"){
          this.caster = {id:this.getCasterId(), cams:{}};
          this.trpData = await this.request('addCaster',this.caster);
          this.sendTransport = await this.createSendTransport(this.trpData);
          this.socketClient.on("resumeCam", async (camid) => {
            console.log("resumeCam: "+camid);
            await this.resumeCam(camid);
          });
          this.socketClient.on("pauseCam", async (camid) => {
            console.log("pauseCam: "+camid);
            await this.pauseCam(camid);
          });
        }else if(this.type == "viewer"){
          this.viewer = {id:this.getCasterId(), consumer:null};
          this.trpData = await this.request('addViewer',this.viewer.id);
          this.receiveTransport = await this.createReceiveTransport(this.trpData);
          this.socketClient.on("consumerClosed", async (data) => {
            console.log("consumerClosed: caster:["+data.casterId+"] cam:["+data.camName+"]");
          });
        }
      }catch (err) {
        console.log("MSClient.init(onconnect) err : "+err);
      }
    });
  }

  async loadDevice(routerRtpCapabilities) {
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
    if(this.type != "caster"){
      console.log("createSendTransport() must be called by caster");
      return;
    }
    const transport = this.device.createSendTransport(trpData.params);
    transport.on('connect', async ({ dtlsParameters }, callback, errback) => {
      console.log("transport.on(connect)");
      this.request('connectProducerTransport', { trpData, dtlsParameters })
        .then(callback)
        .catch(errback);
    });

    transport.on('produce', async (data , callback, errback) => {
      console.log("transport.on(produce):");
      console.dir(data);
      const { kind, rtpParameters, appData } = data;
      let camid = appData.camid;
      try {
        const { id } = await this.request('produce', {
          trpData,
          camid,
          transportId: transport.id,
          kind,
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

  async produceCam(stream,camid) {
    console.log("produceCam() : "+camid);
    if(this.type != "caster"){
      console.log("produceCam() must be called by caster");
      return;
    }
    try {
      if(camid in this.caster.cams){
        if(this.caster.cams[camid].producer != null){
          this.caster.cams[camid].producer.close();
        }
      }else{
        this.caster.cams[camid] = {id:camid, producer:null, viewers:{}};
      }
      const track = stream.getVideoTracks()[0];
      const params = { track , appData:{camid}};
      this.caster.cams[camid].producer = await this.sendTransport.produce(params);
      this.caster.cams[camid].producer.pause(); // 最初はpauseしとく -> call
      return this.caster.cams[camid].producer;
    } catch (err) {
      console.log("publish() err : "+err);
    }
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
          this.caster.cams[camid].producer.close();
          await this.request('closeCam', {caster:this.caster.id, camid:camid} );
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
    if(this.type != "caster"){
      console.log("pauseCam() must be called by caster");
      return;
    }
    try {
      console.log("pauseCam() : camid : "+camid);
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
    if(this.type != "viewer"){
      console.log("createReceiveTransport() must be called by viewer");
      return;
    }
    try {
      console.log("createReceiveTransport()");
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

  async startConsume(casterId,camName) {
    if(this.type != "viewer"){
      console.log("startConsume() must be called by viewer");
      return;
    }
    try {
      console.log("startConsume(): casterId:"+casterId+" camName:"+camName);
      const { rtpCapabilities } = this.device;
      const data = await this.request('consume', { casterId,camName,rtpCapabilities });
      if(data){ // produceまだされてないこともあるので
        const { producerId, id, kind, rtpParameters} = data;
        let codecOptions = {};
        this.viewer.consumer = await this.receiveTransport.consume({id,producerId,kind,rtpParameters,codecOptions});
        await this.request('resume');
        let stream = new MediaStream();
        stream.addTrack(this.viewer.consumer.track);
        return stream;
      }
    } catch (err) {
      console.log("startConsume() err : "+err);
    }
  }

  async stopConsume(casterId,camName) {
    if(this.type != "viewer"){
      console.log("stopConsume() must be called by viewer");
      return;
    }
    const data = await this.request('stopConsume', { casterId,camName});
  }
}

