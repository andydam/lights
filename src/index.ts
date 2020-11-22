import { Base } from './clients/led/base';
import { BluetoothLED } from './clients/led';
import { Mock } from './clients/led/mock';
import * as Settings from './settings';
import { Segment, Spotify } from './clients/spotify';
import { average, logger } from './utils';

export const onNewSegment = (lightClients: Base[]) => async (
  current: Segment,
  next: Segment | null
) => {
  if (!next) return;

  const { pitches: currentPitches, duration } = current;
  const { pitches: nextPitches } = next;

  const pitchesInLight = currentPitches.length / lightClients.length;

  const [currentColors, nextColors] = [currentPitches, nextPitches].map(
    (pitches) =>
      lightClients.map((_, i) => {
        const end = pitchesInLight * (i + 1);
        const start = end - pitchesInLight;
        return Settings.getInterpolator()(average(pitches.slice(start, end)));
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
};

const main = async (): Promise<void> => {
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

  spotifyClient.on('newSegment', onNewSegment(lightClients));

  await spotifyClient.start();
};

void main().catch(logger.error);
