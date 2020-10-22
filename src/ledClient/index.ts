import noble from '@abandonware/noble';

import * as Color from './color';
import { EventEmitter } from 'events';

////////////////////////////////////////////////////////////
/// PRIVATE

enum LedCommand {
  POWER = 0x01,
  BRIGHTNESS = 0x04,
  COLOR = 0x05,
}

enum LedMode {
  MANUAL = 0x02,
  MICROPHONE = 0x06,
  SCENES = 0x05,
}

const UUID_CONTROL_CHARACTERISTIC = '000102030405060708090a0b0c0d2b11';

////////////////////////////////////////////////////////////
/// PUBLIC

export class BluetoothLED extends EventEmitter {
  address: string;
  characteristic?: noble.Characteristic;
  disconnectedCalled = false;
  peripheral?: noble.Peripheral;

  constructor(address: string) {
    super();
    this.address = address;
  }

  async connectToPeripheral(reconnect: boolean = false): Promise<void> {
    if (!this.peripheral) {
      throw new Error('peripheral not found yet!');
    }

    await this.peripheral.connectAsync();

    const {
      characteristics,
    } = await this.peripheral.discoverAllServicesAndCharacteristicsAsync();

    for (const characteristic of characteristics) {
      if (characteristic.uuid !== UUID_CONTROL_CHARACTERISTIC) {
        continue;
      }

      setTimeout(() => this.emit(reconnect ? 'reconnected' : 'connected'), 500);
      this.characteristic = characteristic;
      return;
    }

    throw new Error('characteristic not found!');
  }

  onPeripheralDisconnect = async (): Promise<void> => {
    this.emit('ble:disconnect');
    if (this.disconnectedCalled) {
      noble.removeListener('disconnect', this.onPeripheralDisconnect);
      return;
    }
    await this.connectToPeripheral(true);
  };

  findAndConnectToPeripheral = async (
    peripheral: noble.Peripheral,
  ): Promise<void> => {
    console.log(
      `found device ${peripheral.address} - ${JSON.stringify(
        peripheral.advertisement,
      )}`,
    );

    if (peripheral.address !== this.address) {
      return;
    }

    console.log('found matching device');
    await noble.stopScanningAsync();
    noble.removeListener('discover', this.findAndConnectToPeripheral);
    this.peripheral = peripheral;
    await this.connectToPeripheral();
    this.peripheral.on('disconnect', this.onPeripheralDisconnect);
  };

  start(): void {
    this.disconnectedCalled = false;
    noble.on('discover', this.findAndConnectToPeripheral);

    process.nextTick(() => {
      noble.startScanning([], false);
    });
  }

  async disconnect(): Promise<void> {
    if (!this.peripheral) {
      throw new Error('peripheral not found yet!');
    }

    this.disconnectedCalled = true;
    await this.peripheral.disconnectAsync();
    noble.removeListener('discover', this.findAndConnectToPeripheral);
    noble.removeListener('disconnect', this.onPeripheralDisconnect);
  }

  async send(inputCmd: any, payload: any): Promise<void> {
    if (!this.characteristic) {
      throw new Error('characteristic not found!');
    }

    const cmd = inputCmd & 0xff;

    const preChecksumFrame = Buffer.concat([
      // @ts-ignore
      Buffer.from([0x33, cmd].flat()),
      // @ts-ignore
      Buffer.from([payload].flat()),
    ]);
    const preChecksumPaddingFrame = Buffer.concat([
      preChecksumFrame,
      Buffer.from(new Array(19 - preChecksumFrame.length).fill(0)),
    ]);
    let checksum = 0;
    // @ts-ignore
    for (const i of preChecksumPaddingFrame) {
      checksum ^= i;
    }
    await this.characteristic.writeAsync(
      Buffer.concat([preChecksumPaddingFrame, Buffer.from([checksum & 0xff])]),
      true,
    );
  }

  async setState(state: boolean): Promise<void> {
    await this.send(LedCommand.POWER, state ? 0x1 : 0x0);
  }

  async setBrightness(value: number): Promise<void> {
    const brightness = value / 100;
    if (brightness > 1 || brightness < 0) {
      throw new Error(`invalid brightness ${value}!`);
    }
    await this.send(LedCommand.BRIGHTNESS, Math.floor(brightness * 0xff));
  }

  async setColor(color: string): Promise<void> {
    const { r, g, b, alpha } = Color.getColor(color);
    await this.send(LedCommand.COLOR, [LedMode.MANUAL, r, g, b, alpha]);
  }
}
