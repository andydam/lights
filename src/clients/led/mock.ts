import chalk from 'chalk';

import { Base } from './base';

import { logger } from '../../utils';

////////////////////////////////////////////////////////////
/// PUBLIC

export class Mock extends Base {
  commandDelayMs = 50;

  async start(): Promise<void> {
    this.emit('connected');
  }

  async disconnect(): Promise<void> {
    this.emit('disconnected');
  }

  async setPower(power: boolean): Promise<void> {
    logger.debug(`${this.address} : power set to ${power}`);
  }

  async setBrightness(brightness: number): Promise<void> {
    logger.debug(`${this.address} : brightness set to ${brightness}`);
  }

  async setColor(color: string): Promise<void> {
    const colorRegex = color.match(/rgb\((\d+), (\d+), (\d+)\)/);
    if (!colorRegex) {
      throw new Error(`${this.address} : unexpected color ${color}!`);
    }

    logger.debug(
      `${this.address} : color set to ${chalk.rgb(
        Number(colorRegex[1]),
        Number(colorRegex[2]),
        Number(colorRegex[3]),
      )(color)}`,
    );
  }
}
