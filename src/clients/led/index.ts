import noble from '@abandonware/noble';

import * as Color from './color';
import { Base } from './base';

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

export class BluetoothLED extends Base {
  characteristic?: noble.Characteristic;
  disconnectedCalled = false;
  peripheral?: noble.Peripheral;

  private async _connectToPeripheral(
    reconnect: boolean = false,
  ): Promise<void> {
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

  private _onPeripheralDisconnect = async (): Promise<void> => {
    this.emit('deviceDisconnected');
    if (this.disconnectedCalled) {
      this.emit('disconnected');
      noble.removeListener('disconnected', this._onPeripheralDisconnect);
      return;
    }
    await this._connectToPeripheral(true);
  };

  private _findAndConnectToPeripheral = async (
    peripheral: noble.Peripheral,
  ): Promise<boolean> => {
    console.log(
      `found device ${peripheral.address} - ${JSON.stringify(
        peripheral.advertisement,
      )}`,
    );

    if (peripheral.address !== this.address) {
      return false;
    }

    console.log('found matching device');
    await noble.stopScanningAsync();
    noble.removeListener('discover', this._findAndConnectToPeripheral);
    this.peripheral = peripheral;
    await this._connectToPeripheral();
    this.peripheral.on('disconnect', this._onPeripheralDisconnect);
    return true;
  };

  private async _send(
    inputCmd: number,
    payload: number | number[],
  ): Promise<void> {
    if (!this.characteristic) {
      throw new Error('characteristic not found!');
    }

    const cmd = inputCmd & 0xff;

    const preChecksumFrame = Buffer.concat([
      Buffer.from([0x33, cmd].flat()),
      Buffer.from([payload].flat()),
    ]);
    const preChecksumPaddingFrame = Buffer.concat([
      preChecksumFrame,
      Buffer.from(new Array(19 - preChecksumFrame.length).fill(0)),
    ]);
    let checksum = 0;
    for (const i of preChecksumPaddingFrame) {
      checksum ^= i;
    }
    await this.characteristic.writeAsync(
      Buffer.concat([preChecksumPaddingFrame, Buffer.from([checksum & 0xff])]),
      true,
    );
  }

  start(): Promise<void> {
    this.disconnectedCalled = false;

    return new Promise((resolve) => {
      noble.on('discover', async (peripheral: noble.Peripheral) => {
        const foundAndConnected = await this._findAndConnectToPeripheral(
          peripheral,
        );
        if (foundAndConnected) {
          resolve();
        }
      });

      process.nextTick(() => {
        noble.startScanning([], false);
      });
    });
  }

  async disconnect(): Promise<void> {
    if (!this.peripheral) {
      throw new Error('peripheral not found yet!');
    }

    this.disconnectedCalled = true;
    await this.peripheral.disconnectAsync();
    noble.removeListener('discover', this._findAndConnectToPeripheral);
    noble.removeListener('disconnect', this._onPeripheralDisconnect);
  }

  async setPower(power: boolean): Promise<void> {
    await this._send(LedCommand.POWER, power ? 0x1 : 0x0);
  }

  async setBrightness(value: number): Promise<void> {
    const brightness = value / 100;
    if (brightness > 1 || brightness < 0) {
      throw new Error(`invalid brightness ${value}!`);
    }
    await this._send(LedCommand.BRIGHTNESS, Math.floor(brightness * 0xff));
  }

  async setColor(color: string): Promise<void> {
    const { r, g, b } = Color.getColor(color);
    await this._send(LedCommand.COLOR, [LedMode.MANUAL, r, g, b]);
  }
}
