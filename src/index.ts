import { Base } from './clients/led/base';
import { BluetoothLED } from './clients/led';
import { Mock } from './clients/led/mock';
import * as Settings from './settings';
import { Spotify } from './clients/spotify';
import { logger } from './utils';

const average = (arr: number[]): number =>
  arr.reduce((a, b) => a + b, 0) / arr.length;

async function main(): Promise<void> {
  const lightClients: Base[] = [];

  for (const lightbulbMACAddress of Settings.Settings.lightbulbMACAddresses) {
    let lightClient: Base;

    if (Settings.Settings.debug) {
      lightClient = new Mock(lightbulbMACAddress);
    } else {
      lightClient = new BluetoothLED(lightbulbMACAddress);
    }

    await lightClient.start();
    lightClients.push(lightClient);
  }

  const spotifyClient = new Spotify({
    clientId: Settings.Settings.spotify.clientId,
    clientSecret: Settings.Settings.spotify.clientSecret,
  });
  await spotifyClient.getAccessToken();

  const interpolator = Settings.getInterpolator();
  let segmentTransitioning = false;
  spotifyClient.on('newSegment', async (current, next) => {
    if (segmentTransitioning || !next) {
      logger.warn('segment skipped');
      return;
    }
    segmentTransitioning = true;

    const { pitches: currentPitches, duration } = current;
    const { pitches: nextPitches } = next;

    const pitchesInLight = 12 / lightClients.length;

    const [currentColors, nextColors] = [currentPitches, nextPitches].map(
      (pitches) =>
        lightClients.map((_, i) => {
          const end = pitchesInLight * (i + 1);
          const start = end - pitchesInLight;
          return interpolator(average(pitches.slice(start, end)));
        })
    );

    await Promise.all([
      ...lightClients.map((light, i) =>
        light.transitionColor(currentColors[i], nextColors[i], duration * 0.95)
      ),
      ...lightClients.map((lights) =>
        lights.transitionBrightness(
          Math.abs(current.loudness_start + 50) / 100,
          Math.abs(next.loudness_start + 50) / 100,
          duration * 0.95
        )
      ),
    ]);
    segmentTransitioning = false;
  });

  await spotifyClient.start();
}

void main().catch(logger.error);
