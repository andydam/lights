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

const TRACK = '38P3Q4QcdjQALGF2Z92BmR';

async function main(): Promise<void> {
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
  const {
    bars,
    beats,
    sections,
    segments,
    tatums,
  } = analysisResponse.body as AudioAnalysis;

  const startTime = Date.now();

  let currentMs = 0;
  let lastBarIndex = 0;
  let lastBeatIndex = 0;
  let lastSectionIndex = 0;
  let lastSegmentIndex = 0;
  let lastTatumIndex = 0;

  while (currentMs < track.duration_ms) {
    const currentData: {
      currentMs: number;
      duration: number;
      bar?: TimeInterval;
      beat?: TimeInterval;
      section?: Section;
      segment?: Segment;
      tatum?: TimeInterval;
    } = {
      currentMs,
      duration: track.duration_ms,
      bar: undefined,
      beat: undefined,
      section: undefined,
      segment: undefined,
      tatum: undefined,
    };

    for (let i = lastBarIndex; i < bars.length; i += 1) {
      const current = bars[i];
      const start = current.start * 1000;
      const end = (current.start + current.duration) * 1000;

      if (currentMs >= start && currentMs <= end) {
        currentData.bar = current;
        lastBarIndex = i;
        break;
      }

      if (currentMs < start) {
        lastBarIndex = i;
        break;
      }
    }

    for (let i = lastBeatIndex; i < beats.length; i += 1) {
      const current = beats[i];
      const start = current.start * 1000;
      const end = (current.start + current.duration) * 1000;

      if (currentMs >= start && currentMs <= end) {
        currentData.beat = current;
        lastBeatIndex = i;
        break;
      }

      if (currentMs < start) {
        lastBeatIndex = i;
        break;
      }
    }

    for (let i = lastSectionIndex; i < sections.length; i += 1) {
      const current = sections[i];
      const start = current.start * 1000;
      const end = (current.start + current.duration) * 1000;

      if (currentMs >= start && currentMs <= end) {
        currentData.section = current;
        lastSectionIndex = i;
        break;
      }

      if (currentMs < start) {
        lastSectionIndex = i;
        break;
      }
    }

    for (let i = lastSegmentIndex; i < segments.length; i += 1) {
      const current = segments[i];
      const start = current.start * 1000;
      const end = (current.start + current.duration) * 1000;

      if (currentMs >= start && currentMs <= end) {
        currentData.segment = current;
        lastSegmentIndex = i;
        break;
      }

      if (currentMs < start) {
        lastSegmentIndex = i;
        break;
      }
    }

    for (let i = lastTatumIndex; i < tatums.length; i += 1) {
      const current = sections[i];
      const start = current.start * 1000;
      const end = (current.start + current.duration) * 1000;

      if (currentMs >= start && currentMs <= end) {
        currentData.tatum = current;
        lastTatumIndex = i;
        break;
      }

      if (currentMs < start) {
        lastTatumIndex = i;
        break;
      }
    }

    console.log(currentData);

    currentMs = Date.now() - startTime;
  }
}

void main().catch(console.log);
