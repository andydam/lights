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
/// PRIVATE

const roundUpToNearest5 = (x: number): number => Math.ceil(x / 5) * 5;

////////////////////////////////////////////////////////////
/// PUBLIC

export abstract class Base extends TypedEmitter<BaseEvents> {
  address: string;

  brightnessInterval = 5;
  colorSteps = 20;
  currentBrightness: number | null = null;
  currentColor: string | null = null;

  constructor(address: string) {
    super();

    this.address = address;
  }

  abstract async start(): Promise<void>;

  abstract async disconnect(): Promise<void>;

  abstract async setPower(power: boolean): Promise<void>;

  abstract async setBrightness(brightness: number): Promise<void>;

  abstract async setColor(color: string): Promise<void>;

  async setBrightnessTransition(brightness: number): Promise<void> {
    if (!this.currentBrightness) {
      this.currentBrightness = brightness;
      return this.setBrightness(brightness);
    }

    const currentBrightness = roundUpToNearest5(this.currentBrightness);
    const desiredBrightness = roundUpToNearest5(brightness);

    const interval =
      brightness > this.currentBrightness
        ? this.brightnessInterval
        : -this.brightnessInterval;
    const numIntervals =
      (currentBrightness - desiredBrightness) / this.brightnessInterval;

    for (let i = 0; i < numIntervals; i += 1) {
      await this.setBrightness(desiredBrightness + interval * i);
    }
    this.currentBrightness = brightness;
  }

  async setColorTransition(color: string): Promise<void> {
    if (!this.currentColor) {
      this.currentColor = color;
      return this.setColor(color);
    }

    const interpolatedColors = d3Interpolate.interpolateHclLong(
      this.currentColor,
      color,
    );

    for (let i = 0; i <= 1; i += 1 / this.colorSteps) {
      const desiredColor = interpolatedColors(i);
      await this.setColor(desiredColor);
      await sleep(50);
    }

    this.currentColor = color;
  }
}
