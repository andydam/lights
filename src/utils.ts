import * as winston from 'winston';

////////////////////////////////////////////////////////////
/// PUBLIC

export const average = (arr: number[]): number =>
  arr.reduce((a, b) => a + b, 0) / arr.length;

export const sleep = (delay: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, delay));

export const logger = winston.createLogger({
  format: winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message, ...args }) => {
      const ts = timestamp.slice(0, 19).replace('T', ' ');
      return `${ts} ${level}: ${message} ${
        Object.keys(args).length ? JSON.stringify(args, null, 2) : ''
      }`;
    })
  ),
  transports: [
    new winston.transports.Console({
      level: 'debug',
    }),
  ],
});
