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
    this.shutters    = new Map();

    this.log    = log;
    this.config = config;
    this.api    = api;
    this.initialized = false;

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

    if ( this.initialized == true )
    {
      log('Shutters already initialized, skipping');
      return;
    }

    this.initialized = true;

    // Initialize a set of existing uuids
    let cached_uuid = new Set();
    for ( const uuid of this.accessories.keys() )
    {
      cached_uuid.add(uuid);
    }

    // Check if shutters match uuid
    for( let shutterData of shutterList )
    {
      const name = shutterData['name'];
      const uuid = this.api.hap.uuid.generate('CS8P shutter '+name);
      let accessory = null;

      if ( this.accessories.has(uuid) )
      {
        // Grab cached accessory
        log('Shutter '+name+' found in cached accessories');
        cached_uuid.delete(uuid);
        accessory = this.accessories.get(uuid);
      }
      else
      {
        // Create new accessory
        log('Shutter '+name+' not found in cached accessories');
        accessory = new this.api.platformAccessory('Volet '+name, uuid);
        accessory.addService(this.api.hap.Service.WindowCovering);

        this.api.registerPlatformAccessories('Chronosoft8PuppeteerPlugin', 'Chronosoft8PuppeteerPlatform', [accessory]);
        this.accessories.set(uuid,accessory);
      }

      let shutter = new RollingShutter(this.log,this.api,name,accessory,this.cs8p_ws);
      this.shutters.set(uuid,shutter);
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

  driveShutter( shutter, command )
  {
      let data = { command: 'drive_shutter', args: { command: command, shutter: shutter }};
      this.sendData(data);
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

class RollingShutter
{
  constructor (log, api, name, accessory, cs8p_ws)
  {
    this.log = log
    this.api = api
    this.name = name
    this.cs8p_ws = cs8p_ws;

    this.position = 0;

    this.accessory = accessory;
    this.service   = accessory.getService(this.api.hap.Service.WindowCovering);

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

    if ( value == 0 )
    {
      this.service.getCharacteristic(this.api.hap.Characteristic.PositionState)
        .updateValue(this.api.hap.Characteristic.PositionState.DECREASING);

      this.cs8p_ws.driveShutter(this.name,'down');
    }
    else if ( value == 100 )
    {
      this.service.getCharacteristic(this.api.hap.Characteristic.PositionState)
        .updateValue(this.api.hap.Characteristic.PositionState.INCREASING);

      this.cs8p_ws.driveShutter(this.name,'up');
    }

    this.service.getCharacteristic(this.api.hap.Characteristic.PositionState)
      .updateValue(this.api.hap.Characteristic.PositionState.STOPPED);
    this.service.getCharacteristic(this.api.hap.Characteristic.CurrentPosition)
      .updateValue(value);

    callback(null);
  }

  getPositionCharacteristicHandler (callback) {
    let log = this.log;

    log(this.name+': '+'Get position: '+this.position);

    callback(null, this.position);
  }
}
