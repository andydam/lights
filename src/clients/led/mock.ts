import { Base } from './base';

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
    console.log(`${this.address} : power set to ${power}`);
  }

  async setBrightness(brightness: number): Promise<void> {
    console.log(`${this.address} : brightness set to ${brightness}`);
  }

  async setColor(color: string): Promise<void> {
    console.log(`${this.address} : color set to ${color}`);
  }
}
