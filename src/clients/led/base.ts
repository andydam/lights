import * as d3Interpolate from 'd3-interpolate';
import { TypedEmitter } from 'tiny-typed-emitter';

import { logger, sleep } from '../../utils';

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
  brightnessTransitionLock: boolean = false;
  colorTransitionLock: boolean = false;

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
    const logPrefix = 'clients.led.base.Base.transitionBrightness:';
    if (this.brightnessTransitionLock) {
      logger.warn(
        `${logPrefix} ${this.address}: skipping brightness transition, already transitioning!`,
      );
    }
    this.brightnessTransitionLock = true;

    if (start < 0 || start > 1) {
      throw new Error(`invalid start brightness ${start}!`);
    } else if (end < 0 || end > 1) {
      throw new Error(`invalid end brightness ${end}!`);
    }

    const startTime = Date.now();
    const endTime = startTime + lengthMs;
    const interpolated = d3Interpolate.interpolateNumber(start, end);

    let currentTime = Date.now();
    while (currentTime < endTime - this.commandDelayMs) {
      const elapsedTime = currentTime - startTime;
      const interpolateValue = elapsedTime / lengthMs;
      const brightness = interpolated(interpolateValue);
      await this.setBrightness(brightness);
      await sleep(this.commandDelayMs);
      currentTime = Date.now();
    }
    this.brightnessTransitionLock = false;
  }

  async transitionColor(
    start: string,
    end: string,
    lengthMs: number,
  ): Promise<void> {
    const logPrefix = 'clients.led.base.Base.transitionColor:';
    if (this.colorTransitionLock) {
      logger.warn(
        `${logPrefix} ${this.address}: skipping color transition, already transitioning!`,
      );
    }
    this.colorTransitionLock = true;

    const startTime = Date.now();
    const endTime = startTime + lengthMs;
    const interpolated = d3Interpolate.interpolateRgb(start, end);

    let currentTime = Date.now();
    while (currentTime < endTime - this.commandDelayMs) {
      const elapsedTime = currentTime - startTime;
      const interpolateValue = elapsedTime / lengthMs;
      const color = interpolated(interpolateValue);
      await this.setColor(color);
      await sleep(this.commandDelayMs);
      currentTime = Date.now();
    }
    this.colorTransitionLock = false;
  }
}
