# homebridge-cs8p
[Homebridge](https://homebridge.io) plugin for [chronosoft8-puppeteer application](https://github.com/mika1337/chronosoft8-puppeteer).

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Usage
Add the following content to your config.json:
````
{
  "name": "Chronosoft8",
  "platform": "Chronosoft8PuppeteerPlatform",
  "address": "192.168.1.100",
  "port": "12345"
}
````
with:
* *name*: "Chronosoft8"
* *platform*: "Chronosoft8PuppeteerPlatform"
* *address*: the ip address of the chronosoft8-puppeteer application
* *port*: the port of the chronosoft8-puppeteer application

## Licensing
This project is licensed under the MIT license.
