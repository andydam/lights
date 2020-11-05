import { Base } from './base';

import { logger } from '../../utils';

////////////////////////////////////////////////////////////
/// PUBLIC

export class Mock extends Base {
  async start(): Promise<void> {
    this.emit('connected');
  }

  async disconnect(): Promise<void> {
    this.emit('disconnected');
  }

  async setPower(power: boolean): Promise<void> {
    logger.debug(`${this.address} : power set to ${power}`);
  }

  async setBrightness(_: number): Promise<void> {}

  async setColor(_: string): Promise<void> {}

  async setBrightnessTransition(brightness: number): Promise<void> {
    logger.debug(`${this.address}: brightness transitioning to ${brightness}`);
  }

  async setColorTransition(color: string): Promise<void> {
    console.log(`${this.address} : color transitioning to ${color}`);
  }
}
