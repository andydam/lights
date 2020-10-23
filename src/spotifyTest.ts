import * as readline from 'readline';

import { BluetoothLED } from './ledClient';
import { simpleColors } from './ledClient/color';

import spotify from 'spotify-web-api-node';

import { CLIENT_ID, CLIENT_SECRET, ACCESS_TOKEN } from './credentials';

// https://developer.spotify.com/documentation/web-api/reference/tracks/get-audio-analysis/#time-interval-object
interface TimeInterval {
  start: number;
  duration: number;
  confidence: number;
}

// https://developer.spotify.com/documentation/web-api/reference/tracks/get-audio-analysis/#section-object
interface Section {
  start: number;
  duration: number;
  confidence: number;
  loudness: number;
  tempo: number;
  tempo_confidence: number;
  key: number;
  key_confidence: number;
  mode: number;
  mode_confidence: number;
  time_signature: number;
  time_signature_confidence: number;
}

// https://developer.spotify.com/documentation/web-api/reference/tracks/get-audio-analysis/#segment-object
interface Segment {
  start: number;
  duration: number;
  confidence: number;
  loudness_start: number;
  loudness_max: number;
  loudness_max_time: number;
  loudness_end: number;
  pitches: number;
  timbre: number;
}

// https://developer.spotify.com/documentation/web-api/reference/tracks/get-audio-analysis/#audio-analysis-object
interface AudioAnalysis {
  bars: TimeInterval[];
  beats: TimeInterval[];
  sections: Section[];
  segments: Segment[];
  tatums: TimeInterval[];
}

// https://developer.spotify.com/documentation/web-api/reference/tracks/get-track/#track-object-full
interface Track {
  duration_ms: number;
}

const TRACK = '2ygxpFIvfVzti5zcpkSmue';

const sleep = (delay: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, delay));

// const getCurrentContent = <T extends { start: number; duration: number }>(
//   content: T[],
//   currentMs: number,
//   lastIndex: number,
// ): {
//   current: T | null;
//   index: number;
// } | null => {
//   for (let i = lastIndex; i < content.length; i += 1) {
//     const current = content[i];
//     const start = current.start * 1000;
//     const end = start + current.duration * 1000;

//     if (currentMs >= start && currentMs <= end) {
//       return {
//         current,
//         index: i,
//       };
//     }

//     if (currentMs < start) {
//       return {
//         current: null,
//         index: i,
//       };
//     }
//   }

//   return null;
// };

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const LEDMacAddresses: string[] = [
  'a4-c1-38-6f-4c-2e',
  'a4-c1-38-aa-17-e2',
  'a4-c1-38-79-74-77',
];

async function main(): Promise<void> {
  const clients: BluetoothLED[] = [];

  for (const LEDMacAddress of LEDMacAddresses) {
    const client = new BluetoothLED(LEDMacAddress);
    console.log(`connecting to ${LEDMacAddress}`);
    await client.start();
    console.log(`connected to ${LEDMacAddress}`);
    client.on('connect', () => console.log(`${LEDMacAddress} connected`));
    client.on('disconnect', () => console.log(`${LEDMacAddress} disconnected`));
    client.on('ble:disconnect', () =>
      console.log(`${LEDMacAddress} disconnected`),
    );
    client.on('reconnected', () => console.log(`${LEDMacAddress} reconnected`));
    clients.push(client);
  }

  const spotifyClient = new spotify({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
  });

  // const grant = await spotifyClient.clientCredentialsGrant();
  // console.log(grant);

  spotifyClient.setAccessToken(ACCESS_TOKEN);

  const trackResponse = await spotifyClient.getTrack(TRACK);
  const track = trackResponse.body as Track;

  const analysisResponse = await spotifyClient.getAudioAnalysisForTrack(TRACK);
  const analysis = analysisResponse.body as AudioAnalysis;

  function normalizeIntervals(
    track: Track,
    analysis: AudioAnalysis,
  ): TimeInterval[] {
    const beats = [...analysis.segments];
    /** Ensure first interval of each type starts at zero. */
    beats[0].duration = beats[0].start + beats[0].duration;
    beats[0].start = 0;

    /** Ensure last interval of each type ends at the very end of the track. */
    beats[beats.length - 1].duration =
      track.duration_ms / 1000 - beats[beats.length - 1].start;

    /** Convert every time value to milliseconds for our later convenience. */
    beats.forEach((interval) => {
      interval.start = interval.start * 1000;
      interval.duration = interval.duration * 1000;
    });

    return beats;
  }

  const beats = normalizeIntervals(track, analysis);

  let activeBeat: TimeInterval | undefined;
  let activeBeatIndex = 0;
  let trackProgress = 0;
  // let beatLoop: NodeJS.Timeout | undefined;
  let lastColor = -1;

  // const colors: string[] = [
  //   16711680,
  //   16744192,
  //   16776960,
  //   8388352,
  //   65280,
  //   65407,
  //   65535,
  //   32767,
  //   255,
  //   8323327,
  //   16711935,
  //   16711807,
  // ].map((n) => {
  //   let hex = Number(n).toString(16);
  //   hex = '000000'.substr(0, 6 - hex.length) + hex;
  //   return hex;
  // });
  const colors = Object.values(simpleColors);

  console.log(beats);

  function calculateTimeUntilNextBeat(): number {
    if (!activeBeat) {
      return 0;
    }
    const duration = activeBeat.duration - (trackProgress - activeBeat.start);
    // console.log('returning duration', duration);
    // console.log(trackProgress);
    return duration;
  }

  function incrementBeat() {
    const lastBeatIndex = activeBeatIndex;
    // if the last beat index is the last beat of the song, stop beat loop
    if (beats.length - 1 !== lastBeatIndex) {
      // stage the beat
      stageBeat();

      // update the active beat to be the next beat
      const nextBeat = beats[lastBeatIndex + 1];
      activeBeat = nextBeat;
      activeBeatIndex = lastBeatIndex + 1;
    }
  }

  /**
   * Fires a beat on the LED strip.
   */
  function fireBeat() {
    // log the beat to console if you want to
    if (!activeBeat) {
      throw new Error('no active beat!');
    }
    console.log(`\nBEAT - ${Math.round(activeBeat.start)}ms\n`);

    // grab a random color from the options that is different from the previous color
    let randColor: number;
    do {
      randColor = Math.floor(Math.random() * Math.floor(colors.length));
    } while (randColor == lastColor);
    //set the new previous color
    lastColor = randColor;

    Promise.all(clients.map((client) => client.setColor(colors[randColor])));
    console.log(colors[randColor]);

    // continue the beat loop by incrementing to the next beat
    incrementBeat();
  }

  function stageBeat(): void {
    //set the timeout id to a variable in state for convenient loop cancellation.
    setTimeout(() => fireBeat(), calculateTimeUntilNextBeat());
  }

  function syncBeats(): void {
    // reset the active beat
    activeBeat = undefined;
    activeBeatIndex = 0;

    // find and set the currently active beat
    for (var i = 0; i < beats.length - 2; i++) {
      if (
        trackProgress >= beats[i].start &&
        trackProgress < beats[i + 1].start
      ) {
        activeBeat = beats[i];
        activeBeatIndex = i;
        break;
      }
    }
    // stage the beat
    stageBeat();
  }

  await new Promise((resolve) => rl.question('press enter', resolve));

  const startTime = Date.now();

  while (trackProgress < track.duration_ms) {
    if (!activeBeat) {
      console.log('no active beat', trackProgress);
      syncBeats();
    }
    trackProgress = Date.now() - startTime;
    await sleep(10);
    console.log(trackProgress);
  }

  // const startTime = Date.now();

  // let currentMs = 0;
  // let lastBarIndex = 0;
  // let lastBeatIndex = 0;
  // let lastSectionIndex = 0;
  // let lastSegmentIndex = 0;
  // let lastTatumIndex = 0;

  // while (currentMs < track.duration_ms) {
  //   const barCurrent = getCurrentContent(bars, currentMs, lastBarIndex);
  //   const beatCurrent = getCurrentContent(beats, currentMs, lastBeatIndex);
  //   const sectionCurrent = getCurrentContent(
  //     sections,
  //     currentMs,
  //     lastSectionIndex,
  //   );
  //   const segmentCurrent = getCurrentContent(
  //     segments,
  //     currentMs,
  //     lastSegmentIndex,
  //   );
  //   const tatumCurrent = getCurrentContent(tatums, currentMs, lastTatumIndex);

  //   if (barCurrent) lastBarIndex = barCurrent.index;
  //   if (beatCurrent) lastBeatIndex = beatCurrent.index;
  //   if (sectionCurrent) lastSectionIndex = sectionCurrent.index;
  //   if (segmentCurrent) lastSegmentIndex = segmentCurrent.index;
  //   if (tatumCurrent) lastTatumIndex = tatumCurrent.index;

  //   const currentData: {
  //     currentMs: number;
  //     duration: number;
  //     bar: TimeInterval | null;
  //     beat: TimeInterval | null;
  //     section: Section | null;
  //     segment: Segment | null;
  //     tatum: TimeInterval | null;
  //   } = {
  //     currentMs,
  //     duration: track.duration_ms,
  //     bar: barCurrent && barCurrent.current,
  //     beat: beatCurrent && beatCurrent.current,
  //     section: sectionCurrent && sectionCurrent.current,
  //     segment: segmentCurrent && segmentCurrent.current,
  //     tatum: tatumCurrent && tatumCurrent.current,
  //   };

  //   console.log(currentData);

  //   currentMs = Date.now() - startTime;

  //   await sleep(100);
  // }
}

void main().catch(console.log);
