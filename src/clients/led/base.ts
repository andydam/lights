import * as d3Interpolate from 'd3-interpolate';
import { TypedEmitter } from 'tiny-typed-emitter';

import { sleep } from '../../utils';

////////////////////////////////////////////////////////////
/// INTERFACES

interface BaseEvents {
  connected: () => void;
  deviceDisconnected: () => void;
  disconnected: () => void;
  reconnected: () => void;
}

////////////////////////////////////////////////////////////
/// PUBLIC

export abstract class Base extends TypedEmitter<BaseEvents> {
  address: string;

  abstract commandDelayMs: number;

  constructor(address: string) {
    super();

    this.address = address;
  }

  abstract async start(): Promise<void>;

  abstract async disconnect(): Promise<void>;

  abstract async setPower(power: boolean): Promise<void>;

  abstract async setBrightness(brightness: number): Promise<void>;

  abstract async setColor(color: string): Promise<void>;

  async transitionBrightness(
    start: number,
    end: number,
    lengthMs: number,
  ): Promise<void> {
    if (start < 0 || start > 1) {
      throw new Error(`invalid start brightness ${start}!`);
    } else if (end < 0 || end > 1) {
      throw new Error(`invalid end brightness ${end}!`);
    }

    const interpolated = d3Interpolate.interpolateNumber(start, end);
    const intervals = Math.floor(lengthMs / this.commandDelayMs);

    for (let i = 0; i < 1; i += 1 / intervals) {
      const brightness = interpolated(i);
      this.setBrightness(brightness);
      await sleep(this.commandDelayMs);
    }
  }

  async transitionColor(
    start: string,
    end: string,
    lengthMs: number,
  ): Promise<void> {
    const startTime = Date.now();
    const endTime = startTime + lengthMs;
    const interpolated = d3Interpolate.interpolateRgb(start, end);

    let currentTime = Date.now();
    while (currentTime < endTime) {
      const elapsedTime =  currentTime - startTime;
      const interpolateValue = elapsedTime / lengthMs;
      const color = interpolated(interpolateValue);
      await this.setColor(color);
      await sleep(this.commandDelayMs);
      currentTime = Date.now();
    }
  }
}
