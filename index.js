'use strict'

const WebSocket = require('ws');

module.exports = (api) => {
  api.registerPlatform('Chronosoft8PuppeteerPlatform', Chronosoft8PuppeteerPlatformPlugin);
}

class Chronosoft8PuppeteerPlatformPlugin
{
  constructor ( log, config, api)
  {
    log('Chronosoft8Puppeteer Platform Plugin loaded');

    this.accessories = new Map();

    this.log    = log;
    this.config = config;
    this.api    = api;

    api.on('didFinishLaunching', () =>
      {
        this.cs8p_ws = new Chronosoft8PuppeteerWebsocket(this.log,this.config.address,this.config.port,this.onShuttersUpdated.bind(this));
        this.cs8p_ws.connect();
      }
    );
  }

  configureAccessory(accessory)
  {
    let log = this.log;

    log('Loading cached accessory: '+accessory.displayName+' ['+accessory.UUID+']');
    this.accessories.set(accessory.UUID,accessory);
  }

  onShuttersUpdated( shutterList )
  {
    let log = this.log;

    // Initialize a set of existing uuids
    let cached_uuid = new Set();
    for ( const uuid of this.accessories.keys() )
    {
      cached_uuid.add(uuid);
    }

    // Check if shutters match uuid
    for( let shutter of shutterList )
    {
      const uuid = this.api.hap.uuid.generate('CS8P shutter '+shutter['name']);
      if ( this.accessories.has(uuid) )
      {
        log('Shutter '+shutter['name']+' found in cached accessories');
        cached_uuid.delete(uuid);
      }
      else
      {
        log('Shutter '+shutter['name']+' not found in cached accessories');
      }
    }

    // Remove cached accessories not found
    for ( const uuid of cached_uuid.keys() )
    {
      let accessory = this.accessories.get(uuid);
      log('Unregistering unknown cached accessory: '+accessory.displayName+' ['+accessory.UUID+']');  
      api.unregisterPlatformAccessories('Chronosoft8PuppeteerPlugin', 'Chronosoft8PuppeteerPlatform', [accessory]);
      this.accessories.delete(uuid);
    }
  }

  addAccessory()
  {
    let log = this.log;

    log('Existing accessories: '+ this.accessories);

    log('Add accessory');

    let rollingShutter = new RollingShutterAccessory(log,this.api,'Cuisine');
    this.api.registerPlatformAccessories('Chronosoft8PuppeteerPlugin', 'Chronosoft8PuppeteerPlatform', [rollingShutter.accessory]);
  }
}

class Chronosoft8PuppeteerWebsocket
{
  constructor ( log,address, port, onShuttersUpdated )
  {
    this.log = log;
    this.ws_url = "ws://"+address+":"+port;
    this.onShuttersUpdated = onShuttersUpdated;
  }

  connect()
  {
    let log = this.log;

    log('Connecting to '+this.ws_url);

    this.socket = new WebSocket(this.ws_url);
    this.socket.onopen    = this.onOpen.bind(this);
    this.socket.onclose   = this.onClose.bind(this);
    this.socket.onmessage = this.onMessage.bind(this);
    this.socket.onerror   = this.onError.bind(this);
  }

  onOpen(event)
  {
    let log = this.log;

    log('Websocket opened');
    let dataGetShutters = { command: 'get_shutters' };
    this.sendData(dataGetShutters);
  }

  onMessage(event)
  {
    let log = this.log;

    var data = JSON.parse(event.data);
    if ( ! 'cs8p' in data )
    {
      log('Received data does not constain cs8p data');
    }
    else
    {
      let cs8p_data = data['cs8p'];
      if ( cs8p_data['status'] != 'ok' )
      {
        log('Received data status is not ok');
      }
      else
      {
        // If shutters list received
        if ( 'shutters' in cs8p_data )
        {
          this.onShuttersUpdated(cs8p_data['shutters'])
        }
      }
    }
  }

  sendData(data)
  {
    let log = this.log;

    if (this.socket && this.socket.readyState == WebSocket.OPEN)
    {
      let cs8p_data = { cs8p: data };
      let json_data = JSON.stringify( cs8p_data );

      this.socket.send(json_data);
    }
    else
    {
      log('Websocket not opened, won\'t send data');
    }
  }

  onClose(event)
  {
    let log = this.log;

    log('Websocket closed');

    setTimeout( this.connect.bind(this), 1000 );
  }

  onError(error)
  {
    let log = this.log;

    log('onError(): '+error.message);
  }
}

class RollingShutterAccessory
{
  constructor (log, api, name)
  {
    this.log = log
    this.api = api
    this.name = name

    this.position = 0;

    this.uuid = this.api.hap.uuid.generate('CS8P shutter '+name);
    this.accessory = new this.api.platformAccessory('Volet '+name, this.uuid);
    this.service = this.accessory.addService(this.api.hap.Service.WindowCovering);

    this.service.getCharacteristic(this.api.hap.Characteristic.CurrentPosition)
      .on('get', this.getPositionCharacteristicHandler.bind(this));

    this.service.getCharacteristic(this.api.hap.Characteristic.TargetPosition)
      .on('get', this.getPositionCharacteristicHandler.bind(this))
      .on('set', this.setPositionCharacteristicHandler.bind(this))

    this.service.getCharacteristic(this.api.hap.Characteristic.PositionState)
      .updateValue(this.api.hap.Characteristic.PositionState.STOPPED);
    this.service.getCharacteristic(this.api.hap.Characteristic.ObstructionDetected)
      .updateValue(false);
  }

  setPositionCharacteristicHandler (value, callback)
  {
    let log = this.log;

    log(this.name+': '+'Set position: '+value);

    this.service.getCharacteristic(this.api.hap.Characteristic.PositionState)
              .updateValue(this.api.hap.Characteristic.PositionState.INCREASING);

    callback(null);

    clearTimeout(this.timer);
    this.timer = setTimeout
    (
        function()
        {
            log(this.name+': '+'Setting to STOPPED');
            this.position = value;

            this.service.getCharacteristic(this.api.hap.Characteristic.PositionState)
              .updateValue(this.api.hap.Characteristic.PositionState.STOPPED);

            this.service.getCharacteristic(this.api.hap.Characteristic.CurrentPosition)
              .updateValue(value);
        }.bind(this), 2000
    );
  }

  getPositionCharacteristicHandler (callback) {
    let log = this.log;

    log(this.name+': '+'Get position: '+this.position);

    callback(null, this.position);
  }
}
